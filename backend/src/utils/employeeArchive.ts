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

// Validate a rehire link: the archive row must belong to this school AND
// match the role being created. Lenient — an unknown/cross-tenant id just
// yields null (link not set) rather than blocking the hire.
export async function resolveEmployeeArchiveId(
  previousArchiveId: unknown,
  schoolId: string,
  role: 'teacher' | 'driver' | 'supervisor' | 'staff' | 'admin',
): Promise<string | null> {
  if (!previousArchiveId || typeof previousArchiveId !== 'string') return null;
  const { data } = await supabase
    .from('archived_employees')
    .select('id')
    .eq('id', previousArchiveId)
    .eq('school_id', schoolId)
    .eq('role', role)
    .single();
  return data ? previousArchiveId : null;
}

// Wave 2: when an employee is archived, the polymorphic Wave-1 + Wave-2
// tables (employee_documents / employee_extended_profile /
// employee_emergency_contacts / employee_acknowledgements /
// employee_actions) need their owner_type + owner_id rewritten so the
// records survive the users/teachers/drivers/staff_members cascade and
// stay attached to the archive row. This is the single source of truth
// for that rewrite — called from every archive path (deleteTeacher /
// deleteDriver / deleteAccount in admin.controller, deleteStaff in
// staff.controller, the terminate flow in employeeTermination.controller).
//
// The pre-archive owner is one of: teachers | drivers | staff_members |
// users. fromOwnerId is the row id in that table (i.e. teachers.id for
// teachers/drivers/staff, users.id for the bare account roles).
export async function rewriteOwnershipToArchive(
  schoolId: string,
  fromOwnerType: 'teachers' | 'drivers' | 'staff_members' | 'users',
  fromOwnerId: string,
  archivedEmployeeId: string,
): Promise<void> {
  const tables = [
    'employee_documents',
    'employee_extended_profile',
    'employee_emergency_contacts',
    'employee_acknowledgements',
    'employee_actions',
  ] as const;
  const newOwner = { owner_type: 'archived_employees', owner_id: archivedEmployeeId };
  // Best-effort per-table update. Each table is school-scoped, so a
  // failure on one (e.g. table doesn't exist on an older DB before
  // migration 029 has run) shouldn't block the archive — the older flow
  // continues to work, just without the rewrite for that table.
  await Promise.all(tables.map(async t => {
    await supabase
      .from(t).update(newOwner)
      .eq('school_id', schoolId)
      .eq('owner_type', fromOwnerType)
      .eq('owner_id', fromOwnerId);
  }));
}
