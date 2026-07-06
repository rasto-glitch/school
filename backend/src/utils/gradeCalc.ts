// Backend mirror of frontend/src/utils/marks.ts — the SAME percentage / band /
// GPA math the parent Grades page and Grade Review already use, so a report-card
// PDF shows identical numbers. Keep the two in lockstep if either changes.

export interface Mark { name: string; value: number }

export interface GradeLike {
  marks?: Mark[] | null;
  dailyGrade?: number | null;
  quizGrade?: number | null;
  monthlyExamGrade?: number | null;
  termExamGrade?: number | null;
}

export interface GradeBand { minPercent: number; letter: string; gradePoint: number }
export type GradingMode = 'scale' | 'gpa' | 'both';

// Normalize a snake_case `grades` DB row into the GradeLike shape.
export function rowToGrade(r: Record<string, unknown>): GradeLike {
  const rawMarks = Array.isArray(r.marks) ? (r.marks as { name: string; value: unknown }[]) : [];
  const marks = rawMarks
    .filter(m => m && typeof m.name === 'string')
    .map(m => ({ name: m.name, value: Number(m.value) || 0 }));
  const num = (v: unknown): number | null => (v == null ? null : Number(v));
  return {
    marks,
    dailyGrade: num(r.daily_grade),
    quizGrade: num(r.quiz_grade),
    monthlyExamGrade: num(r.monthly_exam_grade),
    termExamGrade: num(r.term_exam_grade),
  };
}

export function getMarkNames(g: GradeLike): string[] {
  if (g.marks && g.marks.length > 0) return g.marks.map(m => m.name);
  const legacy: string[] = [];
  if (g.dailyGrade)       legacy.push('Daily');
  if (g.quizGrade)        legacy.push('Quiz');
  if (g.monthlyExamGrade) legacy.push('Monthly');
  if (g.termExamGrade)    legacy.push('Term Exam');
  return legacy;
}

export function getMarkValue(g: GradeLike, name: string): number | null {
  if (g.marks && g.marks.length > 0) {
    const m = g.marks.find(m => m.name === name);
    return m ? m.value : null;
  }
  if (name === 'Daily')     return g.dailyGrade ?? null;
  if (name === 'Quiz')      return g.quizGrade ?? null;
  if (name === 'Monthly')   return g.monthlyExamGrade ?? null;
  if (name === 'Term Exam') return g.termExamGrade ?? null;
  return null;
}

export function gradeTotal(g: GradeLike, markNames: string[]): number {
  if (g.marks && g.marks.length > 0) {
    return g.marks.reduce((s, m) => s + m.value, 0);
  }
  return markNames.reduce((s, name) => s + (getMarkValue(g, name) || 0), 0);
}

// Insertion-order-preserving mark names across a list of grades.
export function collectMarkNames(grades: GradeLike[]): string[] {
  const seen = new Map<string, true>();
  for (const g of grades) for (const n of getMarkNames(g)) seen.set(n, true);
  return Array.from(seen.keys());
}

// Rounds to 6 dp — kills float dust (49.999999999999996 → 50) WITHOUT the old
// 1-dp rounding that silently promoted 49.96 → 50.0 across a band cutoff.
// Banding / pass-fail / remedial eligibility all use these near-exact values;
// only displayPercent() below reduces precision, and it floors (CREDIT_MARKS_
// PLAN.md decision 5: no automatic rounding mercy — credits are the only way up).
const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;

// A subject's percentage. Normalizes (earned / max * 100) ONLY when every
// mark present has a configured max; if ANY mark can't be matched to a max,
// the whole subject falls back to the raw total (regional convention:
// components are designed to sum to the subject's total, typically 100).
// M-2 (audit): the old behavior dropped unmatched marks from both earned and
// max, silently discarding points a teacher entered — never do that.
// LOCKSTEP: mirror any change in frontend/src/utils/marks.ts and
// mobile/src/utils/gpa.ts.
export function subjectPercent(g: GradeLike, markMaxes: Record<string, number>): number | null {
  if (g.marks && g.marks.length > 0) {
    let earned = 0, max = 0, allConfigured = true;
    for (const m of g.marks) {
      earned += Number(m.value) || 0;
      const mx = markMaxes[m.name];
      if (mx != null && mx > 0) max += mx;
      else allConfigured = false;
    }
    if (allConfigured && max > 0) return round6((earned / max) * 100);
    return earned;
  }
  const total = gradeTotal(g, getMarkNames(g));
  return total > 0 ? total : null;
}

