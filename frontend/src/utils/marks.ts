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
