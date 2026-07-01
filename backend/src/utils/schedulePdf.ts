// Weekly-timetable PDF (Schedule 2.0). Landscape A4.
//   • Teachers: ONE master grid — rows = teachers, columns grouped by working
//     day → each lesson period, cells = the class taught then (paginates down
//     when there are more teachers than fit on a page, header repeats).
//   • Classes: one page per class — rows = days, columns = the day skeleton
//     (lesson periods with times + shaded break columns), cells = subject /
//     teacher / room.
// Reuses the shared PDF font stack (Latin + Noto Naskh) so Arabic/Kurdish
// class, subject and teacher names shape + reorder correctly.

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
const FOOTER_Y = PAGE_H - 20;
const ROW_BOTTOM_LIMIT = PAGE_H - 28;   // last y a body row may reach before the footer

// Weekday names (0 = Sunday .. 6 = Saturday), for the printable document.
const WD: Record<Lang, string[]> = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  ar: ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'],
  ku: ['یەکشەممە', 'دووشەممە', 'سێشەممە', 'چوارشەممە', 'پێنجشەممە', 'هەینی', 'شەممە'],
};
const LB: Record<Lang, { timetable: string; teachers_timetable: string; continued: string; teacher: string; class: string; day: string; generated: string; page: string; of: string }> = {
  en: { timetable: 'Weekly timetable', teachers_timetable: 'Teachers — weekly timetable', continued: 'continued', teacher: 'Teacher', class: 'Class', day: 'Day', generated: 'Generated', page: 'Page', of: 'of' },
  ar: { timetable: 'الجدول الأسبوعي', teachers_timetable: 'المعلمون — الجدول الأسبوعي', continued: 'تابع', teacher: 'المعلم', class: 'صف', day: 'اليوم', generated: 'أُنشئ في', page: 'صفحة', of: 'من' },
  ku: { timetable: 'خشتەی هەفتانە', teachers_timetable: 'مامۆستایان — خشتەی هەفتانە', continued: 'بەردەوام', teacher: 'مامۆستا', class: 'پۆل', day: 'ڕۆژ', generated: 'دروستکراوە لە', page: 'پەڕە', of: 'لە' },
};

export interface SchedSlot { kind: 'lesson' | 'break'; period?: number; label?: string; start: string; end: string }
export interface SchedCell { line1?: string; line2?: string; line3?: string }
export interface SchedRow { dayIndex: number; cells: (SchedCell | null)[] }  // aligned to columns
export interface SchedPage { title: string; kind: 'class'; rows: SchedRow[] }
export interface MasterGridData { days: number[]; periods: number[]; rows: { teacher: string; cells: (SchedCell | null)[] }[] }
export interface SchedulePdfData {
  schoolName: string;
  logo: Buffer | null;
  columns: SchedSlot[];        // skeleton for the per-class pages
  master: MasterGridData | null;
  classPages: SchedPage[];
  generatedAt: string;
}

function fmtDate(iso: string): string {
  try { const d = new Date(iso); return isNaN(d.getTime()) ? String(iso) : d.toISOString().slice(0, 10); }
  catch { return String(iso); }
}

type F = ReturnType<typeof setupPdfFonts>;

// Small header block (logo + school + title) shared by both layouts.
function drawTopHeader(doc: PDFKit.PDFDocument, F: F, schoolName: string, logo: Buffer | null, title: string, withLogo: boolean): number {
  const y = MARGIN;
  let tx = LEFT;
  if (withLogo && logo) { try { doc.image(logo, LEFT, y, { fit: [34, 34] }); tx = LEFT + 42; } catch { tx = LEFT; } }
  doc.fillColor(COLORS.muted).font(F.pick(schoolName, { bold: true })).fontSize(11)
    .text(schoolName || '', tx, y + 1, { width: 440, lineBreak: false, ellipsis: true });
  doc.fillColor(COLORS.heading).font(F.pick(title, { bold: true })).fontSize(14)
    .text(title || '', tx, y + 15, { width: 520, lineBreak: false, ellipsis: true });
  return y + 42;
}

