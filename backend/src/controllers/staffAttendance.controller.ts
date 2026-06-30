import { Response } from 'express';
import type { AuthRequest } from '../middleware/auth';
import { adminDb as supabase } from '../utils/db';
import { safeDbErrorMessage, safeDbErrorStatus } from '../utils/dbErrors';
import { logAudit } from '../utils/audit';
import { getSchoolTimezone, todayInTimezone } from '../utils/attendance';
import { emitToAdmins } from '../utils/notify';
import { toCC } from '../utils/transform';
import {
  makeKioskToken, verifyKioskToken, staffAttendanceConfigured,
} from '../utils/staffAttendanceToken';

// Staff (employee) QR attendance — Phase 1 core (migration 063).
//
// A SEPARATE domain from STUDENT attendance. Reception's web dashboard shows a
// rotating QR (GET /staff-attendance/kiosk-token); an employee scans it with
// the app and POSTs {token, latitude, longitude} to /staff-attendance/scan.
// The server validates three things — (1) the HMAC token is for THIS school in
// the current/previous 60s window, (2) the device is inside the geofence, and
// (3) a toggle resolves check-in vs check-out from the day's open row.
//
// Elevated client (adminDb) with explicit `.eq('school_id', schoolId)` tenant
// scoping on every query, matching admin.controller / attention.controller.
// Management surfaces (board, review, corrections, leave) land in Phase 4/5.

const DEFAULT_SCHEDULE_DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday'];

interface Geofence { lat: number | null; lng: number | null; radiusMeters: number }
interface Schedule { startTime: string; endTime: string; lateGraceMinutes: number }
interface StaffAttendanceConfig { geofence: Geofence; schedule: Schedule }

// Defensive read of the JSONB config column — tolerates partial / legacy shapes
// and always returns a fully-populated object the handlers can rely on.
function normalizeConfig(raw: unknown): StaffAttendanceConfig {
  const r = (raw ?? {}) as { geofence?: Partial<Geofence>; schedule?: Partial<Schedule> };
  const g = r.geofence ?? {};
  const s = r.schedule ?? {};
  return {
    geofence: {
      lat: typeof g.lat === 'number' ? g.lat : null,
      lng: typeof g.lng === 'number' ? g.lng : null,
      radiusMeters: typeof g.radiusMeters === 'number' && g.radiusMeters > 0 ? g.radiusMeters : 250,
    },
    schedule: {
      startTime: typeof s.startTime === 'string' ? s.startTime : '08:00',
      endTime: typeof s.endTime === 'string' ? s.endTime : '15:00',
      lateGraceMinutes: typeof s.lateGraceMinutes === 'number' ? s.lateGraceMinutes : 15,
    },
  };
}

// Great-circle distance in metres between two lat/lng points (haversine).
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Today's weekday name (lowercase, e.g. "sunday") in the school's timezone, to
// compare against schools.schedule_days.
function weekdayInTz(tz: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' })
    .format(new Date())
    .toLowerCase();
}

// Current local clock time as "HH:MM" (24h) in the school's timezone.
function localHm(tz: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date());
}

