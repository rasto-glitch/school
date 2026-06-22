import { safeDbErrorMessage, safeDbErrorStatus } from '../utils/dbErrors';
import { Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import * as XLSX from 'xlsx';
// admin.controller is intentionally an ELEVATED controller (Phase 0 inventory):
// it runs snapshot builds, cache recomputation, year transitions, and many
// many-table cross-cuts within a school. Tenant scoping is still enforced
// via explicit `.eq('school_id', schoolId)` filters everywhere. Importing
// adminDb under the existing `supabase` name keeps the body unchanged.
import { adminDb as supabase } from '../utils/db';
import { safeExt } from '../utils/upload';
import type { AuthRequest } from '../middleware/auth';
import { toCC } from '../utils/transform';
import { parseCursorParams, buildPage } from '../utils/pagination';
import { notify, notifyMany } from '../utils/notify';
import { loadArchiveSnapshot, streamPdf, buildXlsx } from '../utils/archiveExport';
import { loadEmployeeArchiveSnapshot, streamPdf as streamEmployeePdf, buildXlsx as buildEmployeeXlsx } from '../utils/employeeArchiveExport';
import { streamCredentialsPdf, type CredentialEntry } from '../utils/credentialsPdf';
import { logAudit } from '../utils/audit';
import { hasArchiveFeature, normalizeArchiveReason, resolveEmployeeArchiveId, rewriteOwnershipToArchive } from '../utils/employeeArchive';
import { loadArchivedEmployeeForPdf, streamArchivedEmployeePdf } from '../utils/archivedEmployeePdf';
import { loadArchivedStudentForPdf, streamArchivedStudentPdf } from '../utils/archivedStudentPdf';
import { pickLang } from '../utils/archivePdfShared';
import { hrColumns, hrSnapshot } from '../utils/employeeHr';
import { defaultPasswordFor } from '../utils/defaultPasswords';
import { propagateAdminSetPhone } from '../utils/adminPhonePropagation';
import { isUrlSafeToFetch } from '../utils/urlSafety';
import { logger } from '../utils/logger';
import { isStrongPassword, PASSWORD_POLICY_MESSAGE } from '../utils/passwordPolicy';
import { buildAttendanceHistory, loadAttendanceDaysForYear } from '../utils/attendanceHistory';
import {
  openEnrollmentForCurrentYear,
  updateClassForCurrentYear,
  closeCurrentEnrollment,
  markOnLeaveForCurrentYear,
  returnFromLeave as returnFromLeaveHelper,
  loadEnrollmentHistory,
  rowsToSnapshot,
  closeEnrollmentForYear,
  openEnrollmentForYear,
  loadEnrolledRosterForClass,
  nextAcademicYear,
  resolveCurrentAcademicYear,
  academicYearOf,
  type EnrollmentSnapshotEntry,
} from '../utils/studentEnrollments';
import { backfillSchoolEnrollments } from '../utils/studentEnrollmentsBackfill';
import { postArWriteoff } from '../utils/glPosting';

// ---- EMPLOYEE ARCHIVE (teacher / driver / supervisor; staff in staff.controller) ----
// Mirrors the student archive: the controller assembles the role-specific
// JSONB in TS, then archive_employee_atomic() snapshots + deletes the users
// row (cascading the teachers/drivers row) in one transaction.
// hasArchiveFeature / normalizeArchiveReason are shared via utils/employeeArchive.

type ArchiveEmployeeRole = 'teacher' | 'driver' | 'supervisor' | 'staff' | 'admin' | 'reception' | 'accountant';

// Snapshot of the users row — never includes password_hash.
async function loadAccountSnapshot(userId: string, schoolId: string): Promise<Record<string, unknown> | null> {
  const { data } = await supabase
    .from('users')
    .select('id, username, email, role, first_name, last_name, phone, profile_picture, is_active, password_changed_at, created_at')
    .eq('id', userId).eq('school_id', schoolId).single();
  return (data as Record<string, unknown> | null) ?? null;
}

interface PerformEmployeeArchiveArgs {
  schoolId: string;
  userId: string;
  originalEmployeeId: string;
  role: ArchiveEmployeeRole;
  fullName: string;
  dateOfBirth?: string | null;
  age?: number | null;
  phoneNumber?: string | null;
  email?: string | null;
  emergencyContact?: string | null;
  profilePicture?: string | null;
  position?: string | null;
  subject?: string | null;
  hireDate?: string | null;
  departureDate: string;
  reason: string;
  account?: unknown;
  teaching?: unknown;
  transport?: unknown;
  employment?: unknown;
  paymentHistory?: unknown;
  // Actor (F2): who performed the archive. Stored as text too so it
  // survives this actor's own later deletion.
  actorId: string;
  actorName: string;
  actorRole: string;
}

async function performEmployeeArchive(a: PerformEmployeeArchiveArgs): Promise<{ ok: true; archiveId: string } | { ok: false; error: string }> {
  const { error, data } = await supabase.rpc('archive_employee_atomic', {
    p_school_id: a.schoolId,
    p_user_id: a.userId,
    p_original_employee_id: a.originalEmployeeId,
    p_role: a.role,
    p_full_name: a.fullName,
    p_date_of_birth: a.dateOfBirth ?? null,
    p_age: a.age ?? null,
    p_phone_number: a.phoneNumber ?? null,
    p_email: a.email ?? null,
    p_emergency_contact: a.emergencyContact ?? null,
    p_profile_picture: a.profilePicture ?? null,
    p_position: a.position ?? null,
    p_subject: a.subject ?? null,
    p_hire_date: a.hireDate ?? null,
    p_departure_date: a.departureDate,
    p_reason: a.reason,
    p_account: a.account ?? {},
    p_teaching: a.teaching ?? [],
    p_transport: a.transport ?? {},
    p_employment: a.employment ?? {},
    p_payment_history: a.paymentHistory ?? [],
    p_archived_by: a.actorId,
    p_archived_by_name: a.actorName,
    p_archived_by_role: a.actorRole,
  });
  if (error) {
    // Surface the RPC failure to Railway logs — safeDbErrorMessage strips
    // detail before returning to the client, so without this the operator
    // just sees "Invalid request" and we lose every clue about what the
    // stored procedure rejected. No PII in the logged payload.
    logger.error('[archive_employee_atomic] RPC failed', {
      code: error.code,
      message: error.message,
      details: (error as { details?: string }).details,
      hint: (error as { hint?: string }).hint,
      role: a.role,
      schoolId: a.schoolId,
      userId: a.userId,
      originalEmployeeId: a.originalEmployeeId,
      hasAccountSnapshot: a.account != null,
      hasTeachingSnapshot: a.teaching != null,
      hasTransportSnapshot: a.transport != null,
      hasEmploymentSnapshot: a.employment != null,
      reason: a.reason,
    });
    return { ok: false, error: safeDbErrorMessage(error) };
  }
  return { ok: true, archiveId: data as string };
}

// Teacher teaching-history snapshot: curriculum (class ↔ subject) + a count
// summary of authored content that survives the delete (orphaned, not lost).
async function buildTeacherTeachingSnapshot(teacherId: string, schoolId: string): Promise<unknown> {
  const { data: cst } = await supabase
    .from('class_subject_teachers')
    .select('class_id, subject_id, classes(name), subjects(name)')
    .eq('teacher_id', teacherId).eq('school_id', schoolId);

  const byClass = new Map<string, { classId: string; className: string | null; subjects: string[] }>();
  for (const row of (cst ?? []) as any[]) {
    const cid = row.class_id as string;
    let entry = byClass.get(cid);
    if (!entry) { entry = { classId: cid, className: row.classes?.name ?? null, subjects: [] }; byClass.set(cid, entry); }
    const sn = row.subjects?.name;
    if (sn && !entry.subjects.includes(sn)) entry.subjects.push(sn);
  }

  const countOf = async (table: string) => {
    const { count } = await supabase
      .from(table).select('id', { count: 'exact', head: true })
      .eq('teacher_id', teacherId).eq('school_id', schoolId);
    return count ?? 0;
  };
  const [homework, assignments, grades, reports, weeklySummaries, academicPosts] = await Promise.all([
    countOf('homework'), countOf('assignments'), countOf('grades'),
    countOf('reports'), countOf('weekly_summaries'), countOf('academic_posts'),
  ]);

  return {
    curriculum: Array.from(byClass.values()),
    contentSummary: { homework, assignments, grades, reports, weeklySummaries, academicPosts },
  };
}

// ---- STUDENTS ----
export async function getStudents(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { classId, search, page = '1', limit = '20' } = req.query as Record<string, string>;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let query = supabase
    .from('students')
    .select('*, classes(id, name, next_class_id), parents(id, full_name, phone_number, user_id, residence_type, block_number), drivers(id, full_name, buses(bus_number))', { count: 'exact' })
    .eq('school_id', schoolId)
    .eq('is_graduated', false)
    .range(offset, offset + parseInt(limit) - 1);

  if (classId) query = query.eq('class_id', classId);
  // Search across name, address, and phone
  if (search) query = query.or(`full_name.ilike.%${search}%,home_address.ilike.%${search}%,phone_number.ilike.%${search}%`);

  const { data, error, count } = await query;
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json({ students: toCC(data), total: count });
}

export async function createStudent(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { fullName, parentId, classId, driverId, homeAddress, emergencyContact, phoneNumber, dateOfBirth, residenceType, blockNumber, previousArchiveId, parentEmail } = req.body;

  // Optional parent email captured when admin creates the student. Stored
  // on the auto-created parent's users row so they can later use it for
  // password recovery and to submit bug reports from mobile.
  const cleanedParentEmail = typeof parentEmail === 'string' && parentEmail.trim()
    ? (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentEmail.trim().toLowerCase())
        ? parentEmail.trim().toLowerCase()
        : null)
    : null;

  // If linking to a previously-archived enrollment, verify the archive row belongs to this school.
  let resolvedPreviousArchiveId: string | null = null;
  if (previousArchiveId) {
    const { data: archive } = await supabase
      .from('archived_students')
      .select('id')
      .eq('id', previousArchiveId)
      .eq('school_id', schoolId)
      .single();
    if (!archive) { res.status(400).json({ error: 'Archived student record not found' }); return; }
    resolvedPreviousArchiveId = previousArchiveId;
  }

  let resolvedParentId: string | null = parentId || null;
  let parentAccountCreated: { username: string; password: string; fullName: string } | null = null;

  // Auto-resolve parent from the student's name when the admin didn't pick one.
  // Mirrors the bulk-upload flow: name → "father grandfather...", match existing
  // parent (name + phone), otherwise create a fresh users + parents row.
  if (!resolvedParentId && fullName) {
    const nameParts = String(fullName).trim().split(/\s+/);
    if (nameParts.length >= 3) {
      const fatherName = nameParts[1];
      const grandfatherName = nameParts.slice(2).join(' ');
      const parentFullName = `${fatherName} ${grandfatherName}`;
      const parentNameKey = parentFullName.toLowerCase().trim();
      const resolvedPhone = (phoneNumber || '').toString().trim() || null;

      const { data: existingParents } = await supabase
        .from('parents')
        .select('id, full_name, phone_number')
        .eq('school_id', schoolId);

      const sameName = (existingParents || []).filter(
        (p: any) => (p.full_name || '').toLowerCase().trim() === parentNameKey
      );
      let match: any = null;
      if (resolvedPhone) match = sameName.find((p: any) => p.phone_number === resolvedPhone) || null;
      if (!match) match = sameName.find((p: any) => !p.phone_number || !resolvedPhone) || null;

      if (match) {
        resolvedParentId = match.id;
      } else {
        const [{ data: schoolData }, { data: existingParentUsers }] = await Promise.all([
          supabase.from('schools').select('abbreviation').eq('id', schoolId).single(),
          supabase.from('users').select('username').eq('school_id', schoolId).eq('role', 'parent'),
        ]);
        const schoolAbbrev = (schoolData?.abbreviation || '').toLowerCase();
        const taken = new Set((existingParentUsers || []).map((u: any) => u.username.toLowerCase()));

        const grandfatherFirst = grandfatherName.split(/\s+/)[0] || '';
        const prefix = schoolAbbrev ? `${schoolAbbrev}_` : '';
        const base = `${prefix}${(fatherName + grandfatherFirst).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
        let username = base;
        let n = 2;
        while (taken.has(username)) { username = `${base}${n++}`; }

        const rounds = parseInt(process.env.BCRYPT_ROUNDS || '10');
        const passwordHash = await bcrypt.hash(defaultPasswordFor('parent'), rounds);

        const { data: newUser, error: userErr } = await supabase
          .from('users').insert({
            school_id: schoolId,
            first_name: fatherName,
            last_name: grandfatherName,
            username,
            password_hash: passwordHash,
            role: 'parent',
            email: cleanedParentEmail,
            is_active: true,
            must_change_password: true,
          }).select('id').single();

        if (userErr || !newUser) {
          res.status(500).json({ error: userErr?.message || 'Failed to create parent user' });
          return;
        }

        const normRes = (v?: string): 'apartment' | 'house' | null => {
          if (!v) return null;
          const lv = v.toString().toLowerCase().trim();
          if (lv === 'apartment') return 'apartment';
          if (lv === 'house') return 'house';
          return null;
        };

        const { data: newParent, error: parentErr } = await supabase
          .from('parents').insert({
            school_id: schoolId,
            user_id: newUser.id,
            full_name: parentFullName,
            phone_number: resolvedPhone,
            residence_type: normRes(residenceType),
            block_number: blockNumber || null,
          }).select('id').single();

        if (parentErr || !newParent) {
          // Roll back the orphan user row so retries don't trip the username uniqueness check.
          await supabase.from('users').delete().eq('id', newUser.id);
          res.status(500).json({ error: parentErr?.message || 'Failed to create parent record' });
          return;
        }

        resolvedParentId = newParent.id;
        parentAccountCreated = { username, password: defaultPasswordFor('parent'), fullName: parentFullName };
        // Admin-trusted phone propagation (migration 050). Mirrors the
        // resolved phone onto users.phone_e164 + stamps phone_verified_at
        // so the new parent gets OTPs at this number from day one.
        await propagateAdminSetPhone(newUser.id, resolvedPhone);
      }
    }
  }

  const { data, error } = await supabase.from('students').insert({
    school_id: schoolId,
    full_name: fullName,
    parent_id: resolvedParentId,
    class_id: classId || null,
    driver_id: driverId || null,
    home_address: homeAddress,
    emergency_contact: emergencyContact,
    phone_number: phoneNumber,
    date_of_birth: dateOfBirth || null,
    previous_archive_id: resolvedPreviousArchiveId,
  }).select().single();

  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  await logAudit({ req, entityType: 'student', entityId: data.id, action: 'create', after: data, label: data.full_name });
  // Open the per-year enrollment record (migration 030). Best-effort: a
  // failure here is logged but doesn't fail the create — the year-end
  // promote wizard / backfill can repair gaps.
  await openEnrollmentForCurrentYear({ schoolId, studentId: data.id, classId: data.class_id });
  res.status(201).json({ ...(toCC(data) as Record<string, unknown>), parentAccountCreated });
}

export async function updateStudent(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  const { fullName, parentId, classId, driverId, homeAddress, emergencyContact, phoneNumber, dateOfBirth } = req.body;

  const { data: before } = await supabase.from('students').select('*').eq('id', id).eq('school_id', schoolId).single();

  const { data, error } = await supabase.from('students')
    .update({
      full_name: fullName,
      parent_id: parentId || null,
      class_id: classId || null,
      driver_id: driverId || null,
      home_address: homeAddress,
      emergency_contact: emergencyContact,
      phone_number: phoneNumber,
      date_of_birth: dateOfBirth || null,
    })
    .eq('id', id).eq('school_id', schoolId).select().single();

  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  await logAudit({ req, entityType: 'student', entityId: String(id), action: 'update', before: before || undefined, after: data, label: data.full_name });
  res.json(toCC(data));
}

export async function deleteStudent(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  const { data: before } = await supabase.from('students').select('*').eq('id', id).eq('school_id', schoolId).single();
  const { error } = await supabase.from('students').delete().eq('id', id).eq('school_id', schoolId);
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  if (before) await logAudit({ req, entityType: 'student', entityId: String(id), action: 'delete', before, label: (before as { full_name?: string }).full_name });
  res.json({ message: 'Student removed' });
}

export async function assignStudent(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { studentId, newClassId, graduated } = req.body;

  const { data: before } = await supabase.from('students').select('*').eq('id', studentId).eq('school_id', schoolId).single();

  // If the school doesn't keep historical records, "graduating" a student is
  // a hard delete — there's nowhere to retain them. Class reassignment can
  // still ride along if the caller passed it, but the delete wins.
  if (graduated && !(await hasArchiveFeature(schoolId))) {
    const { error } = await supabase.from('students')
      .delete().eq('id', studentId).eq('school_id', schoolId);
    if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
    if (before) await logAudit({ req, entityType: 'student', entityId: studentId, action: 'delete', before, label: (before as { full_name?: string }).full_name, reason: 'Graduated (no archive)' });
    res.json({ deleted: true });
    return;
  }

  const update: Record<string, unknown> = {};
  if (newClassId) update.class_id = newClassId;
  if (graduated) update.is_graduated = true;

  const { data, error } = await supabase.from('students')
    .update(update).eq('id', studentId).eq('school_id', schoolId).select().single();

  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  await logAudit({ req, entityType: 'student', entityId: studentId, action: 'update', before: before || undefined, after: data, label: data.full_name, reason: graduated ? 'Graduated' : null });

  // Keep the per-year enrollment record in sync (migration 030).
  // Mid-year section change → update the current year's row's class.
  // (Year-end promotion is the dedicated wizard, not this endpoint.)
  if (newClassId && !graduated) {
    await updateClassForCurrentYear({ schoolId, studentId, classId: String(newClassId) });
  }
  // Freeze a graduated snapshot (archive on — the no-archive branch above
  // already returned). Best-effort; never blocks the response.
  if (graduated) {
    await closeCurrentEnrollment({ schoolId, studentId, status: 'graduated' });
    await snapshotGraduatedStudent(schoolId, studentId, { id: req.user!.userId, name: req.user!.username, role: req.user!.role });
  }
  res.json(toCC(data));
}

// ---- BULK UPLOAD STUDENTS ----
export async function bulkUploadStudents(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;

  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  // Hardened parse. The uploaded buffer is attacker-controlled (any admin),
  // so: (1) cap rows at read time via `sheetRows` to bound DoS/ReDoS
  // amplification even within the 10 MB multer limit, (2) only ever touch
  // the first sheet, (3) scrub prototype-polluting keys from the row
  // objects — the header row becomes the object keys, so a column literally
  // named `__proto__`/`constructor`/`prototype` must never reach `obj[key]`.
  const MAX_UPLOAD_ROWS = 5000;
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(req.file.buffer, {
      type: 'buffer',
      cellDates: true,
      sheetRows: MAX_UPLOAD_ROWS + 1, // +1 for the header row
    });
  } catch {
    res.status(400).json({ error: 'Could not parse the file. Make sure it is a valid .xlsx or .xls file.' });
    return;
  }

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName || !workbook.Sheets[firstSheetName]) {
    res.status(400).json({ error: 'The file has no readable sheet.' });
    return;
  }

  const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
  const rawRows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(
    workbook.Sheets[firstSheetName],
    { raw: false, dateNF: 'yyyy-mm-dd', defval: '' }
  );

  const rows: Record<string, unknown>[] = rawRows.map(r => {
    const clean: Record<string, unknown> = Object.create(null);
    for (const k of Object.keys(r)) {
      if (FORBIDDEN_KEYS.has(k)) continue;
      clean[k] = r[k];
    }
    return clean;
  });

  if (rows.length === 0) {
    res.status(400).json({ error: 'The file has no data rows.' });
    return;
  }

  if (rows.length > MAX_UPLOAD_ROWS) {
    res.status(400).json({ error: `Too many rows. Split the upload into files of at most ${MAX_UPLOAD_ROWS} students.` });
    return;
  }

  const COLUMN_MAP: Record<string, string> = {
    'full name': 'fullName', 'name': 'fullName',
    'primary phone number': 'phoneNumber', 'phone number': 'phoneNumber', 'phone': 'phoneNumber',
    'emergency contact': 'emergencyContact',
    'date of birth': 'dateOfBirth', 'dob': 'dateOfBirth',
    'grade': 'grade', 'class': 'grade', 'grade/class': 'grade',
    'address': 'homeAddress', 'home address': 'homeAddress',
    'parent phone': 'parentPhone', 'parent phone number': 'parentPhone',
    'father phone': 'parentPhone', 'father phone number': 'parentPhone',
    'parent email': 'parentEmail', 'email': 'parentEmail', 'parent_email': 'parentEmail',
    'father email': 'parentEmail',
    'residence type': 'residenceType', 'house type': 'residenceType',
    'block number': 'blockNumber', 'building number': 'blockNumber',
    'apartment number': 'blockNumber', 'block': 'blockNumber', 'building': 'blockNumber',
  };

  const stripGradePrefix = (g: string) => g.trim().toLowerCase().replace(/^grade\s+/, '');
  const formatClassName = (g: string): string => {
    const t = g.trim();
    if (/^\d+$/.test(t)) return `Grade ${t}`;
    if (/^grade\s+\d+$/i.test(t)) return `Grade ${t.replace(/^grade\s+/i, '')}`;
    return t;
  };
  const normaliseResidence = (v?: string): 'apartment' | 'house' | null => {
    if (!v?.trim()) return null;
    const lv = v.toLowerCase().trim();
    if (lv === 'apartment' || lv === 'apt' || lv === 'flat') return 'apartment';
    if (lv === 'house' || lv === 'villa' || lv === 'compound') return 'house';
    return null;
  };
  const parseDob = (raw: string): string | null => {
    if (!raw.trim()) return null;
    let s = raw.trim();
    const ddmm = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (ddmm) s = `${ddmm[3]}-${ddmm[2].padStart(2, '0')}-${ddmm[1].padStart(2, '0')}`;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
  };

  // =========================================================
  // PASS 0 — fetch all existing data in one parallel round-trip
  // =========================================================
  const [
    { data: existingClasses },
    { data: existingParents },
    { data: existingParentUsers },
    { data: existingStudents },
    { data: schoolData },
  ] = await Promise.all([
    supabase.from('classes').select('id, name').eq('school_id', schoolId),
    supabase.from('parents').select('id, full_name, phone_number').eq('school_id', schoolId),
    supabase.from('users').select('username').eq('school_id', schoolId).eq('role', 'parent'),
    supabase.from('students').select('full_name').eq('school_id', schoolId),
    supabase.from('schools').select('abbreviation').eq('id', schoolId).single(),
  ]);

  const schoolAbbrev = (schoolData?.abbreviation || '').toLowerCase();

  const classExactMap = new Map<string, string>(); // name.toLowerCase() → id
  const classNormMap  = new Map<string, string>(); // stripped form → id
  for (const c of (existingClasses || [])) {
    classExactMap.set(c.name.toLowerCase(), c.id);
    classNormMap.set(stripGradePrefix(c.name), c.id);
  }

  const parentByName      = new Map<string, { id: string; phone: string | null }>();
  const parentByNamePhone = new Map<string, string>(); // `name|phone` → id
  for (const p of (existingParents || [])) {
    const nk = (p.full_name || '').toLowerCase().trim();
    if (!parentByName.has(nk)) parentByName.set(nk, { id: p.id, phone: p.phone_number || null });
    if (p.phone_number) parentByNamePhone.set(`${nk}|${p.phone_number}`, p.id);
  }

  const takenUsernames = new Set((existingParentUsers || []).map((u: any) => u.username.toLowerCase()));

  // Dedup set — pre-loaded with names already in the DB
  const existingStudentNames = new Set(
    (existingStudents || []).map((s: any) => (s.full_name as string).toLowerCase().trim())
  );

  const rounds = parseInt(process.env.BCRYPT_ROUNDS || '10');
  const defaultParentPasswordHash = await bcrypt.hash(defaultPasswordFor('parent'), rounds);

  // =========================================================
  // PASS 1 — parse all rows in memory, zero DB calls
  // =========================================================
  interface ParsedRow {
    fullName: string;
    phoneNumber: string | null;
    emergencyContact: string | null;
    dateOfBirth: string | null;
    homeAddress: string | null;
    gradeRaw: string | null;
    existingParentId: string | null;
    newParentKey: string | null;
    parentUpdateId: string | null;
    parentUpdateResidence: 'apartment' | 'house' | null;
    parentUpdateBlock: string | null;
  }
  interface NewParentEntry {
    fatherName: string;
    grandfatherName: string;
    fullName: string;
    phone: string | null;
    email: string | null;
    normResidence: 'apartment' | 'house' | null;
    blockNumber: string | null;
    createdId?: string;
  }

  const parsedRows: ParsedRow[] = [];
  const newParentsNeeded = new Map<string, NewParentEntry>();
  const newClassesNeeded = new Set<string>();
  const errors: string[] = [];
  const skipped: string[] = [];

  const generateParentUsername = (fn: string, gn: string): string => {
    const prefix = schoolAbbrev ? `${schoolAbbrev}_` : '';
    const base = `${prefix}${(fn + gn).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    if (!takenUsernames.has(base)) { takenUsernames.add(base); return base; }
    let n = 2;
    while (takenUsernames.has(`${base}${n}`)) n++;
    takenUsernames.add(`${base}${n}`);
    return `${base}${n}`;
  };

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 2;
    const mapped: Record<string, string> = {};
    for (const [key, val] of Object.entries(rows[i])) {
      const norm = key.trim().toLowerCase().replace(/\s+/g, ' ');
      const field = COLUMN_MAP[norm];
      if (field) mapped[field] = String(val).trim();
    }

    const { fullName, phoneNumber, emergencyContact, dateOfBirth, grade,
            homeAddress, parentPhone, parentEmail, residenceType, blockNumber } = mapped;

    const cleanedParentEmail = parentEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentEmail.trim().toLowerCase())
      ? parentEmail.trim().toLowerCase()
      : null;

    if (!fullName) {
      errors.push(`Row ${rowNum}: missing "Full Name" — skipped`);
      continue;
    }

    // ---- Student dedup ----
    const nameKey = fullName.toLowerCase().trim();
    if (existingStudentNames.has(nameKey)) {
      skipped.push(fullName);
      continue;
    }
    existingStudentNames.add(nameKey); // also blocks intra-file duplicates

    const normResidence  = normaliseResidence(residenceType);
    const resolvedPhone  = (parentPhone || phoneNumber || '').trim() || null;

    // ---- Resolve parent ----
    let existingParentId: string | null = null;
    let newParentKey: string | null     = null;
    let parentUpdateId: string | null   = null;
    let parentUpdateResidence: 'apartment' | 'house' | null = null;
    let parentUpdateBlock: string | null = null;

    const nameParts = fullName.trim().split(/\s+/);
    if (nameParts.length >= 3) {
      const fatherName      = nameParts[1];
      const grandfatherName = nameParts.slice(2).join(' ');
      const parentFullName  = `${fatherName} ${grandfatherName}`;
      const parentNameKey   = parentFullName.toLowerCase();
      const phoneKey        = resolvedPhone ? `${parentNameKey}|${resolvedPhone}` : null;

      if (phoneKey && parentByNamePhone.has(phoneKey)) {
        existingParentId = parentByNamePhone.get(phoneKey)!;
      } else if (parentByName.has(parentNameKey)) {
        const cached = parentByName.get(parentNameKey)!;
        const hasConflict = resolvedPhone && cached.phone && cached.phone !== resolvedPhone;
        if (!hasConflict) {
          existingParentId = cached.id;
          if (normResidence || blockNumber) {
            parentUpdateId = cached.id;
            parentUpdateResidence = normResidence;
            parentUpdateBlock = blockNumber || null;
          }
        } else {
          // Same name, different phone → different family
          const conflictKey = `${parentNameKey}|${resolvedPhone}`;
          newParentKey = conflictKey;
          if (!newParentsNeeded.has(conflictKey)) {
            newParentsNeeded.set(conflictKey, {
              fatherName, grandfatherName, fullName: parentFullName,
              phone: resolvedPhone, email: cleanedParentEmail, normResidence, blockNumber: blockNumber || null,
            });
          }
        }
      } else {
        // Brand-new parent — guard against same-name, different-phone within this file
        const prior = newParentsNeeded.get(parentNameKey);
        const intraConflict = prior && resolvedPhone && prior.phone && prior.phone !== resolvedPhone;
        if (intraConflict) {
          const conflictKey = `${parentNameKey}|${resolvedPhone}`;
          newParentKey = conflictKey;
          if (!newParentsNeeded.has(conflictKey)) {
            newParentsNeeded.set(conflictKey, {
              fatherName, grandfatherName, fullName: parentFullName,
              phone: resolvedPhone, email: cleanedParentEmail, normResidence, blockNumber: blockNumber || null,
            });
          }
        } else {
          newParentKey = parentNameKey;
          if (!newParentsNeeded.has(parentNameKey)) {
            newParentsNeeded.set(parentNameKey, {
              fatherName, grandfatherName, fullName: parentFullName,
              phone: resolvedPhone, email: cleanedParentEmail, normResidence, blockNumber: blockNumber || null,
            });
          }
        }
      }
    }

    // ---- Collect new classes needed ----
    if (grade) {
      const gradeLower = grade.toLowerCase();
      const gradeNorm  = stripGradePrefix(grade);
      if (!classExactMap.has(gradeLower) && !classNormMap.has(gradeNorm)) {
        newClassesNeeded.add(formatClassName(grade));
      }
    }

    parsedRows.push({
      fullName,
      phoneNumber: phoneNumber || null,
      emergencyContact: emergencyContact || null,
      dateOfBirth: parseDob(dateOfBirth || ''),
      homeAddress: homeAddress || null,
      gradeRaw: grade || null,
      existingParentId,
      newParentKey,
      parentUpdateId,
      parentUpdateResidence,
      parentUpdateBlock,
    });
  }

  // =========================================================
  // PASS 2 — batch create new classes
  // =========================================================
  const autoCreatedClasses: string[] = [];
  if (newClassesNeeded.size > 0) {
    const { data: newClasses, error: classErr } = await supabase
      .from('classes')
      .insert(Array.from(newClassesNeeded).map((name) => ({ school_id: schoolId, name, grade_level: name })))
      .select('id, name');
    if (classErr) {
      errors.push(`Failed to create classes: ${classErr.message}`);
    } else {
      for (const c of (newClasses || [])) {
        classExactMap.set(c.name.toLowerCase(), c.id);
        classNormMap.set(stripGradePrefix(c.name), c.id);
        autoCreatedClasses.push(c.name);
      }
    }
  }

  // =========================================================
  // PASS 3 — batch create new parents (users then records)
  // =========================================================
  let parentAccountsCreated = 0;

  // Kick off existing-parent residence updates in the background
  const uniqueUpdates = Array.from(
    new Map(
      parsedRows
        .filter((r) => r.parentUpdateId)
        .map((r) => [r.parentUpdateId!, r])
    ).values()
  );
  const updatePromises = uniqueUpdates.map((r) => {
    const upd: Record<string, unknown> = {};
    if (r.parentUpdateResidence) upd.residence_type = r.parentUpdateResidence;
    if (r.parentUpdateBlock) upd.block_number = r.parentUpdateBlock;
    return supabase.from('parents').update(upd).eq('id', r.parentUpdateId!).eq('school_id', schoolId);
  });

  if (newParentsNeeded.size > 0) {
    const parentEntries = Array.from(newParentsNeeded.entries());

    // 3a — batch insert parent users
    const { data: newUsers, error: usersErr } = await supabase
      .from('users')
      .insert(parentEntries.map(([, p]) => ({
        school_id: schoolId,
        first_name: p.fatherName,
        last_name: p.grandfatherName,
        username: generateParentUsername(p.fatherName, p.grandfatherName.split(' ')[0]),
        password_hash: defaultParentPasswordHash,
        role: 'parent',
        email: p.email,
        is_active: true,
        must_change_password: true,
      })))
      .select('id');

    if (usersErr) {
      errors.push(`Failed to create parent user accounts: ${usersErr.message}`);
    } else if (newUsers && newUsers.length === parentEntries.length) {
      // 3b — batch insert parent records
      const { data: newParentRecords, error: parentsErr } = await supabase
        .from('parents')
        .insert(parentEntries.map(([, p], idx) => ({
          school_id: schoolId,
          user_id: newUsers[idx].id,
          full_name: p.fullName,
          phone_number: p.phone,
          residence_type: p.normResidence,
          block_number: p.blockNumber,
        })))
        .select('id, full_name, phone_number');

      if (parentsErr) {
        errors.push(`Failed to create parent records: ${parentsErr.message}`);
      } else if (newParentRecords) {
        for (let i = 0; i < parentEntries.length; i++) {
          const [key, entry] = parentEntries[i];
          const record = newParentRecords[i];
          entry.createdId = record.id;
          const nk = record.full_name.toLowerCase().trim();
          parentByName.set(nk, { id: record.id, phone: record.phone_number });
          if (record.phone_number) parentByNamePhone.set(`${nk}|${record.phone_number}`, record.id);
          if (key.includes('|')) parentByNamePhone.set(key, record.id);
        }
        parentAccountsCreated = newParentRecords.length;
        // Admin-trusted phone propagation (migration 050) for the bulk
        // batch. Parallel — each entry is independent and the helper
        // swallows its own errors.
        await Promise.all(parentEntries.map(([, p], idx) =>
          propagateAdminSetPhone(newUsers[idx].id, p.phone),
        ));
      }
    }
  }

  await Promise.all(updatePromises);

  // =========================================================
  // PASS 4 — batch insert all students
  // =========================================================
  let created = 0;
  if (parsedRows.length > 0) {
    const studentInserts = parsedRows.map((r) => {
      let classId: string | null = null;
      if (r.gradeRaw) {
        const gradeLower = r.gradeRaw.toLowerCase();
        const gradeNorm  = stripGradePrefix(r.gradeRaw);
        classId = classExactMap.get(gradeLower) ?? classNormMap.get(gradeNorm) ?? null;
      }

      let parentId: string | null = r.existingParentId;
      if (!parentId && r.newParentKey) {
        parentId = newParentsNeeded.get(r.newParentKey)?.createdId ?? null;
      }

      return {
        school_id: schoolId,
        full_name: r.fullName,
        phone_number: r.phoneNumber,
        emergency_contact: r.emergencyContact,
        home_address: r.homeAddress,
        date_of_birth: r.dateOfBirth,
        class_id: classId,
        parent_id: parentId,
      };
    });

    const { data: inserted, error: studentsErr } = await supabase
      .from('students')
      .insert(studentInserts)
      .select('id, class_id');

    if (studentsErr) {
      errors.push(`Failed to insert students: ${studentsErr.message}`);
    } else {
      created = (inserted || []).length;
      // Open per-year enrollment rows for each new student that landed in a
      // class. Sequential rather than batched to keep helper semantics
      // identical to single-create (logged failures don't fail the upload).
      for (const s of inserted || []) {
        await openEnrollmentForCurrentYear({
          schoolId, studentId: String((s as any).id), classId: (s as any).class_id ?? null,
        });
      }
    }
  }

  res.json({ created, skipped: skipped.length, total: rows.length, autoCreatedClasses, parentAccountsCreated, errors });
}

// ---- BULK UPLOAD EMPLOYEES (teachers / drivers) ----
//
// Sibling of bulkUploadStudents: same hardened in-memory XLSX parse (multer
// memoryStorage → the buffer never hits disk), same multi-pass batch-insert
// shape, with auto-create of any missing classes (teachers) / buses (drivers).
// One endpoint; the role is chosen via ?role=teacher|driver.
//
// PII note: this carries the full migration-024 flat HR columns INCLUDING
// national_id + date_of_birth — stored plaintext exactly as single-create
// (createTeacher/createDriver) writes them. The encrypted extended profile
// (employee_extended_profile) and employee documents are a deliberate later
// add-on keyed off the user_id/employee id created here, NOT part of this path.
export async function bulkUploadEmployees(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;

  const ALLOWED_ROLES = ['teacher', 'driver', 'supervisor', 'reception', 'accountant', 'staff'] as const;
  type BulkRole = typeof ALLOWED_ROLES[number];
  const roleParam = String(req.query.role || '').toLowerCase();
  if (!ALLOWED_ROLES.includes(roleParam as BulkRole)) {
    res.status(400).json({
      error: roleParam === 'admin'
        ? "Admin accounts can't be bulk-uploaded — create them individually with a password."
        : 'Query param "role" must be one of: teacher, driver, supervisor, reception, accountant, staff.',
    });
    return;
  }
  const role = roleParam as BulkRole;

  // Accountant + staff live behind the accounting (tuition_fees) module.
  if (role === 'accountant' || role === 'staff') {
    const { data: sf } = await supabase.from('schools').select('features').eq('id', schoolId).single();
    if ((sf?.features as Record<string, boolean> | null)?.tuition_fees !== true) {
      res.status(403).json({ error: 'The accounting module is not enabled for this school.' });
      return;
    }
  }

  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  // Hardened parse — identical posture to bulkUploadStudents: bound rows at
  // read time, only the first sheet, scrub prototype-polluting header keys.
  const MAX_UPLOAD_ROWS = 5000;
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true, sheetRows: MAX_UPLOAD_ROWS + 1 });
  } catch {
    res.status(400).json({ error: 'Could not parse the file. Make sure it is a valid .xlsx or .xls file.' });
    return;
  }

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName || !workbook.Sheets[firstSheetName]) {
    res.status(400).json({ error: 'The file has no readable sheet.' });
    return;
  }

  const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
  const rawRows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(
    workbook.Sheets[firstSheetName], { raw: false, dateNF: 'yyyy-mm-dd', defval: '' });
  const rows: Record<string, unknown>[] = rawRows.map(r => {
    const clean: Record<string, unknown> = Object.create(null);
    for (const k of Object.keys(r)) { if (!FORBIDDEN_KEYS.has(k)) clean[k] = r[k]; }
    return clean;
  });

  if (rows.length === 0) { res.status(400).json({ error: 'The file has no data rows.' }); return; }
  if (rows.length > MAX_UPLOAD_ROWS) {
    res.status(400).json({ error: `Too many rows. Split the upload into files of at most ${MAX_UPLOAD_ROWS} employees.` });
    return;
  }

  // Staff are payroll records (no login) — wholly separate insert path.
  if (role === 'staff') { await runStaffBulk(res, schoolId, rows); return; }

  // Below here: login-account roles only. teacher/driver carry a profile table
  // and a single Full Name; supervisor/reception/accountant are users-only with
  // First/Last Name and their HR columns stored on the users row.
  const loginRole = role; // 'teacher' | 'driver' | 'supervisor' | 'reception' | 'accountant'
  const isProfileRole = loginRole === 'teacher' || loginRole === 'driver';
  const isAccountRole = !isProfileRole;

  // Column header → canonical camelCase field. Headers are matched lower-cased
  // and single-spaced, so "National ID" / "national id" both resolve.
  const NAME_MAP: Record<string, string> = isProfileRole
    ? { 'full name': 'fullName', 'name': 'fullName' }
    : { 'first name': 'firstName', 'last name': 'lastName', 'full name': 'fullName', 'name': 'fullName' };
  const COMMON_MAP: Record<string, string> = {
    'phone number': 'phoneNumber', 'phone': 'phoneNumber', 'primary phone number': 'phoneNumber',
    'emergency contact': 'emergencyContact',
    'email': 'email', 'email address': 'email',
    'username': 'username',
    'password': 'password',
    'address': 'address',
    'hire date': 'hireDate', 'date of hire': 'hireDate',
    'national id': 'nationalId', 'national id number': 'nationalId',
    'date of birth': 'dateOfBirth', 'dob': 'dateOfBirth',
    'marital status': 'maritalStatus',
    'gender': 'gender',
    'employment type': 'employmentType',
    'qualifications': 'qualifications',
    'notes': 'notes',
  };
  const TEACHER_MAP: Record<string, string> = {
    'class': 'className', 'classes': 'className', 'grade': 'className', 'grade/class': 'className',
    'subject': 'subjects', 'subjects': 'subjects',
  };
  const DRIVER_MAP: Record<string, string> = {
    'license number': 'licenseNumber', 'license': 'licenseNumber',
    'licence number': 'licenseNumber', 'licence': 'licenseNumber',
    'bus number': 'busNumber', 'bus': 'busNumber',
    'age': 'age',
    'vehicle type': 'vehicleType', 'vehicle': 'vehicleType',
  };
  const roleSpecificMap = loginRole === 'teacher' ? TEACHER_MAP : loginRole === 'driver' ? DRIVER_MAP : {};
  const COLUMN_MAP: Record<string, string> = { ...NAME_MAP, ...COMMON_MAP, ...roleSpecificMap };

  // Forgiving normalisers — like the student importer, an unparseable enum or
  // date becomes null rather than failing the row (the DB CHECKs would reject
  // a typo'd enum, so we sanitise before insert).
  const parseDate = (raw: string): string | null => {
    if (!raw || !raw.trim()) return null;
    let s = raw.trim();
    const ddmm = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (ddmm) s = `${ddmm[3]}-${ddmm[2].padStart(2, '0')}-${ddmm[1].padStart(2, '0')}`;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
  };
  const normMarital = (v: string): string | null => {
    const x = v.trim().toLowerCase();
    return ['single', 'married', 'divorced', 'widowed'].includes(x) ? x : null;
  };
  const normGender = (v: string): string | null => {
    const x = v.trim().toLowerCase();
    if (x === 'male' || x === 'm') return 'male';
    if (x === 'female' || x === 'f') return 'female';
    return null;
  };
  const normEmployment = (v: string): string | null => {
    const x = v.trim().toLowerCase().replace(/[\s-]+/g, '_');
    return ['full_time', 'part_time', 'contract'].includes(x) ? x : null;
  };
  const normVehicle = (v: string): 'bus' | 'taxi' => (v.trim().toLowerCase() === 'taxi' ? 'taxi' : 'bus');
  // Contact email — store only if it looks like an address, else null (forgiving).
  const normEmail = (v: string): string | null => {
    const x = v.trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x) ? x : null;
  };
  const stripGradePrefix = (g: string) => g.trim().toLowerCase().replace(/^grade\s+/, '');
  const formatClassName = (g: string): string => {
    const t = g.trim();
    if (/^\d+$/.test(t)) return `Grade ${t}`;
    if (/^grade\s+\d+$/i.test(t)) return `Grade ${t.replace(/^grade\s+/i, '')}`;
    return t;
  };

  // =========================================================
  // PASS 0 — fetch existing data in one parallel round-trip
  // =========================================================
  const [
    { data: schoolData },
    { data: existingUsers },
    { data: existingClasses },
    { data: existingBuses },
    { data: existingSubjects },
  ] = await Promise.all([
    supabase.from('schools').select('abbreviation').eq('id', schoolId).single(),
    supabase.from('users').select('username').eq('school_id', schoolId),
    role === 'teacher'
      ? supabase.from('classes').select('id, name').eq('school_id', schoolId)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    role === 'driver'
      ? supabase.from('buses').select('id, bus_number').eq('school_id', schoolId)
      : Promise.resolve({ data: [] as { id: string; bus_number: string }[] }),
    role === 'teacher'
      ? supabase.from('subjects').select('id, name').eq('school_id', schoolId)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);

  const schoolAbbrev = (schoolData?.abbreviation || '').toLowerCase();
  // username is UNIQUE per school across ALL roles, so seed the taken-set with
  // every existing username (not just this role's) to avoid cross-role clashes.
  const takenUsernames = new Set((existingUsers || []).map((u: any) => (u.username as string).toLowerCase()));

  const classExactMap = new Map<string, string>(); // name.toLowerCase() → id
  const classNormMap = new Map<string, string>();   // stripped form     → id
  for (const c of (existingClasses || [])) {
    classExactMap.set(c.name.toLowerCase(), c.id);
    classNormMap.set(stripGradePrefix(c.name), c.id);
  }
  const busMap = new Map<string, string>(); // bus_number → id
  for (const b of (existingBuses || [])) busMap.set(String(b.bus_number), b.id);
  const subjectMap = new Map<string, string>(); // name.toLowerCase() → id
  for (const s of (existingSubjects || [])) subjectMap.set(s.name.toLowerCase(), s.id);

  const rounds = parseInt(process.env.BCRYPT_ROUNDS || '10');
  const defaultPassword = defaultPasswordFor(role);
  const defaultHash = await bcrypt.hash(defaultPassword, rounds);

  // Build a unique username: prefix the school abbrev (unless already present),
  // then suffix -2/-3/… on collision against the school-wide taken set.
  const makeUsername = (rawNameOrUser: string): string => {
    const base0 = schoolAbbrev && !rawNameOrUser.startsWith(`${schoolAbbrev}_`)
      ? `${schoolAbbrev}_${rawNameOrUser}` : rawNameOrUser;
    const base = base0.toLowerCase();
    if (!takenUsernames.has(base)) { takenUsernames.add(base); return base; }
    let n = 2;
    while (takenUsernames.has(`${base}${n}`)) n++;
    takenUsernames.add(`${base}${n}`);
    return `${base}${n}`;
  };

  // =========================================================
  // PASS 1 — parse all rows in memory, zero DB calls
  // =========================================================
  interface ParsedEmp {
    fullName: string; firstName: string; lastName: string;
    username: string; password: string; usedDefault: boolean; passwordHash: string;
    phoneNumber: string | null; emergencyContact: string | null; email: string | null;
    hr: Record<string, unknown>;
    classNames: string[]; subjectNames: string[];  // teacher
    licenseNumber: string | null; busNumberRaw: string | null; age: number | null; vehicleType: 'bus' | 'taxi'; // driver
  }
  const parsed: ParsedEmp[] = [];
  const newClassesNeeded = new Set<string>();
  const newBusesNeeded = new Set<string>();
  // lower-cased name → canonical casing, so "Math" + "math" don't double-insert.
  const newSubjectsNeeded = new Map<string, string>();
  const errors: string[] = [];
  const skipped: string[] = [];
  const customHashJobs: { idx: number; password: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 2; // +1 header, +1 to 1-base
    const mapped: Record<string, string> = {};
    for (const [key, val] of Object.entries(rows[i])) {
      const norm = key.trim().toLowerCase().replace(/\s+/g, ' ');
      const field = COLUMN_MAP[norm];
      if (field) mapped[field] = String(val).trim();
    }

    // Name + username differ by role group:
    //  · profile roles (teacher/driver): one "Full Name", username = name.father
    //  · account roles (supervisor/reception/accountant): "First Name"+"Last Name"
    //    (falling back to splitting a Full Name), username = first.last
    let firstName: string, lastName: string, fullName: string, rawUser: string;
    if (isAccountRole) {
      firstName = (mapped.firstName || '').trim();
      lastName = (mapped.lastName || '').trim();
      if (!firstName && !lastName && mapped.fullName) {
        const p = mapped.fullName.trim().split(/\s+/);
        firstName = p[0] || ''; lastName = p.slice(1).join(' ');
      }
      if (!firstName) { errors.push(`Row ${rowNum}: missing "First Name" — skipped`); continue; }
      fullName = `${firstName} ${lastName}`.trim();
      rawUser = mapped.username ? mapped.username.toLowerCase() : `${firstName}.${lastName}`.toLowerCase();
    } else {
      fullName = (mapped.fullName || '').trim();
      if (!fullName) { errors.push(`Row ${rowNum}: missing "Full Name" — skipped`); continue; }
      const nameParts = fullName.split(/\s+/);
      firstName = nameParts[0] || fullName;
      lastName = nameParts.slice(1).join(' ') || '';
      rawUser = mapped.username ? mapped.username.toLowerCase() : nameParts.slice(0, 2).join('.').toLowerCase();
    }
    const username = makeUsername(rawUser);

    const customPw = mapped.password && mapped.password.length > 0 ? mapped.password : null;
    const usedDefault = !customPw;
    const password = customPw || defaultPassword;

    // Flat HR columns via the shared single-create mapping. Enums/dates are
    // normalised first so a typo lands as null instead of tripping a DB CHECK.
    // Account roles store HR (incl. emergency_contact) on the users row, like
    // createAccount; profile roles store it on the teachers/drivers row.
    const hr = hrColumns({
      address: mapped.address || null,
      hireDate: parseDate(mapped.hireDate || ''),
      nationalId: mapped.nationalId || null,
      dateOfBirth: parseDate(mapped.dateOfBirth || ''),
      maritalStatus: mapped.maritalStatus ? normMarital(mapped.maritalStatus) : null,
      gender: mapped.gender ? normGender(mapped.gender) : null,
      employmentType: mapped.employmentType ? normEmployment(mapped.employmentType) : null,
      qualifications: mapped.qualifications || null,
      notes: mapped.notes || null,
      emergencyContact: mapped.emergencyContact || null,
    }, isAccountRole ? { includeEmergency: true } : {});

    const emp: ParsedEmp = {
      fullName, firstName, lastName, username, password, usedDefault, passwordHash: defaultHash,
      phoneNumber: mapped.phoneNumber || null,
      emergencyContact: mapped.emergencyContact || null,
      email: mapped.email ? normEmail(mapped.email) : null,
      hr,
      classNames: [], subjectNames: [], licenseNumber: null, busNumberRaw: null, age: null, vehicleType: 'bus',
    };
    if (!usedDefault) customHashJobs.push({ idx: parsed.length, password });

    if (role === 'teacher') {
      // Classes — comma/semicolon-separated (a teacher can teach several),
      // deduped case-insensitively; unknown ones queued for creation.
      const clsRaw = mapped.className || '';
      if (clsRaw) {
        const seen = new Set<string>();
        for (const nm of clsRaw.split(/[,;]/).map(s => s.trim()).filter(Boolean)) {
          const lc = nm.toLowerCase();
          if (seen.has(lc)) continue;
          seen.add(lc);
          emp.classNames.push(nm);
          if (!classExactMap.has(lc) && !classNormMap.has(stripGradePrefix(nm))) {
            newClassesNeeded.add(formatClassName(nm));
          }
        }
      }
      // Subjects — comma/semicolon-separated, deduped case-insensitively.
      const subjRaw = mapped.subjects || '';
      if (subjRaw) {
        const seen = new Set<string>();
        for (const nm of subjRaw.split(/[,;]/).map(s => s.trim()).filter(Boolean)) {
          const lc = nm.toLowerCase();
          if (seen.has(lc)) continue;
          seen.add(lc);
          emp.subjectNames.push(nm);
          if (!subjectMap.has(lc) && !newSubjectsNeeded.has(lc)) newSubjectsNeeded.set(lc, nm);
        }
      }
    } else {
      emp.licenseNumber = mapped.licenseNumber || null;
      emp.vehicleType = mapped.vehicleType ? normVehicle(mapped.vehicleType) : 'bus';
      const ageNum = parseInt(mapped.age || '', 10);
      emp.age = Number.isFinite(ageNum) && ageNum >= 0 && ageNum <= 120 ? ageNum : null;
      const bus = mapped.busNumber || '';
      if (bus) {
        emp.busNumberRaw = bus;
        if (!busMap.has(bus)) newBusesNeeded.add(bus);
      }
    }

    parsed.push(emp);
  }

  if (parsed.length === 0) {
    res.json({ created: 0, skipped: skipped.length, total: rows.length, autoCreatedClasses: [], autoCreatedBuses: [], autoCreatedSubjects: [], credentials: [], errors });
    return;
  }

  // Hash any per-row custom passwords in parallel; default-password rows reuse
  // the single pre-computed defaultHash (same approach as the parent importer).
  if (customHashJobs.length > 0) {
    const hashes = await Promise.all(customHashJobs.map(j => bcrypt.hash(j.password, rounds)));
    customHashJobs.forEach((j, k) => { parsed[j.idx].passwordHash = hashes[k]; });
  }

  // =========================================================
  // PASS 2 — batch create missing classes (teacher) / buses (driver)
  // =========================================================
  const autoCreatedClasses: string[] = [];
  if (role === 'teacher' && newClassesNeeded.size > 0) {
    const { data: nc, error: ncErr } = await supabase.from('classes')
      .insert(Array.from(newClassesNeeded).map(name => ({ school_id: schoolId, name, grade_level: name })))
      .select('id, name');
    if (ncErr) { errors.push(`Failed to create classes: ${ncErr.message}`); }
    else for (const c of (nc || [])) {
      classExactMap.set(c.name.toLowerCase(), c.id);
      classNormMap.set(stripGradePrefix(c.name), c.id);
      autoCreatedClasses.push(c.name);
    }
  }

  const autoCreatedBuses: string[] = [];
  if (role === 'driver' && newBusesNeeded.size > 0) {
    const { data: nb, error: nbErr } = await supabase.from('buses')
      .insert(Array.from(newBusesNeeded).map(bus_number => ({ school_id: schoolId, bus_number })))
      .select('id, bus_number');
    if (nbErr) { errors.push(`Failed to create buses: ${nbErr.message}`); }
    else for (const b of (nb || [])) {
      busMap.set(String(b.bus_number), b.id);
      autoCreatedBuses.push(String(b.bus_number));
    }
  }

  const autoCreatedSubjects: string[] = [];
  if (role === 'teacher' && newSubjectsNeeded.size > 0) {
    const { data: ns, error: nsErr } = await supabase.from('subjects')
      .insert(Array.from(newSubjectsNeeded.values()).map(name => ({ school_id: schoolId, name, teacher_id: null })))
      .select('id, name');
    if (nsErr) { errors.push(`Failed to create subjects: ${nsErr.message}`); }
    else for (const s of (ns || [])) {
      subjectMap.set(s.name.toLowerCase(), s.id);
      autoCreatedSubjects.push(s.name);
    }
  }

  // =========================================================
  // PASS 3 — batch insert the user accounts
  // =========================================================
  const { data: newUsers, error: usersErr } = await supabase.from('users')
    .insert(parsed.map(e => ({
      school_id: schoolId,
      first_name: e.firstName,
      last_name: e.lastName,
      username: e.username,
      password_hash: e.passwordHash,
      role,
      email: e.email,
      // Account roles have no profile table — their phone + HR live on users.
      ...(isAccountRole ? { phone: e.phoneNumber, ...e.hr } : {}),
      must_change_password: e.usedDefault,
    })))
    .select('id');

  if (usersErr || !newUsers || newUsers.length !== parsed.length) {
    res.status(usersErr ? safeDbErrorStatus(usersErr) : 500)
      .json({ error: `Failed to create user accounts: ${usersErr?.message || 'row count mismatch'}` });
    return;
  }

  // =========================================================
  // PASS 4 — batch insert the role records (RETURNING preserves input order)
  // =========================================================
  let created = 0;
  // Role-record ids (teachers.id / drivers.id) aligned to `parsed`, so the
  // response can hand the frontend an id per row for the photo-matcher step.
  let roleRecordIds: string[] = [];
  if (role === 'teacher') {
    const { data: newTeachers, error: tErr } = await supabase.from('teachers')
      .insert(parsed.map((e, idx) => ({
        school_id: schoolId,
        user_id: newUsers[idx].id,
        full_name: e.fullName,
        phone_number: e.phoneNumber,
        emergency_contact: e.emergencyContact,
        subject: null, // populated later from the curriculum (class ↔ subject ↔ teacher)
        ...e.hr,
      })))
      .select('id');
    if (tErr || !newTeachers) { res.status(safeDbErrorStatus(tErr)).json({ error: safeDbErrorMessage(tErr) }); return; }
    created = newTeachers.length;
    roleRecordIds = newTeachers.map((r: { id: string }) => r.id);

    // teacher_classes + curriculum (class ↔ subject ↔ teacher) for rows that
    // named a resolvable class. Subjects are class-scoped, so a teacher's
    // subjects attach to the class in their row; subjects on a class-less row
    // are still created above but can't be assigned (we note that once).
    const tcRows: { teacher_id: string; class_id: string }[] = [];
    const cstRows: { school_id: string; class_id: string; subject_id: string; teacher_id: string }[] = [];
    const affectedTeacherIds = new Set<string>();
    const affectedSubjectIds = new Set<string>();
    let subjectsNeedClass = 0;
    parsed.forEach((e, idx) => {
      const tid = newTeachers[idx].id;
      // Resolve every named class to an id (deduped).
      const cids: string[] = [];
      for (const nm of e.classNames) {
        const cid = classExactMap.get(nm.toLowerCase()) ?? classNormMap.get(stripGradePrefix(nm)) ?? null;
        if (cid && !cids.includes(cid)) cids.push(cid);
      }
      for (const cid of cids) tcRows.push({ teacher_id: tid, class_id: cid });
      if (e.subjectNames.length === 0) return;
      if (cids.length === 0) { subjectsNeedClass++; return; }
      // Curriculum triple per (class × subject) the teacher row named.
      for (const cid of cids) {
        for (const nm of e.subjectNames) {
          const sid = subjectMap.get(nm.toLowerCase());
          if (!sid) continue;
          cstRows.push({ school_id: schoolId, class_id: cid, subject_id: sid, teacher_id: tid });
          affectedTeacherIds.add(tid);
          affectedSubjectIds.add(sid);
        }
      }
    });
    if (tcRows.length > 0) await supabase.from('teacher_classes').insert(tcRows);
    if (cstRows.length > 0) {
      await supabase.from('class_subject_teachers')
        .upsert(cstRows, { onConflict: 'class_id,subject_id,teacher_id', ignoreDuplicates: true });
      // Rebuild the subject_teachers + teachers.subject + subjects.teacher_id caches.
      await recomputeCaches(schoolId, { teacherIds: [...affectedTeacherIds], subjectIds: [...affectedSubjectIds] });
    }
    if (subjectsNeedClass > 0) {
      errors.push(`${subjectsNeedClass} teacher(s) had subjects but no class — the subjects were created but not assigned (subjects are assigned per class; add them in Curriculum).`);
    }
  } else if (role === 'driver') {
    const { data: newDrivers, error: dErr } = await supabase.from('drivers')
      .insert(parsed.map((e, idx) => ({
        school_id: schoolId,
        user_id: newUsers[idx].id,
        full_name: e.fullName,
        phone_number: e.phoneNumber,
        emergency_contact: e.emergencyContact,
        license_number: e.licenseNumber,
        bus_id: e.busNumberRaw ? (busMap.get(e.busNumberRaw) ?? null) : null,
        age: e.age,
        vehicle_type: e.vehicleType,
        ...e.hr,
      })))
      .select('id');
    if (dErr || !newDrivers) { res.status(safeDbErrorStatus(dErr)).json({ error: safeDbErrorMessage(dErr) }); return; }
    created = newDrivers.length;
    roleRecordIds = newDrivers.map((r: { id: string }) => r.id);
  } else {
    // Account roles (supervisor / reception / accountant): users-only, HR was
    // written on the users row above, no profile table to populate.
    created = newUsers.length;
    roleRecordIds = newUsers.map((u: { id: string }) => u.id);
  }

  // Admin-trusted phone propagation (migration 050) — parallel, self-logging.
  await Promise.all(parsed.map((e, idx) => propagateAdminSetPhone(newUsers[idx].id, e.phoneNumber)));

  // Hand back the credentials so the admin can print/distribute the temp
  // passwords (every must_change_password account needs them once). `id` is the
  // role-record id (teachers.id) the photo-matcher step attaches photos to.
  const credentials = parsed.map((e, idx) => ({
    id: roleRecordIds[idx], fullName: e.fullName, role, username: e.username, password: e.password,
  }));

  res.json({
    created, skipped: skipped.length, total: rows.length,
    autoCreatedClasses, autoCreatedBuses, autoCreatedSubjects, credentials, errors,
  });
}

