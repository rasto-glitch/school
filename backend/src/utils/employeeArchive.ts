// Shared employee-archive helpers. Used by admin.controller (teacher /
// driver / supervisor) and staff.controller (staff). Single source of truth
// for the archive feature gate + the reason vocabulary that the
// archived_employees.reason CHECK constraint enforces (migration 013).

import { supabase } from '../config/supabase';

// True iff this school has the historical-records feature enabled. Reused
// for both student and employee archives — toggling it off purges both.
export async function hasArchiveFeature(schoolId: string): Promise<boolean> {
  const { data } = await supabase
    .from('schools').select('features').eq('id', schoolId).single();
  return (data?.features as Record<string, boolean> | null)?.archive === true;
}

// Must stay in sync with the CHECK on archived_employees.reason.
export const EMPLOYEE_ARCHIVE_REASONS = ['resigned', 'terminated', 'contract_ended', 'retired', 'transferred', 'other'] as const;

export function normalizeArchiveReason(raw: unknown): string {
  const r = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return (EMPLOYEE_ARCHIVE_REASONS as readonly string[]).includes(r) ? r : 'other';
}
