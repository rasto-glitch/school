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

// A subject's percentage. If mark maxes are known, percent = earned / max * 100.
// Otherwise fall back to the raw total (assumed out of 100).
export function subjectPercent(g: GradeLike, markMaxes: Record<string, number>): number | null {
  if (g.marks && g.marks.length > 0) {
    let earned = 0, max = 0;
    for (const m of g.marks) {
      const mx = markMaxes[m.name];
      if (mx != null && mx > 0) { earned += Number(m.value) || 0; max += mx; }
    }
    if (max > 0) return Math.round((earned / max) * 1000) / 10;
    return g.marks.reduce((s, m) => s + (Number(m.value) || 0), 0);
  }
  const total = gradeTotal(g, getMarkNames(g));
  return total > 0 ? total : null;
}

// Map a percentage to the highest band whose minPercent it meets.
export function bandForPercent(percent: number | null, bands: GradeBand[]): GradeBand | null {
  if (percent == null || bands.length === 0) return null;
  const sorted = [...bands].sort((a, b) => b.minPercent - a.minPercent);
  for (const b of sorted) if (percent >= b.minPercent) return b;
  return null;
}

// Equal-weight average of grade points, rounded to 2 dp.
export function averageGpa(points: number[]): number | null {
  if (points.length === 0) return null;
  return Math.round((points.reduce((a, b) => a + b, 0) / points.length) * 100) / 100;
}

// Equal-weight average of subject percentages, rounded to 1 dp.
export function averagePercent(percents: number[]): number | null {
  if (percents.length === 0) return null;
  return Math.round((percents.reduce((a, b) => a + b, 0) / percents.length) * 10) / 10;
}

// Loads the school's grading config (mode + bands + mark maxes) — the same
// triple the /grade-config endpoint returns to the frontend.
export interface GradingConfig { mode: GradingMode; bands: GradeBand[]; markMaxes: Record<string, number> }
export async function loadGradingConfig(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  schoolId: string,
): Promise<GradingConfig> {
  const [schoolRes, bandsRes, marksRes] = await Promise.all([
    supabase.from('schools').select('grading_config').eq('id', schoolId).single(),
    supabase.from('grade_scale_bands').select('min_percent, letter, grade_point').eq('school_id', schoolId).order('order_index'),
    supabase.from('mark_types').select('name, max_value').eq('school_id', schoolId),
  ]);
  const mode: GradingMode = (schoolRes.data?.grading_config?.mode as GradingMode) || 'scale';
  const bands: GradeBand[] = (bandsRes.data || []).map((b: Record<string, unknown>) => ({
    minPercent: Number(b.min_percent), letter: String(b.letter), gradePoint: Number(b.grade_point),
  }));
  const markMaxes: Record<string, number> = {};
  for (const m of (marksRes.data || []) as Record<string, unknown>[]) {
    if (m.max_value != null) markMaxes[String(m.name)] = Number(m.max_value);
  }
  return { mode, bands, markMaxes };
}