// Staff bulk path — payroll records on staff_members, NOT login accounts (no
// users row, no username/password). Salary + currency are required per row;
// invalid rows are reported in `errors` and skipped. Caller has already
// verified the accounting feature gate and parsed `rows`.
async function runStaffBulk(res: Response, schoolId: string, rows: Record<string, unknown>[]): Promise<void> {
  const STAFF_MAP: Record<string, string> = {
    'full name': 'fullName', 'name': 'fullName',
    'position': 'position', 'role': 'position', 'title': 'position',
    'salary amount': 'salaryAmount', 'salary': 'salaryAmount',
    'currency': 'currency',
    'next payment date': 'nextPaymentDate', 'payment date': 'nextPaymentDate',
    'is active': 'isActive', 'active': 'isActive',
    'insurance percentage': 'insurancePercentage', 'insurance %': 'insurancePercentage', 'insurance': 'insurancePercentage',
    'emergency contact': 'emergencyContact',
    'address': 'address',
    'hire date': 'hireDate', 'date of hire': 'hireDate',
    'national id': 'nationalId', 'national id number': 'nationalId',
    'date of birth': 'dateOfBirth', 'dob': 'dateOfBirth',
    'marital status': 'maritalStatus',
    'gender': 'gender',
    'employment type': 'employmentType',
    'qualifications': 'qualifications',
    'notes': 'notes',
  };
  const parseDate = (raw: string): string | null => {
    if (!raw || !raw.trim()) return null;
    let s = raw.trim();
    const ddmm = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (ddmm) s = `${ddmm[3]}-${ddmm[2].padStart(2, '0')}-${ddmm[1].padStart(2, '0')}`;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
  };
  const normMarital = (v: string) => { const x = v.trim().toLowerCase(); return ['single', 'married', 'divorced', 'widowed'].includes(x) ? x : null; };
  const normGender = (v: string) => { const x = v.trim().toLowerCase(); if (x === 'male' || x === 'm') return 'male'; if (x === 'female' || x === 'f') return 'female'; return null; };
  const normEmployment = (v: string) => { const x = v.trim().toLowerCase().replace(/[\s-]+/g, '_'); return ['full_time', 'part_time', 'contract'].includes(x) ? x : null; };
  const isFalsey = (v: string) => ['false', 'no', '0', 'inactive', 'n'].includes(v.trim().toLowerCase());

  const errors: string[] = [];
  const inserts: Record<string, unknown>[] = [];
  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 2;
    const mapped: Record<string, string> = {};
    for (const [key, val] of Object.entries(rows[i])) {
      const field = STAFF_MAP[key.trim().toLowerCase().replace(/\s+/g, ' ')];
      if (field) mapped[field] = String(val).trim();
    }

    const fullName = (mapped.fullName || '').trim();
    if (!fullName) { errors.push(`Row ${rowNum}: missing "Full Name" — skipped`); continue; }

    const salaryAmount = parseFloat(mapped.salaryAmount || '');
    if (!Number.isFinite(salaryAmount) || salaryAmount < 0) {
      errors.push(`Row ${rowNum}: "${fullName}" — a valid Salary Amount is required — skipped`); continue;
    }
    const currency = (mapped.currency || '').trim().toUpperCase().slice(0, 8);
    if (!currency) { errors.push(`Row ${rowNum}: "${fullName}" — Currency is required — skipped`); continue; }

    const insurPct = parseFloat(mapped.insurancePercentage || '');
    const insurance = Number.isFinite(insurPct) && insurPct >= 0 && insurPct <= 100 ? insurPct : null;

    inserts.push({
      school_id: schoolId,
      user_id: null,
      full_name: fullName,
      position: mapped.position || null,
      salary_amount: salaryAmount,
      currency,
      next_payment_date: parseDate(mapped.nextPaymentDate || ''),
      is_active: mapped.isActive ? !isFalsey(mapped.isActive) : true,
      insurance_percentage: insurance,
      previous_archive_id: null,
      ...hrColumns({
        address: mapped.address || null,
        hireDate: parseDate(mapped.hireDate || ''),
        nationalId: mapped.nationalId || null,
        dateOfBirth: parseDate(mapped.dateOfBirth || ''),
        maritalStatus: mapped.maritalStatus ? normMarital(mapped.maritalStatus) : null,
        gender: mapped.gender ? normGender(mapped.gender) : null,
        employmentType: mapped.employmentType ? normEmployment(mapped.employmentType) : null,
        qualifications: mapped.qualifications || null,
        notes: mapped.notes || null,
        emergencyContact: mapped.emergencyContact || null,
      }, { includeEmergency: true }),
    });
  }

  let created = 0;
  if (inserts.length > 0) {
    const { data, error } = await supabase.from('staff_members').insert(inserts).select('id');
    if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
    created = (data || []).length;
  }

  res.json({
    created, skipped: 0, total: rows.length,
    autoCreatedClasses: [], autoCreatedBuses: [], autoCreatedSubjects: [], credentials: [], errors,
  });
}

