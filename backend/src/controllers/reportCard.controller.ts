import { Response } from 'express';
import type { AuthRequest } from '../middleware/auth';
import { adminDb as supabase } from '../utils/db';
import { safeDbErrorMessage, safeDbErrorStatus } from '../utils/dbErrors';
import { logAudit } from '../utils/audit';
import { pickLang } from '../utils/archivePdfShared';
import {
  rowToGrade, subjectPercent, bandForPercent, averagePercent,
  collectMarkNames, getMarkValue, loadGradingConfig, subjectYear, remedialTotal,
  type GradeLike, type GradingConfig,
} from '../utils/gradeCalc';
import { streamReportCardPdf, streamClassReportCardsPdf, type ReportCardData } from '../utils/reportCardPdf';
import { streamTranscriptPdf, type TranscriptData, type TranscriptYear, type TranscriptYearRow } from '../utils/transcriptPdf';

// Report cards — Phase 1 (migration 066). LIVE-rendered PDFs built on demand
// from RELEASED `grades`; only the overall remark + the per-school template are
// stored. Admin only (capability academics.oversee), school-scoped on every
// query. Parent download + the publish gate land in Phase 2.

interface ReportCardConfig {
  signatories: { classTeacher: string; principal: string };
  headerNote: string;
  footerNote: string;
  defaultLang: string;
}
function normalizeConfig(raw: unknown): ReportCardConfig {
  const r = (raw ?? {}) as { signatories?: { classTeacher?: string; principal?: string }; headerNote?: string; footerNote?: string; defaultLang?: string };
  const s = r.signatories ?? {};
  return {
    signatories: {
      classTeacher: typeof s.classTeacher === 'string' ? s.classTeacher : '',
      principal: typeof s.principal === 'string' ? s.principal : '',
    },
    headerNote: typeof r.headerNote === 'string' ? r.headerNote : '',
    footerNote: typeof r.footerNote === 'string' ? r.footerNote : '',
    defaultLang: typeof r.defaultLang === 'string' ? r.defaultLang : 'en',
  };
}

// ── GET /admin/report-cards/config ──────────────────────────────────────────
export async function getConfig(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { data: school, error } = await supabase
    .from('schools').select('report_card_config').eq('id', schoolId).single();
  if (error || !school) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json(normalizeConfig(school.report_card_config));
}

// ── PUT /admin/report-cards/config ──────────────────────────────────────────
export async function updateConfig(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const body = req.body as Partial<ReportCardConfig> & { signatories?: { classTeacher?: string; principal?: string } };

  const { data: school, error } = await supabase
    .from('schools').select('report_card_config').eq('id', schoolId).single();
  if (error || !school) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  const before = normalizeConfig(school.report_card_config);
  const next: ReportCardConfig = {
    signatories: {
      classTeacher: body.signatories?.classTeacher ?? before.signatories.classTeacher,
      principal: body.signatories?.principal ?? before.signatories.principal,
    },
    headerNote: body.headerNote ?? before.headerNote,
    footerNote: body.footerNote ?? before.footerNote,
    defaultLang: body.defaultLang ?? before.defaultLang,
  };

  const { error: updErr } = await supabase
    .from('schools').update({ report_card_config: next }).eq('id', schoolId);
  if (updErr) { res.status(safeDbErrorStatus(updErr)).json({ error: safeDbErrorMessage(updErr) }); return; }

  await logAudit({
    req, entityType: 'report_card', entityId: schoolId, action: 'update',
    before: { report_card_config: before }, after: { report_card_config: next },
    label: 'Report card settings',
  });
  res.json(next);
}

