// Attendance helpers — daily lock policy + yearly aggregates.
//
// Phase A — daily lock. At midnight in the school's timezone, that
// calendar day's attendance is frozen. Teachers can no longer write to
// it. Supervisors can still edit existing rows and create new ones for
// the locked day, but every override is recorded in the audit log.
//
// Phase B — yearly aggregates. When a per-year enrollment row closes
// (status transitions out of 'enrolled'), we freeze a { present, absent,
// late, excused } count onto student_enrollments.attendance_totals so
// the per-year record survives the live attendance rows (which cascade
// when a student is deleted). Gated by the archive feature; archive-off
// schools never set the totals.
//
// The school's timezone lives on `schools.timezone` (default 'Asia/Baghdad';
// see migration 030 and database/schema.sql).

import { supabase } from '../config/supabase';
import { hasArchiveFeature } from './employeeArchive';

const tzCache = new Map<string, { tz: string; at: number }>();
const TZ_CACHE_MS = 5 * 60 * 1000;

export async function getSchoolTimezone(schoolId: string): Promise<string> {
  const hit = tzCache.get(schoolId);
  if (hit && Date.now() - hit.at < TZ_CACHE_MS) return hit.tz;
  const { data } = await supabase
    .from('schools').select('timezone').eq('id', schoolId).single();
  const tz = (data as { timezone?: string } | null)?.timezone || 'Asia/Baghdad';
  tzCache.set(schoolId, { tz, at: Date.now() });
  return tz;
}

// Returns YYYY-MM-DD for "today" in the school's timezone.
export function todayInTimezone(tz: string): string {
  // en-CA gives YYYY-MM-DD natively across all modern engines.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

// A date is "locked" when it is strictly before today in the school's
// timezone. Today's attendance is still editable until midnight crosses
// in the school's local time.
export async function isAttendanceLocked(schoolId: string, date: string): Promise<boolean> {
  const tz = await getSchoolTimezone(schoolId);
  const today = todayInTimezone(tz);
  return date < today;
}

// Phase B — yearly aggregates.

export interface AttendanceTotals {
  present: number;
  absent: number;
  late: number;
  excused: number;
}

// Count the attendance rows for one student between two inclusive dates,
// bucketed by status. Returns zeros when the student has no marks in the
// range (e.g. a school that doesn't take daily attendance).
export async function computeAttendanceTotals(
  schoolId: string, studentId: string, fromDate: string, toDate: string,
): Promise<AttendanceTotals> {
  const totals: AttendanceTotals = { present: 0, absent: 0, late: 0, excused: 0 };
  const { data } = await supabase
    .from('attendance')
    .select('status')
    .eq('school_id', schoolId)
    .eq('student_id', studentId)
    .gte('date', fromDate)
    .lte('date', toDate);
  for (const row of (data || []) as { status: string }[]) {
    if (row.status === 'present' || row.status === 'absent' ||
        row.status === 'late'    || row.status === 'excused') {
      totals[row.status]++;
    }
  }
  return totals;
}

// Notification helper. Builds a single parent-facing notification when a
// student's attendance status transitions INTO absent or late. Skips when
// the status hasn't changed (de-spams teacher re-saves) and when the new
// status is present/excused (no surprise to parents on those). Returns the
// rows to insert into `notifications`; the caller batches them.
//
// `oldStatus` is null when the row didn't exist before (a fresh mark).
export type AttendanceWriteStatus = 'present' | 'absent' | 'late' | 'excused';

export function shouldNotifyAttendanceChange(
  oldStatus: AttendanceWriteStatus | null, newStatus: AttendanceWriteStatus,
): boolean {
  if (newStatus !== 'absent' && newStatus !== 'late') return false;
  return oldStatus !== newStatus;
}

export function buildAttendanceNotificationCopy(
  fullName: string, status: AttendanceWriteStatus, date: string, notes?: string | null,
): { title: string; message: string } {
  if (status === 'late') {
    return {
      title: `${fullName} Arrived Late`,
      message: `${fullName} was marked late for class on ${date}.`,
    };
  }
  // status === 'absent'
  return {
    title: `${fullName} Marked Absent`,
    message: `${fullName} was marked absent from class on ${date}.${notes ? ' Note: ' + notes : ''}`,
  };
}

// Recompute and persist totals for any CLOSED enrollment row whose
// [started_on, ended_on] interval contains `date`. Used by the supervisor
// attendance-override paths so a corrected past day flows back into the
// frozen per-year aggregate. No-op if archive is off or no closed row
// covers the date.
export async function refreshAttendanceTotalsForDate(
  schoolId: string, studentId: string, date: string,
): Promise<void> {
  if (!(await hasArchiveFeature(schoolId))) return;
  const { data: rows } = await supabase
    .from('student_enrollments')
    .select('id, started_on, ended_on')
    .eq('school_id', schoolId)
    .eq('student_id', studentId)
    .neq('status', 'enrolled')
    .not('ended_on', 'is', null)
    .lte('started_on', date)
    .gte('ended_on', date);
  for (const row of (rows || []) as { id: string; started_on: string; ended_on: string }[]) {
    const totals = await computeAttendanceTotals(
      schoolId, studentId, row.started_on, row.ended_on,
    );
    await supabase
      .from('student_enrollments')
      .update({ attendance_totals: totals })
      .eq('id', row.id);
  }
}
