import PDFDocument from 'pdfkit';
import { setupPdfFonts } from './pdfFont';
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

import { fmtMoneyPdf as fmt } from './currency';

export async function streamLedgerPdf(stream: Writable, data: LedgerExportData): Promise<void> {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const F = setupPdfFonts(doc);
  doc.pipe(stream);

  const M = 40;
  const CONTENT_W = 515; // 595 (A4 width) - 80 margins
  const PAGE_BOTTOM = 800;

  const logoBuf = await fetchLogoBuffer(data.schoolLogoUrl);
  if (logoBuf) {
    try { doc.image(logoBuf, M, M, { fit: [60, 60] }); } catch { /* invalid */ }
  }
  doc.font(F.bold).fontSize(18).fillColor(COLOR_HEADING).text(data.schoolName, 110, 48);
  // Use ASCII separator — pdfkit's default WinAnsi encoding can't render U+2192.
  const range = `${data.startDate ?? '...'} to ${data.endDate ?? '...'}`;
  doc.font(F.regular).fontSize(10).fillColor(COLOR_MUTED).text(`Ledger · ${range}`, 110, 72);
  doc.moveTo(M, 112).lineTo(M + CONTENT_W, 112).strokeColor(COLOR_BORDER).lineWidth(1).stroke();

  let y = 128;
  const ensureSpace = (need: number) => {
    if (y + need > PAGE_BOTTOM - 20) {
      doc.addPage();
      y = M + 20;
    }
  };

  // ── SUMMARY (one block per currency, two rows each) ──────────────────
  doc.font(F.regular).fontSize(8).fillColor(COLOR_MUTED).text('SUMMARY', M, y);
  y += 14;
  if (data.totals.length === 0) {
    doc.font(F.regular).fontSize(11).fillColor(COLOR_MUTED).text('No entries in this range.', M, y, { width: CONTENT_W, align: 'center' });
    doc.end();
    return;
  }
  for (const t of data.totals) {
    ensureSpace(40);
    // Row 1: currency label (left) + entry count (right)
    doc.font(F.bold).fontSize(13).fillColor(COLOR_HEADING).text(t.currency, M, y, { width: 200, lineBreak: false });
    doc.font(F.regular).fontSize(10).fillColor(COLOR_MUTED).text(
      `${t.count} ${t.count === 1 ? 'entry' : 'entries'}`,
      M + CONTENT_W - 100, y + 3, { width: 100, align: 'right', lineBreak: false },
    );
    y += 18;
    // Row 2: three equal cells — Income | Expense | Net
    const colW = (CONTENT_W - 20) / 3;  // 165 each, 10px gutters
    const c1 = M;
    const c2 = M + colW + 10;
    const c3 = M + (colW + 10) * 2;
    doc.font(F.regular).fontSize(8).fillColor(COLOR_MUTED).text('INCOME', c1, y, { width: colW, lineBreak: false });
    doc.font(F.regular).fontSize(8).fillColor(COLOR_MUTED).text('EXPENSE', c2, y, { width: colW, lineBreak: false });
    doc.font(F.regular).fontSize(8).fillColor(COLOR_MUTED).text('NET', c3, y, { width: colW, lineBreak: false });
    doc.font(F.bold).fontSize(11).fillColor(COLOR_INCOME).text(fmt(t.income, t.currency), c1, y + 11, { width: colW, lineBreak: false });
    doc.font(F.bold).fontSize(11).fillColor(COLOR_EXPENSE).text(fmt(t.expense, t.currency), c2, y + 11, { width: colW, lineBreak: false });
    doc.font(F.bold).fontSize(11).fillColor(t.net >= 0 ? COLOR_INCOME : COLOR_EXPENSE)
      .text(fmt(t.net, t.currency), c3, y + 11, { width: colW, lineBreak: false });
    y += 30;
  }
  doc.moveTo(M, y).lineTo(M + CONTENT_W, y).strokeColor(COLOR_BORDER).stroke();
  y += 12;

  // ── BY CATEGORY (two columns: Income on left, Expense on right) ──────
  if (data.categories.length > 0) {
    doc.font(F.regular).fontSize(8).fillColor(COLOR_MUTED).text('BY CATEGORY', M, y);
    y += 14;
    const byCurrency = new Map<string, LedgerExportCategory[]>();
    for (const c of data.categories) {
      const a = byCurrency.get(c.currency) ?? [];
      a.push(c);
      byCurrency.set(c.currency, a);
    }
    const colW = (CONTENT_W - 30) / 2;  // 242 each, 30px gutter
    const amountW = 110;
    const labelW = colW - amountW;
    const leftX = M;
    const rightX = M + colW + 30;

    for (const [currency, list] of byCurrency) {
      ensureSpace(36);
      if (byCurrency.size > 1) {
        doc.font(F.bold).fontSize(10).fillColor(COLOR_HEADING).text(currency, M, y, { lineBreak: false });
        y += 14;
      }
      const income = list.filter(c => c.type === 'income');
      const expense = list.filter(c => c.type === 'expense');
      doc.font(F.bold).fontSize(9).fillColor(COLOR_INCOME).text('Income', leftX, y, { lineBreak: false });
      doc.font(F.bold).fontSize(9).fillColor(COLOR_EXPENSE).text('Expense', rightX, y, { lineBreak: false });
      const headerRowY = y + 12;
      let yL = headerRowY, yR = headerRowY;
      const rowH = 14;
      for (const c of income) {
        if (yL + rowH > PAGE_BOTTOM - 20) { doc.addPage(); yL = M + 20; }
        doc.font(F.regular).fontSize(10).fillColor(COLOR_HEADING).text(c.category, leftX, yL, { width: labelW, ellipsis: true, lineBreak: false });
        doc.font(F.regular).fontSize(10).fillColor(COLOR_INCOME).text(fmt(c.amount, c.currency), leftX + labelW, yL, { width: amountW, align: 'right', lineBreak: false });
        yL += rowH;
      }
      for (const c of expense) {
        if (yR + rowH > PAGE_BOTTOM - 20) { doc.addPage(); yR = M + 20; }
        doc.font(F.regular).fontSize(10).fillColor(COLOR_HEADING).text(c.category, rightX, yR, { width: labelW, ellipsis: true, lineBreak: false });
        doc.font(F.regular).fontSize(10).fillColor(COLOR_EXPENSE).text(fmt(c.amount, c.currency), rightX + labelW, yR, { width: amountW, align: 'right', lineBreak: false });
        yR += rowH;
      }
      if (income.length === 0) {
        doc.font(F.regular).fontSize(10).fillColor(COLOR_MUTED).text('—', leftX, headerRowY, { lineBreak: false });
      }
      if (expense.length === 0) {
        doc.font(F.regular).fontSize(10).fillColor(COLOR_MUTED).text('—', rightX, headerRowY, { lineBreak: false });
      }
      y = Math.max(yL, yR) + 6;
    }
    doc.moveTo(M, y).lineTo(M + CONTENT_W, y).strokeColor(COLOR_BORDER).stroke();
    y += 12;
  }

  // ── ENTRIES (table with dynamic row heights to handle wrapping) ──────
  doc.font(F.regular).fontSize(8).fillColor(COLOR_MUTED).text('ENTRIES', M, y);
  y += 14;

  // Column widths — tuned so even "IQD 2,700,000.00" fits IN/OUT without wrapping.
  const COL_DATE = 55, COL_SOURCE = 45, COL_CATEGORY = 60, COL_DESC = 170, COL_IN = 90, COL_OUT = 95;
  const X_DATE = M;
  const X_SOURCE = X_DATE + COL_DATE;
  const X_CATEGORY = X_SOURCE + COL_SOURCE;
  const X_DESC = X_CATEGORY + COL_CATEGORY;
  const X_IN = X_DESC + COL_DESC;
  const X_OUT = X_IN + COL_IN;

  const drawHeader = () => {
    doc.font(F.bold).fontSize(8).fillColor(COLOR_MUTED);
    doc.text('DATE', X_DATE, y, { width: COL_DATE, lineBreak: false });
    doc.text('SOURCE', X_SOURCE, y, { width: COL_SOURCE, lineBreak: false });
    doc.text('CATEGORY', X_CATEGORY, y, { width: COL_CATEGORY, lineBreak: false });
    doc.text('DESCRIPTION', X_DESC, y, { width: COL_DESC, lineBreak: false });
    doc.text('IN', X_IN, y, { width: COL_IN, align: 'right', lineBreak: false });
    doc.text('OUT', X_OUT, y, { width: COL_OUT, align: 'right', lineBreak: false });
    y += 12;
    doc.moveTo(M, y).lineTo(M + CONTENT_W, y).strokeColor(COLOR_BORDER).stroke();
    y += 6;
  };
  drawHeader();

  for (const r of data.rows) {
    // Measure desc + reference height to pick a row height that won't overlap.
    doc.font(F.regular).fontSize(9);
    const descH = doc.heightOfString(r.description, { width: COL_DESC });
    doc.font(F.oblique).fontSize(8);
    const refH = r.reference ? doc.heightOfString(r.reference, { width: COL_DESC }) : 0;
    const rowH = Math.max(14, descH + (r.reference ? refH + 2 : 0) + 4);

    if (y + rowH > PAGE_BOTTOM - 20) { doc.addPage(); y = M + 20; drawHeader(); }

    doc.font(F.regular).fontSize(9).fillColor(COLOR_HEADING);
    doc.text(r.date, X_DATE, y, { width: COL_DATE, lineBreak: false });
    doc.text(SOURCE_LABEL[r.source], X_SOURCE, y, { width: COL_SOURCE, lineBreak: false });
    doc.text(r.category, X_CATEGORY, y, { width: COL_CATEGORY, ellipsis: true, lineBreak: false });
    doc.text(r.description, X_DESC, y, { width: COL_DESC });
    if (r.reference) {
      doc.font(F.oblique).fontSize(8).fillColor(COLOR_MUTED)
        .text(r.reference, X_DESC, y + descH + 1, { width: COL_DESC });
    }
    if (r.type === 'income') {
      doc.font(F.regular).fontSize(9).fillColor(COLOR_INCOME)
        .text(fmt(r.amount, r.currency), X_IN, y, { width: COL_IN, align: 'right', lineBreak: false });
    } else {
      doc.font(F.regular).fontSize(9).fillColor(COLOR_EXPENSE)
        .text(fmt(r.amount, r.currency), X_OUT, y, { width: COL_OUT, align: 'right', lineBreak: false });
    }
    y += rowH;
  }

  // Footer — pinned to current page bottom, lineBreak:false stops auto page-add.
  doc.font(F.regular).fontSize(9).fillColor(COLOR_MUTED).text(
    `Generated by ${data.schoolName} · ${new Date().toISOString().split('T')[0]}`,
    M, doc.page.height - 25, { width: CONTENT_W, align: 'center', lineBreak: false },
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