// ── GET /admin/report-cards?year=&term=&classId= — roster + completeness ─────
export async function getRoster(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const year = String(req.query.year || '').trim();
  const term = String(req.query.term || '').trim();
  const classId = (req.query.classId ? String(req.query.classId) : '').trim();
  // Graduated students stay in the roster (is_graduated=true) — opt in so the
  // admin can pull a leaver's transcript without un-graduating them.
  const includeGraduated = String(req.query.includeGraduated || '') === '1';
  if (!year || !term) { res.status(400).json({ error: 'year and term are required' }); return; }

  let sq = supabase.from('students')
    .select('id, full_name, class_id, is_graduated, classes(name)')
    .eq('school_id', schoolId)
    .order('full_name');
  if (!includeGraduated) sq = sq.eq('is_graduated', false);
  if (classId) sq = sq.eq('class_id', classId);
  const { data: students, error: sErr } = await sq;
  if (sErr) { res.status(safeDbErrorStatus(sErr)).json({ error: safeDbErrorMessage(sErr) }); return; }

  const studentIds = (students ?? []).map((s: Record<string, unknown>) => s.id as string);
  // Per-student subject counts (total vs released) for this year+term.
  const totals = new Map<string, { total: Set<string>; released: Set<string> }>();
  if (studentIds.length) {
    const { data: grades, error: gErr } = await supabase
      .from('grades')
      .select('student_id, subject, is_released')
      .eq('school_id', schoolId)
      .eq('academic_year', year)
      .eq('grading_period', term)
      .in('student_id', studentIds);
    if (gErr) { res.status(safeDbErrorStatus(gErr)).json({ error: safeDbErrorMessage(gErr) }); return; }
    for (const g of (grades ?? []) as Record<string, unknown>[]) {
      const sid = g.student_id as string;
      const subj = String(g.subject || '').trim(); if (!subj) continue;
      const e = totals.get(sid) ?? { total: new Set<string>(), released: new Set<string>() };
      e.total.add(subj);
      if (g.is_released === true) e.released.add(subj);
      totals.set(sid, e);
    }
  }
  // Which students have an overall remark this term.
  const remarked = new Set<string>();
  if (studentIds.length) {
    const { data: rem } = await supabase
      .from('report_card_remarks')
      .select('student_id')
      .eq('school_id', schoolId)
      .eq('academic_year', year)
      .eq('term', term)
      .in('student_id', studentIds);
    for (const r of (rem ?? []) as Record<string, unknown>[]) remarked.add(r.student_id as string);
  }

  // Whether this (year, term) is published to parents.
  const { data: pub } = await supabase
    .from('report_card_publish').select('id')
    .eq('school_id', schoolId).eq('academic_year', year).eq('term', term).maybeSingle();

  res.json({
    year, term,
    published: !!pub,
    students: (students ?? []).map((s: Record<string, unknown>) => {
      const t = totals.get(s.id as string);
      const cls = s.classes as { name?: string } | null;
      return {
        id: s.id as string,
        fullName: s.full_name as string,
        className: cls?.name ?? null,
        totalSubjects: t ? t.total.size : 0,
        releasedSubjects: t ? t.released.size : 0,
        hasRemark: remarked.has(s.id as string),
        isGraduated: s.is_graduated === true,
      };
    }),
  });
}

// ── GET /admin/report-cards/remarks?studentId=&year=&term= ──────────────────
export async function getRemarks(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const studentId = String(req.query.studentId || '');
  const year = String(req.query.year || '').trim();
  const term = String(req.query.term || '').trim();
  if (!studentId || !year || !term) { res.status(400).json({ error: 'studentId, year and term are required' }); return; }

  const { data, error } = await supabase
    .from('report_card_remarks')
    .select('homeroom_comment, principal_comment, updated_at')
    .eq('school_id', schoolId)
    .eq('student_id', studentId)
    .eq('academic_year', year)
    .eq('term', term)
    .maybeSingle();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json({
    homeroomComment: data?.homeroom_comment ?? '',
    principalComment: data?.principal_comment ?? '',
    updatedAt: data?.updated_at ?? null,
  });
}

