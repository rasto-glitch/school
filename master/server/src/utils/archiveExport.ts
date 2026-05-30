// PDF + Excel exports of a school's archived and graduated student records.
// Mirrors backend/src/utils/archiveExport.ts but uses the master server's own
// Supabase client. Kept duplicated rather than shared because master is a
// local-only workspace with no shared package boundary to backend/.

import * as XLSX from 'xlsx';
import PDFDocument from 'pdfkit';
import { SupabaseClient } from '@supabase/supabase-js';

export interface ArchiveSnapshot {
  schoolName: string;
  generatedAt: string;
  archived: ArchivedRecord[];
  graduated: GraduatedRecord[];
}

// Per-year academic progression entry (migration 030 on the school portal).
// Mirrors the shape stored in archived_students.enrollment_history JSONB
// and produced by student_enrollments-derived snapshots.
interface EnrollmentEntry {
  academicYear: string;
  gradeLevel: string;
  classId: string | null;
  className: string | null;
  status: string;
  startedOn: string | null;
  endedOn: string | null;
}

interface ArchivedRecord {
  fullName: string;
  dateOfBirth: string | null;
  enrollmentDate: string | null;
  departureDate: string | null;
  reason: string | null;
  parentFullName: string | null;
  parentPhone: string | null;
  enrollmentHistory: EnrollmentEntry[];
  grades: GradeRow[];
}

interface GraduatedRecord {
  fullName: string;
  dateOfBirth: string | null;
  enrollmentDate: string | null;
  className: string | null;
  parentFullName: string | null;
  parentPhone: string | null;
  enrollmentHistory: EnrollmentEntry[];
  grades: GradeRow[];
}

interface GradeRow {
  academicYear: string | null;
  gradingPeriod: string | null;
  subject: string | null;
  className: string | null;
  marks: { name: string; value: number | null }[];
  dailyGrade: number | null;
  quizGrade: number | null;
  monthlyExamGrade: number | null;
  termExamGrade: number | null;
}

function synthesiseFromLegacy(
  legacy: Array<{ year?: string; classId?: string; className?: string }>,
): EnrollmentEntry[] {
  return legacy
    .filter(c => c && c.year)
    .sort((a, b) => (a.year || '').localeCompare(b.year || ''))
    .map(c => ({
      academicYear: String(c.year),
      gradeLevel: c.className ? String(c.className) : '(unknown)',
      classId: c.classId ? String(c.classId) : null,
      className: c.className ? String(c.className) : null,
      status: 'enrolled',
      startedOn: null,
      endedOn: null,
    }));
}

function normaliseHistory(raw: unknown): EnrollmentEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r: any) => r && typeof r === 'object' && r.academicYear)
    .map((r: any) => ({
      academicYear: String(r.academicYear),
      gradeLevel: r.gradeLevel ? String(r.gradeLevel) : '(unknown)',
      classId: r.classId ? String(r.classId) : null,
      className: r.className ? String(r.className) : null,
      status: r.status ? String(r.status) : 'enrolled',
      startedOn: r.startedOn ? String(r.startedOn) : null,
      endedOn: r.endedOn ? String(r.endedOn) : null,
    }))
    .sort((a, b) => a.academicYear.localeCompare(b.academicYear));
}

function formatStatus(status: string): string {
  switch (status) {
    case 'enrolled':    return 'Enrolled';
    case 'promoted':    return 'Promoted';
    case 'retained':    return 'Retained';
    case 'on_leave':    return 'On leave';
    case 'withdrew':    return 'Withdrew';
    case 'transferred': return 'Transferred';
    case 'graduated':   return 'Graduated';
    default:            return status;
  }
}

