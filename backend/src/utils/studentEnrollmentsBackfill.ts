// One-off backfill helper for student_enrollments (migration 030).
//
// Reconstructs per-year academic progression for students who pre-date the
// new table. Two paths:
//   • Live students (active + graduated): insert rows into
//     student_enrollments.
//   • Archived students: populate archived_students.enrollment_history
//     JSONB from the legacy classes_attended JSONB + existing grades.
//
// Inference rules (locked design, see memory/student-transfer-plan.md):
//   • Per (student, year) we keep ONE class — the dominant one by signal
//     count (grade rows + attendance rows pointing to it). Ties broken by
//     most-recent created_at on the underlying grade row.
//   • grade_level frozen from classes.grade_level at backfill time, falling
//     back to class.name when null (no NOT NULL violations).
//   • Between adjacent years: same grade_level → 'retained', different →
//     'promoted'. We don't try to detect "skipped a grade" — for the
//     backfill, every forward transition is 'promoted'.
//   • Final year status:
//      - active, not graduated → 'promoted' for the closed past year + an
//        additional 'enrolled' row for the current academic year using
//        students.class_id when set.
//      - graduated → 'graduated' (closed at the snapshot/known graduation date)
//      - archived → archive_students.reason ('transferred' | 'withdrew')
//   • Gaps (years with no signal) are left as missing rows — the user
//     locked "missing year is a gap, not an auto-inferred on_leave".
//
// Idempotency:
//   • Live students with any existing student_enrollments row are skipped.
//   • Archived students with a non-empty enrollment_history JSONB are
//     skipped.

import { adminDb as supabase } from './db';
import { logger } from './logger';
import {
  academicYearOf,
  resolveCurrentAcademicYear,
  academicYearStartDate,
  type EnrollmentSnapshotEntry,
  type EnrollmentStatus,
} from './studentEnrollments';

type ClassInfo = { id: string; name: string; gradeLevel: string };

export interface BackfillIssue {
  studentId: string;
  studentName: string;
  kind: 'no_data' | 'ambiguous_year' | 'missing_grade_level' | 'unknown_class' | 'insert_failed';
  details: string;
}

export interface BackfillResult {
  dryRun: boolean;
  liveStudentsScanned: number;
  liveStudentsProcessed: number;
  liveRowsInserted: number;
  liveSkippedAlreadyHasRows: number;
  issues: BackfillIssue[];
}

function toAcademicYearFromDate(date: string | null | undefined): string | null {
  if (!date) return null;
  return academicYearOf(date);
}

// Aggregate signals per (year, class_id) → count.
type YearClassMap = Map<string, Map<string, { count: number; mostRecent: string }>>;

function addSignal(map: YearClassMap, year: string, classId: string, createdAt: string): void {
  let perYear = map.get(year);
  if (!perYear) { perYear = new Map(); map.set(year, perYear); }
  const cur = perYear.get(classId);
  if (!cur) {
    perYear.set(classId, { count: 1, mostRecent: createdAt });
  } else {
    cur.count += 1;
    if (createdAt > cur.mostRecent) cur.mostRecent = createdAt;
  }
}

// Pick the dominant class for a year. Tie-break by most-recent created_at.
function dominantClass(perYear: Map<string, { count: number; mostRecent: string }>): string | null {
  let best: { classId: string; count: number; mostRecent: string } | null = null;
  for (const [classId, val] of perYear.entries()) {
    if (!best || val.count > best.count ||
        (val.count === best.count && val.mostRecent > best.mostRecent)) {
      best = { classId, count: val.count, mostRecent: val.mostRecent };
    }
  }
  return best ? best.classId : null;
}

// Compare grade levels for promotion inference. We do simple string compare;
// "Grade 7" < "Grade 8" works for the common case. When non-comparable we
// default to 'promoted' (the more common transition).
function inferTransitionStatus(prev: string, next: string): 'promoted' | 'retained' {
  return prev === next ? 'retained' : 'promoted';
}

function classRefFor(classId: string, classById: Map<string, ClassInfo>): ClassInfo | null {
  return classById.get(classId) ?? null;
}