// Streams a ready-to-fill .xlsx template (just the header row) for the bulk
// employee upload. Column order matches the headers bulkUploadEmployees' maps
// understand; role chosen via ?role=teacher|driver|supervisor|reception|accountant|staff.
export async function employeeBulkTemplate(req: AuthRequest, res: Response): Promise<void> {
  const ALLOWED = ['teacher', 'driver', 'supervisor', 'reception', 'accountant', 'staff'];
  const role = String(req.query.role || '').toLowerCase();
  if (!ALLOWED.includes(role)) {
    res.status(400).json({ error: 'Query param "role" must be one of: teacher, driver, supervisor, reception, accountant, staff.' });
    return;
  }

  // Shared HR tail used by every role.
  const hrTail = [
    'Address', 'Hire Date', 'National ID', 'Date of Birth',
    'Marital Status', 'Gender', 'Employment Type', 'Qualifications', 'Notes',
  ];

  let headers: string[];
  let sheetName: string;
  if (role === 'staff') {
    // Payroll record — no login columns.
    headers = ['Full Name', 'Position', 'Salary Amount', 'Currency', 'Next Payment Date',
      'Insurance Percentage', 'Is Active', 'Emergency Contact', ...hrTail];
    sheetName = 'Staff';
  } else if (role === 'teacher' || role === 'driver') {
    const roleCols = role === 'teacher'
      ? ['Classes', 'Subjects']
      : ['License Number', 'Bus Number', 'Age', 'Vehicle Type'];
    headers = ['Full Name', 'Phone Number', 'Emergency Contact', 'Email', ...roleCols,
      'Username', 'Password', ...hrTail];
    sheetName = role === 'teacher' ? 'Teachers' : 'Drivers';
  } else {
    // Account roles: supervisor / reception / accountant — First/Last name.
    headers = ['First Name', 'Last Name', 'Phone Number', 'Emergency Contact', 'Email',
      'Username', 'Password', ...hrTail];
    sheetName = role.charAt(0).toUpperCase() + role.slice(1);
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers]);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${role}-bulk-template.xlsx"`);
  res.send(buf);
}

// ---- ARCHIVE STUDENTS ----

// Build the frozen snapshot payload for a student: classes attended per
// academic year, grades (marks[] + legacy columns), and full tuition
// payment history (per-payment fields mirror fee_payments so receipts /
// refund chains / tax records survive). Shared by archiveStudent
// (transferred/withdrew — deletes the row) and snapshotGraduatedStudent
// (graduated — keeps the row). Returns null if the student isn't in this
// school. Currency on each payment is the source of truth — never falls
// back to the plan currency (accounting invariant).
async function buildStudentArchiveSnapshot(schoolId: string, studentId: string): Promise<{
  student: any;
  classesAttended: { year: string; classId: string; className: string }[];
  enrollmentHistory: EnrollmentSnapshotEntry[];
  gradesSnapshot: any[];
  reportsSnapshot: any[];
  paymentHistory: any[];
} | null> {
  const { data: student, error: studentErr } = await supabase
    .from('students')
    .select('*, parents(full_name, phone_number)')
    .eq('id', studentId)
    .eq('school_id', schoolId)
    .single();
  if (studentErr || !student) return null;

  const { data: grades } = await supabase
    .from('grades')
    .select('academic_year, grading_period, subject, marks, daily_grade, quiz_grade, monthly_exam_grade, term_exam_grade, class_id, classes(name)')
    .eq('student_id', studentId)
    .eq('school_id', schoolId)
    .order('academic_year');

  // Legacy classes_attended JSONB. As of migration 030 + the Phase 5/6
  // rewrite, the academic record lives in enrollment_history (sourced
  // below from student_enrollments). We keep WRITING an empty array to
  // the column because migration 019's tamper-evidence hash
  // (_canon_archived_student) includes classes_attended::text in its
  // canonical input — dropping or changing it would break integrity
  // verification on every existing archive. The shape stays []; the
  // hash stays valid; readers ignore it.
  const classesAttended: { year: string; classId: string; className: string }[] = [];

  const gradesSnapshot = (grades || []).map((g) => ({
    academicYear: g.academic_year,
    gradingPeriod: g.grading_period,
    subject: g.subject,
    classId: (g as any).class_id ?? null,
    className: (g as any).classes?.name ?? null,
    marks: (g as any).marks ?? [],
    dailyGrade: g.daily_grade,
    quizGrade: g.quiz_grade,
    monthlyExamGrade: g.monthly_exam_grade,
    termExamGrade: g.term_exam_grade,
  }));

  // Reports snapshot — migration 041 makes reports durable year-organized
  // history. At archive time we freeze the full set onto archived_students.
  // class_name_snapshot / teacher_name_snapshot are read from the report
  // itself (stamped at write time) so the snapshot survives a class or
  // teacher delete after the report was written.
  const { data: reports } = await supabase
    .from('reports')
    .select('academic_year, subject, class_id, class_name_snapshot, teacher_id, teacher_name_snapshot, attendance_notes, behavior_notes, marks, teacher_notes, quiz_marks, exam_marks, report_date, shared_with_other_teachers, created_at')
    .eq('student_id', studentId)
    .eq('school_id', schoolId)
    .order('academic_year', { ascending: true })
    .order('created_at', { ascending: true });

  const reportsSnapshot = (reports || []).map((r: any) => ({
    academicYear: r.academic_year,
    subject: r.subject,
    classId: r.class_id ?? null,
    className: r.class_name_snapshot ?? null,
    teacherId: r.teacher_id ?? null,
    teacherName: r.teacher_name_snapshot ?? null,
    attendanceNotes: r.attendance_notes ?? null,
    behaviorNotes: r.behavior_notes ?? null,
    marks: r.marks ?? [],
    teacherNotes: r.teacher_notes ?? null,
    quizMarks: r.quiz_marks,
    examMarks: r.exam_marks,
    reportDate: r.report_date,
    sharedWithOtherTeachers: Boolean(r.shared_with_other_teachers),
    createdAt: r.created_at,
  }));

  const { data: studentFeeRows } = await supabase
    .from('student_fees')
    .select('id, total_amount, adjustment, sibling_discount, late_fees, notes, created_at, fee_plans(name, currency, academic_year)')
    .eq('student_id', studentId)
    .eq('school_id', schoolId);

  const sfIds = (studentFeeRows || []).map((s: any) => s.id);
  const { data: paymentRows } = sfIds.length
    ? await supabase
        .from('fee_payments')
        .select(`id, student_fee_id, amount, paid_on, method, reference, notes, created_at,
                 currency, receipt_year, receipt_number, tax_amount, tax_label,
                 payment_account_id, is_refund, refund_of_payment_id`)
        .in('student_fee_id', sfIds)
        .order('paid_on', { ascending: true })
    : { data: [] as any[] };

  // Live late-fee totals (non-voided). student_fees has no late_fees
  // column — the value lives in the separate student_fee_late_fees table,
  // which cascade-deletes with the student. So we sum it now and freeze
  // the per-fee total into the snapshot for receipt regen / writeoff math.
  const { data: lateFeeRows } = sfIds.length
    ? await supabase
        .from('student_fee_late_fees')
        .select('student_fee_id, amount')
        .eq('school_id', schoolId)
        .in('student_fee_id', sfIds)
        .is('voided_at', null)
    : { data: [] as any[] };
  const lateFeesBySf = new Map<string, number>();
  for (const lf of (lateFeeRows || []) as any[]) {
    lateFeesBySf.set(
      lf.student_fee_id,
      (lateFeesBySf.get(lf.student_fee_id) ?? 0) + Number(lf.amount),
    );
  }

  const paymentsBySf = new Map<string, any[]>();
  for (const p of paymentRows || []) {
    const arr = paymentsBySf.get((p as any).student_fee_id) ?? [];
    arr.push({
      id: (p as any).id,
      amount: Number((p as any).amount),
      paidOn: (p as any).paid_on,
      method: (p as any).method ?? null,
      reference: (p as any).reference ?? null,
      notes: (p as any).notes ?? null,
      createdAt: (p as any).created_at,
      currency: (p as any).currency ?? null,
      receiptYear: (p as any).receipt_year ?? null,
      receiptNumber: (p as any).receipt_number ?? null,
      taxAmount: (p as any).tax_amount != null ? Number((p as any).tax_amount) : null,
      taxLabel: (p as any).tax_label ?? null,
      paymentAccountId: (p as any).payment_account_id ?? null,
      isRefund: Boolean((p as any).is_refund),
      refundOfPaymentId: (p as any).refund_of_payment_id ?? null,
    });
    paymentsBySf.set((p as any).student_fee_id, arr);
  }

  const paymentHistory = (studentFeeRows || []).map((sf: any) => {
    const payments = paymentsBySf.get(sf.id) ?? [];
    return {
      studentFeeId: sf.id,
      planName: sf.fee_plans?.name ?? 'Plan',
      academicYear: sf.fee_plans?.academic_year ?? null,
      currency: sf.fee_plans?.currency ?? 'USD',
      totalAmount: Number(sf.total_amount),
      adjustment: Number(sf.adjustment),
      siblingDiscount: sf.sibling_discount != null ? Number(sf.sibling_discount) : 0,
      lateFees: lateFeesBySf.get(sf.id) ?? 0,
      notes: sf.notes ?? null,
      createdAt: sf.created_at,
      payments,
    };
  });

  // Per-year academic progression (migration 030). Source of truth for the
  // archive's academic record. classesAttended above stays at [] because
  // migration 019's tamper-evidence hash includes classes_attended in the
  // canonical input — dropping it would invalidate every existing archive.
  const enrollmentRows = await loadEnrollmentHistory(schoolId, studentId);

  // HD-1 — pull every attendance row for this student and bucket them by
  // academic year (Sept boundary), then attach to enrollment_history.
  // Live attendance CASCADE-deletes with the student row, so this is the
  // last chance to capture the granular daily log.
  const { data: attendanceRows } = await supabase
    .from('attendance')
    .select('date, status, notes')
    .eq('student_id', studentId)
    .eq('school_id', schoolId)
    .order('date', { ascending: true });
  const attendanceByYear = new Map<string, { date: string; status: 'present' | 'absent' | 'late' | 'excused'; notes: string | null }[]>();
  for (const a of (attendanceRows ?? []) as any[]) {
    const yr = academicYearOf(String(a.date));
    const arr = attendanceByYear.get(yr) ?? [];
    arr.push({ date: a.date, status: a.status, notes: a.notes ?? null });
    attendanceByYear.set(yr, arr);
  }

  const enrollmentHistory = rowsToSnapshot(enrollmentRows, attendanceByYear);

  return { student, classesAttended, enrollmentHistory, gradesSnapshot, reportsSnapshot, paymentHistory };
}

// Freeze a graduated student into archived_students (reason='graduated')
// WITHOUT deleting the live row — so the parent's read-only report can't
// drift or vanish (finding F5). Best-effort + idempotent: skips if a
// graduated snapshot already exists. Never throws; a snapshot failure
// must not abort graduation.
async function snapshotGraduatedStudent(
  schoolId: string,
  studentId: string,
  actor: { id: string; name: string; role: string },
): Promise<void> {
  try {
    const { data: existing } = await supabase
      .from('archived_students')
      .select('id')
      .eq('school_id', schoolId)
      .eq('original_student_id', studentId)
      .eq('reason', 'graduated')
      .limit(1)
      .maybeSingle();
    if (existing) return;

    const snap = await buildStudentArchiveSnapshot(schoolId, studentId);
    if (!snap) return;
    const { student } = snap;
    const { error } = await supabase.from('archived_students').insert({
      school_id: schoolId,
      original_student_id: studentId,
      full_name: student.full_name,
      date_of_birth: student.date_of_birth ?? null,
      enrollment_date: student.created_at ? String(student.created_at).split('T')[0] : null,
      departure_date: new Date().toISOString().split('T')[0],
      reason: 'graduated',
      parent_full_name: (student as any).parents?.full_name ?? null,
      parent_phone: (student as any).parents?.phone_number ?? null,
      classes_attended: snap.classesAttended,
      enrollment_history: snap.enrollmentHistory,
      grades: snap.gradesSnapshot,
      payment_history: snap.paymentHistory,
      reports: snap.reportsSnapshot,
      archived_by: actor.id,
      archived_by_name: actor.name,
      archived_by_role: actor.role,
      original_parent_id: (student as any).parent_id ?? null,
    });
    if (error) console.error(`[graduated snapshot] student ${studentId}: ${error.message}`);
  } catch (e) {
    console.error(`[graduated snapshot] student ${studentId} threw: ${(e as Error).message}`);
  }
}

export async function archiveStudent(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  const { reason, departureDate } = req.body;

  if (!(await hasArchiveFeature(schoolId))) {
    res.status(403).json({ error: 'Archive feature is not enabled for this school' });
    return;
  }
  if (!reason || !['transferred', 'withdrew'].includes(reason)) {
    res.status(400).json({ error: 'reason must be "transferred" or "withdrew"' });
    return;
  }

  // Close the current year's enrollment row with the matching status BEFORE
  // building the snapshot — the snapshot reads the freshly-closed row so the
  // archive sees the final state. After this point the student row is
  // deleted, which CASCADEs the enrollment rows, so the snapshot is the
  // only durable copy.
  await closeCurrentEnrollment({
    schoolId,
    studentId: String(id),
    status: reason as 'transferred' | 'withdrew',
    endedOn: departureDate,
  });

  const snap = await buildStudentArchiveSnapshot(schoolId, String(id));
  if (!snap) { res.status(404).json({ error: 'Student not found' }); return; }
  const { student } = snap;

  // Atomic archive: insert into archived_students + delete from students
  // in one transaction (PL/pgSQL function from migration 010 / 031 / 041).
  // Returns the new archived_students.id — captured so the AC-3 AR writeoff
  // posting below can key its GL entry on it.
  const { data: archivedId, error: rpcErr } = await supabase.rpc('archive_student_atomic', {
    p_school_id: schoolId,
    p_student_id: id,
    p_full_name: student.full_name,
    p_date_of_birth: student.date_of_birth ?? null,
    p_enrollment_date: student.created_at ? student.created_at.split('T')[0] : null,
    p_departure_date: departureDate || new Date().toISOString().split('T')[0],
    p_reason: reason,
    p_parent_full_name: (student as any).parents?.full_name ?? null,
    p_parent_phone: (student as any).parents?.phone_number ?? null,
    p_classes_attended: snap.classesAttended,
    p_enrollment_history: snap.enrollmentHistory,
    p_grades: snap.gradesSnapshot,
    p_payment_history: snap.paymentHistory,
    p_reports: snap.reportsSnapshot,
    p_archived_by: req.user!.userId,
    p_archived_by_name: req.user!.username,
    p_archived_by_role: req.user!.role,
    p_original_parent_id: (student as any).parent_id ?? null,
  });

  if (rpcErr) {
    res.status(safeDbErrorStatus(rpcErr)).json({ error: safeDbErrorMessage(rpcErr) });
    return;
  }

  await logAudit({ req, entityType: 'student', entityId: String(id), action: 'delete', before: student as Record<string, unknown>, label: student.full_name, reason: `Archived (${reason})` });

  // AC-3 — write off any outstanding AR balance to Bad Debt so the GL's
  // Accounts Receivable stays in sync with the (now empty for this student)
  // AR aging report. One entry per currency in the snapshot. Gated on the
  // premium accounting feature: if it's off (now or never on), we don't
  // touch the GL — postArWriteoff would otherwise seed a chart for a school
  // that isn't using accounting. The originating tuition_billing entry is
  // FK-less and survives either way, so the chain remains intact.
  const { data: featureRow } = await supabase
    .from('schools').select('features').eq('id', schoolId).single();
  const tuitionFeesOn = (featureRow?.features as Record<string, boolean> | null)?.tuition_fees === true;
  const writeoffDate = (departureDate || new Date().toISOString().split('T')[0]) as string;
  const archivedIdStr = typeof archivedId === 'string' ? archivedId : null;
  if (tuitionFeesOn && archivedIdStr) {
    const byCurrency = new Map<string, number>();
    for (const sf of snap.paymentHistory as any[]) {
      const cur = String(sf.currency ?? 'USD');
      const due = Number(sf.totalAmount ?? 0) + Number(sf.adjustment ?? 0) + Number(sf.lateFees ?? 0);
      const paid = (sf.payments as any[] ?? []).reduce(
        (s, p) => s + Number(p.amount ?? 0) * (p.isRefund ? -1 : 1), 0);
      const bal = Math.max(0, due - paid);
      if (bal < 0.01) continue;
      byCurrency.set(cur, Math.round(((byCurrency.get(cur) ?? 0) + bal) * 100) / 100);
    }
    for (const [currency, amount] of byCurrency) {
      await postArWriteoff({
        schoolId, archivedStudentId: archivedIdStr,
        studentName: student.full_name, amount, currency,
        entryDate: writeoffDate, postedBy: req.user!.userId,
      });
    }
  }

  res.json({ message: 'Student archived successfully' });
}

// Mark a currently-enrolled student as on leave for the CURRENT academic
// year (migration 030). The Phase-3 wizard will let admins pre-declare a
// multi-year leave; for now one academic year at a time. Returns the
// updated/created enrollment row.
export async function markStudentOnLeave(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  const { endedOn } = (req.body || {}) as { endedOn?: string };

  const { data: before } = await supabase
    .from('students').select('id, full_name')
    .eq('id', id).eq('school_id', schoolId).single();
  if (!before) { res.status(404).json({ error: 'Student not found' }); return; }

  const result = await markOnLeaveForCurrentYear({ schoolId, studentId: String(id), endedOn });
  if (!result.ok) { res.status(400).json({ error: result.error }); return; }

  await logAudit({
    req, entityType: 'student', entityId: String(id), action: 'update',
    after: { enrollment: result.row } as Record<string, unknown>,
    label: (before as { full_name?: string }).full_name, reason: 'Marked on leave',
  });
  res.json({ enrollment: result.row });
}

// Return a student from leave / re-enrol from a prior archived row. Opens a
// new 'enrolled' row for the current academic year, defaulting grade_level
// to the last enrollment row's value (completion-based progression — admin
// can pass gradeLevelOverride if the school wants to credit a completed
// year and bump them up).
export async function returnStudentFromLeave(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  const { classId, gradeLevelOverride } = (req.body || {}) as {
    classId?: string;
    gradeLevelOverride?: string;
  };

  if (!classId || typeof classId !== 'string') {
    res.status(400).json({ error: 'classId is required' });
    return;
  }

  const { data: before } = await supabase
    .from('students').select('id, full_name')
    .eq('id', id).eq('school_id', schoolId).single();
  if (!before) { res.status(404).json({ error: 'Student not found' }); return; }

  const result = await returnFromLeaveHelper({
    schoolId, studentId: String(id), classId, gradeLevelOverride,
  });
  if (!result.ok) { res.status(400).json({ error: result.error }); return; }

  // Reflect the placement on the student row too (current class_id).
  await supabase.from('students').update({ class_id: classId })
    .eq('id', id).eq('school_id', schoolId);

  await logAudit({
    req, entityType: 'student', entityId: String(id), action: 'update',
    after: { enrollment: result.row } as Record<string, unknown>,
    label: (before as { full_name?: string }).full_name, reason: 'Returned from leave',
  });
  res.json({ enrollment: result.row });
}

// Read the enrollment history for one student. Used by the live student
// profile page (Phase 5) to render the Academic progression tab.
export async function getStudentEnrollmentHistory(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  const rows = await loadEnrollmentHistory(schoolId, String(id));
  res.json({ enrollments: rowsToSnapshot(rows) });
}

// Phase C — per-student attendance history. Admin-facing. Archive-gated:
// schools without the archive feature don't accumulate per-year totals,
// so this view is meaningless for them. Returns 403 in that case.
export async function getStudentAttendanceHistory(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  if (!(await hasArchiveFeature(schoolId))) {
    res.status(403).json({ error: 'Archive feature is not enabled for this school' });
    return;
  }
  const { data: student } = await supabase
    .from('students')
    .select('id, full_name, is_graduated, class_id, classes(name)')
    .eq('id', id).eq('school_id', schoolId).maybeSingle();
  if (!student) { res.status(404).json({ error: 'Student not found' }); return; }
  const history = await buildAttendanceHistory(schoolId, String(id));
  res.json({ student: toCC(student), ...history });
}