export async function loadArchiveSnapshot(supabase: SupabaseClient, schoolId: string): Promise<ArchiveSnapshot> {
  const { data: school } = await supabase
    .from('schools').select('name').eq('id', schoolId).single();

  const { data: archivedRows } = await supabase
    .from('archived_students')
    .select('full_name, date_of_birth, enrollment_date, departure_date, reason, parent_full_name, parent_phone, enrollment_history, classes_attended, grades, created_at')
    .eq('school_id', schoolId)
    .order('created_at', { ascending: false });

  const archived: ArchivedRecord[] = (archivedRows ?? []).map((r: any) => {
    const fromNew = normaliseHistory(r.enrollment_history);
    const enrollmentHistory = fromNew.length > 0
      ? fromNew
      : synthesiseFromLegacy(Array.isArray(r.classes_attended) ? r.classes_attended : []);
    return {
      fullName: r.full_name,
      dateOfBirth: r.date_of_birth,
      enrollmentDate: r.enrollment_date,
      departureDate: r.departure_date,
      reason: r.reason,
      parentFullName: r.parent_full_name,
      parentPhone: r.parent_phone,
      enrollmentHistory,
      grades: Array.isArray(r.grades) ? r.grades : [],
    };
  });

  const { data: gradStudents } = await supabase
    .from('students')
    .select('id, full_name, date_of_birth, created_at, classes(name), parents(full_name, phone_number)')
    .eq('school_id', schoolId)
    .eq('is_graduated', true)
    .order('full_name');

  const gradIds = (gradStudents ?? []).map((s: any) => s.id);
  const gradesByStudent = new Map<string, GradeRow[]>();
  const historyByStudent = new Map<string, EnrollmentEntry[]>();

  if (gradIds.length > 0) {
    const { data: grades } = await supabase
      .from('grades')
      .select('student_id, academic_year, grading_period, subject, marks, daily_grade, quiz_grade, monthly_exam_grade, term_exam_grade, classes(name)')
      .in('student_id', gradIds)
      .eq('school_id', schoolId);

    for (const g of (grades ?? []) as any[]) {
      const list = gradesByStudent.get(g.student_id) ?? [];
      list.push({
        academicYear: g.academic_year,
        gradingPeriod: g.grading_period,
        subject: g.subject,
        className: g.classes?.name ?? null,
        marks: Array.isArray(g.marks) ? g.marks : [],
        dailyGrade: g.daily_grade,
        quizGrade: g.quiz_grade,
        monthlyExamGrade: g.monthly_exam_grade,
        termExamGrade: g.term_exam_grade,
      });
      gradesByStudent.set(g.student_id, list);
    }

    const { data: enrollments } = await supabase
      .from('student_enrollments')
      .select('student_id, academic_year, class_id, class_name_snapshot, grade_level, status, started_on, ended_on')
      .in('student_id', gradIds)
      .eq('school_id', schoolId)
      .order('academic_year', { ascending: true });

    for (const e of (enrollments ?? []) as any[]) {
      const list = historyByStudent.get(e.student_id) ?? [];
      list.push({
        academicYear: String(e.academic_year),
        gradeLevel: e.grade_level ? String(e.grade_level) : '(unknown)',
        classId: e.class_id ?? null,
        className: e.class_name_snapshot ?? null,
        status: e.status ? String(e.status) : 'enrolled',
        startedOn: e.started_on ?? null,
        endedOn: e.ended_on ?? null,
      });
      historyByStudent.set(e.student_id, list);
    }
  }

  const graduated: GraduatedRecord[] = (gradStudents ?? []).map((s: any) => {
    return {
      fullName: s.full_name,
      dateOfBirth: s.date_of_birth,
      enrollmentDate: s.created_at ? s.created_at.split('T')[0] : null,
      className: s.classes?.name ?? null,
      parentFullName: s.parents?.full_name ?? null,
      parentPhone: s.parents?.phone_number ?? null,
      enrollmentHistory: historyByStudent.get(s.id) ?? [],
      grades: gradesByStudent.get(s.id) ?? [],
    };
  });

  return {
    schoolName: school?.name ?? 'School',
    generatedAt: new Date().toISOString(),
    archived,
    graduated,
  };
}

export function streamPdf(snapshot: ArchiveSnapshot, dest: NodeJS.WritableStream): void {
  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true });
  doc.pipe(dest);

  doc.fontSize(28).text(snapshot.schoolName, { align: 'left' });
  doc.moveDown(0.4);
  doc.fontSize(20).text('Archive Export', { align: 'left' });
  doc.moveDown(0.6);
  doc.fontSize(11).fillColor('#6B7280')
    .text(`Generated: ${new Date(snapshot.generatedAt).toLocaleString()}`)
    .text(`Archived students: ${snapshot.archived.length}`)
    .text(`Graduated students: ${snapshot.graduated.length}`);
  doc.fillColor('black');

  if (snapshot.archived.length > 0) {
    doc.addPage();
    doc.fontSize(18).text('Archived Students', { underline: true });
    doc.moveDown(0.5);
    snapshot.archived.forEach((s, i) => writeStudentSection(doc, s, 'archived', i === 0));
  }

  if (snapshot.graduated.length > 0) {
    doc.addPage();
    doc.fontSize(18).text('Graduated Students', { underline: true });
    doc.moveDown(0.5);
    snapshot.graduated.forEach((s, i) => writeStudentSection(doc, s, 'graduated', i === 0));
  }

  if (snapshot.archived.length === 0 && snapshot.graduated.length === 0) {
    doc.addPage();
    doc.fontSize(14).fillColor('#6B7280').text('No archived or graduated student records.', { align: 'center' });
    doc.fillColor('black');
  }

  doc.end();
}

