import { Response } from 'express';
import { supabase } from '../config/supabase';
import type { AuthRequest } from '../middleware/auth';
import { toCC } from '../utils/transform';

// ---- CLASSES (all classes in the school) ----
export async function getClasses(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { data, error } = await supabase
    .from('classes')
    .select('id, name, grade_level, academic_year, teacher_classes(teachers(id, full_name))')
    .eq('school_id', schoolId)
    .order('name');
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(toCC(data));
}

// ---- STUDENTS BY CLASS ----
export async function getStudentsByClass(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { classId } = req.params;
  const { data, error } = await supabase
    .from('students')
    .select('id, full_name, profile_picture, parents(full_name, phone_number, user_id)')
    .eq('school_id', schoolId)
    .eq('class_id', classId)
    .eq('is_graduated', false)
    .order('full_name');
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(toCC(data));
}

// ---- ABSENT TODAY (across all classes) ----
export async function getAbsentToday(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const today = new Date().toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('attendance')
    .select('*, students(id, full_name, profile_picture, class_id, classes(name), parents(full_name, phone_number, user_id)), teachers(full_name)')
    .eq('school_id', schoolId)
    .eq('date', today)
    .in('status', ['absent', 'late'])
    .order('created_at', { ascending: false });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(toCC(data));
}

// ---- ATTENDANCE BY CLASS + DATE ----
export async function getAttendanceByClass(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { classId, date } = req.query as Record<string, string>;

  if (!classId || !date) { res.status(400).json({ error: 'classId and date are required' }); return; }

  const { data, error } = await supabase
    .from('attendance')
    .select('*, students(id, full_name, profile_picture), teachers(full_name)')
    .eq('school_id', schoolId)
    .eq('class_id', classId)
    .eq('date', date)
    .order('created_at');
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(toCC(data));
}

// ---- ATTENDANCE SUMMARY (absent count per class for a date) ----
export async function getAttendanceSummary(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { date } = req.query as Record<string, string>;
  const targetDate = date || new Date().toISOString().split('T')[0];

  // Get all classes
  const { data: classes } = await supabase
    .from('classes')
    .select('id, name, grade_level')
    .eq('school_id', schoolId)
    .order('name');

  if (!classes) { res.json([]); return; }

  // Get attendance counts per class for the date
  const { data: records } = await supabase
    .from('attendance')
    .select('class_id, status')
    .eq('school_id', schoolId)
    .eq('date', targetDate);

  const summary = classes.map(cls => {
    const classRecords = (records || []).filter((r: any) => r.class_id === cls.id);
    return {
      ...cls,
      present: classRecords.filter((r: any) => r.status === 'present').length,
      absent: classRecords.filter((r: any) => r.status === 'absent').length,
      late: classRecords.filter((r: any) => r.status === 'late').length,
      total: classRecords.length,
    };
  });

  res.json(toCC(summary));
}

// ---- HOMEWORK (all school homework, read + delete) ----
export async function getHomework(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { data, error } = await supabase
    .from('homework')
    .select('id, title, description, subject, due_date, created_at, teachers(full_name), classes(name)')
    .eq('school_id', schoolId)
    .order('created_at', { ascending: false });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(toCC(data));
}

export async function deleteHomework(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  const { error } = await supabase.from('homework').delete().eq('id', id).eq('school_id', schoolId);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ success: true });
}

// ---- ASSIGNMENTS (all school assignments, read + delete) ----
export async function getAssignments(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { data, error } = await supabase
    .from('assignments')
    .select('id, title, description, subject, due_date, created_at, teachers(full_name), classes(name)')
    .eq('school_id', schoolId)
    .order('created_at', { ascending: false });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(toCC(data));
}

export async function deleteAssignment(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  const { error } = await supabase.from('assignments').delete().eq('id', id).eq('school_id', schoolId);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ success: true });
}

// ---- OVERRIDE ATTENDANCE (supervisor can correct a record) ----
export async function updateAttendanceRecord(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { id } = req.params;
  const { status, notes } = req.body;

  if (!status || !['present', 'absent', 'late'].includes(status)) {
    res.status(400).json({ error: 'Valid status (present, absent, late) is required' }); return;
  }

  const { data, error } = await supabase
    .from('attendance')
    .update({ status, notes: notes || null })
    .eq('id', id)
    .eq('school_id', schoolId)
    .select()
    .single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(toCC(data));
}
