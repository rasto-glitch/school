// PDF + Excel exports of a school's archived and graduated student records.
// Used by both the admin self-export endpoint and the master-server export
// endpoint that is offered before a school's archive feature is toggled off.

import * as XLSX from 'xlsx';
import PDFDocument from 'pdfkit';
import { supabase } from '../config/supabase';

export interface ArchiveSnapshot {
  schoolName: string;
  generatedAt: string;
  archived: ArchivedRecord[];
  graduated: GraduatedRecord[];
}

interface ArchivedRecord {
  fullName: string;
  dateOfBirth: string | null;
  enrollmentDate: string | null;
  departureDate: string | null;
  reason: string | null;
  parentFullName: string | null;
  parentPhone: string | null;
  classesAttended: { year: string; classId: string; className: string }[];
  grades: GradeRow[];
}

interface GraduatedRecord {
  fullName: string;
  dateOfBirth: string | null;
  enrollmentDate: string | null;
  className: string | null;
  parentFullName: string | null;
  parentPhone: string | null;
  classesAttended: { year: string; classId: string; className: string }[];
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

function toAcademicYear(date: string | null): string {
  if (!date) return '';
  const d = new Date(date);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  // Academic year starts in September. Sept-Dec belongs to year-(year+1);
  // Jan-Aug belongs to (year-1)-year.
  return m >= 9 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

export async function loadArchiveSnapshot(schoolId: string): Promise<ArchiveSnapshot> {
  const { data: school } = await supabase
    .from('schools').select('name').eq('id', schoolId).single();

  const { data: archivedRows } = await supabase
    .from('archived_students')
    .select('full_name, date_of_birth, enrollment_date, departure_date, reason, parent_full_name, parent_phone, classes_attended, grades, created_at')
    .eq('school_id', schoolId)
    .order('created_at', { ascending: false });

  const archived: ArchivedRecord[] = (archivedRows ?? []).map((r: any) => ({
    fullName: r.full_name,
    dateOfBirth: r.date_of_birth,
    enrollmentDate: r.enrollment_date,
    departureDate: r.departure_date,
    reason: r.reason,
    parentFullName: r.parent_full_name,
    parentPhone: r.parent_phone,
    classesAttended: Array.isArray(r.classes_attended) ? r.classes_attended : [],
    grades: Array.isArray(r.grades) ? r.grades : [],
  }));

  const { data: gradStudents } = await supabase
    .from('students')
    .select('id, full_name, date_of_birth, created_at, classes(name), parents(full_name, phone_number)')
    .eq('school_id', schoolId)
    .eq('is_graduated', true)
    .order('full_name');

  const gradIds = (gradStudents ?? []).map((s: any) => s.id);

  // Pull live grades + attendance for graduated students; fold them into per-student records.
  const gradesByStudent = new Map<string, GradeRow[]>();
  const classesByStudent = new Map<string, Map<string, Map<string, string>>>();

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

    const { data: attendance } = await supabase
      .from('attendance')
      .select('student_id, date, class_id, classes(name)')
      .in('student_id', gradIds)
      .eq('school_id', schoolId);

    for (const a of (attendance ?? []) as any[]) {
      const classId = a.class_id;
      const className = a.classes?.name;
      if (!classId || !className) continue;
      const yr = toAcademicYear(a.date);
      let perStudent = classesByStudent.get(a.student_id);
      if (!perStudent) { perStudent = new Map(); classesByStudent.set(a.student_id, perStudent); }
      let perYear = perStudent.get(yr);
      if (!perYear) { perYear = new Map(); perStudent.set(yr, perYear); }
      perYear.set(classId, className);
    }
  }

  const graduated: GraduatedRecord[] = (gradStudents ?? []).map((s: any) => {
    const classesAttended: { year: string; classId: string; className: string }[] = [];
    const perStudent = classesByStudent.get(s.id);
    if (perStudent) {
      for (const [year, idToName] of Array.from(perStudent.entries()).sort(([a], [b]) => a.localeCompare(b))) {
        for (const [classId, className] of idToName.entries()) {
          classesAttended.push({ year, classId, className });
        }
      }
    }
    return {
      fullName: s.full_name,
      dateOfBirth: s.date_of_birth,
      enrollmentDate: s.created_at ? s.created_at.split('T')[0] : null,
      className: s.classes?.name ?? null,
      parentFullName: s.parents?.full_name ?? null,
      parentPhone: s.parents?.phone_number ?? null,
      classesAttended,
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

// ─── PDF ────────────────────────────────────────────────────────────────────────

export function streamPdf(snapshot: ArchiveSnapshot, dest: NodeJS.WritableStream): void {
  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true });
  doc.pipe(dest);

  // Cover
  doc.fontSize(28).text(snapshot.schoolName, { align: 'left' });
  doc.moveDown(0.4);
  doc.fontSize(20).text('Archive Export', { align: 'left' });
  doc.moveDown(0.6);
  doc.fontSize(11).fillColor('#6B7280')
    .text(`Generated: ${new Date(snapshot.generatedAt).toLocaleString()}`)
    .text(`Archived students: ${snapshot.archived.length}`)
    .text(`Graduated students: ${snapshot.graduated.length}`);
  doc.fillColor('black');

  // Archived
  if (snapshot.archived.length > 0) {
    doc.addPage();
    doc.fontSize(18).text('Archived Students', { underline: true });
    doc.moveDown(0.5);
    snapshot.archived.forEach((s, i) => writeStudentSection(doc, s, 'archived', i === 0));
  }

  // Graduated
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

  // Classes attended
  if (s.classesAttended.length > 0) {
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor('black').text('Classes attended');
    doc.fontSize(10).fillColor('#374151');
    for (const c of s.classesAttended) {
      doc.text(`  • ${c.year} — ${c.className}`);
    }
  }

  // Grades — drawn as a per-student table: rows are (year · period), columns
  // are subjects. Each cell is the period total for that subject. Same shape
  // as the wide Excel sheet, just narrower.
  if (s.grades.length > 0) {
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor('black').text('Grades');
    doc.moveDown(0.2);
    drawGradeTable(doc, s.grades);
  }

  doc.fillColor('black');
}

// Sum of all marks on a grade row. Prefer marks[] (current schema); fall back
// to legacy daily/quiz/monthly/term columns for old records.
function gradeSum(g: GradeRow): number {
  if (g.marks.length > 0) return g.marks.reduce((s, m) => s + (m.value ?? 0), 0);
  return (g.dailyGrade ?? 0) + (g.quizGrade ?? 0) + (g.monthlyExamGrade ?? 0) + (g.termExamGrade ?? 0);
}

// Reorganize a flat list of grade rows into a (year · period) → subject map.
// Returns subjects in encountered order so the table matches the school's
// natural subject ordering rather than alphabetical.
function pivotGrades(grades: GradeRow[]): { terms: string[]; subjects: string[]; cell: Map<string, Map<string, number>> } {
  const terms: string[] = [];
  const seenTerm = new Set<string>();
  const subjects: string[] = [];
  const seenSubject = new Set<string>();
  const cell = new Map<string, Map<string, number>>();

  for (const g of grades) {
    const term = [g.academicYear, g.gradingPeriod].filter(Boolean).join(' · ') || '—';
    const subject = g.subject || '—';
    if (!seenTerm.has(term)) { seenTerm.add(term); terms.push(term); }
    if (!seenSubject.has(subject)) { seenSubject.add(subject); subjects.push(subject); }
    let perSubject = cell.get(term);
    if (!perSubject) { perSubject = new Map(); cell.set(term, perSubject); }
    perSubject.set(subject, gradeSum(g));
  }
  terms.sort();
  return { terms, subjects, cell };
}

// Manual table renderer for pdfkit (no native tables API). Auto-paginates
// the body rows when y crosses the bottom margin.
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

// ─── EXCEL ──────────────────────────────────────────────────────────────────────

export function buildXlsx(snapshot: ArchiveSnapshot): Buffer {
  const wb = XLSX.utils.book_new();

  // Always emit the headers — XLSX.utils.json_to_sheet([]) yields a sheet
  // with no header row, which some viewers render as missing/empty. Use
  // aoa_to_sheet for the empty case so the columns are always visible.
  const archivedHeaders = ['Full name', 'Date of birth', 'Enrolled', 'Departed', 'Reason', 'Parent name', 'Parent phone', 'Classes attended'];
  const archivedRows = snapshot.archived.map(s => ({
    'Full name': s.fullName,
    'Date of birth': s.dateOfBirth ?? '',
    'Enrolled': s.enrollmentDate ?? '',
    'Departed': s.departureDate ?? '',
    'Reason': s.reason ?? '',
    'Parent name': s.parentFullName ?? '',
    'Parent phone': s.parentPhone ?? '',
    'Classes attended': s.classesAttended.map(c => `${c.year}: ${c.className}`).join(' | '),
  }));
  const archivedSheet = archivedRows.length > 0
    ? XLSX.utils.json_to_sheet(archivedRows)
    : XLSX.utils.aoa_to_sheet([archivedHeaders]);
  XLSX.utils.book_append_sheet(wb, archivedSheet, 'Archived');

  const graduatedHeaders = ['Full name', 'Date of birth', 'Enrolled', 'Final class', 'Parent name', 'Parent phone', 'Classes attended'];
  const graduatedRows = snapshot.graduated.map(s => ({
    'Full name': s.fullName,
    'Date of birth': s.dateOfBirth ?? '',
    'Enrolled': s.enrollmentDate ?? '',
    'Final class': s.className ?? '',
    'Parent name': s.parentFullName ?? '',
    'Parent phone': s.parentPhone ?? '',
    'Classes attended': s.classesAttended.map(c => `${c.year}: ${c.className}`).join(' | '),
  }));
  const graduatedSheet = graduatedRows.length > 0
    ? XLSX.utils.json_to_sheet(graduatedRows)
    : XLSX.utils.aoa_to_sheet([graduatedHeaders]);
  XLSX.utils.book_append_sheet(wb, graduatedSheet, 'Graduated');

  // Grades sheet — wide format. One row per (status, student, year, period);
  // subjects are columns. With 8+ subjects this stays readable instead of
  // exploding into 8× as many rows.
  const allSubjectsSet = new Set<string>();
  for (const s of snapshot.archived) for (const g of s.grades) if (g.subject) allSubjectsSet.add(g.subject);
  for (const s of snapshot.graduated) for (const g of s.grades) if (g.subject) allSubjectsSet.add(g.subject);
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
    // Group this student's grades by (year, period) → subject → total
    const groups = new Map<string, Map<string, number>>();
    for (const g of s.grades) {
      const key = `${g.academicYear ?? ''}|${g.gradingPeriod ?? ''}`;
      let perSubject = groups.get(key);
      if (!perSubject) { perSubject = new Map(); groups.set(key, perSubject); }
      if (g.subject) perSubject.set(g.subject, gradeSum(g));
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
