// Helpers for the per-year academic progression record (table created in
// migration 030). One row per (student, academic_year) per school. This
// file is the single source of truth for how the column values are derived
// and how status transitions are written.
//
// Locked design (see memory/student-transfer-plan.md and the conversation
// 2026-05-30):
//   • Section change mid-year → UPDATE the same row (don't insert a new one)
//   • Multi-year leave → one row per academic year of leave (UNIQUE enforces it)
//   • Return from leave / re-enrol → new 'enrolled' row at the SAME grade_level
//     as the last row (completion-based default; admin may override)
//   • A future school-level setting `schools.progression_model = 'calendar'`
//     would only change the suggested grade_level in the return wizard; the
//     stored data stays model-agnostic. Don't reach for it here yet.
//
// Failure policy: writes from createStudent / assignStudent are best-effort
// (logged but not throwing). The explicit mark-on-leave / return-from-leave
// endpoints surface failures to the caller.

import { adminDb as supabase } from './db';
import { logger } from './logger';
import { computeAttendanceTotals, type AttendanceTotals } from './attendance';
import { hasArchiveFeature } from './employeeArchive';

export type EnrollmentStatus =
  | 'enrolled'
  | 'promoted'
  | 'retained'
  | 'on_leave'
  | 'withdrew'
  | 'transferred'
  | 'graduated';

export interface EnrollmentRow {
  id: string;
  schoolId: string;
  studentId: string;
  academicYear: string;
  classId: string | null;
  classNameSnapshot: string | null;
  gradeLevel: string;
  status: EnrollmentStatus;
  startedOn: string;
  endedOn: string | null;
  // Phase B — frozen per-year attendance summary, set at close time when
  // the archive feature is on. NULL while the row is open or for
  // archive-off schools. See migration 035 + utils/attendance.ts.
  attendanceTotals: AttendanceTotals | null;
  createdAt: string;
  updatedAt: string;
}

// Academic year boundary: September starts the year (matches the existing
// toAcademicYear() in archiveExport.ts). This is the pure-date fallback;
// the authoritative source for "current year for school X" is
// resolveCurrentAcademicYear() below, which consults the school's stored
// override (migration 042 / HD-4) before falling back here.
export function academicYearOf(date: Date | string = new Date()): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return m >= 9 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

// HD-4 — authoritative academic-year resolver. Consults
// schools.current_academic_year (set by the year-transition wizard /
// School Settings); falls back to the September-boundary calculator
// above when the column is NULL or malformed. Used by every write path
// that stamps an academic_year onto a row so toggling the wizard
// actually changes downstream behaviour.
const ACADEMIC_YEAR_SHAPE = /^\d{4}-\d{4}$/;
export async function resolveCurrentAcademicYear(schoolId: string): Promise<string> {
  const { data } = await supabase
    .from('schools').select('current_academic_year').eq('id', schoolId).single();
  const stored = (data as { current_academic_year?: string | null } | null)?.current_academic_year;
  if (stored && ACADEMIC_YEAR_SHAPE.test(stored)) return stored;
  return academicYearOf();
}

