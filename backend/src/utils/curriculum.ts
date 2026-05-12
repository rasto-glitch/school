import { supabase } from '../config/supabase';

/**
 * Lenient curriculum check used by content-creation endpoints (homework, assignments, grades,
 * reports, weekly summaries, academic posts).
 *
 * If the teacher has any `class_subject_teachers` rows for `classId`, the chosen `subjectName`
 * must be one of them. If they have none for that class, anything is allowed — so schools that
 * haven't filled in the curriculum yet are never blocked.
 */
export async function subjectAllowedForClass(
  schoolId: string,
  teacherId: string,
  classId: string | null | undefined,
  subjectName: string | null | undefined,
): Promise<boolean> {
  if (!classId || !subjectName) return true;
  const { data } = await supabase
    .from('class_subject_teachers')
    .select('subjects(name)')
    .eq('school_id', schoolId)
    .eq('teacher_id', teacherId)
    .eq('class_id', classId);
  const rows = (data ?? []) as any[];
  if (rows.length === 0) return true;
  return new Set(rows.map(r => r.subjects?.name).filter(Boolean)).has(subjectName);
}
