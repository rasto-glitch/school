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
    .select('id, status, check_in_at, is_late')
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

  // Open row → check OUT — unless the check-in was moments ago. A second scan
  // within the dwell window is almost always a "did it register?" re-scan at
  // the reception screen, not a real end of the workday; treating it as a
  // check-out locked the employee out for the rest of the day (multi-punch is
  // Phase 2) until an admin correction. Return the check-in state
  // idempotently instead — same shape as the double-fire INSERT guard above.
  const MIN_DWELL_MS = 5 * 60 * 1000;
  if (existing.status === 'open') {
    const checkedInMs = existing.check_in_at ? new Date(existing.check_in_at as string).getTime() : NaN;
    if (Number.isFinite(checkedInMs) && Date.now() - checkedInMs < MIN_DWELL_MS) {
      res.json({
        action: 'check_in', workDate, status: 'open',
        isLate: !!existing.is_late, checkInAt: existing.check_in_at,
        distanceMeters: Math.round(distanceMeters),
      });
      return;
    }
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

// ════════════════════════════════════════════════════════════════════════════
// Management surfaces (Phase 4) — admin only (capability `staff_attendance.manage`).
// Board / review queue / corrections / leave / CSV export. Every handler is
// premium-gated: staff attendance is provisioned per school by the platform, so
// a school whose `features.staff_attendance` is not `true` gets 403 NOT_PROVISIONED
// (mirrors updateConfig). Tenant-scoped: every query chains `.eq('school_id', …)`.
// ════════════════════════════════════════════════════════════════════════════

// Roles that clock in (everyone except parents). The board's "expected" set =
// the ACTIVE users in these roles; only these roles can ever own an attendance
// or leave row, so a single `.in('role', …)` query also names every row.
const EMPLOYEE_ROLES = ['teacher', 'supervisor', 'admin', 'accountant', 'reception', 'driver', 'staff'] as const;

interface EmployeeLite { id: string; name: string; role: string; jobTitle: string | null; isActive: boolean }

// Loads every employee-role user for the school (active and inactive). The
// caller filters `isActive` for the "expected" roster; the full set is the name
// source for attendance/leave rows (a user can be deactivated after clocking in
// but keeps their role, so they stay in this set).
async function loadEmployees(schoolId: string): Promise<EmployeeLite[]> {
  const { data, error } = await supabase
    .from('users')
    .select('id, first_name, last_name, role, job_title, is_active')
    .eq('school_id', schoolId)
    .in('role', EMPLOYEE_ROLES as unknown as string[]);
  if (error) throw error;
  return (data ?? []).map((u: Record<string, unknown>) => ({
    id: u.id as string,
    name: `${(u.first_name as string) ?? ''} ${(u.last_name as string) ?? ''}`.trim() || 'Unnamed',
    role: u.role as string,
    jobTitle: (u.job_title as string | null) ?? null,
    isActive: u.is_active !== false,
  }));
}

// Lowercase weekday name (e.g. "sunday") for a calendar date string. The
// weekday of a calendar date is timezone-independent — anchor at noon UTC to
// avoid any date-boundary rounding.
function weekdayOfDate(dateStr: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long' })
    .format(new Date(`${dateStr}T12:00:00Z`))
    .toLowerCase();
}

// Quote a value for a CSV cell (RFC-4180): wrap in double quotes and double any
// embedded quote. Always-quote keeps commas/newlines/leading-zeros intact in
// every spreadsheet.
function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

// Uniform error response for a caught (unknown-typed) DB error thrown inside a
// try block — the safeDbError* helpers want the Supabase error shape.
function fail(res: Response, e: unknown): void {
  const err = e as Parameters<typeof safeDbErrorStatus>[0];
  res.status(safeDbErrorStatus(err)).json({ error: safeDbErrorMessage(err) });
}

// Loads the school, enforces the premium gate, and returns the bits every
// management handler needs. On a non-provisioned school (or a missing row) it
// writes the error response and returns null — the caller just `if (!ctx) return`.
interface ManageCtx { schoolId: string; userId: string; tz: string; scheduleDays: string[]; cfg: StaffAttendanceConfig }
async function requireProvisioned(req: AuthRequest, res: Response): Promise<ManageCtx | null> {
  const { schoolId, userId } = req.user!;
  const { data: school, error } = await supabase
    .from('schools')
    .select('features, staff_attendance_config, schedule_days, timezone')
    .eq('id', schoolId)
    .single();
  if (error || !school) {
    res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) });
    return null;
  }
  const features = (school.features ?? {}) as Record<string, boolean>;
  if (features.staff_attendance !== true) {
    res.status(403).json({ error: "Staff attendance is not included in this school's plan.", code: 'NOT_PROVISIONED' });
    return null;
  }
  return {
    schoolId,
    userId,
    tz: (school.timezone as string) || 'Asia/Baghdad',
    scheduleDays: (school.schedule_days as string[] | null) ?? DEFAULT_SCHEDULE_DAYS,
    cfg: normalizeConfig(school.staff_attendance_config),
  };
}

