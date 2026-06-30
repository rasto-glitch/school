import { Response } from 'express';
import type { AuthRequest } from '../middleware/auth';
import { adminDb as supabase } from '../utils/db';
import { safeDbErrorMessage, safeDbErrorStatus } from '../utils/dbErrors';
import { logAudit } from '../utils/audit';
import { pickLang } from '../utils/archivePdfShared';
import {
  rowToGrade, subjectPercent, bandForPercent, averageGpa, averagePercent,
  collectMarkNames, getMarkValue, loadGradingConfig, type GradeLike,
} from '../utils/gradeCalc';
import { streamReportCardPdf, type ReportCardData } from '../utils/reportCardPdf';

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
  if (!year || !term) { res.status(400).json({ error: 'year and term are required' }); return; }

  let sq = supabase.from('students')
    .select('id, full_name, class_id, classes(name)')
    .eq('school_id', schoolId)
    .eq('is_graduated', false)
    .order('full_name');
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
): Promise<{ data: ReportCardData; safeName: string; defaultLang: string } | null> {
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
  const points: number[] = [];
  const subjects = rows.map(r => {
    const g = asGrade(r);
    const pct = subjectPercent(g, cfgGrading.markMaxes);
    const band = bandForPercent(pct, cfgGrading.bands);
    if (pct != null) percents.push(pct);
    if (band) points.push(band.gradePoint);
    return {
      subject: String(r.subject || ''),
      components: markColumns.map(name => ({ name, value: getMarkValue(g, name) })),
      percent: pct,
      letter: band?.letter ?? null,
      gradePoint: band?.gradePoint ?? null,
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
    overall: { averagePercent: averagePercent(percents), gpa: averageGpa(points) },
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

  await streamCard(res, built, pickLang(req.query.lang || built.defaultLang));
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

  await streamCard(res, built, pickLang(req.query.lang || built.defaultLang));
}
