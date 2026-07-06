// Credit marks (نمرەی هاوکاری) — CREDIT_MARKS_PLAN.md P2.
//
// The school allocates per-round support credits to a student's FAILING
// subjects, capped so the effective value never exceeds the pass mark and
// bounded by a per-round pool (grading_config.creditMarks.perRoundPool).
// Allocations are their own audited rows (grade_credit_allocations, 079) and
// never mutate the teacher's raw marks — every surface computes
// effective = raw + credit at read time.
//
//   round1 → the subject's Round One YEAR average (M-3b subject-first mean).
//            Lifting it to pass removes the subject from the remedial roster
//            (the roster syncs on read, so no explicit re-sync is needed).
//   round2 → the subject's year standing after remedial substitution.

import { Response } from 'express';
import { adminDb as supabase } from '../utils/db';
import type { AuthRequest } from '../middleware/auth';
import { safeDbErrorMessage, safeDbErrorStatus } from '../utils/dbErrors';
import { logAudit } from '../utils/audit';
import {
  loadGradingConfig, rowToGrade, subjectPercent, subjectYear, remedialTotal,
  applyCredit, isFailing, type GradeLike, type CreditRound,
} from '../utils/gradeCalc';
import { canonTerm } from '../utils/remedial';
import { resolveCurrentAcademicYear } from '../utils/studentEnrollments';

interface SubjectStanding {
  subject: string;
  roundOne: number | null;   // raw Round One year average (no credit)
  final: number | null;      // raw year standing after remedial substitution
  satRemedial: boolean;      // true → round2 credit is the one that applies
}

// Raw per-subject standings for a set of students in one year. Shared by the
// overview (whole class) and the allocation validator (one student).
async function loadStandings(
  schoolId: string,
  studentIds: string[],
  academicYear: string,
): Promise<Map<string, SubjectStanding[]>> {
  const result = new Map<string, SubjectStanding[]>();
  if (studentIds.length === 0) return result;

  const [{ data: termRows }, { data: gradeRows }, { data: remRows }] = await Promise.all([
    supabase.from('terms').select('name, kind').eq('school_id', schoolId).order('order_index'),
    supabase.from('grades')
      .select('student_id, subject, marks, daily_grade, quiz_grade, monthly_exam_grade, term_exam_grade, grading_period')
      .eq('school_id', schoolId).eq('academic_year', academicYear).in('student_id', studentIds),
    supabase.from('remedial_grades')
      .select('student_id, subject, for_period, exam_value, carry_value')
      .eq('school_id', schoolId).eq('academic_year', academicYear).in('student_id', studentIds),
  ]);
  const regularTerms = ((termRows || []) as { name: string; kind: string }[])
    .filter(t => t.kind !== 'remedial').map(t => t.name);
  const regularByCanon = new Map(regularTerms.map(t => [canonTerm(t), t]));
  const cfg = await loadGradingConfig(supabase, schoolId);

  // (student|subjectLower) → term → GradeLike, plus display names.
  const subjectDisplay = new Map<string, string>();
  const byKey = new Map<string, Record<string, GradeLike>>();
  const subjectsByStudent = new Map<string, Set<string>>();
  for (const r of (gradeRows || []) as Record<string, unknown>[]) {
    const subj = String(r.subject || '').trim();
    const term = regularByCanon.get(canonTerm(r.grading_period));
    if (!subj || !term) continue;
    subjectDisplay.set(subj.toLowerCase(), subjectDisplay.get(subj.toLowerCase()) || subj);
    const key = `${r.student_id}|${subj.toLowerCase()}`;
    const m = byKey.get(key) || {};
    m[term] = rowToGrade(r);
    byKey.set(key, m);
    const set = subjectsByStudent.get(String(r.student_id)) || new Set<string>();
    set.add(subj.toLowerCase());
    subjectsByStudent.set(String(r.student_id), set);
  }
  const remByKey = new Map<string, Record<string, unknown>[]>();
  for (const r of (remRows || []) as Record<string, unknown>[]) {
    const key = `${r.student_id}|${String(r.subject || '').trim().toLowerCase()}`;
    const arr = remByKey.get(key) || [];
    arr.push(r);
    remByKey.set(key, arr);
  }

  for (const sid of studentIds) {
    const standings: SubjectStanding[] = [];
    for (const sl of subjectsByStudent.get(sid) || []) {
      const subject = subjectDisplay.get(sl)!;
      const gradesByTerm = byKey.get(`${sid}|${sl}`) || {};
      const originalByTerm: Record<string, number | null> = {};
      for (const term of regularTerms) {
        originalByTerm[term] = gradesByTerm[term] ? subjectPercent(gradesByTerm[term], cfg.markMaxes) : null;
      }
      const remedialByTerm: Record<string, number | null> = {};
      for (const r of remByKey.get(`${sid}|${sl}`) || []) {
        const canon = regularByCanon.get(canonTerm(r.for_period));
        if (canon) remedialByTerm[canon] = remedialTotal(
          r.exam_value == null ? null : Number(r.exam_value), Number(r.carry_value) || 0,
        );
      }
      const { roundOne, final, satRemedial } = subjectYear(regularTerms, originalByTerm, remedialByTerm);
      standings.push({ subject, roundOne, final, satRemedial });
    }
    standings.sort((a, b) => a.subject.localeCompare(b.subject));
    result.set(sid, standings);
  }
  return result;
}