// ── GET /staff-attendance/employees — roster for the leave-add picker ────────
export async function getEmployees(req: AuthRequest, res: Response): Promise<void> {
  const ctx = await requireProvisioned(req, res);
  if (!ctx) return;
  try {
    const employees = (await loadEmployees(ctx.schoolId))
      .filter(e => e.isActive)
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json({ employees: employees.map(({ id, name, role, jobTitle }) => ({ id, name, role, jobTitle })) });
  } catch (e) {
    fail(res, e);
  }
}

// Shared day computation behind GET /board (full lists) and GET /summary (lean
// counts + late list for the admin dashboard card). Throws on DB error so the
// caller's try/catch maps it to a response.
async function buildBoard(ctx: ManageCtx, date: string) {
  const { schoolId } = ctx;
  const isWorkingDay = ctx.scheduleDays.includes(weekdayOfDate(date));

  const employees = await loadEmployees(schoolId);
  const byId = new Map(employees.map(e => [e.id, e]));
  const activeRoster = employees.filter(e => e.isActive);

  const { data: rows, error: rowsErr } = await supabase
    .from('staff_attendance')
    .select('id, user_id, check_in_at, check_out_at, status, is_late, flagged, flag_reason')
    .eq('school_id', schoolId)
    .eq('work_date', date);
  if (rowsErr) throw rowsErr;

  const { data: leave, error: leaveErr } = await supabase
    .from('staff_leave')
    .select('id, user_id, leave_type, start_date, end_date, note')
    .eq('school_id', schoolId)
    .lte('start_date', date)
    .gte('end_date', date);
  if (leaveErr) throw leaveErr;

  const nameOf = (uid: string) => byId.get(uid) ?? { name: 'Unknown', role: '—', jobTitle: null };

  const presentIds = new Set<string>();
  const present = (rows ?? []).map((r: Record<string, unknown>) => {
    const uid = r.user_id as string;
    presentIds.add(uid);
    const e = nameOf(uid);
    return {
      attendanceId: r.id as string,
      userId: uid,
      name: e.name, role: e.role, jobTitle: e.jobTitle,
      checkInAt: r.check_in_at as string | null,
      checkOutAt: r.check_out_at as string | null,
      status: r.status as string,
      isLate: r.is_late === true,
      flagged: r.flagged === true,
      flagReason: (r.flag_reason as string | null) ?? null,
    };
  }).sort((a, b) => (a.checkInAt ?? '').localeCompare(b.checkInAt ?? ''));

  // On-leave = a leave marker covering the date for someone who did NOT clock
  // in. If they scanned anyway, the attendance row wins (they're "present").
  const onLeave = (leave ?? [])
    .filter((l: Record<string, unknown>) => !presentIds.has(l.user_id as string))
    .map((l: Record<string, unknown>) => {
      const uid = l.user_id as string;
      const e = nameOf(uid);
      return {
        leaveId: l.id as string,
        userId: uid,
        name: e.name, role: e.role, jobTitle: e.jobTitle,
        leaveType: l.leave_type as string,
        startDate: l.start_date as string,
        endDate: l.end_date as string,
        note: (l.note as string | null) ?? null,
      };
    });
  const onLeaveIds = new Set(onLeave.map(l => l.userId));

  // Absent = active roster minus present minus on-leave. Only meaningful on a
  // working day (a holiday/weekend has no expectation to be in).
  const absent = isWorkingDay
    ? activeRoster
        .filter(e => !presentIds.has(e.id) && !onLeaveIds.has(e.id))
        .map(({ id, name, role, jobTitle }) => ({ userId: id, name, role, jobTitle }))
    : [];

  return {
    date,
    isWorkingDay,
    schedule: ctx.cfg.schedule,
    counts: {
      total: activeRoster.length,
      present: present.length,
      late: present.filter(p => p.isLate).length,
      absent: absent.length,
      onLeave: onLeave.length,
    },
    present,
    absent,
    onLeave,
  };
}

