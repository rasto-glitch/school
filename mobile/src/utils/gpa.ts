// GPA grading helpers (mirror of the web frontend/src/utils/marks.ts GPA bits).
export type GradingMode = 'scale' | 'gpa' | 'both';
export interface GradeBand { minPercent: number; letter: string; gradePoint: number }
export interface GradingConfig { mode: GradingMode; bands: GradeBand[]; markMaxes: Record<string, number> }

export const EMPTY_GRADING_CONFIG: GradingConfig = { mode: 'scale', bands: [], markMaxes: {} };

interface MarkLike { name: string; value: number | string }

// A subject's percentage. Uses mark maxes when known (earned / max * 100);
// otherwise falls back to the precomputed total (today's behavior).
export function subjectPercent(
  marks: MarkLike[] | undefined | null,
  total: number,
  markMaxes: Record<string, number>,
): number | null {
  if (marks && marks.length > 0) {
    let earned = 0, max = 0;
    for (const m of marks) {
      const mx = markMaxes[m.name];
      if (mx != null && mx > 0) { earned += Number(m.value) || 0; max += mx; }
    }
    if (max > 0) return Math.round((earned / max) * 1000) / 10;
  }
  return total > 0 ? total : null;
}

export function bandForPercent(percent: number | null, bands: GradeBand[]): GradeBand | null {
  if (percent == null || bands.length === 0) return null;
  const sorted = [...bands].sort((a, b) => b.minPercent - a.minPercent);
  for (const b of sorted) if (percent >= b.minPercent) return b;
  return null;
}

export function averageGpa(points: number[]): number | null {
  if (points.length === 0) return null;
  return Math.round((points.reduce((a, b) => a + b, 0) / points.length) * 100) / 100;
}
