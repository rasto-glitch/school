// Remedial (Round Two) roster sync — REMEDIAL_TERM_PLAN.md P3/P4.
//
// One entry per (student, subject, year, failed regular term) for every
// student whose Round One average (mean of ORIGINAL term percents) is below
// the school's pass mark. The sync is idempotent and runs on read:
//   - missing entries are inserted with the carried mark auto-copied from the
//     corrected term's grade row (missing source mark → 0 + carry_missing);
//   - unfiled carries are refreshed when the source grade changes; a filed
//     exam freezes its entry;
//   - unfiled entries whose student no longer fails are deleted; filed ones
//     stay visible so the record is honest.
// Shared by the teacher roster (one subject) and the admin overview (whole
// class), so the remedial list exists regardless of who opens it first.

import {
  type GradingConfig, type GradeLike, type CreditAllocation, rowToGrade, subjectPercent, subjectYear,
  failedTerms, isFailing, getMarkValue, remedialTotal, creditFor, applyCredit,
} from './gradeCalc';

export const canonTerm = (s: unknown): string => String(s ?? '').trim().toLowerCase();

export interface RemedialEntry {
  id: string;
  studentId: string;
  studentName: string;
  subject: string;
  forPeriod: string;
  // Round One average for this student+subject (originals only, no credit).
  roundOne: number | null;
  // Credit marks (079): round1 support credit on this subject + the effective
  // Round One after it — the number the retake decision actually uses.
  roundOneCredit: number;
  roundOneEffective: number | null;
  // Current effective standing: filed remedial totals substituted per term.
  final: number | null;
  // round2 support credit on this subject + the year standing after it.
  finalCredit: number;
  finalEffective: number | null;
  carryName: string | null;
  carryValue: number;
  carryMissing: boolean;
  examValue: number | null;
  isReleased: boolean;
}

export interface RemedialRosterResult {
  termName: string;
  examMax: number;
  carryMarkType: string | null;
  passPercent: number;
  entries: RemedialEntry[];
}