interface StudentBuildInput {
  studentId: string;
  studentName: string;
  // grades + attendance rows already filtered to this student.
  grades: Array<{ academic_year: string | null; class_id: string | null; created_at: string }>;
  attendance: Array<{ date: string; class_id: string | null }>;
  // For ACTIVE + GRADUATED:
  liveClassId?: string | null;        // students.class_id
  isGraduated?: boolean;
  // For ARCHIVED:
  legacyClassesAttended?: Array<{ year?: string; classId?: string; className?: string }>;
  archiveReason?: 'transferred' | 'withdrew' | 'graduated';
  archiveDepartureDate?: string | null;
  classById: Map<string, ClassInfo>;
  // HD-4: caller resolves the school's authoritative current year once
  // and passes it in so buildHistory stays synchronous and we don't
  // hammer the schools table per student.
  currentYear: string;
}

interface BuildResult {
  rows: EnrollmentSnapshotEntry[];
  issues: BackfillIssue[];
}

// Core inference. Builds the per-year rows for one student.
function buildHistory(input: StudentBuildInput): BuildResult {
  const issues: BackfillIssue[] = [];
  const map: YearClassMap = new Map();

  // Pull signals from grades.
  for (const g of input.grades) {
    const classId = g.class_id;
    if (!classId) continue;
    const year = g.academic_year || toAcademicYearFromDate(g.created_at);
    if (!year) continue;
    addSignal(map, year, classId, g.created_at);
  }
  // Pull signals from attendance.
  for (const a of input.attendance) {
    const classId = a.class_id;
    if (!classId) continue;
    const year = toAcademicYearFromDate(a.date);
    if (!year) continue;
    addSignal(map, year, classId, a.date);
  }
  // For archived students, fold in the legacy JSONB.
  for (const c of input.legacyClassesAttended || []) {
    if (!c.classId || !c.year) continue;
    // Treat each JSONB entry as a single signal at an artificial mid-year date.
    addSignal(map, c.year, c.classId, `${c.year.split('-')[0]}-12-01`);
  }

  // Collect per-year dominant class.
  type YearRow = { year: string; classId: string; classInfo: ClassInfo };
  const years: YearRow[] = [];
  for (const [year, perYear] of Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    if (perYear.size > 1) {
      issues.push({
        studentId: input.studentId, studentName: input.studentName,
        kind: 'ambiguous_year',
        details: `Year ${year} has ${perYear.size} class candidates; using the dominant one.`,
      });
    }
    const classId = dominantClass(perYear);
    if (!classId) continue;
    const classInfo = classRefFor(classId, input.classById);
    if (!classInfo) {
      issues.push({
        studentId: input.studentId, studentName: input.studentName,
        kind: 'unknown_class',
        details: `Year ${year} references class ${classId} which is not in the classes table.`,
      });
      continue;
    }
    years.push({ year, classId, classInfo });
  }

  // For graduated/archived students with no signals at all, no history to write.
  if (years.length === 0 && !input.liveClassId) {
    if (input.archiveReason || input.isGraduated) {
      issues.push({
        studentId: input.studentId, studentName: input.studentName,
        kind: 'no_data',
        details: 'No grades, attendance, or legacy classes_attended found — cannot reconstruct history.',
      });
    }
    return { rows: [], issues };
  }

  const rows: EnrollmentSnapshotEntry[] = [];

  // Emit intermediate years.
  for (let i = 0; i < years.length; i++) {
    const cur = years[i];
    const next = years[i + 1];
    const isFinalSignalYear = i === years.length - 1;

    let status: EnrollmentStatus;
    let endedOn: string | null;

    if (!isFinalSignalYear && next) {
      status = inferTransitionStatus(cur.classInfo.gradeLevel, next.classInfo.gradeLevel);
      endedOn = academicYearStartDate(next.year);
    } else {
      // Final signal year. The status depends on the student kind.
      if (input.archiveReason) {
        // Archived: final year inherits the archive reason.
        status = input.archiveReason as EnrollmentStatus;
        endedOn = input.archiveDepartureDate ||
                  `${cur.year.split('-')[1]}-06-30`;
      } else if (input.isGraduated) {
        status = 'graduated';
        endedOn = `${cur.year.split('-')[1]}-06-30`;
      } else {
        // Active: this past year was closed; assume promoted (we'll then
        // add a fresh 'enrolled' row for the current year below if needed).
        const currentYear = input.currentYear;
        if (cur.year === currentYear) {
          status = 'enrolled';
          endedOn = null;
        } else {
          status = 'promoted';
          endedOn = `${cur.year.split('-')[1]}-06-30`;
        }
      }
    }

    rows.push({
      academicYear: cur.year,
      gradeLevel: cur.classInfo.gradeLevel,
      classId: cur.classInfo.id,
      className: cur.classInfo.name,
      status,
      startedOn: academicYearStartDate(cur.year),
      endedOn,
      // Backfilled rows have no frozen totals — they were built from
      // grade-level signals, not from a real attendance count.
      attendanceTotals: null,
    });
  }

  // For ACTIVE (not graduated) students, ensure there's an 'enrolled' row
  // for the current academic year that points at students.class_id.
  if (input.liveClassId && !input.isGraduated && !input.archiveReason) {
    const currentYear = input.currentYear;
    const lastRow = rows[rows.length - 1];
    const liveClass = classRefFor(input.liveClassId, input.classById);
    if (liveClass) {
      if (lastRow && lastRow.academicYear === currentYear) {
        // The current year is already represented (from grade signals).
        // Update it to point at the live class if different + mark enrolled.
        lastRow.classId = liveClass.id;
        lastRow.className = liveClass.name;
        lastRow.gradeLevel = liveClass.gradeLevel;
        lastRow.status = 'enrolled';
        lastRow.endedOn = null;
      } else {
        rows.push({
          academicYear: currentYear,
          gradeLevel: liveClass.gradeLevel,
          classId: liveClass.id,
          className: liveClass.name,
          status: 'enrolled',
          startedOn: academicYearStartDate(currentYear),
          endedOn: null,
          attendanceTotals: null,
        });
      }
    }
  }

  return { rows, issues };
}