// "HH:MM" + N minutes, clamped within the day. Used to derive the late cutoff
// (start time + grace) for the is_late comparison.
function addMinutes(hm: string, minutes: number): string {
  const [h, m] = hm.split(':').map(Number);
  const total = Math.max(0, Math.min(23 * 60 + 59, (h || 0) * 60 + (m || 0) + minutes));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// ════════════════════════════════════════════════════════════════════════════
// GET /staff-attendance/kiosk-token  (reception) — rotating QR for the desk display
// ════════════════════════════════════════════════════════════════════════════
export async function getKioskToken(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  if (!staffAttendanceConfigured()) {
    res.status(503).json({ error: 'Staff attendance is not configured on the server.', code: 'NOT_CONFIGURED' });
    return;
  }
  const { data: school, error } = await supabase
    .from('schools').select('features').eq('id', schoolId).single();
  if (error || !school) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  const features = (school.features ?? {}) as Record<string, boolean>;
  if (features.staff_attendance !== true) {
    res.status(403).json({ error: 'Staff attendance is not enabled for this school.', code: 'FEATURE_OFF' });
    return;
  }
  const token = makeKioskToken(schoolId);
  if (!token) { res.status(503).json({ error: 'Staff attendance is not configured on the server.', code: 'NOT_CONFIGURED' }); return; }
  res.json(token);
}

// ════════════════════════════════════════════════════════════════════════════
// POST /staff-attendance/scan  (any employee role) — token + geofence + toggle
// ════════════════════════════════════════════════════════════════════════════
export async function scan(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { token, latitude, longitude } = req.body as { token: string; latitude: number; longitude: number };

  if (!staffAttendanceConfigured()) {
    res.status(503).json({ error: 'Staff attendance is not configured on the server.', code: 'NOT_CONFIGURED' });
    return;
  }

  const { data: school, error: schoolErr } = await supabase
    .from('schools')
    .select('features, staff_attendance_config, schedule_days, timezone')
    .eq('id', schoolId)
    .single();
  if (schoolErr || !school) { res.status(safeDbErrorStatus(schoolErr)).json({ error: safeDbErrorMessage(schoolErr) }); return; }

  const features = (school.features ?? {}) as Record<string, boolean>;
  if (features.staff_attendance !== true) {
    res.status(403).json({ error: 'Staff attendance is not enabled for this school.', code: 'FEATURE_OFF' });
    return;
  }

  const cfg = normalizeConfig(school.staff_attendance_config);
  if (cfg.geofence.lat == null || cfg.geofence.lng == null) {
    res.status(503).json({ error: 'The school location has not been set yet.', code: 'NO_GEOFENCE' });
    return;
  }

  // 1) Token — current/previous 60s window, signed for THIS school.
  const verdict = verifyKioskToken(token, schoolId);
  if (!verdict.ok) {
    switch (verdict.reason) {
      case 'expired':
        res.status(400).json({ error: 'This QR code has expired. Please scan the latest one on the screen.', code: 'TOKEN_EXPIRED' }); return;
      case 'wrong_school':
        res.status(403).json({ error: 'This QR code belongs to a different school.', code: 'WRONG_SCHOOL' }); return;
      case 'unconfigured':
        res.status(503).json({ error: 'Staff attendance is not configured on the server.', code: 'NOT_CONFIGURED' }); return;
      default:
        res.status(400).json({ error: 'Invalid QR code.', code: 'INVALID_TOKEN' }); return;
    }
  }

  // 2) Geofence — hard reject outside the radius.
  const distanceMeters = haversineMeters(latitude, longitude, cfg.geofence.lat, cfg.geofence.lng);
  if (distanceMeters > cfg.geofence.radiusMeters) {
    res.status(403).json({
      error: 'You are outside the school area. Move closer and scan again.',
      code: 'OUTSIDE_GEOFENCE',
      distanceMeters: Math.round(distanceMeters),
      radiusMeters: cfg.geofence.radiusMeters,
    });
    return;
  }

  // 3) Toggle — resolve check-in vs check-out from today's open row (school tz).
  const tz = (school.timezone as string) || 'Asia/Baghdad';
  const workDate = todayInTimezone(tz);
  const nowIso = new Date().toISOString();

  const { data: existing } = await supabase
    .from('staff_attendance')
    .select('id, status')
    .eq('school_id', schoolId)
    .eq('user_id', userId)
    .eq('work_date', workDate)
    .maybeSingle();

  // No row yet → check IN (+ compute is_late on working days).
  if (!existing) {
    const scheduleDays = (school.schedule_days as string[] | null) ?? DEFAULT_SCHEDULE_DAYS;
    const isWorkingDay = scheduleDays.includes(weekdayInTz(tz));
    const isLate = isWorkingDay && localHm(tz) > addMinutes(cfg.schedule.startTime, cfg.schedule.lateGraceMinutes);

    const { error: insErr } = await supabase
      .from('staff_attendance')
      .insert({
        school_id: schoolId, user_id: userId, work_date: workDate,
        check_in_at: nowIso, check_in_lat: latitude, check_in_lng: longitude,
        check_in_method: 'qr', status: 'open', is_late: isLate,
      });
    if (insErr) {
      // Unique(school,user,work_date) violation = a near-simultaneous scan from
      // the SAME user already created today's row (double-fire). Re-read and
      // return that row's state idempotently — a double-fire must never be
      // silently turned into a check-OUT of the just-created check-in.
      if ((insErr as { code?: string }).code === '23505') {
        const { data: raced } = await supabase
          .from('staff_attendance')
          .select('status, check_in_at, is_late')
          .eq('school_id', schoolId).eq('user_id', userId).eq('work_date', workDate)
          .maybeSingle();
        if (raced && raced.status === 'open') {
          res.json({
            action: 'check_in', workDate, status: 'open',
            isLate: !!raced.is_late, checkInAt: raced.check_in_at,
            distanceMeters: Math.round(distanceMeters),
          });
          return;
        }
        res.status(409).json({ error: 'You have already checked out for today.', code: 'ALREADY_CLOSED' });
        return;
      }
      res.status(safeDbErrorStatus(insErr)).json({ error: safeDbErrorMessage(insErr) });
      return;
    }
    emitToAdmins(schoolId, 'staff_attendance:update', { userId, action: 'check_in', workDate, isLate });
    res.json({ action: 'check_in', workDate, status: 'open', isLate, checkInAt: nowIso, distanceMeters: Math.round(distanceMeters) });
    return;
  }

  // Open row → check OUT.
  if (existing.status === 'open') {
    const { error: updErr } = await supabase
      .from('staff_attendance')
      .update({
        check_out_at: nowIso, check_out_lat: latitude, check_out_lng: longitude,
        check_out_method: 'qr', status: 'closed',
      })
      .eq('id', existing.id)
      .eq('school_id', schoolId);
    if (updErr) { res.status(safeDbErrorStatus(updErr)).json({ error: safeDbErrorMessage(updErr) }); return; }
    emitToAdmins(schoolId, 'staff_attendance:update', { userId, action: 'check_out', workDate });
    res.json({ action: 'check_out', workDate, status: 'closed', checkOutAt: nowIso, distanceMeters: Math.round(distanceMeters) });
    return;
  }

  // Already closed / auto-closed → nothing more to do today (multi-punch = Phase 2).
  res.status(409).json({ error: 'You have already checked out for today.', code: 'ALREADY_CLOSED' });
}

// ════════════════════════════════════════════════════════════════════════════
// GET /staff-attendance/me  (any employee role) — today's status + recent history
// ════════════════════════════════════════════════════════════════════════════
export async function getMyAttendance(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const tz = await getSchoolTimezone(schoolId);
  const today = todayInTimezone(tz);

  const { data, error } = await supabase
    .from('staff_attendance')
    .select('id, work_date, check_in_at, check_out_at, status, is_late, flagged, flag_reason')
    .eq('school_id', schoolId)
    .eq('user_id', userId)
    .order('work_date', { ascending: false })
    .limit(30);
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  const rows = (data ?? []) as { work_date: string }[];
  const todayRow = rows.find(r => r.work_date === today) ?? null;
  res.json({ today: todayRow ? toCC(todayRow) : null, history: rows.map(toCC) });
}

// ════════════════════════════════════════════════════════════════════════════
// GET /staff-attendance/config  (staff_attendance.manage) — current settings
// ════════════════════════════════════════════════════════════════════════════
export async function getConfig(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { data: school, error } = await supabase
    .from('schools').select('features, staff_attendance_config').eq('id', schoolId).single();
  if (error || !school) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  const features = (school.features ?? {}) as Record<string, boolean>;
  const cfg = normalizeConfig(school.staff_attendance_config);
  res.json({
    // Premium feature: provisioned per school by the platform (like tuition_fees).
    // The admin can configure the pin/schedule but never enable the feature.
    provisioned: features.staff_attendance === true,
    serverConfigured: staffAttendanceConfigured(),
    geofence: cfg.geofence,
    schedule: cfg.schedule,
  });
}

// ════════════════════════════════════════════════════════════════════════════
// PUT /staff-attendance/config  (staff_attendance.manage) — pin / schedule only
// (premium: the feature itself is provisioned per school by the platform; a
//  school admin configures it but can never turn it on/off)
// ════════════════════════════════════════════════════════════════════════════
export async function updateConfig(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const body = req.body as {
    geofence?: { lat: number; lng: number; radiusMeters?: number };
    schedule?: { startTime: string; endTime: string; lateGraceMinutes: number };
  };

  const { data: school, error } = await supabase
    .from('schools').select('features, staff_attendance_config').eq('id', schoolId).single();
  if (error || !school) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  // Premium gate: staff attendance is a paid feature provisioned per school by
  // the platform (like tuition_fees). The admin configures the pin/schedule but
  // can NEVER turn the feature on/off, so editing config requires it to already
  // be provisioned.
  const features = (school.features ?? {}) as Record<string, boolean>;
  if (features.staff_attendance !== true) {
    res.status(403).json({ error: "Staff attendance is not included in this school's plan.", code: 'NOT_PROVISIONED' });
    return;
  }

  const before = normalizeConfig(school.staff_attendance_config);
  const next = normalizeConfig(school.staff_attendance_config);

  if (body.geofence !== undefined) {
    next.geofence = {
      lat: body.geofence.lat,
      lng: body.geofence.lng,
      radiusMeters: body.geofence.radiusMeters ?? before.geofence.radiusMeters,
    };
  }
  if (body.schedule !== undefined) {
    if (body.schedule.endTime <= body.schedule.startTime) {
      res.status(400).json({ error: 'End of day must be after the start time.', code: 'BAD_SCHEDULE' });
      return;
    }
    next.schedule = {
      startTime: body.schedule.startTime,
      endTime: body.schedule.endTime,
      lateGraceMinutes: body.schedule.lateGraceMinutes,
    };
  }

  if (JSON.stringify(next) === JSON.stringify(before)) {
    res.status(400).json({ error: 'Nothing to update.' });
    return;
  }

  // Only the config column is ever written here — never `features` (that flag is
  // the platform-controlled premium gate). So this never bumps features_version.
  const { error: updErr } = await supabase
    .from('schools').update({ staff_attendance_config: next }).eq('id', schoolId);
  if (updErr) { res.status(safeDbErrorStatus(updErr)).json({ error: safeDbErrorMessage(updErr) }); return; }

  await logAudit({
    req, entityType: 'staff_attendance', entityId: schoolId, action: 'update',
    before: { staff_attendance_config: before },
    after: { staff_attendance_config: next },
    label: 'Staff attendance settings',
  });

  res.json({
    provisioned: true,
    serverConfigured: staffAttendanceConfigured(),
    geofence: next.geofence,
    schedule: next.schedule,
  });
}
