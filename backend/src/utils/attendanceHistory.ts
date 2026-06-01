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
  academicYearOf,
  academicYearStartDate,
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
//
// Resilience: students created before migration 030 (or created without a
// class) may not have a `student_enrollments` row for the current year
// even though they have raw attendance. When the live student is still
// active, we synthesize a current-year row so the page reflects the day's
// marks instead of showing the "no history" empty state.
export async function buildAttendanceHistory(
  schoolId: string, studentId: string,
): Promise<AttendanceHistory> {
  const rows = await loadEnrollmentHistory(schoolId, studentId);
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

  // Synthesize a current-year entry if one's missing and the student is
  // still active. Keeps the page useful for pre-backfill students who
  // already have attendance rows but no per-year enrollment record.
  const currentYear = academicYearOf();
  if (!years.some(y => y.academicYear === currentYear)) {
    const { data: liveStudent } = await supabase
      .from('students')
      .select('id, is_graduated, class_id, classes(name, grade_level)')
      .eq('id', studentId).eq('school_id', schoolId).maybeSingle();
    const isActive = liveStudent && !(liveStudent as { is_graduated?: boolean }).is_graduated;
    if (isActive) {
      const cls = (liveStudent as { classes?: { name?: string; grade_level?: string } }).classes;
      const startedOn = academicYearStartDate(currentYear);
      const totals = await computeAttendanceTotals(schoolId, studentId, startedOn, today);
      years.push({
        academicYear: currentYear,
        gradeLevel: cls?.grade_level ?? '—',
        classId: (liveStudent as { class_id?: string | null }).class_id ?? null,
        className: cls?.name ?? null,
        status: 'enrolled',
        startedOn,
        endedOn: null,
        totals,
        frozen: false,
      });
    }
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

  let startedOn: string;
  let endedOn: string | null;
  if (enrollment) {
    startedOn = enrollment.startedOn;
    endedOn = enrollment.endedOn;
  } else if (academicYear === academicYearOf()) {
    // Synthesized current-year fallback — matches buildAttendanceHistory
    // so the calendar still shows today's marks for pre-backfill students.
    startedOn = academicYearStartDate(academicYear);
    endedOn = null;
  } else {
    return null;
  }

  const tz = await getSchoolTimezone(schoolId);
  const upper = endedOn ?? todayInTimezone(tz);
  const { data } = await supabase
    .from('attendance')
    .select('date, status, notes, class_id, classes(name)')
    .eq('school_id', schoolId)
    .eq('student_id', studentId)
    .gte('date', startedOn)
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
    startedOn,
    endedOn,
    days,
  };
}
