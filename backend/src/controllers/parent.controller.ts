import { safeDbErrorMessage, safeDbErrorStatus } from '../utils/dbErrors';
import { Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthRequest } from '../middleware/auth';
import { toCC } from '../utils/transform';
import { parseCursorParams, buildPage } from '../utils/pagination';
import { emitToAdmins, notify } from '../utils/notify';
import { decorateAnnouncements } from './admin.controller';
import { getLocksForStudents, isFeatureLocked } from '../utils/locks';
import { hasArchiveFeature } from '../utils/employeeArchive';
import { buildAttendanceHistory, loadAttendanceDaysForYear } from '../utils/attendanceHistory';

// Module-level helper — receives the per-request db client from the caller
// so it runs under the same RLS context as the rest of the route.
async function getParentAndChildren(
  db: SupabaseClient, userId: string, schoolId: string,
): Promise<{ parent: { id: string } | null; studentIds: string[] }> {
  const { data: parent } = await db.from('parents').select('id').eq('user_id', userId).eq('school_id', schoolId).single();
  if (!parent) return { parent: null, studentIds: [] };
  const { data: students } = await db.from('students').select('id').eq('parent_id', parent.id).eq('school_id', schoolId);
  return { parent, studentIds: students?.map((s: { id: string }) => s.id) ?? [] };
}

export async function getChildren(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { data: parent } = await req.db!.from('parents').select('id').eq('user_id', userId).eq('school_id', schoolId).single();
  if (!parent) { res.status(404).json({ error: 'Parent not found' }); return; }

  const { data, error } = await req.db!.from('students').select('id, full_name, profile_picture, class_id, classes(name), drivers(full_name, phone_number, license_number, buses(bus_number))').eq('parent_id', parent.id).eq('school_id', schoolId);
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  // Attach per-child locked feature list so the UI can render a "Contact school" state
  const ids = (data ?? []).map(s => (s as any).id);
  const locks = await getLocksForStudents(ids);
  const decorated = (data ?? []).map(s => ({
    ...(s as any),
    locked_features: Array.from(locks.get((s as any).id) ?? []),
  }));
  res.json(toCC(decorated));
}

// Read-only access to a departed/graduated child's frozen snapshot
// (finding F6). Only snapshots captured with original_parent_id (migration
// 017 onward) are linkable — older archives stay admin/accountant-only.
export async function getArchivedChildren(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { data: parent } = await req.db!.from('parents').select('id').eq('user_id', userId).eq('school_id', schoolId).single();
  if (!parent) { res.json([]); return; }

  const { data, error } = await req.db!
    .from('archived_students')
    .select('id, full_name, reason, departure_date, enrollment_history, classes_attended, created_at')
    .eq('school_id', schoolId)
    .eq('original_parent_id', parent.id)
    .order('created_at', { ascending: false });
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json(toCC(data ?? []));
}

// Phase C — per-child attendance history for parents. Archive-gated;
// parents of schools without the archive feature don't get a history view.
// Ownership is enforced by checking the requested student belongs to the
// authenticated parent's children list.
export async function getChildAttendanceHistory(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { id } = req.params;
  if (!(await hasArchiveFeature(schoolId))) {
    res.status(403).json({ error: 'Archive feature is not enabled for this school' });
    return;
  }
  const { studentIds } = await getParentAndChildren(req.db!, userId, schoolId);
  if (!studentIds.includes(String(id))) { res.status(404).json({ error: 'Child not found' }); return; }
  const { data: student } = await req.db!
    .from('students')
    .select('id, full_name, is_graduated, class_id, classes(name)')
    .eq('id', id).eq('school_id', schoolId).maybeSingle();
  if (!student) { res.status(404).json({ error: 'Child not found' }); return; }
  const history = await buildAttendanceHistory(schoolId, String(id));
  res.json({ student: toCC(student), ...history });
}

export async function getChildAttendanceDays(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { id } = req.params;
  const year = String((req.query as Record<string, string>).year || '');
  if (!year) { res.status(400).json({ error: 'year is required' }); return; }
  if (!(await hasArchiveFeature(schoolId))) {
    res.status(403).json({ error: 'Archive feature is not enabled for this school' });
    return;
  }
  const { studentIds } = await getParentAndChildren(req.db!, userId, schoolId);
  if (!studentIds.includes(String(id))) { res.status(404).json({ error: 'Child not found' }); return; }
  const result = await loadAttendanceDaysForYear(schoolId, String(id), year);
  if (!result) { res.status(404).json({ error: 'No enrollment for that academic year' }); return; }
  res.json(result);
}

