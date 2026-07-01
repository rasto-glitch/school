// ============================================================
// Timetable auto-generator (Schedule 2.0, Phase 3).
//
// Given the weekly demand (timetable_requirements → lesson instances), the day
// skeleton (lesson period indices × school days), teacher availability, and any
// locked/immovable lessons, place as many lessons as possible without breaking
// the HARD constraints:
//
//   • a teacher is in at most one place per (day, period)
//   • a class is in at most one place per (day, period)
//   • a room (when set) hosts at most one lesson per (day, period)
//   • a teacher is never placed in a blocked (unavailable) cell
//   • at most `maxPerDay` periods of the same (class, subject) on one day
//   • each teacher's weekly load = the sum of their requirements' periods
//     (we place exactly the demand — never more; immovable lessons count toward
//     it, so we top up the remainder)
//
// Approach: constructive search with the most-constrained-variable heuristic
// (place the lesson with the fewest legal cells next), a load-spreading tie-
// break (least-constraining value), and randomized restarts under a wall-clock
// budget. The best (max-placed) attempt wins. Lessons that cannot be placed are
// returned as `unplaced` with a reason — the admin then pins/adjusts and
// regenerates. Soft optimisation (no back-to-back, double periods, even gaps)
// is intentionally out of scope for v1.
//
// This module is PURE (no DB, no clock beyond Date.now for the budget) so it
// can be unit-smoke-tested in isolation.
// ============================================================

export interface SolverRequirement {
  id: string;
  classId: string;
  subjectId: string;
  teacherId: string | null;   // null → cannot be auto-placed (no teacher)
  roomId: string | null;      // already resolved (explicit or class home room)
  periodsPerWeek: number;
  maxPerDay: number;
}

export interface SolverLocked {
  classId: string;
  teacherId: string;
  subjectId: string | null;
  roomId: string | null;
  dayOfWeek: number;
  periodIndex: number;
}

export interface SolverInput {
  days: number[];             // day_of_week indices in use, e.g. [0,1,2,3,4]
  periods: number[];          // lesson period indices, e.g. [1,2,3,4,5,6,7]
  requirements: SolverRequirement[];
  immovable: SolverLocked[];  // pre-placed lessons that must not move
  unavailable: Set<string>;   // "teacherId:day:period" the teacher can't teach
  timeBudgetMs?: number;      // wall-clock cap (default 2500ms)
  seed?: number;              // RNG seed for reproducibility
}

export interface SolverPlacement {
  requirementId: string;
  classId: string;
  subjectId: string;
  teacherId: string;
  roomId: string | null;
  dayOfWeek: number;
  periodIndex: number;
}

export interface SolverUnplaced {
  requirementId: string;
  classId: string;
  subjectId: string;
  teacherId: string | null;
  count: number;              // how many periods of this requirement went unplaced
  reason: 'no_teacher' | 'no_free_slot';
}

export interface SolverResult {
  placements: SolverPlacement[];
  unplaced: SolverUnplaced[];
  demandCount: number;        // total lesson-periods that needed placing (excl. immovable)
  placedCount: number;
  fullyPlaced: boolean;
  attempts: number;
}

// One concrete lesson to place. `slot` <0 while unplaced.
interface Instance {
  reqId: string;
  classId: string;
  subjectId: string;
  teacherId: string;
  roomId: string | null;
  maxPerDay: number;
}

// Small deterministic PRNG so restarts differ but tests are stable.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cellKey = (id: string, d: number, p: number) => `${id}:${d}:${p}`;
const dayKey = (id: string, d: number) => `${id}:${d}`;

