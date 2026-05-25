import { safeDbErrorMessage, safeDbErrorStatus } from '../utils/dbErrors';
import { Response } from 'express';
import { safeExt } from '../utils/upload';
import type { AuthRequest } from '../middleware/auth';
import { toCC } from '../utils/transform';
import { notify, notifyMany } from '../utils/notify';
import { subjectAllowedForClass } from '../utils/curriculum';
// Elevated client for STORAGE-only operations — see chat.controller.ts
// for the rationale.
import { adminDb } from '../utils/db';

// ---- TEACHER PROFILE ----
export async function getProfileData(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { data, error } = await req.db!
    .from('teachers')
    .select('id, full_name, subject, teacher_classes(class_id, classes(name)), class_subject_teachers(class_id, subject_id, subjects(id, name))')
    .eq('user_id', userId)
    .eq('school_id', schoolId)
    .single();
  if (error || !data) { res.status(404).json({ error: 'Teacher profile not found' }); return; }

  // Derive the flat subject list + the per-class subject map ("teaching") from the curriculum
  // (class ↔ subject ↔ teacher). teachers.subject is a comma-joined fallback for legacy rows.
  const teachingMap = new Map<string, { id: string; name: string }[]>();
  const allSubjects = new Map<string, string>();
  for (const r of (((data as any).class_subject_teachers ?? []) as any[])) {
    const sid = r.subject_id, sname = r.subjects?.name;
    if (!sid || !sname) continue;
    allSubjects.set(sid, sname);
    if (r.class_id) {
      const arr = teachingMap.get(r.class_id) ?? [];
      if (!arr.some(s => s.id === sid)) arr.push({ id: sid, name: sname });
      teachingMap.set(r.class_id, arr);
    }
  }
  let subjects = Array.from(allSubjects, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  const teaching = Array.from(teachingMap, ([classId, subs]) => ({ classId, subjects: subs.sort((a, b) => a.name.localeCompare(b.name)) }));
  // Legacy fallback: if no curriculum rows exist yet, treat the comma-joined teachers.subject as the options.
  if (subjects.length === 0 && (data as any).subject) {
    subjects = String((data as any).subject).split(',').map((n: string) => n.trim()).filter(Boolean).map((name: string) => ({ id: name, name }));
  }
  const resolvedSubject = subjects.map(s => s.name).join(', ') || (data as any).subject || null;

  const { class_subject_teachers: _cst, ...rest } = data as any;
  res.json({ ...(toCC(rest) as object), subject: resolvedSubject, subjects, teaching });
}

// ---- HOMEWORK ----
export async function getHomework(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { classId } = req.query as Record<string, string>;

  // Get teacher record
  const { data: teacher } = await req.db!.from('teachers').select('id').eq('user_id', userId).eq('school_id', schoolId).single();
  if (!teacher) { res.status(404).json({ error: 'Teacher not found' }); return; }

  let query = req.db!.from('homework').select('*, classes(name)').eq('school_id', schoolId).eq('teacher_id', teacher.id).order('created_at', { ascending: false });
  if (classId) query = query.eq('class_id', classId);

  const { data, error } = await query;
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json(toCC(data));
}

export async function createHomework(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { classId, title, description, dueDate, subject } = req.body;
  // Upload file to Supabase Storage (memory buffer from multer)
  let attachmentUrl: string | null = null;
  const file = (req as any).file;
  if (file) {
    // Storage write via adminDb — authz already enforced by the route
    // (teacher only), path is server-built from JWT schoolId.
    const ext = safeExt(file.originalname, '');
    const storagePath = `${schoolId}/${Date.now()}${ext}`;
    const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'homework-attachments';
    const { data: uploadData, error: uploadErr } = await adminDb.storage
      .from(bucket)
      .upload(storagePath, file.buffer, { contentType: file.mimetype, upsert: false });
    if (!uploadErr && uploadData) {
      const { data: urlData } = adminDb.storage.from(bucket).getPublicUrl(uploadData.path);
      attachmentUrl = urlData.publicUrl;
    }
  }

  const { data: teacher } = await req.db!.from('teachers').select('id').eq('user_id', userId).eq('school_id', schoolId).single();
  if (!teacher) { res.status(404).json({ error: 'Teacher not found' }); return; }
  if (!(await subjectAllowedForClass(schoolId, teacher.id, classId, subject))) {
    res.status(403).json({ error: `You aren't assigned to teach ${subject} for this class.` }); return;
  }

  const { data, error } = await req.db!.from('homework').insert({
    school_id: schoolId,
    teacher_id: teacher.id,
    class_id: classId,
    title,
    description,
    attachment_url: attachmentUrl,
    due_date: dueDate || null,
    subject,
  }).select().single();

  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  // Notify all parents of students in this class (dedupe: one notification per parent, even with multiple children in the class)
  if (classId) {
    const { data: students } = await req.db!
      .from('students')
      .select('parents(user_id)')
      .eq('class_id', classId)
      .eq('school_id', schoolId);
    if (students) {
      const uniqueParentIds = new Set<string>();
      for (const s of students as any[]) {
        const uids: string[] = Array.isArray(s.parents)
          ? s.parents.map((p: any) => p.user_id)
          : s.parents?.user_id ? [s.parents.user_id] : [];
        for (const uid of uids) if (uid) uniqueParentIds.add(uid);
      }
      const message = `${title}${subject ? ` (${subject})` : ''}${dueDate ? ` — due ${dueDate}` : ''}`;
      const payloads = Array.from(uniqueParentIds).map(uid => ({ schoolId, userId: uid, title: 'New Homework', message, type: 'homework', relatedId: data.id }));
      notifyMany(payloads).catch(() => {});
    }
  }

  res.status(201).json(toCC(data));
}

export async function deleteHomework(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { id } = req.params;
  const { data: teacher } = await req.db!.from('teachers').select('id').eq('user_id', userId).eq('school_id', schoolId).single();
  if (!teacher) { res.status(404).json({ error: 'Teacher not found' }); return; }
  const { error } = await req.db!.from('homework').delete().eq('id', id).eq('teacher_id', teacher.id).eq('school_id', schoolId);
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json({ message: 'Homework deleted' });
}

// ---- ASSIGNMENTS ----
export async function getAssignments(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { classId, studentId } = req.query as Record<string, string>;

  const { data: teacher } = await req.db!.from('teachers').select('id').eq('user_id', userId).eq('school_id', schoolId).single();
  if (!teacher) { res.status(404).json({ error: 'Teacher not found' }); return; }

  let query = req.db!.from('assignments').select('*, students(full_name), classes(name)').eq('school_id', schoolId).eq('teacher_id', teacher.id).order('created_at', { ascending: false });
  if (classId) query = query.eq('class_id', classId);
  if (studentId) query = query.eq('student_id', studentId);

  const { data, error } = await query;
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json(toCC(data));
}

export async function createAssignment(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { classId, studentId, title, description, dueDate, subject } = req.body;

  let attachmentUrl: string | null = null;
  const file = (req as any).file;
  if (file) {
    // Storage write via adminDb — authz already enforced by the route
    // (teacher only), path is server-built from JWT schoolId.
    const ext = safeExt(file.originalname, '');
    const storagePath = `${schoolId}/assignments/${Date.now()}${ext}`;
    const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'homework-attachments';
    const { data: uploadData, error: uploadErr } = await adminDb.storage
      .from(bucket)
      .upload(storagePath, file.buffer, { contentType: file.mimetype, upsert: false });
    if (!uploadErr && uploadData) {
      const { data: urlData } = adminDb.storage.from(bucket).getPublicUrl(uploadData.path);
      attachmentUrl = urlData.publicUrl;
    }
  }

  const { data: teacher } = await req.db!.from('teachers').select('id').eq('user_id', userId).eq('school_id', schoolId).single();
  if (!teacher) { res.status(404).json({ error: 'Teacher not found' }); return; }
  if (!(await subjectAllowedForClass(schoolId, teacher.id, classId, subject))) {
    res.status(403).json({ error: `You aren't assigned to teach ${subject} for this class.` }); return;
  }

  const { data, error } = await req.db!.from('assignments').insert({
    school_id: schoolId,
    teacher_id: teacher.id,
    class_id: classId,
    student_id: studentId || null,
    title,
    description,
    due_date: dueDate || null,
    subject,
    attachment_url: attachmentUrl,
  }).select().single();

  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  // Notify parent(s) — dedupe so a parent with multiple children in the class only gets one push
  const targetId = studentId || null;
  const studentsQuery = targetId
    ? req.db!.from('students').select('parents(user_id)').eq('id', targetId)
    : req.db!.from('students').select('parents(user_id)').eq('class_id', classId).eq('school_id', schoolId);
  const { data: assignedStudents } = await studentsQuery;
  if (assignedStudents) {
    const uniqueParentIds = new Set<string>();
    for (const s of assignedStudents as any[]) {
      const uids: string[] = Array.isArray(s.parents) ? s.parents.map((p: any) => p.user_id) : s.parents?.user_id ? [s.parents.user_id] : [];
      for (const uid of uids) if (uid) uniqueParentIds.add(uid);
    }
    const message = `${title}${subject ? ` (${subject})` : ''}${dueDate ? ` — due ${dueDate}` : ''}`;
    const payloads = Array.from(uniqueParentIds).map(uid => ({ schoolId, userId: uid, title: 'New Assignment', message, type: 'assignment', relatedId: data.id }));
    notifyMany(payloads).catch(() => {});
  }

  res.status(201).json(toCC(data));
}

export async function deleteAssignment(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { id } = req.params;
  const { data: teacher } = await req.db!.from('teachers').select('id').eq('user_id', userId).eq('school_id', schoolId).single();
  if (!teacher) { res.status(404).json({ error: 'Teacher not found' }); return; }
  const { error } = await req.db!.from('assignments').delete().eq('id', id).eq('teacher_id', teacher.id).eq('school_id', schoolId);
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json({ message: 'Assignment deleted' });
}

// ---- REPORTS ----
export async function createReport(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { studentId, subject, attendanceNotes, behaviorNotes, marks, teacherNotes } = req.body;

  const [{ data: teacher }, { data: school }, { data: studentRow }] = await Promise.all([
    req.db!.from('teachers').select('id').eq('user_id', userId).eq('school_id', schoolId).single(),
    req.db!.from('schools').select('current_academic_year').eq('id', schoolId).single(),
    req.db!.from('students').select('class_id').eq('id', studentId).eq('school_id', schoolId).maybeSingle(),
  ]);
  if (!teacher) { res.status(404).json({ error: 'Teacher not found' }); return; }
  if (!(await subjectAllowedForClass(schoolId, teacher.id, (studentRow as any)?.class_id, subject))) {
    res.status(403).json({ error: `You aren't assigned to teach ${subject} for this student's class.` }); return;
  }

  const { data, error } = await req.db!.from('reports').insert({
    school_id: schoolId,
    teacher_id: teacher.id,
    student_id: studentId,
    subject,
    attendance_notes: attendanceNotes,
    behavior_notes: behaviorNotes,
    marks: marks || [],
    teacher_notes: teacherNotes,
    academic_year: school?.current_academic_year || null,
  }).select().single();

  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  // Notify parent of this student
  const { data: student } = await req.db!
    .from('students').select('full_name, parents(user_id)').eq('id', studentId).single();
  if (student) {
    const uids: string[] = Array.isArray((student as any).parents)
      ? (student as any).parents.map((p: any) => p.user_id)
      : (student as any).parents?.user_id ? [(student as any).parents.user_id] : [];
    uids.forEach(uid => notify({ schoolId, userId: uid, title: 'New Report', message: `A report has been submitted for ${(student as any).full_name}${subject ? ` in ${subject}` : ''}.`, type: 'report' }).catch(() => {}));
  }

  res.status(201).json(toCC(data));
}

// ---- GRADES ----
export async function upsertGrade(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { studentId, classId, subject, marks, gradingPeriod } = req.body;

  const [teacherRes, schoolRes] = await Promise.all([
    req.db!.from('teachers').select('id').eq('user_id', userId).eq('school_id', schoolId).single(),
    req.db!.from('schools').select('current_academic_year').eq('id', schoolId).single(),
  ]);
  if (!teacherRes.data) { res.status(404).json({ error: 'Teacher not found' }); return; }
  if (!(await subjectAllowedForClass(schoolId, teacherRes.data.id, classId, subject))) {
    res.status(403).json({ error: `You aren't assigned to teach ${subject} for this class.` }); return;
  }
  const academicYear = schoolRes.data?.current_academic_year || null;

  // Grades are gated: a teacher write always lands UNRELEASED (pending admin
  // review). This also means editing an already-released grade reverts it to
  // pending. admin_note is intentionally NOT in the payload, so an admin's
  // note survives a teacher re-edit.
  const { data, error } = await req.db!.from('grades').upsert({
    school_id: schoolId,
    teacher_id: teacherRes.data.id,
    student_id: studentId,
    class_id: classId,
    subject,
    marks: marks || [],
    grading_period: gradingPeriod,
    academic_year: academicYear,
    is_released: false,
    released_at: null,
    released_by: null,
  }, { onConflict: 'student_id,subject,grading_period,academic_year' }).select().single();

  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  // Notify admins that a grade is awaiting review (parents are notified only
  // when an admin releases it — see admin.releaseGrades).
  const { data: gradedStudent } = await req.db!
    .from('students').select('full_name').eq('id', studentId).single();
  const { data: admins } = await req.db!
    .from('users').select('id').eq('school_id', schoolId).eq('role', 'admin').eq('is_active', true);
  if (admins && admins.length > 0) {
    const studentName = (gradedStudent as any)?.full_name || 'a student';
    notifyMany(admins.map((a: any) => ({
      schoolId, userId: a.id,
      title: 'Grades Pending Review',
      message: `Grades for ${studentName} in ${subject} are awaiting your review.`,
      type: 'grade_pending',
    }))).catch(() => {});
  }

  res.json(toCC(data));
}

export async function getGrades(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { studentId } = req.query as Record<string, string>;
  if (!studentId) { res.status(400).json({ error: 'studentId required' }); return; }

  const { data: teacher } = await req.db!.from('teachers').select('id, subject').eq('user_id', userId).eq('school_id', schoolId).single();
  if (!teacher) { res.status(404).json({ error: 'Teacher not found' }); return; }

  // All grades this teacher recorded for the student (across whichever subjects they teach).
  const { data, error } = await req.db!.from('grades')
    .select('id, subject, marks, grading_period, academic_year, is_released, released_at, created_at')
    .eq('school_id', schoolId)
    .eq('student_id', studentId)
    .eq('teacher_id', teacher.id)
    .order('grading_period');

  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json(toCC(data));
}

// ---- WEEKLY SUMMARY ----
export async function upsertWeeklySummary(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { classId, subject, unit, lesson, pages, homeworkReminder } = req.body;

  // Require an active period opened by supervisor
  const { data: period } = await req.db!
    .from('weekly_summary_periods')
    .select('week_start_date')
    .eq('school_id', schoolId)
    .eq('is_open', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!period) { res.status(403).json({ error: 'No active summary period. Supervisor must open one first.' }); return; }

  const weekStartDate = period.week_start_date;
  const { data: teacher } = await req.db!.from('teachers').select('id').eq('user_id', userId).eq('school_id', schoolId).single();
  if (!teacher) { res.status(404).json({ error: 'Teacher not found' }); return; }

  // Delete existing entry for same class+subject+week, then insert fresh
  await req.db!.from('weekly_summaries')
    .delete()
    .eq('class_id', classId)
    .eq('subject', subject)
    .eq('week_start_date', weekStartDate)
    .eq('school_id', schoolId);

  const { data, error } = await req.db!.from('weekly_summaries').insert({
    school_id: schoolId,
    teacher_id: teacher.id,
    class_id: classId,
    subject,
    unit: unit || null,
    lesson: lesson || null,
    pages: pages || null,
    homework_reminder: homeworkReminder || null,
    week_start_date: weekStartDate,
  }).select().single();

  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json(toCC(data));
}

export async function getWeeklySummary(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { classId, weekStartDate } = req.query as Record<string, string>;

  let query = req.db!.from('weekly_summaries').select('*').eq('school_id', schoolId);
  if (classId) query = query.eq('class_id', classId);
  if (weekStartDate) query = query.eq('week_start_date', weekStartDate);

  const { data, error } = await query;
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json(toCC(data));
}

// ---- CLASSES (teacher view — only assigned classes) ----
export async function getMyClasses(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;

  const { data: teacher } = await req.db!
    .from('teachers').select('id').eq('user_id', userId).eq('school_id', schoolId).single();
  if (!teacher) { res.status(404).json({ error: 'Teacher not found' }); return; }

  const { data, error } = await req.db!
    .from('teacher_classes')
    .select('classes(id, name, grade_level, academic_year, created_at)')
    .eq('teacher_id', teacher.id);

  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  const classes = (data || []).map((tc: any) => tc.classes).filter(Boolean);
  res.json(toCC(classes));
}

// ---- ATTENDANCE ----
export async function markAttendance(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { classId, date, records } = req.body as {
    classId: string;
    date: string; // YYYY-MM-DD
    records: { studentId: string; status: 'present' | 'absent' | 'late'; notes?: string }[];
  };

  if (!classId || !date || !Array.isArray(records) || records.length === 0) {
    res.status(400).json({ error: 'classId, date, and records are required' }); return;
  }

  const { data: teacher } = await req.db!.from('teachers').select('id').eq('user_id', userId).eq('school_id', schoolId).single();
  if (!teacher) { res.status(404).json({ error: 'Teacher not found' }); return; }

  // Upsert all records for this class+date
  const rows = records.map(r => ({
    school_id: schoolId,
    student_id: r.studentId,
    class_id: classId,
    teacher_id: teacher.id,
    date,
    status: r.status,
    notes: r.notes || null,
  }));

  const { error } = await req.db!.from('attendance')
    .upsert(rows, { onConflict: 'student_id,class_id,date' });
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  // Notify parents of absent/late students
  const absentOrLate = records.filter(r => r.status !== 'present');
  if (absentOrLate.length > 0) {
    const absentIds = absentOrLate.map(r => r.studentId);
    const { data: students } = await req.db!
      .from('students')
      .select('id, full_name, parents(user_id)')
      .in('id', absentIds)
      .eq('school_id', schoolId);

    if (students) {
      const notifications = students.flatMap((s: any) => {
        const parentUserIds = Array.isArray(s.parents)
          ? s.parents.map((p: any) => p.user_id)
          : s.parents?.user_id ? [s.parents.user_id] : [];
        const record = absentOrLate.find(r => r.studentId === s.id);
        const isLate = record?.status === 'late';
        return parentUserIds.map((uid: string) => ({
          school_id: schoolId,
          user_id: uid,
          title: isLate ? `${s.full_name} Arrived Late` : `${s.full_name} Marked Absent`,
          message: isLate
            ? `${s.full_name} was marked late for class on ${date}.`
            : `${s.full_name} was marked absent from class on ${date}.${record?.notes ? ' Note: ' + record.notes : ''}`,
          notification_type: 'general',
        }));
      });
      if (notifications.length > 0) {
        await req.db!.from('notifications').insert(notifications);
      }
    }
  }

  res.json({ message: 'Attendance saved', count: records.length });
}

export async function getAttendance(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { classId, date } = req.query as Record<string, string>;

  if (!classId || !date) { res.status(400).json({ error: 'classId and date are required' }); return; }

  const { data: teacher } = await req.db!.from('teachers').select('id').eq('user_id', userId).eq('school_id', schoolId).single();
  if (!teacher) { res.status(404).json({ error: 'Teacher not found' }); return; }

  const { data, error } = await req.db!
    .from('attendance')
    .select('*, students(id, full_name, profile_picture)')
    .eq('school_id', schoolId)
    .eq('class_id', classId)
    .eq('date', date);
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json(toCC(data));
}

// ---- STUDENTS (teacher view) ----
export async function getMyStudents(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { search, classId } = req.query as Record<string, string>;

  const { data: teacher } = await req.db!.from('teachers').select('id, teacher_classes(class_id)').eq('user_id', userId).eq('school_id', schoolId).single();
  if (!teacher) { res.status(404).json({ error: 'Teacher not found' }); return; }

  const classIds = (teacher as any).teacher_classes?.map((tc: any) => tc.class_id) ?? [];

  let query = req.db!.from('students').select('id, full_name, profile_picture, class_id, classes(name)').eq('school_id', schoolId).eq('is_graduated', false);

  if (classId) {
    query = query.eq('class_id', classId);
  } else if (classIds.length > 0) {
    query = query.in('class_id', classIds);
  }

  if (search) query = query.or(`full_name.ilike.%${search}%,home_address.ilike.%${search}%`);

  const { data, error } = await query;
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json(toCC(data));
}

// Returns full student detail for the teacher's "students" tab modal:
// student basics + reports authored by THIS teacher + grades for THIS teacher's subject.
// Deliberately excludes parent contact info — teachers shouldn't see parent phones here.
export async function getStudentBrief(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { id: studentId } = req.params;

  const { data: teacher } = await req.db!
    .from('teachers')
    .select('id, teacher_classes(class_id)')
    .eq('user_id', userId).eq('school_id', schoolId).single();
  if (!teacher) { res.status(404).json({ error: 'Teacher not found' }); return; }
  const teacherId = (teacher as any).id;
  const teacherClassIds: string[] = (teacher as any).teacher_classes?.map((tc: any) => tc.class_id) ?? [];

  const { data: student, error: stuErr } = await req.db!
    .from('students')
    .select('id, full_name, profile_picture, class_id, date_of_birth, home_address, phone_number, emergency_contact, is_graduated, classes(name)')
    .eq('id', studentId)
    .eq('school_id', schoolId)
    .single();
  if (stuErr || !student) { res.status(404).json({ error: 'Student not found' }); return; }

  // Authorisation: teacher can only see students in classes they teach.
  if (teacherClassIds.length > 0 && (student as any).class_id && !teacherClassIds.includes((student as any).class_id)) {
    res.status(403).json({ error: 'Forbidden' }); return;
  }

  const [reportsRes, gradesRes] = await Promise.all([
    req.db!
      .from('reports')
      .select('id, subject, attendance_notes, behavior_notes, marks, teacher_notes, report_date, created_at, quiz_marks, exam_marks')
      .eq('school_id', schoolId)
      .eq('student_id', studentId)
      .eq('teacher_id', teacherId)
      .order('created_at', { ascending: false }),
    req.db!
      .from('grades')
      .select('id, subject, marks, grading_period, academic_year, daily_grade, quiz_grade, monthly_exam_grade, term_exam_grade, created_at')
      .eq('school_id', schoolId)
      .eq('student_id', studentId)
      .eq('teacher_id', teacherId)
      .order('created_at', { ascending: false }),
  ]);

  if (reportsRes.error) { res.status(500).json({ error: reportsRes.error.message }); return; }
  if (gradesRes.error) { res.status(500).json({ error: gradesRes.error.message }); return; }

  res.json({
    student: toCC(student),
    reports: toCC(reportsRes.data || []),
    grades: toCC(gradesRes.data || []),
  });
}