export async function getArchivedChild(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { id } = req.params;
  const { data: parent } = await req.db!.from('parents').select('id').eq('user_id', userId).eq('school_id', schoolId).single();
  if (!parent) { res.status(404).json({ error: 'Record not found' }); return; }

  const { data, error } = await req.db!
    .from('archived_students')
    .select('id, full_name, date_of_birth, enrollment_date, departure_date, reason, enrollment_history, classes_attended, grades, payment_history, created_at')
    .eq('id', id)
    .eq('school_id', schoolId)
    .eq('original_parent_id', parent.id)  // ownership: parent can only read their own child
    .single();
  if (error || !data) { res.status(404).json({ error: 'Record not found' }); return; }
  res.json(toCC(data));
}

export async function getHomework(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { studentId, subject } = req.query as Record<string, string>;

  const { studentIds } = await getParentAndChildren(req.db!, userId, schoolId);
  if (studentIds.length === 0) { res.json([]); return; }

  // Get class IDs for the children
  const { data: students } = await req.db!.from('students').select('class_id').in('id', studentId ? [studentId] : studentIds);
  const classIds = students?.map(s => s.class_id).filter(Boolean) ?? [];

  let query = req.db!.from('homework').select('*, classes(name)').eq('school_id', schoolId).in('class_id', classIds).order('created_at', { ascending: false });
  if (subject) query = query.eq('subject', subject);

  const { data, error } = await query;
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json(toCC(data));
}

export async function getAssignments(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { studentId, subject } = req.query as Record<string, string>;

  const { studentIds } = await getParentAndChildren(req.db!, userId, schoolId);
  if (studentIds.length === 0) { res.json([]); return; }

  const targetStudentIds = studentId ? [studentId] : studentIds;

  // Also get the class IDs of the children so we can fetch class-wide assignments
  const { data: studentRecords } = await req.db!
    .from('students')
    .select('id, class_id')
    .in('id', targetStudentIds)
    .eq('school_id', schoolId);
  const classIds = (studentRecords || []).map(s => s.class_id).filter(Boolean) as string[];

  // Fetch assignments assigned to specific student OR class-wide (student_id IS NULL) for their class
  let q1 = req.db!
    .from('assignments')
    .select('*, students(full_name), classes(name)')
    .eq('school_id', schoolId)
    .in('student_id', targetStudentIds)
    .order('created_at', { ascending: false });

  let q2 = req.db!
    .from('assignments')
    .select('*, students(full_name), classes(name)')
    .eq('school_id', schoolId)
    .is('student_id', null)
    .in('class_id', classIds.length > 0 ? classIds : ['00000000-0000-0000-0000-000000000000'])
    .order('created_at', { ascending: false });

  if (subject) {
    q1 = q1.eq('subject', subject);
    q2 = q2.eq('subject', subject);
  }

  const [res1, res2] = await Promise.all([q1, q2]);

  if (res1.error) { res.status(500).json({ error: res1.error.message }); return; }
  if (res2.error) { res.status(500).json({ error: res2.error.message }); return; }

  // Merge and deduplicate
  const all = [...(res1.data || []), ...(res2.data || [])];
  const seen = new Set<string>();
  const unique = all.filter(a => { if (seen.has(a.id)) return false; seen.add(a.id); return true; });
  unique.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  res.json(toCC(unique));
}

export async function getAnnouncements(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { limit, cursor } = parseCursorParams(req.query as Record<string, unknown>);
  const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

  let query = req.db!.from('announcements')
    .select('*, users:created_by(id, first_name, last_name, role, profile_picture)')
    .eq('school_id', schoolId)
    // Students don't log in — their parents represent them, so parents also
    // see 'students'-targeted announcements.
    .in('target_audience', ['all', 'parents', 'students'])
    .gte('created_at', cutoff);
  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  const page = buildPage((data ?? []) as { id: string; created_at: string }[], limit);
  const decorated = await decorateAnnouncements(page.data, userId);
  res.json({ data: toCC(decorated), limit: page.limit, nextCursor: page.nextCursor });
}

export async function getHomeworkById(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  const { data, error } = await req.db!.from('homework').select('*, classes(name)').eq('id', id).eq('school_id', schoolId).single();
  if (error || !data) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(toCC(data));
}

export async function getAssignmentById(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  const { data, error } = await req.db!.from('assignments').select('*, students(full_name), classes(name)').eq('id', id).eq('school_id', schoolId).single();
  if (error || !data) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(toCC(data));
}

