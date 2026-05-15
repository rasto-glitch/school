import { Response } from 'express';
import bcrypt from 'bcryptjs';
import * as XLSX from 'xlsx';
import { supabase } from '../config/supabase';
import { safeExt } from '../utils/upload';
import type { AuthRequest } from '../middleware/auth';
import { toCC } from '../utils/transform';
import { notify, notifyMany } from '../utils/notify';
import { loadArchiveSnapshot, streamPdf, buildXlsx } from '../utils/archiveExport';
import { streamCredentialsPdf, type CredentialEntry } from '../utils/credentialsPdf';
import { logAudit } from '../utils/audit';

// True iff this school has the historical-records feature enabled. When off,
// no archived/graduated student record may be created, read, or persisted —
// the corresponding actions become hard deletes.
async function hasArchiveFeature(schoolId: string): Promise<boolean> {
  const { data } = await supabase
    .from('schools').select('features').eq('id', schoolId).single();
  return (data?.features as Record<string, boolean> | null)?.archive === true;
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
  if (error) { res.status(500).json({ error: error.message }); return; }
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
        const passwordHash = await bcrypt.hash('Parent@123', rounds);

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
        parentAccountCreated = { username, password: 'Parent@123', fullName: parentFullName };
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

  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit({ req, entityType: 'student', entityId: data.id, action: 'create', after: data, label: data.full_name });
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

  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit({ req, entityType: 'student', entityId: String(id), action: 'update', before: before || undefined, after: data, label: data.full_name });
  res.json(toCC(data));
}

export async function deleteStudent(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  const { data: before } = await supabase.from('students').select('*').eq('id', id).eq('school_id', schoolId).single();
  const { error } = await supabase.from('students').delete().eq('id', id).eq('school_id', schoolId);
  if (error) { res.status(500).json({ error: error.message }); return; }
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
    if (error) { res.status(500).json({ error: error.message }); return; }
    if (before) await logAudit({ req, entityType: 'student', entityId: studentId, action: 'delete', before, label: (before as { full_name?: string }).full_name, reason: 'Graduated (no archive)' });
    res.json({ deleted: true });
    return;
  }

  const update: Record<string, unknown> = {};
  if (newClassId) update.class_id = newClassId;
  if (graduated) update.is_graduated = true;

  const { data, error } = await supabase.from('students')
    .update(update).eq('id', studentId).eq('school_id', schoolId).select().single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit({ req, entityType: 'student', entityId: studentId, action: 'update', before: before || undefined, after: data, label: data.full_name, reason: graduated ? 'Graduated' : null });
  res.json(toCC(data));
}

// ---- BULK UPLOAD STUDENTS ----
export async function bulkUploadStudents(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;

  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
  } catch {
    res.status(400).json({ error: 'Could not parse the file. Make sure it is a valid .xlsx or .xls file.' });
    return;
  }

  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(
    workbook.Sheets[workbook.SheetNames[0]],
    { raw: false, dateNF: 'yyyy-mm-dd', defval: '' }
  );

  if (rows.length === 0) {
    res.status(400).json({ error: 'The file has no data rows.' });
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
  const defaultParentPasswordHash = await bcrypt.hash('Parent@123', rounds);

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
      .select('id');

    if (studentsErr) {
      errors.push(`Failed to insert students: ${studentsErr.message}`);
    } else {
      created = (inserted || []).length;
    }
  }

  res.json({ created, skipped: skipped.length, total: rows.length, autoCreatedClasses, parentAccountsCreated, errors });
}

// ---- ARCHIVE STUDENTS ----

