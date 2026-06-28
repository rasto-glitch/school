import { safeDbErrorMessage, safeDbErrorStatus } from '../utils/dbErrors';
import { Response } from 'express';
import type { AuthRequest } from '../middleware/auth';
import { toCC } from '../utils/transform';
import { logAudit } from '../utils/audit';
import { notify } from '../utils/notify';
import {
  isAttendanceLocked,
  refreshAttendanceTotalsForDate,
  shouldNotifyAttendanceChange,
  buildAttendanceNotificationCopy,
  getSchoolTimezone,
  todayInTimezone,
  type AttendanceWriteStatus,
} from '../utils/attendance';

// Insert one parent-facing notification per linked parent for a single
// student × attendance row. Used by the supervisor create/update paths
// so manual corrections still surface to the parent (the teacher batch
// has its own pipeline). No-op for non-transitions.
async function notifyParentsOfAttendanceTransition(
  req: AuthRequest,
  studentId: string,
  oldStatus: AttendanceWriteStatus | null,
  newStatus: AttendanceWriteStatus,
  date: string,
  notes: string | null,
): Promise<void> {
  if (!shouldNotifyAttendanceChange(oldStatus, newStatus)) return;
  const { schoolId } = req.user!;
  const { data: student } = await req.db!
    .from('students')
    .select('id, full_name, parents(user_id)')
    .eq('id', studentId).eq('school_id', schoolId).maybeSingle();
  if (!student) return;
  const parents = (student as { parents?: Array<{ user_id: string }> | { user_id: string } }).parents;
  const parentUserIds: string[] = Array.isArray(parents)
    ? parents.map(p => p.user_id)
    : parents?.user_id ? [parents.user_id] : [];
  if (parentUserIds.length === 0) return;
  const { title, message } = buildAttendanceNotificationCopy(
    (student as { full_name: string }).full_name, newStatus, date, notes,
  );
  await req.db!.from('notifications').insert(
    parentUserIds.map(uid => ({
      school_id: schoolId, user_id: uid, title, message, notification_type: 'general',
    })),
  );
}

// ---- CLASSES (all classes in the school) ----
export async function getClasses(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { data, error } = await req.db!
    .from('classes')
    .select('id, name, grade_level, academic_year, teacher_classes(teachers(id, full_name))')
    .eq('school_id', schoolId)
    .order('name');
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json(toCC(data));
}

// ---- STUDENTS BY CLASS ----
export async function getStudentsByClass(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { classId } = req.params;
  const { data, error } = await req.db!
    .from('students')
    .select('id, full_name, profile_picture, parents(full_name, phone_number, user_id)')
    .eq('school_id', schoolId)
    .eq('class_id', classId)
    .eq('is_graduated', false)
    .order('full_name');
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json(toCC(data));
}

// ---- ALL STUDENTS (with parent info, grouped by class) ----
export async function getAllStudents(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { data, error } = await req.db!
    .from('students')
    .select('id, full_name, classes(id, name, grade_level), parents(full_name, phone_number, residence_type, block_number, latitude, longitude)')
    .eq('school_id', schoolId)
    .eq('is_graduated', false)
    .order('full_name');
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json(toCC(data));
}

// ---- ABSENT TODAY (across all classes) ----
export async function getAbsentToday(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  // "Today" in the school's timezone so it stays in sync with the daily
  // lock (around midnight in Asia/Baghdad, UTC-derived 'today' would jump
  // a day early or late and surface the wrong roster).
  const today = todayInTimezone(await getSchoolTimezone(schoolId));

  const { data, error } = await req.db!
    .from('attendance')
    .select('*, students(id, full_name, profile_picture, class_id, classes(name), parents(full_name, phone_number, user_id)), teachers(full_name)')
    .eq('school_id', schoolId)
    .eq('date', today)
    .in('status', ['absent', 'late', 'excused'])
    .order('created_at', { ascending: false });
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json(toCC(data));
}

// ---- ATTENDANCE BY CLASS + DATE ----
export async function getAttendanceByClass(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { classId, date } = req.query as Record<string, string>;

  if (!classId || !date) { res.status(400).json({ error: 'classId and date are required' }); return; }

  const { data, error } = await req.db!
    .from('attendance')
    .select('*, students(id, full_name, profile_picture), teachers(full_name)')
    .eq('school_id', schoolId)
    .eq('class_id', classId)
    .eq('date', date)
    .order('created_at');
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json(toCC(data));
}