// Sync + return the Round Two roster for one class (optionally narrowed to
// one subject) in one academic year. Caller must have verified the remedial
// config exists (cfg.remedial?.examMarkType).
export async function syncClassRemedial(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  schoolId: string,
  classId: string,
  academicYear: string,
  cfg: GradingConfig,
  opts: { subject?: string } = {},
): Promise<RemedialRosterResult> {
  const remedial = cfg.remedial!;
  const examMax = cfg.markMaxes[remedial.examMarkType || ''] ?? 0;
  const carryName = remedial.carryMarkType;
  const base: RemedialRosterResult = {
    termName: remedial.termName, examMax, carryMarkType: carryName, passPercent: cfg.passPercent, entries: [],
  };

  const { data: termRows } = await db.from('terms')
    .select('name, kind').eq('school_id', schoolId).order('order_index');
  const regularTerms = ((termRows || []) as { name: string; kind: string }[])
    .filter(t => t.kind !== 'remedial').map(t => t.name);
  const regularByCanon = new Map(regularTerms.map(t => [canonTerm(t), t]));

  const { data: students } = await db.from('students')
    .select('id, full_name').eq('school_id', schoolId).eq('class_id', classId).order('full_name');
  const studentIds = ((students || []) as { id: string }[]).map(s => s.id);
  if (studentIds.length === 0 || regularTerms.length === 0) return base;

  let gradesQ = db.from('grades')
    .select('student_id, subject, marks, daily_grade, quiz_grade, monthly_exam_grade, term_exam_grade, grading_period')
    .eq('school_id', schoolId).eq('academic_year', academicYear).in('student_id', studentIds);
  let remQ = db.from('remedial_grades').select('*')
    .eq('school_id', schoolId).eq('academic_year', academicYear).in('student_id', studentIds);
  if (opts.subject) {
    gradesQ = gradesQ.eq('subject', opts.subject);
    remQ = remQ.eq('subject', opts.subject);
  }
  // Credit marks (079): round1 credits change WHO retakes (the gate below
  // uses the effective Round One); round2 credits change the final standing.
  const creditQ = db.from('grade_credit_allocations')
    .select('student_id, round, subject, amount')
    .eq('school_id', schoolId).eq('academic_year', academicYear).in('student_id', studentIds);
  const [gradesRes, remRes, creditRes] = await Promise.all([gradesQ, remQ, creditQ]);
  const creditsByStudent = new Map<string, CreditAllocation[]>();
  for (const r of (creditRes.data || []) as Record<string, unknown>[]) {
    const arr = creditsByStudent.get(String(r.student_id)) || [];
    arr.push({ round: r.round as CreditAllocation['round'], subject: String(r.subject), amount: Number(r.amount) || 0 });
    creditsByStudent.set(String(r.student_id), arr);
  }

  // (student, canonical subject) → term → GradeLike; remember display names.
  const subjectDisplay = new Map<string, string>();
  const byKey = new Map<string, Record<string, GradeLike>>();
  for (const r of (gradesRes.data || []) as Record<string, unknown>[]) {
    const subj = String(r.subject || '').trim();
    const term = regularByCanon.get(canonTerm(r.grading_period));
    if (!subj || !term) continue;
    if (!subjectDisplay.has(subj.toLowerCase())) subjectDisplay.set(subj.toLowerCase(), subj);
    const key = `${r.student_id}|${subj.toLowerCase()}`;
    const m = byKey.get(key) || {};
    m[term] = rowToGrade(r);
    byKey.set(key, m);
  }
  const remRows = (remRes.data || []) as Record<string, unknown>[];
  for (const r of remRows) {
    const subj = String(r.subject || '').trim();
    if (subj && !subjectDisplay.has(subj.toLowerCase())) subjectDisplay.set(subj.toLowerCase(), subj);
  }
  const remByKey = new Map<string, Record<string, unknown>[]>();
  for (const r of remRows) {
    const key = `${r.student_id}|${String(r.subject || '').trim().toLowerCase()}`;
    const arr = remByKey.get(key) || [];
    arr.push(r);
    remByKey.set(key, arr);
  }

  const entries: RemedialEntry[] = [];
  const inserts: Record<string, unknown>[] = [];
  const carryUpdates: { id: string; carry_value: number; carry_missing: boolean }[] = [];
  const staleIds: string[] = [];

  const subjects = opts.subject
    ? [opts.subject]
    : [...subjectDisplay.values()].sort((a, b) => a.localeCompare(b));

  for (const st of (students || []) as { id: string; full_name: string }[]) {
    for (const subject of subjects) {
      const key = `${st.id}|${subject.toLowerCase()}`;
      const gradesByTerm = byKey.get(key) || {};
      const existingRows = remByKey.get(key) || [];
      if (Object.keys(gradesByTerm).length === 0 && existingRows.length === 0) continue;

      const originalByTerm: Record<string, number | null> = {};
      for (const term of regularTerms) {
        originalByTerm[term] = gradesByTerm[term] ? subjectPercent(gradesByTerm[term], cfg.markMaxes) : null;
      }
      const { roundOne } = subjectYear(regularTerms, originalByTerm);
      // Credit gate: a round1 credit that lifts the subject to pass removes
      // it from Round Two entirely (its unfiled entries go stale below).
      const roundOneCredit = creditFor(creditsByStudent.get(st.id), 'round1', subject);
      const roundOneEffective = applyCredit(roundOne, roundOneCredit, cfg.passPercent);
      const retakes = isFailing(roundOneEffective, cfg.passPercent)
        ? failedTerms(regularTerms, originalByTerm, cfg.passPercent)
        : [];
      const retakeSet = new Set(retakes.map(canonTerm));
      const existingByPeriod = new Map(existingRows.map(r => [canonTerm(r.for_period), r]));
      const subjectEntries: RemedialEntry[] = [];

      for (const term of retakes) {
        let carryValue = 0, carryMissing = false;
        if (carryName) {
          const v = gradesByTerm[term] ? getMarkValue(gradesByTerm[term], carryName) : null;
          if (v == null) carryMissing = true;
          else carryValue = Number(v) || 0;
        }
        const existing = existingByPeriod.get(canonTerm(term));
        if (!existing) {
          inserts.push({
            school_id: schoolId, student_id: st.id, class_id: classId, subject,
            academic_year: academicYear, for_period: term,
            carry_name: carryName, carry_value: carryValue, carry_missing: carryMissing,
          });
          subjectEntries.push({
            id: '', studentId: st.id, studentName: st.full_name, subject, forPeriod: term,
            roundOne, roundOneCredit, roundOneEffective, final: null, finalCredit: 0, finalEffective: null,
            carryName, carryValue, carryMissing, examValue: null, isReleased: false,
          });
        } else {
          if (existing.exam_value == null
            && (Number(existing.carry_value) !== carryValue || Boolean(existing.carry_missing) !== carryMissing)) {
            carryUpdates.push({ id: String(existing.id), carry_value: carryValue, carry_missing: carryMissing });
            existing.carry_value = carryValue;
            existing.carry_missing = carryMissing;
          }
          subjectEntries.push({
            id: String(existing.id), studentId: st.id, studentName: st.full_name, subject, forPeriod: term,
            roundOne, roundOneCredit, roundOneEffective, final: null, finalCredit: 0, finalEffective: null,
            carryName: (existing.carry_name as string | null) ?? carryName,
            carryValue: Number(existing.carry_value) || 0,
            carryMissing: Boolean(existing.carry_missing),
            examValue: existing.exam_value == null ? null : Number(existing.exam_value),
            isReleased: Boolean(existing.is_released),
          });
        }
      }

      for (const r of existingRows) {
        if (retakeSet.has(canonTerm(r.for_period))) continue;
        if (r.exam_value != null) {
          // Filed but no longer required — keep it visible.
          subjectEntries.push({
            id: String(r.id), studentId: st.id, studentName: st.full_name, subject,
            forPeriod: String(r.for_period), roundOne, roundOneCredit, roundOneEffective,
            final: null, finalCredit: 0, finalEffective: null,
            carryName: (r.carry_name as string | null) ?? null,
            carryValue: Number(r.carry_value) || 0,
            carryMissing: Boolean(r.carry_missing),
            examValue: Number(r.exam_value),
            isReleased: Boolean(r.is_released),
          });
        } else {
          staleIds.push(String(r.id));
        }
      }

      // Effective standing with the filed retakes substituted in; a round2
      // credit then lifts the subject's year standing (capped at pass).
      const remedialByTerm: Record<string, number | null> = {};
      for (const e of subjectEntries) {
        const canon = regularByCanon.get(canonTerm(e.forPeriod));
        if (canon) remedialByTerm[canon] = remedialTotal(e.examValue, e.carryValue);
      }
      const { final } = subjectYear(regularTerms, originalByTerm, remedialByTerm);
      const finalCredit = creditFor(creditsByStudent.get(st.id), 'round2', subject);
      const finalEffective = applyCredit(final, finalCredit, cfg.passPercent);
      for (const e of subjectEntries) { e.final = final; e.finalCredit = finalCredit; e.finalEffective = finalEffective; }
      entries.push(...subjectEntries);
    }
  }

  if (inserts.length > 0) {
    // tenant-check-allow: every row sets school_id: schoolId (insert can't chain .eq)
    const { data: created, error } = await db.from('remedial_grades')
      .insert(inserts).select('id, student_id, subject, for_period');
    if (error) throw error;
    const idByKey = new Map(((created || []) as Record<string, unknown>[])
      .map(r => [`${r.student_id}|${String(r.subject || '').trim().toLowerCase()}|${canonTerm(r.for_period)}`, String(r.id)]));
    for (const e of entries) {
      if (!e.id) e.id = idByKey.get(`${e.studentId}|${e.subject.toLowerCase()}|${canonTerm(e.forPeriod)}`) || '';
    }
  }
  for (const u of carryUpdates) {
    await db.from('remedial_grades')
      .update({ carry_value: u.carry_value, carry_missing: u.carry_missing })
      .eq('id', u.id).eq('school_id', schoolId);
  }
  if (staleIds.length > 0) {
    await db.from('remedial_grades').delete().in('id', staleIds).eq('school_id', schoolId);
  }

  const termOrder = new Map(regularTerms.map((t, i) => [canonTerm(t), i]));
  entries.sort((a, b) => a.studentName.localeCompare(b.studentName)
    || a.subject.localeCompare(b.subject)
    || (termOrder.get(canonTerm(a.forPeriod)) ?? 99) - (termOrder.get(canonTerm(b.forPeriod)) ?? 99));

  return { ...base, entries };
}