// Derive academic year from a date string: Sept-Dec = year/year+1, Jan-Aug = (year-1)/year
function toAcademicYear(dateStr: string): string {
  const d = new Date(dateStr);
  const y = d.getFullYear();
  return d.getMonth() >= 8 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
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

  // Fetch student + parent in one query
  const { data: student, error: studentErr } = await supabase
    .from('students')
    .select('*, parents(full_name, phone_number)')
    .eq('id', id)
    .eq('school_id', schoolId)
    .single();

  if (studentErr || !student) {
    res.status(404).json({ error: 'Student not found' });
    return;
  }

  // Fetch grades + class name (include marks[] — the current source of truth)
  const { data: grades } = await supabase
    .from('grades')
    .select('academic_year, grading_period, subject, marks, daily_grade, quiz_grade, monthly_exam_grade, term_exam_grade, class_id, classes(name)')
    .eq('student_id', id)
    .eq('school_id', schoolId)
    .order('academic_year');

  // Fetch attendance records with class id+name (to build classes-attended-per-year)
  const { data: attendanceRows } = await supabase
    .from('attendance')
    .select('date, class_id, classes(name)')
    .eq('student_id', id)
    .eq('school_id', schoolId);

  // Build classes attended: { academicYear → Map<classId, className> }
  const classYearMap = new Map<string, Map<string, string>>();
  for (const row of (attendanceRows || [])) {
    const classId = (row as any).class_id;
    const className = (row as any).classes?.name;
    if (!classId || !className) continue;
    const yr = toAcademicYear(row.date);
    if (!classYearMap.has(yr)) classYearMap.set(yr, new Map());
    classYearMap.get(yr)!.set(classId, className);
  }
  const classesAttended = Array.from(classYearMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([year, idToName]) =>
      Array.from(idToName.entries()).map(([classId, className]) => ({ year, classId, className })));

  // Build grades snapshot — preserve marks[] (current schema) + legacy columns for old records
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

  // Snapshot tuition payment history before students.delete() cascades it away.
  // Each entry = one student_fee row (a plan applied to this student) with its
  // own payment list. This is the source of truth for the accountant archive
  // tab once the student is gone.
  //
  // Per-payment fields mirror fee_payments columns so a returning parent's
  // receipt lookup (RCP-YYYY-NNNNN), refund chain, tax records, and
  // payment-account reconciliation all survive archive. Currency on the
  // payment row is the source of truth — must NOT fall back to the plan's
  // currency (per the accounting invariant in CLAUDE.md).
  const { data: studentFeeRows } = await supabase
    .from('student_fees')
    .select('id, total_amount, adjustment, sibling_discount, late_fees, notes, created_at, fee_plans(name, currency, academic_year)')
    .eq('student_id', id)
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
      // accounting fields — preserved verbatim so receipts, refunds, and
      // tax reports remain reconstructable after archive
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
    // Plan-level currency is the fallback only — individual payments may
    // have been recorded in a different currency, which the per-payment
    // record above preserves.
    return {
      studentFeeId: sf.id,
      planName: sf.fee_plans?.name ?? 'Plan',
      academicYear: sf.fee_plans?.academic_year ?? null,
      currency: sf.fee_plans?.currency ?? 'USD',
      totalAmount: Number(sf.total_amount),
      adjustment: Number(sf.adjustment),
      siblingDiscount: sf.sibling_discount != null ? Number(sf.sibling_discount) : 0,
      lateFees: sf.late_fees != null ? Number(sf.late_fees) : 0,
      notes: sf.notes ?? null,
      createdAt: sf.created_at,
      payments,
    };
  });

  // Atomic archive: insert into archived_students + delete from students
  // in one transaction (PL/pgSQL function from migration 010). Previously
  // these were two REST calls and a partial failure could leave a duplicate
  // archive row alongside the live student.
  const { error: rpcErr } = await supabase.rpc('archive_student_atomic', {
    p_school_id: schoolId,
    p_student_id: id,
    p_full_name: student.full_name,
    p_date_of_birth: student.date_of_birth ?? null,
    p_enrollment_date: student.created_at ? student.created_at.split('T')[0] : null,
    p_departure_date: departureDate || new Date().toISOString().split('T')[0],
    p_reason: reason,
    p_parent_full_name: (student as any).parents?.full_name ?? null,
    p_parent_phone: (student as any).parents?.phone_number ?? null,
    p_classes_attended: classesAttended,
    p_grades: gradesSnapshot,
    p_payment_history: paymentHistory,
  });

  if (rpcErr) {
    res.status(500).json({ error: rpcErr.message });
    return;
  }

  await logAudit({ req, entityType: 'student', entityId: String(id), action: 'delete', before: student as Record<string, unknown>, label: student.full_name, reason: `Archived (${reason})` });
  res.json({ message: 'Student archived successfully' });
}

