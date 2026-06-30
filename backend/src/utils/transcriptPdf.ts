// Cumulative academic Transcript PDF (Phase 4). Live-rendered from released
// grades across ALL academic years/terms — see reportCard.controller. Built on
// the same stack as reportCardPdf.ts: pdfkit + setupPdfFonts (DejaVu + Noto
// Naskh, Arabic/Kurdish shaping), school logo via fetchLogoBuffer, LTR layout
// with per-string F.pick() so RTL text renders correctly. A4, manual layout.

import PDFDocument from 'pdfkit';
import { setupPdfFonts } from './pdfFont';
import { COLORS, fetchLogoBuffer, type Lang } from './archivePdfShared';

export interface TranscriptSubject {
  subject: string;
  percent: number | null;
  letter: string | null;
  gradePoint: number | null;
}
export interface TranscriptTerm {
  academicYear: string;
  term: string;
  subjects: TranscriptSubject[];
  averagePercent: number | null;
  gpa: number | null;
}
export interface TranscriptData {
  school: { name: string; logoUrl: string | null };
  student: { fullName: string; className: string | null; dateOfBirth: string | null; graduated: boolean };
  generatedAt: string;       // ISO
  showPercent: boolean;
  showGpa: boolean;
  terms: TranscriptTerm[];   // chronological: oldest year/term first
  cumulative: { averagePercent: number | null; gpa: number | null };
  config: { classTeacher: string; principal: string; headerNote: string; footerNote: string };
}

interface TLabels {
  title: string; student: string; klass: string; dob: string; generated: string;
  graduated: string; subject: string; total: string; grade: string; gpa: string;
  term: string; term_average: string; cumulative: string; cumulative_gpa: string;
  registrar: string; principal: string; no_grades: string; page: string; of: string; em: string;
}

const TL: Record<Lang, TLabels> = {
  en: {
    title: 'Academic Transcript', student: 'Student', klass: 'Current class', dob: 'Date of birth',
    generated: 'Generated', graduated: 'Graduated', subject: 'Subject', total: '%', grade: 'Grade', gpa: 'GPA',
    term: 'Term', term_average: 'Term average', cumulative: 'Cumulative average', cumulative_gpa: 'Cumulative GPA',
    registrar: 'Registrar', principal: 'Principal', no_grades: 'No released grades on record.',
    page: 'Page', of: 'of', em: '—',
  },
  ar: {
    title: 'كشف الدرجات التراكمي', student: 'الطالب', klass: 'الصف الحالي', dob: 'تاريخ الميلاد',
    generated: 'أُنشئ في', graduated: 'متخرّج', subject: 'المادة', total: '٪', grade: 'التقدير', gpa: 'المعدل',
    term: 'الفصل', term_average: 'معدل الفصل', cumulative: 'المعدل التراكمي', cumulative_gpa: 'المعدل التراكمي',
    registrar: 'المسجّل', principal: 'المدير', no_grades: 'لا توجد درجات معتمدة في السجل.',
    page: 'صفحة', of: 'من', em: '—',
  },
  ku: {
    title: 'پێڕستی نمرە کۆیی', student: 'خوێندکار', klass: 'پۆلی ئێستا', dob: 'بەرواری لەدایکبوون',
    generated: 'دروستکراوە لە', graduated: 'دەرچوو', subject: 'بابەت', total: '٪', grade: 'پلە', gpa: 'تێکڕا',
    term: 'وەرز', term_average: 'تێکڕای وەرز', cumulative: 'تێکڕای کۆیی', cumulative_gpa: 'تێکڕای کۆیی (GPA)',
    registrar: 'تۆمارکار', principal: 'بەڕێوەبەر', no_grades: 'هیچ نمرەیەکی بڵاوکراوە لە تۆماردا نییە.',
    page: 'پەڕە', of: 'لە', em: '—',
  },
};

const PAGE_LEFT = 40;
const PAGE_RIGHT = 555;     // A4 595 - 40 margin
const CONTENT_W = PAGE_RIGHT - PAGE_LEFT;

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function num(n: number | null, dp = 1): string {
  if (n == null) return '—';
  return Number.isInteger(n) ? String(n) : n.toFixed(dp);
}

