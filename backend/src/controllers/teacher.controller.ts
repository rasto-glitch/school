import { Response } from 'express';
import { supabase } from '../config/supabase';
import type { AuthRequest } from '../middleware/auth';
import { toCC } from '../utils/transform';

// ---- TEACHER PROFILE ----
export async function getProfileData(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { data, error } = await supabase
    .from('teachers')
    .select('id, full_name, subject, teacher_classes(class_id, classes(name))')
    .eq('user_id', userId)
    .eq('school_id', schoolId)
    .single();
  if (error || !data) { res.status(404).json({ error: 'Teacher profile not found' }); return; }

  // Also look up subject from the subjects table (admin-assigned)
  const { data: subjectRow } = await supabase
    .from('subjects')
    .select('name')
    .eq('teacher_id', data.id)
    .eq('school_id', schoolId)
    .limit(1)
    .maybeSingle();

  // Prefer subjects-table name, fall back to teachers.subject text field
  const resolvedSubject = subjectRow?.name || (data as any).subject || null;

  const profile = { ...(toCC(data) as object), subject: resolvedSubject };
  res.json(profile);
}

// ---- HOMEWORK ----
export async function getHomework(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { classId } = req.query as Record<string, string>;

  // Get teacher record
  const { data: teacher } = await supabase.from('teachers').select('id').eq('user_id', userId).eq('school_id', schoolId).single();
  if (!teacher) { res.status(404).json({ error: 'Teacher not found' }); return; }

  let query = supabase.from('homework').select('*, classes(name)').eq('school_id', schoolId).eq('teacher_id', teacher.id).order('created_at', { ascending: false });
  if (classId) query = query.eq('class_id', classId);

  const { data, error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(toCC(data));
}

export async function createHomework(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { classId, title, description, dueDate, subject } = req.body;
  // Upload file to Supabase Storage (memory buffer from multer)
  let attachmentUrl: string | null = null;
  const file = (req as any).file;
  if (file) {
    const ext = file.originalname.includes('.') ? '.' + file.originalname.split('.').pop() : '';
    const storagePath = `${schoolId}/${Date.now()}${ext}`;
    const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'homework-attachments';
    const { data: uploadData, error: uploadErr } = await supabase.storage
      .from(bucket)
      .upload(storagePath, file.buffer, { contentType: file.mimetype, upsert: false });
    if (!uploadErr && uploadData) {
      const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(uploadData.path);
      attachmentUrl = urlData.publicUrl;
    }
  }

  const { data: teacher } = await supabase.from('teachers').select('id').eq('user_id', userId).eq('school_id', schoolId).single();
  if (!teacher) { res.status(404).json({ error: 'Teacher not found' }); return; }

  const { data, error } = await supabase.from('homework').insert({
    school_id: schoolId,
    teacher_id: teacher.id,
    class_id: classId,
    title,
    description,
    attachment_url: attachmentUrl,
    due_date: dueDate,
    subject,
  }).select().single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(201).json(toCC(data));
}

export async function deleteHomework(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { id } = req.params;
  const { data: teacher } = await supabase.from('teachers').select('id').eq('user_id', userId).eq('school_id', schoolId).single();
  if (!teacher) { res.status(404).json({ error: 'Teacher not found' }); return; }
  const { error } = await supabase.from('homework').delete().eq('id', id).eq('teacher_id', teacher.id).eq('school_id', schoolId);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ message: 'Homework deleted' });
}