export async function getArchivedStudents(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { search } = req.query as Record<string, string>;

  if (!(await hasArchiveFeature(schoolId))) {
    res.status(403).json({ error: 'Archive feature is not enabled for this school' });
    return;
  }

  let query = supabase
    .from('archived_students')
    .select('id, full_name, date_of_birth, enrollment_date, departure_date, reason, parent_full_name, parent_phone, classes_attended, created_at')
    .eq('school_id', schoolId)
    .order('created_at', { ascending: false });

  if (search) query = query.ilike('full_name', `%${search}%`);

  const { data, error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }
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

  let query = supabase
    .from('archived_students')
    .select('id, full_name, date_of_birth, departure_date, reason, parent_full_name, parent_phone, classes_attended')
    .eq('school_id', schoolId)
    .ilike('full_name', `%${name}%`)
    .order('departure_date', { ascending: false })
    .limit(8);
  if (dob) query = query.eq('date_of_birth', dob);

  const { data, error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(toCC(data ?? []));
}

// ---- CLASSES ----
export async function getClasses(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { data, error } = await supabase.from('classes').select('*').eq('school_id', schoolId).order('name');
  if (error) { res.status(500).json({ error: error.message }); return; }
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

  if (error) { res.status(500).json({ error: error.message }); return; }
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

  if (error) { res.status(500).json({ error: error.message }); return; }
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
  if (error) { res.status(500).json({ error: error.message }); return; }
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

// Make sure a teacher_classes row exists for (teacher, class) — teaching a subject in a class
// implies the teacher can see that class's students.
async function ensureTeacherClass(teacherId: string, classId: string): Promise<void> {
  const { data: existing } = await supabase.from('teacher_classes')
    .select('id').eq('teacher_id', teacherId).eq('class_id', classId).limit(1).maybeSingle();
  if (!existing) await supabase.from('teacher_classes').insert({ teacher_id: teacherId, class_id: classId });
}

// ---- CURRICULUM endpoints ----
// GET /admin/curriculum — every (class, subject, teacher) row for the school.
export async function getCurriculum(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { data, error } = await supabase
    .from('class_subject_teachers')
    .select('id, class_id, subject_id, teacher_id, classes(name), subjects(name), teachers(full_name)')
    .eq('school_id', schoolId);
  if (error) { res.status(500).json({ error: error.message }); return; }
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
  const { data, error } = await supabase.from('class_subject_teachers')
    .upsert({ school_id: schoolId, class_id: classId, subject_id: subjectId, teacher_id: teacherId }, { onConflict: 'class_id,subject_id,teacher_id' })
    .select('id').single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await ensureTeacherClass(teacherId, classId);
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
  if (error) { res.status(500).json({ error: error.message }); return; }
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
  const { fullName, phoneNumber, emergencyContact, classIds, classId, username, password } = req.body;

  const { data: schoolData } = await supabase.from('schools').select('abbreviation').eq('id', schoolId).single();
  const abbrev = (schoolData?.abbreviation || '').toLowerCase();
  const rawUsername = username || fullName.toLowerCase().replace(/\s+/g, '.');
  const finalUsername = abbrev && !rawUsername.startsWith(`${abbrev}_`) ? `${abbrev}_${rawUsername}` : rawUsername;

  const rounds = parseInt(process.env.BCRYPT_ROUNDS || '10');
  const finalPassword = password || 'Teacher@123';
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
  }).select().single();

  if (userErr) {
    const isDupe = userErr.message.includes('unique') || userErr.message.includes('duplicate');
    res.status(isDupe ? 409 : 500).json({
      error: isDupe
        ? `Username "${finalUsername}" already exists. Try a different username.`
        : userErr.message,
    });
    return;
  }

  const { data: teacher, error: teacherErr } = await supabase.from('teachers').insert({
    school_id: schoolId,
    user_id: newUser.id,
    full_name: fullName,
    phone_number: phoneNumber || null,
    emergency_contact: emergencyContact || null,
    subject: null, // populated from the curriculum (class ↔ subject ↔ teacher) once assigned
  }).select().single();

  if (teacherErr) { res.status(500).json({ error: teacherErr.message }); return; }

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

  const updateFields: Record<string, unknown> = {};
  if (fullName) updateFields.full_name = fullName;
  if (phoneNumber !== undefined) updateFields.phone_number = phoneNumber || null;
  if (emergencyContact !== undefined) updateFields.emergency_contact = emergencyContact || null;

  const { data, error } = Object.keys(updateFields).length
    ? await supabase.from('teachers').update(updateFields).eq('id', id).eq('school_id', schoolId).select().single()
    : await supabase.from('teachers').select('*').eq('id', id).eq('school_id', schoolId).single();

  if (error) { res.status(500).json({ error: error.message }); return; }

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
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(toCC(data));
}