export async function streamTranscriptPdf(data: TranscriptData, lang: Lang, dest: NodeJS.WritableStream): Promise<void> {
  const l = TL[lang];
  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
  const F = setupPdfFonts(doc);
  doc.pipe(dest);

  // ─── Header strip ───────────────────────────────────────────────────
  const logoBuf = await fetchLogoBuffer(data.school.logoUrl);
  if (logoBuf) {
    try { doc.image(logoBuf, PAGE_LEFT, 40, { fit: [54, 54] }); } catch { /* ignore */ }
  }
  const headX = logoBuf ? 106 : PAGE_LEFT;
  doc.font(F.pick(data.school.name, { bold: true })).fontSize(16).fillColor(COLORS.heading)
    .text(data.school.name, headX, 44, { width: PAGE_RIGHT - headX });
  doc.font(F.pick(l.title, { bold: true })).fontSize(12).fillColor(COLORS.accent)
    .text(l.title, headX, doc.y + 2);
  if (data.config.headerNote && data.config.headerNote.trim()) {
    doc.font(F.pick(data.config.headerNote)).fontSize(8).fillColor(COLORS.muted)
      .text(data.config.headerNote.trim(), headX, doc.y + 2, { width: PAGE_RIGHT - headX });
  }

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
  if (data.student.graduated) {
    doc.font(F.pick(l.graduated, { bold: true })).fontSize(8).fillColor('#15803D')
      .text(l.graduated.toUpperCase(), PAGE_RIGHT - 80, 44, { width: 80, align: 'right' });
  }
  y += 36;
  doc.moveTo(PAGE_LEFT, y).lineTo(PAGE_RIGHT, y).strokeColor(COLORS.border).stroke();
  y += 14;

  // ─── Year/term blocks ───────────────────────────────────────────────
  if (data.terms.length === 0) {
    doc.font(F.pick(l.no_grades)).fontSize(10).fillColor(COLORS.muted).text(l.no_grades, PAGE_LEFT, y);
    y = doc.y + 10;
  } else {
    let currentYear = '';
    for (const block of data.terms) {
      // Year heading whenever the year changes.
      if (block.academicYear !== currentYear) {
        currentYear = block.academicYear;
        if (y > 740) { doc.addPage(); y = 50; }
        doc.rect(PAGE_LEFT, y, CONTENT_W, 20).fill(COLORS.panel);
        doc.font(F.pick(currentYear, { bold: true })).fontSize(11).fillColor(COLORS.heading)
          .text(currentYear, PAGE_LEFT + 8, y + 5, { width: CONTENT_W - 16 });
        y += 26;
      }
      y = drawTermTable(doc, F, l, data, block, y);
      y += 8;
    }
  }

  // ─── Cumulative summary ─────────────────────────────────────────────
  if (data.terms.length > 0) {
    if (y > 720) { doc.addPage(); y = 50; }
    const parts: string[] = [];
    if (data.showPercent && data.cumulative.averagePercent != null) parts.push(`${l.cumulative} ${l.total}: ${num(data.cumulative.averagePercent)}`);
    if (data.showGpa && data.cumulative.gpa != null) parts.push(`${l.cumulative_gpa}: ${num(data.cumulative.gpa, 2)}`);
    if (parts.length) {
      doc.rect(PAGE_LEFT, y, CONTENT_W, 24).fillAndStroke('#EEF2FF', '#C7D2FE');
      doc.font(F.pick(parts.join('     '), { bold: true })).fontSize(11).fillColor(COLORS.heading)
        .text(parts.join('        '), PAGE_LEFT + 8, y + 6, { width: CONTENT_W - 16, align: 'right' });
      y += 34;
    }
  }

  // ─── Signatories ────────────────────────────────────────────────────
  if (y > 730) { doc.addPage(); y = 50; }
  y += 16;
  const sigCol = (label: string, name: string, x: number) => {
    doc.moveTo(x, y).lineTo(x + 200, y).strokeColor(COLORS.border).stroke();
    doc.font(F.pick(label, { bold: true })).fontSize(9).fillColor(COLORS.body).text(label, x, y + 4);
    if (name && name.trim()) doc.font(F.pick(name)).fontSize(9).fillColor(COLORS.muted).text(name.trim(), x, y + 16);
  };
  sigCol(l.registrar, data.config.classTeacher, PAGE_LEFT);
  sigCol(l.principal, data.config.principal, PAGE_LEFT + 300);

  // ─── Per-page footer (margin trick avoids a blank trailing page) ────
  const footNote = (data.config.footerNote && data.config.footerNote.trim()) || '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const range = (doc as any).bufferedPageRange();
  const total = range.start + range.count;
  for (let i = range.start; i < total; i++) {
    doc.switchToPage(i);
    const footer = `${data.school.name} · ${data.student.fullName} · ${l.generated} ${fmtDate(data.generatedAt)} · ${l.page} ${i + 1} ${l.of} ${total}`
      + (footNote ? ` · ${footNote}` : '');
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font(F.pick(footer)).fontSize(7.5).fillColor(COLORS.muted)
      .text(footer, PAGE_LEFT, 812, { width: CONTENT_W, align: 'center', lineBreak: false });
    doc.page.margins.bottom = savedBottom;
  }

  doc.end();
}