export async function getAnnouncementById(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { id } = req.params;
  const { data, error } = await req.db!.from('announcements')
    .select('*, users:created_by(id, first_name, last_name, role, profile_picture)')
    .eq('id', id)
    .eq('school_id', schoolId)
    .single();
  if (error || !data) { res.status(404).json({ error: 'Not found' }); return; }
  const decorated = await decorateAnnouncements([data], userId);
  res.json(toCC(decorated[0]));
}

export async function getReportById(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  const { data, error } = await req.db!.from('reports').select('*, students(id, full_name), teachers(full_name)').eq('id', id).eq('school_id', schoolId).single();
  if (error || !data) { res.status(404).json({ error: 'Not found' }); return; }
  const studentId = (data as any).students?.id ?? (data as any).student_id;
  if (studentId) {
    const lock = await isFeatureLocked(studentId, 'reports');
    if (lock.locked) { res.status(403).json({ error: 'feature_locked', feature: 'reports', reason: lock.reason }); return; }
  }
  res.json(toCC(data));
}

export async function getReport(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { studentId, subject } = req.query as Record<string, string>;

  const { studentIds } = await getParentAndChildren(req.db!, userId, schoolId);
  if (studentIds.length === 0) { res.json([]); return; }

  const targetIds = studentId ? [studentId] : studentIds;

  // If a specific student is targeted and reports are locked for them, surface
  // a 403 the frontend can render as a "Contact school" state.
  if (studentId) {
    const lock = await isFeatureLocked(studentId, 'reports');
    if (lock.locked) { res.status(403).json({ error: 'feature_locked', feature: 'reports', reason: lock.reason }); return; }
  }

  // Otherwise (list across all kids), silently exclude any student whose
  // reports are locked — a single locked child shouldn't blank the whole list.
  const locks = await getLocksForStudents(targetIds);
  const allowed = targetIds.filter(id => !(locks.get(id)?.has('reports') ?? false));
  if (allowed.length === 0) { res.json([]); return; }

  let query = req.db!.from('reports').select('*, students(full_name), teachers(full_name)').eq('school_id', schoolId).in('student_id', allowed).order('created_at', { ascending: false });
  if (subject) query = query.eq('subject', subject);

  const { data, error } = await query;
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json(toCC(data));
}

export async function getGrades(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { studentId } = req.query as Record<string, string>;

  const { studentIds } = await getParentAndChildren(req.db!, userId, schoolId);
  if (studentIds.length === 0) { res.json([]); return; }

  // If a specific child is requested it must belong to this parent — don't
  // silently fall back to another child (that would leak the wrong record).
  if (studentId && !(studentIds as string[]).includes(studentId)) {
    res.status(403).json({ error: 'Not your student' });
    return;
  }
  const targetId = studentId || studentIds[0];

  const lock = await isFeatureLocked(targetId, 'grades');
  if (lock.locked) { res.status(403).json({ error: 'feature_locked', feature: 'grades', reason: lock.reason }); return; }

  // Release gate: parents only ever see grades an admin has released.
  const { data, error } = await req.db!
    .from('grades')
    .select('id, subject, marks, daily_grade, quiz_grade, monthly_exam_grade, term_exam_grade, grading_period, academic_year, admin_note, created_at')
    .eq('school_id', schoolId)
    .eq('student_id', targetId)
    .eq('is_released', true)
    .order('academic_year', { ascending: false })
    .order('grading_period');
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json(toCC(data));
}