function writeStudentSection(
  doc: PDFKit.PDFDocument,
  s: ArchivedRecord | GraduatedRecord,
  kind: 'archived' | 'graduated',
  isFirst: boolean,
): void {
  if (!isFirst) doc.addPage();

  doc.fontSize(16).fillColor('black').text(s.fullName);
  doc.moveDown(0.3);

  doc.fontSize(10).fillColor('#374151');
  if (s.dateOfBirth) doc.text(`Date of birth: ${s.dateOfBirth}`);
  if (s.enrollmentDate) doc.text(`Enrolled: ${s.enrollmentDate}`);
  if (kind === 'archived') {
    const a = s as ArchivedRecord;
    if (a.departureDate) doc.text(`Departed: ${a.departureDate}`);
    if (a.reason) doc.text(`Reason: ${a.reason}`);
  } else {
    const g = s as GraduatedRecord;
    if (g.className) doc.text(`Final class: ${g.className}`);
  }
  if (s.parentFullName) doc.text(`Parent: ${s.parentFullName}${s.parentPhone ? ` (${s.parentPhone})` : ''}`);

  if (s.enrollmentHistory.length > 0) {
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor('black').text('Academic progression');
    doc.fontSize(10).fillColor('#374151');
    for (const e of s.enrollmentHistory) {
      const cls = e.className ? ` (${e.className})` : '';
      doc.text(`  • ${e.academicYear} — ${e.gradeLevel}${cls} — ${formatStatus(e.status)}`);
    }
  }

  if (s.grades.length > 0) {
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor('black').text('Grades');
    doc.moveDown(0.2);
    drawGradeTable(doc, s.grades);
  }

  doc.fillColor('black');
}

function gradeSum(g: GradeRow): number {
  if (g.marks.length > 0) return g.marks.reduce((s, m) => s + (m.value ?? 0), 0);
  return (g.dailyGrade ?? 0) + (g.quizGrade ?? 0) + (g.monthlyExamGrade ?? 0) + (g.termExamGrade ?? 0);
}