// Day-by-day attendance for one student × one academic year. Read from
// raw `attendance` rows in the row's date range. Archive-gated.
export async function getStudentAttendanceDays(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  const year = String((req.query as Record<string, string>).year || '');
  if (!year) { res.status(400).json({ error: 'year is required' }); return; }
  if (!(await hasArchiveFeature(schoolId))) {
    res.status(403).json({ error: 'Archive feature is not enabled for this school' });
    return;
  }
  const { data: student } = await supabase
    .from('students').select('id').eq('id', id).eq('school_id', schoolId).maybeSingle();
  if (!student) { res.status(404).json({ error: 'Student not found' }); return; }
  const result = await loadAttendanceDaysForYear(schoolId, String(id), year);
  if (!result) { res.status(404).json({ error: 'No enrollment for that academic year' }); return; }
  res.json(result);
}

// ─── ENROLLMENT HISTORY BACKFILL (migration 030, Phase 4) ─────────────────
//
// One-off admin action: walk every live + archived student and reconstruct
// their per-year academic progression rows from existing grades / attendance
// / legacy classes_attended JSONB. Idempotent (skips students already
// covered). The dryRun flag returns the computed report without committing.

export async function previewEnrollmentBackfill(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const result = await backfillSchoolEnrollments(schoolId, { dryRun: true });
  res.json(result);
}

export async function commitEnrollmentBackfill(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const result = await backfillSchoolEnrollments(schoolId, { dryRun: false });
  await logAudit({
    req, entityType: 'class', entityId: schoolId, action: 'update',
    after: {
      _meta: {
        kind: 'enrollment_backfill',
        live_rows: result.liveRowsInserted,
        live_students: result.liveStudentsProcessed,
        issues: result.issues.length,
      },
    } as Record<string, unknown>,
    label: 'enrollment_backfill',
  });
  res.json(result);
}

// ─── YEAR-END PROMOTE CLASS WIZARD (migration 030, Phase 3) ───────────────
//
// The wizard operates on ONE class at a time. The preview returns the class
// + its enrolled roster + the suggested next class (from classes.next_class_id)
// so the UI can default each student to "promote to next class". The commit
// endpoint takes a per-student outcome map and applies it: closing the
// current year's row + (for promote/retain) opening the next year's row.

// GET /admin/classes/:id/promote-class/preview?academicYear=YYYY-YYYY
export async function previewPromoteClass(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  const academicYear = req.query.academicYear
    ? String(req.query.academicYear)
    : await resolveCurrentAcademicYear(schoolId);

  const { data: cls } = await supabase
    .from('classes')
    .select('id, name, grade_level, academic_year, next_class_id')
    .eq('id', id).eq('school_id', schoolId).single();
  if (!cls) { res.status(404).json({ error: 'Class not found' }); return; }

  // Suggested target — classes.next_class_id (manually wired by admin).
  // The UI falls back to "pick a class" when this is null.
  let nextClass: { id: string; name: string; gradeLevel: string | null } | null = null;
  if ((cls as any).next_class_id) {
    const { data: nc } = await supabase
      .from('classes').select('id, name, grade_level')
      .eq('id', (cls as any).next_class_id).eq('school_id', schoolId).single();
    if (nc) nextClass = { id: nc.id, name: nc.name, gradeLevel: (nc as any).grade_level ?? null };
  }

  const roster = await loadEnrolledRosterForClass(schoolId, String(id), academicYear);

  res.json({
    sourceClass: {
      id: cls.id, name: cls.name,
      gradeLevel: (cls as any).grade_level ?? null,
      academicYear: (cls as any).academic_year ?? null,
    },
    nextClass,
    nextAcademicYear: nextAcademicYear(academicYear),
    academicYear,
    roster: roster.map(r => ({
      studentId: r.enrollment.studentId,
      studentName: r.studentName,
      enrollmentId: r.enrollment.id,
      gradeLevel: r.enrollment.gradeLevel,
      classNameSnapshot: r.enrollment.classNameSnapshot,
    })),
  });
}

type PromoteAction = 'promote' | 'retain' | 'on_leave' | 'withdrew' | 'graduate';

interface PromoteOutcome {
  studentId: string;
  action: PromoteAction;
  targetClassId?: string;
}

// POST /admin/classes/:id/promote-class
// Body: { academicYear, nextAcademicYear, yearEndDate, outcomes: [...] }
export async function commitPromoteClass(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  const body = (req.body || {}) as {
    academicYear?: string;
    nextAcademicYear?: string;
    yearEndDate?: string;
    outcomes?: PromoteOutcome[];
  };

  const academicYear = body.academicYear
    ? String(body.academicYear)
    : await resolveCurrentAcademicYear(schoolId);
  const nextYear = String(body.nextAcademicYear || nextAcademicYear(academicYear));
  const yearEndDate = String(body.yearEndDate || new Date().toISOString().slice(0, 10));
  const outcomes = Array.isArray(body.outcomes) ? body.outcomes : [];

  if (outcomes.length === 0) {
    res.status(400).json({ error: 'outcomes must be a non-empty array' });
    return;
  }

  // Verify the source class belongs to this school (defensive — the route
  // is authenticated but we still scope by schoolId for safety).
  const { data: cls } = await supabase
    .from('classes').select('id').eq('id', id).eq('school_id', schoolId).single();
  if (!cls) { res.status(404).json({ error: 'Class not found' }); return; }

  // Schools without the archive feature can't retain past students — the
  // 'graduate' outcome below becomes a hard delete instead of a flag +
  // snapshot, matching assignStudent and the year-end bulk advance.
  const archiveOn = await hasArchiveFeature(schoolId);

  const results: Array<{ studentId: string; ok: boolean; action: PromoteAction; error?: string }> = [];

  for (const outcome of outcomes) {
    const { studentId, action, targetClassId } = outcome;
    if (!studentId || !action) {
      results.push({ studentId: studentId || '(missing)', ok: false, action: action || 'promote' as PromoteAction, error: 'studentId and action are required' });
      continue;
    }

    try {
      // Map wizard action → terminal status for the closing row.
      const closingStatus =
        action === 'promote' ? 'promoted' :
        action === 'retain'  ? 'retained' :
        action === 'graduate' ? 'graduated' :
        action; // on_leave, withdrew

      const close = await closeEnrollmentForYear({
        schoolId, studentId, academicYear, status: closingStatus as any, endedOn: yearEndDate,
      });
      if (!close.ok) {
        results.push({ studentId, ok: false, action, error: close.error });
        continue;
      }

      if (action === 'promote' || action === 'retain') {
        if (!targetClassId) {
          results.push({ studentId, ok: false, action, error: 'targetClassId is required for promote/retain' });
          continue;
        }
        const open = await openEnrollmentForYear({
          schoolId, studentId, academicYear: nextYear, classId: targetClassId,
        });
        if (!open.ok) {
          results.push({ studentId, ok: false, action, error: open.error });
          continue;
        }
        // Reflect placement on students.class_id so the live roster shows
        // them in their new class for the new year.
        await supabase.from('students')
          .update({ class_id: targetClassId })
          .eq('id', studentId).eq('school_id', schoolId);
      }

      if (action === 'graduate') {
        if (archiveOn) {
          await supabase.from('students')
            .update({ is_graduated: true })
            .eq('id', studentId).eq('school_id', schoolId);
          await snapshotGraduatedStudent(
            schoolId, studentId,
            { id: req.user!.userId, name: req.user!.username, role: req.user!.role },
          );
        } else {
          await supabase.from('students')
            .delete()
            .eq('id', studentId).eq('school_id', schoolId);
        }
      }

      results.push({ studentId, ok: true, action });
    } catch (e) {
      results.push({ studentId, ok: false, action, error: (e as Error).message });
    }
  }

  await logAudit({
    req, entityType: 'class', entityId: String(id), action: 'update',
    after: {
      _meta: {
        kind: 'promote_class',
        academic_year: academicYear,
        next_academic_year: nextYear,
        processed: results.filter(r => r.ok).length,
        failed: results.filter(r => !r.ok).length,
      },
    } as Record<string, unknown>,
    label: 'promote_class',
  });

  res.json({
    academicYear,
    nextAcademicYear: nextYear,
    processed: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    results,
  });
}

export async function getArchivedStudents(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { search, reason, departureFrom, departureTo } = req.query as Record<string, string>;

  if (!(await hasArchiveFeature(schoolId))) {
    res.status(403).json({ error: 'Archive feature is not enabled for this school' });
    return;
  }

  // F9: cap the result set and allow reason / departure-date filtering so a
  // multi-year archive stays bounded. Default cap 500.
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '200'), 10) || 200, 1), 500);

  let query = supabase
    .from('archived_students')
    .select('id, full_name, date_of_birth, enrollment_date, departure_date, reason, parent_full_name, parent_phone, enrollment_history, classes_attended, created_at')
    .eq('school_id', schoolId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (search) query = query.ilike('full_name', `%${search}%`);
  if (reason && ['transferred', 'withdrew', 'graduated'].includes(reason)) query = query.eq('reason', reason);
  if (departureFrom) query = query.gte('departure_date', departureFrom);
  if (departureTo) query = query.lte('departure_date', departureTo);

  const { data, error } = await query;
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json(toCC(data));
}

export async function getArchivedStudent(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;

  if (!(await hasArchiveFeature(schoolId))) {
    res.status(403).json({ error: 'Archive feature is not enabled for this school' });
    return;
  }

  const { data, error } = await supabase
    .from('archived_students')
    .select('*')
    .eq('id', id)
    .eq('school_id', schoolId)
    .single();

  if (error || !data) { res.status(404).json({ error: 'Archived record not found' }); return; }
  res.json(toCC(data));
}

export async function exportEmployeeArchivePdf(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  if (!(await hasArchiveFeature(schoolId))) {
    res.status(403).json({ error: 'Archive feature is not enabled for this school' });
    return;
  }
  const snapshot = await loadEmployeeArchiveSnapshot(schoolId);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="employee-archive-${snapshot.schoolName.replace(/[^a-z0-9-_]+/gi, '_')}-${new Date().toISOString().split('T')[0]}.pdf"`);
  streamEmployeePdf(snapshot, res);
}

export async function exportEmployeeArchiveXlsx(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  if (!(await hasArchiveFeature(schoolId))) {
    res.status(403).json({ error: 'Archive feature is not enabled for this school' });
    return;
  }
  const snapshot = await loadEmployeeArchiveSnapshot(schoolId);
  const buf = buildEmployeeXlsx(snapshot);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="employee-archive-${snapshot.schoolName.replace(/[^a-z0-9-_]+/gi, '_')}-${new Date().toISOString().split('T')[0]}.xlsx"`);
  res.send(buf);
}

export async function getArchivedEmployees(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { search, role, reason, departureFrom, departureTo } = req.query as Record<string, string>;

  if (!(await hasArchiveFeature(schoolId))) {
    res.status(403).json({ error: 'Archive feature is not enabled for this school' });
    return;
  }

  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '200'), 10) || 200, 1), 500);

  let query = supabase
    .from('archived_employees')
    .select('id, role, full_name, phone_number, email, position, subject, hire_date, departure_date, reason, created_at')
    .eq('school_id', schoolId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (role && ['teacher', 'driver', 'supervisor', 'staff', 'admin'].includes(role)) query = query.eq('role', role);
  if (reason && ['resigned', 'terminated', 'contract_ended', 'retired', 'transferred', 'other'].includes(reason)) query = query.eq('reason', reason);
  if (departureFrom) query = query.gte('departure_date', departureFrom);
  if (departureTo) query = query.lte('departure_date', departureTo);
  if (search) query = query.ilike('full_name', `%${search}%`);

  const { data, error } = await query;
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json(toCC(data));
}

// Returning-employee lookup for the add-teacher/driver/staff forms.
// Mirrors searchArchivedStudents.
export async function searchArchivedEmployees(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  if (!(await hasArchiveFeature(schoolId))) {
    res.json([]);
    return;
  }
  const name = String(req.query.name ?? '').trim();
  const role = String(req.query.role ?? '').trim();
  if (name.length < 2) { res.json([]); return; }

  const safeName = name.replace(/[%_\\]/g, '\\$&');
  let query = supabase
    .from('archived_employees')
    .select('id, role, full_name, phone_number, email, position, subject, hire_date, departure_date, reason')
    .eq('school_id', schoolId)
    .ilike('full_name', `%${safeName}%`)
    .order('departure_date', { ascending: false })
    .limit(8);
  if (role && ['teacher', 'driver', 'supervisor', 'staff', 'admin'].includes(role)) query = query.eq('role', role);

  const { data, error } = await query;
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json(toCC(data ?? []));
}

export async function getArchivedEmployee(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;

  if (!(await hasArchiveFeature(schoolId))) {
    res.status(403).json({ error: 'Archive feature is not enabled for this school' });
    return;
  }

  const { data, error } = await supabase
    .from('archived_employees')
    .select('*')
    .eq('id', id)
    .eq('school_id', schoolId)
    .single();

  if (error || !data) { res.status(404).json({ error: 'Archived record not found' }); return; }
  res.json(toCC(data));
}

// ---- PER-RECORD DOSSIER EXPORT (finding F7) ----
// Single archived student / employee as a downloadable JSON dossier.
function sendJsonDownload(res: Response, filename: string, body: unknown): void {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(JSON.stringify(body, null, 2));
}

export async function exportArchivedStudentRecord(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  if (!(await hasArchiveFeature(schoolId))) { res.status(403).json({ error: 'Archive feature is not enabled for this school' }); return; }
  const { data, error } = await supabase.from('archived_students').select('*').eq('id', id).eq('school_id', schoolId).single();
  if (error || !data) { res.status(404).json({ error: 'Archived record not found' }); return; }
  const safe = String((data as any).full_name || 'student').replace(/[^a-z0-9-_]+/gi, '_');
  sendJsonDownload(res, `archived-student-${safe}.json`, {
    schemaVersion: (data as any).snapshot_version ?? 1,
    kind: 'archived_student',
    generatedAt: new Date().toISOString(),
    record: toCC(data),
  });
}

export async function exportArchivedEmployeeRecord(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  if (!(await hasArchiveFeature(schoolId))) { res.status(403).json({ error: 'Archive feature is not enabled for this school' }); return; }
  const { data, error } = await supabase.from('archived_employees').select('*').eq('id', id).eq('school_id', schoolId).single();
  if (error || !data) { res.status(404).json({ error: 'Archived record not found' }); return; }
  const safe = String((data as any).full_name || 'employee').replace(/[^a-z0-9-_]+/gi, '_');
  sendJsonDownload(res, `archived-employee-${safe}.json`, {
    schemaVersion: (data as any).snapshot_version ?? 1,
    kind: 'archived_employee',
    generatedAt: new Date().toISOString(),
    record: toCC(data),
  });
}

// Per-record PDF export. The detail-modal Download button hits this; the
// JSON sibling above stays alive for programmatic backup callers (the
// master pre-disable backup flow uses it).
export async function exportArchivedEmployeePdf(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  if (!(await hasArchiveFeature(schoolId))) { res.status(403).json({ error: 'Archive feature is not enabled for this school' }); return; }

  const data = await loadArchivedEmployeeForPdf(String(id), schoolId);
  if (!data) { res.status(404).json({ error: 'Archived record not found' }); return; }
  data.generatedBy = req.user!.username;
  data.generatedByRole = req.user!.role;

  await logAudit({
    req,
    entityType: 'archived_employee',
    entityId: String(id),
    action: 'export',
    after: { _meta: { kind: 'pdf_export', schemaVersion: data.record.snapshot_version ?? 1, lang: pickLang(req.query.lang) } },
    label: data.record.full_name,
  });

  const safe = String(data.record.full_name || 'employee').replace(/[^a-z0-9-_]+/gi, '_');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="archived-employee-${safe}.pdf"`);
  await streamArchivedEmployeePdf(data, pickLang(req.query.lang), res);
}

export async function exportArchivedStudentPdf(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  if (!(await hasArchiveFeature(schoolId))) { res.status(403).json({ error: 'Archive feature is not enabled for this school' }); return; }

  const data = await loadArchivedStudentForPdf(String(id), schoolId);
  if (!data) { res.status(404).json({ error: 'Archived record not found' }); return; }
  data.generatedBy = req.user!.username;
  data.generatedByRole = req.user!.role;

  await logAudit({
    req,
    entityType: 'archived_student',
    entityId: String(id),
    action: 'export',
    after: { _meta: { kind: 'pdf_export', schemaVersion: data.record.snapshot_version ?? 1, lang: pickLang(req.query.lang) } },
    label: data.record.full_name,
  });

  const safe = String(data.record.full_name || 'student').replace(/[^a-z0-9-_]+/gi, '_');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="archived-student-${safe}.pdf"`);
  await streamArchivedStudentPdf(data, pickLang(req.query.lang), res);
}

// ---- RESTORE / UN-ARCHIVE (finding F12) ----
// Identity-only: recreates the core live row and links it to the
// (retained, append-only) snapshot via previous_archive_id. Historical
// content is NOT rehydrated — the immutable snapshot stays as the record.
export async function restoreArchivedStudent(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  if (!(await hasArchiveFeature(schoolId))) { res.status(403).json({ error: 'Archive feature is not enabled for this school' }); return; }

  const { data: arch } = await supabase.from('archived_students').select('*').eq('id', id).eq('school_id', schoolId).single();
  if (!arch) { res.status(404).json({ error: 'Archived record not found' }); return; }

  // Re-link the parent only if that parent account still exists.
  let parentId: string | null = null;
  if ((arch as any).original_parent_id) {
    const { data: p } = await supabase.from('parents').select('id').eq('id', (arch as any).original_parent_id).eq('school_id', schoolId).single();
    parentId = p ? (arch as any).original_parent_id : null;
  }

  const { data: student, error } = await supabase.from('students').insert({
    school_id: schoolId,
    full_name: (arch as any).full_name,
    date_of_birth: (arch as any).date_of_birth ?? null,
    parent_id: parentId,
    is_graduated: false,
    previous_archive_id: (arch as any).id,
  }).select().single();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  await logAudit({ req, entityType: 'student', entityId: String((student as any).id), action: 'create', after: student as Record<string, unknown>, label: (student as any).full_name, reason: 'Restored from archive' });
  res.status(201).json({ ...(toCC(student) as object), parentRelinked: !!parentId });
}

export async function restoreArchivedEmployee(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  if (!(await hasArchiveFeature(schoolId))) { res.status(403).json({ error: 'Archive feature is not enabled for this school' }); return; }

  const { data: arch } = await supabase.from('archived_employees').select('*').eq('id', id).eq('school_id', schoolId).single();
  if (!arch) { res.status(404).json({ error: 'Archived record not found' }); return; }

  const role = (arch as any).role as string;
  const acct = ((arch as any).account ?? {}) as Record<string, any>;

  // Staff have no users row — just recreate the staff_members shell
  // (salary defaults; the accountant sets the real figure).
  if (role === 'staff') {
    const { data: staff, error } = await supabase.from('staff_members').insert({
      school_id: schoolId,
      full_name: (arch as any).full_name,
      position: (arch as any).position ?? null,
      salary_amount: 0,
      currency: 'USD',
      is_active: true,
      previous_archive_id: (arch as any).id,
    }).select().single();
    if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
    await logAudit({ req, entityType: 'staff_member', entityId: String((staff as any).id), action: 'create', after: staff as Record<string, unknown>, label: (staff as any).full_name, reason: 'Restored from archive' });
    res.status(201).json({ kind: 'staff', ...(toCC(staff) as object) });
    return;
  }

  // teacher / driver / supervisor / admin — recreate the users row. The
  // username almost certainly freed up (the user was deleted on archive);
  // if it's taken, guide the operator to the Employees add form instead.
  const username = String(acct.username || '').trim();
  if (!username) { res.status(400).json({ error: 'Snapshot has no username — re-add via the Employees tab.' }); return; }
  const { data: clash } = await supabase.from('users').select('id').eq('school_id', schoolId).eq('username', username).maybeSingle();
  if (clash) { res.status(409).json({ error: `Username "${username}" is in use. Re-add this employee from the Employees tab (it will link the archive).` }); return; }

  // Temp password: 96 bits of CSPRNG entropy, base64url so it stays a
  // reasonable length to dictate to the restored employee verbally.
  // Earlier `Restore@${1000-9999}` (L-7) was only 9000 possibilities and
  // trivially crackable against any leaked bcrypt hash.
  const tempPassword = crypto.randomBytes(12).toString('base64url');
  const rounds = parseInt(process.env.BCRYPT_ROUNDS || '10');
  const passwordHash = await bcrypt.hash(tempPassword, rounds);

  const fullName = String((arch as any).full_name || '').trim();
  const [firstName, ...rest] = fullName.split(/\s+/);
  const lastName = rest.join(' ');

  const { data: user, error: userErr } = await supabase.from('users').insert({
    school_id: schoolId,
    first_name: acct.first_name ?? firstName ?? fullName,
    last_name: acct.last_name ?? lastName ?? '',
    email: (arch as any).email ?? acct.email ?? null,
    phone: (arch as any).phone_number ?? acct.phone ?? null,
    username,
    password_hash: passwordHash,
    role,
  // Explicit projection — never select password_hash on a read path that
  // feeds the response or the audit log. (toCC and audit EXCLUDED_FIELDS
  // also strip it, but defense in depth at every layer.)
  }).select('id, school_id, username, email, phone, role, first_name, last_name, profile_picture, is_active, created_at, password_changed_at').single();
  if (userErr) {
    const isDupe = userErr.code === '23505' || /unique|duplicate/i.test(userErr.message || '');
    res.status(isDupe ? 409 : safeDbErrorStatus(userErr))
      .json({ error: isDupe ? 'Username is already taken.' : safeDbErrorMessage(userErr) });
    return;
  }

  if (role === 'teacher') {
    await supabase.from('teachers').insert({
      school_id: schoolId, user_id: (user as any).id,
      full_name: (arch as any).full_name, phone_number: (arch as any).phone_number ?? null,
      emergency_contact: (arch as any).emergency_contact ?? null,
      previous_archive_id: (arch as any).id,
    });
  } else if (role === 'driver') {
    await supabase.from('drivers').insert({
      school_id: schoolId, user_id: (user as any).id,
      full_name: (arch as any).full_name, phone_number: (arch as any).phone_number ?? null,
      emergency_contact: (arch as any).emergency_contact ?? null,
      previous_archive_id: (arch as any).id,
    });
  }
  // supervisor / admin: users row only (no profile table — matches createAccount).

  await logAudit({ req, entityType: role as 'teacher' | 'driver' | 'supervisor' | 'admin', entityId: String((user as any).id), action: 'create', after: user as Record<string, unknown>, label: fullName, reason: 'Restored from archive' });
  res.status(201).json({ kind: role, username, tempPassword, userId: (user as any).id });
}

// Search archived students for the "returning student" prompt on the
// add-student form. Fuzzy-matches by name (and optional date of birth).
// Returns a small candidate list so the admin can pick one to link.
export async function searchArchivedStudents(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  if (!(await hasArchiveFeature(schoolId))) {
    res.json([]);
    return;
  }
  const name = String(req.query.name ?? '').trim();
  const dob = String(req.query.dob ?? '').trim();
  if (name.length < 2) { res.json([]); return; }

  const safeName = name.replace(/[%_\\]/g, '\\$&');
  let query = supabase
    .from('archived_students')
    .select('id, full_name, date_of_birth, departure_date, reason, parent_full_name, parent_phone, enrollment_history, classes_attended')
    .eq('school_id', schoolId)
    .ilike('full_name', `%${safeName}%`)
    .order('departure_date', { ascending: false })
    .limit(8);
  if (dob) query = query.eq('date_of_birth', dob);

  const { data, error } = await query;
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json(toCC(data ?? []));
}

// ---- CLASSES ----
export async function getClasses(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { data, error } = await supabase.from('classes').select('*').eq('school_id', schoolId).order('name');
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json(toCC(data));
}

export async function createClass(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { name, gradeLevel, academicYear, nextClassId } = req.body;

  const { data: existing } = await supabase.from('classes')
    .select('id').eq('school_id', schoolId).eq('name', name).single();
  if (existing) { res.status(409).json({ error: `Class "${name}" already exists` }); return; }

  const { data, error } = await supabase.from('classes').insert({
    school_id: schoolId,
    name,
    grade_level: gradeLevel || null,
    academic_year: academicYear || null,
    next_class_id: nextClassId || null,
  }).select().single();

  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.status(201).json(toCC(data));
}

export async function updateClass(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  const { name, gradeLevel, academicYear, nextClassId } = req.body;

  const { data, error } = await supabase.from('classes')
    .update({
      ...(name !== undefined && { name }),
      ...(gradeLevel !== undefined && { grade_level: gradeLevel || null }),
      ...(academicYear !== undefined && { academic_year: academicYear || null }),
      next_class_id: nextClassId || null,
    })
    .eq('id', id).eq('school_id', schoolId).select().single();

  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json(toCC(data));
}

export async function deleteClass(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;

  const { data: cls } = await supabase.from('classes').select('id').eq('id', id).eq('school_id', schoolId).single();
  if (!cls) { res.status(404).json({ error: 'Class not found' }); return; }

  // Curriculum rows for this class cascade away; remember the teachers/subjects involved to refresh caches.
  const { data: cstRows } = await supabase.from('class_subject_teachers')
    .select('teacher_id, subject_id').eq('school_id', schoolId).eq('class_id', id);
  const affTeachers = Array.from(new Set(((cstRows ?? []) as any[]).map(r => r.teacher_id)));
  const affSubjects = Array.from(new Set(((cstRows ?? []) as any[]).map(r => r.subject_id)));

  // SET NULL cascades on delete:
  //   - students.class_id → student stays, class link cleared
  //   - grades.class_id → grade row stays as historical record
  //   - attendance.class_id → attendance row stays as historical record
  // CASCADE cascades on delete (these rows go away with the class):
  //   - homework, assignments, weekly_summaries, schedule_assignments,
  //     class_subject_teachers, academic_posts
  const { error } = await supabase.from('classes').delete().eq('id', id).eq('school_id', schoolId);
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  await recomputeCaches(schoolId, { teacherIds: affTeachers, subjectIds: affSubjects });
  res.json({ message: 'Class deleted. Students unassigned; grades and attendance preserved as historical records.' });
}

// ---- CURRICULUM (class ↔ subject ↔ teacher) ----
// `class_subject_teachers` is the source of truth. `subject_teachers` (distinct teacher↔subject
// pairs), `teachers.subject` (comma-joined text) and `subjects.teacher_id` (a "primary" teacher)
// are caches recomputed from it so legacy readers keep working unchanged.

// Rebuild the subject_teachers rows + teachers.subject text cache for one teacher.
async function recomputeTeacherCaches(schoolId: string, teacherId: string): Promise<void> {
  const { data } = await supabase
    .from('class_subject_teachers')
    .select('subject_id, subjects(name)')
    .eq('school_id', schoolId)
    .eq('teacher_id', teacherId);
  const rows = (data ?? []) as any[];
  const subjectIds = Array.from(new Set(rows.map(r => r.subject_id).filter(Boolean)));
  const names = Array.from(new Set(rows.map(r => r.subjects?.name).filter(Boolean))).sort((a, b) => a.localeCompare(b));

  await supabase.from('subject_teachers').delete().eq('school_id', schoolId).eq('teacher_id', teacherId);
  if (subjectIds.length) {
    await supabase.from('subject_teachers').insert(
      subjectIds.map(sid => ({ school_id: schoolId, subject_id: sid, teacher_id: teacherId }))
    );
  }
  await supabase.from('teachers').update({ subject: names.length ? names.join(', ') : null })
    .eq('id', teacherId).eq('school_id', schoolId);
}