export async function getBusLocation(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { studentId } = req.query as Record<string, string>;

  const { studentIds } = await getParentAndChildren(req.db!, userId, schoolId);
  if (studentIds.length === 0) { res.status(404).json({ error: 'No students found' }); return; }

  // If a specific student was requested, use that; otherwise find the first child with a driver
  let student: { id: string; driver_id: string | null; home_latitude: number | null; home_longitude: number | null } | null = null;
  if (studentId) {
    const { data } = await req.db!.from('students').select('id, driver_id, home_latitude, home_longitude').eq('id', studentId).eq('school_id', schoolId).single();
    student = data;
  } else {
    // Try each child until we find one with a driver
    const { data: allChildren } = await req.db!.from('students').select('id, driver_id, home_latitude, home_longitude').in('id', studentIds).eq('school_id', schoolId);
    student = allChildren?.find(s => s.driver_id) || allChildren?.[0] || null;
  }
  if (!student?.driver_id) { res.status(404).json({ error: 'No driver assigned' }); return; }

  // Check if student was marked absent for today's drive
  const { data: driverRecord } = await req.db!.from('drivers').select('excluded_student_ids').eq('id', student.driver_id).single();
  const excludedIds: string[] = (driverRecord as any)?.excluded_student_ids || [];
  if (excludedIds.includes(student.id)) {
    res.status(404).json({ error: 'Your child is marked absent today and is not on the bus.' });
    return;
  }

  const { data: location } = await req.db!.from('bus_locations')
    .select('*, drivers(full_name, phone_number, license_number, vehicle_type, buses(bus_number))')
    .eq('driver_id', student.driver_id)
    .eq('school_id', schoolId)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .single();

  // Only return data if the most recent record is an active drive within the last 5 minutes
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  if (!location || !location.is_driving || new Date(location.recorded_at).getTime() < fiveMinutesAgo) {
    res.status(404).json({ error: 'inactive' }); return;
  }

  res.json(toCC({
    location,
    studentHome: { latitude: student.home_latitude, longitude: student.home_longitude },
  }));
}

export async function getDriverInfo(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { studentId } = req.query as Record<string, string>;
  const { studentIds } = await getParentAndChildren(req.db!, userId, schoolId);
  if (studentIds.length === 0) { res.status(404).json({ error: 'No students found' }); return; }

  let driverId: string | null = null;
  if (studentId) {
    const { data } = await req.db!.from('students').select('driver_id').eq('id', studentId).eq('school_id', schoolId).single();
    driverId = data?.driver_id ?? null;
  } else {
    const { data: allChildren } = await req.db!.from('students').select('driver_id').in('id', studentIds).eq('school_id', schoolId);
    driverId = allChildren?.find(s => s.driver_id)?.driver_id ?? null;
  }
  if (!driverId) { res.status(404).json({ error: 'No driver assigned' }); return; }

  const { data: driver } = await req.db!.from('drivers')
    .select('full_name, phone_number, license_number, vehicle_type, buses(bus_number)')
    .eq('id', driverId).single();
  if (!driver) { res.status(404).json({ error: 'Driver not found' }); return; }
  res.json(toCC(driver));
}

export async function getNotifications(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { limit, cursor } = parseCursorParams(req.query as Record<string, unknown>);

  const { data: user } = await req.db!.from('users').select('id').eq('id', userId).single();
  if (!user) { res.json({ data: [], limit, nextCursor: null }); return; }

  const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  let query = req.db!.from('notifications')
    .select('*').eq('school_id', schoolId).eq('user_id', userId)
    .gte('created_at', cutoff);

  // Composite keyset: older than the cursor row in (created_at, id) order.
  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1); // over-fetch one to detect "has more"
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  res.json(buildPage(toCC(data) as { id: string; createdAt: string }[], limit));
}

export async function markNotificationRead(req: AuthRequest, res: Response): Promise<void> {
  const { userId } = req.user!;
  const { id } = req.params;
  await req.db!.from('notifications').update({ is_read: true }).eq('id', id).eq('user_id', userId);
  res.json({ success: true });
}

export async function markAllNotificationsRead(req: AuthRequest, res: Response): Promise<void> {
  const { userId, schoolId } = req.user!;
  const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  await req.db!.from('notifications').update({ is_read: true }).eq('user_id', userId).eq('school_id', schoolId).eq('is_read', false).gte('created_at', cutoff);
  res.json({ success: true });
}

export async function getUnreadCount(req: AuthRequest, res: Response): Promise<void> {
  const { userId, schoolId } = req.user!;
  const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const { count } = await req.db!.from('notifications').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('school_id', schoolId).eq('is_read', false).gte('created_at', cutoff);
  res.json({ count: count ?? 0 });
}

export async function getContentUnreadCounts(req: AuthRequest, res: Response): Promise<void> {
  const { userId, schoolId } = req.user!;
  const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const q = (type: string) => req.db!.from('notifications').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('school_id', schoolId).eq('is_read', false).eq('notification_type', type).gte('created_at', cutoff);
  const [hw, as_, rp, bk, ps, gr] = await Promise.all([q('homework'), q('assignment'), q('report'), q('appointment'), q('post'), q('grade')]);
  res.json({ homework: hw.count ?? 0, assignment: as_.count ?? 0, report: rp.count ?? 0, booking: bk.count ?? 0, post: ps.count ?? 0, grade: gr.count ?? 0 });
}

