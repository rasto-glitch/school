// Per-student attendance history reader. Used by the admin and parent
// "attendance history" endpoints (Phase C of the attendance work).
//
// One row per academic year the student was enrolled. Each year carries a
// totals object — frozen on closed years (set at close by
// closeEnrollmentForYear / closeCurrentEnrollment) and computed live for
// the currently open year.
//
// Gating: these readers are only called by archive-on routes — the
// endpoints themselves return 403 when the feature is off. We do not
// repeat the check here; the caller owns it.

import { adminDb as supabase } from './db';
import {
  loadEnrollmentHistory,
  type EnrollmentStatus,
} from './studentEnrollments';
import {
  computeAttendanceTotals,
  todayInTimezone,
  getSchoolTimezone,
  type AttendanceTotals,
} from './attendance';

export interface AttendanceHistoryYear {
  academicYear: string;
  gradeLevel: string;
  classId: string | null;
  className: string | null;
  status: EnrollmentStatus;
  startedOn: string;
  endedOn: string | null;
  totals: AttendanceTotals;
  // True when the totals came from the frozen JSONB column; false when
  // computed on the fly from raw attendance rows (active year, or a
  // closed year that pre-dates migration 035).
  frozen: boolean;
}

export interface AttendanceHistory {
  years: AttendanceHistoryYear[];
}

// Build the year-by-year history for one student. Active years and any
// closed year that's still missing frozen totals get computed live; the
// rest are pulled from the stored aggregate.
export async function buildAttendanceHistory(
  schoolId: string, studentId: string,
): Promise<AttendanceHistory> {
  const rows = await loadEnrollmentHistory(schoolId, studentId);
  if (rows.length === 0) return { years: [] };

  const tz = await getSchoolTimezone(schoolId);
  const today = todayInTimezone(tz);

  const years: AttendanceHistoryYear[] = [];
  for (const r of rows) {
    let totals: AttendanceTotals;
    let frozen: boolean;
    if (r.attendanceTotals) {
      totals = r.attendanceTotals;
      frozen = true;
    } else {
      // Live count: cap upper bound at today so an open row doesn't reach
      // into "future" dates (defensive — UI prevents future marks anyway).
      const upper = r.endedOn ?? today;
      totals = await computeAttendanceTotals(schoolId, studentId, r.startedOn, upper);
      frozen = false;
    }
    years.push({
      academicYear: r.academicYear,
      gradeLevel: r.gradeLevel,
      classId: r.classId,
      className: r.classNameSnapshot,
      status: r.status,
      startedOn: r.startedOn,
      endedOn: r.endedOn,
      totals,
      frozen,
    });
  }
  return { years };
}

export interface AttendanceDay {
  date: string;
  status: 'present' | 'absent' | 'late' | 'excused';
  notes: string | null;
  classId: string | null;
  className: string | null;
}

// Day-by-day attendance for one student within one academic year.
// Reads raw `attendance` rows in the year's date range. For archived
// students the rows have cascaded — callers should not invoke this for
// students whose live row no longer exists.
export async function loadAttendanceDaysForYear(
  schoolId: string, studentId: string, academicYear: string,
): Promise<{ academicYear: string; startedOn: string | null; endedOn: string | null; days: AttendanceDay[] } | null> {
  const rows = await loadEnrollmentHistory(schoolId, studentId);
  const enrollment = rows.find(r => r.academicYear === academicYear);
  if (!enrollment) return null;

  const tz = await getSchoolTimezone(schoolId);
  const upper = enrollment.endedOn ?? todayInTimezone(tz);
  const { data } = await supabase
    .from('attendance')
    .select('date, status, notes, class_id, classes(name)')
    .eq('school_id', schoolId)
    .eq('student_id', studentId)
    .gte('date', enrollment.startedOn)
    .lte('date', upper)
    .order('date', { ascending: true });

  const days: AttendanceDay[] = (data || []).map((r: any) => ({
    date: String(r.date),
    status: r.status,
    notes: r.notes ?? null,
    classId: (r.class_id as string | null) ?? null,
    className: (r.classes?.name as string | undefined) ?? null,
  }));

  return {
    academicYear,
    startedOn: enrollment.startedOn,
    endedOn: enrollment.endedOn,
    days,
  };
}