// ── GET /staff-attendance/board?date= — the day board (present/late/absent/leave) ─
export async function getBoard(req: AuthRequest, res: Response): Promise<void> {
  const ctx = await requireProvisioned(req, res);
  if (!ctx) return;
  const date = (req.query.date as string) || todayInTimezone(ctx.tz);
  try {
    res.json(await buildBoard(ctx, date));
  } catch (e) {
    fail(res, e);
  }
}

// ── GET /staff-attendance/summary?date= — lean counts + who's late ───────────
// Powers the admin dashboard card (Phase 5). Same gate as the board; the card
// refetches this on every `staff_attendance:update` socket event.
export async function getSummary(req: AuthRequest, res: Response): Promise<void> {
  const ctx = await requireProvisioned(req, res);
  if (!ctx) return;
  const date = (req.query.date as string) || todayInTimezone(ctx.tz);
  try {
    const board = await buildBoard(ctx, date);
    res.json({
      date: board.date,
      isWorkingDay: board.isWorkingDay,
      counts: board.counts,
      // Who is late today — name + check-in time for the card's detail line.
      late: board.present
        .filter(p => p.isLate)
        .map(p => ({ userId: p.userId, name: p.name, role: p.role, jobTitle: p.jobTitle, checkInAt: p.checkInAt })),
      serverConfigured: staffAttendanceConfigured(),
    });
  } catch (e) {
    fail(res, e);
  }
}

// ── GET /staff-attendance/review — flagged / auto-closed rows needing a look ──
export async function getReview(req: AuthRequest, res: Response): Promise<void> {
  const ctx = await requireProvisioned(req, res);
  if (!ctx) return;
  const { schoolId } = ctx;
  try {
    const { data: rows, error } = await supabase
      .from('staff_attendance')
      .select('id, user_id, work_date, check_in_at, check_out_at, status, is_late, flagged, flag_reason')
      .eq('school_id', schoolId)
      .or('flagged.eq.true,status.eq.auto_closed')
      .is('corrected_at', null)
      .order('work_date', { ascending: false })
      .limit(200);
    if (error) throw error;

    const employees = await loadEmployees(schoolId);
    const byId = new Map(employees.map(e => [e.id, e]));

    res.json({
      rows: (rows ?? []).map((r: Record<string, unknown>) => {
        const e = byId.get(r.user_id as string) ?? { name: 'Unknown', role: '—', jobTitle: null };
        return {
          attendanceId: r.id as string,
          userId: r.user_id as string,
          name: e.name, role: e.role, jobTitle: e.jobTitle,
          workDate: r.work_date as string,
          checkInAt: r.check_in_at as string | null,
          checkOutAt: r.check_out_at as string | null,
          status: r.status as string,
          isLate: r.is_late === true,
          flagged: r.flagged === true,
          flagReason: (r.flag_reason as string | null) ?? null,
        };
      }),
    });
  } catch (e) {
    fail(res, e);
  }
}