export async function createDriver(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { fullName, phoneNumber, emergencyContact, licenseNumber, busNumber, age, username, password, studentIds, vehicleType } = req.body;

  const { data: schoolData } = await supabase.from('schools').select('abbreviation').eq('id', schoolId).single();
  const abbrev = (schoolData?.abbreviation || '').toLowerCase();
  const rawUsername = username || fullName.toLowerCase().replace(/\s+/g, '.');
  const finalUsername = abbrev && !rawUsername.startsWith(`${abbrev}_`) ? `${abbrev}_${rawUsername}` : rawUsername;

  const rounds = parseInt(process.env.BCRYPT_ROUNDS || '10');
  const finalPassword = password || 'Driver@123';
  const passwordHash = await bcrypt.hash(finalPassword, rounds);

  const nameParts = fullName.trim().split(' ');

  const { data: newUser, error: userErr } = await supabase.from('users').insert({
    school_id: schoolId,
    first_name: nameParts[0] || fullName,
    last_name: nameParts.slice(1).join(' ') || '',
    username: finalUsername,
    password_hash: passwordHash,
    role: 'driver',
  }).select().single();

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
  }).select().single();

  if (driverErr) { res.status(500).json({ error: driverErr.message }); return; }

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
  };
  if (busId) updateData.bus_id = busId;
  if (vehicleType) updateData.vehicle_type = vehicleType;

  const { data, error } = await supabase.from('drivers')
    .update(updateData)
    .eq('id', id).eq('school_id', schoolId).select().single();

  if (error) { res.status(500).json({ error: error.message }); return; }

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
  if (role === 'accountant' && (schoolData?.features as Record<string, boolean> | null)?.tuition_fees !== true) {
    res.status(403).json({ error: 'Accounting module is not enabled for this school. Contact your provider to upgrade.' });
    return;
  }

  const abbrev = (schoolData?.abbreviation || '').toLowerCase();
  const finalUsername = abbrev && !username.startsWith(`${abbrev}_`) ? `${abbrev}_${username}` : username;

  const rounds = parseInt(process.env.BCRYPT_ROUNDS || '10');
  const passwordHash = await bcrypt.hash(password, rounds);

  const { data: newUser, error } = await supabase.from('users').insert({
    school_id: schoolId,
    first_name: firstName,
    last_name: lastName,
    email: email || null,
    phone: phone || null,
    username: finalUsername,
    password_hash: passwordHash,
    role,
  }).select().single();

  if (error) {
    const isDupe = error.message.includes('unique') || error.message.includes('duplicate');
    res.status(isDupe ? 409 : 500).json({
      error: isDupe
        ? `Username "${username}" already exists. Please choose a different username.`
        : error.message,
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

  res.status(201).json({ id: newUser.id, username, role, firstName, lastName });
}

// ---- APPOINTMENTS ----
export async function getPendingAppointmentCount(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { count, error } = await supabase
    .from('appointments')
    .select('*', { count: 'exact', head: true })
    .eq('school_id', schoolId)
    .eq('status', 'pending');
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ count: count ?? 0 });
}