// Recompute subjects.teacher_id ("primary teacher" — oldest curriculum row) for one subject.
async function recomputeSubjectPrimary(schoolId: string, subjectId: string): Promise<void> {
  const { data } = await supabase
    .from('class_subject_teachers')
    .select('teacher_id')
    .eq('school_id', schoolId)
    .eq('subject_id', subjectId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  await supabase.from('subjects').update({ teacher_id: (data as any)?.teacher_id ?? null })
    .eq('id', subjectId).eq('school_id', schoolId);
}

async function recomputeCaches(schoolId: string, opts: { teacherIds?: string[]; subjectIds?: string[] }): Promise<void> {
  await Promise.all([
    ...Array.from(new Set((opts.teacherIds ?? []).filter(Boolean))).map(tid => recomputeTeacherCaches(schoolId, tid)),
    ...Array.from(new Set((opts.subjectIds ?? []).filter(Boolean))).map(sid => recomputeSubjectPrimary(schoolId, sid)),
  ]);
}

// Strict model: a teacher may only be put on a class's curriculum if they are
// already assigned to that class (Teachers tab). Returns true if the
// teacher_classes link exists.
async function teacherAssignedToClass(teacherId: string, classId: string): Promise<boolean> {
  // tenant-check-allow: teacher_classes has no school_id column; teacher+class are school-scoped via the cst upsert
  const { data } = await supabase.from('teacher_classes')
    .select('id').eq('teacher_id', teacherId).eq('class_id', classId).limit(1).maybeSingle();
  return !!data;
}

// ---- CURRICULUM endpoints ----
// GET /admin/curriculum — every (class, subject, teacher) row for the school.
export async function getCurriculum(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { data, error } = await supabase
    .from('class_subject_teachers')
    .select('id, class_id, subject_id, teacher_id, classes(name), subjects(name), teachers(full_name)')
    .eq('school_id', schoolId);
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  const rows = ((data ?? []) as any[]).map(r => ({
    id: r.id,
    classId: r.class_id,
    className: r.classes?.name ?? null,
    subjectId: r.subject_id,
    subjectName: r.subjects?.name ?? null,
    teacherId: r.teacher_id,
    teacherName: r.teachers?.full_name ?? null,
  }));
  res.json(rows);
}

// POST /admin/curriculum  { classId, subjectId, teacherId }
export async function addCurriculumRow(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { classId, subjectId, teacherId } = req.body;
  if (!classId || !subjectId || !teacherId) { res.status(400).json({ error: 'classId, subjectId and teacherId are required' }); return; }
  if (!(await teacherAssignedToClass(teacherId, classId))) {
    res.status(400).json({ error: 'This teacher is not assigned to this class. Assign the class to the teacher in the Teachers tab first.' });
    return;
  }
  const { data, error } = await supabase.from('class_subject_teachers')
    .upsert({ school_id: schoolId, class_id: classId, subject_id: subjectId, teacher_id: teacherId }, { onConflict: 'class_id,subject_id,teacher_id' })
    .select('id').single();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  await recomputeCaches(schoolId, { teacherIds: [teacherId], subjectIds: [subjectId] });
  res.status(201).json({ id: data.id });
}

// DELETE /admin/curriculum/:id
export async function deleteCurriculumRow(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  const { data: row } = await supabase.from('class_subject_teachers')
    .select('teacher_id, subject_id').eq('id', id).eq('school_id', schoolId).maybeSingle();
  await supabase.from('class_subject_teachers').delete().eq('id', id).eq('school_id', schoolId);
  if (row) await recomputeCaches(schoolId, { teacherIds: [(row as any).teacher_id], subjectIds: [(row as any).subject_id] });
  res.json({ message: 'Removed' });
}

// ---- TEACHERS ----
export async function getTeachers(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  // Only return teachers with active user accounts
  const { data: activeUsers } = await supabase
    .from('users')
    .select('id')
    .eq('school_id', schoolId)
    .eq('role', 'teacher')
    .eq('is_active', true);
  const activeUserIds = (activeUsers || []).map(u => u.id);

  const { data, error } = await supabase
    .from('teachers')
    .select('*, users(id, username, email, phone), teacher_classes(class_id, classes(name)), class_subject_teachers(class_id, subject_id, classes(name), subjects(id, name))')
    .eq('school_id', schoolId)
    .in('user_id', activeUserIds.length > 0 ? activeUserIds : ['00000000-0000-0000-0000-000000000000']);
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  const teachers = ((data ?? []) as any[]).map(t => {
    // group curriculum rows into subjects: [{ id, name, classes: [{ id, name }] }]
    const bySubject = new Map<string, { id: string; name: string; classes: { id: string; name: string }[] }>();
    for (const r of (t.class_subject_teachers ?? [])) {
      const sid = r.subject_id, sname = r.subjects?.name;
      if (!sid || !sname) continue;
      if (!bySubject.has(sid)) bySubject.set(sid, { id: sid, name: sname, classes: [] });
      if (r.class_id && !bySubject.get(sid)!.classes.some(c => c.id === r.class_id)) {
        bySubject.get(sid)!.classes.push({ id: r.class_id, name: r.classes?.name ?? '' });
      }
    }
    const subjects = Array.from(bySubject.values()).sort((a, b) => a.name.localeCompare(b.name));
    const { class_subject_teachers: _cst, ...rest } = t;
    return { ...rest, subjects };
  });
  res.json(toCC(teachers));
}

export async function createTeacher(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { fullName, phoneNumber, emergencyContact, email, classIds, classId, username, password, previousArchiveId } = req.body;

  const { data: schoolData } = await supabase.from('schools').select('abbreviation').eq('id', schoolId).single();
  const abbrev = (schoolData?.abbreviation || '').toLowerCase();
  // Auto-derived username is name.father (first two name parts only), e.g.
  // "Ali Hassan Ahmed" → ali.hassan; the abbrev prefix is added below.
  const rawUsername = username || fullName.trim().split(/\s+/).slice(0, 2).join('.').toLowerCase();
  const finalUsername = abbrev && !rawUsername.startsWith(`${abbrev}_`) ? `${abbrev}_${rawUsername}` : rawUsername;

  const rounds = parseInt(process.env.BCRYPT_ROUNDS || '10');
  const usedDefault = !password;
  const finalPassword = password || defaultPasswordFor('teacher');
  const passwordHash = await bcrypt.hash(finalPassword, rounds);

  const nameParts = fullName.trim().split(' ');
  const firstName = nameParts[0] || fullName;
  const lastName = nameParts.slice(1).join(' ') || '';

  const { data: newUser, error: userErr } = await supabase.from('users').insert({
    school_id: schoolId,
    first_name: firstName,
    last_name: lastName,
    username: finalUsername,
    password_hash: passwordHash,
    role: 'teacher',
    email: email?.trim() || null,
    must_change_password: usedDefault,
  }).select('id, school_id, username, email, phone, role, first_name, last_name, profile_picture, is_active, created_at, password_changed_at').single();

  if (userErr) {
    const isDupe = userErr.message.includes('unique') || userErr.message.includes('duplicate');
    res.status(isDupe ? 409 : 500).json({
      error: isDupe
        ? `Username "${finalUsername}" already exists. Try a different username.`
        : userErr.message,
    });
    return;
  }

  const prevArchiveId = await resolveEmployeeArchiveId(previousArchiveId, schoolId, 'teacher');

  const { data: teacher, error: teacherErr } = await supabase.from('teachers').insert({
    school_id: schoolId,
    user_id: newUser.id,
    full_name: fullName,
    phone_number: phoneNumber || null,
    emergency_contact: emergencyContact || null,
    subject: null, // populated from the curriculum (class ↔ subject ↔ teacher) once assigned
    previous_archive_id: prevArchiveId,
    ...hrColumns(req.body),
  }).select().single();

  if (teacherErr) { res.status(safeDbErrorStatus(teacherErr)).json({ error: safeDbErrorMessage(teacherErr) }); return; }

  // Admin-trusted phone propagation (migration 050). Stamps users.phone_e164
  // + phone_verified_at when phoneNumber parses as a valid IQ mobile.
  await propagateAdminSetPhone(newUser.id, phoneNumber);

  const idsToAssign: string[] = Array.isArray(classIds) ? classIds : classId ? [classId] : [];
  if (idsToAssign.length > 0) {
    await supabase.from('teacher_classes').insert(idsToAssign.map(cid => ({ teacher_id: teacher.id, class_id: cid })));
  }

  res.status(201).json({ ...(toCC(teacher) as object), username: finalUsername, tempPassword: finalPassword });
}

export async function updateTeacher(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  const { fullName, phoneNumber, emergencyContact, classIds, remove } = req.body;

  if (remove) {
    const { data: teacher } = await supabase.from('teachers').select('user_id').eq('id', id).single();
    if (teacher) await supabase.from('users').update({ is_active: false }).eq('id', teacher.user_id);
    res.json({ message: 'Teacher deactivated' });
    return;
  }

  const updateFields: Record<string, unknown> = { ...hrColumns(req.body) };
  if (fullName) updateFields.full_name = fullName;
  if (phoneNumber !== undefined) updateFields.phone_number = phoneNumber || null;
  if (emergencyContact !== undefined) updateFields.emergency_contact = emergencyContact || null;

  const { data, error } = Object.keys(updateFields).length
    ? await supabase.from('teachers').update(updateFields).eq('id', id).eq('school_id', schoolId).select().single()
    : await supabase.from('teachers').select('*').eq('id', id).eq('school_id', schoolId).single();

  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  // Admin-trusted phone propagation (migration 050). Only fires when the
  // admin explicitly sent phoneNumber in the request body — undefined
  // means "didn't touch the field" and we leave users.phone_e164 alone.
  if (phoneNumber !== undefined && (data as { user_id?: string } | null)?.user_id) {
    await propagateAdminSetPhone((data as { user_id: string }).user_id, phoneNumber);
  }

  // Handle the teacher's class list. teachers.subject / curriculum rows are scoped per class,
  // so dropping a class also drops any curriculum rows the teacher had for it.
  if (classIds !== undefined) {
    const nextClassIds: string[] = Array.isArray(classIds) ? classIds.filter(Boolean) : (classIds ? [classIds] : []);
    const { data: prevRows } = await supabase.from('teacher_classes').select('class_id').eq('teacher_id', id);
    const removedClassIds = ((prevRows ?? []) as any[]).map(r => r.class_id).filter(cid => !nextClassIds.includes(cid));

    await supabase.from('teacher_classes').delete().eq('teacher_id', id);
    if (nextClassIds.length) {
      await supabase.from('teacher_classes').insert(nextClassIds.map(cid => ({ teacher_id: id, class_id: cid })));
    }
    if (removedClassIds.length) {
      // collect subjects affected before deleting, so we can refresh their primary-teacher cache
      const { data: affectedRows } = await supabase.from('class_subject_teachers')
        .select('subject_id').eq('school_id', schoolId).eq('teacher_id', id).in('class_id', removedClassIds);
      const affectedSubjectIds = ((affectedRows ?? []) as any[]).map(r => r.subject_id);
      await supabase.from('class_subject_teachers').delete()
        .eq('school_id', schoolId).eq('teacher_id', id).in('class_id', removedClassIds);
      await recomputeCaches(schoolId, { teacherIds: [String(id)], subjectIds: affectedSubjectIds });
    }
  }

  res.json(toCC(data));
}

// ---- DRIVERS ----
export async function getDrivers(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { data: activeUsers } = await supabase
    .from('users')
    .select('id')
    .eq('school_id', schoolId)
    .eq('role', 'driver')
    .eq('is_active', true);
  const activeUserIds = (activeUsers || []).map(u => u.id);

  const { data, error } = await supabase
    .from('drivers')
    .select('*, buses(bus_number, plate_number), users(id, username)')
    .eq('school_id', schoolId)
    .in('user_id', activeUserIds.length > 0 ? activeUserIds : ['00000000-0000-0000-0000-000000000000']);
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json(toCC(data));
}

export async function createDriver(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { fullName, phoneNumber, emergencyContact, email, licenseNumber, busNumber, age, username, password, studentIds, vehicleType, previousArchiveId } = req.body;

  const { data: schoolData } = await supabase.from('schools').select('abbreviation').eq('id', schoolId).single();
  const abbrev = (schoolData?.abbreviation || '').toLowerCase();
  // Auto-derived username is name.father (first two name parts only), e.g.
  // "Ali Hassan Ahmed" → ali.hassan; the abbrev prefix is added below.
  const rawUsername = username || fullName.trim().split(/\s+/).slice(0, 2).join('.').toLowerCase();
  const finalUsername = abbrev && !rawUsername.startsWith(`${abbrev}_`) ? `${abbrev}_${rawUsername}` : rawUsername;

  const rounds = parseInt(process.env.BCRYPT_ROUNDS || '10');
  const usedDefault = !password;
  const finalPassword = password || defaultPasswordFor('driver');
  const passwordHash = await bcrypt.hash(finalPassword, rounds);

  const nameParts = fullName.trim().split(' ');

  const { data: newUser, error: userErr } = await supabase.from('users').insert({
    school_id: schoolId,
    first_name: nameParts[0] || fullName,
    last_name: nameParts.slice(1).join(' ') || '',
    username: finalUsername,
    password_hash: passwordHash,
    role: 'driver',
    email: email?.trim() || null,
    must_change_password: usedDefault,
  }).select('id, school_id, username, email, phone, role, first_name, last_name, profile_picture, is_active, created_at, password_changed_at').single();

  if (userErr) {
    const isDupe = userErr.message.includes('unique') || userErr.message.includes('duplicate');
    res.status(isDupe ? 409 : 500).json({
      error: isDupe
        ? `Username "${finalUsername}" already exists. Try a different username.`
        : userErr.message,
    });
    return;
  }

  // Create/find bus
  let busId: string | null = null;
  if (busNumber) {
    const { data: existingBus } = await supabase.from('buses').select('id').eq('school_id', schoolId).eq('bus_number', busNumber).single();
    if (existingBus) {
      busId = existingBus.id;
    } else {
      const { data: newBus } = await supabase.from('buses').insert({ school_id: schoolId, bus_number: busNumber }).select().single();
      busId = newBus?.id || null;
    }
  }

  const prevArchiveId = await resolveEmployeeArchiveId(previousArchiveId, schoolId, 'driver');

  const { data: driver, error: driverErr } = await supabase.from('drivers').insert({
    school_id: schoolId,
    user_id: newUser.id,
    full_name: fullName,
    phone_number: phoneNumber || null,
    emergency_contact: emergencyContact || null,
    license_number: licenseNumber || null,
    bus_id: busId,
    age: age ? parseInt(age) : null,
    vehicle_type: vehicleType || 'bus',
    previous_archive_id: prevArchiveId,
    ...hrColumns(req.body),
  }).select().single();

  if (driverErr) { res.status(safeDbErrorStatus(driverErr)).json({ error: safeDbErrorMessage(driverErr) }); return; }

  // Admin-trusted phone propagation (migration 050).
  await propagateAdminSetPhone(newUser.id, phoneNumber);

  // Assign students to this driver
  if (studentIds && Array.isArray(studentIds) && studentIds.length > 0) {
    await supabase.from('students').update({ driver_id: driver.id }).in('id', studentIds).eq('school_id', schoolId);
  }

  res.status(201).json({ ...(toCC(driver) as object), username: finalUsername, tempPassword: finalPassword });
}

export async function updateDriver(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  const { fullName, phoneNumber, emergencyContact, licenseNumber, busNumber, age, remove, studentIds, vehicleType } = req.body;

  if (remove) {
    const { data: driver } = await supabase.from('drivers').select('user_id').eq('id', id).single();
    if (driver) await supabase.from('users').update({ is_active: false }).eq('id', driver.user_id);
    res.json({ message: 'Driver deactivated' });
    return;
  }

  // Handle bus
  let busId: string | undefined;
  if (busNumber) {
    const { data: existingBus } = await supabase.from('buses').select('id').eq('school_id', schoolId).eq('bus_number', busNumber).single();
    if (existingBus) {
      busId = existingBus.id;
    } else {
      const { data: newBus } = await supabase.from('buses').insert({ school_id: schoolId, bus_number: busNumber }).select().single();
      busId = newBus?.id;
    }
  }

  const updateData: Record<string, unknown> = {
    full_name: fullName,
    phone_number: phoneNumber || null,
    emergency_contact: emergencyContact || null,
    license_number: licenseNumber || null,
    age: age ? parseInt(age) : null,
    ...hrColumns(req.body),
  };
  if (busId) updateData.bus_id = busId;
  if (vehicleType) updateData.vehicle_type = vehicleType;

  const { data, error } = await supabase.from('drivers')
    .update(updateData)
    .eq('id', id).eq('school_id', schoolId).select().single();

  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  // Admin-trusted phone propagation (migration 050). Only fires when
  // the admin sent phoneNumber explicitly — undefined leaves users.phone_e164
  // alone.
  if (phoneNumber !== undefined && (data as { user_id?: string } | null)?.user_id) {
    await propagateAdminSetPhone((data as { user_id: string }).user_id, phoneNumber);
  }

  // Update student assignments — only when explicitly provided in the request
  if (req.body.hasOwnProperty('studentIds') && Array.isArray(studentIds)) {
    await supabase.from('students').update({ driver_id: null }).eq('driver_id', id).eq('school_id', schoolId);
    if (studentIds.length > 0) {
      await supabase.from('students').update({ driver_id: id }).in('id', studentIds).eq('school_id', schoolId);
    }
  }

  res.json(toCC(data));
}

// ---- ACCOUNTS ----
export async function createAccount(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { firstName, lastName, email, phone, username, password, role } = req.body;

  const { data: schoolData } = await supabase.from('schools').select('abbreviation, features').eq('id', schoolId).single();

  // Accountant role requires the premium tuition_fees feature.
  // (HR fields stored below for roles with no profile table; see hrColumns.)
  if (role === 'accountant' && (schoolData?.features as Record<string, boolean> | null)?.tuition_fees !== true) {
    res.status(403).json({ error: 'Accounting module is not enabled for this school. Contact your provider to upgrade.' });
    return;
  }

  const abbrev = (schoolData?.abbreviation || '').toLowerCase();
  const finalUsername = abbrev && !username.startsWith(`${abbrev}_`) ? `${abbrev}_${username}` : username;

  // Fall back to per-role default password if the admin didn't type one
  // (supervisor / accountant / reception). Admin role still requires an
  // explicit typed password — first-admin bootstrap shouldn't default.
  const rounds = parseInt(process.env.BCRYPT_ROUNDS || '10');
  let finalPassword: string = password;
  let usedDefault = false;
  if (!finalPassword) {
    if (role === 'admin') {
      res.status(400).json({ error: 'Password is required when creating an admin account.' });
      return;
    }
    if (role === 'supervisor' || role === 'accountant' || role === 'reception') {
      finalPassword = defaultPasswordFor(role);
      usedDefault = true;
    } else {
      res.status(400).json({ error: 'Password is required.' });
      return;
    }
  }
  const passwordHash = await bcrypt.hash(finalPassword, rounds);

  const { data: newUser, error } = await supabase.from('users').insert({
    school_id: schoolId,
    first_name: firstName,
    last_name: lastName,
    email: email || null,
    phone: phone || null,
    username: finalUsername,
    password_hash: passwordHash,
    role,
    must_change_password: usedDefault,
    ...hrColumns(req.body, { includeEmergency: true }),
  }).select('id, school_id, username, email, phone, role, first_name, last_name, profile_picture, is_active, created_at, password_changed_at').single();

  if (error) {
    const isDupe = error.code === '23505' || /unique|duplicate/i.test(error.message || '');
    res.status(isDupe ? 409 : safeDbErrorStatus(error)).json({
      error: isDupe
        ? `Username "${username}" already exists. Please choose a different username.`
        : safeDbErrorMessage(error),
    });
    return;
  }

  if (role === 'parent') {
    await supabase.from('parents').insert({
      school_id: schoolId, user_id: newUser.id,
      full_name: `${firstName} ${lastName}`, phone_number: phone, email,
    });
  } else if (role === 'teacher') {
    await supabase.from('teachers').insert({
      school_id: schoolId, user_id: newUser.id,
      full_name: `${firstName} ${lastName}`, phone_number: phone,
    });
  } else if (role === 'driver') {
    await supabase.from('drivers').insert({
      school_id: schoolId, user_id: newUser.id,
      full_name: `${firstName} ${lastName}`, phone_number: phone,
    });
  }

  // Admin-trusted phone propagation (migration 050). Applies to every
  // role that carries a phone here (parent/teacher/driver). Supervisor/
  // reception/accountant accounts via this endpoint don't currently
  // set a phone, so propagation no-ops on null input — safe to call
  // unconditionally.
  await propagateAdminSetPhone(newUser.id, phone);

  res.status(201).json({
    id: newUser.id,
    username,
    role,
    firstName,
    lastName,
    ...(usedDefault ? { tempPassword: finalPassword } : {}),
  });
}

// ---- APPOINTMENTS ----
export async function getPendingAppointmentCount(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { count, error } = await supabase
    .from('appointments')
    .select('*', { count: 'exact', head: true })
    .eq('school_id', schoolId)
    .eq('status', 'pending');
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json({ count: count ?? 0 });
}

export async function getAppointments(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { data, error } = await supabase
    .from('appointments')
    .select('*, parents(full_name, phone_number, user_id)')
    .eq('school_id', schoolId)
    .order('created_at', { ascending: false });
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json(toCC(data));
}

export async function respondToAppointment(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  const { responseMessage, scheduledDate, status } = req.body;

  const { data, error } = await supabase.from('appointments')
    .update({ response_message: responseMessage, scheduled_date: scheduledDate || null, status })
    .eq('id', id).eq('school_id', schoolId)
    .select('*, parents(user_id)')
    .single();

  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  // Notify parent of approval/denial
  const parentUserId = (data as any)?.parents?.user_id;
  if (parentUserId) {
    const approved = status === 'approved';
    notify({
      schoolId,
      userId: parentUserId,
      title: approved ? 'Appointment Approved' : 'Appointment Update',
      message: approved
        ? `Your appointment has been approved${scheduledDate ? ` on ${scheduledDate}` : ''}.${responseMessage ? ' ' + responseMessage : ''}`
        : `Your appointment request has been ${status}.${responseMessage ? ' ' + responseMessage : ''}`,
      type: 'appointment',
    }).catch(() => {});
  }

  res.json(toCC(data));
}

// ---- NOTIFICATIONS ----
export async function sendNotification(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { userIds, title, message, type, targetRole } = req.body;

  let targetUserIds: string[] = [];

  if (Array.isArray(userIds) && userIds.length > 0) {
    // SECURITY (H-4): the supplied userIds MUST belong to the caller's
    // school. Previously this path skipped the membership check, so an
    // admin who learned a UUID from any other school could deliver Expo
    // push to a user in that other school (the device_tokens lookup is
    // keyed by user_id only).
    const { data: validRows } = await supabase
      .from('users')
      .select('id')
      .eq('school_id', schoolId)
      .eq('is_active', true)
      .in('id', userIds);
    targetUserIds = (validRows || []).map(u => u.id);
  } else if (targetRole) {
    const roleFilter = targetRole === 'all'
      ? supabase.from('users').select('id').eq('school_id', schoolId).eq('is_active', true)
      : supabase.from('users').select('id').eq('school_id', schoolId).eq('role', targetRole).eq('is_active', true);
    const { data: users } = await roleFilter;
    targetUserIds = (users || []).map(u => u.id);
  }

  if (targetUserIds.length === 0) { res.json({ sent: 0 }); return; }

  await notifyMany(targetUserIds.map(uid => ({ schoolId, userId: uid, title, message, type: type || 'general' })));
  res.json({ sent: targetUserIds.length });
}

// ---- ANNOUNCEMENTS ----

// Attaches like/comment counts + viewer's like state + creator info (for the
// "admin = school name + admin profile picture" display rule on the client).
export async function decorateAnnouncements(rows: any[], viewerUserId: string): Promise<any[]> {
  if (!rows || rows.length === 0) return [];
  const ids = rows.map(r => r.id);

  const [likesRes, commentsRes, myLikesRes] = await Promise.all([
    supabase.from('announcement_likes').select('announcement_id').in('announcement_id', ids),
    supabase.from('announcement_comments').select('announcement_id').in('announcement_id', ids).eq('is_deleted', false),
    supabase.from('announcement_likes').select('announcement_id').in('announcement_id', ids).eq('user_id', viewerUserId),
  ]);

  const likes: Record<string, number> = {};
  (likesRes.data ?? []).forEach((r: any) => { likes[r.announcement_id] = (likes[r.announcement_id] ?? 0) + 1; });
  const comments: Record<string, number> = {};
  (commentsRes.data ?? []).forEach((r: any) => { comments[r.announcement_id] = (comments[r.announcement_id] ?? 0) + 1; });
  const liked = new Set((myLikesRes.data ?? []).map((r: any) => r.announcement_id));

  return rows.map(r => ({
    ...r,
    likes_count: likes[r.id] ?? 0,
    comments_count: comments[r.id] ?? 0,
    liked_by_me: liked.has(r.id),
  }));
}

const ANNOUNCEMENT_SELECT = '*, users:created_by(id, first_name, last_name, role, profile_picture)';

export async function getAnnouncements(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId, role } = req.user!;
  const { limit, cursor } = parseCursorParams(req.query as Record<string, unknown>);
  const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

  let query = supabase
    .from('announcements')
    .select(ANNOUNCEMENT_SELECT)
    .eq('school_id', schoolId)
    .gte('created_at', cutoff);
  // Audience targeting. Admin and supervisor see everything (they manage /
  // oversee the school); teachers see only announcements meant for them.
  // (Parents have their own filtered endpoint in parent.controller.)
  if (role === 'teacher') query = query.in('target_audience', ['all', 'teachers']);
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

  // Page first, then decorate only the rows we return (bounded fan-out).
  const page = buildPage((data ?? []) as { id: string; created_at: string }[], limit);
  const decorated = await decorateAnnouncements(page.data, userId);
  res.json({ data: toCC(decorated), limit: page.limit, nextCursor: page.nextCursor });
}

export async function getAnnouncementById(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { id } = req.params;
  const { data, error } = await supabase
    .from('announcements')
    .select(ANNOUNCEMENT_SELECT)
    .eq('id', id)
    .eq('school_id', schoolId)
    .single();
  if (error || !data) { res.status(404).json({ error: 'Not found' }); return; }
  const decorated = await decorateAnnouncements([data], userId);
  res.json(toCC(decorated[0]));
}

