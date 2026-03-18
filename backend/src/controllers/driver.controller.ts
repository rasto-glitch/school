import { Response } from 'express';
import { supabase } from '../config/supabase';
import type { AuthRequest } from '../middleware/auth';
import { Server as SocketServer } from 'socket.io';
import { toCC } from '../utils/transform';
import { notifyMany } from '../utils/notify';

// Proximity threshold levels (in ascending urgency)
type ProxThreshold = '5min' | '2min' | 'arriving';
const THRESH_RANK: Record<ProxThreshold, number> = { '5min': 1, '2min': 2, 'arriving': 3 };

// In-memory dedup: driverId → { studentId → last notified threshold }
// Cleared on startDrive / stopDrive; lost on server restart (acceptable)
const proximityState = new Map<string, Map<string, ProxThreshold>>();

// Haversine distance in miles
function distanceMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export async function getMyStudents(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { search } = req.query as Record<string, string>;

  const { data: driver } = await supabase.from('drivers').select('id').eq('user_id', userId).eq('school_id', schoolId).single();
  if (!driver) { res.status(404).json({ error: 'Driver not found' }); return; }

  let query = supabase.from('students')
    .select('id, full_name, home_address, home_latitude, home_longitude, phone_number, parents(full_name, phone_number)')
    .eq('driver_id', driver.id)
    .eq('school_id', schoolId)
    .eq('is_graduated', false);

  if (search) query = query.ilike('full_name', `%${search}%`);

  const { data, error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(toCC(data));
}

export async function updateLocation(req: AuthRequest, res: Response, io?: SocketServer): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { latitude, longitude, speed, heading, isDriving } = req.body;

  const { data: driver } = await supabase.from('drivers').select('id, bus_id, excluded_student_ids').eq('user_id', userId).eq('school_id', schoolId).single();
  if (!driver) { res.status(404).json({ error: 'Driver not found' }); return; }

  // Save location
  const { error } = await supabase.from('bus_locations').insert({
    school_id: schoolId,
    driver_id: driver.id,
    bus_id: driver.bus_id,
    latitude,
    longitude,
    speed: speed || 0,
    heading: heading || 0,
    is_driving: isDriving !== false,
  });

  if (error) { res.status(500).json({ error: error.message }); return; }

  // Check proximity and send notifications
  if (isDriving) {
    const excluded: string[] = (driver as any).excluded_student_ids || [];
    let studentsQuery = supabase
      .from('students')
      .select('id, home_latitude, home_longitude, parents(user_id)')
      .eq('driver_id', driver.id)
      .eq('school_id', schoolId)
      .eq('is_graduated', false);
    if (excluded.length > 0) {
      studentsQuery = (studentsQuery as any).not('id', 'in', `(${excluded.join(',')})`);
    }
    const { data: students } = await studentsQuery;

    if (students) {
      for (const student of students) {
        if (!student.home_latitude || !student.home_longitude) continue;
        const dist = distanceMiles(latitude, longitude, student.home_latitude, student.home_longitude);

        let notifTitle = '';
        let notifMsg = '';

        let threshold: ProxThreshold | null = null;
        if (dist <= 0.2) {
          threshold = 'arriving';
          notifTitle = 'Your Child Has Arrived';
          notifMsg = 'Your child has arrived.';
        } else if (dist <= 0.5) {
          threshold = '2min';
          notifTitle = 'Bus 2 Minutes Away';
          notifMsg = 'Your kid is 2 minutes away.';
        } else if (dist <= 1.0) {
          threshold = '5min';
          notifTitle = 'Bus 5 Minutes Away';
          notifMsg = 'Your kid is 5 minutes away.';
        }

        // Dedup: only notify if this threshold is more urgent than the last one sent
        if (threshold) {
          const driverState = proximityState.get(driver.id) ?? new Map<string, ProxThreshold>();
          proximityState.set(driver.id, driverState);
          const lastThreshold = driverState.get(student.id);
          if (lastThreshold && THRESH_RANK[threshold] <= THRESH_RANK[lastThreshold]) {
            notifTitle = '';
            notifMsg = '';
          } else if (notifTitle) {
            driverState.set(student.id, threshold);
          }
        }

        if (notifTitle && student.parents) {
          const parentUserIds = Array.isArray(student.parents)
            ? (student.parents as any[]).map((p: any) => p.user_id)
            : [(student.parents as any).user_id];

          // Notify parents via DB + socket + push
          await notifyMany(parentUserIds.map((uid: string) => ({
            schoolId, userId: uid, title: notifTitle, message: notifMsg, type: 'bus',
          })));

          // Also emit busAlert so the app can show an in-app banner
          if (io) {
            parentUserIds.forEach((uid: string) => {
              io.to(`school:${schoolId}:user:${uid}`).emit('busAlert', { title: notifTitle, message: notifMsg, latitude, longitude });
            });
          }
        }
      }
    }
  }

  // Broadcast new location to all clients watching this driver (school-scoped room)
  if (io) {
    io.to(`school:${schoolId}:driver:${driver.id}`).emit('locationUpdate', { driverId: driver.id, latitude, longitude, speed, heading, isDriving });
  }

  res.json({ success: true });
}