// ── PUT /admin/report-cards/remarks ─────────────────────────────────────────
export async function upsertRemarks(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const body = req.body as { studentId: string; academicYear: string; term: string; homeroomComment?: string | null; principalComment?: string | null };

  // The student must belong to this school.
  const { data: student, error: sErr } = await supabase
    .from('students').select('id').eq('id', body.studentId).eq('school_id', schoolId).maybeSingle();
  if (sErr) { res.status(safeDbErrorStatus(sErr)).json({ error: safeDbErrorMessage(sErr) }); return; }
  if (!student) { res.status(404).json({ error: 'Student not found.' }); return; }

  const row = {
    school_id: schoolId,
    student_id: body.studentId,
    academic_year: body.academicYear,
    term: body.term,
    homeroom_comment: body.homeroomComment?.trim() || null,
    principal_comment: body.principalComment?.trim() || null,
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from('report_card_remarks')
    .upsert(row, { onConflict: 'school_id,student_id,academic_year,term' });
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  await logAudit({
    req, entityType: 'report_card', entityId: body.studentId, action: 'update',
    before: null,
    after: { academic_year: body.academicYear, term: body.term, homeroom: row.homeroom_comment, principal: row.principal_comment },
    label: 'Report card remark',
  });
  res.json({ ok: true });
}

// Shared assembly: builds ReportCardData for a (student, year, term) from
// RELEASED grades + config + remark. Returns null if the student isn't in this
// school. Used by both the admin and the parent PDF endpoints. THROWS on DB error.
async function assembleReportCardData(
  schoolId: string, studentId: string, year: string, term: string,
): Promise<{ data: ReportCardData; safeName: string; defaultLang: string; empty?: boolean } | null> {
  const { data: school, error: schErr } = await supabase
    .from('schools').select('name, logo_url, report_card_config').eq('id', schoolId).single();
  if (schErr || !school) throw schErr ?? new Error('school not found');

  const { data: student, error: stuErr } = await supabase
    .from('students')
    .select('id, full_name, profile_picture, date_of_birth, classes(name)')
    .eq('id', studentId).eq('school_id', schoolId).maybeSingle();
  if (stuErr) throw stuErr;
  if (!student) return null;

  const { data: gradeRows, error: gErr } = await supabase
    .from('grades')
    .select('subject, marks, daily_grade, quiz_grade, monthly_exam_grade, term_exam_grade, admin_note')
    .eq('school_id', schoolId)
    .eq('student_id', studentId)
    .eq('academic_year', year)
    .eq('grading_period', term)
    .eq('is_released', true)
    .order('subject');
  if (gErr) throw gErr;

  const cfgGrading = await loadGradingConfig(supabase, schoolId);

  // Round Two card (P5): when the requested term IS the remedial term, the
  // card shows the retakes instead of normal term marks — the corrected
  // term's original value side-by-side with the exam + carried marks and the
  // /100 total, plus the official post-substitution year average.
  if (cfgGrading.remedial
    && term.trim().toLowerCase() === cfgGrading.remedial.termName.trim().toLowerCase()) {
    return assembleRemedialCardData(schoolId, school, student, year, term, cfgGrading);
  }

  const { data: remark } = await supabase
    .from('report_card_remarks')
    .select('homeroom_comment, principal_comment')
    .eq('school_id', schoolId).eq('student_id', studentId)
    .eq('academic_year', year).eq('term', term)
    .maybeSingle();

  const rows = (gradeRows ?? []) as Record<string, unknown>[];
  const asGrade = (r: Record<string, unknown>): GradeLike => rowToGrade(r);
  const markColumns = collectMarkNames(rows.map(asGrade));
  const percents: number[] = [];
  const subjects = rows.map(r => {
    const g = asGrade(r);
    const pct = subjectPercent(g, cfgGrading.markMaxes);
    const band = bandForPercent(pct, cfgGrading.bands);
    if (pct != null) percents.push(pct);
    return {
      subject: String(r.subject || ''),
      components: markColumns.map(name => ({ name, value: getMarkValue(g, name) })),
      percent: pct,
      letter: band?.letter ?? null,
      adminNote: (r.admin_note as string | null) ?? null,
    };
  });

  const tpl = normalizeConfig(school.report_card_config);
  const cls = student.classes as { name?: string } | null;

  const data: ReportCardData = {
    school: { name: school.name as string, logoUrl: (school.logo_url as string | null) ?? null },
    student: {
      fullName: student.full_name as string,
      className: cls?.name ?? null,
      photoUrl: (student.profile_picture as string | null) ?? null,
      dateOfBirth: (student.date_of_birth as string | null) ?? null,
    },
    academicYear: year,
    term,
    generatedAt: new Date().toISOString(),
    showPercent: cfgGrading.mode === 'scale' || cfgGrading.mode === 'both',
    showGpa: cfgGrading.mode === 'gpa' || cfgGrading.mode === 'both',
    markColumns,
    subjects,
    // The overall letter is the band of the percent average — letters are
    // presentation of the same math, never averaged grade points (decision 16).
    overall: (() => {
      const avg = averagePercent(percents);
      return { averagePercent: avg, letter: bandForPercent(avg, cfgGrading.bands)?.letter ?? null };
    })(),
    remarks: {
      homeroom: (remark?.homeroom_comment as string | null) ?? null,
      principal: (remark?.principal_comment as string | null) ?? null,
    },
    config: {
      classTeacher: tpl.signatories.classTeacher,
      principal: tpl.signatories.principal,
      headerNote: tpl.headerNote,
      footerNote: tpl.footerNote,
    },
  };
  const safeName = `${(student.full_name as string) || 'student'}-${year}-${term}`.replace(/[^a-z0-9-]/gi, '_');
  return { data, safeName, defaultLang: tpl.defaultLang };
}

// Round Two report card (REMEDIAL_TERM_PLAN.md P5, layout = O-4): one row per
// released retake. Columns: the corrected regular terms (each row's ORIGINAL
// value appears in its own term's column — side-by-side, locked decision 2),
// then the remedial exam mark, the carried mark, and the /100 total with its
// band letter. The overall figure is the OFFICIAL year average with every
// released retake substituted (subject-first, across ALL subjects).
async function assembleRemedialCardData(
  schoolId: string,
  school: Record<string, unknown>,
  student: Record<string, unknown>,
  year: string,
  term: string,
  cfg: GradingConfig,
): Promise<{ data: ReportCardData; safeName: string; defaultLang: string; empty?: boolean }> {
  const canon = (s: unknown): string => String(s ?? '').trim().toLowerCase();
  const studentId = String(student.id);
  const [remRes, gradesRes, remarkRes, termRes] = await Promise.all([
    supabase.from('remedial_grades')
      .select('subject, for_period, exam_value, carry_name, carry_value')
      .eq('school_id', schoolId).eq('student_id', studentId).eq('academic_year', year)
      .eq('is_released', true).not('exam_value', 'is', null)
      .order('subject'),
    supabase.from('grades')
      .select('subject, marks, daily_grade, quiz_grade, monthly_exam_grade, term_exam_grade, grading_period')
      .eq('school_id', schoolId).eq('student_id', studentId).eq('academic_year', year)
      .eq('is_released', true),
    supabase.from('report_card_remarks')
      .select('homeroom_comment, principal_comment')
      .eq('school_id', schoolId).eq('student_id', studentId)
      .eq('academic_year', year).eq('term', term)
      .maybeSingle(),
    supabase.from('terms').select('name, kind').eq('school_id', schoolId).order('order_index'),
  ]);
  if (remRes.error) throw remRes.error;
  if (gradesRes.error) throw gradesRes.error;

  const entries = (remRes.data ?? []) as Record<string, unknown>[];
  const regularTerms = ((termRes.data ?? []) as { name: string; kind: string }[])
    .filter(t => t.kind !== 'remedial').map(t => t.name);
  const regularByCanon = new Map(regularTerms.map(t => [canon(t), t]));

  // Original released grades: subjectCanon → term → GradeLike.
  const bySubject = new Map<string, { subject: string; byTerm: Record<string, GradeLike> }>();
  for (const r of (gradesRes.data ?? []) as Record<string, unknown>[]) {
    const t = regularByCanon.get(canon(r.grading_period));
    const subj = String(r.subject || '').trim();
    if (!t || !subj) continue;
    const e = bySubject.get(canon(subj)) ?? { subject: subj, byTerm: {} };
    e.byTerm[t] = rowToGrade(r);
    bySubject.set(canon(subj), e);
  }
  const originalPercent = (subjectCanon: string, termName: string): number | null => {
    const g = bySubject.get(subjectCanon)?.byTerm[termName];
    return g ? subjectPercent(g, cfg.markMaxes) : null;
  };

  const examName = cfg.remedial!.examMarkType || 'Exam';
  const carryName = cfg.remedial!.carryMarkType;
  const corrected = regularTerms.filter(t => entries.some(e => canon(e.for_period) === canon(t)));
  const markColumns = [...corrected, examName, ...(carryName ? [carryName] : [])];

  const subjects = entries.map(e => {
    const total = remedialTotal(Number(e.exam_value), Number(e.carry_value) || 0);
    const band = bandForPercent(total, cfg.bands);
    const forTerm = regularByCanon.get(canon(e.for_period)) ?? String(e.for_period || '');
    return {
      subject: String(e.subject || ''),
      components: markColumns.map(name => {
        if (name === examName) return { name, value: Number(e.exam_value) };
        if (carryName && name === carryName) return { name, value: Number(e.carry_value) || 0 };
        return { name, value: canon(name) === canon(forTerm) ? originalPercent(canon(e.subject), name) : null };
      }),
      percent: total,
      letter: band?.letter ?? null,
      adminNote: null,
    };
  });

  // Official year standing with retakes substituted, across ALL subjects.
  const remBySubject = new Map<string, Record<string, number | null>>();
  for (const e of entries) {
    const key = canon(e.subject);
    const m = remBySubject.get(key) ?? {};
    const t = regularByCanon.get(canon(e.for_period));
    if (t) m[t] = remedialTotal(Number(e.exam_value), Number(e.carry_value) || 0);
    remBySubject.set(key, m);
  }
  const finals: number[] = [];
  for (const [key, s] of bySubject.entries()) {
    const originalByTerm: Record<string, number | null> = {};
    for (const t of regularTerms) {
      originalByTerm[t] = s.byTerm[t] ? subjectPercent(s.byTerm[t], cfg.markMaxes) : null;
    }
    const { final } = subjectYear(regularTerms, originalByTerm, remBySubject.get(key) ?? {});
    if (final != null) finals.push(final);
  }

  const tpl = normalizeConfig(school.report_card_config);
  const cls = student.classes as { name?: string } | null;
  const remark = remarkRes.data;
  const data: ReportCardData = {
    school: { name: school.name as string, logoUrl: (school.logo_url as string | null) ?? null },
    student: {
      fullName: student.full_name as string,
      className: cls?.name ?? null,
      photoUrl: (student.profile_picture as string | null) ?? null,
      dateOfBirth: (student.date_of_birth as string | null) ?? null,
    },
    academicYear: year,
    term,
    generatedAt: new Date().toISOString(),
    showPercent: cfg.mode === 'scale' || cfg.mode === 'both',
    showGpa: cfg.mode === 'gpa' || cfg.mode === 'both',
    markColumns,
    subjects,
    overall: (() => {
      const avg = averagePercent(finals);
      return { averagePercent: avg, letter: bandForPercent(avg, cfg.bands)?.letter ?? null };
    })(),
    remarks: {
      homeroom: (remark?.homeroom_comment as string | null) ?? null,
      principal: (remark?.principal_comment as string | null) ?? null,
    },
    config: {
      classTeacher: tpl.signatories.classTeacher,
      principal: tpl.signatories.principal,
      headerNote: tpl.headerNote,
      footerNote: tpl.footerNote,
    },
  };
  const safeName = `${(student.full_name as string) || 'student'}-${year}-${term}`.replace(/[^a-z0-9-]/gi, '_');
  return { data, safeName, defaultLang: tpl.defaultLang, empty: entries.length === 0 };
}

async function streamCard(res: Response, built: { data: ReportCardData; safeName: string }, lang: ReturnType<typeof pickLang>): Promise<void> {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="report-card-${built.safeName}.pdf"`);
  try {
    await streamReportCardPdf(built.data, lang, res);
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: 'Failed to render the report card.' });
    else res.end();
    void e;
  }
}

// ── GET /admin/report-cards/student/:id/card.pdf?year=&term=&lang= ──────────
export async function getStudentPdf(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const studentId = req.params.id as string;
  const year = String(req.query.year || '').trim();
  const term = String(req.query.term || '').trim();
  if (!year || !term) { res.status(400).json({ error: 'year and term are required' }); return; }

  let built;
  try { built = await assembleReportCardData(schoolId, studentId, year, term); }
  catch (e) { const err = e as Parameters<typeof safeDbErrorStatus>[0]; res.status(safeDbErrorStatus(err)).json({ error: safeDbErrorMessage(err) }); return; }
  if (!built) { res.status(404).json({ error: 'Student not found.' }); return; }
  if (built.empty) { res.status(404).json({ error: 'No released Round Two marks for this student.' }); return; }

  await streamCard(res, built, pickLang(req.query.lang || built.defaultLang));
}

// ── GET /admin/report-cards/class/:classId/card.pdf?year=&term=&lang= ───────
// Bulk print stack: one combined PDF with a student per page for the whole
// class. Students with no released grades this term are skipped; 404 if none
// have any. Admin only. (Each student is assembled live — a class is bounded
// small, so the repeated school/config reads are acceptable for v1.)
export async function getClassPdf(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const classId = req.params.classId as string;
  const year = String(req.query.year || '').trim();
  const term = String(req.query.term || '').trim();
  if (!year || !term) { res.status(400).json({ error: 'year and term are required' }); return; }

  // Class must belong to this school; its name labels the download.
  const { data: klass, error: cErr } = await supabase
    .from('classes').select('name').eq('id', classId).eq('school_id', schoolId).maybeSingle();
  if (cErr) { res.status(safeDbErrorStatus(cErr)).json({ error: safeDbErrorMessage(cErr) }); return; }
  if (!klass) { res.status(404).json({ error: 'Class not found.' }); return; }

  const { data: students, error: sErr } = await supabase
    .from('students').select('id')
    .eq('school_id', schoolId).eq('class_id', classId).eq('is_graduated', false)
    .order('full_name');
  if (sErr) { res.status(safeDbErrorStatus(sErr)).json({ error: safeDbErrorMessage(sErr) }); return; }

  const cards: ReportCardData[] = [];
  let defaultLang = 'en';
  try {
    for (const s of (students ?? []) as Record<string, unknown>[]) {
      const built = await assembleReportCardData(schoolId, s.id as string, year, term);
      if (built && built.data.subjects.length > 0) { cards.push(built.data); defaultLang = built.defaultLang; }
    }
  } catch (e) {
    const err = e as Parameters<typeof safeDbErrorStatus>[0];
    res.status(safeDbErrorStatus(err)).json({ error: safeDbErrorMessage(err) }); return;
  }
  if (cards.length === 0) { res.status(404).json({ error: 'No released grades for this class and term.' }); return; }

  const safeClass = `${(klass.name as string) || 'class'}-${year}-${term}`.replace(/[^a-z0-9-]/gi, '_');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="report-cards-${safeClass}.pdf"`);
  try {
    await streamClassReportCardsPdf(cards, pickLang(req.query.lang || defaultLang), res);
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: 'Failed to render the report cards.' });
    else res.end();
    void e;
  }
}