// ---- ATTENDANCE SUMMARY (absent count per class for a date) ----
export async function getAttendanceSummary(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { date } = req.query as Record<string, string>;
  const targetDate = date || todayInTimezone(await getSchoolTimezone(schoolId));

  // Get all classes
  const { data: classes } = await req.db!
    .from('classes')
    .select('id, name, grade_level')
    .eq('school_id', schoolId)
    .order('name');

  if (!classes) { res.json([]); return; }

  // Get attendance counts per class for the date
  const { data: records } = await req.db!
    .from('attendance')
    .select('class_id, status')
    .eq('school_id', schoolId)
    .eq('date', targetDate);

  const summary = classes.map(cls => {
    const classRecords = (records || []).filter((r: any) => r.class_id === cls.id);
    return {
      ...cls,
      present: classRecords.filter((r: any) => r.status === 'present').length,
      absent: classRecords.filter((r: any) => r.status === 'absent').length,
      late: classRecords.filter((r: any) => r.status === 'late').length,
      excused: classRecords.filter((r: any) => r.status === 'excused').length,
      total: classRecords.length,
    };
  });

  res.json(toCC(summary));
}

// ---- BUS RIDE RECORDS (discrepancy report) ----
export async function getBusRideRecords(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { date } = req.query as Record<string, string>;
  const targetDate = date || todayInTimezone(await getSchoolTimezone(schoolId));

  const { data, error } = await req.db!
    .from('bus_ride_records')
    .select('id, date, rode_bus, exclusion_reason, school_attendance_status, students(id, full_name, classes(name)), drivers(full_name)')
    .eq('school_id', schoolId)
    .eq('date', targetDate)
    .order('created_at');

  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json(toCC(data || []));
}

// ---- HOMEWORK (all school homework, read + delete) ----
export async function getHomework(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { data, error } = await req.db!
    .from('homework')
    .select('id, title, description, subject, due_date, created_at, teachers(full_name), classes(name)')
    .eq('school_id', schoolId)
    .order('created_at', { ascending: false });
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json(toCC(data));
}

export async function deleteHomework(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  const { error } = await req.db!.from('homework').delete().eq('id', id).eq('school_id', schoolId);
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json({ success: true });
}

// ---- ASSIGNMENTS (all school assignments, read + delete) ----
export async function getAssignments(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { data, error } = await req.db!
    .from('assignments')
    .select('id, title, description, subject, due_date, created_at, teachers(full_name), classes(name)')
    .eq('school_id', schoolId)
    .order('created_at', { ascending: false });
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json(toCC(data));
}

export async function deleteAssignment(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  const { error } = await req.db!.from('assignments').delete().eq('id', id).eq('school_id', schoolId);
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json({ success: true });
}

// ---- CREATE ATTENDANCE (supervisor marks a student with no existing record) ----
export async function createAttendanceRecord(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { studentId, classId, date, status, notes } = req.body;

  if (!studentId || !classId || !date || !status) {
    res.status(400).json({ error: 'studentId, classId, date, and status are required' }); return;
  }
  if (!['present', 'absent', 'late', 'excused'].includes(status)) {
    res.status(400).json({ error: 'Valid status (present, absent, late, excused) is required' }); return;
  }

  // SECURITY (I-2): verify the student actually belongs to the supplied
  // class. Previously a supervisor could mis-attribute a student to any
  // class in their school (Grade 7 student marked absent in Grade 1) —
  // we confirmed the bug live during the pen test and the row landed.
  // The supervisor already has school-wide attendance authority, so this
  // is data integrity / audit clarity rather than privilege escalation,
  // but it's cheap to enforce here.
  const { data: student } = await req.db!
    .from('students')
    .select('class_id')
    .eq('id', studentId)
    .eq('school_id', schoolId)
    .maybeSingle();
  if (!student) {
    res.status(404).json({ error: 'Student not found in this school.' });
    return;
  }
  if ((student as { class_id: string | null }).class_id !== classId) {
    res.status(400).json({ error: 'Student is not in the supplied class.' });
    return;
  }

  // Phase A — daily lock. Supervisors are allowed to create attendance for
  // past (locked) days, but every override gets an audit-log entry.
  const locked = await isAttendanceLocked(schoolId, date);

  const { data, error } = await req.db!
    .from('attendance')
    .insert({
      school_id: schoolId,
      student_id: studentId,
      class_id: classId,
      date,
      status,
      notes: notes || null,
      teacher_id: null,
    })
    .select()
    .single();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  if (locked) {
    await logAudit({
      req, entityType: 'attendance', entityId: String((data as { id: string }).id),
      action: 'create', after: data as Record<string, unknown>,
      label: `${date} · ${status}`, reason: 'Attendance override (locked day) — created',
    });
    // Phase B — if the override falls inside a closed academic year and
    // the school keeps history (archive on), refresh that year's totals.
    await refreshAttendanceTotalsForDate(schoolId, studentId, date);
  }

  // Notify the parents on the supervisor-side too, so a fresh absent/late
  // mark surfaces even when the teacher missed the student.
  await notifyParentsOfAttendanceTransition(
    req, studentId, null, status as AttendanceWriteStatus, date, notes || null,
  );

  res.json(toCC(data));
}

