import { Response } from 'express';
import type { AuthRequest } from '../middleware/auth';
import { Server as SocketServer } from 'socket.io';
import { toCC } from '../utils/transform';
import { notifyMany } from '../utils/notify';

// Proximity threshold levels (in ascending urgency)
type ProxThreshold = '10min' | '5min' | '2min' | 'arriving';
const THRESH_RANK: Record<ProxThreshold, number> = { '10min': 1, '5min': 2, '2min': 3, 'arriving': 4 };

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

export async function getMyProfile(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { data, error } = await req.db!
    .from('drivers')
    .select('full_name, phone_number, license_number, buses(bus_number)')
    .eq('user_id', userId)
    .eq('school_id', schoolId)
    .single();
  if (error || !data) { res.status(404).json({ error: 'Driver not found' }); return; }
  res.json(toCC(data));
}

export async function getMyStudents(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { search } = req.query as Record<string, string>;

  const { data: driver } = await req.db!.from('drivers').select('id').eq('user_id', userId).eq('school_id', schoolId).single();
  if (!driver) { res.status(404).json({ error: 'Driver not found' }); return; }

  let query = req.db!.from('students')
    .select('id, full_name, home_address, home_latitude, home_longitude, phone_number, parents(full_name, phone_number, residence_type, block_number)')
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

  const { data: driver } = await req.db!.from('drivers').select('id, bus_id, excluded_student_ids').eq('user_id', userId).eq('school_id', schoolId).single();
  if (!driver) { res.status(404).json({ error: 'Driver not found' }); return; }

  // Save location (non-fatal — a write failure must not block proximity notifications)
  await req.db!.from('bus_locations').insert({
    school_id: schoolId,
    driver_id: driver.id,
    bus_id: driver.bus_id,
    latitude,
    longitude,
    speed: speed || 0,
    heading: heading || 0,
    is_driving: isDriving !== false,
  });

  // Check proximity and send notifications
  if (isDriving) {
    const excluded: string[] = (driver as any).excluded_student_ids || [];
    let studentsQuery = req.db!
      .from('students')
      .select('id, parents(id, user_id, latitude, longitude)')
      .eq('driver_id', driver.id)
      .eq('school_id', schoolId)
      .eq('is_graduated', false);
    if (excluded.length > 0) {
      studentsQuery = (studentsQuery as any).not('id', 'in', `(${excluded.join(',')})`);
    }
    const { data: students } = await studentsQuery;

    if (students) {
      // Accumulate threshold-crossings and dispatch in a single batched notifyMany at the end.
      // Calling notifyMany per student inside this loop turned every location POST into
      // N sequential DB round-trips (3-5s p95 with 60 students).
      const pendingNotifs: { schoolId: string; userId: string; title: string; message: string; type: string }[] = [];

      for (const student of students) {
        const parent = Array.isArray(student.parents) ? student.parents[0] : student.parents;
        if (!parent?.user_id) continue;

        // Parent hasn't set their pickup location — skip proximity (they were already notified at drive start)
        if (!parent.latitude || !parent.longitude) continue;

        const dist = distanceMiles(latitude, longitude, parent.latitude, parent.longitude);

        let notifTitle = '';
        let notifMsg = '';
        let threshold: ProxThreshold | null = null;

        if (dist <= 0.1) {
          threshold = 'arriving';
          notifTitle = 'Your Child Has Arrived';
          notifMsg = 'Your child has arrived.';
        } else if (dist <= 0.5) {
          threshold = '2min';
          notifTitle = 'Bus 2 Minutes Away';
          notifMsg = 'Your child is 2 minutes away.';
        } else if (dist <= 1.5) {
          threshold = '5min';
          notifTitle = 'Bus 5 Minutes Away';
          notifMsg = 'Your child is 5 minutes away.';
        } else if (dist <= 2.5) {
          threshold = '10min';
          notifTitle = 'Bus 10 Minutes Away';
          notifMsg = 'Your child is 10 minutes away.';
        }

        // Dedup: only notify if this threshold is more urgent than the last one sent
        if (threshold) {
          const driverState = proximityState.get(driver.id) ?? new Map<string, ProxThreshold>();
          proximityState.set(driver.id, driverState);
          const lastThreshold = driverState.get(student.id);
          if (lastThreshold && THRESH_RANK[threshold] <= THRESH_RANK[lastThreshold]) {
            notifTitle = '';
          } else if (notifTitle) {
            driverState.set(student.id, threshold);
          }
        }

        if (notifTitle) {
          pendingNotifs.push({ schoolId, userId: parent.user_id, title: notifTitle, message: notifMsg, type: 'bus' });
          if (io) {
            io.to(`school:${schoolId}:user:${parent.user_id}`).emit('busAlert', { title: notifTitle, message: notifMsg, latitude, longitude });
          }
        }
      }

      if (pendingNotifs.length > 0) {
        await notifyMany(pendingNotifs);
      }
    }
  }

  // Broadcast new location to all clients watching this driver (school-scoped room)
  if (io) {
    io.to(`school:${schoolId}:driver:${driver.id}`).emit('locationUpdate', { driverId: driver.id, latitude, longitude, speed, heading, isDriving });
  }

  res.json({ success: true });
}