export async function startDrive(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { excludedStudentIds = [] } = req.body;

  const { data: driver } = await supabase.from('drivers').select('id').eq('user_id', userId).eq('school_id', schoolId).single();
  if (!driver) { res.status(404).json({ error: 'Driver not found' }); return; }

  // Persist excluded students so the backend can filter them throughout the drive
  const { error } = await supabase.from('drivers').update({ excluded_student_ids: excludedStudentIds }).eq('id', driver.id);
  if (error) { res.status(500).json({ error: error.message }); return; }

  // Reset proximity dedup for this drive session
  proximityState.set(driver.id, new Map());

  // Notify all parents of students on this driver's route
  let studentsQuery = supabase
    .from('students')
    .select('parents(user_id)')
    .eq('driver_id', driver.id)
    .eq('school_id', schoolId)
    .eq('is_graduated', false);
  if (excludedStudentIds.length > 0) {
    studentsQuery = (studentsQuery as any).not('id', 'in', `(${excludedStudentIds.join(',')})`);
  }
  const { data: students } = await studentsQuery;
  if (students) {
    const parentUserIds = students
      .map((s: any) => (Array.isArray(s.parents) ? s.parents.map((p: any) => p.user_id) : s.parents ? [s.parents.user_id] : []))
      .flat()
      .filter(Boolean) as string[];
    const uniqueParentIds = [...new Set(parentUserIds)];
    notifyMany(uniqueParentIds.map(uid => ({
      schoolId, userId: uid,
      title: 'Bus Is On The Way',
      message: 'Your child\'s bus has started the route and is heading your way.',
      type: 'bus',
    }))).catch(() => {});
  }

  res.json({ message: 'Drive started', driverId: driver.id });
}

export async function stopDrive(req: AuthRequest, res: Response, io?: SocketServer): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { data: driver } = await supabase.from('drivers').select('id, bus_id').eq('user_id', userId).eq('school_id', schoolId).single();
  if (!driver) { res.status(404).json({ error: 'Driver not found' }); return; }

  // Clear excluded students list and proximity state when drive ends
  await supabase.from('drivers').update({ excluded_student_ids: [] }).eq('id', driver.id);
  proximityState.delete(driver.id);

  // Insert a "stopped" location record
  const { data: lastLoc } = await supabase.from('bus_locations')
    .select('latitude, longitude').eq('driver_id', driver.id).order('recorded_at', { ascending: false }).limit(1).single();

  if (lastLoc) {
    await supabase.from('bus_locations').insert({
      school_id: schoolId,
      driver_id: driver.id,
      bus_id: driver.bus_id,
      latitude: lastLoc.latitude,
      longitude: lastLoc.longitude,
      is_driving: false,
    });
  }

  if (io) {
    io.to(`school:${schoolId}:driver:${driver.id}`).emit('driveEnded', { driverId: driver.id });
  }

  res.json({ message: 'Drive stopped' });
}