export async function uploadAnnouncementFile(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const file = (req as any).file;
  if (!file) { res.status(400).json({ error: 'No file provided' }); return; }
  const ext = safeExt(file.originalname, '');
  const path = `${schoolId}/announcements/${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'homework-attachments';
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, file.buffer, { contentType: file.mimetype, upsert: false });
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(path);
  res.json({ url: publicUrl, name: file.originalname });
}

export async function createAnnouncement(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { title, content, targetAudience, linkUrl, imageUrl } = req.body;

  // Legacy: multipart with `attachment` file is still supported.
  let attachmentUrl: string | null = null;
  const file = (req as any).file;
  if (file) {
    const ext = safeExt(file.originalname, '');
    const storagePath = `${schoolId}/announcements/${Date.now()}${ext}`;
    const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'homework-attachments';
    const { data: uploadData, error: uploadErr } = await supabase.storage
      .from(bucket)
      .upload(storagePath, file.buffer, { contentType: file.mimetype, upsert: false });
    if (!uploadErr && uploadData) {
      const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(uploadData.path);
      attachmentUrl = urlData.publicUrl;
    }
  }

  const { data, error } = await supabase.from('announcements').insert({
    school_id: schoolId,
    title,
    content,
    target_audience: targetAudience || 'all',
    created_by: userId,
    attachment_url: attachmentUrl,
    image_url: imageUrl || null,
    link_url: linkUrl || null,
  }).select(ANNOUNCEMENT_SELECT).single();

  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  // Notify target audience in real-time + push.
  // target_audience values are plural ('parents'|'teachers'|'students'|'all') but
  // users.role is singular — map before filtering, otherwise no users match.
  const audience = targetAudience || 'all';
  const audienceRoleMap: Record<string, string> = { parents: 'parent', teachers: 'teacher', students: 'student' };
  const roleFilter = audience === 'all'
    ? supabase.from('users').select('id').eq('school_id', schoolId).eq('is_active', true)
    : supabase.from('users').select('id').eq('school_id', schoolId).eq('role', audienceRoleMap[audience] ?? audience).eq('is_active', true);
  const { data: targets } = await roleFilter;
  if (targets && targets.length > 0) {
    const preview = content.length > 80 ? content.substring(0, 80) + '…' : content;
    // Don't notify the admin who just posted the announcement.
    const recipients = targets.filter((u: any) => u.id !== userId);
    if (recipients.length > 0) {
      notifyMany(recipients.map((u: any) => ({ schoolId, userId: u.id, title, message: preview, type: 'announcement', relatedId: data.id }))).catch(() => {});
    }
  }

  const decorated = await decorateAnnouncements([data], userId);
  res.status(201).json(toCC(decorated[0]));
}

export async function deleteAnnouncement(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  const { error } = await supabase.from('announcements').delete().eq('id', id).eq('school_id', schoolId);
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json({ message: 'Deleted' });
}

// ---- ANNOUNCEMENT LIKES / COMMENTS ----
export async function toggleAnnouncementLike(req: AuthRequest, res: Response): Promise<void> {
  const { userId, schoolId } = req.user!;
  const { id: announcementId } = req.params;

  const { data: existing } = await supabase
    .from('announcement_likes')
    .select('id')
    .eq('announcement_id', announcementId)
    .eq('user_id', userId)
    .maybeSingle();

  if (existing) {
    await supabase.from('announcement_likes').delete().eq('id', existing.id);
    const { count } = await supabase.from('announcement_likes').select('*', { count: 'exact', head: true }).eq('announcement_id', announcementId);
    res.json({ liked: false, likesCount: count ?? 0 });
    return;
  }

  const { error } = await supabase
    .from('announcement_likes')
    .insert({ school_id: schoolId, announcement_id: announcementId, user_id: userId });
  if (error) { res.status(400).json({ error: safeDbErrorMessage(error) }); return; }

  const { count } = await supabase.from('announcement_likes').select('*', { count: 'exact', head: true }).eq('announcement_id', announcementId);
  res.json({ liked: true, likesCount: count ?? 0 });
}

export async function getAnnouncementComments(req: AuthRequest, res: Response): Promise<void> {
  const { userId, schoolId } = req.user!;
  const { id: announcementId } = req.params;

  const { data, error } = await supabase
    .from('announcement_comments')
    .select('id, announcement_id, user_id, parent_id, body, created_at, users(first_name, last_name, role, profile_picture)')
    .eq('announcement_id', announcementId)
    .eq('school_id', schoolId)
    .eq('is_deleted', false)
    .order('created_at', { ascending: true });

  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  const comments = data ?? [];
  if (comments.length === 0) { res.json([]); return; }

  const ids = comments.map((c: any) => c.id);
  const teacherUserIds = Array.from(new Set(
    comments.filter((c: any) => c.users?.role === 'teacher').map((c: any) => c.user_id)
  ));
  const [likesRes, myLikesRes, subjectsRes] = await Promise.all([
    supabase.from('announcement_comment_likes').select('comment_id').in('comment_id', ids),
    supabase.from('announcement_comment_likes').select('comment_id').in('comment_id', ids).eq('user_id', userId),
    teacherUserIds.length > 0
      ? supabase.from('teachers').select('user_id, subject').in('user_id', teacherUserIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const counts: Record<string, number> = {};
  (likesRes.data ?? []).forEach((r: any) => { counts[r.comment_id] = (counts[r.comment_id] ?? 0) + 1; });
  const liked = new Set((myLikesRes.data ?? []).map((r: any) => r.comment_id));
  const subjectByUser: Record<string, string | null> = {};
  ((subjectsRes.data ?? []) as any[]).forEach((t: any) => { subjectByUser[t.user_id] = t.subject ?? null; });

  res.json(comments.map((c: any) => ({
    ...c,
    author_subject: c.users?.role === 'teacher' ? (subjectByUser[c.user_id] ?? null) : null,
    likes_count: counts[c.id] ?? 0,
    liked_by_me: liked.has(c.id),
  })));
}

export async function createAnnouncementComment(req: AuthRequest, res: Response): Promise<void> {
  const { userId, schoolId } = req.user!;
  const { id: announcementId } = req.params;
  const { body, parentId } = req.body;

  if (!body || typeof body !== 'string' || body.trim().length === 0) {
    res.status(400).json({ error: 'Comment body required' });
    return;
  }

  let resolvedParentId: string | null = null;
  let directParentUserId: string | null = null;
  if (parentId && typeof parentId === 'string') {
    const { data: parent } = await supabase
      .from('announcement_comments')
      .select('id, announcement_id, parent_id, user_id')
      .eq('id', parentId)
      .eq('school_id', schoolId)
      .maybeSingle();
    if (!parent || parent.announcement_id !== announcementId) {
      res.status(400).json({ error: 'Invalid parent comment' });
      return;
    }
    // Flatten replies-to-replies onto the top-level parent
    resolvedParentId = parent.parent_id ?? parent.id;
    directParentUserId = parent.user_id;
  }

  const { data, error } = await supabase
    .from('announcement_comments')
    .insert({
      school_id: schoolId,
      announcement_id: announcementId,
      user_id: userId,
      parent_id: resolvedParentId,
      body: body.trim(),
    })
    .select('id, announcement_id, user_id, parent_id, body, created_at, users(first_name, last_name, role, profile_picture)')
    .single();

  if (error) { res.status(400).json({ error: safeDbErrorMessage(error) }); return; }

  // Notify announcement author + (if reply) the user being replied to.
  // Skip self-notification and de-duplicate when the same user is both targets.
  const { data: ann } = await supabase
    .from('announcements')
    .select('title, created_by')
    .eq('id', announcementId)
    .eq('school_id', schoolId)
    .maybeSingle();
  const { data: commenter } = await supabase
    .from('users')
    .select('first_name, last_name')
    .eq('id', userId)
    .maybeSingle();
  const commenterName = `${commenter?.first_name ?? ''} ${commenter?.last_name ?? ''}`.trim() || 'Someone';
  const annTitle = (ann?.title as string | undefined) ?? 'your announcement';
  const preview = body.trim().length > 80 ? body.trim().substring(0, 80) + '…' : body.trim();
  const targets = new Set<string>();
  if (ann?.created_by && ann.created_by !== userId) targets.add(ann.created_by);
  if (directParentUserId && directParentUserId !== userId && directParentUserId !== ann?.created_by) targets.add(directParentUserId);
  if (targets.size > 0) {
    const payloads = Array.from(targets).map(uid => ({
      schoolId,
      userId: uid,
      title: directParentUserId === uid
        ? `${commenterName} replied to your comment`
        : `${commenterName} commented on "${annTitle}"`,
      message: preview,
      type: 'announcement',
      relatedId: String(announcementId),
    }));
    notifyMany(payloads).catch(() => {});
  }

  let authorSubject: string | null = null;
  if ((data as any)?.users?.role === 'teacher') {
    const { data: teacher } = await supabase
      .from('teachers')
      .select('subject')
      .eq('user_id', userId)
      .maybeSingle();
    authorSubject = (teacher as any)?.subject ?? null;
  }

  res.status(201).json({ ...data, author_subject: authorSubject, likes_count: 0, liked_by_me: false });
}

export async function toggleAnnouncementCommentLike(req: AuthRequest, res: Response): Promise<void> {
  const { userId, schoolId } = req.user!;
  const { commentId } = req.params;

  const { data: existing } = await supabase
    .from('announcement_comment_likes')
    .select('id')
    .eq('comment_id', commentId)
    .eq('user_id', userId)
    .maybeSingle();

  if (existing) {
    await supabase.from('announcement_comment_likes').delete().eq('id', existing.id);
    const { count } = await supabase.from('announcement_comment_likes').select('*', { count: 'exact', head: true }).eq('comment_id', commentId);
    res.json({ liked: false, likesCount: count ?? 0 });
    return;
  }

  const { error } = await supabase
    .from('announcement_comment_likes')
    .insert({ school_id: schoolId, comment_id: commentId, user_id: userId });
  if (error) { res.status(400).json({ error: safeDbErrorMessage(error) }); return; }

  const { count } = await supabase.from('announcement_comment_likes').select('*', { count: 'exact', head: true }).eq('comment_id', commentId);
  res.json({ liked: true, likesCount: count ?? 0 });
}

export async function deleteAnnouncementComment(req: AuthRequest, res: Response): Promise<void> {
  const { userId, role, schoolId } = req.user!;
  const { commentId } = req.params;

  const { data: existing } = await supabase
    .from('announcement_comments')
    .select('user_id')
    .eq('id', commentId)
    .eq('school_id', schoolId)
    .single();

  if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
  if (existing.user_id !== userId && role !== 'admin') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const { error } = await supabase
    .from('announcement_comments')
    .update({ is_deleted: true })
    .eq('id', commentId);

  if (error) { res.status(400).json({ error: safeDbErrorMessage(error) }); return; }
  res.json({ success: true });
}

// ---- LINK PREVIEW ----
export async function getLinkPreview(req: AuthRequest, res: Response): Promise<void> {
  const { url } = req.query as { url: string };
  if (!url) { res.status(400).json({ error: 'url required' }); return; }

  // YouTube special case — no fetch needed
  const ytMatch = url.match(/(?:youtube\.com\/watch\?.*?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (ytMatch) {
    res.json({ type: 'youtube', videoId: ytMatch[1], url, title: 'YouTube Video', description: '', image: `https://img.youtube.com/vi/${ytMatch[1]}/mqdefault.jpg`, siteName: 'YouTube' });
    return;
  }

  // Instagram — blocks scraping, return branded fallback immediately
  if (/instagram\.com/.test(url)) {
    const label = /\/reel\//.test(url) ? 'Instagram Reel' : /\/p\//.test(url) ? 'Instagram Post' : 'Instagram';
    res.json({ type: 'instagram', url, title: label, description: 'Tap to view on Instagram', image: '', siteName: 'Instagram' });
    return;
  }

  // Facebook — blocks scraping, return branded fallback immediately
  if (/facebook\.com|fb\.com/.test(url)) {
    const label = /\/watch|\/videos/.test(url) ? 'Facebook Video' : /\/posts|\/photos/.test(url) ? 'Facebook Post' : 'Facebook';
    res.json({ type: 'facebook', url, title: label, description: 'Tap to view on Facebook', image: '', siteName: 'Facebook' });
    return;
  }

  // SSRF guard: refuse anything that resolves to private/loopback/cloud-
  // metadata before we ever open a socket. The follow-up fetch MUST also
  // set `redirect: 'manual'` so a 3xx Location can't bypass this check.
  const safety = await isUrlSafeToFetch(url);
  if (!safety.ok) {
    // Don't leak the specific reason to the caller (an attacker could use
    // pass/fail timings to map internal hosts). Log it for the operator.
    logger.warn('link-preview rejected unsafe URL', { url, reason: safety.reason });
    res.json({ type: 'link', url, title: '', description: '', image: '', siteName: '' });
    return;
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SchoolApp/1.0)' },
      signal: ctrl.signal,
      // No auto-follow: a 302 to http://169.254.169.254/ would otherwise
      // re-introduce the SSRF after our pre-fetch check.
      redirect: 'manual',
    });
    clearTimeout(timer);

    // Refuse to follow server-side redirects. If the user pasted a shortened
    // URL, they'll see the empty-preview fallback — small UX cost, big
    // security win. The bracketed range (>=300, <400) covers all 3xx forms.
    if (response.status >= 300 && response.status < 400) {
      res.json({ type: 'link', url, title: '', description: '', image: '', siteName: safety.hostname.replace(/^www\./, '') });
      return;
    }

    const html = await response.text();

    const getMeta = (attr: string, val: string) => {
      const r1 = html.match(new RegExp(`<meta[^>]+${attr}=["']${val}["'][^>]+content=["']([^"'<>]+)["']`, 'i'));
      const r2 = html.match(new RegExp(`<meta[^>]+content=["']([^"'<>]+)["'][^>]+${attr}=["']${val}["']`, 'i'));
      return (r1 || r2)?.[1]?.trim() ?? '';
    };

    const title = getMeta('property', 'og:title') || getMeta('name', 'twitter:title') || html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || '';
    const description = getMeta('property', 'og:description') || getMeta('name', 'twitter:description') || getMeta('name', 'description') || '';
    const image = getMeta('property', 'og:image') || getMeta('name', 'twitter:image') || '';
    let siteName = getMeta('property', 'og:site_name') || safety.hostname.replace(/^www\./, '');

    res.json({ type: 'link', url, title, description: description.substring(0, 200), image, siteName });
  } catch {
    res.json({ type: 'link', url, title: '', description: '', image: '', siteName: safety.hostname.replace(/^www\./, '') });
  }
}

// ---- STUDENT BRIEF ----
export async function getStudentBrief(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;

  const [studentRes, reportsRes, gradesRes] = await Promise.all([
    supabase.from('students')
      .select('*, classes(name), parents(id, full_name, phone_number, email), drivers(full_name, buses(bus_number))')
      .eq('id', id).eq('school_id', schoolId).single(),
    supabase.from('reports').select('*, teachers(full_name)').eq('student_id', id).eq('school_id', schoolId).order('created_at', { ascending: false }),
    supabase.from('grades').select('*').eq('student_id', id).eq('school_id', schoolId),
  ]);

  res.json({
    student: toCC(studentRes.data),
    reports: toCC(reportsRes.data) || [],
    grades: toCC(gradesRes.data) || [],
  });
}

// ============================================================
// GRADE REVIEW & RELEASE (admin gate)
// Teacher grades land unreleased; an admin reviews, optionally edits the
// marks / writes a parent-visible note, then releases to parents.
// ============================================================

// All grades for the school that are still awaiting release, with the joined
// context the review queue needs (student, class, teacher, subject).
export async function listPendingGrades(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { data, error } = await supabase
    .from('grades')
    .select('id, subject, marks, grading_period, academic_year, admin_note, created_at, student_id, class_id, students(full_name), classes(name), teachers(full_name)')
    .eq('school_id', schoolId)
    .eq('is_released', false)
    .order('created_at', { ascending: false });
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json(toCC(data));
}

// Admin edits a pending grade's marks and/or the parent-visible note.
// Does NOT release — release is a separate, explicit action.
export async function updateGrade(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  const { marks, adminNote } = req.body as { marks?: { name: string; value: unknown }[]; adminNote?: string | null };

  const patch: Record<string, unknown> = {};
  if (marks !== undefined) patch.marks = marks || [];
  if (adminNote !== undefined) patch.admin_note = (typeof adminNote === 'string' && adminNote.trim()) ? adminNote.trim() : null;
  if (Object.keys(patch).length === 0) { res.status(400).json({ error: 'Nothing to update' }); return; }

  const { data, error } = await supabase
    .from('grades')
    .update(patch)
    .eq('id', id)
    .eq('school_id', schoolId)
    .select()
    .single();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  if (!data) { res.status(404).json({ error: 'Grade not found' }); return; }
  res.json(toCC(data));
}

// Release one or more grades to parents. Stamps released_at/by and notifies
// each affected student's parents.
export async function releaseGrades(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { ids } = req.body as { ids?: string[] };
  if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: 'ids required' }); return; }

  const { data: released, error } = await supabase
    .from('grades')
    .update({ is_released: true, released_at: new Date().toISOString(), released_by: userId })
    .eq('school_id', schoolId)
    .in('id', ids)
    .eq('is_released', false)
    .select('id, subject, student_id, students(full_name, parents(user_id))');
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  // Notify the parents of each affected student.
  const payloads: { schoolId: string; userId: string; title: string; message: string; type: string }[] = [];
  for (const g of (released || []) as any[]) {
    const studentName = g.students?.full_name || 'your child';
    const parents = Array.isArray(g.students?.parents)
      ? g.students.parents
      : g.students?.parents ? [g.students.parents] : [];
    for (const p of parents) {
      if (!p?.user_id) continue;
      payloads.push({
        schoolId, userId: p.user_id,
        title: 'Grades Updated',
        message: `Grades for ${studentName} in ${g.subject} have been released.`,
        type: 'grade',
      });
    }
  }
  if (payloads.length > 0) notifyMany(payloads).catch(() => {});

  res.json({ released: (released || []).length });
}

// Drill-down overview for the Grade Review page, scoped to one grading term:
// classes → students → that student's pending grades, plus progress counts.
// "Submitted" = a curriculum subject has any grade for the student this term
// (released or pending). The per-student `pending` list is unreleased only.
export async function getGradeReviewOverview(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const termParam = (req.query.term as string | undefined)?.trim() || '';

  const [classesRes, studentsRes, cstRes, termsRes] = await Promise.all([
    supabase.from('classes').select('id, name').eq('school_id', schoolId).order('name'),
    supabase.from('students').select('id, full_name, class_id').eq('school_id', schoolId).eq('is_graduated', false).order('full_name'),
    supabase.from('class_subject_teachers').select('class_id, subjects(name)').eq('school_id', schoolId),
    supabase.from('terms').select('name').eq('school_id', schoolId).order('order_index').order('created_at'),
  ]);

  const termNames: string[] = (termsRes.data || []).map((t: any) => t.name).filter(Boolean);
  const selectedTerm = termParam || termNames[0] || '';

  let gq = supabase.from('grades')
    .select('id, student_id, subject, grading_period, marks, admin_note, is_released, created_at, teachers(full_name)')
    .eq('school_id', schoolId);
  if (selectedTerm) gq = gq.eq('grading_period', selectedTerm);
  const { data: grades } = await gq;

  // curriculum subjects (distinct names) per class
  const subjectsByClass = new Map<string, Set<string>>();
  for (const r of (cstRes.data || []) as any[]) {
    const name = r.subjects?.name;
    if (!name) continue;
    if (!subjectsByClass.has(r.class_id)) subjectsByClass.set(r.class_id, new Set());
    subjectsByClass.get(r.class_id)!.add(name);
  }

  const gradesByStudent = new Map<string, any[]>();
  for (const g of (grades || []) as any[]) {
    if (!gradesByStudent.has(g.student_id)) gradesByStudent.set(g.student_id, []);
    gradesByStudent.get(g.student_id)!.push(g);
  }

  const studentsByClass = new Map<string, any[]>();
  for (const s of (studentsRes.data || []) as any[]) {
    if (!s.class_id) continue;
    if (!studentsByClass.has(s.class_id)) studentsByClass.set(s.class_id, []);
    studentsByClass.get(s.class_id)!.push(s);
  }

  const classes = (classesRes.data || []).map((c: any) => {
    const subjSet = subjectsByClass.get(c.id) || new Set<string>();
    const totalSubjects = subjSet.size;
    const roster = studentsByClass.get(c.id) || [];
    let studentsComplete = 0;

    const students = roster.map((s: any) => {
      const sg = gradesByStudent.get(s.id) || [];
      const gradedSet = new Set<string>();
      const pending: any[] = [];
      for (const g of sg) {
        if (subjSet.has(g.subject)) gradedSet.add(g.subject);
        if (!g.is_released) {
          pending.push({
            id: g.id, subject: g.subject, gradingPeriod: g.grading_period,
            marks: g.marks || [], adminNote: g.admin_note, createdAt: g.created_at,
            teacherName: g.teachers?.full_name || null,
          });
        }
      }
      const gradedSubjects = gradedSet.size;
      if (totalSubjects > 0 && gradedSubjects >= totalSubjects) studentsComplete++;
      return {
        studentId: s.id, fullName: s.full_name,
        gradedSubjects, totalSubjects,
        pendingCount: pending.length,
        pending,
      };
    });

    return {
      classId: c.id, className: c.name,
      subjects: Array.from(subjSet),
      totalSubjects,
      totalStudents: roster.length,
      studentsComplete,
      students,
    };
  });

  res.json({ terms: termNames, selectedTerm, classes });
}

// ---- TEACHER DELETE ----
export async function deleteTeacher(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;

  const { data: teacher, error: findErr } = await supabase
    .from('teachers')
    .select('id, user_id, full_name, phone_number, subject, emergency_contact, profile_picture, created_at')
    .eq('id', id).eq('school_id', schoolId).single();
  if (findErr || !teacher) {
    res.status(404).json({ error: 'Teacher not found in this school' });
    return;
  }

  // Preserve authored content (orphan, don't destroy). Runs before either
  // path so the records survive the users→teachers cascade.
  await supabase.from('homework').update({ teacher_id: null } as any).eq('teacher_id', id).eq('school_id', schoolId);
  await supabase.from('assignments').update({ teacher_id: null } as any).eq('teacher_id', id).eq('school_id', schoolId);
  await supabase.from('grades').update({ teacher_id: null } as any).eq('teacher_id', id).eq('school_id', schoolId);
  await supabase.from('reports').update({ teacher_id: null } as any).eq('teacher_id', id).eq('school_id', schoolId);
  await supabase.from('weekly_summaries').delete().eq('teacher_id', id).eq('school_id', schoolId);
  await supabase.from('subjects').update({ teacher_id: null }).eq('teacher_id', id).eq('school_id', schoolId);

  const archiveOn = await hasArchiveFeature(schoolId);

  if (archiveOn) {
    const reason = normalizeArchiveReason(req.body?.reason);
    const departureDate = (req.body?.departureDate as string | undefined) || new Date().toISOString().split('T')[0];
    const teaching = await buildTeacherTeachingSnapshot(String(id), schoolId);
    const account = await loadAccountSnapshot(teacher.user_id, schoolId);
    const r = await performEmployeeArchive({
      schoolId, userId: teacher.user_id, originalEmployeeId: teacher.id, role: 'teacher',
      fullName: teacher.full_name, phoneNumber: teacher.phone_number, subject: teacher.subject,
      emergencyContact: teacher.emergency_contact, profilePicture: teacher.profile_picture,
      hireDate: teacher.created_at ? String(teacher.created_at).split('T')[0] : null,
      departureDate, reason, account, teaching,
      actorId: req.user!.userId, actorName: req.user!.username, actorRole: req.user!.role,
    });
    if (!r.ok) { res.status(500).json({ error: r.error }); return; }
    // Wave 2: rewrite polymorphic owner pointers on employee_documents +
    // extended profile + emergency contacts + acknowledgements + actions
    // so they survive the cascade and stay attached to the archive row.
    await rewriteOwnershipToArchive(schoolId, 'teachers', String(id), r.archiveId);
    await logAudit({ req, entityType: 'teacher', entityId: String(id), action: 'delete', before: teacher as Record<string, unknown>, label: teacher.full_name, reason: `Archived (${reason})` });
    res.json({ message: 'Teacher archived', archived: true, archiveId: r.archiveId });
    return;
  }

  // Archive feature off — hard delete (no historical record retained).
  const { error: delTeacherErr } = await supabase.from('teachers').delete().eq('id', id).eq('school_id', schoolId);
  if (delTeacherErr) { res.status(safeDbErrorStatus(delTeacherErr)).json({ error: safeDbErrorMessage(delTeacherErr) }); return; }
  const { error: delUserErr } = await supabase.from('users').delete().eq('id', teacher.user_id);
  if (delUserErr) { res.status(safeDbErrorStatus(delUserErr)).json({ error: safeDbErrorMessage(delUserErr) }); return; }
  await logAudit({ req, entityType: 'teacher', entityId: String(id), action: 'delete', before: teacher as Record<string, unknown>, label: teacher.full_name, reason: 'Deleted (no archive)' });
  res.json({ message: 'Teacher removed' });
}

// ---- DRIVER DELETE ----
export async function deleteDriver(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;

  const { data: driver, error: findErr } = await supabase
    .from('drivers')
    .select('id, user_id, full_name, phone_number, emergency_contact, license_number, bus_id, profile_picture, age, vehicle_type, created_at')
    .eq('id', id).eq('school_id', schoolId).single();
  if (findErr || !driver) {
    res.status(404).json({ error: 'Driver not found in this school' });
    return;
  }

  const archiveOn = await hasArchiveFeature(schoolId);

  // Snapshot the transport ledger BEFORE unlinking — students roster and
  // ride-record stats are gone once the driver row cascades away.
  let transport: unknown = {};
  if (archiveOn) {
    const [{ data: roster }, { data: bus }, rideTotal, rideRode] = await Promise.all([
      supabase.from('students').select('id, full_name').eq('driver_id', id).eq('school_id', schoolId),
      driver.bus_id ? supabase.from('buses').select('bus_number, plate_number').eq('id', driver.bus_id).single() : Promise.resolve({ data: null }),
      supabase.from('bus_ride_records').select('id', { count: 'exact', head: true }).eq('driver_id', id).eq('school_id', schoolId),
      supabase.from('bus_ride_records').select('id', { count: 'exact', head: true }).eq('driver_id', id).eq('school_id', schoolId).eq('rode_bus', true),
    ]);
    transport = {
      licenseNumber: driver.license_number ?? null,
      vehicleType: driver.vehicle_type ?? null,
      busNumber: (bus as any)?.bus_number ?? null,
      plateNumber: (bus as any)?.plate_number ?? null,
      studentsTransported: (roster ?? []).map((s: any) => ({ id: s.id, fullName: s.full_name })),
      rideRecordStats: { total: rideTotal.count ?? 0, rode: rideRode.count ?? 0 },
    };
  }

  // Unlink students; drop ephemeral GPS.
  await supabase.from('students').update({ driver_id: null }).eq('driver_id', id).eq('school_id', schoolId);
  await supabase.from('bus_locations').delete().eq('driver_id', id).eq('school_id', schoolId);

  if (archiveOn) {
    const reason = normalizeArchiveReason(req.body?.reason);
    const departureDate = (req.body?.departureDate as string | undefined) || new Date().toISOString().split('T')[0];
    const account = await loadAccountSnapshot(driver.user_id, schoolId);
    const r = await performEmployeeArchive({
      schoolId, userId: driver.user_id, originalEmployeeId: driver.id, role: 'driver',
      fullName: driver.full_name, phoneNumber: driver.phone_number, age: driver.age,
      emergencyContact: driver.emergency_contact, profilePicture: driver.profile_picture,
      hireDate: driver.created_at ? String(driver.created_at).split('T')[0] : null,
      departureDate, reason, account, transport,
      actorId: req.user!.userId, actorName: req.user!.username, actorRole: req.user!.role,
    });
    if (!r.ok) { res.status(500).json({ error: r.error }); return; }
    await rewriteOwnershipToArchive(schoolId, 'drivers', String(id), r.archiveId);
    await logAudit({ req, entityType: 'driver', entityId: String(id), action: 'delete', before: driver as Record<string, unknown>, label: driver.full_name, reason: `Archived (${reason})` });
    res.json({ message: 'Driver archived', archived: true, archiveId: r.archiveId });
    return;
  }

  const { error: delDriverErr } = await supabase.from('drivers').delete().eq('id', id).eq('school_id', schoolId);
  if (delDriverErr) { res.status(safeDbErrorStatus(delDriverErr)).json({ error: safeDbErrorMessage(delDriverErr) }); return; }
  const { error: delUserErr } = await supabase.from('users').delete().eq('id', driver.user_id);
  if (delUserErr) { res.status(safeDbErrorStatus(delUserErr)).json({ error: safeDbErrorMessage(delUserErr) }); return; }
  await logAudit({ req, entityType: 'driver', entityId: String(id), action: 'delete', before: driver as Record<string, unknown>, label: driver.full_name, reason: 'Deleted (no archive)' });
  res.json({ message: 'Driver removed' });
}

// ---- SUBJECTS ----
// Subjects are just a school-defined catalogue of names; teacher assignment lives in the
// curriculum (class ↔ subject ↔ teacher). getSubjects surfaces the derived teacher list
// (with the classes each teaches it to) for the read-only Subjects tab.
export async function getSubjects(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { data, error } = await supabase
    .from('subjects')
    .select('id, name, school_id, created_at, teacher_id, class_subject_teachers(teacher_id, class_id, teachers(id, full_name), classes(name))')
    .eq('school_id', schoolId)
    .order('name');
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  const subjects = ((data ?? []) as any[]).map(s => {
    const byTeacher = new Map<string, { id: string; fullName: string; classes: { id: string; name: string }[] }>();
    for (const r of (s.class_subject_teachers ?? [])) {
      const tid = r.teacher_id, tname = r.teachers?.full_name;
      if (!tid || !tname) continue;
      if (!byTeacher.has(tid)) byTeacher.set(tid, { id: tid, fullName: tname, classes: [] });
      if (r.class_id && !byTeacher.get(tid)!.classes.some(c => c.id === r.class_id)) {
        byTeacher.get(tid)!.classes.push({ id: r.class_id, name: r.classes?.name ?? '' });
      }
    }
    const teachers = Array.from(byTeacher.values()).sort((a, b) => a.fullName.localeCompare(b.fullName));
    const { class_subject_teachers: _cst, ...rest } = s;
    return { ...rest, teachers };
  });
  res.json(toCC(subjects));
}

export async function createSubject(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { name } = req.body;
  if (!name || !String(name).trim()) { res.status(400).json({ error: 'Subject name is required' }); return; }
  const { data, error } = await supabase.from('subjects').insert({
    school_id: schoolId, name: String(name).trim(), teacher_id: null,
  }).select().single();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.status(201).json(toCC(data));
}

export async function updateSubject(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  const { name } = req.body;
  if (!name || !String(name).trim()) { res.status(400).json({ error: 'Subject name is required' }); return; }
  const { data, error } = await supabase.from('subjects')
    .update({ name: String(name).trim() }).eq('id', id).eq('school_id', schoolId).select().single();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json(toCC(data));
}