// ---- TODAY'S SCHOOL ATTENDANCE FOR DRIVER'S STUDENTS ----
export async function getTodayAttendance(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const today = new Date().toISOString().split('T')[0];

  const { data: driver } = await req.db!.from('drivers').select('id').eq('user_id', userId).eq('school_id', schoolId).single();
  if (!driver) { res.status(404).json({ error: 'Driver not found' }); return; }

  const { data: students } = await req.db!
    .from('students').select('id')
    .eq('driver_id', driver.id).eq('school_id', schoolId).eq('is_graduated', false);

  const studentIds = (students || []).map((s: any) => s.id);
  if (studentIds.length === 0) { res.json([]); return; }

  const { data, error } = await req.db!
    .from('attendance')
    .select('student_id, status, notes')
    .eq('school_id', schoolId)
    .eq('date', today)
    .in('student_id', studentIds)
    .in('status', ['absent', 'excused']);

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(toCC(data || []));
}

export async function startDrive(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;

  // studentRides: { studentId, rodeBus, exclusionReason?, schoolAttendanceStatus? }[]
  const { studentRides = [] } = req.body as {
    studentRides: {
      studentId: string;
      rodeBus: boolean;
      exclusionReason?: 'school_absent' | 'went_home_with_parents';
      schoolAttendanceStatus?: string;
    }[];
  };

  const { data: driver } = await req.db!.from('drivers').select('id').eq('user_id', userId).eq('school_id', schoolId).single();
  if (!driver) { res.status(404).json({ error: 'Driver not found' }); return; }

  const today = new Date().toISOString().split('T')[0];

  // Save per-student bus ride records (upsert — safe to re-start a drive)
  if (studentRides.length > 0) {
    await req.db!.from('bus_ride_records').upsert(
      studentRides.map(r => ({
        school_id: schoolId,
        driver_id: driver.id,
        student_id: r.studentId,
        date: today,
        rode_bus: r.rodeBus,
        exclusion_reason: r.rodeBus ? null : (r.exclusionReason ?? null),
        school_attendance_status: r.schoolAttendanceStatus ?? null,
      })),
      { onConflict: 'student_id,date' }
    );
  }

  // Derive excluded IDs for proximity-alert filtering (existing logic unchanged)
  const excludedStudentIds = studentRides.filter(r => !r.rodeBus).map(r => r.studentId);

  // Persist excluded students so the backend can filter them throughout the drive
  const { error } = await req.db!.from('drivers').update({ excluded_student_ids: excludedStudentIds }).eq('id', driver.id);
  if (error) { res.status(500).json({ error: error.message }); return; }

  // Reset proximity dedup for this drive session
  proximityState.set(driver.id, new Map());

  // Notify all parents of students on this driver's route
  let studentsQuery = req.db!
    .from('students')
    .select('parents(user_id, latitude, longitude)')
    .eq('driver_id', driver.id)
    .eq('school_id', schoolId)
    .eq('is_graduated', false);
  if (excludedStudentIds.length > 0) {
    studentsQuery = (studentsQuery as any).not('id', 'in', `(${excludedStudentIds.join(',')})`);
  }
  const { data: students } = await studentsQuery;
  if (students) {
    const parents = students
      .map((s: any) => (Array.isArray(s.parents) ? s.parents[0] : s.parents))
      .filter(Boolean);
    const seen = new Set<string>();
    const withLocation: string[] = [];
    const noLocation: string[] = [];
    for (const p of parents) {
      if (!p.user_id || seen.has(p.user_id)) continue;
      seen.add(p.user_id);
      if (p.latitude && p.longitude) withLocation.push(p.user_id);
      else noLocation.push(p.user_id);
    }
    // Notify all: bus is on the way
    const allIds = [...withLocation, ...noLocation];
    if (allIds.length > 0) {
      notifyMany(allIds.map(uid => ({
        schoolId, userId: uid,
        title: 'Bus Is On The Way',
        message: "Your child's bus has started the route and is heading your way.",
        type: 'bus',
      }))).catch(() => {});
    }
    // Also prompt parents without a pickup location to set one
    if (noLocation.length > 0) {
      notifyMany(noLocation.map(uid => ({
        schoolId, userId: uid,
        title: 'Set Your Pickup Location',
        message: 'Open the app and set your location to receive bus proximity alerts.',
        type: 'bus',
      }))).catch(() => {});
    }
  }

  res.json({ message: 'Drive started', driverId: driver.id });
}

export async function stopDrive(req: AuthRequest, res: Response, io?: SocketServer): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { data: driver } = await req.db!.from('drivers').select('id, bus_id').eq('user_id', userId).eq('school_id', schoolId).single();
  if (!driver) { res.status(404).json({ error: 'Driver not found' }); return; }

  // Clear excluded students list and proximity state when drive ends
  await req.db!.from('drivers').update({ excluded_student_ids: [] }).eq('id', driver.id);
  proximityState.delete(driver.id);

  // Insert a "stopped" location record
  const { data: lastLoc } = await req.db!.from('bus_locations')
    .select('latitude, longitude').eq('driver_id', driver.id).order('recorded_at', { ascending: false }).limit(1).single();

  if (lastLoc) {
    await req.db!.from('bus_locations').insert({
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