export async function getAppointments(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { data, error } = await supabase
    .from('appointments')
    .select('*, parents(full_name, phone_number, user_id)')
    .eq('school_id', schoolId)
    .order('created_at', { ascending: false });
  if (error) { res.status(500).json({ error: error.message }); return; }
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

  if (error) { res.status(500).json({ error: error.message }); return; }

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

  let targetUserIds: string[] = userIds || [];

  if (targetRole && targetUserIds.length === 0) {
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
  const { schoolId, userId } = req.user!;
  const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('announcements')
    .select(ANNOUNCEMENT_SELECT)
    .eq('school_id', schoolId)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false });
  if (error) { res.status(500).json({ error: error.message }); return; }
  const decorated = await decorateAnnouncements(data ?? [], userId);
  res.json(toCC(decorated));
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
  if (error) { res.status(500).json({ error: error.message }); return; }
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

  if (error) { res.status(500).json({ error: error.message }); return; }

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
  if (error) { res.status(500).json({ error: error.message }); return; }
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
  if (error) { res.status(400).json({ error: error.message }); return; }

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

  if (error) { res.status(500).json({ error: error.message }); return; }

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

  if (error) { res.status(400).json({ error: error.message }); return; }

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
  if (error) { res.status(400).json({ error: error.message }); return; }

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

  if (error) { res.status(400).json({ error: error.message }); return; }
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

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SchoolApp/1.0)' }, signal: ctrl.signal });
    clearTimeout(timer);
    const html = await response.text();

    const getMeta = (attr: string, val: string) => {
      const r1 = html.match(new RegExp(`<meta[^>]+${attr}=["']${val}["'][^>]+content=["']([^"'<>]+)["']`, 'i'));
      const r2 = html.match(new RegExp(`<meta[^>]+content=["']([^"'<>]+)["'][^>]+${attr}=["']${val}["']`, 'i'));
      return (r1 || r2)?.[1]?.trim() ?? '';
    };

    const title = getMeta('property', 'og:title') || getMeta('name', 'twitter:title') || html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || '';
    const description = getMeta('property', 'og:description') || getMeta('name', 'twitter:description') || getMeta('name', 'description') || '';
    const image = getMeta('property', 'og:image') || getMeta('name', 'twitter:image') || '';
    let siteName = getMeta('property', 'og:site_name') || '';
    if (!siteName) { try { siteName = new URL(url).hostname.replace(/^www\./, ''); } catch {} }

    res.json({ type: 'link', url, title, description: description.substring(0, 200), image, siteName });
  } catch {
    let siteName = '';
    try { siteName = new URL(url).hostname.replace(/^www\./, ''); } catch {}
    res.json({ type: 'link', url, title: '', description: '', image: '', siteName });
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

// ---- TEACHER DELETE ----
export async function deleteTeacher(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;

  const { data: teacher, error: findErr } = await supabase
    .from('teachers').select('user_id').eq('id', id).eq('school_id', schoolId).single();
  if (findErr || !teacher) {
    res.status(404).json({ error: 'Teacher not found in this school' });
    return;
  }

  // Nullify teacher_id on records we want to keep (homework, assignments, grades, reports)
  await supabase.from('homework').update({ teacher_id: null } as any).eq('teacher_id', id).eq('school_id', schoolId);
  await supabase.from('assignments').update({ teacher_id: null } as any).eq('teacher_id', id).eq('school_id', schoolId);
  await supabase.from('grades').update({ teacher_id: null } as any).eq('teacher_id', id).eq('school_id', schoolId);
  await supabase.from('reports').update({ teacher_id: null } as any).eq('teacher_id', id).eq('school_id', schoolId);
  await supabase.from('weekly_summaries').delete().eq('teacher_id', id).eq('school_id', schoolId);
  await supabase.from('subjects').update({ teacher_id: null }).eq('teacher_id', id).eq('school_id', schoolId);

  // Delete teacher record (cascades teacher_classes)
  const { error: delTeacherErr } = await supabase.from('teachers').delete().eq('id', id).eq('school_id', schoolId);
  if (delTeacherErr) { res.status(500).json({ error: delTeacherErr.message }); return; }

  // Delete the user account
  const { error: delUserErr } = await supabase.from('users').delete().eq('id', teacher.user_id);
  if (delUserErr) { res.status(500).json({ error: delUserErr.message }); return; }

  res.json({ message: 'Teacher removed' });
}

// ---- DRIVER DELETE ----
export async function deleteDriver(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;

  const { data: driver, error: findErr } = await supabase
    .from('drivers').select('user_id').eq('id', id).eq('school_id', schoolId).single();
  if (findErr || !driver) {
    res.status(404).json({ error: 'Driver not found in this school' });
    return;
  }

  // Unlink students assigned to this driver
  await supabase.from('students').update({ driver_id: null }).eq('driver_id', id).eq('school_id', schoolId);
  await supabase.from('bus_locations').delete().eq('driver_id', id).eq('school_id', schoolId);

  // Delete driver record
  const { error: delDriverErr } = await supabase.from('drivers').delete().eq('id', id).eq('school_id', schoolId);
  if (delDriverErr) { res.status(500).json({ error: delDriverErr.message }); return; }

  // Delete the user account
  const { error: delUserErr } = await supabase.from('users').delete().eq('id', driver.user_id);
  if (delUserErr) { res.status(500).json({ error: delUserErr.message }); return; }

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
  if (error) { res.status(500).json({ error: error.message }); return; }
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
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(201).json(toCC(data));
}

export async function updateSubject(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  const { name } = req.body;
  if (!name || !String(name).trim()) { res.status(400).json({ error: 'Subject name is required' }); return; }
  const { data, error } = await supabase.from('subjects')
    .update({ name: String(name).trim() }).eq('id', id).eq('school_id', schoolId).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
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
  if (error) { res.status(500).json({ error: error.message }); return; }
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
  if (error) { res.status(500).json({ error: error.message }); return; }
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

// ---- YEAR TRANSITION ----
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

  // 1. Collect all currently active student IDs
  const { data: activeStudents, error: activeErr } = await supabase
    .from('students').select('id').eq('school_id', schoolId).eq('is_graduated', false);
  if (activeErr) { res.status(500).json({ error: activeErr.message }); return; }
  const activeIds = (activeStudents || []).map((s: any) => s.id);

  // 2. Clear reports for all active students — clean slate for new year
  if (activeIds.length > 0) {
    const { error: repErr } = await supabase.from('reports')
      .delete().in('student_id', activeIds).eq('school_id', schoolId);
    if (repErr) { res.status(500).json({ error: repErr.message }); return; }
  }

  // 3. Graduate selected students. Schools without the archive feature can't
  //    retain past students — delete them instead of marking graduated.
  if (studentIdsToGraduate.length > 0) {
    const archiveOn = await hasArchiveFeature(schoolId);
    if (archiveOn) {
      const { error: gradErr } = await supabase.from('students')
        .update({ is_graduated: true })
        .in('id', studentIdsToGraduate).eq('school_id', schoolId);
      if (gradErr) { res.status(500).json({ error: gradErr.message }); return; }
    } else {
      const { error: delErr } = await supabase.from('students')
        .delete().in('id', studentIdsToGraduate).eq('school_id', schoolId);
      if (delErr) { res.status(500).json({ error: delErr.message }); return; }
    }
  }

  // 4. Apply class assignments — grouped by target class for efficient bulk updates
  if (classAssignments.length > 0) {
    const byClass: Record<string, string[]> = {};
    for (const { studentId, classId } of classAssignments) {
      if (!byClass[classId]) byClass[classId] = [];
      byClass[classId].push(studentId);
    }
    for (const [classId, studentIds] of Object.entries(byClass)) {
      const { error: assignErr } = await supabase.from('students')
        .update({ class_id: classId }).in('id', studentIds).eq('school_id', schoolId);
      if (assignErr) { res.status(500).json({ error: assignErr.message }); return; }
    }
  }

  // 5. Advance the school's academic year
  const { error: yearErr } = await supabase.from('schools')
    .update({ current_academic_year: newAcademicYear }).eq('id', schoolId);
  if (yearErr) { res.status(500).json({ error: yearErr.message }); return; }

  res.json({ graduated: studentIdsToGraduate.length, assigned: classAssignments.length, newAcademicYear });
}

// ---- PASSWORD RESET (ADMIN) ----
export async function getResetRequests(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { data, error } = await supabase.from('password_reset_requests')
    .select('*').eq('school_id', schoolId).eq('status', 'pending')
    .order('requested_at', { ascending: false });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(toCC(data));
}

export async function resetUserPassword(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { userId } = req.params;
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters' }); return;
  }
  const { data: user } = await supabase.from('users').select('id').eq('id', userId).eq('school_id', schoolId).single();
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }
  const rounds = parseInt(process.env.BCRYPT_ROUNDS || '10');
  const hash = await bcrypt.hash(newPassword, rounds);
  const { error } = await supabase.from('users').update({ password_hash: hash, password_changed_at: new Date().toISOString() }).eq('id', userId).eq('school_id', schoolId);
  if (error) { res.status(500).json({ error: error.message }); return; }
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
  if (!['teacher', 'driver', 'parent', 'supervisor', 'reception', 'accountant'].includes(role)) {
    res.status(400).json({ error: 'Invalid role' }); return;
  }

  const { data, error } = await supabase
    .from('users')
    .select('id, first_name, last_name, username, role, is_active')
    .eq('school_id', schoolId)
    .eq('role', role)
    .eq('is_active', false)
    .or(`first_name.ilike.%${name}%,last_name.ilike.%${name}%,username.ilike.%${name}%`)
    .limit(8);
  if (error) { res.status(500).json({ error: error.message }); return; }
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
    if (newPassword.length < 6) { res.status(400).json({ error: 'Password must be at least 6 characters' }); return; }
    const rounds = parseInt(process.env.BCRYPT_ROUNDS || '10');
    updates.password_hash = await bcrypt.hash(newPassword, rounds);
  }

  const { error } = await supabase.from('users').update(updates).eq('id', userId).eq('school_id', schoolId);
  if (error) { res.status(500).json({ error: error.message }); return; }
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
  const { data, error } = await supabase.from('schools').select('current_academic_year').eq('id', schoolId).single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(toCC(data));
}

