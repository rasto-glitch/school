// Helpers for the per-class subject picker on teacher content screens.
// Mirrors the lenient backend rule: if the teacher has any curriculum rows for the
// chosen class, only those subjects are offered; otherwise fall back to their full
// subject list (so schools without curriculum filled in yet aren't blocked).

export type SubjectOpt = { id: string; name: string };
export type TeachingEntry = { classId: string; subjects: SubjectOpt[] };

export function subjectsForClass(
  teaching: TeachingEntry[] | undefined,
  allSubjects: SubjectOpt[] | undefined,
  classId: string | null | undefined,
): SubjectOpt[] {
  if (classId && teaching) {
    const entry = teaching.find(t => t.classId === classId);
    if (entry && entry.subjects.length) return entry.subjects;
  }
  return allSubjects ?? [];
}