export async function deleteSubject(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  // Teachers who taught this subject — refresh their cached subject text after the cascade delete.
  const { data: links } = await supabase.from('class_subject_teachers').select('teacher_id')
    .eq('school_id', schoolId).eq('subject_id', id);
  const teacherIds = Array.from(new Set(((links ?? []) as any[]).map(r => r.teacher_id)));
  await supabase.from('subjects').delete().eq('id', id).eq('school_id', schoolId); // cascades class_subject_teachers + subject_teachers
  await Promise.all(teacherIds.map((tid: string) => recomputeTeacherCaches(schoolId, tid)));
  res.json({ message: 'Subject deleted' });
}

// ---- PARENTS ----
// ---- WEEKLY SUMMARY (admin view) ----
export async function getWeeklySummaries(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { classId, subject, weekStartDate } = req.query as Record<string, string>;

  let query = supabase
    .from('weekly_summaries')
    .select('*, classes(name), teachers(full_name)')
    .eq('school_id', schoolId)
    .order('week_start_date', { ascending: false });

  if (classId) query = query.eq('class_id', classId);
  if (subject) query = query.eq('subject', subject);
  if (weekStartDate) query = query.eq('week_start_date', weekStartDate);

  const { data, error } = await query;
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json(toCC(data));
}

export async function getWeeklySummaryStatus(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { weekStartDate } = req.query as Record<string, string>;

  const [teachersRes, summariesRes] = await Promise.all([
    supabase.from('teachers').select('id, full_name, subject').eq('school_id', schoolId),
    supabase.from('weekly_summaries')
      .select('teacher_id')
      .eq('school_id', schoolId)
      .eq('week_start_date', weekStartDate || new Date().toISOString().split('T')[0]),
  ]);

  if (teachersRes.error) { res.status(500).json({ error: teachersRes.error.message }); return; }

  const submittedIds = new Set((summariesRes.data || []).map((s: any) => s.teacher_id));
  const result = (teachersRes.data || []).map((t: any) => ({
    id: t.id,
    fullName: t.full_name,
    subject: t.subject,
    submitted: submittedIds.has(t.id),
  }));

  res.json(result);
}

export async function getGraduatedStudents(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { search } = req.query as Record<string, string>;

  if (!(await hasArchiveFeature(schoolId))) {
    res.status(403).json({ error: 'Archive feature is not enabled for this school' });
    return;
  }

  let query = supabase
    .from('students')
    .select('id, full_name, profile_picture, class_id, classes(name), parents(full_name, phone_number)')
    .eq('school_id', schoolId)
    .eq('is_graduated', true)
    .order('full_name');

  if (search) query = query.ilike('full_name', `%${search}%`);

  const { data, error } = await query;
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json(toCC(data));
}

// PDF export of archived + graduated student records. Admin self-serve.
// Gated on the archive feature — returns 403 when off.
export async function exportArchivePdf(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  if (!(await hasArchiveFeature(schoolId))) {
    res.status(403).json({ error: 'Archive feature is not enabled for this school' });
    return;
  }
  const snapshot = await loadArchiveSnapshot(schoolId);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="archive-${snapshot.schoolName.replace(/[^a-z0-9-_]+/gi, '_')}-${new Date().toISOString().split('T')[0]}.pdf"`);
  streamPdf(snapshot, res);
}

export async function exportArchiveXlsx(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  if (!(await hasArchiveFeature(schoolId))) {
    res.status(403).json({ error: 'Archive feature is not enabled for this school' });
    return;
  }
  const snapshot = await loadArchiveSnapshot(schoolId);
  const buf = buildXlsx(snapshot);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="archive-${snapshot.schoolName.replace(/[^a-z0-9-_]+/gi, '_')}-${new Date().toISOString().split('T')[0]}.xlsx"`);
  res.send(buf);
}

// Full machine-readable archive backup (finding F4). One JSON file with
// every archived student (incl. graduated snapshots) and archived
// employee, raw. The school can take this any time so they always hold
// their own copy — independent of the provider-side pre-purge backup the
// master portal retains on cancellation. Archive-feature gated.
// E-a: recompute every snapshot hash + the audit chain and report any
// tampering. Empty issues array = cryptographically intact.
export async function verifyArchiveIntegrity(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  if (!(await hasArchiveFeature(schoolId))) {
    res.status(403).json({ error: 'Archive feature is not enabled for this school' });
    return;
  }
  const { data, error } = await supabase.rpc('verify_school_integrity', { p_school_id: schoolId });
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  const issues = (data ?? []) as { kind: string; table_name: string; row_id: string; detail: string }[];
  const tampered = issues.filter(i => i.kind !== 'unhashed');
  res.json({
    ok: tampered.length === 0,
    checkedAt: new Date().toISOString(),
    issues: toCC(issues),
    tamperedCount: tampered.length,
    unhashedCount: issues.length - tampered.length,
  });
}

export async function exportFullArchiveBackup(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  if (!(await hasArchiveFeature(schoolId))) {
    res.status(403).json({ error: 'Archive feature is not enabled for this school' });
    return;
  }

  // AC-10 — v2 payload includes the General Ledger (the only first-class
  // book of record per ACCOUNTANT_AUDIT.md). The chart of accounts +
  // payment accounts ship alongside so account_id references in the
  // lines remain interpretable after a re-import. Historical fee_plans
  // (including voided) preserve the source-document context the GL's
  // FK-less source_id rows point at. Schools without the tuition_fees
  // module still get all keys — as empty arrays — so v2 readers don't
  // need to special-case shape.
  const [
    { data: school }, { data: students }, { data: employees },
    { data: jEntries }, { data: jLines }, { data: coa }, { data: payAccts }, { data: feePlans },
  ] = await Promise.all([
    supabase.from('schools').select('name').eq('id', schoolId).single(),
    supabase.from('archived_students').select('*').eq('school_id', schoolId).order('created_at', { ascending: false }),
    supabase.from('archived_employees').select('*').eq('school_id', schoolId).order('created_at', { ascending: false }),
    supabase.from('journal_entries').select('*').eq('school_id', schoolId).order('entry_no', { ascending: true }),
    supabase.from('journal_lines').select('*').eq('school_id', schoolId).order('created_at', { ascending: true }),
    supabase.from('chart_of_accounts').select('*').eq('school_id', schoolId),
    supabase.from('payment_accounts').select('*').eq('school_id', schoolId),
    supabase.from('fee_plans').select('*').eq('school_id', schoolId),
  ]);

  const backup = {
    schemaVersion: 2,
    kind: 'full_archive_backup',
    schoolName: (school as { name?: string } | null)?.name ?? 'School',
    generatedAt: new Date().toISOString(),
    counts: {
      students: (students ?? []).length,
      employees: (employees ?? []).length,
      journalEntries: (jEntries ?? []).length,
      journalLines: (jLines ?? []).length,
    },
    archivedStudents: toCC(students ?? []),
    archivedEmployees: toCC(employees ?? []),
    journalEntries: toCC(jEntries ?? []),
    journalLines: toCC(jLines ?? []),
    chartOfAccounts: toCC(coa ?? []),
    paymentAccounts: toCC(payAccts ?? []),
    feePlansHistorical: toCC(feePlans ?? []),
  };

  const safe = ((school as { name?: string } | null)?.name ?? 'school').replace(/[^a-z0-9-_]+/gi, '_');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="archive-backup-${safe}-${new Date().toISOString().split('T')[0]}.json"`);
  res.send(JSON.stringify(backup, null, 2));
}

// ---- YEAR TRANSITION ----
// Migration 041 reframed reports as durable year-organized history. The
// wizard no longer wipes them; reports now carry their own `academic_year`
// column and the parent / teacher views group by year.
//
// Graduating path also calls closeCurrentEnrollment(status='graduated')
// BEFORE flipping is_graduated, so the snapshot's enrollment_history
// records the final year cleanly (audit finding HD-3). Matches the per-
// class promote wizard's pattern.
export async function yearTransition(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const {
    newAcademicYear,
    studentIdsToGraduate = [],
    classAssignments = [],  // [{ studentId, classId }]
  } = req.body;

  if (!newAcademicYear) {
    res.status(400).json({ error: 'newAcademicYear is required' });
    return;
  }

  // 1. Graduate selected students. Schools without the archive feature can't
  //    retain past students — delete them instead of marking graduated.
  if (studentIdsToGraduate.length > 0) {
    const archiveOn = await hasArchiveFeature(schoolId);
    if (archiveOn) {
      // Close each student's current enrollment row with status='graduated'
      // first, so the archive snapshot below reads the finalised row. This
      // mirrors commitPromoteClass and archiveStudent; without it the row
      // stays open as 'enrolled' and the snapshot's enrollment_history
      // mislabels the last year (audit finding HD-3).
      for (const sid of studentIdsToGraduate) {
        await closeCurrentEnrollment({ schoolId, studentId: String(sid), status: 'graduated' });
      }
      const { error: gradErr } = await supabase.from('students')
        .update({ is_graduated: true })
        .in('id', studentIdsToGraduate).eq('school_id', schoolId);
      if (gradErr) { res.status(safeDbErrorStatus(gradErr)).json({ error: safeDbErrorMessage(gradErr) }); return; }
      // Freeze a snapshot per graduated student (best-effort, idempotent).
      const actor = { id: req.user!.userId, name: req.user!.username, role: req.user!.role };
      for (const sid of studentIdsToGraduate) {
        await snapshotGraduatedStudent(schoolId, sid, actor);
      }
    } else {
      const { error: delErr } = await supabase.from('students')
        .delete().in('id', studentIdsToGraduate).eq('school_id', schoolId);
      if (delErr) { res.status(safeDbErrorStatus(delErr)).json({ error: safeDbErrorMessage(delErr) }); return; }
    }
  }

  // 2. Apply class assignments — grouped by target class for efficient bulk updates
  if (classAssignments.length > 0) {
    const byClass: Record<string, string[]> = {};
    for (const { studentId, classId } of classAssignments) {
      if (!byClass[classId]) byClass[classId] = [];
      byClass[classId].push(studentId);
    }
    for (const [classId, studentIds] of Object.entries(byClass)) {
      const { error: assignErr } = await supabase.from('students')
        .update({ class_id: classId }).in('id', studentIds).eq('school_id', schoolId);
      if (assignErr) { res.status(safeDbErrorStatus(assignErr)).json({ error: safeDbErrorMessage(assignErr) }); return; }
    }
  }

  // 3. Advance the school's current_academic_year column. Migration 042
  //    made this authoritative: resolveCurrentAcademicYear consults it
  //    first and falls back to the Sep boundary only when it's NULL or
  //    malformed. So flipping the year here actually changes which year
  //    new grades / reports / enrollment rows get stamped with.
  const { error: yearErr } = await supabase.from('schools')
    .update({ current_academic_year: newAcademicYear }).eq('id', schoolId);
  if (yearErr) { res.status(safeDbErrorStatus(yearErr)).json({ error: safeDbErrorMessage(yearErr) }); return; }

  res.json({ graduated: studentIdsToGraduate.length, assigned: classAssignments.length, newAcademicYear });
}

// ---- PASSWORD RESET (ADMIN) ----
export async function getResetRequests(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { data, error } = await supabase.from('password_reset_requests')
    .select('*').eq('school_id', schoolId).eq('status', 'pending')
    .order('requested_at', { ascending: false });
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json(toCC(data));
}

export async function resetUserPassword(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { userId } = req.params;
  const { newPassword } = req.body;
  if (!isStrongPassword(newPassword)) {
    res.status(400).json({ error: PASSWORD_POLICY_MESSAGE }); return;
  }
  const { data: user } = await supabase.from('users').select('id').eq('id', userId).eq('school_id', schoolId).single();
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }
  const rounds = parseInt(process.env.BCRYPT_ROUNDS || '10');
  const hash = await bcrypt.hash(newPassword, rounds);
  // Force change on next login: the admin typed a password they had to
  // communicate to the user, so it's effectively a "default" credential
  // until the user picks their own. Same reasoning as the create flows.
  const { error } = await supabase.from('users').update({ password_hash: hash, password_changed_at: new Date().toISOString(), must_change_password: true }).eq('id', userId).eq('school_id', schoolId);
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  await supabase.from('password_reset_requests').update({ status: 'resolved' })
    .eq('user_id', userId).eq('school_id', schoolId).eq('status', 'pending');
  notify({ schoolId, userId: userId as string, title: 'Password Reset', message: 'Your password has been reset by the school administrator. Please log in with your new credentials.', type: 'system' }).catch(() => {});
  res.json({ message: 'Password reset successfully' });
}

// Search inactive (is_active = false) users by name + role for the
// "returning teacher / driver / parent" prompt on the create-staff form.
// Returns a small candidate list so the admin can pick one to reactivate.
export async function searchInactiveUsers(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const name = String(req.query.name ?? '').trim();
  const role = String(req.query.role ?? '').trim();
  if (name.length < 2 || !role) { res.json([]); return; }
  if (!['teacher', 'driver', 'parent', 'supervisor', 'reception', 'accountant', 'admin'].includes(role)) {
    res.status(400).json({ error: 'Invalid role' }); return;
  }

  // SECURITY (I-3): the `name` string is interpolated into a PostgREST
  // `.or()` filter. Special characters (`,`, `(`, `)`, `*`) could perturb
  // the OR-clause parse. Escape LIKE wildcards (`%`, `_`) too. The other
  // filters (school_id, role, is_active) are AND-combined and can't be
  // escaped from, so the worst case is a name that fails to match — not a
  // tenant break — but we tighten this anyway.
  if (/[,()*\\]/.test(name)) { res.json([]); return; }
  const safeName = name.replace(/[%_]/g, '\\$&');
  const { data, error } = await supabase
    .from('users')
    .select('id, first_name, last_name, username, role, is_active')
    .eq('school_id', schoolId)
    .eq('role', role)
    .eq('is_active', false)
    .or(`first_name.ilike.%${safeName}%,last_name.ilike.%${safeName}%,username.ilike.%${safeName}%`)
    .limit(8);
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json(toCC(data ?? []));
}

// Reactivate a previously deactivated user (returning teacher/driver/parent etc).
// Flips is_active = true and bumps password_changed_at so existing tokens are
// invalidated. Caller may pass `newPassword` to set fresh credentials at the
// same time; otherwise a separate reset must follow.
export async function reactivateUser(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { userId } = req.params;
  const { newPassword } = req.body as { newPassword?: string };

  const { data: user } = await supabase
    .from('users')
    .select('id, username, first_name, last_name, role, is_active')
    .eq('id', userId).eq('school_id', schoolId).single();
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }
  if (user.is_active) { res.status(409).json({ error: 'User is already active' }); return; }

  const updates: Record<string, unknown> = {
    is_active: true,
    password_changed_at: new Date().toISOString(),
  };
  if (newPassword) {
    if (!isStrongPassword(newPassword)) { res.status(400).json({ error: PASSWORD_POLICY_MESSAGE }); return; }
    const rounds = parseInt(process.env.BCRYPT_ROUNDS || '10');
    updates.password_hash = await bcrypt.hash(newPassword, rounds);
  }

  const { error } = await supabase.from('users').update(updates).eq('id', userId).eq('school_id', schoolId);
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json({
    message: 'User reactivated',
    username: user.username,
    fullName: `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim(),
    role: user.role,
    passwordReset: !!newPassword,
  });
}

// ---- SCHOOL SETTINGS ----
export async function getSettings(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { data, error } = await supabase.from('schools')
    .select('current_academic_year, timezone, chat_restrictions, mfa_required')
    .eq('id', schoolId).single();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json(toCC(data));
}

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/;

function isValidTimezone(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; }
  catch { return false; }
}

// Normalize/validate the chat_restrictions payload. Returns null if malformed
// so we never persist garbage that the enforcement helper would choke on.
function sanitizeChatRestrictions(raw: any): { enabled: boolean; days?: Record<string, any> } | null {
  if (!raw || typeof raw !== 'object') return null;
  const out: { enabled: boolean; days: Record<string, any> } = { enabled: raw.enabled === true, days: {} };
  const days = raw.days && typeof raw.days === 'object' ? raw.days : {};
  for (const key of DAY_KEYS) {
    const d = days[key];
    if (!d || typeof d !== 'object') { out.days[key] = { enabled: false }; continue; }
    if (d.enabled !== true) { out.days[key] = { enabled: false }; continue; }
    const open = String(d.open ?? '');
    const close = String(d.close ?? '');
    if (!HHMM.test(open) || !HHMM.test(close)) return null;
    const [oh, om] = open.split(':').map(Number);
    const [ch, cm] = close.split(':').map(Number);
    if (ch * 60 + cm <= oh * 60 + om) return null; // close must be after open
    out.days[key] = { enabled: true, open, close };
  }
  return out;
}

export async function updateSettings(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { currentAcademicYear, timezone, chatRestrictions, mfaRequired } = req.body;

  const patch: Record<string, unknown> = {};

  if (currentAcademicYear !== undefined) patch.current_academic_year = currentAcademicYear;

  if (timezone !== undefined) {
    if (typeof timezone !== 'string' || !isValidTimezone(timezone)) {
      res.status(400).json({ error: 'Invalid timezone' }); return;
    }
    patch.timezone = timezone;
  }

  if (chatRestrictions !== undefined) {
    const clean = sanitizeChatRestrictions(chatRestrictions);
    if (!clean) {
      res.status(400).json({ error: 'Invalid chat schedule: each enabled day needs valid open/close times (close after open).' });
      return;
    }
    patch.chat_restrictions = clean;
  }

  if (mfaRequired !== undefined) {
    patch.mfa_required = !!mfaRequired;
  }

  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: 'Nothing to update' }); return;
  }

  const { data, error } = await supabase.from('schools')
    .update(patch)
    .eq('id', schoolId)
    .select('current_academic_year, timezone, chat_restrictions, mfa_required').single();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json(toCC(data));
}

// ---- SCHOOL LOGO (admin upload). Used in sidebar + tuition receipts. ----
export async function uploadSchoolLogo(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const file = (req as any).file;
  if (!file) { res.status(400).json({ error: 'No file uploaded' }); return; }

  const ext = safeExt(file.originalname, '.png');
  const storagePath = `school-logos/${schoolId}${ext}`;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'homework-attachments';

  const { data: uploadData, error: uploadErr } = await supabase.storage
    .from(bucket)
    .upload(storagePath, file.buffer, { contentType: file.mimetype, upsert: true });
  if (uploadErr || !uploadData) { res.status(500).json({ error: 'Upload failed' }); return; }

  const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(uploadData.path);
  const logoUrl = `${urlData.publicUrl}?v=${Date.now()}`; // bust cache when re-uploaded

  await supabase.from('schools').update({ logo_url: logoUrl }).eq('id', schoolId);
  res.json({ logoUrl });
}

// ---- CREDENTIALS PDF ----
// Printable PDF for handing out username + default password to users.
// Filters: role=teacher | driver | parent (+ optional classId for parents,
// or parentId for a single parent slip).
//
// Defaults match the createTeacher / createDriver / parent auto-create flows:
//   parent  → Parent@123
//   teacher → Teacher@123
//   driver  → Driver@123
// Note: bcrypt hashes can't be reversed, so the PDF prints the role default.
// Users who have changed their password will need to use that new one instead.
export async function exportCredentialsPdf(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { role, classId, parentId } = req.query as Record<string, string | undefined>;

  if (!role || !['parent', 'teacher', 'driver'].includes(role)) {
    res.status(400).json({ error: 'role must be parent, teacher, or driver' });
    return;
  }

  const { data: schoolData } = await supabase
    .from('schools').select('name').eq('id', schoolId).single();
  const schoolName = schoolData?.name || 'School';

  const entries: CredentialEntry[] = [];
  let title = '';

  if (role === 'teacher') {
    const { data, error } = await supabase
      .from('teachers')
      .select('full_name, users!inner(username, is_active)')
      .eq('school_id', schoolId)
      .order('full_name');
    if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
    for (const t of (data || []) as any[]) {
      if (t.users?.is_active === false) continue;
      entries.push({
        fullName: t.full_name,
        role: 'teacher',
        username: t.users?.username || '',
        password: 'Teacher@123',
      });
    }
    title = 'Teacher Login Credentials';
  } else if (role === 'driver') {
    const { data, error } = await supabase
      .from('drivers')
      .select('full_name, users!inner(username, is_active)')
      .eq('school_id', schoolId)
      .order('full_name');
    if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
    for (const d of (data || []) as any[]) {
      if (d.users?.is_active === false) continue;
      entries.push({
        fullName: d.full_name,
        role: 'driver',
        username: d.users?.username || '',
        password: 'Driver@123',
      });
    }
    title = 'Driver Login Credentials';
  } else {
    // parent
    if (parentId) {
      const { data, error } = await supabase
        .from('parents')
        .select('id, full_name, users!inner(username, is_active), students(full_name, classes(name))')
        .eq('school_id', schoolId)
        .eq('id', parentId)
        .single();
      if (error || !data) { res.status(404).json({ error: 'Parent not found' }); return; }
      const p: any = data;
      entries.push({
        fullName: p.full_name,
        role: 'parent',
        username: p.users?.username || '',
        password: 'Parent@123',
        children: (p.students || []).map((s: any) => ({
          name: s.full_name,
          className: s.classes?.name ?? null,
        })),
      });
      title = `Login Credentials — ${p.full_name}`;
    } else if (classId) {
      // Parents of students in this class
      const { data: classData } = await supabase
        .from('classes').select('name').eq('id', classId).eq('school_id', schoolId).single();
      const className = classData?.name || 'Class';

      const { data, error } = await supabase
        .from('students')
        .select('full_name, parents!inner(id, full_name, users!inner(username, is_active)), classes(name)')
        .eq('school_id', schoolId)
        .eq('class_id', classId)
        .eq('is_graduated', false);
      if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

      // Group by parent so a parent with multiple children in the same class shows once
      const byParent = new Map<string, CredentialEntry>();
      for (const s of (data || []) as any[]) {
        const p = s.parents;
        if (!p || p.users?.is_active === false) continue;
        const existing = byParent.get(p.id);
        if (existing) {
          existing.children!.push({ name: s.full_name, className: s.classes?.name ?? null });
        } else {
          byParent.set(p.id, {
            fullName: p.full_name,
            role: 'parent',
            username: p.users?.username || '',
            password: 'Parent@123',
            children: [{ name: s.full_name, className: s.classes?.name ?? null }],
          });
        }
      }
      entries.push(...Array.from(byParent.values()).sort((a, b) => a.fullName.localeCompare(b.fullName)));
      title = `Parent Login Credentials — ${className}`;
    } else {
      // All parents
      const { data, error } = await supabase
        .from('parents')
        .select('id, full_name, users!inner(username, is_active), students(full_name, classes(name))')
        .eq('school_id', schoolId)
        .order('full_name');
      if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
      for (const p of (data || []) as any[]) {
        if (p.users?.is_active === false) continue;
        entries.push({
          fullName: p.full_name,
          role: 'parent',
          username: p.users?.username || '',
          password: 'Parent@123',
          children: (p.students || []).map((s: any) => ({
            name: s.full_name,
            className: s.classes?.name ?? null,
          })),
        });
      }
      title = 'Parent Login Credentials';
    }
  }

  const safeName = schoolName.replace(/[^a-z0-9-_]+/gi, '_');
  const datePart = new Date().toISOString().split('T')[0];
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="credentials-${role}-${safeName}-${datePart}.pdf"`);
  streamCredentialsPdf(schoolName, title, entries, res);
}

// ---- ALL ACCOUNTS ----
export async function getAccounts(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { data, error } = await supabase
    .from('users')
    .select('id, first_name, last_name, username, email, phone, role, is_active, created_at, address, hire_date, national_id, date_of_birth, marital_status, gender, employment_type, qualifications, notes, emergency_contact, official_photo')
    .eq('school_id', schoolId)
    .order('role')
    .order('first_name');
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json(toCC(data));
}

export async function updateAccount(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { userId } = req.params;
  const { firstName, lastName, email, phone, username, isActive } = req.body;

  if (username) {
    const { data: existing } = await supabase
      .from('users').select('id').eq('school_id', schoolId).eq('username', username).neq('id', userId).single();
    if (existing) { res.status(409).json({ error: `Username "${username}" is already taken.` }); return; }
  }

  const updateFields: Record<string, unknown> = { ...hrColumns(req.body, { includeEmergency: true }) };
  if (firstName !== undefined) updateFields.first_name = firstName;
  if (lastName !== undefined) updateFields.last_name = lastName;
  if (email !== undefined) updateFields.email = email || null;
  if (phone !== undefined) updateFields.phone = phone || null;
  if (username !== undefined) updateFields.username = username;
  if (isActive !== undefined) updateFields.is_active = isActive;

  const { data: user, error } = await supabase
    .from('users').update(updateFields).eq('id', userId).eq('school_id', schoolId)
    // Explicit projection — bare `.select()` here previously echoed
    // `password_hash` back to the admin caller (M-10 in the pen test).
    .select('id, school_id, username, email, phone, role, first_name, last_name, profile_picture, is_active, created_at, password_changed_at').single();
  if (error) {
    const isDupe = error.code === '23505' || /unique|duplicate/i.test(error.message || '');
    res.status(isDupe ? 409 : safeDbErrorStatus(error)).json({
      error: isDupe ? 'Username is already taken.' : safeDbErrorMessage(error),
    });
    return;
  }

  // Sync full_name in the role-specific profile table
  if (firstName !== undefined || lastName !== undefined) {
    const fn = (firstName ?? user.first_name ?? '').trim();
    const ln = (lastName ?? user.last_name ?? '').trim();
    const fullName = `${fn} ${ln}`.trim();
    if (user.role === 'teacher') await supabase.from('teachers').update({ full_name: fullName }).eq('user_id', userId).eq('school_id', schoolId);
    else if (user.role === 'driver') await supabase.from('drivers').update({ full_name: fullName }).eq('user_id', userId).eq('school_id', schoolId);
    else if (user.role === 'parent') await supabase.from('parents').update({ full_name: fullName }).eq('user_id', userId).eq('school_id', schoolId);
  }

  // Admin-trusted phone propagation (migration 050). This is the
  // universal post-create phone edit path — used by /admin/accounts/:id
  // for every role, and is the ONLY admin path for bare roles
  // (admin / supervisor / reception / accountant) since they don't
  // have a role-specific table. Also mirror the canonical form back
  // to the role-table phone_number for parent/teacher/driver so the
  // role-specific edit pages don't drift.
  if (phone !== undefined) {
    await propagateAdminSetPhone(String(userId), phone);
    const roleTableByRole: Record<string, string> = {
      parent: 'parents', teacher: 'teachers', driver: 'drivers',
    };
    const roleTable = roleTableByRole[user.role as string];
    if (roleTable) {
      await supabase
        .from(roleTable)
        .update({ phone_number: phone || null })
        .eq('user_id', userId).eq('school_id', schoolId);
    }
  }

  res.json(toCC(user));
}

export async function deleteAccount(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const userId = String(req.params.userId);

  const { data: user, error: findErr } = await supabase
    .from('users')
    .select('id, role, username, email, first_name, last_name, phone, profile_picture, is_active, password_changed_at, created_at, address, hire_date, national_id, date_of_birth, marital_status, gender, employment_type, qualifications, notes, emergency_contact, official_photo')
    .eq('id', userId).eq('school_id', schoolId).single();
  if (findErr || !user) { res.status(404).json({ error: 'Account not found' }); return; }

  const ARCHIVABLE_ACCOUNT_ROLES = ['teacher', 'supervisor', 'admin', 'reception', 'accountant'];
  if (!ARCHIVABLE_ACCOUNT_ROLES.includes(user.role)) {
    res.status(400).json({ error: `Use the dedicated delete endpoint for role "${user.role}"` }); return;
  }

  // Safety guards for admin accounts: never let the operator archive their
  // own login, and never remove the school's last active admin (that would
  // lock the school out of its own admin portal).
  if (user.role === 'admin') {
    if (String(req.user!.userId) === userId) {
      res.status(400).json({ error: "You can't archive your own admin account." }); return;
    }
    const { count } = await supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('school_id', schoolId).eq('role', 'admin').eq('is_active', true);
    if ((count ?? 0) <= 1) {
      res.status(400).json({ error: 'This is the last active admin. Add another admin before archiving this one.' }); return;
    }
  }

  const archiveOn = await hasArchiveFeature(schoolId);
  const reason = normalizeArchiveReason(req.body?.reason);
  const departureDate = (req.body?.departureDate as string | undefined) || new Date().toISOString().split('T')[0];
  const account: Record<string, unknown> = {
    id: user.id, username: user.username, email: user.email, role: user.role,
    firstName: user.first_name, lastName: user.last_name, phone: user.phone,
    profilePicture: user.profile_picture, isActive: user.is_active,
    passwordChangedAt: user.password_changed_at, createdAt: user.created_at,
    // HR snapshot (migration 024) — kept forever for contracts / employee
    // profile. For teachers the authoritative HR row is the teachers table,
    // overridden in that branch below; for bare roles it's the users row.
    hr: hrSnapshot(user),
  };
  const fullName = `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() || (user.username as string);

  if (user.role === 'teacher') {
    const { data: teacher } = await supabase
      .from('teachers')
      .select('id, full_name, phone_number, subject, emergency_contact, profile_picture, created_at, address, hire_date, national_id, date_of_birth, marital_status, gender, employment_type, qualifications, notes, official_photo')
      .eq('user_id', userId).eq('school_id', schoolId).single();
    if (teacher) {
      // Preserve authored content (orphan, don't destroy).
      await supabase.from('homework').update({ teacher_id: null } as any).eq('teacher_id', teacher.id).eq('school_id', schoolId);
      await supabase.from('assignments').update({ teacher_id: null } as any).eq('teacher_id', teacher.id).eq('school_id', schoolId);
      await supabase.from('grades').update({ teacher_id: null } as any).eq('teacher_id', teacher.id).eq('school_id', schoolId);
      await supabase.from('reports').update({ teacher_id: null } as any).eq('teacher_id', teacher.id).eq('school_id', schoolId);
      await supabase.from('weekly_summaries').delete().eq('teacher_id', teacher.id).eq('school_id', schoolId);
      await supabase.from('subjects').update({ teacher_id: null }).eq('teacher_id', teacher.id).eq('school_id', schoolId);

      if (archiveOn) {
        const teaching = await buildTeacherTeachingSnapshot(teacher.id, schoolId);
        // Teacher HR lives on the teachers row — override the user-derived snapshot.
        const teacherAccount = { ...account, hr: hrSnapshot(teacher) };
        const r = await performEmployeeArchive({
          schoolId, userId, originalEmployeeId: teacher.id, role: 'teacher',
          fullName: teacher.full_name || fullName, phoneNumber: teacher.phone_number,
          subject: teacher.subject, emergencyContact: teacher.emergency_contact,
          dateOfBirth: (teacher.date_of_birth as string | null) ?? null,
          profilePicture: teacher.profile_picture ?? (user.profile_picture as string | null),
          hireDate: (teacher.hire_date as string | null) ?? (teacher.created_at ? String(teacher.created_at).split('T')[0] : null),
          departureDate, reason, account: teacherAccount, teaching,
          actorId: req.user!.userId, actorName: req.user!.username, actorRole: req.user!.role,
        });
        if (!r.ok) { res.status(500).json({ error: r.error }); return; }
        await rewriteOwnershipToArchive(schoolId, 'teachers', String(teacher.id), r.archiveId);
        await logAudit({ req, entityType: 'teacher', entityId: String(teacher.id), action: 'delete', before: teacher as Record<string, unknown>, label: teacher.full_name, reason: `Archived (${reason})` });
        res.json({ message: 'Account archived', archived: true, archiveId: r.archiveId });
        return;
      }
      await supabase.from('teachers').delete().eq('id', teacher.id).eq('school_id', schoolId);
    }
  } else if (archiveOn) {
    // Supervisor / admin / reception / accountant — no profile table; the
    // snapshot is the users row. (Authored artifacts have no owner column.)
    const bareRole = user.role as 'supervisor' | 'admin' | 'reception' | 'accountant';
    const r = await performEmployeeArchive({
      schoolId, userId, originalEmployeeId: user.id, role: bareRole,
      fullName, email: user.email as string | null, phoneNumber: user.phone as string | null,
      emergencyContact: (user.emergency_contact as string | null) ?? null,
      dateOfBirth: (user.date_of_birth as string | null) ?? null,
      profilePicture: user.profile_picture as string | null,
      hireDate: (user.hire_date as string | null) ?? (user.created_at ? String(user.created_at).split('T')[0] : null),
      departureDate, reason, account,
      actorId: req.user!.userId, actorName: req.user!.username, actorRole: req.user!.role,
    });
    if (!r.ok) { res.status(500).json({ error: r.error }); return; }
    await rewriteOwnershipToArchive(schoolId, 'users', String(user.id), r.archiveId);
    await logAudit({ req, entityType: bareRole, entityId: String(user.id), action: 'delete', before: account, label: fullName, reason: `Archived (${reason})` });
    res.json({ message: 'Account archived', archived: true, archiveId: r.archiveId });
    return;
  }

  // Archive feature off (or teacher row missing) — hard delete.
  const { error: delErr } = await supabase.from('users').delete().eq('id', userId);
  if (delErr) { res.status(safeDbErrorStatus(delErr)).json({ error: safeDbErrorMessage(delErr) }); return; }
  await logAudit({ req, entityType: user.role as 'teacher' | 'supervisor' | 'admin' | 'reception' | 'accountant', entityId: String(userId), action: 'delete', before: account, label: fullName, reason: 'Deleted (no archive)' });
  res.json({ message: 'Account deleted' });
}