// ---- WEEKLY SUMMARY PERIODS ----
export async function getActivePeriod(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { data } = await req.db!
    .from('weekly_summary_periods')
    .select('*')
    .eq('school_id', schoolId)
    .eq('is_open', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  res.json(data ? toCC(data) : null);
}

export async function openPeriod(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { weekStartDate, weekEndDate } = req.body;
  if (!weekStartDate || !weekEndDate) {
    res.status(400).json({ error: 'weekStartDate and weekEndDate are required' }); return;
  }
  // Close any currently open periods first
  await req.db!.from('weekly_summary_periods').update({ is_open: false }).eq('school_id', schoolId).eq('is_open', true);

  const { data, error } = await req.db!
    .from('weekly_summary_periods')
    .insert({ school_id: schoolId, week_start_date: weekStartDate, week_end_date: weekEndDate, is_open: true, created_by_user_id: userId })
    .select()
    .single();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.status(201).json(toCC(data));
}

export async function closePeriod(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  await req.db!.from('weekly_summary_periods').update({ is_open: false }).eq('school_id', schoolId).eq('is_open', true);
  res.json({ success: true });
}

// ---- OVERRIDE ATTENDANCE (supervisor can correct a record) ----
export async function updateAttendanceRecord(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  const { status, notes } = req.body;

  if (!status || !['present', 'absent', 'late', 'excused'].includes(status)) {
    res.status(400).json({ error: 'Valid status (present, absent, late, excused) is required' }); return;
  }

  // Phase A — daily lock. Read the row's date first so we can decide
  // whether this edit is an override of a locked day (audit-logged) or a
  // normal same-day correction.
  const { data: before } = await req.db!
    .from('attendance')
    .select('*')
    .eq('id', id)
    .eq('school_id', schoolId)
    .single();
  if (!before) { res.status(404).json({ error: 'Attendance record not found' }); return; }

  const locked = await isAttendanceLocked(schoolId, (before as { date: string }).date);

  const { data, error } = await req.db!
    .from('attendance')
    .update({ status, notes: notes || null })
    .eq('id', id)
    .eq('school_id', schoolId)
    .select()
    .single();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  // Notify on a real status transition into absent/late even when the day
  // isn't locked — the teacher's batch notify won't fire for supervisor
  // corrections, so without this the parent never hears.
  await notifyParentsOfAttendanceTransition(
    req,
    String((before as { student_id: string }).student_id),
    (before as { status: AttendanceWriteStatus }).status,
    status as AttendanceWriteStatus,
    String((before as { date: string }).date),
    notes || null,
  );

  if (locked) {
    await logAudit({
      req, entityType: 'attendance', entityId: String(id),
      action: 'update',
      before: before as Record<string, unknown>,
      after: data as Record<string, unknown>,
      label: `${(before as { date: string }).date} · ${(before as { status: string }).status} → ${status}`,
      reason: 'Attendance override (locked day) — edited',
    });
    // Phase B — refresh the per-year frozen totals if archive is on and
    // this date sits within a closed enrollment row.
    await refreshAttendanceTotalsForDate(
      schoolId,
      String((before as { student_id: string }).student_id),
      String((before as { date: string }).date),
    );
  }

  res.json(toCC(data));
}

// ---- MEETING INVITES (Phase D liaison flow) ----
// Supervisor invites the parent of a student to a meeting. The parent completes
// it into a real booking (status invited→pending), which reception then
// confirms + assigns to an admin. Reception remains the only confirmer.
export async function createInvite(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { studentId, inviteReason } = req.body;

  const { data: student } = await req.db!
    .from('students')
    .select('id, full_name, parent_id, parents(user_id, full_name)')
    .eq('id', studentId).eq('school_id', schoolId).maybeSingle();
  if (!student || !(student as { parent_id?: string }).parent_id) {
    res.status(404).json({ error: 'Student has no linked parent to invite.' }); return;
  }

  const { data, error } = await req.db!.from('appointments').insert({
    school_id: schoolId,
    parent_id: (student as { parent_id: string }).parent_id,
    invited_by: userId,
    invite_reason: inviteReason || null,
    student_ids: [studentId],
    status: 'invited',
  }).select().single();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  const parentRel = (student as { parents?: { user_id?: string } | { user_id?: string }[] }).parents;
  const parentUserId = Array.isArray(parentRel) ? parentRel[0]?.user_id : parentRel?.user_id;
  if (parentUserId) {
    notify({
      schoolId, userId: parentUserId,
      title: 'Meeting invitation',
      message: `You've been invited to a meeting about ${(student as { full_name: string }).full_name}${inviteReason ? `: ${inviteReason}` : ''}. Open Appointments to choose a time or decline.`,
      type: 'appointment',
      relatedId: data.id,
    }).catch(() => {});
  }
  res.status(201).json(toCC(data));
}

// Invites this supervisor has sent (any status), newest first.
export async function listMyInvites(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { data, error } = await req.db!
    .from('appointments')
    .select('*, parents(full_name)')
    .eq('school_id', schoolId).eq('invited_by', userId)
    .order('created_at', { ascending: false });
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json(toCC(data));
}