// ---- ASSIGNMENTS ----
export async function getAssignments(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { classId, studentId } = req.query as Record<string, string>;

  const { data: teacher } = await supabase.from('teachers').select('id').eq('user_id', userId).eq('school_id', schoolId).single();
  if (!teacher) { res.status(404).json({ error: 'Teacher not found' }); return; }

  let query = supabase.from('assignments').select('*, students(full_name), classes(name)').eq('school_id', schoolId).eq('teacher_id', teacher.id).order('created_at', { ascending: false });
  if (classId) query = query.eq('class_id', classId);
  if (studentId) query = query.eq('student_id', studentId);

  const { data, error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(toCC(data));
}

export async function createAssignment(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { classId, studentId, title, description, dueDate, subject } = req.body;

  const { data: teacher } = await supabase.from('teachers').select('id').eq('user_id', userId).eq('school_id', schoolId).single();
  if (!teacher) { res.status(404).json({ error: 'Teacher not found' }); return; }

  const { data, error } = await supabase.from('assignments').insert({
    school_id: schoolId,
    teacher_id: teacher.id,
    class_id: classId,
    student_id: studentId || null,
    title,
    description,
    due_date: dueDate,
    subject,
  }).select().single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(201).json(toCC(data));
}

export async function deleteAssignment(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { id } = req.params;
  const { data: teacher } = await supabase.from('teachers').select('id').eq('user_id', userId).eq('school_id', schoolId).single();
  if (!teacher) { res.status(404).json({ error: 'Teacher not found' }); return; }
  const { error } = await supabase.from('assignments').delete().eq('id', id).eq('teacher_id', teacher.id).eq('school_id', schoolId);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ message: 'Assignment deleted' });
}

// ---- REPORTS ----
export async function createReport(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { studentId, subject, attendanceNotes, behaviorNotes, quizMarks, examMarks, teacherNotes } = req.body;

  const [{ data: teacher }, { data: school }] = await Promise.all([
    supabase.from('teachers').select('id').eq('user_id', userId).eq('school_id', schoolId).single(),
    supabase.from('schools').select('current_academic_year').eq('id', schoolId).single(),
  ]);
  if (!teacher) { res.status(404).json({ error: 'Teacher not found' }); return; }

  const { data, error } = await supabase.from('reports').insert({
    school_id: schoolId,
    teacher_id: teacher.id,
    student_id: studentId,
    subject,
    attendance_notes: attendanceNotes,
    behavior_notes: behaviorNotes,
    quiz_marks: quizMarks,
    exam_marks: examMarks,
    teacher_notes: teacherNotes,
    academic_year: school?.current_academic_year || null,
  }).select().single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(201).json(toCC(data));
}

// ---- GRADES ----
export async function upsertGrade(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { studentId, classId, subject, dailyGrade, quizGrade, monthlyExamGrade, termExamGrade, gradingPeriod } = req.body;

  const [teacherRes, schoolRes] = await Promise.all([
    supabase.from('teachers').select('id').eq('user_id', userId).eq('school_id', schoolId).single(),
    supabase.from('schools').select('current_academic_year').eq('id', schoolId).single(),
  ]);
  if (!teacherRes.data) { res.status(404).json({ error: 'Teacher not found' }); return; }
  const academicYear = schoolRes.data?.current_academic_year || null;

  const { data, error } = await supabase.from('grades').upsert({
    school_id: schoolId,
    teacher_id: teacherRes.data.id,
    student_id: studentId,
    class_id: classId,
    subject,
    daily_grade: dailyGrade,
    quiz_grade: quizGrade,
    monthly_exam_grade: monthlyExamGrade,
    term_exam_grade: termExamGrade ?? 0,
    grading_period: gradingPeriod,
    academic_year: academicYear,
  }, { onConflict: 'student_id,subject,grading_period,academic_year' }).select().single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(toCC(data));
}

export async function getGrades(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { studentId } = req.query as Record<string, string>;
  if (!studentId) { res.status(400).json({ error: 'studentId required' }); return; }

  const { data: teacher } = await supabase.from('teachers').select('id, subject').eq('user_id', userId).eq('school_id', schoolId).single();
  if (!teacher) { res.status(404).json({ error: 'Teacher not found' }); return; }

  const { data, error } = await supabase.from('grades')
    .select('*')
    .eq('school_id', schoolId)
    .eq('student_id', studentId)
    .eq('subject', teacher.subject)
    .order('grading_period');

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(toCC(data));
}