// A single greedy MRV construction. Returns the placements and which instances
// stayed unplaced. Mutates nothing outside its own scope.
function constructOnce(
  instances: Instance[],
  days: number[],
  periods: number[],
  immovable: SolverInput['immovable'],
  unavailable: Set<string>,
  rng: () => number,
  deadline: number,
): { placed: Array<{ inst: Instance; d: number; p: number }>; unplacedIdx: number[] } {
  const teacherBusy = new Set<string>();
  const classBusy = new Set<string>();
  const roomBusy = new Set<string>();
  const reqDay = new Map<string, number>();       // "reqId:day" → count (for maxPerDay)
  const classDay = new Map<string, number>();     // load-spread heuristic
  const teacherDay = new Map<string, number>();

  // Seed occupancy + per-req/day counts from the immovable lessons.
  for (const lk of immovable) {
    teacherBusy.add(cellKey(lk.teacherId, lk.dayOfWeek, lk.periodIndex));
    classBusy.add(cellKey(lk.classId, lk.dayOfWeek, lk.periodIndex));
    if (lk.roomId) roomBusy.add(cellKey(lk.roomId, lk.dayOfWeek, lk.periodIndex));
    classDay.set(dayKey(lk.classId, lk.dayOfWeek), (classDay.get(dayKey(lk.classId, lk.dayOfWeek)) || 0) + 1);
    teacherDay.set(dayKey(lk.teacherId, lk.dayOfWeek), (teacherDay.get(dayKey(lk.teacherId, lk.dayOfWeek)) || 0) + 1);
  }

  const isLegal = (inst: Instance, d: number, p: number): boolean => {
    if (unavailable.has(cellKey(inst.teacherId, d, p))) return false;
    if (teacherBusy.has(cellKey(inst.teacherId, d, p))) return false;
    if (classBusy.has(cellKey(inst.classId, d, p))) return false;
    if (inst.roomId && roomBusy.has(cellKey(inst.roomId, d, p))) return false;
    if ((reqDay.get(dayKey(inst.reqId, d)) || 0) >= inst.maxPerDay) return false;
    return true;
  };

  const countLegal = (inst: Instance): number => {
    let n = 0;
    for (const d of days) {
      if ((reqDay.get(dayKey(inst.reqId, d)) || 0) >= inst.maxPerDay) continue;
      for (const p of periods) if (isLegal(inst, d, p)) n++;
    }
    return n;
  };

  const remaining = new Set<number>(instances.map((_, i) => i));
  const placed: Array<{ inst: Instance; d: number; p: number }> = [];
  const unplacedIdx: number[] = [];

  while (remaining.size > 0) {
    if (Date.now() > deadline) { for (const i of remaining) unplacedIdx.push(i); break; }

    // Most-constrained variable: the remaining instance with the fewest legal
    // cells (0 → surfaces impossible lessons immediately).
    let bestIdx = -1;
    let bestCount = Infinity;
    for (const i of remaining) {
      const c = countLegal(instances[i]);
      if (c < bestCount || (c === bestCount && rng() < 0.5)) { bestCount = c; bestIdx = i; if (c === 0) break; }
    }

    const inst = instances[bestIdx];
    remaining.delete(bestIdx);

    if (bestCount === 0) { unplacedIdx.push(bestIdx); continue; }

    // Least-constraining value: pick the legal cell that keeps the class's and
    // teacher's daily load most balanced (spreads lessons across the week).
    let chosen: { d: number; p: number } | null = null;
    let chosenScore = Infinity;
    for (const d of days) {
      if ((reqDay.get(dayKey(inst.reqId, d)) || 0) >= inst.maxPerDay) continue;
      for (const p of periods) {
        if (!isLegal(inst, d, p)) continue;
        const score = (classDay.get(dayKey(inst.classId, d)) || 0)
          + (teacherDay.get(dayKey(inst.teacherId, d)) || 0)
          + rng() * 0.5;
        if (score < chosenScore) { chosenScore = score; chosen = { d, p }; }
      }
    }
    if (!chosen) { unplacedIdx.push(bestIdx); continue; }

    const { d, p } = chosen;
    teacherBusy.add(cellKey(inst.teacherId, d, p));
    classBusy.add(cellKey(inst.classId, d, p));
    if (inst.roomId) roomBusy.add(cellKey(inst.roomId, d, p));
    reqDay.set(dayKey(inst.reqId, d), (reqDay.get(dayKey(inst.reqId, d)) || 0) + 1);
    classDay.set(dayKey(inst.classId, d), (classDay.get(dayKey(inst.classId, d)) || 0) + 1);
    teacherDay.set(dayKey(inst.teacherId, d), (teacherDay.get(dayKey(inst.teacherId, d)) || 0) + 1);
    placed.push({ inst, d, p });
  }

  return { placed, unplacedIdx };
}

