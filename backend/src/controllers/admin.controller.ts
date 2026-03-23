import { Response } from 'express';
import bcrypt from 'bcryptjs';
import * as XLSX from 'xlsx';
import { supabase } from '../config/supabase';
import type { AuthRequest } from '../middleware/auth';
import { toCC } from '../utils/transform';
import { notify, notifyMany } from '../utils/notify';

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
  const { fullName, parentId, classId, driverId, homeAddress, emergencyContact, phoneNumber, dateOfBirth } = req.body;

  const { data, error } = await supabase.from('students').insert({
    school_id: schoolId,
    full_name: fullName,
    parent_id: parentId || null,
    class_id: classId || null,
    driver_id: driverId || null,
    home_address: homeAddress,
    emergency_contact: emergencyContact,
    phone_number: phoneNumber,
    date_of_birth: dateOfBirth || null,
  }).select().single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(201).json(toCC(data));
}

export async function updateStudent(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  const { fullName, parentId, classId, driverId, homeAddress, emergencyContact, phoneNumber, dateOfBirth } = req.body;

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
  res.json(toCC(data));
}

export async function deleteStudent(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  const { error } = await supabase.from('students').delete().eq('id', id).eq('school_id', schoolId);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ message: 'Student removed' });
}

export async function assignStudent(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { studentId, newClassId, graduated } = req.body;

  const update: Record<string, unknown> = {};
  if (newClassId) update.class_id = newClassId;
  if (graduated) update.is_graduated = true;

  const { data, error } = await supabase.from('students')
    .update(update).eq('id', studentId).eq('school_id', schoolId).select().single();

  if (error) { res.status(500).json({ error: error.message }); return; }
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
  } catch (e: any) {
    res.status(400).json({ error: 'Could not parse the file. Make sure it is a valid .xlsx or .xls file.' });
    return;
  }

  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { raw: false, dateNF: 'yyyy-mm-dd', defval: '' });

  if (rows.length === 0) {
    res.status(400).json({ error: 'The file has no data rows.' });
    return;
  }

  // Column name → internal field mapping (case-insensitive)
  const COLUMN_MAP: Record<string, string> = {
    'full name': 'fullName',
    'name': 'fullName',
    'primary phone number': 'phoneNumber',
    'phone number': 'phoneNumber',
    'phone': 'phoneNumber',
    'emergency contact': 'emergencyContact',
    'date of birth': 'dateOfBirth',
    'dob': 'dateOfBirth',
    'grade': 'grade',
    'class': 'grade',
    'grade/class': 'grade',
    'address': 'homeAddress',
    'home address': 'homeAddress',
  };

  // Strip "grade " prefix → e.g. "Grade 9" → "9", "9" → "9"
  const stripGradePrefix = (g: string) => g.trim().toLowerCase().replace(/^grade\s+/, '');

  // Format a raw grade cell value into a proper class name
  // "9" → "Grade 9",  "Grade 9" → "Grade 9",  "KG" → "KG"
  const formatClassName = (g: string): string => {
    const t = g.trim();
    if (/^\d+$/.test(t)) return `Grade ${t}`;
    if (/^grade\s+\d+$/i.test(t)) return `Grade ${t.replace(/^grade\s+/i, '')}`;
    return t;
  };

  // ---- Class lookup maps ----
  const { data: existingClasses } = await supabase
    .from('classes').select('id, name').eq('school_id', schoolId);

  const classExactMap = new Map<string, string>(); // name.toLowerCase() → id
  const classNormMap  = new Map<string, string>(); // strip-prefix form → id
  for (const cls of (existingClasses || [])) {
    classExactMap.set(cls.name.toLowerCase(), cls.id);
    classNormMap.set(stripGradePrefix(cls.name), cls.id);
  }

  // ---- Parent lookup maps ----
  // Key: "fathername grandfathername" (lowercase) → parent_id
  // Siblings share the same key → same parent account
  const { data: existingParents } = await supabase
    .from('parents').select('id, full_name, phone_number').eq('school_id', schoolId);
  const parentCache = new Map<string, string>();
  for (const p of (existingParents || [])) {
    parentCache.set(p.full_name.toLowerCase().trim(), p.id);
  }

  // Track taken parent usernames to ensure uniqueness
  const { data: existingParentUsers } = await supabase
    .from('users').select('username').eq('school_id', schoolId).eq('role', 'parent');
  const takenUsernames = new Set((existingParentUsers || []).map((u: any) => u.username.toLowerCase()));

  const generateParentUsername = (fatherName: string, grandfatherName: string): string => {
    const base = (fatherName + grandfatherName).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!takenUsernames.has(base)) return base;
    let n = 2;
    while (takenUsernames.has(`${base}${n}`)) n++;
    return `${base}${n}`;
  };

  // Hash the default parent password once
  const rounds = parseInt(process.env.BCRYPT_ROUNDS || '10');
  const defaultParentPasswordHash = await bcrypt.hash('Parent@123', rounds);

  let created = 0;
  let parentAccountsCreated = 0;
  const autoCreatedClasses: string[] = [];
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // row 1 = header

    // Normalize keys
    const mapped: Record<string, string> = {};
    for (const [key, val] of Object.entries(row)) {
      const norm = key.trim().toLowerCase().replace(/\s+/g, ' ');
      const field = COLUMN_MAP[norm];
      if (field) mapped[field] = String(val).trim();
    }

    const { fullName, phoneNumber, emergencyContact, dateOfBirth, grade, homeAddress } = mapped;

    if (!fullName) {
      errors.push(`Row ${rowNum}: missing "Full Name" — skipped`);
      continue;
    }

    // ---- Resolve or create parent ----
    // Name structure: [FirstName] [FatherName] [GrandfatherName ...]
    // Parent = FatherName + GrandfatherName
    let parentId: string | null = null;
    const nameParts = fullName.trim().split(/\s+/);
    if (nameParts.length >= 3) {
      const fatherName      = nameParts[1];
      const grandfatherName = nameParts.slice(2).join(' ');
      const parentFullName  = `${fatherName} ${grandfatherName}`;
      const parentKey       = parentFullName.toLowerCase();

      if (parentCache.has(parentKey)) {
        // Existing parent or already-created sibling → reuse
        parentId = parentCache.get(parentKey)!;
      } else {
        // Create user account for parent
        const username = generateParentUsername(fatherName, grandfatherName);
        const { data: newUser, error: userErr } = await supabase.from('users').insert({
          school_id: schoolId,
          first_name: fatherName,
          last_name: grandfatherName,
          username,
          password_hash: defaultParentPasswordHash,
          role: 'parent',
        }).select('id').single();

        if (userErr) {
          errors.push(`Row ${rowNum}: could not create parent account for "${parentFullName}" — ${userErr.message}`);
        } else {
          takenUsernames.add(username);
          const { data: newParent, error: parentErr } = await supabase.from('parents').insert({
            school_id: schoolId,
            user_id: newUser.id,
            full_name: parentFullName,
            phone_number: phoneNumber || null,
          }).select('id').single();

          if (parentErr) {
            errors.push(`Row ${rowNum}: could not create parent record for "${parentFullName}" — ${parentErr.message}`);
          } else {
            parentCache.set(parentKey, newParent.id);
            parentId = newParent.id;
            parentAccountsCreated++;
          }
        }
      }
    }

    // ---- Resolve or auto-create class ----
    let classId: string | null = null;
    if (grade) {
      const gradeLower = grade.toLowerCase();
      const gradeNorm  = stripGradePrefix(grade);

      if (classExactMap.has(gradeLower)) {
        classId = classExactMap.get(gradeLower)!;
      } else if (classNormMap.has(gradeNorm)) {
        classId = classNormMap.get(gradeNorm)!;
      } else {
        const className = formatClassName(grade);
        const { data: newClass, error: classErr } = await supabase.from('classes').insert({
          school_id: schoolId,
          name: className,
          grade_level: className,
        }).select('id, name').single();

        if (classErr) {
          errors.push(`Row ${rowNum}: failed to create class "${className}" — ${classErr.message}`);
          continue;
        }

        classExactMap.set(className.toLowerCase(), newClass.id);
        classNormMap.set(stripGradePrefix(className), newClass.id);
        classId = newClass.id;
        autoCreatedClasses.push(className);
      }
    }

    // ---- Validate / normalise date of birth ----
    let dob: string | null = null;
    if (dateOfBirth) {
      const parsed = new Date(dateOfBirth);
      if (!isNaN(parsed.getTime())) dob = parsed.toISOString().split('T')[0];
    }

    // ---- Insert student ----
    const { error: studentErr } = await supabase.from('students').insert({
      school_id: schoolId,
      full_name: fullName,
      phone_number: phoneNumber || null,
      emergency_contact: emergencyContact || null,
      home_address: homeAddress || null,
      date_of_birth: dob,
      class_id: classId,
      parent_id: parentId,
    });

    if (studentErr) {
      errors.push(`Row ${rowNum}: failed to save "${fullName}" — ${studentErr.message}`);
    } else {
      created++;
    }
  }

  res.json({ created, total: rows.length, autoCreatedClasses, parentAccountsCreated, errors });
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

  // Students with this class_id will have class_id set to NULL automatically (ON DELETE SET NULL)
  const { error } = await supabase.from('classes').delete().eq('id', id).eq('school_id', schoolId);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ message: 'Class deleted. Students have been unassigned but not removed.' });
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
    .select('*, users(id, username, email, phone), teacher_classes(class_id, classes(name))')
    .eq('school_id', schoolId)
    .in('user_id', activeUserIds.length > 0 ? activeUserIds : ['00000000-0000-0000-0000-000000000000']);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(toCC(data));
}

