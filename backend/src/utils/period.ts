import { supabase } from '../config/supabase';

// Returns the closed period that contains `date` for this school, or null if
// the date is open. A period is "closed" when reopened_at IS NULL. The most
// recent matching period wins (overlapping ranges are blocked at insert time
// via UNIQUE (school_id, period_start, period_end), but a date could still
// fall in a single closed window — that's enough to block).
export async function findClosedPeriod(schoolId: string, date: string): Promise<{ id: string; periodStart: string; periodEnd: string } | null> {
  const { data, error } = await supabase
    .from('accounting_periods')
    .select('id, period_start, period_end')
    .eq('school_id', schoolId)
    .is('reopened_at', null)
    .lte('period_start', date)
    .gte('period_end', date)
    .order('period_start', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return { id: data.id, periodStart: data.period_start, periodEnd: data.period_end };
}

// Guard helper for controllers: returns { ok: false, error } if ANY of the
// supplied dates falls in a closed period. Use before INSERT/UPDATE/VOID.
// Pass both old and new dates on an update (so moving a payment INTO a closed
// period is also blocked).
export async function assertPeriodOpen(
  schoolId: string,
  dates: (string | null | undefined)[],
): Promise<{ ok: true } | { ok: false; status: 423; error: string }> {
  const set = Array.from(new Set(dates.filter((d): d is string => typeof d === 'string' && d.length > 0)));
  for (const d of set) {
    const closed = await findClosedPeriod(schoolId, d);
    if (closed) {
      return {
        ok: false,
        status: 423,
        error: `Accounting period ${closed.periodStart} → ${closed.periodEnd} is closed. Reopen it before editing entries in that range.`,
      };
    }
  }
  return { ok: true };
}
