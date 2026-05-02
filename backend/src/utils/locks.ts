import { supabase } from '../config/supabase';

export type LockableFeature = 'grades' | 'reports';
export const LOCKABLE_FEATURES: readonly LockableFeature[] = ['grades', 'reports'] as const;

// Returns student_id -> Set<feature> for the given students. Empty Set if no lock.
export async function getLocksForStudents(studentIds: string[]): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>();
  if (studentIds.length === 0) return map;
  const { data } = await supabase
    .from('student_access_locks')
    .select('student_id, feature')
    .in('student_id', studentIds);
  for (const row of (data ?? []) as { student_id: string; feature: string }[]) {
    const set = map.get(row.student_id) ?? new Set<string>();
    set.add(row.feature);
    map.set(row.student_id, set);
  }
  return map;
}

export async function isFeatureLocked(
  studentId: string,
  feature: LockableFeature,
): Promise<{ locked: boolean; reason: string | null }> {
  const { data } = await supabase
    .from('student_access_locks')
    .select('reason')
    .eq('student_id', studentId)
    .eq('feature', feature)
    .maybeSingle();
  if (data) return { locked: true, reason: (data as { reason: string | null }).reason ?? null };
  return { locked: false, reason: null };
}