// ── GET /admin/credits/overview?classId=&year= ────────────────────────────
// Per-class review surface: every student's failing subjects per round with
// the deficit, existing allocations, and remaining pool.
export async function getCreditsOverview(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const classId = String(req.query.classId || '');
  const academicYear = String(req.query.year || '').trim() || await resolveCurrentAcademicYear(schoolId);
  if (!classId || !academicYear) { res.status(400).json({ error: 'classId and year are required' }); return; }

  const cfg = await loadGradingConfig(supabase, schoolId);
  const { data: students } = await supabase.from('students')
    .select('id, full_name').eq('school_id', schoolId).eq('class_id', classId).order('full_name');
  const studentIds = ((students || []) as { id: string }[]).map(s => s.id);
  const standings = await loadStandings(schoolId, studentIds, academicYear);
  const { data: allocs } = studentIds.length
    ? await supabase.from('grade_credit_allocations')
        .select('student_id, round, subject, amount, note')
        .eq('school_id', schoolId).eq('academic_year', academicYear).in('student_id', studentIds)
    : { data: [] };

  const allocsByStudent = new Map<string, { round: CreditRound; subject: string; amount: number; note: string | null }[]>();
  for (const a of (allocs || []) as Record<string, unknown>[]) {
    const arr = allocsByStudent.get(String(a.student_id)) || [];
    arr.push({ round: a.round as CreditRound, subject: String(a.subject), amount: Number(a.amount) || 0, note: (a.note as string | null) ?? null });
    allocsByStudent.set(String(a.student_id), arr);
  }

  res.json({
    pool: cfg.creditPool,
    passPercent: cfg.passPercent,
    academicYear,
    students: ((students || []) as { id: string; full_name: string }[]).map(s => {
      const rows = standings.get(s.id) || [];
      const mine = allocsByStudent.get(s.id) || [];
      const used = (round: CreditRound) => mine.filter(a => a.round === round).reduce((t, a) => t + a.amount, 0);
      return {
        studentId: s.id,
        fullName: s.full_name,
        subjects: rows.map(r => {
          const c1 = mine.filter(a => a.round === 'round1' && a.subject.toLowerCase() === r.subject.toLowerCase()).reduce((t, a) => t + a.amount, 0);
          const c2 = mine.filter(a => a.round === 'round2' && a.subject.toLowerCase() === r.subject.toLowerCase()).reduce((t, a) => t + a.amount, 0);
          return {
            subject: r.subject,
            roundOne: r.roundOne,
            roundOneCredit: c1,
            roundOneEffective: applyCredit(r.roundOne, c1, cfg.passPercent),
            final: r.final,
            satRemedial: r.satRemedial,
            finalCredit: c2,
            finalEffective: applyCredit(r.final, c2, cfg.passPercent),
          };
        }),
        allocations: mine,
        remaining: {
          round1: Math.max(0, cfg.creditPool - used('round1')),
          round2: Math.max(0, cfg.creditPool - used('round2')),
        },
      };
    }),
  });
}

