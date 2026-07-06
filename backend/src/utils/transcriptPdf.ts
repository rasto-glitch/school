// Cumulative academic Transcript PDF (Phase 4). Live-rendered from released
// grades across ALL academic years/terms — see reportCard.controller. Built on
// the same stack as reportCardPdf.ts: pdfkit + setupPdfFonts (DejaVu + Noto
// Naskh, Arabic/Kurdish shaping), school logo via fetchLogoBuffer, LTR layout
// with per-string F.pick() so RTL text renders correctly. A4, manual layout.

import PDFDocument from 'pdfkit';
import { setupPdfFonts } from './pdfFont';
import { COLORS, fetchLogoBuffer, type Lang } from './archivePdfShared';

// One subject row inside a year block (P5): original per-term percents,
// Round One (originals-only mean), and — when the student sat retakes — the
// Round Two figure with the remedial totals substituted. `letter` is the
// band letter of the effective final (letters are presentation of the same
// percent math — locked decision 16).
export interface TranscriptYearRow {
  subject: string;
  perTerm: (number | null)[];   // aligned with TranscriptYear.terms
  roundOne: number | null;
  final: number | null;
  satRemedial: boolean;
  letter: string | null;
  // Credit marks (079): support credit applied per round + the effective
  // values the official standing actually uses. 0 credit = raw shown as-is.
  roundOneCredit: number;
  roundOneEffective: number | null;
  finalCredit: number;
  finalEffective: number | null;
}
export interface TranscriptCreditLine { round: 'round1' | 'round2'; subject: string; amount: number }
export interface TranscriptYear {
  academicYear: string;
  terms: string[];              // regular terms present, school order
  rows: TranscriptYearRow[];
  anyRoundTwo: boolean;
  yearAverage: number | null;   // mean of subject EFFECTIVE finals (subject-first)
  yearLetter: string | null;
  // Support-mark disclosures for the year: which subjects got how much, per
  // round (user requirement: every grade surface names the round + subjects).
  credits: TranscriptCreditLine[];
}
export interface TranscriptData {
  school: { name: string; logoUrl: string | null };
  student: { fullName: string; className: string | null; dateOfBirth: string | null; graduated: boolean };
  generatedAt: string;       // ISO
  showPercent: boolean;
  showGpa: boolean;
  passPercent: number;       // failing values render red
  years: TranscriptYear[];   // chronological: oldest year first
  config: { classTeacher: string; principal: string; headerNote: string; footerNote: string };
}

interface TLabels {
  title: string; student: string; klass: string; dob: string; generated: string;
  graduated: string; subject: string; grade: string;
  round_one: string; round_two: string; year_average: string;
  credits: string; round_one_short: string; round_two_short: string;
  registrar: string; principal: string; no_grades: string; page: string; of: string; em: string;
}