export async function createTeacher(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { fullName, phoneNumber, emergencyContact, subject, classIds, classId, username, password } = req.body;

  const rounds = parseInt(process.env.BCRYPT_ROUNDS || '10');
  const finalUsername = username || fullName.toLowerCase().replace(/\s+/g, '.');
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
    subject: subject || null,
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
  const { fullName, phoneNumber, emergencyContact, subject, classIds, remove } = req.body;

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
  if (subject !== undefined) updateFields.subject = subject || null;

  const { data, error } = await supabase.from('teachers')
    .update(updateFields)
    .eq('id', id).eq('school_id', schoolId).select().single();

  if (error) { res.status(500).json({ error: error.message }); return; }

  // Handle multiple class assignments
  if (Array.isArray(classIds)) {
    await supabase.from('teacher_classes').delete().eq('teacher_id', id);
    if (classIds.length > 0) {
      await supabase.from('teacher_classes').insert(classIds.map((cid: string) => ({ teacher_id: id, class_id: cid })));
    }
  } else if (classIds) {
    await supabase.from('teacher_classes').delete().eq('teacher_id', id);
    await supabase.from('teacher_classes').insert({ teacher_id: id, class_id: classIds });
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
  const { fullName, phoneNumber, emergencyContact, licenseNumber, busNumber, age, username, password, studentIds } = req.body;

  const rounds = parseInt(process.env.BCRYPT_ROUNDS || '10');
  const finalUsername = username || fullName.toLowerCase().replace(/\s+/g, '.');
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
  const { fullName, phoneNumber, emergencyContact, licenseNumber, busNumber, age, remove, studentIds } = req.body;

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

  const { data, error } = await supabase.from('drivers')
    .update(updateData)
    .eq('id', id).eq('school_id', schoolId).select().single();

  if (error) { res.status(500).json({ error: error.message }); return; }

  // Update student assignments
  if (studentIds && Array.isArray(studentIds)) {
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

  const rounds = parseInt(process.env.BCRYPT_ROUNDS || '10');
  const passwordHash = await bcrypt.hash(password, rounds);

  const { data: newUser, error } = await supabase.from('users').insert({
    school_id: schoolId,
    first_name: firstName,
    last_name: lastName,
    email: email || null,
    phone: phone || null,
    username,
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
export async function getAnnouncements(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('announcements')
    .select('*')
    .eq('school_id', schoolId)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(toCC(data));
}

export async function createAnnouncement(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { title, content, targetAudience, linkUrl } = req.body;

  let attachmentUrl: string | null = null;
  const file = (req as any).file;
  if (file) {
    const ext = file.originalname.includes('.') ? '.' + file.originalname.split('.').pop() : '';
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
    link_url: linkUrl || null,
  }).select().single();

  if (error) { res.status(500).json({ error: error.message }); return; }

  // Notify target audience in real-time + push
  const audience = targetAudience || 'all';
  const roleFilter = audience === 'all'
    ? supabase.from('users').select('id').eq('school_id', schoolId).eq('is_active', true)
    : supabase.from('users').select('id').eq('school_id', schoolId).eq('role', audience).eq('is_active', true);
  const { data: targets } = await roleFilter;
  if (targets && targets.length > 0) {
    const preview = content.length > 80 ? content.substring(0, 80) + '…' : content;
    notifyMany(targets.map((u: any) => ({ schoolId, userId: u.id, title, message: preview, type: 'announcement', relatedId: data.id }))).catch(() => {});
  }

  res.status(201).json(toCC(data));
}

export async function deleteAnnouncement(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  const { error } = await supabase.from('announcements').delete().eq('id', id).eq('school_id', schoolId);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ message: 'Deleted' });
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
      .select('*, classes(name), parents(full_name, phone_number, email), drivers(full_name, buses(bus_number))')
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
export async function getSubjects(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { data, error } = await supabase
    .from('subjects')
    .select('*, teachers(id, full_name)')
    .eq('school_id', schoolId)
    .order('name');
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(toCC(data));
}

export async function createSubject(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { name, teacherId } = req.body;
  const { data, error } = await supabase.from('subjects').insert({
    school_id: schoolId, name, teacher_id: teacherId || null,
  }).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  // Also set the subject field on the teacher record for quick lookup
  if (teacherId) {
    await supabase.from('teachers').update({ subject: name }).eq('id', teacherId).eq('school_id', schoolId);
  }
  res.status(201).json(toCC(data));
}

export async function updateSubject(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  const { name, teacherId } = req.body;
  const { data, error } = await supabase.from('subjects')
    .update({ name, teacher_id: teacherId || null })
    .eq('id', id).eq('school_id', schoolId).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  // Sync subject name onto the teacher record
  if (teacherId) {
    await supabase.from('teachers').update({ subject: name }).eq('id', teacherId).eq('school_id', schoolId);
  }
  res.json(toCC(data));
}

export async function deleteSubject(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  await supabase.from('subjects').delete().eq('id', id).eq('school_id', schoolId);
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

  let query = supabase
    .from('students')
    .select('id, full_name, profile_picture, classes(name), parents(full_name, phone_number)')
    .eq('school_id', schoolId)
    .eq('is_graduated', true)
    .order('full_name');

  if (search) query = query.ilike('full_name', `%${search}%`);

  const { data, error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(toCC(data));
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

  // Current year — stamped on graduating students' records
  const { data: school } = await supabase.from('schools').select('current_academic_year').eq('id', schoolId).single();
  const currentYear = school?.current_academic_year || null;

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

  // 3. Graduate selected students
  if (studentIdsToGraduate.length > 0) {
    const today = new Date().toISOString().split('T')[0];
    const { error: gradErr } = await supabase.from('students')
      .update({ is_graduated: true, graduated_at: today, graduation_year: currentYear })
      .in('id', studentIdsToGraduate).eq('school_id', schoolId);
    if (gradErr) { res.status(500).json({ error: gradErr.message }); return; }
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
  const { error } = await supabase.from('users').update({ password_hash: hash }).eq('id', userId).eq('school_id', schoolId);
  if (error) { res.status(500).json({ error: error.message }); return; }
  await supabase.from('password_reset_requests').update({ status: 'resolved' })
    .eq('user_id', userId).eq('school_id', schoolId).eq('status', 'pending');
  notify({ schoolId, userId: userId as string, title: 'Password Reset', message: 'Your password has been reset by the school administrator. Please log in with your new credentials.', type: 'system' }).catch(() => {});
  res.json({ message: 'Password reset successfully' });
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