// Main entrypoint — backfill one school. Returns counts + cleanup report.
export async function backfillSchoolEnrollments(
  schoolId: string,
  options: { dryRun?: boolean } = {},
): Promise<BackfillResult> {
  const dryRun = !!options.dryRun;
  const result: BackfillResult = {
    dryRun,
    liveStudentsScanned: 0, liveStudentsProcessed: 0,
    liveRowsInserted: 0, liveSkippedAlreadyHasRows: 0,
    issues: [],
  };

  // 1. Reference data. We intentionally do NOT touch archived_students:
  // those rows are append-only (migration 016 prevent_archive_mutation
  // trigger) and the project's locked decision is "old archives stay as
  // they are". Their UI display falls back to the legacy classes_attended
  // JSONB. The integrity hash _canon_archived_student stays untouched.
  const [{ data: classRows }, { data: liveStudents }, { data: existingEnrollments }] = await Promise.all([
    supabase.from('classes').select('id, name, grade_level').eq('school_id', schoolId),
    supabase.from('students').select('id, full_name, class_id, is_graduated').eq('school_id', schoolId),
    supabase.from('student_enrollments').select('student_id').eq('school_id', schoolId),
  ]);

  const classById = new Map<string, ClassInfo>();
  for (const c of (classRows || []) as any[]) {
    const gradeLevel = (c.grade_level as string | null) || c.name;
    if (!c.grade_level) {
      result.issues.push({
        studentId: '', studentName: '',
        kind: 'missing_grade_level',
        details: `Class "${c.name}" has no grade_level — using class name as fallback.`,
      });
    }
    classById.set(c.id, { id: c.id, name: c.name, gradeLevel });
  }
  // Dedup the missing-grade-level issues so we report once per class, not per student.
  const seenMgl = new Set<string>();
  result.issues = result.issues.filter(i => {
    if (i.kind !== 'missing_grade_level') return true;
    if (seenMgl.has(i.details)) return false;
    seenMgl.add(i.details);
    return true;
  });

  // Resolve the school's authoritative current year once for every
  // buildHistory call below (HD-4 / migration 042).
  const currentYear = await resolveCurrentAcademicYear(schoolId);

  const studentsWithRows = new Set((existingEnrollments || []).map((r: any) => r.student_id));
  result.liveStudentsScanned = (liveStudents || []).length;

  const liveToProcess = (liveStudents || []).filter((s: any) => !studentsWithRows.has(s.id));
  result.liveSkippedAlreadyHasRows = result.liveStudentsScanned - liveToProcess.length;
  const liveIds = liveToProcess.map((s: any) => s.id);

  // Load grades + attendance for these students.
  const [{ data: grades }, { data: attendance }] = await Promise.all([
    liveIds.length
      ? supabase.from('grades')
          .select('student_id, class_id, academic_year, created_at')
          .in('student_id', liveIds).eq('school_id', schoolId)
      : Promise.resolve({ data: [] as any[] }),
    liveIds.length
      ? supabase.from('attendance')
          .select('student_id, class_id, date')
          .in('student_id', liveIds).eq('school_id', schoolId)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  // Group grades + attendance by student.
  const gradesBy = new Map<string, any[]>();
  for (const g of grades || []) {
    if (!gradesBy.has(g.student_id)) gradesBy.set(g.student_id, []);
    gradesBy.get(g.student_id)!.push(g);
  }
  const attBy = new Map<string, any[]>();
  for (const a of attendance || []) {
    if (!attBy.has(a.student_id)) attBy.set(a.student_id, []);
    attBy.get(a.student_id)!.push(a);
  }

  // Process live students.
  const liveInserts: any[] = [];
  for (const s of liveToProcess) {
    const build = buildHistory({
      studentId: s.id,
      studentName: s.full_name || '(unnamed)',
      grades: gradesBy.get(s.id) || [],
      attendance: attBy.get(s.id) || [],
      liveClassId: s.class_id,
      isGraduated: !!s.is_graduated,
      classById,
      currentYear,
    });
    result.issues.push(...build.issues);
    if (build.rows.length === 0) continue;
    result.liveStudentsProcessed++;
    for (const row of build.rows) {
      liveInserts.push({
        school_id: schoolId,
        student_id: s.id,
        academic_year: row.academicYear,
        class_id: row.classId,
        class_name_snapshot: row.className,
        grade_level: row.gradeLevel,
        status: row.status,
        started_on: row.startedOn,
        ended_on: row.endedOn,
      });
    }
  }
  // Commit phase. Live students only — archived rows are append-only and
  // their display already falls back to the legacy classes_attended JSONB
  // in the UI.
  //
  // Race-safe insert. Between the initial "students with no rows" SELECT
  // and this commit, other flows can insert a row for one of those
  // students (createStudent, class change, etc. → openEnrollmentForCurrentYear).
  // A plain INSERT would atomically fail the whole batch on the first
  // collision and lose the other 70+ rows. Use `ON CONFLICT DO NOTHING`
  // (Supabase: upsert + ignoreDuplicates) so colliding rows are skipped
  // silently and the rest commit. The returned rows reflect ONLY newly
  // inserted rows, so we count those for an accurate report.
  if (dryRun) {
    result.liveRowsInserted = liveInserts.length;
  } else if (liveInserts.length > 0) {
    const CHUNK = 500;
    let inserted = 0;
    for (let i = 0; i < liveInserts.length; i += CHUNK) {
      const slice = liveInserts.slice(i, i + CHUNK);
      const { data, error } = await supabase
        .from('student_enrollments')
        .upsert(slice, { onConflict: 'student_id,academic_year', ignoreDuplicates: true })
        .select('id');
      if (error) {
        logger.error('[backfill] insert failed', { schoolId, error: error.message, count: slice.length });
        result.issues.push({
          studentId: '', studentName: '',
          kind: 'insert_failed',
          details: `Batch insert failed: ${error.message}`,
        });
      } else {
        inserted += data?.length ?? 0;
      }
    }
    result.liveRowsInserted = inserted;
    // Flag when concurrent inserts cost us rows so the operator can re-run.
    const skipped = liveInserts.length - inserted;
    if (skipped > 0 && result.issues.every(i => i.kind !== 'insert_failed')) {
      result.issues.push({
        studentId: '', studentName: '',
        kind: 'insert_failed',
        details: `${skipped} planned row(s) collided with concurrent inserts and were skipped. Re-run to retry the affected students.`,
      });
    }
  }

  return result;
}
