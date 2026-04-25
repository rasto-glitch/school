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
  graduatedAt: string | null;
  graduationYear: string | null;
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
    .select('id, full_name, date_of_birth, created_at, graduated_at, graduation_year, classes(name), parents(full_name, phone_number)')
    .eq('school_id', schoolId)
    .eq('is_graduated', true)
    .order('graduated_at', { ascending: false });

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
      graduatedAt: s.graduated_at,
      graduationYear: s.graduation_year,
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
    if (g.graduatedAt) doc.text(`Graduated: ${g.graduatedAt}`);
    if (g.graduationYear) doc.text(`Graduation year: ${g.graduationYear}`);
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

  // Grades
  if (s.grades.length > 0) {
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor('black').text('Grades');
    doc.fontSize(9).fillColor('#374151');
    for (const g of s.grades) {
      const head = [g.academicYear, g.gradingPeriod, g.subject, g.className].filter(Boolean).join(' · ');
      doc.text(`  ${head || '—'}`);
      const marks = g.marks.length > 0
        ? g.marks.map(m => `${m.name}: ${m.value ?? '—'}`).join(', ')
        : ['daily', 'quiz', 'monthly exam', 'term exam']
            .map((label, i) => {
              const v = [g.dailyGrade, g.quizGrade, g.monthlyExamGrade, g.termExamGrade][i];
              return v != null ? `${label}: ${v}` : null;
            })
            .filter(Boolean)
            .join(', ');
      if (marks) doc.text(`    ${marks}`);
    }
  }

  doc.fillColor('black');
}

// ─── EXCEL ──────────────────────────────────────────────────────────────────────

export function buildXlsx(snapshot: ArchiveSnapshot): Buffer {
  const wb = XLSX.utils.book_new();

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
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(archivedRows), 'Archived');

  const graduatedRows = snapshot.graduated.map(s => ({
    'Full name': s.fullName,
    'Date of birth': s.dateOfBirth ?? '',
    'Enrolled': s.enrollmentDate ?? '',
    'Graduated': s.graduatedAt ?? '',
    'Graduation year': s.graduationYear ?? '',
    'Final class': s.className ?? '',
    'Parent name': s.parentFullName ?? '',
    'Parent phone': s.parentPhone ?? '',
    'Classes attended': s.classesAttended.map(c => `${c.year}: ${c.className}`).join(' | '),
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(graduatedRows), 'Graduated');

  // Flattened grades — one row per (student, year, period, subject)
  const gradeRows = [
    ...snapshot.archived.flatMap(s => s.grades.map(g => ({
      'Status': 'Archived',
      'Student': s.fullName,
      'Year': g.academicYear ?? '',
      'Period': g.gradingPeriod ?? '',
      'Subject': g.subject ?? '',
      'Class': g.className ?? '',
      'Marks': g.marks.length > 0
        ? g.marks.map(m => `${m.name}: ${m.value ?? ''}`).join(' | ')
        : `daily: ${g.dailyGrade ?? ''} | quiz: ${g.quizGrade ?? ''} | monthly: ${g.monthlyExamGrade ?? ''} | term: ${g.termExamGrade ?? ''}`,
    }))),
    ...snapshot.graduated.flatMap(s => s.grades.map(g => ({
      'Status': 'Graduated',
      'Student': s.fullName,
      'Year': g.academicYear ?? '',
      'Period': g.gradingPeriod ?? '',
      'Subject': g.subject ?? '',
      'Class': g.className ?? '',
      'Marks': g.marks.length > 0
        ? g.marks.map(m => `${m.name}: ${m.value ?? ''}`).join(' | ')
        : `daily: ${g.dailyGrade ?? ''} | quiz: ${g.quizGrade ?? ''} | monthly: ${g.monthlyExamGrade ?? ''} | term: ${g.termExamGrade ?? ''}`,
    }))),
  ];
  if (gradeRows.length > 0) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(gradeRows), 'Grades');
  }

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