// One term's compact table: Term header row + Subject | % | Grade rows + a
// term-average summary row.
function drawTermTable(
  doc: PDFKit.PDFDocument,
  F: ReturnType<typeof setupPdfFonts>,
  l: TLabels,
  data: TranscriptData,
  block: TranscriptTerm,
  startY: number,
): number {
  const pctW = data.showPercent ? 60 : 0;
  const gradeW = data.showGpa ? 90 : 0;
  const subjectW = CONTENT_W - pctW - gradeW;
  const rowH = 16;
  let y = startY;

  const ensure = (need: number) => { if (y + need > 800) { doc.addPage(); y = 50; } };

  // Term label
  ensure(rowH + 14);
  doc.font(F.pick(block.term, { bold: true })).fontSize(9).fillColor(COLORS.accent)
    .text(`${block.term}`, PAGE_LEFT, y);
  y += 14;

  // Column header
  const cols: { label: string; w: number; align: 'left' | 'center' }[] = [{ label: l.subject, w: subjectW, align: 'left' }];
  if (data.showPercent) cols.push({ label: l.total, w: pctW, align: 'center' });
  if (data.showGpa) cols.push({ label: l.grade, w: gradeW, align: 'center' });
  let x = PAGE_LEFT;
  for (const c of cols) {
    doc.rect(x, y, c.w, rowH).fillAndStroke('#F3F4F6', '#D1D5DB');
    doc.font(F.pick(c.label, { bold: true })).fontSize(8).fillColor(COLORS.body)
      .text(c.label, x + 4, y + 4, { width: c.w - 8, align: c.align, ellipsis: true });
    x += c.w;
  }
  y += rowH;

  // Subject rows
  for (const s of block.subjects) {
    ensure(rowH);
    x = PAGE_LEFT;
    const cell = (text: string, w: number, align: 'left' | 'center', bold = false) => {
      doc.rect(x, y, w, rowH).stroke('#E5E7EB');
      doc.font(F.pick(text, { bold })).fontSize(8.5).fillColor(COLORS.body)
        .text(text, x + 4, y + 4, { width: w - 8, align, ellipsis: true });
      x += w;
    };
    cell(s.subject, subjectW, 'left', true);
    if (data.showPercent) cell(s.percent != null ? num(s.percent) : '', pctW, 'center');
    if (data.showGpa) cell(s.letter ? `${s.letter}${s.gradePoint != null ? ` (${s.gradePoint})` : ''}` : '', gradeW, 'center');
    y += rowH;
  }

  // Term average summary row
  const sums: string[] = [];
  if (data.showPercent && block.averagePercent != null) sums.push(`${l.total} ${num(block.averagePercent)}`);
  if (data.showGpa && block.gpa != null) sums.push(`${l.gpa} ${num(block.gpa, 2)}`);
  if (sums.length) {
    ensure(rowH);
    doc.rect(PAGE_LEFT, y, CONTENT_W, rowH).fill('#FAFAFA');
    doc.font(F.pick(l.term_average, { bold: true })).fontSize(8).fillColor(COLORS.muted)
      .text(`${l.term_average}:  ${sums.join('    ')}`, PAGE_LEFT + 6, y + 4, { width: CONTENT_W - 12, align: 'right' });
    y += rowH;
  }
  return y;
}