// ---- WEEKLY SUMMARY ----
export async function upsertWeeklySummary(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { classId, subject, unit, lesson, pages, homeworkReminder, weekStartDate } = req.body;

  const { data: teacher } = await supabase.from('teachers').select('id').eq('user_id', userId).eq('school_id', schoolId).single();
  if (!teacher) { res.status(404).json({ error: 'Teacher not found' }); return; }

  // Delete existing entry for same class+subject+week, then insert fresh
  await supabase.from('weekly_summaries')
    .delete()
    .eq('class_id', classId)
    .eq('subject', subject)
    .eq('week_start_date', weekStartDate)
    .eq('school_id', schoolId);

  const { data, error } = await supabase.from('weekly_summaries').insert({
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

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(toCC(data));
}

export async function getWeeklySummary(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { classId, weekStartDate } = req.query as Record<string, string>;

  let query = supabase.from('weekly_summaries').select('*').eq('school_id', schoolId);
  if (classId) query = query.eq('class_id', classId);
  if (weekStartDate) query = query.eq('week_start_date', weekStartDate);

  const { data, error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(toCC(data));
}

// ---- CLASSES (teacher view — only assigned classes) ----
export async function getMyClasses(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;

  const { data: teacher } = await supabase
    .from('teachers').select('id').eq('user_id', userId).eq('school_id', schoolId).single();
  if (!teacher) { res.status(404).json({ error: 'Teacher not found' }); return; }

  const { data, error } = await supabase
    .from('teacher_classes')
    .select('classes(id, name, grade_level, academic_year, created_at)')
    .eq('teacher_id', teacher.id);

  if (error) { res.status(500).json({ error: error.message }); return; }

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

  const { data: teacher } = await supabase.from('teachers').select('id').eq('user_id', userId).eq('school_id', schoolId).single();
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

  const { error } = await supabase.from('attendance')
    .upsert(rows, { onConflict: 'student_id,class_id,date' });
  if (error) { res.status(500).json({ error: error.message }); return; }

  // Notify parents of absent/late students
  const absentOrLate = records.filter(r => r.status !== 'present');
  if (absentOrLate.length > 0) {
    const absentIds = absentOrLate.map(r => r.studentId);
    const { data: students } = await supabase
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
        await supabase.from('notifications').insert(notifications);
      }
    }
  }

  res.json({ message: 'Attendance saved', count: records.length });
}

export async function getAttendance(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { classId, date } = req.query as Record<string, string>;

  if (!classId || !date) { res.status(400).json({ error: 'classId and date are required' }); return; }

  const { data: teacher } = await supabase.from('teachers').select('id').eq('user_id', userId).eq('school_id', schoolId).single();
  if (!teacher) { res.status(404).json({ error: 'Teacher not found' }); return; }

  const { data, error } = await supabase
    .from('attendance')
    .select('*, students(id, full_name, profile_picture)')
    .eq('school_id', schoolId)
    .eq('class_id', classId)
    .eq('date', date);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(toCC(data));
}

// ---- STUDENTS (teacher view) ----
export async function getMyStudents(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const { search, classId } = req.query as Record<string, string>;

  const { data: teacher } = await supabase.from('teachers').select('id, teacher_classes(class_id)').eq('user_id', userId).eq('school_id', schoolId).single();
  if (!teacher) { res.status(404).json({ error: 'Teacher not found' }); return; }

  const classIds = (teacher as any).teacher_classes?.map((tc: any) => tc.class_id) ?? [];

  let query = supabase.from('students').select('*, classes(name), reports(*), grades(*)').eq('school_id', schoolId).eq('is_graduated', false);

  if (classId) {
    query = query.eq('class_id', classId);
  } else if (classIds.length > 0) {
    query = query.in('class_id', classIds);
  }

  if (search) query = query.or(`full_name.ilike.%${search}%,home_address.ilike.%${search}%`);

  const { data, error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(toCC(data));
}
