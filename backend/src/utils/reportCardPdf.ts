// Single-student term Report Card PDF (Phase 1). Live-rendered from released
// grades — see reportCard.controller. Mirrors transferBundlePdf.ts: pdfkit +
// setupPdfFonts (DejaVu + Noto Naskh, Arabic/Kurdish shaping), school logo via
// fetchLogoBuffer, LTR layout with per-string F.pick() so RTL text renders
// correctly inside it. A4, manual layout (pdfkit has no native tables).

import PDFDocument from 'pdfkit';
import { setupPdfFonts } from './pdfFont';
import { COLORS, fetchLogoBuffer, type Lang } from './archivePdfShared';

export interface ReportCardSubject {
  subject: string;
  components: { name: string; value: number | null }[];
  percent: number | null;
  letter: string | null;
  gradePoint: number | null;
  adminNote: string | null;
}
export interface ReportCardData {
  school: { name: string; logoUrl: string | null };
  student: { fullName: string; className: string | null; photoUrl: string | null; dateOfBirth: string | null };
  academicYear: string;
  term: string;
  generatedAt: string;       // ISO
  showPercent: boolean;      // grading mode scale|both
  showGpa: boolean;          // grading mode gpa|both
  markColumns: string[];     // union of component names, in order
  subjects: ReportCardSubject[];
  overall: { averagePercent: number | null; gpa: number | null };
  remarks: { homeroom: string | null; principal: string | null };
  config: { classTeacher: string; principal: string; headerNote: string; footerNote: string };
}

interface RCLabels {
  title: string; academic_year: string; term: string; student: string; klass: string;
  dob: string; generated: string; subject: string; total: string; grade: string; gpa: string;
  overall: string; remarks: string; homeroom: string; principal_remark: string;
  class_teacher: string; principal: string; signature: string; no_grades: string;
  page: string; of: string; em: string;
}

const RL: Record<Lang, RCLabels> = {
  en: {
    title: 'Report Card', academic_year: 'Academic year', term: 'Term', student: 'Student',
    klass: 'Class', dob: 'Date of birth', generated: 'Generated', subject: 'Subject', total: '%',
    grade: 'Grade', gpa: 'GPA', overall: 'Overall', remarks: 'Remarks', homeroom: 'Class teacher’s comment',
    principal_remark: 'Principal’s comment', class_teacher: 'Class teacher', principal: 'Principal',
    signature: 'Signature', no_grades: 'No released grades for this term.', page: 'Page', of: 'of', em: '—',
  },
  ar: {
    title: 'بطاقة الدرجات', academic_year: 'العام الدراسي', term: 'الفصل', student: 'الطالب',
    klass: 'الصف', dob: 'تاريخ الميلاد', generated: 'أُنشئت في', subject: 'المادة', total: '٪',
    grade: 'التقدير', gpa: 'المعدل', overall: 'المجموع', remarks: 'الملاحظات', homeroom: 'ملاحظة مربي الصف',
    principal_remark: 'ملاحظة المدير', class_teacher: 'مربي الصف', principal: 'المدير',
    signature: 'التوقيع', no_grades: 'لا توجد درجات معتمدة لهذا الفصل.', page: 'صفحة', of: 'من', em: '—',
  },
  ku: {
    title: 'کارتی نمرە', academic_year: 'ساڵی خوێندن', term: 'وەرز', student: 'خوێندکار',
    klass: 'پۆل', dob: 'بەرواری لەدایکبوون', generated: 'دروستکراوە لە', subject: 'بابەت', total: '٪',
    grade: 'پلە', gpa: 'تێکڕا', overall: 'گشتی', remarks: 'تێبینییەکان', homeroom: 'تێبینیی مامۆستای پۆل',
    principal_remark: 'تێبینیی بەڕێوەبەر', class_teacher: 'مامۆستای پۆل', principal: 'بەڕێوەبەر',
    signature: 'واژوو', no_grades: 'هیچ نمرەیەکی بڵاوکراوە بۆ ئەم وەرزە نییە.', page: 'پەڕە', of: 'لە', em: '—',
  },
};

const PAGE_LEFT = 40;
const PAGE_RIGHT = 555;     // A4 595 - 40 margin
const CONTENT_W = PAGE_RIGHT - PAGE_LEFT;