// ── PUT /admin/credits ─────────────────────────────────────────────────────
// Upserts one (student, year, round, subject) allocation; amount 0 removes
// it. Validates: feature on, subject failing in that round, capped to pass,
// within the remaining per-round pool. Audited.
export async function setCreditAllocation(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId, username } = req.user!;
  const { studentId, academicYear, round, subject, amount, note } = req.body as {
    studentId: string; academicYear: string; round: CreditRound; subject: string;
    amount: number; note?: string | null;
  };

  const cfg = await loadGradingConfig(supabase, schoolId);
  if (!(cfg.creditPool > 0)) {
    res.status(409).json({ error: 'Credit marks are not enabled for this school. Set the per-round pool in the grading settings first.' });
    return;
  }
  const { data: student } = await supabase.from('students')
    .select('id, full_name').eq('id', studentId).eq('school_id', schoolId).maybeSingle();
  if (!student) { res.status(404).json({ error: 'Student not found' }); return; }

  const cleanAmount = Math.round(Number(amount) * 100) / 100;

  // Removal path — no failing/pool checks needed to take credit away.
  if (cleanAmount === 0) {
    const { data: existing } = await supabase.from('grade_credit_allocations')
      .select('id, amount').eq('school_id', schoolId).eq('student_id', studentId)
      .eq('academic_year', academicYear).eq('round', round).eq('subject', subject).maybeSingle();
    if (existing) {
      await supabase.from('grade_credit_allocations').delete().eq('id', existing.id).eq('school_id', schoolId);
      await logAudit({
        req, entityType: 'grade_credit', entityId: String(existing.id), action: 'delete',
        before: { student_id: studentId, academic_year: academicYear, round, subject, amount: existing.amount },
        label: (student as { full_name: string }).full_name,
        reason: `Credit removed (${round}, ${subject})`,
      });
    }
    res.json({ ok: true, removed: true });
    return;
  }

  // The subject must be FAILING in that round (before this allocation), and
  // the credit may only close the gap to the pass mark — never overshoot.
  const standings = await loadStandings(schoolId, [studentId], academicYear);
  const row = (standings.get(studentId) || []).find(r => r.subject.trim().toLowerCase() === subject.trim().toLowerCase());
  if (round === 'round2' && !row?.satRemedial) {
    res.status(400).json({ error: `${subject} has no filed Round Two retakes in ${academicYear} — a round2 credit would apply to nothing.` });
    return;
  }
  const rawValue = round === 'round1' ? (row?.roundOne ?? null) : (row?.final ?? null);
  if (rawValue == null) { res.status(400).json({ error: `No ${round === 'round1' ? 'Round One' : 'Round Two'} value exists for ${subject} in ${academicYear}.` }); return; }
  if (!isFailing(rawValue, cfg.passPercent)) {
    res.status(400).json({ error: `${subject} is not failing (${rawValue.toFixed(1)} ≥ ${cfg.passPercent}) — credit applies to failing subjects only.` });
    return;
  }
  const deficit = Math.ceil((cfg.passPercent - rawValue) * 100) / 100;
  if (cleanAmount > deficit) {
    res.status(400).json({ error: `${cleanAmount} exceeds the ${deficit} needed to reach the pass mark — credit is capped to pass.` });
    return;
  }

  // Per-round pool: sum of the student's OTHER allocations in this round.
  const { data: others } = await supabase.from('grade_credit_allocations')
    .select('id, subject, amount').eq('school_id', schoolId).eq('student_id', studentId)
    .eq('academic_year', academicYear).eq('round', round);
  const existing = (others || []).find((a: Record<string, unknown>) => String(a.subject).trim().toLowerCase() === subject.trim().toLowerCase());
  const usedElsewhere = (others || [])
    .filter((a: Record<string, unknown>) => a !== existing)
    .reduce((t: number, a: Record<string, unknown>) => t + (Number(a.amount) || 0), 0);
  if (usedElsewhere + cleanAmount > cfg.creditPool) {
    res.status(400).json({
      error: `Pool exceeded: ${usedElsewhere} of ${cfg.creditPool} already allocated in this round — only ${Math.max(0, cfg.creditPool - usedElsewhere)} left.`,
    });
    return;
  }

  const { data: saved, error } = await supabase.from('grade_credit_allocations').upsert({
    school_id: schoolId, student_id: studentId, academic_year: academicYear,
    round, subject, amount: cleanAmount, note: note?.trim() || null,
    granted_by: userId, granted_by_name: username, granted_at: new Date().toISOString(),
  }, { onConflict: 'school_id,student_id,academic_year,round,subject' }).select().single();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  await logAudit({
    req, entityType: 'grade_credit', entityId: String((saved as { id: string }).id), action: existing ? 'update' : 'create',
    before: existing ? { amount: (existing as Record<string, unknown>).amount } : null,
    after: { student_id: studentId, academic_year: academicYear, round, subject, amount: cleanAmount },
    label: (student as { full_name: string }).full_name,
    reason: `Credit ${existing ? 'updated' : 'granted'} (${round}, ${subject}: +${cleanAmount})`,
  });

  res.json({
    ok: true,
    allocation: { round, subject, amount: cleanAmount },
    effective: applyCredit(rawValue, cleanAmount, cfg.passPercent),
  });
}
