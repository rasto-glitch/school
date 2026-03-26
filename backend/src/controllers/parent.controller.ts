import { Response } from 'express';
import { supabase } from '../config/supabase';
import type { AuthRequest } from '../middleware/auth';
import { toCC } from '../utils/transform';

async function getParentAndChildren(userId: string, schoolId: string) {
  const { data: parent } = await supabase.from('parents').select('id').eq('user_id', userId).eq('school_id', schoolId).single();
  if (!parent) return { parent: null, studentIds: [] };
  const { data: students } = await supabase.from('students').select('id').eq('parent_id', parent.id).eq('school_id', schoolId);
  return { parent, studentIds: students?.map(s => s.id) ?? [] };
}

export async function getChildren(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { data: parent } = await supabase.from('parents').select('id').eq('user_id', userId).eq('school_id', schoolId).single();
  if (!parent) { res.status(404).json({ error: 'Parent not found' }); return; }

  const { data, error } = await supabase.from('students').select('id, full_name, profile_picture, classes(name), drivers(full_name, phone_number, license_number, buses(bus_number))').eq('parent_id', parent.id).eq('school_id', schoolId);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(toCC(data));
}

export async function getHomework(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { studentId, subject } = req.query as Record<string, string>;

  const { studentIds } = await getParentAndChildren(userId, schoolId);
  if (studentIds.length === 0) { res.json([]); return; }

  // Get class IDs for the children
  const { data: students } = await supabase.from('students').select('class_id').in('id', studentId ? [studentId] : studentIds);
  const classIds = students?.map(s => s.class_id).filter(Boolean) ?? [];

  let query = supabase.from('homework').select('*, classes(name)').eq('school_id', schoolId).in('class_id', classIds).order('created_at', { ascending: false });
  if (subject) query = query.eq('subject', subject);

  const { data, error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(toCC(data));
}

export async function getAssignments(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { studentId, subject } = req.query as Record<string, string>;

  const { studentIds } = await getParentAndChildren(userId, schoolId);
  if (studentIds.length === 0) { res.json([]); return; }

  const targetStudentIds = studentId ? [studentId] : studentIds;

  // Also get the class IDs of the children so we can fetch class-wide assignments
  const { data: studentRecords } = await supabase
    .from('students')
    .select('id, class_id')
    .in('id', targetStudentIds)
    .eq('school_id', schoolId);
  const classIds = (studentRecords || []).map(s => s.class_id).filter(Boolean) as string[];

  // Fetch assignments assigned to specific student OR class-wide (student_id IS NULL) for their class
  let q1 = supabase
    .from('assignments')
    .select('*, students(full_name), classes(name)')
    .eq('school_id', schoolId)
    .in('student_id', targetStudentIds)
    .order('created_at', { ascending: false });

  let q2 = supabase
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
  const { schoolId } = req.user!;
  const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase.from('announcements')
    .select('*')
    .eq('school_id', schoolId)
    .in('target_audience', ['all', 'parents'])
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(toCC(data));
}

export async function getHomeworkById(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  const { data, error } = await supabase.from('homework').select('*, classes(name)').eq('id', id).eq('school_id', schoolId).single();
  if (error || !data) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(toCC(data));
}

export async function getAssignmentById(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  const { data, error } = await supabase.from('assignments').select('*, students(full_name), classes(name)').eq('id', id).eq('school_id', schoolId).single();
  if (error || !data) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(toCC(data));
}

export async function getAnnouncementById(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  const { data, error } = await supabase.from('announcements').select('*').eq('id', id).eq('school_id', schoolId).single();
  if (error || !data) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(toCC(data));
}

export async function getReportById(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  const { data, error } = await supabase.from('reports').select('*, students(full_name), teachers(full_name)').eq('id', id).eq('school_id', schoolId).single();
  if (error || !data) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(toCC(data));
}

export async function getReport(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { studentId, subject } = req.query as Record<string, string>;

  const { studentIds } = await getParentAndChildren(userId, schoolId);
  if (studentIds.length === 0) { res.json([]); return; }

  const targetIds = studentId ? [studentId] : studentIds;
  let query = supabase.from('reports').select('*, students(full_name), teachers(full_name)').eq('school_id', schoolId).in('student_id', targetIds).order('created_at', { ascending: false });
  if (subject) query = query.eq('subject', subject);

  const { data, error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(toCC(data));
}

export async function getGrades(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { studentId } = req.query as Record<string, string>;

  const { studentIds } = await getParentAndChildren(userId, schoolId);
  if (studentIds.length === 0) { res.json([]); return; }

  const targetId = studentId && (studentIds as string[]).includes(studentId) ? studentId : studentIds[0];

  const { data, error } = await supabase
    .from('grades')
    .select('id, subject, daily_grade, quiz_grade, monthly_exam_grade, term_exam_grade, grading_period, academic_year, created_at')
    .eq('school_id', schoolId)
    .eq('student_id', targetId)
    .order('academic_year', { ascending: false })
    .order('grading_period');
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(toCC(data));
}

export async function getBusLocation(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { studentId } = req.query as Record<string, string>;

  const { studentIds } = await getParentAndChildren(userId, schoolId);
  const targetId = studentId || studentIds[0];
  if (!targetId) { res.status(404).json({ error: 'No students found' }); return; }

  const { data: student } = await supabase.from('students').select('driver_id, home_latitude, home_longitude').eq('id', targetId).eq('school_id', schoolId).single();
  if (!student?.driver_id) { res.status(404).json({ error: 'No driver assigned' }); return; }

  // Check if student was marked absent for today's drive
  const { data: driverRecord } = await supabase.from('drivers').select('excluded_student_ids').eq('id', student.driver_id).single();
  const excludedIds: string[] = (driverRecord as any)?.excluded_student_ids || [];
  if (excludedIds.includes(targetId)) {
    res.status(404).json({ error: 'Your child is marked absent today and is not on the bus.' });
    return;
  }

  const { data: location } = await supabase.from('bus_locations')
    .select('*, drivers(full_name, phone_number, license_number, vehicle_type, buses(bus_number))')
    .eq('driver_id', student.driver_id)
    .eq('school_id', schoolId)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .single();

  // Only return data if the most recent record is an active drive within the last 5 minutes
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  if (!location || !location.is_driving || location.recorded_at < fiveMinutesAgo) {
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
  const { studentIds } = await getParentAndChildren(userId, schoolId);
  const targetId = studentId || studentIds[0];
  if (!targetId) { res.status(404).json({ error: 'No students found' }); return; }
  const { data: student } = await supabase.from('students').select('driver_id').eq('id', targetId).eq('school_id', schoolId).single();
  if (!student?.driver_id) { res.status(404).json({ error: 'No driver assigned' }); return; }
  const { data: driver } = await supabase.from('drivers')
    .select('full_name, phone_number, license_number, vehicle_type, buses(bus_number)')
    .eq('id', student.driver_id).single();
  if (!driver) { res.status(404).json({ error: 'Driver not found' }); return; }
  res.json(toCC(driver));
}

export async function getNotifications(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { data: user } = await supabase.from('users').select('id').eq('id', userId).single();
  if (!user) { res.json([]); return; }

  const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase.from('notifications')
    .select('*').eq('school_id', schoolId).eq('user_id', userId)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(toCC(data));
}

export async function markNotificationRead(req: AuthRequest, res: Response): Promise<void> {
  const { userId } = req.user!;
  const { id } = req.params;
  await supabase.from('notifications').update({ is_read: true }).eq('id', id).eq('user_id', userId);
  res.json({ success: true });
}

export async function markAllNotificationsRead(req: AuthRequest, res: Response): Promise<void> {
  const { userId, schoolId } = req.user!;
  const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  await supabase.from('notifications').update({ is_read: true }).eq('user_id', userId).eq('school_id', schoolId).eq('is_read', false).gte('created_at', cutoff);
  res.json({ success: true });
}

export async function getUnreadCount(req: AuthRequest, res: Response): Promise<void> {
  const { userId, schoolId } = req.user!;
  const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const { count } = await supabase.from('notifications').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('school_id', schoolId).eq('is_read', false).gte('created_at', cutoff);
  res.json({ count: count ?? 0 });
}

export async function getContentUnreadCounts(req: AuthRequest, res: Response): Promise<void> {
  const { userId, schoolId } = req.user!;
  const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const q = (type: string) => supabase.from('notifications').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('school_id', schoolId).eq('is_read', false).eq('notification_type', type).gte('created_at', cutoff);
  const [hw, as_, rp, bk] = await Promise.all([q('homework'), q('assignment'), q('report'), q('appointment')]);
  res.json({ homework: hw.count ?? 0, assignment: as_.count ?? 0, report: rp.count ?? 0, booking: bk.count ?? 0 });
}

export async function markTypeRead(req: AuthRequest, res: Response): Promise<void> {
  const { userId, schoolId } = req.user!;
  const type = req.params.type as string;
  if (!['homework', 'assignment', 'report', 'appointment'].includes(type)) { res.status(400).json({ error: 'Invalid type' }); return; }
  await supabase.from('notifications').update({ is_read: true }).eq('user_id', userId).eq('school_id', schoolId).eq('notification_type', type).eq('is_read', false);
  res.json({ success: true });
}

export async function getAppointments(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { data: parent } = await supabase.from('parents').select('id').eq('user_id', userId).eq('school_id', schoolId).single();
  if (!parent) { res.json([]); return; }
  const { data, error } = await supabase.from('appointments')
    .select('*').eq('school_id', schoolId).eq('parent_id', parent.id)
    .order('created_at', { ascending: false });
  if (error) { res.status(500).json({ error: error.message }); return; }
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
  const { error } = await supabase.from('parents').update(update).eq('user_id', userId).eq('school_id', schoolId);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ success: true });
}

export async function getPickupLocation(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { data, error } = await supabase.from('parents')
    .select('latitude, longitude, residence_type, block_number')
    .eq('user_id', userId).eq('school_id', schoolId).single();
  if (error) { res.status(500).json({ error: error.message }); return; }
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

  const { data: parent } = await supabase.from('parents').select('id').eq('user_id', userId).eq('school_id', schoolId).single();
  if (!parent) { res.status(404).json({ error: 'Parent not found' }); return; }

  const { data, error } = await supabase.from('appointments').insert({
    school_id: schoolId,
    parent_id: parent.id,
    reason,
    message,
    requested_date: requestedDate,
    student_ids: studentIds,
  }).select().single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(201).json(toCC(data));
}