// ── PATCH /staff-attendance/:id — manual correction of a punch ───────────────
export async function correct(req: AuthRequest, res: Response): Promise<void> {
  const ctx = await requireProvisioned(req, res);
  if (!ctx) return;
  const { schoolId, userId } = ctx;
  const id = req.params.id as string;
  const body = req.body as {
    checkInAt?: string | null;
    checkOutAt?: string | null;
    status?: 'open' | 'closed' | 'auto_closed';
    isLate?: boolean;
    resolveFlag?: boolean;
    note: string;
  };

  const { data: row, error } = await supabase
    .from('staff_attendance')
    .select('id, user_id, work_date, check_in_at, check_out_at, status, is_late, flagged, flag_reason')
    .eq('id', id)
    .eq('school_id', schoolId)
    .maybeSingle();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  if (!row) { res.status(404).json({ error: 'Attendance record not found.' }); return; }

  const nextCheckIn = body.checkInAt !== undefined ? body.checkInAt : (row.check_in_at as string | null);
  const nextCheckOut = body.checkOutAt !== undefined ? body.checkOutAt : (row.check_out_at as string | null);
  if (nextCheckIn && nextCheckOut && new Date(nextCheckOut) < new Date(nextCheckIn)) {
    res.status(400).json({ error: 'Check-out cannot be before check-in.', code: 'BAD_TIMES' });
    return;
  }

  const update: Record<string, unknown> = {
    corrected_by: userId,
    corrected_at: new Date().toISOString(),
    correction_note: body.note,
  };
  if (body.checkInAt !== undefined) update.check_in_at = body.checkInAt;
  if (body.checkOutAt !== undefined) update.check_out_at = body.checkOutAt;
  if (body.status !== undefined) update.status = body.status;
  if (body.isLate !== undefined) update.is_late = body.isLate;
  if (body.resolveFlag === true) update.flagged = false;

  const { data: updated, error: updErr } = await supabase
    .from('staff_attendance')
    .update(update)
    .eq('id', id)
    .eq('school_id', schoolId)
    .select('id, user_id, work_date, check_in_at, check_out_at, status, is_late, flagged, flag_reason')
    .single();
  if (updErr) { res.status(safeDbErrorStatus(updErr)).json({ error: safeDbErrorMessage(updErr) }); return; }

  await logAudit({
    req, entityType: 'staff_attendance', entityId: id, action: 'update',
    before: {
      check_in_at: row.check_in_at, check_out_at: row.check_out_at,
      status: row.status, is_late: row.is_late, flagged: row.flagged,
    },
    after: {
      check_in_at: updated.check_in_at, check_out_at: updated.check_out_at,
      status: updated.status, is_late: updated.is_late, flagged: updated.flagged,
    },
    label: 'Staff attendance correction',
  });

  emitToAdmins(schoolId, 'staff_attendance:update', {
    userId: updated.user_id, action: 'correction', workDate: updated.work_date,
  });
  res.json({ ok: true });
}

// ── GET /staff-attendance/leave?from=&to= — leave markers ────────────────────
// With from+to: every marker overlapping that window. Without: current + future
// (end_date >= today) for the management list's default view.
export async function listLeave(req: AuthRequest, res: Response): Promise<void> {
  const ctx = await requireProvisioned(req, res);
  if (!ctx) return;
  const { schoolId } = ctx;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;

  try {
    let q = supabase
      .from('staff_leave')
      .select('id, user_id, start_date, end_date, leave_type, note, created_at')
      .eq('school_id', schoolId);
    if (from && to) {
      q = q.lte('start_date', to).gte('end_date', from);
    } else {
      q = q.gte('end_date', todayInTimezone(ctx.tz));
    }
    const { data: rows, error } = await q.order('start_date', { ascending: false }).limit(300);
    if (error) throw error;

    const employees = await loadEmployees(schoolId);
    const byId = new Map(employees.map(e => [e.id, e]));

    res.json({
      leave: (rows ?? []).map((l: Record<string, unknown>) => {
        const e = byId.get(l.user_id as string) ?? { name: 'Unknown', role: '—', jobTitle: null };
        return {
          id: l.id as string,
          userId: l.user_id as string,
          name: e.name, role: e.role, jobTitle: e.jobTitle,
          startDate: l.start_date as string,
          endDate: l.end_date as string,
          leaveType: l.leave_type as string,
          note: (l.note as string | null) ?? null,
          createdAt: l.created_at as string,
        };
      }),
    });
  } catch (e) {
    fail(res, e);
  }
}