// Shared assembly for the cumulative transcript: every RELEASED grade for a
// student across all years/terms, grouped by (year, term) and summarized.
// `publishedOnly` (parent path) keeps only (year, term) pairs the school has
// published. Returns null if the student isn't in this school. THROWS on DB error.
async function assembleTranscriptData(
  schoolId: string, studentId: string, opts: { publishedOnly: boolean },
): Promise<{ data: TranscriptData; safeName: string; defaultLang: string } | null> {
  const { data: school, error: schErr } = await supabase
    .from('schools').select('name, logo_url, report_card_config').eq('id', schoolId).single();
  if (schErr || !school) throw schErr ?? new Error('school not found');

  const { data: student, error: stuErr } = await supabase
    .from('students')
    .select('id, full_name, date_of_birth, is_graduated, classes(name)')
    .eq('id', studentId).eq('school_id', schoolId).maybeSingle();
  if (stuErr) throw stuErr;
  if (!student) return null;

  const { data: gradeRows, error: gErr } = await supabase
    .from('grades')
    .select('subject, marks, daily_grade, quiz_grade, monthly_exam_grade, term_exam_grade, academic_year, grading_period')
    .eq('school_id', schoolId)
    .eq('student_id', studentId)
    .eq('is_released', true);
  if (gErr) throw gErr;

  let publishedSet: Set<string> | null = null;
  if (opts.publishedOnly) {
    const { data: pub, error: pErr } = await supabase
      .from('report_card_publish').select('academic_year, term').eq('school_id', schoolId);
    if (pErr) throw pErr;
    publishedSet = new Set((pub ?? []).map((r: Record<string, unknown>) =>
      `${String(r.academic_year).toLowerCase().trim()}|||${String(r.term).toLowerCase().trim()}`));
  }

  const cfgGrading = await loadGradingConfig(supabase, schoolId);
  const canon = (s: unknown): string => String(s ?? '').trim().toLowerCase();

  // Term ordering + the remedial term (excluded from year columns — its data
  // arrives via remedial_grades and is substituted into the Round Two figures).
  const { data: termRows } = await supabase
    .from('terms').select('name, kind, order_index').eq('school_id', schoolId).order('order_index');
  const termOrder = new Map<string, number>();
  const remedialCanon = new Set<string>();
  for (const t of (termRows ?? []) as Record<string, unknown>[]) {
    termOrder.set(canon(t.name), Number(t.order_index) || 0);
    if (t.kind === 'remedial') remedialCanon.add(canon(t.name));
  }

  // Released + filed Round Two entries. Parent path: only visible once the
  // remedial term itself is published for that year (its own publish gate).
  const { data: remRows, error: remErr } = await supabase
    .from('remedial_grades')
    .select('subject, academic_year, for_period, exam_value, carry_value')
    .eq('school_id', schoolId).eq('student_id', studentId)
    .eq('is_released', true).not('exam_value', 'is', null);
  if (remErr) throw remErr;
  const remedialName = cfgGrading.remedial?.termName ?? null;
  const remedialVisible = (year: string): boolean =>
    !publishedSet || (remedialName != null && publishedSet.has(`${canon(year)}|||${canon(remedialName)}`));
  // year → subjectCanon → forPeriodCanon → total /100
  const remByYear = new Map<string, Map<string, Map<string, number>>>();
  for (const r of (remRows ?? []) as Record<string, unknown>[]) {
    const year = String(r.academic_year || '').trim();
    const total = remedialTotal(Number(r.exam_value), Number(r.carry_value) || 0);
    if (!year || total == null) continue;
    const bySubj = remByYear.get(canon(year)) ?? new Map<string, Map<string, number>>();
    const byTerm = bySubj.get(canon(r.subject)) ?? new Map<string, number>();
    byTerm.set(canon(r.for_period), total);
    bySubj.set(canon(r.subject), byTerm);
    remByYear.set(canon(year), bySubj);
  }

  // Group released grades: year → subjectCanon → per-term GradeLike.
  const byYear = new Map<string, Map<string, { subject: string; byTerm: Map<string, { term: string; g: GradeLike }> }>>();
  for (const r of (gradeRows ?? []) as Record<string, unknown>[]) {
    const year = String(r.academic_year || '').trim();
    const term = String(r.grading_period || '').trim();
    if (!year || !term) continue;
    if (remedialCanon.has(canon(term))) continue; // legacy rows under the remedial term never count
    if (publishedSet && !publishedSet.has(`${year.toLowerCase()}|||${term.toLowerCase()}`)) continue;
    const subj = String(r.subject || '').trim();
    if (!subj) continue;
    const subjMap = byYear.get(year) ?? new Map();
    const entry = subjMap.get(canon(subj)) ?? { subject: subj, byTerm: new Map() };
    entry.byTerm.set(canon(term), { term, g: rowToGrade(r) });
    subjMap.set(canon(subj), entry);
    byYear.set(year, subjMap);
  }

  // One block per year: subjects × terms grid + Round One / Round Two figures
  // (subject-first year math, remedial substituted) + the year average.
  const years: TranscriptYear[] = [];
  for (const [year, subjMap] of [...byYear.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const termSet = new Map<string, string>();
    for (const s of subjMap.values()) for (const [tc, tv] of s.byTerm) termSet.set(tc, tv.term);
    const terms = [...termSet.entries()]
      .sort((a, b) => (termOrder.get(a[0]) ?? 99) - (termOrder.get(b[0]) ?? 99) || a[1].localeCompare(b[1]))
      .map(([, display]) => display);

    const remForYear = remedialVisible(year) ? (remByYear.get(canon(year)) ?? new Map()) : new Map();
    const rows: TranscriptYearRow[] = [...subjMap.values()]
      .sort((a, b) => a.subject.localeCompare(b.subject))
      .map(s => {
        const originalByTerm: Record<string, number | null> = {};
        for (const term of terms) {
          const e = s.byTerm.get(canon(term));
          originalByTerm[term] = e ? subjectPercent(e.g, cfgGrading.markMaxes) : null;
        }
        const remedialByTerm: Record<string, number | null> = {};
        const rem = remForYear.get(canon(s.subject)) as Map<string, number> | undefined;
        if (rem) for (const term of terms) {
          const v = rem.get(canon(term));
          if (v != null) remedialByTerm[term] = v;
        }
        const { roundOne, final, satRemedial } = subjectYear(terms, originalByTerm, remedialByTerm);
        return {
          subject: s.subject,
          perTerm: terms.map(t => originalByTerm[t]),
          roundOne, final, satRemedial,
          letter: bandForPercent(final, cfgGrading.bands)?.letter ?? null,
        };
      });

    const yearAverage = averagePercent(rows.map(r => r.final).filter((v): v is number => v != null));
    years.push({
      academicYear: year,
      terms,
      rows,
      anyRoundTwo: rows.some(r => r.satRemedial),
      yearAverage,
      yearLetter: bandForPercent(yearAverage, cfgGrading.bands)?.letter ?? null,
    });
  }

  const tpl = normalizeConfig(school.report_card_config);
  const cls = student.classes as { name?: string } | null;
  const data: TranscriptData = {
    school: { name: school.name as string, logoUrl: (school.logo_url as string | null) ?? null },
    student: {
      fullName: student.full_name as string,
      className: cls?.name ?? null,
      dateOfBirth: (student.date_of_birth as string | null) ?? null,
      graduated: student.is_graduated === true,
    },
    generatedAt: new Date().toISOString(),
    showPercent: cfgGrading.mode === 'scale' || cfgGrading.mode === 'both',
    showGpa: cfgGrading.mode === 'gpa' || cfgGrading.mode === 'both',
    passPercent: cfgGrading.passPercent,
    years,
    config: {
      classTeacher: tpl.signatories.classTeacher,
      principal: tpl.signatories.principal,
      headerNote: tpl.headerNote,
      footerNote: tpl.footerNote,
    },
  };
  const safeName = `${(student.full_name as string) || 'student'}-transcript`.replace(/[^a-z0-9-]/gi, '_');
  return { data, safeName, defaultLang: tpl.defaultLang };
}

async function streamTranscript(res: Response, built: { data: TranscriptData; safeName: string }, lang: ReturnType<typeof pickLang>): Promise<void> {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="transcript-${built.safeName}.pdf"`);
  try {
    await streamTranscriptPdf(built.data, lang, res);
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: 'Failed to render the transcript.' });
    else res.end();
    void e;
  }
}

// ── GET /admin/report-cards/student/:id/transcript.pdf?lang= ────────────────
// Cumulative transcript across all released terms. Admin only; works for any
// student in the roster, including graduated (is_graduated=true).
export async function getStudentTranscript(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const studentId = req.params.id as string;
  let built;
  try { built = await assembleTranscriptData(schoolId, studentId, { publishedOnly: false }); }
  catch (e) { const err = e as Parameters<typeof safeDbErrorStatus>[0]; res.status(safeDbErrorStatus(err)).json({ error: safeDbErrorMessage(err) }); return; }
  if (!built) { res.status(404).json({ error: 'Student not found.' }); return; }
  await streamTranscript(res, built, pickLang(req.query.lang || built.defaultLang));
}

// ── GET /parent/children/:id/transcript.pdf?lang= ──────────────────────────
// Parent download of their child's cumulative transcript. Gated: ownership +
// PUBLISHED terms only (released grades enforced by the assembler).
export async function getParentChildTranscript(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const studentId = req.params.id as string;

  const parentId = await resolveParentId(userId, schoolId);
  if (!parentId) { res.status(404).json({ error: 'Student not found.' }); return; }
  const { data: owned, error: ownErr } = await supabase
    .from('students').select('id')
    .eq('id', studentId).eq('school_id', schoolId).eq('parent_id', parentId)
    .maybeSingle();
  if (ownErr) { res.status(safeDbErrorStatus(ownErr)).json({ error: safeDbErrorMessage(ownErr) }); return; }
  if (!owned) { res.status(404).json({ error: 'Student not found.' }); return; }

  let built;
  try { built = await assembleTranscriptData(schoolId, studentId, { publishedOnly: true }); }
  catch (e) { const err = e as Parameters<typeof safeDbErrorStatus>[0]; res.status(safeDbErrorStatus(err)).json({ error: safeDbErrorMessage(err) }); return; }
  if (!built) { res.status(404).json({ error: 'Student not found.' }); return; }
  await streamTranscript(res, built, pickLang(req.query.lang || built.defaultLang));
}

// ── POST /admin/report-cards/publish — make a term visible to parents ───────
export async function publishTerm(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const body = req.body as { academicYear: string; term: string };
  const { error } = await supabase
    .from('report_card_publish')
    .upsert(
      { school_id: schoolId, academic_year: body.academicYear, term: body.term, published_at: new Date().toISOString(), published_by: userId },
      { onConflict: 'school_id,academic_year,term' },
    );
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  await logAudit({
    req, entityType: 'report_card', entityId: schoolId, action: 'update',
    before: null, after: { published: true, academic_year: body.academicYear, term: body.term },
    label: 'Report cards published',
  });
  res.json({ published: true });
}

// ── DELETE /admin/report-cards/publish — hide a term from parents again ─────
export async function unpublishTerm(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const body = req.body as { academicYear: string; term: string };
  const { error } = await supabase
    .from('report_card_publish')
    .delete()
    .eq('school_id', schoolId)
    .eq('academic_year', body.academicYear)
    .eq('term', body.term);
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  await logAudit({
    req, entityType: 'report_card', entityId: schoolId, action: 'update',
    before: { published: true, academic_year: body.academicYear, term: body.term }, after: null,
    label: 'Report cards unpublished',
  });
  res.json({ published: false });
}

// Resolve the calling parent's row (school-scoped). null when not a parent here.
async function resolveParentId(userId: string, schoolId: string): Promise<string | null> {
  const { data } = await supabase
    .from('parents').select('id').eq('user_id', userId).eq('school_id', schoolId).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

// ── GET /parent/report-card-terms — published (year, term) list for the school ─
export async function getParentTerms(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { data, error } = await supabase
    .from('report_card_publish')
    .select('academic_year, term')
    .eq('school_id', schoolId);
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json({ terms: (data ?? []).map((r: Record<string, unknown>) => ({ academicYear: r.academic_year as string, term: r.term as string })) });
}

// ── GET /parent/children/:id/report-card.pdf?year=&term=&lang= ─────────────
// Parent download. Gated three ways: the child must be the caller's, the term
// must be PUBLISHED, and only RELEASED grades render (assemble enforces that).
export async function getParentChildPdf(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const studentId = req.params.id as string;
  const year = String(req.query.year || '').trim();
  const term = String(req.query.term || '').trim();
  if (!year || !term) { res.status(400).json({ error: 'year and term are required' }); return; }

  // Ownership: the student must belong to this parent at this school.
  const parentId = await resolveParentId(userId, schoolId);
  if (!parentId) { res.status(404).json({ error: 'Student not found.' }); return; }
  const { data: owned, error: ownErr } = await supabase
    .from('students').select('id')
    .eq('id', studentId).eq('school_id', schoolId).eq('parent_id', parentId)
    .maybeSingle();
  if (ownErr) { res.status(safeDbErrorStatus(ownErr)).json({ error: safeDbErrorMessage(ownErr) }); return; }
  if (!owned) { res.status(404).json({ error: 'Student not found.' }); return; }

  // Publish gate (case-insensitive — terms/years come from the same dropdowns
  // but tolerate case drift in legacy data).
  const { data: pub, error: pubErr } = await supabase
    .from('report_card_publish').select('id')
    .eq('school_id', schoolId).ilike('academic_year', year).ilike('term', term)
    .maybeSingle();
  if (pubErr) { res.status(safeDbErrorStatus(pubErr)).json({ error: safeDbErrorMessage(pubErr) }); return; }
  if (!pub) { res.status(403).json({ error: 'This report card has not been published yet.', code: 'NOT_PUBLISHED' }); return; }

  let built;
  try { built = await assembleReportCardData(schoolId, studentId, year, term); }
  catch (e) { const err = e as Parameters<typeof safeDbErrorStatus>[0]; res.status(safeDbErrorStatus(err)).json({ error: safeDbErrorMessage(err) }); return; }
  if (!built) { res.status(404).json({ error: 'Student not found.' }); return; }
  if (built.empty) { res.status(404).json({ error: 'No released Round Two marks for this student.' }); return; }

  await streamCard(res, built, pickLang(req.query.lang || built.defaultLang));
}
