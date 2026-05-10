import PDFDocument from 'pdfkit';
import * as XLSX from 'xlsx';
import type { Writable } from 'stream';

// Ledger export — used by the accountant ledger tab. Two formats:
//   - PDF: human-readable summary + entries table (multi-page)
//   - XLSX: 3 sheets — Summary, Categories, Entries — with autofilter
//     and column widths so the Entries sheet behaves like a real table.

export interface LedgerExportRow {
  date: string;
  type: 'income' | 'expense';
  source: 'fee_payment' | 'staff_salary_payment' | 'expense';
  category: string;
  description: string;
  amount: number;
  currency: string;
  reference: string | null;
}

export interface LedgerExportTotal {
  currency: string;
  income: number;
  expense: number;
  net: number;
  count: number;
}

export interface LedgerExportCategory {
  category: string;
  type: 'income' | 'expense';
  amount: number;
  currency: string;
}

export interface LedgerExportData {
  schoolName: string;
  schoolLogoUrl: string | null;
  startDate: string | null;
  endDate: string | null;
  rows: LedgerExportRow[];
  totals: LedgerExportTotal[];
  categories: LedgerExportCategory[];
}

const COLOR_HEADING = '#111827';
const COLOR_MUTED = '#6B7280';
const COLOR_BORDER = '#E5E7EB';
const COLOR_INCOME = '#047857';
const COLOR_EXPENSE = '#BE123C';
const COLOR_ACCENT = '#4F46E5';

const SOURCE_LABEL: Record<LedgerExportRow['source'], string> = {
  fee_payment: 'Tuition',
  staff_salary_payment: 'Salary',
  expense: 'Expense',
};

async function fetchLogoBuffer(url: string | null): Promise<Buffer | null> {
  if (!url) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch {
    return null;
  }
}