// ── POST /staff-attendance/leave — add a leave marker ────────────────────────
export async function createLeave(req: AuthRequest, res: Response): Promise<void> {
  const ctx = await requireProvisioned(req, res);
  if (!ctx) return;
  const { schoolId, userId } = ctx;
  const body = req.body as {
    userId: string; startDate: string; endDate: string;
    leaveType: string; note?: string | null;
  };

  // The leave target must be an employee-role user of THIS school.
  const { data: target, error: tErr } = await supabase
    .from('users')
    .select('id, role')
    .eq('id', body.userId)
    .eq('school_id', schoolId)
    .maybeSingle();
  if (tErr) { res.status(safeDbErrorStatus(tErr)).json({ error: safeDbErrorMessage(tErr) }); return; }
  if (!target || !(EMPLOYEE_ROLES as unknown as string[]).includes(target.role as string)) {
    res.status(400).json({ error: 'That user is not an employee at this school.', code: 'BAD_TARGET' });
    return;
  }

  const { data: created, error } = await supabase
    .from('staff_leave')
    .insert({
      school_id: schoolId, user_id: body.userId,
      start_date: body.startDate, end_date: body.endDate,
      leave_type: body.leaveType, note: body.note ?? null,
      created_by: userId,
    })
    .select('id, user_id, start_date, end_date, leave_type, note, created_at')
    .single();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  await logAudit({
    req, entityType: 'staff_leave', entityId: created.id, action: 'create',
    before: null,
    after: { user_id: created.user_id, start_date: created.start_date, end_date: created.end_date, leave_type: created.leave_type },
    label: 'Staff leave added',
  });

  res.status(201).json({ id: created.id });
}

// ── DELETE /staff-attendance/leave/:id — remove a leave marker ───────────────
export async function deleteLeave(req: AuthRequest, res: Response): Promise<void> {
  const ctx = await requireProvisioned(req, res);
  if (!ctx) return;
  const { schoolId } = ctx;
  const id = req.params.id as string;

  const { data: row, error } = await supabase
    .from('staff_leave')
    .select('id, user_id, start_date, end_date, leave_type')
    .eq('id', id)
    .eq('school_id', schoolId)
    .maybeSingle();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  if (!row) { res.status(404).json({ error: 'Leave record not found.' }); return; }

  const { error: delErr } = await supabase
    .from('staff_leave').delete().eq('id', id).eq('school_id', schoolId);
  if (delErr) { res.status(safeDbErrorStatus(delErr)).json({ error: safeDbErrorMessage(delErr) }); return; }

  await logAudit({
    req, entityType: 'staff_leave', entityId: id, action: 'delete',
    before: { user_id: row.user_id, start_date: row.start_date, end_date: row.end_date, leave_type: row.leave_type },
    after: null,
    label: 'Staff leave removed',
  });

  res.json({ ok: true });
}

// ── GET /staff-attendance/export?from=&to= — CSV of attendance rows in range ──
export async function exportCsv(req: AuthRequest, res: Response): Promise<void> {
  const ctx = await requireProvisioned(req, res);
  if (!ctx) return;
  const { schoolId } = ctx;
  const from = req.query.from as string;
  const to = req.query.to as string;

  try {
    const { data: rows, error } = await supabase
      .from('staff_attendance')
      .select('user_id, work_date, check_in_at, check_out_at, status, is_late, flagged, flag_reason')
      .eq('school_id', schoolId)
      .gte('work_date', from)
      .lte('work_date', to)
      .order('work_date', { ascending: true })
      .limit(20000);
    if (error) throw error;

    const employees = await loadEmployees(schoolId);
    const byId = new Map(employees.map(e => [e.id, e]));

    const header = ['Date', 'Name', 'Role', 'Job title', 'Check in', 'Check out', 'Status', 'Late', 'Flagged', 'Flag reason'];
    const lines = [header.map(csvCell).join(',')];
    for (const r of (rows ?? []) as Record<string, unknown>[]) {
      const e = byId.get(r.user_id as string) ?? { name: 'Unknown', role: '—', jobTitle: null };
      lines.push([
        r.work_date, e.name, e.role, e.jobTitle ?? '',
        r.check_in_at ?? '', r.check_out_at ?? '',
        r.status, r.is_late === true ? 'yes' : 'no', r.flagged === true ? 'yes' : 'no',
        r.flag_reason ?? '',
      ].map(csvCell).join(','));
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="staff-attendance_${from}_${to}.csv"`);
    // Lead with a UTF-8 BOM so Excel renders Arabic/Kurdish names correctly.
    res.send(`﻿${lines.join('\r\n')}\r\n`);
  } catch (e) {
    fail(res, e);
  }
}