// Display form of a percent: FLOORED to 1 dp, so a failing 49.96 shows "49.9"
// and can never read as a pass the banding math didn't grant. LOCKSTEP ×3.
export function displayPercent(p: number | null): number | null {
  if (p == null) return null;
  return Math.floor(round6(p) * 10) / 10;
}

// ── Credit marks (نمرەی هاوکاری) — CREDIT_MARKS_PLAN.md ────────────────────
// Support marks the school allocates to a FAILING subject, capped so the
// effective value never exceeds the pass mark. Never mutates raw marks.
// LOCKSTEP ×3 (parent web + mobile apply the same math to their payloads).
export type CreditRound = 'round1' | 'round2';
export interface CreditAllocation { round: CreditRound; subject: string; amount: number }

export function creditFor(allocs: CreditAllocation[] | null | undefined, round: CreditRound, subject: string): number {
  if (!allocs?.length) return 0;
  const key = subject.trim().toLowerCase();
  let sum = 0;
  for (const a of allocs) {
    if (a.round === round && a.subject.trim().toLowerCase() === key) sum += Number(a.amount) || 0;
  }
  return sum;
}

// Effective value after credit: a passing value is untouched; a failing one
// rises by the credit but never past the pass mark (47 + 3 → 50, never 51).
export function applyCredit(value: number | null, credit: number | null | undefined, passPercent: number): number | null {
  if (value == null) return null;
  const c = Number(credit) || 0;
  if (c <= 0 || value >= passPercent) return value;
  return Math.min(passPercent, round6(value + c));
}

// Map a percentage to the highest band whose minPercent it meets. A percent
// below every threshold maps to the LOWEST band (the floor, e.g. F) rather
// than null — otherwise a failing subject is excluded from the GPA average
// entirely, inflating it (found alongside audit M-2). LOCKSTEP with web
// marks.ts and mobile gpa.ts.
export function bandForPercent(percent: number | null, bands: GradeBand[]): GradeBand | null {
  if (percent == null || bands.length === 0) return null;
  const sorted = [...bands].sort((a, b) => b.minPercent - a.minPercent);
  for (const b of sorted) if (percent >= b.minPercent) return b;
  return sorted[sorted.length - 1];
}

// Equal-weight average of grade points, rounded to 2 dp.
export function averageGpa(points: number[]): number | null {
  if (points.length === 0) return null;
  return Math.round((points.reduce((a, b) => a + b, 0) / points.length) * 100) / 100;
}

// Equal-weight average of subject percentages. Near-exact (6 dp) — the 1-dp
// rounding moved to displayPercent() so pass/fail decisions can't be swayed
// by display rounding.
export function averagePercent(percents: number[]): number | null {
  if (percents.length === 0) return null;
  return round6(percents.reduce((a, b) => a + b, 0) / percents.length);
}

// ── Year math: Round One / Round Two (REMEDIAL_TERM_PLAN.md P2) ─────────────
// LOCKSTEP: mirror any change in frontend/src/utils/marks.ts and
// mobile/src/utils/gpa.ts.

// A remedial entry's total out of 100: the teacher-entered exam mark plus the
// carried component auto-copied from the corrected term (the Remedial settings
// section guarantees the two maxes sum to exactly 100). Null until the exam
// mark is filed.
export function remedialTotal(examValue: number | null | undefined, carryValue: number | null | undefined): number | null {
  if (examValue == null) return null;
  return round6((Number(examValue) || 0) + (Number(carryValue) || 0));
}

export interface SubjectYear {
  // "تێکڕای خوولی یەکەم" — mean of the ORIGINAL percents across the regular
  // terms the subject appears in. This is the number that decides who sits
  // Round Two (the remedial exams).
  roundOne: number | null;
  // Effective standing: each term's remedial total substitutes that term's
  // original, then the same mean. Equals roundOne when no remedial was sat.
  final: number | null;
  // True when at least one remedial entry substituted into `final`.
  satRemedial: boolean;
}