// Admin-uploaded professional photo (migration 024). Distinct from the
// self-set app avatar (users.profile_picture, set via /auth/profile-picture):
// this writes `official_photo` and never overrides what the employee chose
// for themselves. `:id` is the profile-table id for teacher/driver/staff, or
// the users id for the bare roles (supervisor/admin/reception/accountant).
const EMPLOYEE_PHOTO_TABLE: Record<string, string> = {
  teacher: 'teachers',
  driver: 'drivers',
  staff: 'staff_members',
  supervisor: 'users',
  admin: 'users',
  reception: 'users',
  accountant: 'users',
};

export async function uploadEmployeePhoto(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const role = String(req.params.role);
  const id = String(req.params.id);
  const table = EMPLOYEE_PHOTO_TABLE[role];
  if (!table) { res.status(400).json({ error: 'Unknown employee role' }); return; }

  const file = (req as any).file;
  if (!file) { res.status(400).json({ error: 'No file uploaded' }); return; }

  const ext = safeExt(file.originalname, '.jpg');
  const storagePath = `employee-photos/${schoolId}/${role}-${id}${ext}`;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'homework-attachments';

  const { data: uploadData, error: uploadErr } = await supabase.storage
    .from(bucket)
    .upload(storagePath, file.buffer, { contentType: file.mimetype, upsert: true });
  if (uploadErr || !uploadData) { res.status(500).json({ error: 'Upload failed' }); return; }

  const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(uploadData.path);
  const officialPhoto = urlData.publicUrl;

  // school-scoped update; if no row matches (wrong tenant / id) → 404.
  const { data: updated, error: updErr } = await supabase
    .from(table)
    .update({ official_photo: officialPhoto })
    .eq('id', id).eq('school_id', schoolId)
    .select('id').maybeSingle();
  if (updErr) { res.status(safeDbErrorStatus(updErr)).json({ error: safeDbErrorMessage(updErr) }); return; }
  if (!updated) { res.status(404).json({ error: 'Employee not found' }); return; }

  res.json({ officialPhoto });
}

// ---- HR OFFICER PROMOTE / DEMOTE (Wave 2) ----
// Only admins can carry the HR-officer flag. Promoting elevates a colleague
// to read decrypted PII + manage high-sensitivity documents. We notify
// every OTHER admin of the school on promote/demote so the change is
// transparent — flipping the flag silently would invite abuse.

export async function promoteHrOfficer(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId: actorId, username: actorName } = req.user!;
  const targetId = String(req.params.userId);

  if (targetId === actorId) {
    res.status(400).json({ error: "You can't promote yourself — ask another admin." });
    return;
  }

  const { data: target } = await supabase
    .from('users')
    .select('id, role, first_name, last_name, username, is_active, is_hr_officer')
    .eq('id', targetId).eq('school_id', schoolId).maybeSingle();
  if (!target) { res.status(404).json({ error: 'User not found' }); return; }
  if (target.role !== 'admin') { res.status(400).json({ error: 'Only admins can be HR officers' }); return; }
  if (target.is_active === false) { res.status(400).json({ error: 'User is inactive' }); return; }
  if (target.is_hr_officer === true) {
    res.json({ user: toCC(target), changed: false });
    return;
  }

  const { error } = await supabase
    .from('users').update({ is_hr_officer: true })
    .eq('id', targetId).eq('school_id', schoolId);
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  await logAudit({
    req, entityType: 'hr_officer', entityId: targetId,
    action: 'create',
    after: { _meta: { kind: 'hr_officer_promote', target_username: target.username } },
    label: 'hr_officer_promote',
  });

  // Notify every other admin of the school.
  const { data: peers } = await supabase
    .from('users').select('id').eq('school_id', schoolId).eq('role', 'admin').eq('is_active', true);
  const peerIds = (peers ?? []).map(p => p.id).filter(id => id !== actorId && id !== targetId);
  const targetName = `${target.first_name ?? ''} ${target.last_name ?? ''}`.trim() || target.username;
  await Promise.all(peerIds.map(pid => notify({
    schoolId, userId: pid,
    title: 'HR officer promoted',
    message: `${actorName} promoted ${targetName} to HR officer.`,
    type: 'hr_officer_promoted',
    relatedId: targetId,
  })));

  res.json({ ok: true, userId: targetId, changed: true });
}

export async function demoteHrOfficer(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId: actorId, username: actorName } = req.user!;
  const targetId = String(req.params.userId);

  const { data: target } = await supabase
    .from('users')
    .select('id, role, first_name, last_name, username, is_hr_officer')
    .eq('id', targetId).eq('school_id', schoolId).maybeSingle();
  if (!target) { res.status(404).json({ error: 'User not found' }); return; }
  if (target.is_hr_officer !== true) {
    res.json({ user: toCC(target), changed: false });
    return;
  }

  const { error } = await supabase
    .from('users').update({ is_hr_officer: false })
    .eq('id', targetId).eq('school_id', schoolId);
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  await logAudit({
    req, entityType: 'hr_officer', entityId: targetId,
    action: 'delete',
    before: { _meta: { kind: 'hr_officer_demote', target_username: target.username } },
    label: 'hr_officer_demote',
  });

  const { data: peers } = await supabase
    .from('users').select('id').eq('school_id', schoolId).eq('role', 'admin').eq('is_active', true);
  const peerIds = (peers ?? []).map(p => p.id).filter(id => id !== actorId);
  const targetName = `${target.first_name ?? ''} ${target.last_name ?? ''}`.trim() || target.username;
  await Promise.all(peerIds.map(pid => notify({
    schoolId, userId: pid,
    title: 'HR officer revoked',
    message: `${actorName} revoked HR officer access from ${targetName}.`,
    type: 'hr_officer_demoted',
    relatedId: targetId,
  })));

  res.json({ ok: true, userId: targetId, changed: true });
}

// Lightweight read for the admin user-management page: which admins are
// HR officers right now? Returns minimal columns — the full users list
// already has the rest.
export async function listHrOfficers(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { data, error } = await supabase
    .from('users')
    .select('id, username, first_name, last_name, is_active')
    .eq('school_id', schoolId).eq('role', 'admin').eq('is_hr_officer', true)
    .order('first_name', { ascending: true });
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json({ officers: toCC(data) });
}

export async function getParents(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { data, error } = await supabase
    .from('parents')
    .select('id, full_name, phone_number, email, user_id, users(username), students(id, full_name)')
    .eq('school_id', schoolId)
    .order('full_name');
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json(toCC(data));
}

export async function getParentProfile(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;

  const [parentRes, appointmentsRes] = await Promise.all([
    supabase.from('parents')
      .select('id, full_name, phone_number, email, residence_type, block_number, user_id, users(id, username, first_name, last_name, is_active), students(id, full_name, classes(name))')
      .eq('id', id).eq('school_id', schoolId).single(),
    supabase.from('appointments')
      .select('id, reason, message, requested_date, scheduled_date, status, created_at, response_message')
      .eq('parent_id', id).eq('school_id', schoolId)
      .order('created_at', { ascending: false }),
  ]);

  if (parentRes.error || !parentRes.data) {
    res.status(404).json({ error: 'Parent not found' }); return;
  }
  res.json({ parent: toCC(parentRes.data), appointments: toCC(appointmentsRes.data) || [] });
}

export async function deleteParent(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  const { data: parent } = await supabase
    .from('parents')
    .select('id, user_id')
    .eq('id', id)
    .eq('school_id', schoolId)
    .single();
  if (!parent) { res.status(404).json({ error: 'Parent not found' }); return; }
  // Deleting the user cascades to the parent record; students.parent_id becomes NULL via ON DELETE SET NULL
  const { error } = await supabase.from('users').delete().eq('id', parent.user_id);
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json({ message: 'Parent account deleted' });
}

export async function updateParent(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  const { residenceType, blockNumber } = req.body;
  const update: Record<string, unknown> = {};
  if (residenceType !== undefined) update.residence_type = residenceType || null;
  if (blockNumber !== undefined) update.block_number = blockNumber || null;
  if (Object.keys(update).length === 0) { res.status(400).json({ error: 'Nothing to update' }); return; }
  const { error } = await supabase.from('parents').update(update).eq('id', id).eq('school_id', schoolId);
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json({ success: true });
}

// ---- SCHEDULE ----
// Day-of-week is 0=Sunday..6=Saturday (matches JS Date.getDay()).
const VALID_DAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];

async function readScheduleConfig(schoolId: string) {
  const { data } = await supabase
    .from('schools')
    .select('periods_per_day, schedule_days')
    .eq('id', schoolId)
    .single();
  return {
    periodsPerDay: (data?.periods_per_day as number | null) ?? 6,
    scheduleDays: (data?.schedule_days as string[] | null) ?? ['sunday','monday','tuesday','wednesday','thursday'],
  };
}

// Admin: full grid — config + every cell + every teacher + every class.
export async function getAdminSchedule(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const config = await readScheduleConfig(schoolId);

  const [{ data: teachers, error: tErr }, { data: classes, error: cErr }, { data: cells, error: aErr }] = await Promise.all([
    supabase.from('teachers').select('id, full_name, subject').eq('school_id', schoolId).order('full_name'),
    supabase.from('classes').select('id, name, grade_level').eq('school_id', schoolId).order('name'),
    supabase.from('schedule_assignments').select('id, teacher_id, class_id, day_of_week, period_index').eq('school_id', schoolId),
  ]);
  if (tErr || cErr || aErr) {
    res.status(500).json({ error: tErr?.message || cErr?.message || aErr?.message }); return;
  }

  res.json({
    ...config,
    teachers: toCC(teachers),
    classes: toCC(classes),
    assignments: toCC(cells),
  });
}

export async function updateScheduleConfig(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { periodsPerDay, scheduleDays } = req.body as { periodsPerDay?: number; scheduleDays?: string[] };

  const update: Record<string, unknown> = {};
  if (typeof periodsPerDay === 'number') {
    if (!Number.isInteger(periodsPerDay) || periodsPerDay < 1 || periodsPerDay > 20) {
      res.status(400).json({ error: 'periodsPerDay must be an integer between 1 and 20' }); return;
    }
    update.periods_per_day = periodsPerDay;
  }
  if (Array.isArray(scheduleDays)) {
    const cleaned = scheduleDays.map(d => String(d).toLowerCase()).filter(d => VALID_DAYS.includes(d));
    if (cleaned.length === 0) {
      res.status(400).json({ error: 'scheduleDays must include at least one valid day' }); return;
    }
    update.schedule_days = cleaned;
  }
  if (Object.keys(update).length === 0) { res.json({ success: true }); return; }

  // If periodsPerDay shrinks, drop assignments past the new max.
  if (typeof update.periods_per_day === 'number') {
    await supabase
      .from('schedule_assignments')
      .delete()
      .eq('school_id', schoolId)
      .gt('period_index', update.periods_per_day as number);
  }

  const { error } = await supabase.from('schools').update(update).eq('id', schoolId);
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json({ ...await readScheduleConfig(schoolId) });
}

// Upsert (or clear) a single cell. classId=null clears the cell.
export async function setScheduleCell(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { teacherId, dayOfWeek, periodIndex, classId } = req.body as {
    teacherId?: string; dayOfWeek?: number; periodIndex?: number; classId?: string | null;
  };

  if (!teacherId || typeof dayOfWeek !== 'number' || typeof periodIndex !== 'number') {
    res.status(400).json({ error: 'teacherId, dayOfWeek, and periodIndex are required' }); return;
  }
  if (dayOfWeek < 0 || dayOfWeek > 6 || periodIndex < 1) {
    res.status(400).json({ error: 'Invalid dayOfWeek or periodIndex' }); return;
  }

  // Confirm scope: teacher must belong to this school.
  const { data: teacher } = await supabase
    .from('teachers').select('id').eq('id', teacherId).eq('school_id', schoolId).single();
  if (!teacher) { res.status(404).json({ error: 'Teacher not found' }); return; }

  // Clear: remove the cell for (teacher, day, period).
  if (!classId) {
    const { error } = await supabase
      .from('schedule_assignments')
      .delete()
      .eq('school_id', schoolId)
      .eq('teacher_id', teacherId)
      .eq('day_of_week', dayOfWeek)
      .eq('period_index', periodIndex);
    if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
    res.json({ success: true, cleared: true });
    return;
  }

  // Confirm class belongs to this school.
  const { data: cls } = await supabase
    .from('classes').select('id').eq('id', classId).eq('school_id', schoolId).single();
  if (!cls) { res.status(404).json({ error: 'Class not found' }); return; }

  // Conflict: another teacher already owns (class, day, period).
  const { data: classConflict } = await supabase
    .from('schedule_assignments')
    .select('id, teacher_id, teachers(full_name)')
    .eq('school_id', schoolId)
    .eq('class_id', classId)
    .eq('day_of_week', dayOfWeek)
    .eq('period_index', periodIndex)
    .neq('teacher_id', teacherId)
    .maybeSingle();
  if (classConflict) {
    const otherName = (classConflict as { teachers?: { full_name?: string } }).teachers?.full_name ?? 'another teacher';
    res.status(409).json({ error: `That class is already assigned to ${otherName} at this period.` });
    return;
  }

  // Upsert by (teacher, day, period). Delete existing then insert — safer than relying on
  // ON CONFLICT with two unique constraints.
  await supabase
    .from('schedule_assignments')
    .delete()
    .eq('school_id', schoolId)
    .eq('teacher_id', teacherId)
    .eq('day_of_week', dayOfWeek)
    .eq('period_index', periodIndex);

  const { data, error } = await supabase
    .from('schedule_assignments')
    .insert({
      school_id: schoolId,
      teacher_id: teacherId,
      class_id: classId,
      day_of_week: dayOfWeek,
      period_index: periodIndex,
    })
    .select('id, teacher_id, class_id, day_of_week, period_index')
    .single();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json({ success: true, assignment: toCC(data) });
}

// Teacher: own grid only.
export async function getTeacherSchedule(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const config = await readScheduleConfig(schoolId);

  // Resolve teacher row from user id.
  const { data: teacher } = await supabase
    .from('teachers').select('id, subject').eq('user_id', userId).eq('school_id', schoolId).single();
  if (!teacher) { res.json({ ...config, assignments: [] }); return; }

  const { data, error } = await supabase
    .from('schedule_assignments')
    .select('id, day_of_week, period_index, classes(id, name)')
    .eq('school_id', schoolId)
    .eq('teacher_id', teacher.id);
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  res.json({ ...config, assignments: toCC(data) });
}

// Parent: schedule for a specific child's class — cells carry teacher name + subject.
export async function getParentSchedule(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { studentId } = req.query as Record<string, string>;
  if (!studentId) { res.status(400).json({ error: 'studentId is required' }); return; }

  // Confirm the student belongs to this parent (and this school).
  const { data: parent } = await supabase
    .from('parents').select('id').eq('user_id', userId).eq('school_id', schoolId).single();
  if (!parent) { res.status(404).json({ error: 'Parent not found' }); return; }

  const { data: student } = await supabase
    .from('students').select('id, class_id').eq('id', studentId).eq('parent_id', parent.id).eq('school_id', schoolId).single();
  if (!student || !student.class_id) {
    res.json({ ...await readScheduleConfig(schoolId), assignments: [] });
    return;
  }

  const config = await readScheduleConfig(schoolId);
  const { data, error } = await supabase
    .from('schedule_assignments')
    .select('id, teacher_id, day_of_week, period_index, teachers(id, full_name, subject)')
    .eq('school_id', schoolId)
    .eq('class_id', student.class_id);
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  // `teachers.subject` is the comma-joined list of every subject the teacher teaches
  // across ALL classes. For a parent looking at one child's class we want only the
  // subject(s) that teacher teaches to THIS class, so resolve from class_subject_teachers
  // (the curriculum source of truth). Fall back to teachers.subject when the school has
  // no curriculum rows for the pair yet, so unconfigured schools aren't left blank.
  const { data: cst } = await supabase
    .from('class_subject_teachers')
    .select('teacher_id, subjects(name)')
    .eq('school_id', schoolId)
    .eq('class_id', student.class_id);

  const subjectsByTeacher = new Map<string, string[]>();
  for (const row of (cst || []) as Array<{ teacher_id: string; subjects?: { name?: string } | null }>) {
    const name = row.subjects?.name?.trim();
    if (!name) continue;
    const list = subjectsByTeacher.get(row.teacher_id) ?? [];
    if (!list.includes(name)) list.push(name);
    subjectsByTeacher.set(row.teacher_id, list);
  }

  const assignments = (data || []).map((a) => {
    const cell = a as { teacher_id?: string; teachers?: { subject?: string } | null };
    const classSubjects = cell.teacher_id ? subjectsByTeacher.get(cell.teacher_id) : undefined;
    if (classSubjects && classSubjects.length > 0 && cell.teachers) {
      cell.teachers.subject = classSubjects.join(', ');
    }
    return a;
  });

  res.json({ ...config, assignments: toCC(assignments) });
}

// ---- MARK TYPES ----
export async function getMarkTypes(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { for: appliesTo } = req.query as Record<string, string>;
  let query = supabase.from('mark_types').select('*').eq('school_id', schoolId).order('order_index').order('created_at');
  if (appliesTo) query = (query as any).in('applies_to', [appliesTo, 'both']);
  const { data, error } = await query;
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json(toCC(data));
}

export async function createMarkType(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { name, appliesTo, maxValue } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: 'name is required' }); return; }
  const { data, error } = await supabase.from('mark_types').insert({
    school_id: schoolId,
    name: name.trim(),
    applies_to: appliesTo || 'both',
    max_value: (maxValue === '' || maxValue == null) ? null : Number(maxValue),
  }).select().single();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.status(201).json(toCC(data));
}

export async function updateMarkType(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  const { name, appliesTo, maxValue } = req.body;
  const patch: Record<string, unknown> = {};
  if (name !== undefined) {
    if (!name?.trim()) { res.status(400).json({ error: 'name cannot be empty' }); return; }
    patch.name = name.trim();
  }
  if (appliesTo !== undefined) patch.applies_to = appliesTo;
  if (maxValue !== undefined) patch.max_value = (maxValue === '' || maxValue == null) ? null : Number(maxValue);
  if (Object.keys(patch).length === 0) { res.status(400).json({ error: 'Nothing to update' }); return; }

  const { data, error } = await supabase.from('mark_types')
    .update(patch).eq('id', id).eq('school_id', schoolId).select().single();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  if (!data) { res.status(404).json({ error: 'Mark type not found' }); return; }
  res.json(toCC(data));
}

export async function deleteMarkType(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  const { error } = await supabase.from('mark_types').delete().eq('id', id).eq('school_id', schoolId);
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json({ message: 'Deleted' });
}

// ---- GRADING CONFIG (GPA) ----
// Shared read for ALL roles: the grading mode, GPA bands, and the per-name
// mark maxes the clients need to compute a percentage / GPA.
export async function getGradeConfig(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const [schoolRes, bandsRes, marksRes] = await Promise.all([
    supabase.from('schools').select('grading_config').eq('id', schoolId).single(),
    supabase.from('grade_scale_bands').select('min_percent, letter, grade_point').eq('school_id', schoolId).order('order_index'),
    supabase.from('mark_types').select('name, max_value').eq('school_id', schoolId),
  ]);
  const mode = (schoolRes.data?.grading_config as any)?.mode || 'scale';
  const bands = (bandsRes.data || []).map((b: any) => ({
    minPercent: Number(b.min_percent), letter: b.letter, gradePoint: Number(b.grade_point),
  }));
  const markMaxes: Record<string, number> = {};
  for (const m of (marksRes.data || []) as any[]) {
    if (m.max_value != null) markMaxes[m.name] = Number(m.max_value);
  }
  res.json({ mode, bands, markMaxes });
}

// Admin write: set the mode and replace the band set in one call.
export async function updateGradingConfig(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { mode, bands } = req.body as {
    mode?: string;
    bands?: { minPercent: number; letter: string; gradePoint: number }[];
  };

  if (mode !== undefined) {
    const { error } = await supabase.from('schools')
      .update({ grading_config: { mode } }).eq('id', schoolId);
    if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  }

  if (bands !== undefined) {
    await supabase.from('grade_scale_bands').delete().eq('school_id', schoolId);
    if (bands.length > 0) {
      const rows = bands.map((b, i) => ({
        school_id: schoolId,
        min_percent: Number(b.minPercent),
        letter: String(b.letter).trim(),
        grade_point: Number(b.gradePoint),
        order_index: i,
      }));
      // tenant-check-allow: every row sets school_id: schoolId (insert can't chain .eq)
      const { error } = await supabase.from('grade_scale_bands').insert(rows);
      if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
    }
  }

  res.json({ message: 'Saved' });
}

// ---- TERMS ----
export async function getTerms(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { data, error } = await supabase
    .from('terms').select('*').eq('school_id', schoolId)
    .order('order_index').order('created_at');
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json(toCC(data));
}

export async function createTerm(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { name } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: 'name is required' }); return; }
  const { data: existing } = await supabase
    .from('terms').select('order_index').eq('school_id', schoolId)
    .order('order_index', { ascending: false }).limit(1).maybeSingle();
  const nextOrder = (existing?.order_index ?? -1) + 1;
  const { data, error } = await supabase.from('terms').insert({
    school_id: schoolId,
    name: name.trim(),
    order_index: nextOrder,
  }).select().single();
  if (error) {
    const isDupe = error.code === '23505' || /unique|duplicate/i.test(error.message || '');
    res.status(isDupe ? 409 : safeDbErrorStatus(error))
      .json({ error: isDupe ? 'A term with that name already exists.' : safeDbErrorMessage(error) });
    return;
  }
  res.status(201).json(toCC(data));
}

export async function deleteTerm(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  const { error } = await supabase.from('terms').delete().eq('id', id).eq('school_id', schoolId);
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json({ message: 'Deleted' });
}

// ---- AUDIT LOGS (admin only) ----
// Paginated list with optional filters: entity_type, entity_id, actor_id,
// action, search (matches label/actor_username/reason), and date range.
export async function getAuditLogs(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const {
    entityType,
    entityId,
    actorId,
    action,
    search,
    from,
    to,
    page = '1',
    limit = '50',
  } = req.query as Record<string, string>;

  const pageNum = Math.max(1, parseInt(page) || 1);
  const limNum = Math.min(200, Math.max(1, parseInt(limit) || 50));
  const offset = (pageNum - 1) * limNum;

  let q = supabase
    .from('audit_logs')
    .select('*', { count: 'exact' })
    .eq('school_id', schoolId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limNum - 1);

  if (entityType) q = q.eq('entity_type', entityType);
  if (entityId) q = q.eq('entity_id', entityId);
  if (actorId) q = q.eq('actor_id', actorId);
  if (action) q = q.eq('action', action);
  if (from) q = q.gte('created_at', from);
  if (to) q = q.lte('created_at', to);
  if (search) {
    const escaped = search.replace(/[%_]/g, m => `\\${m}`);
    q = q.or(`label.ilike.%${escaped}%,actor_username.ilike.%${escaped}%,reason.ilike.%${escaped}%`);
  }

  const { data, error, count } = await q;
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json({ logs: toCC(data || []), total: count ?? 0, page: pageNum, limit: limNum });
}
