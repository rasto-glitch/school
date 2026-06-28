import { Response } from 'express';
import type { AuthRequest } from '../middleware/auth';
import { adminDb as supabase } from '../utils/db';
import { safeDbErrorMessage, safeDbErrorStatus } from '../utils/dbErrors';
import { notifyMany } from '../utils/notify';
import { logAudit } from '../utils/audit';
import { getSchoolTimezone, todayInTimezone } from '../utils/attendance';
import { getCurrentOpenWindow, listGradeWindows } from '../utils/gradeWindow';
import { resolveCurrentAcademicYear } from '../utils/studentEnrollments';

// Dashboard "Needs your attention" signals + their actions, the per-term
// grade-filing-window settings, and the IT security-page reads. Every handler
// is registered behind a capability in routes/index.ts (academics.oversee for
// the grade/attendance signals + window settings; accounts.manage for the
// account-request summary; audit.read for the failed-login signal + security
// page). This controller is elevated (adminDb) with explicit `.eq('school_id',
// schoolId)` tenant scoping, matching admin.controller.

// ── Shared knobs ────────────────────────────────────────────────────────────
const COOLDOWN_MS = 3 * 60 * 60 * 1000;     // re-notify no more than once / 3h
const ADMIN_FAIL_THRESHOLD = 3;             // failed admin logins / 24h to alert
const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_SCHEDULE_DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday'];

// ── Cooldown helpers (anti-spam for Notify/Remind) ──────────────────────────
async function getCooldown(schoolId: string, kind: string): Promise<string | null> {
  const { data } = await supabase
    .from('attention_action_cooldowns')
    .select('last_fired_at')
    .eq('school_id', schoolId)
    .eq('kind', kind)
    .maybeSingle();
  return (data as { last_fired_at?: string } | null)?.last_fired_at ?? null;
}

async function touchCooldown(schoolId: string, kind: string, userId: string): Promise<void> {
  await supabase
    .from('attention_action_cooldowns')
    .upsert(
      { school_id: schoolId, kind, last_fired_at: new Date().toISOString(), last_fired_by: userId },
      { onConflict: 'school_id,kind' },
    );
}

function withinCooldown(lastFiredAt: string | null): boolean {
  if (!lastFiredAt) return false;
  return Date.now() - new Date(lastFiredAt).getTime() < COOLDOWN_MS;
}

function isISODate(s?: string): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// Today's weekday name (lowercase, e.g. "sunday") in the school's timezone, to
// compare against schools.schedule_days.
function weekdayInTz(tz: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' })
    .format(new Date())
    .toLowerCase();
}

async function loadScheduleDays(schoolId: string): Promise<string[]> {
  const { data } = await supabase.from('schools').select('schedule_days').eq('id', schoolId).single();
  return (data?.schedule_days as string[] | null) ?? DEFAULT_SCHEDULE_DAYS;
}

// ════════════════════════════════════════════════════════════════════════════
// ATTENDANCE GAP — active classes with no attendance row for today
// ════════════════════════════════════════════════════════════════════════════
interface ClassLite { id: string; name: string }