// Per-subject year values. `originalByTerm` = subjectPercent per REGULAR term
// (null/absent = subject not graded that term — skipped, terms-present
// divisor). `remedialByTerm` = remedialTotal keyed by the CORRECTED term.
export function subjectYear(
  regularTerms: string[],
  originalByTerm: Record<string, number | null | undefined>,
  remedialByTerm: Record<string, number | null | undefined> = {},
): SubjectYear {
  const orig: number[] = [];
  const eff: number[] = [];
  let satRemedial = false;
  for (const term of regularTerms) {
    const o = originalByTerm[term];
    const r = remedialByTerm[term];
    if (o == null && r == null) continue;
    if (o != null) orig.push(o);
    if (r != null) { eff.push(r); satRemedial = true; }
    else if (o != null) eff.push(o);
  }
  return { roundOne: averagePercent(orig), final: averagePercent(eff), satRemedial };
}

// Terms this subject must be retaken for: graded AND below the pass mark.
// (A term the subject never ran is not "failed".) The Round Two gate itself
// is isFailing(roundOne) — a student only retakes anything when the Round One
// AVERAGE is below the pass mark; callers compose the two.
export function failedTerms(
  regularTerms: string[],
  originalByTerm: Record<string, number | null | undefined>,
  passPercent: number,
): string[] {
  return regularTerms.filter(t => {
    const o = originalByTerm[t];
    return o != null && o < passPercent;
  });
}

export function isFailing(value: number | null, passPercent: number): boolean {
  return value != null && value < passPercent;
}

// Loads the school's grading config (mode + bands + mark maxes + pass mark +
// remedial scheme) — the same shape the /grade-config endpoint returns to the
// frontend.
export interface RemedialConfig { termName: string; examMarkType: string | null; carryMarkType: string | null }
export interface GradingConfig {
  mode: GradingMode;
  bands: GradeBand[];
  markMaxes: Record<string, number>;
  passPercent: number;
  // Credit marks (نمرەی هاوکاری): per-round support-mark pool per student.
  // 0 = feature off for this school.
  creditPool: number;
  // Null until the school configures the Round Two term (075).
  remedial: RemedialConfig | null;
}
export async function loadGradingConfig(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  schoolId: string,
): Promise<GradingConfig> {
  const [schoolRes, bandsRes, marksRes, remTermRes] = await Promise.all([
    supabase.from('schools').select('grading_config').eq('id', schoolId).single(),
    supabase.from('grade_scale_bands').select('min_percent, letter, grade_point').eq('school_id', schoolId).order('order_index'),
    supabase.from('mark_types').select('name, max_value').eq('school_id', schoolId),
    supabase.from('terms').select('name').eq('school_id', schoolId).eq('kind', 'remedial').maybeSingle(),
  ]);
  const gc = schoolRes.data?.grading_config || {};
  const mode: GradingMode = (gc.mode as GradingMode) || 'scale';
  const bands: GradeBand[] = (bandsRes.data || []).map((b: Record<string, unknown>) => ({
    minPercent: Number(b.min_percent), letter: String(b.letter), gradePoint: Number(b.grade_point),
  }));
  const markMaxes: Record<string, number> = {};
  for (const m of (marksRes.data || []) as Record<string, unknown>[]) {
    if (m.max_value != null) markMaxes[String(m.name)] = Number(m.max_value);
  }
  const passPercent = Number(gc.passPercent) > 0 ? Number(gc.passPercent) : 50;
  const creditPool = Number(gc.creditMarks?.perRoundPool) > 0 ? Number(gc.creditMarks.perRoundPool) : 0;
  const remedial: RemedialConfig | null = remTermRes.data ? {
    termName: String(remTermRes.data.name),
    examMarkType: (gc.remedial?.examMarkType as string | undefined) ?? null,
    carryMarkType: (gc.remedial?.carryMarkType as string | undefined) ?? null,
  } : null;
  return { mode, bands, markMaxes, passPercent, creditPool, remedial };
}
