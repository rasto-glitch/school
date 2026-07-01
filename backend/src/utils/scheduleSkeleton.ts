// Schedule 2.0 day skeleton (migration 068). The ordered list of daily slots —
// each a LESSON (carries the period_index used by schedule_assignments) or a
// BREAK (recess/lunch/breakfast; rendered but never scheduled) — with start/end
// times. Same skeleton every working day. Stored on schools.schedule_config as
// { periods: DaySlot[] }; when empty the backend derives a default from
// periods_per_day so existing schools keep working until an admin edits it.

export interface LessonSlot { kind: 'lesson'; index: number; start: string; end: string }
export interface BreakSlot { kind: 'break'; label: string; start: string; end: string }
export type DaySlot = LessonSlot | BreakSlot;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function addMinutes(hhmm: string, mins: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + mins;
  const hh = Math.floor((total % (24 * 60)) / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// Default: N back-to-back 45-minute lessons from 08:00, no breaks. The admin
// then inserts breaks/lunch and adjusts times.
export function defaultSkeleton(periodsPerDay: number): DaySlot[] {
  const n = Math.max(1, Math.min(20, Math.floor(periodsPerDay || 6)));
  const slots: DaySlot[] = [];
  let t = '08:00';
  for (let i = 1; i <= n; i++) {
    const end = addMinutes(t, 45);
    slots.push({ kind: 'lesson', index: i, start: t, end });
    t = end;
  }
  return slots;
}

// Validate + normalise a raw skeleton. Lesson slots are re-indexed 1..N in
// order (so the period_index is always contiguous); malformed entries are
// dropped. Returns null if nothing valid survived.
export function normalizeSkeleton(raw: unknown): DaySlot[] | null {
  if (!Array.isArray(raw)) return null;
  const out: DaySlot[] = [];
  let lessonIdx = 0;
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const start = typeof o.start === 'string' && HHMM.test(o.start) ? o.start : '';
    const end = typeof o.end === 'string' && HHMM.test(o.end) ? o.end : '';
    if (!start || !end) continue;
    if (o.kind === 'break') {
      const label = typeof o.label === 'string' && o.label.trim() ? o.label.trim().slice(0, 40) : 'Break';
      out.push({ kind: 'break', label, start, end });
    } else {
      lessonIdx += 1;
      out.push({ kind: 'lesson', index: lessonIdx, start, end });
    }
  }
  return out.length ? out : null;
}

export function lessonCount(skeleton: DaySlot[]): number {
  return skeleton.filter(s => s.kind === 'lesson').length;
}

// Resolve a school's skeleton: its stored config, else a default sized to
// periods_per_day.
export function resolveSkeleton(scheduleConfig: unknown, periodsPerDay: number): DaySlot[] {
  const raw = (scheduleConfig as { periods?: unknown } | null | undefined)?.periods;
  return normalizeSkeleton(raw) ?? defaultSkeleton(periodsPerDay);
}
