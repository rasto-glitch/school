export interface Mark { name: string; value: number }

export interface GradeLike {
  marks?: Mark[] | null;
  dailyGrade?: number | null;
  quizGrade?: number | null;
  monthlyExamGrade?: number | null;
  termExamGrade?: number | null;
}

export function getMarkNames(g: GradeLike): string[] {
  if (g.marks && g.marks.length > 0) return g.marks.map(m => m.name);
  const legacy: string[] = [];
  if (g.dailyGrade)        legacy.push('Daily');
  if (g.quizGrade)         legacy.push('Quiz');
  if (g.monthlyExamGrade)  legacy.push('Monthly');
  if (g.termExamGrade)     legacy.push('Term Exam');
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

// Collect insertion-order-preserving mark names across a list of grades.
export function collectMarkNames(grades: GradeLike[]): string[] {
  const seen = new Map<string, true>();
  for (const g of grades) for (const n of getMarkNames(g)) seen.set(n, true);
  return Array.from(seen.keys());
}

// ── GPA grading ──────────────────────────────────────────────────────────
export type GradingMode = 'scale' | 'gpa' | 'both';
export interface GradeBand { minPercent: number; letter: string; gradePoint: number }
export interface GradingConfig { mode: GradingMode; bands: GradeBand[]; markMaxes: Record<string, number> }

// A subject's percentage. If mark maxes are known, percent = earned / max * 100.
// Otherwise fall back to the raw total (today's behavior — assumed out of 100).
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