function fmt(amount: number, currency: string): string {
  const symbols: Record<string, string> = { USD: '$', EUR: '€', GBP: '£' };
  const sym = symbols[currency] ?? '';
  const num = (Number(amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return sym ? `${sym}${num}` : `${currency} ${num}`;
}

export async function streamLedgerPdf(stream: Writable, data: LedgerExportData): Promise<void> {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  doc.pipe(stream);

  const logoBuf = await fetchLogoBuffer(data.schoolLogoUrl);
  if (logoBuf) {
    try { doc.image(logoBuf, 40, 40, { fit: [60, 60] }); } catch { /* invalid */ }
  }
  doc.font('Helvetica-Bold').fontSize(18).fillColor(COLOR_HEADING).text(data.schoolName, 110, 48);
  const range = `${data.startDate ?? '…'} → ${data.endDate ?? '…'}`;
  doc.font('Helvetica').fontSize(10).fillColor(COLOR_MUTED).text(`Ledger · ${range}`, 110, 72);
  doc.moveTo(40, 112).lineTo(555, 112).strokeColor(COLOR_BORDER).lineWidth(1).stroke();

  let y = 128;

  // ── Per-currency summary cards (stacked) ──────────────────────────────
  doc.font('Helvetica').fontSize(8).fillColor(COLOR_MUTED).text('SUMMARY', 40, y);
  y += 14;
  if (data.totals.length === 0) {
    doc.font('Helvetica').fontSize(11).fillColor(COLOR_MUTED).text('No entries in this range.', 40, y, { width: 515, align: 'center' });
    doc.end();
    return;
  }
  for (const t of data.totals) {
    if (y > 740) { doc.addPage(); y = 60; }
    doc.font('Helvetica-Bold').fontSize(11).fillColor(COLOR_HEADING).text(t.currency, 40, y);
    doc.font('Helvetica').fontSize(10).fillColor(COLOR_MUTED).text(`${t.count} ${t.count === 1 ? 'entry' : 'entries'}`, 100, y);
    doc.font('Helvetica').fontSize(10).fillColor(COLOR_INCOME).text(`Income ${fmt(t.income, t.currency)}`, 200, y, { width: 130 });
    doc.font('Helvetica').fontSize(10).fillColor(COLOR_EXPENSE).text(`Expense ${fmt(t.expense, t.currency)}`, 330, y, { width: 130 });
    doc.font('Helvetica-Bold').fontSize(10).fillColor(t.net >= 0 ? COLOR_INCOME : COLOR_EXPENSE)
      .text(`Net ${fmt(t.net, t.currency)}`, 460, y, { width: 95, align: 'right' });
    y += 16;
  }
  y += 6;
  doc.moveTo(40, y).lineTo(555, y).strokeColor(COLOR_BORDER).stroke();
  y += 12;

  // ── Category breakdown ───────────────────────────────────────────────
  if (data.categories.length > 0) {
    doc.font('Helvetica').fontSize(8).fillColor(COLOR_MUTED).text('BY CATEGORY', 40, y);
    y += 14;
    const byCurrency = new Map<string, LedgerExportCategory[]>();
    for (const c of data.categories) {
      const a = byCurrency.get(c.currency) ?? [];
      a.push(c);
      byCurrency.set(c.currency, a);
    }
    for (const [currency, list] of byCurrency) {
      if (y > 740) { doc.addPage(); y = 60; }
      if (byCurrency.size > 1) {
        doc.font('Helvetica-Bold').fontSize(9).fillColor(COLOR_MUTED).text(currency, 40, y);
        y += 12;
      }
      const income = list.filter(c => c.type === 'income');
      const expense = list.filter(c => c.type === 'expense');
      const left = 40, right = 300;
      const startY = y;

      let yL = startY;
      doc.font('Helvetica-Bold').fontSize(9).fillColor(COLOR_INCOME).text('Income', left, yL);
      yL += 12;
      for (const c of income) {
        if (yL > 760) { doc.addPage(); yL = 60; }
        doc.font('Helvetica').fontSize(10).fillColor(COLOR_HEADING).text(c.category, left, yL, { width: 180 });
        doc.font('Helvetica').fontSize(10).fillColor(COLOR_INCOME).text(fmt(c.amount, c.currency), left + 180, yL, { width: 70, align: 'right' });
        yL += 14;
      }

      let yR = startY;
      doc.font('Helvetica-Bold').fontSize(9).fillColor(COLOR_EXPENSE).text('Expense', right, yR);
      yR += 12;
      for (const c of expense) {
        if (yR > 760) { doc.addPage(); yR = 60; }
        doc.font('Helvetica').fontSize(10).fillColor(COLOR_HEADING).text(c.category, right, yR, { width: 180 });
        doc.font('Helvetica').fontSize(10).fillColor(COLOR_EXPENSE).text(fmt(c.amount, c.currency), right + 180, yR, { width: 70, align: 'right' });
        yR += 14;
      }
      y = Math.max(yL, yR) + 6;
    }
    doc.moveTo(40, y).lineTo(555, y).strokeColor(COLOR_BORDER).stroke();
    y += 12;
  }

  // ── Entries table ─────────────────────────────────────────────────────
  doc.font('Helvetica').fontSize(8).fillColor(COLOR_MUTED).text('ENTRIES', 40, y);
  y += 14;
  const drawHeader = () => {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(COLOR_MUTED);
    doc.text('DATE', 40, y, { width: 60 });
    doc.text('SOURCE', 100, y, { width: 60 });
    doc.text('CATEGORY', 160, y, { width: 80 });
    doc.text('DESCRIPTION', 240, y, { width: 200 });
    doc.text('IN', 440, y, { width: 55, align: 'right' });
    doc.text('OUT', 500, y, { width: 55, align: 'right' });
    y += 12;
    doc.moveTo(40, y).lineTo(555, y).strokeColor(COLOR_BORDER).stroke();
    y += 6;
  };
  drawHeader();

  for (const r of data.rows) {
    if (y > 770) { doc.addPage(); y = 60; drawHeader(); }
    doc.font('Helvetica').fontSize(9).fillColor(COLOR_HEADING);
    doc.text(r.date, 40, y, { width: 60 });
    doc.text(SOURCE_LABEL[r.source], 100, y, { width: 60 });
    doc.text(r.category, 160, y, { width: 80, ellipsis: true });
    const desc = r.reference ? `${r.description} — ${r.reference}` : r.description;
    doc.text(desc, 240, y, { width: 200, ellipsis: true });
    if (r.type === 'income') {
      doc.fillColor(COLOR_INCOME).text(fmt(r.amount, r.currency), 440, y, { width: 55, align: 'right' });
      doc.text('', 500, y, { width: 55, align: 'right' });
    } else {
      doc.text('', 440, y, { width: 55, align: 'right' });
      doc.fillColor(COLOR_EXPENSE).text(fmt(r.amount, r.currency), 500, y, { width: 55, align: 'right' });
    }
    y += 14;
  }

  doc.font('Helvetica').fontSize(9).fillColor(COLOR_MUTED).text(
    `Generated by ${data.schoolName} · ${new Date().toISOString().split('T')[0]}`,
    40, 800, { width: 515, align: 'center' },
  );
  doc.end();
}

// Helper: turn a sheet into a "proper table" — sets header row, autofilter,
// freezes the header row, and applies column widths.
function makeTable(ws: XLSX.WorkSheet, lastRowIndex: number, lastColLetter: string) {
  ws['!autofilter'] = { ref: `A1:${lastColLetter}${lastRowIndex}` };
  // Freeze first row
  (ws as Record<string, unknown>)['!freeze'] = { xSplit: 0, ySplit: 1 };
  // Frozen pane via standard view options (SheetJS recognises these)
  (ws as Record<string, unknown>)['!views'] = [{ state: 'frozen', ySplit: 1, topLeftCell: 'A2' }];
}

export function buildLedgerXlsx(data: LedgerExportData): Buffer {
  const wb = XLSX.utils.book_new();

  // ── Sheet 1: Summary ────────────────────────────────────────────────
  const range = `${data.startDate ?? ''} to ${data.endDate ?? ''}`;
  const summaryHead: (string | number)[][] = [
    ['School', data.schoolName],
    ['Date range', range],
    ['Generated', new Date().toISOString().split('T')[0]],
    [],
    ['Currency', 'Income', 'Expense', 'Net', 'Entries'],
  ];
  for (const t of data.totals) {
    summaryHead.push([t.currency, t.income, t.expense, t.net, t.count]);
  }
  const summaryWs = XLSX.utils.aoa_to_sheet(summaryHead);
  summaryWs['!cols'] = [{ wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 12 }];
  if (data.totals.length > 0) {
    // Row 5 is the totals header (1-based index 5). Apply autofilter from header to last data row.
    const lastTotalsRow = 5 + data.totals.length;
    summaryWs['!autofilter'] = { ref: `A5:E${lastTotalsRow}` };
  }
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');

  // ── Sheet 2: By category ────────────────────────────────────────────
  const catRows: (string | number)[][] = [
    ['Currency', 'Direction', 'Category', 'Amount'],
  ];
  for (const c of data.categories) {
    catRows.push([c.currency, c.type === 'income' ? 'Income' : 'Expense', c.category, c.amount]);
  }
  const catWs = XLSX.utils.aoa_to_sheet(catRows);
  catWs['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 28 }, { wch: 16 }];
  if (data.categories.length > 0) {
    makeTable(catWs, catRows.length, 'D');
  }
  XLSX.utils.book_append_sheet(wb, catWs, 'Categories');

  // ── Sheet 3: Entries (the full ledger as a table) ──────────────────
  const rows: (string | number)[][] = [
    ['Date', 'Direction', 'Source', 'Category', 'Description', 'Reference', 'Amount', 'Currency'],
  ];
  for (const r of data.rows) {
    rows.push([
      r.date,
      r.type === 'income' ? 'Income' : 'Expense',
      SOURCE_LABEL[r.source],
      r.category,
      r.description,
      r.reference ?? '',
      r.amount,
      r.currency,
    ]);
  }
  const entriesWs = XLSX.utils.aoa_to_sheet(rows);
  entriesWs['!cols'] = [
    { wch: 12 },  // Date
    { wch: 11 },  // Direction
    { wch: 11 },  // Source
    { wch: 22 },  // Category
    { wch: 42 },  // Description
    { wch: 26 },  // Reference
    { wch: 14 },  // Amount
    { wch: 10 },  // Currency
  ];
  if (data.rows.length > 0) {
    makeTable(entriesWs, rows.length, 'H');
  }
  XLSX.utils.book_append_sheet(wb, entriesWs, 'Entries');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