function fmtDate(iso: string): string {
  // YYYY-MM-DD HH:MM (UTC-agnostic display of the instant's calendar parts)
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function num(n: number | null, dp = 1): string {
  if (n == null) return '—';
  return Number.isInteger(n) ? String(n) : n.toFixed(dp);
}

export async function streamReportCardPdf(data: ReportCardData, lang: Lang, dest: NodeJS.WritableStream): Promise<void> {
  const l = RL[lang];
  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
  const F = setupPdfFonts(doc);
  doc.pipe(dest);

  // ─── Header strip: logo + school name + title + meta ────────────────
  const logoBuf = await fetchLogoBuffer(data.school.logoUrl);
  if (logoBuf) {
    try { doc.image(logoBuf, PAGE_LEFT, 40, { fit: [54, 54] }); } catch { /* ignore */ }
  }
  const headX = logoBuf ? 106 : PAGE_LEFT;
  doc.font(F.pick(data.school.name, { bold: true })).fontSize(16).fillColor(COLORS.heading)
    .text(data.school.name, headX, 44, { width: PAGE_RIGHT - headX - 130 });
  doc.font(F.pick(l.title, { bold: true })).fontSize(12).fillColor(COLORS.accent)
    .text(l.title, headX, doc.y + 2);
  if (data.config.headerNote && data.config.headerNote.trim()) {
    doc.font(F.pick(data.config.headerNote)).fontSize(8).fillColor(COLORS.muted)
      .text(data.config.headerNote.trim(), headX, doc.y + 2, { width: PAGE_RIGHT - headX - 130 });
  }

  // Meta block (right-aligned column)
  const metaX = PAGE_RIGHT - 120;
  let my = 44;
  const meta = (label: string, value: string) => {
    doc.font(F.pick(label)).fontSize(7.5).fillColor(COLORS.muted).text(label, metaX, my, { width: 120, align: 'right' });
    doc.font(F.pick(value, { bold: true })).fontSize(9).fillColor(COLORS.body).text(value || l.em, metaX, my + 9, { width: 120, align: 'right' });
    my += 24;
  };
  meta(l.academic_year, data.academicYear);
  meta(l.term, data.term);

  let y = 112;
  doc.moveTo(PAGE_LEFT, y).lineTo(PAGE_RIGHT, y).strokeColor(COLORS.border).stroke();
  y += 10;

  // ─── Student identity ───────────────────────────────────────────────
  const idRow = (label: string, value: string | null, x: number, w: number) => {
    doc.font(F.pick(label)).fontSize(8).fillColor(COLORS.muted).text(label, x, y);
    doc.font(F.pick(value, { bold: true })).fontSize(11).fillColor(COLORS.body)
      .text((value && String(value).trim()) || l.em, x, y + 11, { width: w });
  };
  idRow(l.student, data.student.fullName, PAGE_LEFT, 240);
  idRow(l.klass, data.student.className, PAGE_LEFT + 250, 130);
  idRow(l.dob, data.student.dateOfBirth, PAGE_LEFT + 390, 125);
  y += 36;
  doc.moveTo(PAGE_LEFT, y).lineTo(PAGE_RIGHT, y).strokeColor(COLORS.border).stroke();
  y += 12;

  // ─── Subject table ──────────────────────────────────────────────────
  if (data.subjects.length === 0) {
    doc.font(F.pick(l.no_grades)).fontSize(10).fillColor(COLORS.muted).text(l.no_grades, PAGE_LEFT, y);
    y = doc.y + 10;
  } else {
    y = drawSubjectTable(doc, F, l, data, y);
  }

  // ─── Overall summary ────────────────────────────────────────────────
  if (data.subjects.length > 0) {
    if (y > 700) { doc.addPage(); y = 50; }
    const parts: string[] = [];
    if (data.showPercent && data.overall.averagePercent != null) parts.push(`${l.overall} ${l.total}: ${num(data.overall.averagePercent)}`);
    if (data.showGpa && data.overall.gpa != null) parts.push(`${l.gpa}: ${num(data.overall.gpa, 2)}`);
    if (parts.length) {
      doc.rect(PAGE_LEFT, y, CONTENT_W, 22).fill(COLORS.panel);
      doc.font(F.pick(parts.join('     '), { bold: true })).fontSize(10).fillColor(COLORS.heading)
        .text(parts.join('        '), PAGE_LEFT + 8, y + 6, { width: CONTENT_W - 16, align: 'right' });
      y += 32;
    }
  }

  // ─── Remarks ────────────────────────────────────────────────────────
  const remark = (label: string, value: string | null) => {
    if (y > 730) { doc.addPage(); y = 50; }
    doc.font(F.pick(label, { bold: true })).fontSize(8).fillColor(COLORS.muted).text(label.toUpperCase(), PAGE_LEFT, y);
    y = doc.y + 2;
    const v = (value && value.trim()) || l.em;
    doc.font(F.pick(v)).fontSize(10).fillColor(COLORS.body).text(v, PAGE_LEFT, y, { width: CONTENT_W });
    y = doc.y + 8;
  };
  if (data.remarks.homeroom || data.remarks.principal) {
    doc.font(F.pick(l.remarks, { bold: true })).fontSize(9).fillColor(COLORS.muted).text(l.remarks.toUpperCase(), PAGE_LEFT, y);
    y = doc.y + 6;
    if (data.remarks.homeroom) remark(l.homeroom, data.remarks.homeroom);
    if (data.remarks.principal) remark(l.principal_remark, data.remarks.principal);
  }

  // ─── Signatories ────────────────────────────────────────────────────
  if (y > 720) { doc.addPage(); y = 50; }
  y += 18;
  const sigCol = (label: string, name: string, x: number) => {
    doc.moveTo(x, y).lineTo(x + 200, y).strokeColor(COLORS.border).stroke();
    doc.font(F.pick(label, { bold: true })).fontSize(9).fillColor(COLORS.body).text(label, x, y + 4);
    if (name && name.trim()) doc.font(F.pick(name)).fontSize(9).fillColor(COLORS.muted).text(name.trim(), x, y + 16);
  };
  sigCol(l.class_teacher, data.config.classTeacher, PAGE_LEFT);
  sigCol(l.principal, data.config.principal, PAGE_LEFT + 300);

  // ─── Per-page footer ────────────────────────────────────────────────
  const footNote = (data.config.footerNote && data.config.footerNote.trim()) || '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const range = (doc as any).bufferedPageRange();
  const total = range.start + range.count;
  for (let i = range.start; i < total; i++) {
    doc.switchToPage(i);
    const footer = `${data.school.name} · ${l.generated} ${fmtDate(data.generatedAt)} · ${l.page} ${i + 1} ${l.of} ${total}`
      + (footNote ? ` · ${footNote}` : '');
    doc.font(F.pick(footer)).fontSize(7.5).fillColor(COLORS.muted)
      .text(footer, PAGE_LEFT, 812, { width: CONTENT_W, align: 'center' });
  }

  doc.end();
}

// Manual subject table. Columns: Subject | [mark columns…] | % | Grade.
// Mark columns are dropped if they'd overflow the content width (keeps the
// card readable for schools with many mark types).
function drawSubjectTable(
  doc: PDFKit.PDFDocument,
  F: ReturnType<typeof setupPdfFonts>,
  l: RCLabels,
  data: ReportCardData,
  startY: number,
): number {
  const subjectW = 150;
  const pctW = data.showPercent ? 44 : 0;
  const gradeW = data.showGpa ? 70 : 0;
  const fixedW = subjectW + pctW + gradeW;
  const markCount = data.markColumns.length;
  const perMark = markCount > 0 ? Math.floor((CONTENT_W - fixedW) / markCount) : 0;
  const showMarks = markCount > 0 && perMark >= 34;     // drop component cols if too cramped

  const cols: { label: string; w: number; align: 'left' | 'center' }[] = [{ label: l.subject, w: subjectW, align: 'left' }];
  if (showMarks) for (const m of data.markColumns) cols.push({ label: m, w: perMark, align: 'center' });
  if (data.showPercent) cols.push({ label: l.total, w: pctW, align: 'center' });
  if (data.showGpa) cols.push({ label: l.grade, w: gradeW, align: 'center' });

  const rowH = 18;
  let y = startY;

  const header = () => {
    let x = PAGE_LEFT;
    for (const c of cols) {
      doc.rect(x, y, c.w, rowH).fillAndStroke('#F3F4F6', '#D1D5DB');
      doc.font(F.pick(c.label, { bold: true })).fontSize(8).fillColor(COLORS.body)
        .text(c.label, x + 4, y + 5, { width: c.w - 8, align: c.align, ellipsis: true });
      x += c.w;
    }
    y += rowH;
  };
  header();

  for (const s of data.subjects) {
    if (y > 770) { doc.addPage(); y = 50; header(); }
    const cellH = s.adminNote && s.adminNote.trim() ? rowH + 12 : rowH;
    let x = PAGE_LEFT;
    const cell = (text: string, w: number, align: 'left' | 'center', bold = false) => {
      doc.rect(x, y, w, cellH).stroke('#E5E7EB');
      doc.font(F.pick(text, { bold })).fontSize(8.5).fillColor(COLORS.body)
        .text(text, x + 4, y + 5, { width: w - 8, align, ellipsis: true });
      x += w;
    };
    cell(s.subject, subjectW, 'left', true);
    if (showMarks) {
      for (const name of data.markColumns) {
        const c = s.components.find(c => c.name === name);
        cell(c && c.value != null ? String(c.value) : '', perMark, 'center');
      }
    }
    if (data.showPercent) cell(s.percent != null ? num(s.percent) : '', pctW, 'center');
    if (data.showGpa) cell(s.letter ? `${s.letter}${s.gradePoint != null ? ` (${s.gradePoint})` : ''}` : '', gradeW, 'center');
    // Per-subject admin note under the subject cell (parent-visible).
    if (s.adminNote && s.adminNote.trim()) {
      doc.font(F.pick(s.adminNote)).fontSize(7).fillColor(COLORS.muted)
        .text(s.adminNote.trim(), PAGE_LEFT + 4, y + rowH, { width: CONTENT_W - 8, align: 'left', ellipsis: true });
    }
    y += cellH;
  }
  return y + 10;
}