// First day of the given academic year as an ISO date string. Used as the
// default started_on when we don't have a more specific date.
export function academicYearStartDate(academicYear: string): string {
  const [start] = academicYear.split('-');
  return `${start}-09-01`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

interface ClassInfo {
  id: string;
  name: string;
  gradeLevel: string;
}

// Load class.name + class.grade_level for the snapshot. Falls back to
// class.name when grade_level is null (older classes that never set it).
async function loadClassInfo(schoolId: string, classId: string): Promise<ClassInfo | null> {
  const { data } = await supabase
    .from('classes')
    .select('id, name, grade_level')
    .eq('id', classId)
    .eq('school_id', schoolId)
    .single();
  if (!data) return null;
  return {
    id: data.id,
    name: data.name,
    gradeLevel: (data.grade_level as string | null) || data.name,
  };
}

async function findRow(
  schoolId: string,
  studentId: string,
  academicYear: string,
): Promise<EnrollmentRow | null> {
  const { data } = await supabase
    .from('student_enrollments')
    .select('*')
    .eq('school_id', schoolId)
    .eq('student_id', studentId)
    .eq('academic_year', academicYear)
    .maybeSingle();
  return data ? rowToCC(data) : null;
}

async function findLastRow(
  schoolId: string,
  studentId: string,
): Promise<EnrollmentRow | null> {
  const { data } = await supabase
    .from('student_enrollments')
    .select('*')
    .eq('school_id', schoolId)
    .eq('student_id', studentId)
    .order('academic_year', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? rowToCC(data) : null;
}

function rowToCC(r: Record<string, unknown>): EnrollmentRow {
  return {
    id: String(r.id),
    schoolId: String(r.school_id),
    studentId: String(r.student_id),
    academicYear: String(r.academic_year),
    classId: (r.class_id as string | null) ?? null,
    classNameSnapshot: (r.class_name_snapshot as string | null) ?? null,
    gradeLevel: String(r.grade_level),
    status: r.status as EnrollmentStatus,
    startedOn: String(r.started_on),
    endedOn: (r.ended_on as string | null) ?? null,
    attendanceTotals: (r.attendance_totals as AttendanceTotals | null) ?? null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

// Open an 'enrolled' row for the student's current placement. Called from
// createStudent after the students row is inserted. Idempotent: if a row
// already exists for (student, currentYear), updates class instead.
export async function openEnrollmentForCurrentYear(args: {
  schoolId: string;
  studentId: string;
  classId: string | null;
}): Promise<void> {
  const { schoolId, studentId, classId } = args;
  if (!classId) return; // Student without a class on intake — nothing to open yet.

  try {
    const year = await resolveCurrentAcademicYear(schoolId);
    const cls = await loadClassInfo(schoolId, classId);
    if (!cls) return;

    const existing = await findRow(schoolId, studentId, year);
    if (existing) {
      await supabase
        .from('student_enrollments')
        .update({
          class_id: cls.id,
          class_name_snapshot: cls.name,
          grade_level: cls.gradeLevel,
          status: 'enrolled',
          ended_on: null,
        })
        .eq('id', existing.id);
      return;
    }

    await supabase.from('student_enrollments').insert({
      school_id: schoolId,
      student_id: studentId,
      academic_year: year,
      class_id: cls.id,
      class_name_snapshot: cls.name,
      grade_level: cls.gradeLevel,
      status: 'enrolled',
      started_on: todayIso(),
    });
  } catch (e) {
    logger.warn('[student_enrollments] openEnrollmentForCurrentYear failed', {
      studentId, classId, err: (e as Error).message,
    });
  }
}

// Mid-year class change (e.g. moved from 7A to 7B in October). Updates the
// current year's row in place; never creates a second row for the same year.
// If no row exists yet for the current year (older students, pre-backfill),
// opens one.
export async function updateClassForCurrentYear(args: {
  schoolId: string;
  studentId: string;
  classId: string;
}): Promise<void> {
  const { schoolId, studentId, classId } = args;
  try {
    const year = await resolveCurrentAcademicYear(schoolId);
    const cls = await loadClassInfo(schoolId, classId);
    if (!cls) return;

    const existing = await findRow(schoolId, studentId, year);
    if (existing) {
      await supabase
        .from('student_enrollments')
        .update({
          class_id: cls.id,
          class_name_snapshot: cls.name,
          grade_level: cls.gradeLevel,
          status: 'enrolled',
          ended_on: null,
        })
        .eq('id', existing.id);
      return;
    }

    await supabase.from('student_enrollments').insert({
      school_id: schoolId,
      student_id: studentId,
      academic_year: year,
      class_id: cls.id,
      class_name_snapshot: cls.name,
      grade_level: cls.gradeLevel,
      status: 'enrolled',
      started_on: todayIso(),
    });
  } catch (e) {
    logger.warn('[student_enrollments] updateClassForCurrentYear failed', {
      studentId, classId, err: (e as Error).message,
    });
  }
}

// Close the current year's row with a terminal status. Used by:
//   • archiveStudent (status='transferred' or 'withdrew')
//   • snapshotGraduatedStudent (status='graduated')
//
// Called BEFORE the student row is deleted (CASCADE would otherwise wipe
// the enrollment rows along with it — we want the snapshot reader below to
// see the final state).
export async function closeCurrentEnrollment(args: {
  schoolId: string;
  studentId: string;
  status: 'graduated' | 'withdrew' | 'transferred';
  endedOn?: string;
}): Promise<void> {
  const { schoolId, studentId, status, endedOn } = args;
  try {
    const year = await resolveCurrentAcademicYear(schoolId);
    const ended = endedOn || todayIso();
    const archiveOn = await hasArchiveFeature(schoolId);
    const existing = await findRow(schoolId, studentId, year);
    if (existing) {
      // Phase B — freeze per-year attendance totals on archive-on schools.
      const update: Record<string, unknown> = { status, ended_on: ended };
      if (archiveOn) {
        update.attendance_totals = await computeAttendanceTotals(
          schoolId, studentId, existing.startedOn, ended,
        );
      }
      await supabase
        .from('student_enrollments')
        .update(update)
        .eq('id', existing.id);
      return;
    }
    // No row for this year yet (older student, never created an enrollment).
    // Synthesise a closing row so the archive snapshot has at least one row
    // to read. Derive the grade_level from the last row, falling back to
    // the student's current class.
    const last = await findLastRow(schoolId, studentId);
    let gradeLevel = last?.gradeLevel || '(unknown)';
    let classId: string | null = null;
    let className: string | null = null;
    const { data: stu } = await supabase
      .from('students').select('class_id').eq('id', studentId).eq('school_id', schoolId).single();
    if (stu?.class_id) {
      const cls = await loadClassInfo(schoolId, String(stu.class_id));
      if (cls) { classId = cls.id; className = cls.name; gradeLevel = cls.gradeLevel; }
    }
    // Anchor started_on at the start of the academic year so the row
    // represents the FULL year, not just today. Otherwise the frozen
    // totals (and the snapshot) would cover only the close-day window and
    // miss attendance the student had earlier in the year.
    const started = academicYearStartDate(year);
    const synthInsert: Record<string, unknown> = {
      school_id: schoolId,
      student_id: studentId,
      academic_year: year,
      class_id: classId,
      class_name_snapshot: className,
      grade_level: gradeLevel,
      status,
      started_on: started,
      ended_on: ended,
    };
    if (archiveOn) {
      synthInsert.attendance_totals = await computeAttendanceTotals(
        schoolId, studentId, started, ended,
      );
    }
    await supabase.from('student_enrollments').insert(synthInsert);
  } catch (e) {
    logger.warn('[student_enrollments] closeCurrentEnrollment failed', {
      studentId, status, err: (e as Error).message,
    });
  }
}

// Mark current academic year as on_leave. If the student is currently
// enrolled (row exists), updates that row's status to on_leave. Otherwise,
// inserts a fresh on_leave row carrying the last known grade_level.
//
// Surfaces errors to the caller — this is the primary action of an
// explicit endpoint.
export async function markOnLeaveForCurrentYear(args: {
  schoolId: string;
  studentId: string;
  endedOn?: string;
}): Promise<{ ok: true; row: EnrollmentRow } | { ok: false; error: string }> {
  const { schoolId, studentId, endedOn } = args;
  const year = await resolveCurrentAcademicYear(schoolId);
  const ended = endedOn || todayIso();
  const archiveOn = await hasArchiveFeature(schoolId);
  const existing = await findRow(schoolId, studentId, year);
  if (existing) {
    // Phase B parity — freeze totals on the closing row when archive is on
    // so the on-leave year survives a future archive snapshot with counts
    // intact, matching closeEnrollmentForYear / closeCurrentEnrollment.
    const update: Record<string, unknown> = { status: 'on_leave', ended_on: ended };
    if (archiveOn) {
      update.attendance_totals = await computeAttendanceTotals(
        schoolId, studentId, existing.startedOn, ended,
      );
    }
    const { data, error } = await supabase
      .from('student_enrollments')
      .update(update)
      .eq('id', existing.id)
      .select()
      .single();
    if (error || !data) return { ok: false, error: error?.message || 'Failed to mark on leave' };
    return { ok: true, row: rowToCC(data) };
  }

  const last = await findLastRow(schoolId, studentId);
  const gradeLevel = last?.gradeLevel;
  if (!gradeLevel) {
    return { ok: false, error: 'Cannot mark on leave — no prior enrollment to inherit grade level from' };
  }
  const started = academicYearStartDate(year);
  const insert: Record<string, unknown> = {
    school_id: schoolId,
    student_id: studentId,
    academic_year: year,
    class_id: null,
    class_name_snapshot: last?.classNameSnapshot ?? null,
    grade_level: gradeLevel,
    status: 'on_leave',
    started_on: started,
    ended_on: endedOn || null,
  };
  if (archiveOn && endedOn) {
    // Only freeze totals when the leave is closed (endedOn set). Open
    // leaves stay null and will be computed live by buildAttendanceHistory.
    insert.attendance_totals = await computeAttendanceTotals(
      schoolId, studentId, started, endedOn,
    );
  }
  const { data, error } = await supabase
    .from('student_enrollments')
    .insert(insert)
    .select()
    .single();
  if (error || !data) return { ok: false, error: error?.message || 'Failed to mark on leave' };
  return { ok: true, row: rowToCC(data) };
}

// Return from leave / re-enrolment. Opens a new 'enrolled' row for the
// current academic year at the same grade_level as the last enrollment row
// (admin may override). Caller must supply a classId (placement choice).
export async function returnFromLeave(args: {
  schoolId: string;
  studentId: string;
  classId: string;
  gradeLevelOverride?: string;
}): Promise<{ ok: true; row: EnrollmentRow } | { ok: false; error: string }> {
  const { schoolId, studentId, classId, gradeLevelOverride } = args;
  const cls = await loadClassInfo(schoolId, classId);
  if (!cls) return { ok: false, error: 'Class not found in this school' };

  // Default grade level = last row's grade level (the "paused-at" level).
  // Admin can pass an override at placement time.
  const last = await findLastRow(schoolId, studentId);
  const gradeLevel = gradeLevelOverride || last?.gradeLevel || cls.gradeLevel;

  const year = await resolveCurrentAcademicYear(schoolId);
  const existing = await findRow(schoolId, studentId, year);
  if (existing) {
    const { data, error } = await supabase
      .from('student_enrollments')
      .update({
        class_id: cls.id,
        class_name_snapshot: cls.name,
        grade_level: gradeLevel,
        status: 'enrolled',
        ended_on: null,
      })
      .eq('id', existing.id)
      .select()
      .single();
    if (error || !data) return { ok: false, error: error?.message || 'Failed to return from leave' };
    return { ok: true, row: rowToCC(data) };
  }

  const { data, error } = await supabase
    .from('student_enrollments')
    .insert({
      school_id: schoolId,
      student_id: studentId,
      academic_year: year,
      class_id: cls.id,
      class_name_snapshot: cls.name,
      grade_level: gradeLevel,
      status: 'enrolled',
      started_on: todayIso(),
    })
    .select()
    .single();
  if (error || !data) return { ok: false, error: error?.message || 'Failed to return from leave' };
  return { ok: true, row: rowToCC(data) };
}

// Year-end wizard primitives — operate on an EXPLICIT academic_year
// (the year being closed / opened) rather than today's. Used by the
// Promote Class wizard in Phase 3.

// Close a specific year's row with a terminal status. Returns rowExisted
// so the wizard can report "no enrollment row found" cleanly instead of
// silently no-op-ing.
export async function closeEnrollmentForYear(args: {
  schoolId: string;
  studentId: string;
  academicYear: string;
  status: 'promoted' | 'retained' | 'on_leave' | 'withdrew' | 'transferred' | 'graduated';
  endedOn: string;
}): Promise<{ ok: boolean; rowExisted: boolean; error?: string }> {
  const { schoolId, studentId, academicYear, status, endedOn } = args;
  const existing = await findRow(schoolId, studentId, academicYear);
  if (!existing) return { ok: false, rowExisted: false, error: 'No enrollment row for this academic year' };

  // Phase B — when archive is on, freeze the per-year attendance totals
  // onto the closing row so the history survives a future student delete.
  const update: Record<string, unknown> = { status, ended_on: endedOn };
  if (await hasArchiveFeature(schoolId)) {
    update.attendance_totals = await computeAttendanceTotals(
      schoolId, studentId, existing.startedOn, endedOn,
    );
  }

  const { error } = await supabase
    .from('student_enrollments')
    .update(update)
    .eq('id', existing.id);
  if (error) return { ok: false, rowExisted: true, error: error.message };
  return { ok: true, rowExisted: true };
}

// Open an 'enrolled' row for a specific (usually future) academic year.
// Idempotent: if a row already exists for (student, year), updates it to
// the new class + enrolled status. Used by the Promote Class wizard to
// start next year's enrollment.
export async function openEnrollmentForYear(args: {
  schoolId: string;
  studentId: string;
  academicYear: string;
  classId: string;
  gradeLevelOverride?: string;
  startedOn?: string;
}): Promise<{ ok: boolean; row?: EnrollmentRow; error?: string }> {
  const { schoolId, studentId, academicYear, classId, gradeLevelOverride, startedOn } = args;
  const cls = await loadClassInfo(schoolId, classId);
  if (!cls) return { ok: false, error: 'Target class not found in this school' };
  const gradeLevel = gradeLevelOverride || cls.gradeLevel;
  const started = startedOn || academicYearStartDate(academicYear);

  const existing = await findRow(schoolId, studentId, academicYear);
  if (existing) {
    const { data, error } = await supabase
      .from('student_enrollments')
      .update({
        class_id: cls.id,
        class_name_snapshot: cls.name,
        grade_level: gradeLevel,
        status: 'enrolled',
        started_on: started,
        ended_on: null,
      })
      .eq('id', existing.id)
      .select()
      .single();
    if (error || !data) return { ok: false, error: error?.message || 'Failed to open enrollment' };
    return { ok: true, row: rowToCC(data) };
  }

  const { data, error } = await supabase
    .from('student_enrollments')
    .insert({
      school_id: schoolId,
      student_id: studentId,
      academic_year: academicYear,
      class_id: cls.id,
      class_name_snapshot: cls.name,
      grade_level: gradeLevel,
      status: 'enrolled',
      started_on: started,
    })
    .select()
    .single();
  if (error || !data) return { ok: false, error: error?.message || 'Failed to open enrollment' };
  return { ok: true, row: rowToCC(data) };
}

// Compute the academic year that follows the given one. '2024-2025' → '2025-2026'.
// Tolerant of unexpected shapes — falls back to today+1y.
export function nextAcademicYear(academicYear: string): string {
  const parts = academicYear.split('-');
  if (parts.length === 2) {
    const a = parseInt(parts[0], 10);
    const b = parseInt(parts[1], 10);
    if (!isNaN(a) && !isNaN(b)) return `${a + 1}-${b + 1}`;
  }
  const now = new Date();
  return academicYearOf(new Date(Date.UTC(now.getUTCFullYear() + 1, now.getUTCMonth(), now.getUTCDate())));
}

// Load all 'enrolled' rows for a given class + year. Used by the wizard
// to build the preview roster. Joins to students so caller has the names.
export async function loadEnrolledRosterForClass(
  schoolId: string,
  classId: string,
  academicYear: string,
): Promise<Array<{ enrollment: EnrollmentRow; studentName: string }>> {
  const { data } = await supabase
    .from('student_enrollments')
    .select('*, students(full_name)')
    .eq('school_id', schoolId)
    .eq('class_id', classId)
    .eq('academic_year', academicYear)
    .eq('status', 'enrolled');
  return (data || []).map((r: any) => ({
    enrollment: rowToCC(r),
    studentName: (r.students?.full_name as string) || '(unknown)',
  }));
}

// Load the full enrollment history for a student (camelCased, ordered by
// academic_year ascending — so the timeline reads chronologically). Used
// at archive time to build the JSONB snapshot, and by the live profile
// page to render the "Academic progression" tab.
export async function loadEnrollmentHistory(
  schoolId: string,
  studentId: string,
): Promise<EnrollmentRow[]> {
  const { data } = await supabase
    .from('student_enrollments')
    .select('*')
    .eq('school_id', schoolId)
    .eq('student_id', studentId)
    .order('academic_year', { ascending: true });
  return (data || []).map(rowToCC);
}

// Compact JSONB shape stored on archived_students.enrollment_history.
// Kept narrow on purpose — only the fields the archive viewer + PDF / Excel
// export need. Matches the COMMENT on the column added by migration 030.
export interface AttendanceDay {
  date: string;
  status: 'present' | 'absent' | 'late' | 'excused';
  notes: string | null;
}

export interface EnrollmentSnapshotEntry {
  academicYear: string;
  gradeLevel: string;
  classId: string | null;
  className: string | null;
  status: EnrollmentStatus;
  startedOn: string;
  endedOn: string | null;
  // Phase B — frozen per-year attendance summary copied from the
  // enrollment row at archive time. NULL for archive-off (legacy) rows
  // and for rows that were closed before the totals column existed.
  attendanceTotals: AttendanceTotals | null;
  // HD-1 — granular per-day attendance for this academic year. The live
  // `attendance` table CASCADE-deletes with the student row, so unless
  // we snapshot it here, the daily log is lost forever the moment a
  // student is archived. Bounded to that year's ~180 entries.
  attendanceDays: AttendanceDay[];
}

export function rowsToSnapshot(
  rows: EnrollmentRow[],
  attendanceByYear?: Map<string, AttendanceDay[]>,
): EnrollmentSnapshotEntry[] {
  return rows.map(r => ({
    academicYear: r.academicYear,
    gradeLevel: r.gradeLevel,
    classId: r.classId,
    className: r.classNameSnapshot,
    status: r.status,
    startedOn: r.startedOn,
    endedOn: r.endedOn,
    attendanceTotals: r.attendanceTotals,
    attendanceDays: attendanceByYear?.get(r.academicYear) ?? [],
  }));
}