export async function updateSettings(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { currentAcademicYear } = req.body;
  const { data, error } = await supabase.from('schools')
    .update({ current_academic_year: currentAcademicYear })
    .eq('id', schoolId).select('current_academic_year').single();
  if (error) { res.status(500).json({ error: error.message }); return; }
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
    if (error) { res.status(500).json({ error: error.message }); return; }
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
    if (error) { res.status(500).json({ error: error.message }); return; }
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
      if (error) { res.status(500).json({ error: error.message }); return; }

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
      if (error) { res.status(500).json({ error: error.message }); return; }
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
    .select('id, first_name, last_name, username, email, phone, role, is_active, created_at')
    .eq('school_id', schoolId)
    .order('role')
    .order('first_name');
  if (error) { res.status(500).json({ error: error.message }); return; }
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

  const updateFields: Record<string, unknown> = {};
  if (firstName !== undefined) updateFields.first_name = firstName;
  if (lastName !== undefined) updateFields.last_name = lastName;
  if (email !== undefined) updateFields.email = email || null;
  if (phone !== undefined) updateFields.phone = phone || null;
  if (username !== undefined) updateFields.username = username;
  if (isActive !== undefined) updateFields.is_active = isActive;

  const { data: user, error } = await supabase
    .from('users').update(updateFields).eq('id', userId).eq('school_id', schoolId).select().single();
  if (error) {
    res.status(error.message.includes('unique') ? 409 : 500).json({ error: error.message }); return;
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

  res.json(toCC(user));
}

export async function deleteAccount(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { userId } = req.params;

  const { data: user, error: findErr } = await supabase
    .from('users').select('id, role').eq('id', userId).eq('school_id', schoolId).single();
  if (findErr || !user) { res.status(404).json({ error: 'Account not found' }); return; }

  if (user.role === 'teacher') {
    const { data: teacher } = await supabase.from('teachers').select('id').eq('user_id', userId).eq('school_id', schoolId).single();
    if (teacher) {
      await supabase.from('homework').update({ teacher_id: null } as any).eq('teacher_id', teacher.id).eq('school_id', schoolId);
      await supabase.from('assignments').update({ teacher_id: null } as any).eq('teacher_id', teacher.id).eq('school_id', schoolId);
      await supabase.from('grades').update({ teacher_id: null } as any).eq('teacher_id', teacher.id).eq('school_id', schoolId);
      await supabase.from('reports').update({ teacher_id: null } as any).eq('teacher_id', teacher.id).eq('school_id', schoolId);
      await supabase.from('weekly_summaries').delete().eq('teacher_id', teacher.id).eq('school_id', schoolId);
      await supabase.from('subjects').update({ teacher_id: null }).eq('teacher_id', teacher.id).eq('school_id', schoolId);
      await supabase.from('teachers').delete().eq('id', teacher.id).eq('school_id', schoolId);
    }
  } else if (user.role === 'supervisor') {
    // Supervisors have no dedicated profile table — nothing extra to clean up
  } else {
    res.status(400).json({ error: `Use the dedicated delete endpoint for role "${user.role}"` }); return;
  }

  const { error: delErr } = await supabase.from('users').delete().eq('id', userId);
  if (delErr) { res.status(500).json({ error: delErr.message }); return; }

  res.json({ message: 'Account deleted' });
}

export async function getParents(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { data, error } = await supabase
    .from('parents')
    .select('id, full_name, phone_number, email, user_id, users(username), students(id, full_name)')
    .eq('school_id', schoolId)
    .order('full_name');
  if (error) { res.status(500).json({ error: error.message }); return; }
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
  if (error) { res.status(500).json({ error: error.message }); return; }
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
  if (error) { res.status(500).json({ error: error.message }); return; }
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
  if (error) { res.status(500).json({ error: error.message }); return; }
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
    if (error) { res.status(500).json({ error: error.message }); return; }
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
  if (error) { res.status(500).json({ error: error.message }); return; }
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
  if (error) { res.status(500).json({ error: error.message }); return; }

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
    .select('id, day_of_week, period_index, teachers(id, full_name, subject)')
    .eq('school_id', schoolId)
    .eq('class_id', student.class_id);
  if (error) { res.status(500).json({ error: error.message }); return; }

  res.json({ ...config, assignments: toCC(data) });
}

// ---- MARK TYPES ----
export async function getMarkTypes(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { for: appliesTo } = req.query as Record<string, string>;
  let query = supabase.from('mark_types').select('*').eq('school_id', schoolId).order('order_index').order('created_at');
  if (appliesTo) query = (query as any).in('applies_to', [appliesTo, 'both']);
  const { data, error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(toCC(data));
}

export async function createMarkType(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { name, appliesTo } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: 'name is required' }); return; }
  const { data, error } = await supabase.from('mark_types').insert({
    school_id: schoolId,
    name: name.trim(),
    applies_to: appliesTo || 'both',
  }).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(201).json(toCC(data));
}

export async function deleteMarkType(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  const { error } = await supabase.from('mark_types').delete().eq('id', id).eq('school_id', schoolId);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ message: 'Deleted' });
}

// ---- TERMS ----
export async function getTerms(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { data, error } = await supabase
    .from('terms').select('*').eq('school_id', schoolId)
    .order('order_index').order('created_at');
  if (error) { res.status(500).json({ error: error.message }); return; }
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
    res.status(error.message.includes('unique') || error.code === '23505' ? 409 : 500)
      .json({ error: error.message });
    return;
  }
  res.status(201).json(toCC(data));
}

export async function deleteTerm(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  const { error } = await supabase.from('terms').delete().eq('id', id).eq('school_id', schoolId);
  if (error) { res.status(500).json({ error: error.message }); return; }
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
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ logs: toCC(data || []), total: count ?? 0, page: pageNum, limit: limNum });
}