async function computeAttendanceGapClasses(schoolId: string, today: string): Promise<ClassLite[]> {
  const [classesRes, studentsRes, attendanceRes] = await Promise.all([
    supabase.from('classes').select('id, name').eq('school_id', schoolId),
    supabase.from('students').select('class_id')
      .eq('school_id', schoolId).eq('is_graduated', false).not('class_id', 'is', null),
    supabase.from('attendance').select('class_id').eq('school_id', schoolId).eq('date', today),
  ]);
  const classes = (classesRes.data as ClassLite[] | null) ?? [];
  const withStudents = new Set(((studentsRes.data as { class_id: string }[] | null) ?? []).map(r => r.class_id));
  const withAttendance = new Set(((attendanceRes.data as { class_id: string | null }[] | null) ?? [])
    .map(r => r.class_id).filter(Boolean) as string[]);
  return classes
    .filter(c => withStudents.has(c.id) && !withAttendance.has(c.id))
    .map(c => ({ id: c.id, name: c.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// GET /admin/dashboard/attendance-gap  (academics.oversee)
export async function getAttendanceGap(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const tz = await getSchoolTimezone(schoolId);
  const today = todayInTimezone(tz);
  const lastNotifiedAt = await getCooldown(schoolId, 'attendance');

  const scheduleDays = await loadScheduleDays(schoolId);
  if (!scheduleDays.includes(weekdayInTz(tz))) {
    res.json({ schoolDay: false, date: today, classes: [], lastNotifiedAt });
    return;
  }
  const classes = await computeAttendanceGapClasses(schoolId, today);
  res.json({ schoolDay: true, date: today, classes, lastNotifiedAt });
}

// POST /admin/dashboard/attendance-gap/notify  (academics.oversee)
// Notifies every active supervisor the specific class list. Cooldown-guarded.
export async function notifyAttendanceGap(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const tz = await getSchoolTimezone(schoolId);
  const today = todayInTimezone(tz);

  const scheduleDays = await loadScheduleDays(schoolId);
  if (!scheduleDays.includes(weekdayInTz(tz))) {
    res.status(400).json({ error: 'Today is not a school day.' });
    return;
  }
  const lastNotifiedAt = await getCooldown(schoolId, 'attendance');
  if (withinCooldown(lastNotifiedAt)) {
    res.status(429).json({ error: 'Supervisors were already notified recently.', code: 'COOLDOWN', lastNotifiedAt });
    return;
  }
  const classes = await computeAttendanceGapClasses(schoolId, today);
  if (classes.length === 0) { res.json({ notified: 0, classes: 0 }); return; }

  const { data: supers } = await supabase
    .from('users').select('id')
    .eq('school_id', schoolId).eq('role', 'supervisor').eq('is_active', true);
  const recipients = ((supers as { id: string }[] | null) ?? []);
  const list = classes.map(c => c.name).join(', ');
  const plural = classes.length === 1 ? 'class' : 'classes';
  if (recipients.length > 0) {
    await notifyMany(recipients.map(s => ({
      schoolId, userId: s.id,
      title: "Attendance still needs taking",
      message: `${classes.length} ${plural} have no attendance recorded for today: ${list}.`,
      type: 'attendance',
    })));
  }
  await touchCooldown(schoolId, 'attendance', userId);
  res.json({ notified: recipients.length, classes: classes.length });
}

// ════════════════════════════════════════════════════════════════════════════
// GRADE GAP — teachers with incomplete grades during the open filing window
// ════════════════════════════════════════════════════════════════════════════
interface PendingClass { className: string; subject: string }
interface TeacherGap { teacherId: string; userId: string; fullName: string; filedAny: boolean; pending: PendingClass[] }

interface AssignmentRow {
  class_id: string;
  subject_id: string;
  teacher_id: string;
  classes: { name: string } | null;
  subjects: { name: string } | null;
  teachers: { id: string; full_name: string; user_id: string } | null;
}

async function computeGradeGap(schoolId: string, term: string): Promise<{ teachers: TeacherGap[]; anyFiled: boolean }> {
  const academicYear = await resolveCurrentAcademicYear(schoolId);
  const [assignRes, studentRes, gradeRes] = await Promise.all([
    supabase.from('class_subject_teachers')
      .select('class_id, subject_id, teacher_id, classes(name), subjects(name), teachers(id, full_name, user_id)')
      .eq('school_id', schoolId),
    supabase.from('students').select('id, class_id')
      .eq('school_id', schoolId).eq('is_graduated', false).not('class_id', 'is', null),
    supabase.from('grades').select('student_id, subject, teacher_id')
      .eq('school_id', schoolId).eq('grading_period', term).eq('academic_year', academicYear),
  ]);

  const assignments = (assignRes.data as unknown as AssignmentRow[] | null) ?? [];
  const studentRows = (studentRes.data as { id: string; class_id: string }[] | null) ?? [];
  const gradeRows = (gradeRes.data as { student_id: string; subject: string; teacher_id: string | null }[] | null) ?? [];

  const studentsByClass = new Map<string, string[]>();
  for (const s of studentRows) {
    const arr = studentsByClass.get(s.class_id) ?? [];
    arr.push(s.id);
    studentsByClass.set(s.class_id, arr);
  }

  // `${student_id}|${subject_name}` → grade exists; plus teachers who filed ≥1.
  const filed = new Set<string>();
  const teachersWhoFiled = new Set<string>();
  for (const g of gradeRows) {
    filed.add(`${g.student_id}|${g.subject}`);
    if (g.teacher_id) teachersWhoFiled.add(g.teacher_id);
  }

  const byTeacher = new Map<string, TeacherGap>();
  for (const a of assignments) {
    const subjectName = a.subjects?.name;
    const className = a.classes?.name;
    const teacher = a.teachers;
    if (!subjectName || !className || !teacher?.user_id) continue;
    const students = studentsByClass.get(a.class_id) ?? [];
    if (students.length === 0) continue;                       // empty class — nothing to file
    const anyMissing = students.some(sid => !filed.has(`${sid}|${subjectName}`));
    if (!anyMissing) continue;                                 // class+subject fully filed
    const entry = byTeacher.get(teacher.id) ?? {
      teacherId: teacher.id, userId: teacher.user_id, fullName: teacher.full_name,
      filedAny: false, pending: [],
    };
    entry.pending.push({ className, subject: subjectName });
    byTeacher.set(teacher.id, entry);
  }

  const teachers = Array.from(byTeacher.values())
    .map(t => ({
      ...t,
      filedAny: teachersWhoFiled.has(t.teacherId),
      pending: t.pending.sort((a, b) => (a.className + a.subject).localeCompare(b.className + b.subject)),
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));

  return { teachers, anyFiled: teachersWhoFiled.size > 0 };
}

// True when the school actually does grading (≥1 term AND ≥1 curriculum
// assignment). Used so the "Set window" nudge only shows for schools that
// would otherwise have teachers blocked from filing.
async function isGradable(schoolId: string): Promise<boolean> {
  const [termRes, assignRes] = await Promise.all([
    supabase.from('terms').select('id', { count: 'exact', head: true }).eq('school_id', schoolId),
    supabase.from('class_subject_teachers').select('id', { count: 'exact', head: true }).eq('school_id', schoolId),
  ]);
  return (termRes.count ?? 0) > 0 && (assignRes.count ?? 0) > 0;
}

// GET /admin/dashboard/grade-gap  (academics.oversee)
export async function getGradeGap(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const window = await getCurrentOpenWindow(schoolId);
  const lastRemindedAt = await getCooldown(schoolId, 'grade_remind');
  if (!window) {
    const gradable = await isGradable(schoolId);
    res.json({ state: 'none', window: null, gradable, teachers: [], teacherCount: 0, anyFiled: false, lastRemindedAt });
    return;
  }
  const { teachers, anyFiled } = await computeGradeGap(schoolId, window.term);
  res.json({
    state: teachers.length === 0 ? 'complete' : 'incomplete',
    window,
    anyFiled,
    teacherCount: teachers.length,
    teachers,
    lastRemindedAt,
  });
}

// POST /admin/dashboard/grade-gap/remind  (academics.oversee)
// One notification per incomplete teacher: a "filing is open" nudge if they've
// filed nothing yet, or the specific pending classes/subjects if partial.
export async function remindGradeGap(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const window = await getCurrentOpenWindow(schoolId);
  if (!window) { res.status(400).json({ error: 'No grade filing window is open right now.' }); return; }

  const lastRemindedAt = await getCooldown(schoolId, 'grade_remind');
  if (withinCooldown(lastRemindedAt)) {
    res.status(429).json({ error: 'Teachers were already reminded recently.', code: 'COOLDOWN', lastRemindedAt });
    return;
  }
  const { teachers } = await computeGradeGap(schoolId, window.term);
  if (teachers.length === 0) { res.json({ reminded: 0 }); return; }

  await notifyMany(teachers.map(t => {
    if (!t.filedAny) {
      return {
        schoolId, userId: t.userId,
        title: 'Grade filing is open',
        message: `Grade filing for ${window.term} is now open. Please file your grades before ${window.closesOn}.`,
        type: 'grade',
      };
    }
    const list = t.pending.map(p => `${p.className} — ${p.subject}`).join('; ');
    return {
      schoolId, userId: t.userId,
      title: 'Grades still pending',
      message: `Please complete your ${window.term} grades for: ${list}.`,
      type: 'grade',
    };
  }));
  await touchCooldown(schoolId, 'grade_remind', userId);
  res.json({ reminded: teachers.length });
}

// ════════════════════════════════════════════════════════════════════════════
// GRADE FILING WINDOW — settings CRUD (academics.oversee)
// ════════════════════════════════════════════════════════════════════════════

// GET /admin/grade-filing-windows
export async function getGradeFilingWindows(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const tz = await getSchoolTimezone(schoolId);
  const today = todayInTimezone(tz);
  const [windows, termsRes, current] = await Promise.all([
    listGradeWindows(schoolId),
    supabase.from('terms').select('name').eq('school_id', schoolId).order('order_index').order('created_at'),
    getCurrentOpenWindow(schoolId),
  ]);
  res.json({
    today,
    currentTerm: current?.term ?? null,
    terms: ((termsRes.data as { name: string }[] | null) ?? []).map(t => t.name),
    windows: windows.map(w => ({ ...w, isOpen: w.opensOn <= today && today <= w.closesOn })),
  });
}

// PUT /admin/grade-filing-windows  body: { term, opensOn, closesOn }
export async function putGradeFilingWindow(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { term, opensOn, closesOn } = (req.body ?? {}) as { term?: string; opensOn?: string; closesOn?: string };
  const t = (term ?? '').trim();
  if (!t) { res.status(400).json({ error: 'term is required' }); return; }
  if (!isISODate(opensOn) || !isISODate(closesOn)) {
    res.status(400).json({ error: 'opensOn and closesOn must be YYYY-MM-DD dates' }); return;
  }
  if (closesOn < opensOn) { res.status(400).json({ error: 'closesOn must be on or after opensOn' }); return; }

  const { data: termRow } = await supabase
    .from('terms').select('id').eq('school_id', schoolId).eq('name', t).maybeSingle();
  if (!termRow) { res.status(400).json({ error: 'Unknown term. Create the term first.' }); return; }

  const { data: existing } = await supabase
    .from('grade_filing_windows').select('id, term, opens_on, closes_on')
    .eq('school_id', schoolId).eq('term', t).maybeSingle();

  const payload: Record<string, unknown> = {
    school_id: schoolId, term: t, opens_on: opensOn, closes_on: closesOn,
    updated_at: new Date().toISOString(),
  };
  if (!existing) payload.created_by = userId;     // preserve original creator on update

  const { data, error } = await supabase
    .from('grade_filing_windows')
    .upsert(payload, { onConflict: 'school_id,term' })
    .select().single();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  await logAudit({
    req, entityType: 'grade_filing_window', entityId: data.id,
    action: existing ? 'update' : 'create',
    before: existing ? { term: existing.term, opens_on: existing.opens_on, closes_on: existing.closes_on } : null,
    after: { term: t, opens_on: opensOn, closes_on: closesOn },
    label: `Grade window · ${t}`,
  });
  res.json({ id: data.id, term: data.term, opensOn: data.opens_on, closesOn: data.closes_on });
}

// DELETE /admin/grade-filing-windows/:id  — clear a term's window
export async function deleteGradeFilingWindow(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  const { data: existing } = await supabase
    .from('grade_filing_windows').select('id, term, opens_on, closes_on')
    .eq('id', id).eq('school_id', schoolId).maybeSingle();
  if (!existing) { res.status(404).json({ error: 'Window not found' }); return; }

  const { error } = await supabase
    .from('grade_filing_windows').delete().eq('id', existing.id).eq('school_id', schoolId);
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  await logAudit({
    req, entityType: 'grade_filing_window', entityId: existing.id, action: 'delete',
    before: { term: existing.term, opens_on: existing.opens_on, closes_on: existing.closes_on },
    label: `Grade window · ${existing.term}`,
  });
  res.json({ message: 'Window cleared' });
}

// ════════════════════════════════════════════════════════════════════════════
// ACCOUNT REQUEST SUMMARY — pending password resets, broken down by role
// (powers the dashboard "N account requests — 2 parents, 1 teacher" row)
// ════════════════════════════════════════════════════════════════════════════

// GET /admin/dashboard/account-requests  (accounts.manage)
export async function getAccountRequestSummary(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { data } = await supabase
    .from('password_reset_requests')
    .select('user_id, users(role)')
    .eq('school_id', schoolId).eq('status', 'pending');
  const rows = (data as unknown as { user_id: string; users: { role: string } | null }[] | null) ?? [];
  const byRole: Record<string, number> = {};
  for (const r of rows) {
    const role = r.users?.role ?? 'unknown';
    byRole[role] = (byRole[role] ?? 0) + 1;
  }
  res.json({ total: rows.length, byRole });
}

// ════════════════════════════════════════════════════════════════════════════
// FAILED LOGINS — security signal + IT security page (audit.read)
// Note: notification_type 'security' is reserved for future IT-admin push
// alerting; this commit surfaces failed logins as a pull (dashboard + page).
// ════════════════════════════════════════════════════════════════════════════

interface FailRow { username: string; matched_user_id: string; ip: string | null; attempted_at: string }

// GET /admin/dashboard/failed-logins  (audit.read)
export async function getFailedLoginSummary(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const since = new Date(Date.now() - DAY_MS).toISOString();
  const { data } = await supabase
    .from('login_attempts')
    .select('username, matched_user_id, ip, attempted_at')
    .eq('school_id', schoolId)
    .eq('matched_role', 'admin')
    .not('matched_user_id', 'is', null)
    .gte('attempted_at', since)
    .order('attempted_at', { ascending: false });
  const rows = (data as FailRow[] | null) ?? [];
  if (rows.length === 0) { res.json({ alert: false }); return; }

  const byUser = new Map<string, { username: string; count: number; ips: Set<string>; lastAt: string }>();
  for (const r of rows) {
    const e = byUser.get(r.matched_user_id) ?? { username: r.username, count: 0, ips: new Set<string>(), lastAt: r.attempted_at };
    e.count++;
    if (r.ip) e.ips.add(r.ip);
    if (r.attempted_at > e.lastAt) e.lastAt = r.attempted_at;
    byUser.set(r.matched_user_id, e);
  }
  const flagged = Array.from(byUser.values())
    .filter(e => e.count >= ADMIN_FAIL_THRESHOLD)
    .sort((a, b) => b.count - a.count || (a.lastAt < b.lastAt ? 1 : -1));
  if (flagged.length === 0) { res.json({ alert: false }); return; }

  const top = flagged[0];
  res.json({
    alert: true,
    username: top.username,
    count: top.count,
    sameIp: top.ips.size === 1,
    lastAt: top.lastAt,
    accounts: flagged.length,
    totalAttempts: rows.length,
  });
}

interface AttemptRow {
  id: string; username: string; matched_user_id: string | null;
  matched_role: string | null; ip: string | null; user_agent: string | null; attempted_at: string;
}

// GET /admin/security/login-attempts  (audit.read) — IT security page
export async function getSecurityLoginAttempts(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const since90 = new Date(Date.now() - 90 * DAY_MS).toISOString();
  const { data } = await supabase
    .from('login_attempts')
    .select('id, username, matched_user_id, matched_role, ip, user_agent, attempted_at')
    .eq('school_id', schoolId)
    .gte('attempted_at', since90)
    .order('attempted_at', { ascending: false })
    .limit(300);
  const rows = (data as AttemptRow[] | null) ?? [];

  const since24 = Date.now() - DAY_MS;
  let last24h = 0, adminTargeted24h = 0;
  const distinctIps24h = new Set<string>();
  for (const r of rows) {
    if (new Date(r.attempted_at).getTime() >= since24) {
      last24h++;
      if (r.matched_role === 'admin' && r.matched_user_id) adminTargeted24h++;
      if (r.ip) distinctIps24h.add(r.ip);
    }
  }
  res.json({
    attempts: rows.map(r => ({
      id: r.id, username: r.username, matchedUserId: r.matched_user_id,
      matchedRole: r.matched_role, ip: r.ip, userAgent: r.user_agent, attemptedAt: r.attempted_at,
    })),
    summary: { last24h, adminTargeted24h, distinctIps24h: distinctIps24h.size },
  });
}