function canonicalLabel(s: string | null | undefined): string {
  if (!s) return '';
  return s.trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function pivotGrades(grades: GradeRow[]): { terms: string[]; subjects: string[]; cell: Map<string, Map<string, number>> } {
  const terms: string[] = [];
  const seenTerm = new Set<string>();
  const subjects: string[] = [];
  const seenSubject = new Set<string>();
  const cell = new Map<string, Map<string, number>>();

  for (const g of grades) {
    const year = canonicalLabel(g.academicYear);
    const period = canonicalLabel(g.gradingPeriod);
    const term = [year, period].filter(Boolean).join(' · ') || '—';
    const subject = canonicalLabel(g.subject) || '—';
    if (!seenTerm.has(term)) { seenTerm.add(term); terms.push(term); }
    if (!seenSubject.has(subject)) { seenSubject.add(subject); subjects.push(subject); }
    let perSubject = cell.get(term);
    if (!perSubject) { perSubject = new Map(); cell.set(term, perSubject); }
    perSubject.set(subject, gradeSum(g));
  }
  terms.sort();
  return { terms, subjects, cell };
}

function drawGradeTable(doc: PDFKit.PDFDocument, grades: GradeRow[]): void {
  const { terms, subjects, cell } = pivotGrades(grades);
  if (terms.length === 0) return;

  const startX = doc.page.margins.left;
  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const termColWidth = Math.min(150, usableWidth * 0.35);
  const subjectColWidth = Math.max(35, (usableWidth - termColWidth) / subjects.length);
  const rowHeight = 18;
  const bottom = doc.page.height - doc.page.margins.bottom;

  const drawHeader = () => {
    let y = doc.y;
    doc.fontSize(8).fillColor('#111827');
    doc.rect(startX, y, termColWidth, rowHeight).fillAndStroke('#F3F4F6', '#D1D5DB').fillColor('#111827');
    doc.text('Term', startX + 4, y + 5, { width: termColWidth - 8, ellipsis: true });
    for (let i = 0; i < subjects.length; i++) {
      const x = startX + termColWidth + i * subjectColWidth;
      doc.rect(x, y, subjectColWidth, rowHeight).fillAndStroke('#F3F4F6', '#D1D5DB').fillColor('#111827');
      doc.text(subjects[i], x + 4, y + 5, { width: subjectColWidth - 8, ellipsis: true });
    }
    doc.y = y + rowHeight;
  };

  drawHeader();

  for (const term of terms) {
    if (doc.y + rowHeight > bottom) {
      doc.addPage();
      drawHeader();
    }
    const y = doc.y;
    doc.fontSize(8).fillColor('#374151');
    doc.rect(startX, y, termColWidth, rowHeight).stroke('#E5E7EB');
    doc.text(term, startX + 4, y + 5, { width: termColWidth - 8, ellipsis: true });
    const perSubject = cell.get(term);
    for (let i = 0; i < subjects.length; i++) {
      const x = startX + termColWidth + i * subjectColWidth;
      doc.rect(x, y, subjectColWidth, rowHeight).stroke('#E5E7EB');
      const v = perSubject?.get(subjects[i]);
      doc.text(v != null ? String(v) : '', x + 4, y + 5, { width: subjectColWidth - 8 });
    }
    doc.y = y + rowHeight;
  }

  doc.fillColor('black');
}

export function buildXlsx(snapshot: ArchiveSnapshot): Buffer {
  const wb = XLSX.utils.book_new();

  const archivedHeaders = ['Full name', 'Date of birth', 'Enrolled', 'Departed', 'Reason', 'Parent name', 'Parent phone', 'Academic progression'];
  const archivedRows = snapshot.archived.map(s => ({
    'Full name': s.fullName,
    'Date of birth': s.dateOfBirth ?? '',
    'Enrolled': s.enrollmentDate ?? '',
    'Departed': s.departureDate ?? '',
    'Reason': s.reason ?? '',
    'Parent name': s.parentFullName ?? '',
    'Parent phone': s.parentPhone ?? '',
    'Academic progression': s.enrollmentHistory.map(e => `${e.academicYear}: ${e.gradeLevel} (${formatStatus(e.status)})`).join(' | '),
  }));
  const archivedSheet = archivedRows.length > 0
    ? XLSX.utils.json_to_sheet(archivedRows)
    : XLSX.utils.aoa_to_sheet([archivedHeaders]);
  XLSX.utils.book_append_sheet(wb, archivedSheet, 'Archived');

  const graduatedHeaders = ['Full name', 'Date of birth', 'Enrolled', 'Final class', 'Parent name', 'Parent phone', 'Academic progression'];
  const graduatedRows = snapshot.graduated.map(s => ({
    'Full name': s.fullName,
    'Date of birth': s.dateOfBirth ?? '',
    'Enrolled': s.enrollmentDate ?? '',
    'Final class': s.className ?? '',
    'Parent name': s.parentFullName ?? '',
    'Parent phone': s.parentPhone ?? '',
    'Academic progression': s.enrollmentHistory.map(e => `${e.academicYear}: ${e.gradeLevel} (${formatStatus(e.status)})`).join(' | '),
  }));
  const graduatedSheet = graduatedRows.length > 0
    ? XLSX.utils.json_to_sheet(graduatedRows)
    : XLSX.utils.aoa_to_sheet([graduatedHeaders]);
  XLSX.utils.book_append_sheet(wb, graduatedSheet, 'Graduated');

  const allSubjectsSet = new Set<string>();
  for (const s of snapshot.archived) for (const g of s.grades) {
    const subj = canonicalLabel(g.subject);
    if (subj) allSubjectsSet.add(subj);
  }
  for (const s of snapshot.graduated) for (const g of s.grades) {
    const subj = canonicalLabel(g.subject);
    if (subj) allSubjectsSet.add(subj);
  }
  const allSubjects = Array.from(allSubjectsSet).sort();

  const wideRows = [
    ...buildWideGradeRows('Archived', snapshot.archived, allSubjects),
    ...buildWideGradeRows('Graduated', snapshot.graduated, allSubjects),
  ];

  const gradeHeaders = ['Status', 'Student', 'Year', 'Period', ...allSubjects];
  const gradesSheet = wideRows.length > 0
    ? XLSX.utils.json_to_sheet(wideRows)
    : XLSX.utils.aoa_to_sheet([gradeHeaders]);
  XLSX.utils.book_append_sheet(wb, gradesSheet, 'Grades');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function buildWideGradeRows(
  status: string,
  students: { fullName: string; grades: GradeRow[] }[],
  allSubjects: string[],
): Record<string, string | number>[] {
  const rows: Record<string, string | number>[] = [];
  for (const s of students) {
    const groups = new Map<string, Map<string, number>>();
    for (const g of s.grades) {
      const year = canonicalLabel(g.academicYear);
      const period = canonicalLabel(g.gradingPeriod);
      const subject = canonicalLabel(g.subject);
      const key = `${year}|${period}`;
      let perSubject = groups.get(key);
      if (!perSubject) { perSubject = new Map(); groups.set(key, perSubject); }
      if (subject) perSubject.set(subject, gradeSum(g));
    }
    for (const [key, perSubject] of Array.from(groups.entries()).sort()) {
      const [year, period] = key.split('|');
      const row: Record<string, string | number> = {
        Status: status,
        Student: s.fullName,
        Year: year,
        Period: period,
      };
      for (const subj of allSubjects) {
        const v = perSubject.get(subj);
        row[subj] = v != null ? v : '';
      }
      rows.push(row);
    }
  }
  return rows;
}