export function solveTimetable(input: SolverInput): SolverResult {
  const { days, periods, requirements, immovable, unavailable } = input;
  const budget = input.timeBudgetMs ?? 2500;
  const deadline = Date.now() + budget;

  // How many periods of each (class, subject) requirement are already satisfied
  // by immovable lessons — subtract those from the demand we still owe.
  const satisfied = new Map<string, number>();
  for (const lk of immovable) {
    if (lk.subjectId == null) continue;
    const k = `${lk.classId}:${lk.subjectId}`;
    satisfied.set(k, (satisfied.get(k) || 0) + 1);
  }

  // Expand requirements into concrete lesson instances (the remaining demand).
  const instances: Instance[] = [];
  const noTeacher: SolverUnplaced[] = [];
  let demandCount = 0;
  for (const r of requirements) {
    const already = satisfied.get(`${r.classId}:${r.subjectId}`) || 0;
    const need = Math.max(0, (r.periodsPerWeek || 0) - already);
    if (need === 0) continue;
    if (!r.teacherId) {
      noTeacher.push({ requirementId: r.id, classId: r.classId, subjectId: r.subjectId, teacherId: null, count: need, reason: 'no_teacher' });
      continue;
    }
    demandCount += need;
    for (let i = 0; i < need; i++) {
      instances.push({ reqId: r.id, classId: r.classId, subjectId: r.subjectId, teacherId: r.teacherId, roomId: r.roomId, maxPerDay: r.maxPerDay || 2 });
    }
  }

  // Randomized restarts — keep the attempt that places the most.
  let best: { placed: Array<{ inst: Instance; d: number; p: number }>; unplacedIdx: number[] } | null = null;
  let attempts = 0;
  let seed = (input.seed ?? 1) >>> 0;
  const hasWork = instances.length > 0 && days.length > 0 && periods.length > 0;
  while (hasWork && Date.now() < deadline) {
    attempts++;
    const rng = mulberry32(seed);
    seed = (seed + 0x9e3779b9) >>> 0;
    const res = constructOnce(instances, days, periods, immovable, unavailable, rng, deadline);
    if (!best || res.placed.length > best.placed.length) best = res;
    if (res.unplacedIdx.length === 0) break;   // full solution — stop early
    if (attempts >= 200) break;                // safety cap
  }

  const placements: SolverPlacement[] = (best?.placed ?? []).map(({ inst, d, p }) => ({
    requirementId: inst.reqId,
    classId: inst.classId,
    subjectId: inst.subjectId,
    teacherId: inst.teacherId,
    roomId: inst.roomId,
    dayOfWeek: d,
    periodIndex: p,
  }));

  // Aggregate the search's unplaced instances back up to per-requirement counts.
  const unplacedByReq = new Map<string, SolverUnplaced>();
  for (const idx of best?.unplacedIdx ?? []) {
    const inst = instances[idx];
    const existing = unplacedByReq.get(inst.reqId);
    if (existing) existing.count++;
    else unplacedByReq.set(inst.reqId, { requirementId: inst.reqId, classId: inst.classId, subjectId: inst.subjectId, teacherId: inst.teacherId, count: 1, reason: 'no_free_slot' });
  }

  const unplaced = [...noTeacher, ...unplacedByReq.values()];
  return {
    placements,
    unplaced,
    demandCount,
    placedCount: placements.length,
    fullyPlaced: placements.length === demandCount && noTeacher.length === 0,
    attempts,
  };
}