const TL: Record<Lang, TLabels> = {
  en: {
    title: 'Academic Transcript', student: 'Student', klass: 'Current class', dob: 'Date of birth',
    generated: 'Generated', graduated: 'Graduated', subject: 'Subject', grade: 'Grade',
    round_one: 'Round One', round_two: 'Round Two', year_average: 'Year average',
    credits: 'Support marks', round_one_short: 'Round One', round_two_short: 'Round Two',
    registrar: 'Registrar', principal: 'Principal', no_grades: 'No released grades on record.',
    page: 'Page', of: 'of', em: '—',
  },
  ar: {
    title: 'كشف الدرجات', student: 'الطالب', klass: 'الصف الحالي', dob: 'تاريخ الميلاد',
    generated: 'أُنشئ في', graduated: 'متخرّج', subject: 'المادة', grade: 'التقدير',
    round_one: 'الدور الأول', round_two: 'الدور الثاني', year_average: 'المعدل السنوي',
    credits: 'درجات المساعدة', round_one_short: 'الدور الأول', round_two_short: 'الدور الثاني',
    registrar: 'المسجّل', principal: 'المدير', no_grades: 'لا توجد درجات معتمدة في السجل.',
    page: 'صفحة', of: 'من', em: '—',
  },
  ku: {
    title: 'پێڕستی نمرە', student: 'خوێندکار', klass: 'پۆلی ئێستا', dob: 'بەرواری لەدایکبوون',
    generated: 'دروستکراوە لە', graduated: 'دەرچوو', subject: 'بابەت', grade: 'پلە',
    round_one: 'تێکڕای خوولی یەکەم', round_two: 'تێکڕای خوولی دووەم', year_average: 'تێکڕای ساڵانە',
    credits: 'نمرەی هاوکاری', round_one_short: 'خولی یەکەم', round_two_short: 'خولی دووەم',
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
  // FLOOR to dp — toFixed rounds, and display must never lift a failing
  // value across the pass mark (CREDIT_MARKS_PLAN.md decision 5: 49.96
  // prints 49.9, and only audited credit marks can turn it into 50).
  const scale = Math.pow(10, dp);
  const f = Math.floor((Math.round(n * 1e6) / 1e6) * scale) / scale;
  return Number.isInteger(f) ? String(f) : f.toFixed(dp);
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

  // ─── Year blocks ────────────────────────────────────────────────────
  // Years stand alone (locked decision 15): each gets its own table and year
  // average; there is deliberately NO lifetime cumulative figure.
  if (data.years.length === 0) {
    doc.font(F.pick(l.no_grades)).fontSize(10).fillColor(COLORS.muted).text(l.no_grades, PAGE_LEFT, y);
    y = doc.y + 10;
  } else {
    for (const block of data.years) {
      if (y > 720) { doc.addPage(); y = 50; }
      doc.rect(PAGE_LEFT, y, CONTENT_W, 20).fill(COLORS.panel);
      doc.font(F.pick(block.academicYear, { bold: true })).fontSize(11).fillColor(COLORS.heading)
        .text(block.academicYear, PAGE_LEFT + 8, y + 5, { width: CONTENT_W - 16 });
      y += 26;
      y = drawYearTable(doc, F, l, data, block, y);
      y += 12;
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

// One year's table: Subject | <terms…> | Round One | Round Two (only when the
// student sat retakes that year) | Grade — followed by the year-average row.
// Values below the pass mark render red; a passing Round Two renders green so
// the correction reads at a glance (original stays visible side-by-side —
// locked decisions 2/21).
function drawYearTable(
  doc: PDFKit.PDFDocument,
  F: ReturnType<typeof setupPdfFonts>,
  l: TLabels,
  data: TranscriptData,
  block: TranscriptYear,
  startY: number,
): number {
  const rowH = 16;
  const gradeW = data.showGpa ? 48 : 0;
  const r1W = 62;
  const r2W = block.anyRoundTwo ? 62 : 0;
  const termW = block.terms.length > 0
    ? Math.min(52, Math.floor((CONTENT_W - 120 - r1W - r2W - gradeW) / block.terms.length))
    : 0;
  const subjectW = CONTENT_W - block.terms.length * termW - r1W - r2W - gradeW;
  let y = startY;

  const ensure = (need: number) => { if (y + need > 800) { doc.addPage(); y = 50; } };

  // Column header
  ensure(rowH * 2);
  const heads: { label: string; w: number; align: 'left' | 'center' }[] = [
    { label: l.subject, w: subjectW, align: 'left' },
    ...block.terms.map(t => ({ label: t, w: termW, align: 'center' as const })),
    { label: l.round_one, w: r1W, align: 'center' },
  ];
  if (block.anyRoundTwo) heads.push({ label: l.round_two, w: r2W, align: 'center' });
  if (data.showGpa) heads.push({ label: l.grade, w: gradeW, align: 'center' });
  let x = PAGE_LEFT;
  for (const c of heads) {
    doc.rect(x, y, c.w, rowH).fillAndStroke('#F3F4F6', '#D1D5DB');
    doc.font(F.pick(c.label, { bold: true })).fontSize(7.5).fillColor(COLORS.body)
      .text(c.label, x + 3, y + 4, { width: c.w - 6, align: c.align, ellipsis: true });
    x += c.w;
  }
  y += rowH;

  // Subject rows
  for (const r of block.rows) {
    ensure(rowH);
    x = PAGE_LEFT;
    const cell = (text: string, w: number, align: 'left' | 'center', opts: { bold?: boolean; color?: string } = {}) => {
      doc.rect(x, y, w, rowH).stroke('#E5E7EB');
      doc.font(F.pick(text, { bold: opts.bold })).fontSize(8.5).fillColor(opts.color ?? COLORS.body)
        .text(text, x + 3, y + 4, { width: w - 6, align, ellipsis: true });
      x += w;
    };
    cell(r.subject, subjectW, 'left', { bold: true });
    for (const v of r.perTerm) cell(v != null ? num(v) : l.em, termW, 'center');
    // Round One: with support credit → "50 (+3)"; color follows the
    // EFFECTIVE value (the official standing). The per-year Support-marks
    // line below names every credited subject with its round + amount.
    const r1Eff = r.roundOneEffective ?? r.roundOne;
    cell(
      r.roundOne != null
        ? (r.roundOneCredit > 0 ? `${num(r1Eff)} (+${num(r.roundOneCredit)})` : num(r.roundOne))
        : l.em,
      r1W, 'center',
      { bold: true, color: r1Eff != null && r1Eff < data.passPercent ? '#DC2626' : COLORS.body },
    );
    if (block.anyRoundTwo) {
      const show = r.satRemedial && r.final != null;
      const r2Eff = r.finalEffective ?? r.final;
      cell(
        show
          ? (r.finalCredit > 0 ? `${num(r2Eff)} (+${num(r.finalCredit)})` : num(r.final))
          : l.em,
        r2W, 'center',
        { bold: true, color: !show ? COLORS.muted : (r2Eff as number) < data.passPercent ? '#DC2626' : '#15803D' },
      );
    }
    if (data.showGpa) cell(r.letter ?? l.em, gradeW, 'center', { bold: true });
    y += rowH;
  }

  // Support-marks disclosure: which subjects got how much, per round — the
  // user-locked requirement that every grade surface names the round(s).
  if (block.credits.length > 0) {
    ensure(rowH + 4);
    const byRound = (round: 'round1' | 'round2') => block.credits
      .filter(c => c.round === round)
      .map(c => `${c.subject} +${num(c.amount)}`).join(' · ');
    const parts: string[] = [];
    const r1 = byRound('round1'); const r2 = byRound('round2');
    if (r1) parts.push(`${l.round_one_short}: ${r1}`);
    if (r2) parts.push(`${l.round_two_short}: ${r2}`);
    const line = `${l.credits} — ${parts.join(' · ')}`;
    doc.font(F.pick(line)).fontSize(8).fillColor(COLORS.muted)
      .text(line, PAGE_LEFT + 3, y + 3, { width: CONTENT_W - 6 });
    y = doc.y + 4;
  }

  // Year average row — the official subject-first figure.
  if (block.yearAverage != null) {
    ensure(rowH + 4);
    const value = `${num(block.yearAverage)}${data.showGpa && block.yearLetter ? ` (${block.yearLetter})` : ''}`;
    doc.rect(PAGE_LEFT, y, CONTENT_W, rowH + 2).fillAndStroke('#EEF2FF', '#C7D2FE');
    doc.font(F.pick(`${l.year_average}: ${value}`, { bold: true })).fontSize(9).fillColor(COLORS.heading)
      .text(`${l.year_average}:  ${value}`, PAGE_LEFT + 6, y + 4, { width: CONTENT_W - 12, align: 'right' });
    y += rowH + 2;
  }
  return y;
}
