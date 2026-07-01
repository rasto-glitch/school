// Weekly-timetable PDF (Schedule 2.0). Landscape A4, one page per teacher and
// one page per class: rows = school days, columns = the day skeleton (lesson
// periods with times + shaded break columns), cells = the lesson at that slot.
// Reuses the shared PDF font stack (Latin + Noto Naskh so Arabic/Kurdish class,
// subject and teacher names shape + reorder correctly).

import PDFDocument from 'pdfkit';
import { setupPdfFonts } from './pdfFont';
import { COLORS, type Lang } from './archivePdfShared';

// Landscape A4 in points.
const PAGE_W = 841.89;
const PAGE_H = 595.28;
const MARGIN = 30;
const LEFT = MARGIN;
const RIGHT = PAGE_W - MARGIN;
const CONTENT_W = PAGE_W - MARGIN * 2;

// Weekday names (0 = Sunday .. 6 = Saturday), for the printable document.
const WD: Record<Lang, string[]> = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  ar: ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'],
  ku: ['یەکشەممە', 'دووشەممە', 'سێشەممە', 'چوارشەممە', 'پێنجشەممە', 'هەینی', 'شەممە'],
};
const LB: Record<Lang, { timetable: string; teacher: string; class: string; day: string; generated: string; page: string; of: string }> = {
  en: { timetable: 'Weekly timetable', teacher: 'Teacher', class: 'Class', day: 'Day', generated: 'Generated', page: 'Page', of: 'of' },
  ar: { timetable: 'الجدول الأسبوعي', teacher: 'معلم', class: 'صف', day: 'اليوم', generated: 'أُنشئ في', page: 'صفحة', of: 'من' },
  ku: { timetable: 'خشتەی هەفتانە', teacher: 'مامۆستا', class: 'پۆل', day: 'ڕۆژ', generated: 'دروستکراوە لە', page: 'پەڕە', of: 'لە' },
};

export interface SchedSlot { kind: 'lesson' | 'break'; period?: number; label?: string; start: string; end: string }
export interface SchedCell { line1?: string; line2?: string; line3?: string }
export interface SchedRow { dayIndex: number; cells: (SchedCell | null)[] }  // aligned to columns
export interface SchedPage { title: string; kind: 'teacher' | 'class'; rows: SchedRow[] }
export interface SchedulePdfData {
  schoolName: string;
  logo: Buffer | null;
  columns: SchedSlot[];
  pages: SchedPage[];
  generatedAt: string;
}

function fmtDate(iso: string): string {
  try { const d = new Date(iso); return isNaN(d.getTime()) ? String(iso) : d.toISOString().slice(0, 10); }
  catch { return String(iso); }
}

type F = ReturnType<typeof setupPdfFonts>;