export async function markTypeRead(req: AuthRequest, res: Response): Promise<void> {
  const { userId, schoolId } = req.user!;
  const type = req.params.type as string;
  if (!['homework', 'assignment', 'report', 'appointment', 'post', 'grade', 'announcement'].includes(type)) { res.status(400).json({ error: 'Invalid type' }); return; }
  await req.db!.from('notifications').update({ is_read: true }).eq('user_id', userId).eq('school_id', schoolId).eq('notification_type', type).eq('is_read', false);
  res.json({ success: true });
}

export async function getAppointments(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { data: parent } = await req.db!.from('parents').select('id').eq('user_id', userId).eq('school_id', schoolId).single();
  if (!parent) { res.json([]); return; }
  const { data, error } = await req.db!.from('appointments')
    .select('*').eq('school_id', schoolId).eq('parent_id', parent.id)
    .order('created_at', { ascending: false });
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json(toCC(data));
}

export async function updatePickupLocation(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { latitude, longitude, residenceType, blockNumber } = req.body;
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    res.status(400).json({ error: 'latitude and longitude are required numbers' }); return;
  }
  const update: Record<string, any> = { latitude, longitude };
  if (residenceType !== undefined) update.residence_type = residenceType;
  if (blockNumber !== undefined) update.block_number = blockNumber;
  const { error } = await req.db!.from('parents').update(update).eq('user_id', userId).eq('school_id', schoolId);
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json({ success: true });
}

export async function getPickupLocation(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { data, error } = await req.db!.from('parents')
    .select('latitude, longitude, residence_type, block_number')
    .eq('user_id', userId).eq('school_id', schoolId).single();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json({
    latitude: data?.latitude ?? null,
    longitude: data?.longitude ?? null,
    residenceType: (data as any)?.residence_type ?? null,
    blockNumber: (data as any)?.block_number ?? null,
  });
}

export async function createAppointment(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { reason, message, requestedDate, studentIds } = req.body;

  const { data: parent } = await req.db!.from('parents').select('id').eq('user_id', userId).eq('school_id', schoolId).single();
  if (!parent) { res.status(404).json({ error: 'Parent not found' }); return; }

  const { data, error } = await req.db!.from('appointments').insert({
    school_id: schoolId,
    parent_id: parent.id,
    reason,
    message,
    requested_date: requestedDate || null,
    student_ids: studentIds,
  }).select().single();

  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  emitToAdmins(schoolId, 'new_appointment', { appointmentId: data.id });

  res.status(201).json(toCC(data));
}

// Phase D — parent completes a supervisor invite into a real booking (the
// parent supplies their reason + preferred date). invited → pending, landing
// in reception's queue.
export async function completeInvite(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { id } = req.params;
  const { reason, message, requestedDate } = req.body;

  const { data: parent } = await req.db!.from('parents').select('id').eq('user_id', userId).eq('school_id', schoolId).single();
  if (!parent) { res.status(404).json({ error: 'Parent not found' }); return; }

  const { data, error } = await req.db!.from('appointments')
    .update({ reason: reason || null, message: message || null, requested_date: requestedDate || null, status: 'pending' })
    .eq('id', id).eq('school_id', schoolId).eq('parent_id', parent.id).eq('status', 'invited')
    .select().maybeSingle();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  if (!data) { res.status(404).json({ error: 'Invite not found or already handled.' }); return; }

  emitToAdmins(schoolId, 'new_appointment', { appointmentId: data.id });
  res.json(toCC(data));
}

// Phase D — parent declines a supervisor invite. The supervisor is notified.
export async function declineInvite(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { id } = req.params;

  const { data: parent } = await req.db!.from('parents').select('id, full_name').eq('user_id', userId).eq('school_id', schoolId).single();
  if (!parent) { res.status(404).json({ error: 'Parent not found' }); return; }

  const { data, error } = await req.db!.from('appointments')
    .update({ status: 'rejected', response_message: 'Declined by parent.' })
    .eq('id', id).eq('school_id', schoolId).eq('parent_id', parent.id).eq('status', 'invited')
    .select().maybeSingle();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  if (!data) { res.status(404).json({ error: 'Invite not found or already handled.' }); return; }

  const supervisorId = (data as { invited_by?: string }).invited_by;
  if (supervisorId) {
    notify({
      schoolId, userId: supervisorId,
      title: 'Meeting invite declined',
      message: `${parent.full_name || 'A parent'} declined your meeting invitation.`,
      type: 'appointment',
      relatedId: String(id),
    }).catch(() => {});
  }
  res.json(toCC(data));
}