// ── Master teacher grid (rows = teachers, columns = day × period) ──
function drawMasterGrid(
  doc: PDFKit.PDFDocument, F: F, lang: Lang, schoolName: string, logo: Buffer | null,
  master: MasterGridData, pageTitles: string[], firstPageAvailable: boolean,
): void {
  const l = LB[lang];
  const teacherColW = 82;
  const dayCount = Math.max(1, master.days.length);
  const perCount = Math.max(1, master.periods.length);
  const totalCols = dayCount * perCount;
  const colW = (CONTENT_W - teacherColW) / totalCols;
  const dayGroupW = perCount * colW;
  const showSubject = colW >= 34;
  const rowH = 22;
  const h1 = 16, h2 = 14;

  let first = firstPageAvailable;
  let ry = 0;

  const startPage = (continuation: boolean) => {
    if (!first) doc.addPage();
    first = false;
    pageTitles.push(l.teachers_timetable);
    const top = drawTopHeader(doc, F, schoolName, logo, l.teachers_timetable + (continuation ? ` (${l.continued})` : ''), !continuation);
    // Teacher column header spans both header rows.
    doc.rect(LEFT, top, teacherColW, h1 + h2).fillAndStroke(COLORS.panel, COLORS.border);
    doc.fillColor(COLORS.body).font(F.pick(l.teacher, { bold: true })).fontSize(8)
      .text(l.teacher, LEFT + 3, top + (h1 + h2) / 2 - 5, { width: teacherColW - 6, align: 'center', lineBreak: false });
    let x = LEFT + teacherColW;
    for (const d of master.days) {
      doc.rect(x, top, dayGroupW, h1).fillAndStroke('#EEF2FF', COLORS.border);
      doc.fillColor(COLORS.body).font(F.pick(WD[lang][d] ?? '', { bold: true })).fontSize(8)
        .text(WD[lang][d] ?? '', x + 1, top + 4, { width: dayGroupW - 2, align: 'center', lineBreak: false, ellipsis: true });
      let px = x;
      for (const p of master.periods) {
        doc.rect(px, top + h1, colW, h2).fillAndStroke('#F8FAFF', COLORS.border);
        doc.fillColor(COLORS.muted).font(F.regular).fontSize(6.5)
          .text(`P${p}`, px, top + h1 + 3, { width: colW, align: 'center', lineBreak: false });
        px += colW;
      }
      x += dayGroupW;
    }
    ry = top + h1 + h2;
  };

  startPage(false);

  for (const row of master.rows) {
    if (ry + rowH > ROW_BOTTOM_LIMIT) startPage(true);
    // teacher name
    doc.rect(LEFT, ry, teacherColW, rowH).fillAndStroke('#FFFFFF', COLORS.border);
    doc.fillColor(COLORS.heading).font(F.pick(row.teacher, { bold: true })).fontSize(7.5)
      .text(row.teacher, LEFT + 3, ry + rowH / 2 - 5, { width: teacherColW - 6, align: 'left', lineBreak: false, ellipsis: true });
    let ci = 0;
    let cx = LEFT + teacherColW;
    for (let di = 0; di < dayCount; di++) {
      for (let pi = 0; pi < perCount; pi++) {
        const cell = row.cells[ci];
        doc.rect(cx, ry, colW, rowH).fillAndStroke('#FFFFFF', COLORS.border);
        if (cell && cell.line1) {
          doc.fillColor(COLORS.body).font(F.pick(cell.line1, { bold: true })).fontSize(6.5)
            .text(cell.line1, cx + 1, ry + (showSubject ? 3 : rowH / 2 - 4), { width: colW - 2, align: 'center', lineBreak: false, ellipsis: true });
          if (showSubject && cell.line2) doc.fillColor(COLORS.muted).font(F.pick(cell.line2)).fontSize(5.5)
            .text(cell.line2, cx + 1, ry + 12, { width: colW - 2, align: 'center', lineBreak: false, ellipsis: true });
        }
        cx += colW; ci++;
      }
    }
    ry += rowH;
  }
}

// ── Per-class page (rows = days, columns = skeleton) ──
function drawClassPage(doc: PDFKit.PDFDocument, F: F, lang: Lang, schoolName: string, logo: Buffer | null, columns: SchedSlot[], page: SchedPage): void {
  const l = LB[lang];
  const top = drawTopHeader(doc, F, schoolName, logo, page.title, true);
  const tag = `${l.timetable} · ${l.class}`;
  doc.fillColor(COLORS.muted).font(F.pick(tag)).fontSize(10).text(tag, RIGHT - 280, MARGIN + 8, { width: 280, align: 'right', lineBreak: false });

  const dayColW = 60;
  const breakW = 22;
  const lessonCount = Math.max(1, columns.filter(c => c.kind === 'lesson').length);
  const breakCount = columns.filter(c => c.kind === 'break').length;
  const lessonW = (CONTENT_W - dayColW - breakCount * breakW) / lessonCount;
  const geom: { c: SchedSlot; x: number; w: number }[] = [];
  let gx = LEFT + dayColW;
  for (const c of columns) { const w = c.kind === 'lesson' ? lessonW : breakW; geom.push({ c, x: gx, w }); gx += w; }

  const tableTop = top + 6;
  const headerH = 28;
  const rowH = 46;

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

  const pageTitles: string[] = [];
  let usedFirst = false;

  if (data.master && data.master.rows.length > 0) {
    drawMasterGrid(doc, Fonts, lang, data.schoolName, data.logo, data.master, pageTitles, true);
    usedFirst = true;
  }
  for (const cp of data.classPages) {
    if (usedFirst) doc.addPage();
    usedFirst = true;
    pageTitles.push(cp.title);
    drawClassPage(doc, Fonts, lang, data.schoolName, data.logo, data.columns, cp);
  }

  // Footer on every physical page.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const range = (doc as any).bufferedPageRange();
  const total = range.start + range.count;
  for (let i = range.start; i < total; i++) {
    doc.switchToPage(i);
    const title = pageTitles[i - range.start] || '';
    const footer = `${data.schoolName}${title ? ` · ${title}` : ''} · ${l.generated} ${fmtDate(data.generatedAt)} · ${l.page} ${i + 1} ${l.of} ${total}`;
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font(Fonts.pick(footer)).fontSize(7.5).fillColor(COLORS.muted)
      .text(footer, LEFT, FOOTER_Y, { width: CONTENT_W, align: 'center', lineBreak: false });
    doc.page.margins.bottom = savedBottom;
  }

  doc.end();
}