function drawPage(doc: PDFKit.PDFDocument, F: F, lang: Lang, data: SchedulePdfData, page: SchedPage) {
  const l = LB[lang];

  // ── header ──
  const y = MARGIN;
  let tx = LEFT;
  if (data.logo) {
    try { doc.image(data.logo, LEFT, y, { fit: [36, 36] }); tx = LEFT + 44; } catch { tx = LEFT; }
  }
  doc.fillColor(COLORS.muted).font(F.pick(data.schoolName, { bold: true })).fontSize(11)
    .text(data.schoolName || '', tx, y + 1, { width: 420, lineBreak: false, ellipsis: true });
  doc.fillColor(COLORS.heading).font(F.pick(page.title, { bold: true })).fontSize(15)
    .text(page.title || '', tx, y + 15, { width: 420, lineBreak: false, ellipsis: true });
  const tag = `${l.timetable} · ${page.kind === 'teacher' ? l.teacher : l.class}`;
  doc.fillColor(COLORS.muted).font(F.pick(tag)).fontSize(10)
    .text(tag, RIGHT - 280, y + 8, { width: 280, align: 'right', lineBreak: false });

  // ── column geometry ──
  const dayColW = 60;
  const breakW = 22;
  const lessonCount = Math.max(1, data.columns.filter(c => c.kind === 'lesson').length);
  const breakCount = data.columns.filter(c => c.kind === 'break').length;
  const lessonW = (CONTENT_W - dayColW - breakCount * breakW) / lessonCount;
  const geom: { c: SchedSlot; x: number; w: number }[] = [];
  let gx = LEFT + dayColW;
  for (const c of data.columns) { const w = c.kind === 'lesson' ? lessonW : breakW; geom.push({ c, x: gx, w }); gx += w; }

  const tableTop = y + 48;
  const headerH = 28;
  const rowH = 46;

  // ── table header ──
  doc.rect(LEFT, tableTop, dayColW, headerH).fillAndStroke(COLORS.panel, COLORS.border);
  doc.fillColor(COLORS.body).font(F.pick(l.day, { bold: true })).fontSize(9)
    .text(l.day, LEFT + 2, tableTop + 9, { width: dayColW - 4, align: 'center', lineBreak: false });
  for (const g of geom) {
    if (g.c.kind === 'lesson') {
      doc.rect(g.x, tableTop, g.w, headerH).fillAndStroke('#EEF2FF', COLORS.border);
      doc.fillColor(COLORS.body).font(F.regular).fontSize(9)
        .text(`P${g.c.period ?? ''}`, g.x + 1, tableTop + 4, { width: g.w - 2, align: 'center', lineBreak: false });
      doc.fillColor(COLORS.muted).font(F.regular).fontSize(6.5)
        .text(g.c.start || '', g.x + 1, tableTop + 16, { width: g.w - 2, align: 'center', lineBreak: false });
    } else {
      doc.rect(g.x, tableTop, g.w, headerH).fillAndStroke('#FEF3C7', '#FDE68A');
    }
  }

  // ── body rows ──
  let ry = tableTop + headerH;
  for (const row of page.rows) {
    const dayName = WD[lang][row.dayIndex] ?? '';
    doc.rect(LEFT, ry, dayColW, rowH).fillAndStroke(COLORS.panel, COLORS.border);
    doc.fillColor(COLORS.body).font(F.pick(dayName, { bold: true })).fontSize(8.5)
      .text(dayName, LEFT + 2, ry + rowH / 2 - 6, { width: dayColW - 4, align: 'center', lineBreak: false });
    for (let ci = 0; ci < geom.length; ci++) {
      const g = geom[ci];
      if (g.c.kind === 'break') { doc.rect(g.x, ry, g.w, rowH).fillAndStroke('#FEF9E7', '#FDE68A'); continue; }
      doc.rect(g.x, ry, g.w, rowH).fillAndStroke('#FFFFFF', COLORS.border);
      const cell = row.cells[ci];
      if (cell) {
        const cx = g.x + 2, cw = g.w - 4;
        if (cell.line1) doc.fillColor(COLORS.heading).font(F.pick(cell.line1, { bold: true })).fontSize(8)
          .text(cell.line1, cx, ry + 5, { width: cw, align: 'center', lineBreak: false, ellipsis: true });
        if (cell.line2) doc.fillColor(COLORS.body).font(F.pick(cell.line2)).fontSize(7)
          .text(cell.line2, cx, ry + 18, { width: cw, align: 'center', lineBreak: false, ellipsis: true });
        if (cell.line3) doc.fillColor(COLORS.muted).font(F.pick(cell.line3)).fontSize(6.5)
          .text(cell.line3, cx, ry + 29, { width: cw, align: 'center', lineBreak: false, ellipsis: true });
      }
    }
    ry += rowH;
  }
}

export async function streamSchedulePdf(data: SchedulePdfData, lang: Lang, dest: NodeJS.WritableStream): Promise<void> {
  const l = LB[lang];
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: MARGIN, bufferPages: true });
  const Fonts = setupPdfFonts(doc);
  doc.pipe(dest);

  for (let i = 0; i < data.pages.length; i++) {
    if (i > 0) doc.addPage();
    drawPage(doc, Fonts, lang, data, data.pages[i]);
  }

  // Footer on every page: school · this page's teacher/class · generated · page X of Y.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const range = (doc as any).bufferedPageRange();
  const total = range.start + range.count;
  for (let i = range.start; i < total; i++) {
    doc.switchToPage(i);
    const pg = data.pages[i - range.start];
    const footer = `${data.schoolName}${pg ? ` · ${pg.title}` : ''} · ${l.generated} ${fmtDate(data.generatedAt)} · ${l.page} ${i + 1} ${l.of} ${total}`;
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font(Fonts.pick(footer)).fontSize(7.5).fillColor(COLORS.muted)
      .text(footer, LEFT, PAGE_H - 20, { width: CONTENT_W, align: 'center', lineBreak: false });
    doc.page.margins.bottom = savedBottom;
  }

  doc.end();
}
