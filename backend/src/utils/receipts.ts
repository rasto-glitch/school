import PDFDocument from 'pdfkit';
import { setupPdfFonts } from './pdfFont';
import type { Writable } from 'stream';

interface SchoolInfo {
  name: string;
  logoUrl: string | null;
}

interface Common {
  school: SchoolInfo;
  parentName: string;
  studentName: string;
  planName: string;
  academicYear: string | null;
  currency: string;
}

export interface PaymentAllocationLine {
  sequence: number;
  dueDate: string;
  amount: number;
}

export interface PaymentReceiptData extends Common {
  receiptNumber: string;
  paidOn: string;
  amount: number;
  method: string | null;
  reference: string | null;
  notes: string | null;
  totalAmount: number;
  adjustment: number;
  siblingDiscount: number;
  paidBefore: number;
  recorderName: string | null;
  allocations: PaymentAllocationLine[];
  unallocatedAmount: number;
  unallocatedNote: string | null;
  // Tax is captured as withholding INCLUDED in `amount` (not added on top).
  // When > 0, the receipt surfaces it as a sub-line under Amount paid so the
  // parent can see how their payment breaks down for tax-receipt purposes.
  taxAmount?: number;
  taxLabel?: string | null;
}

export interface YearSummaryPayment {
  id: string;
  paidOn: string;
  amount: number;
  method: string | null;
  reference: string | null;
  recorderName: string | null;
  allocations: PaymentAllocationLine[];
  unallocatedAmount: number;
  unallocatedNote: string | null;
}

export interface YearSummaryData extends Common {
  totalAmount: number;
  adjustment: number;
  siblingDiscount: number;
  payments: YearSummaryPayment[];
}

// PDFKit's default font (Helvetica) handles ASCII + Latin-1 well but not
// Arabic/Kurdish. v1 receipts are English-only — stamping Arabic on receipts
// would silently produce mojibake without a custom font + RTL shaper.
const COLOR_HEADING = '#111827';
const COLOR_MUTED = '#6B7280';
const COLOR_BORDER = '#E5E7EB';
const COLOR_ACCENT = '#4F46E5';

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

function drawHeader(doc: PDFKit.PDFDocument, school: SchoolInfo, logoBuf: Buffer | null, subtitle: string) {
  const F = setupPdfFonts(doc);
  if (logoBuf) {
    try { doc.image(logoBuf, 40, 40, { fit: [60, 60] }); } catch { /* invalid image */ }
  }
  doc.font(F.bold).fontSize(18).fillColor(COLOR_HEADING).text(school.name, 110, 48);
  doc.font(F.regular).fontSize(10).fillColor(COLOR_MUTED).text(subtitle, 110, 72);
  doc.moveTo(40, 112).lineTo(555, 112).strokeColor(COLOR_BORDER).lineWidth(1).stroke();
  doc.y = 128;
}

function field(doc: PDFKit.PDFDocument, label: string, value: string, x: number, y: number, width: number) {
  const F = setupPdfFonts(doc);
  doc.font(F.regular).fontSize(8).fillColor(COLOR_MUTED).text(label.toUpperCase(), x, y, { width });
  doc.font(F.bold).fontSize(11).fillColor(COLOR_HEADING).text(value, x, y + 12, { width });
}

function moneyRow(doc: PDFKit.PDFDocument, label: string, value: string, y: number, opts: { bold?: boolean; accent?: boolean } = {}) {
  const F = setupPdfFonts(doc);
  const font = opts.bold ? F.bold : F.regular;
  const color = opts.accent ? COLOR_ACCENT : COLOR_HEADING;
  doc.font(font).fontSize(11).fillColor(opts.bold ? COLOR_HEADING : COLOR_MUTED).text(label, 320, y, { width: 140, align: 'left' });
  doc.font(font).fontSize(11).fillColor(color).text(value, 460, y, { width: 95, align: 'right' });
}

export async function streamPaymentReceipt(stream: Writable, data: PaymentReceiptData): Promise<void> {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const F = setupPdfFonts(doc);
  doc.pipe(stream);

  const logoBuf = await fetchLogoBuffer(data.school.logoUrl);
  drawHeader(doc, data.school, logoBuf, 'Tuition payment receipt');

  // Receipt meta strip
  field(doc, 'Receipt #', data.receiptNumber, 40, 130, 250);
  field(doc, 'Paid on', data.paidOn, 320, 130, 235);

  field(doc, 'Parent', data.parentName, 40, 175, 250);
  field(doc, 'Student', data.studentName, 320, 175, 235);

  const planLabel = data.academicYear ? `${data.planName} · ${data.academicYear}` : data.planName;
  field(doc, 'Plan', planLabel, 40, 220, 250);
  field(doc, 'Recorded by', data.recorderName ?? '—', 320, 220, 235);

  // Payment details box
  doc.moveTo(40, 270).lineTo(555, 270).strokeColor(COLOR_BORDER).stroke();
  doc.font(F.bold).fontSize(12).fillColor(COLOR_HEADING).text('This payment', 40, 285);

  const amountLine = fmt(data.amount, data.currency);
  doc.font(F.regular).fontSize(10).fillColor(COLOR_MUTED).text('Method', 40, 310);
  doc.font(F.bold).fontSize(11).fillColor(COLOR_HEADING).text(data.method ? data.method[0].toUpperCase() + data.method.slice(1) : '—', 40, 322);

  doc.font(F.regular).fontSize(10).fillColor(COLOR_MUTED).text('Reference', 200, 310);
  doc.font(F.bold).fontSize(11).fillColor(COLOR_HEADING).text(data.reference || '—', 200, 322);

  doc.font(F.regular).fontSize(10).fillColor(COLOR_MUTED).text('Amount paid', 320, 310, { width: 235, align: 'right' });
  doc.font(F.bold).fontSize(18).fillColor(COLOR_ACCENT).text(amountLine, 320, 320, { width: 235, align: 'right' });

  // Tax breakdown — surfaces the withholding portion when present. The
  // amount above is the full payment received; this line tells the parent
  // how much of it represents tax for their own filing.
  let taxLineHeight = 0;
  if (data.taxAmount && data.taxAmount > 0) {
    const taxLabel = data.taxLabel && data.taxLabel.trim() ? `Including ${data.taxLabel}` : 'Including tax';
    const taxText = `${taxLabel}: ${fmt(data.taxAmount, data.currency)}`;
    doc.font(F.regular).fontSize(9).fillColor(COLOR_MUTED).text(taxText, 320, 344, { width: 235, align: 'right' });
    taxLineHeight = 14;
  }

  // Allocation breakdown — which installment(s) this payment covers
  let extraY = 360 + taxLineHeight;
  if (data.allocations.length > 0) {
    doc.font(F.regular).fontSize(10).fillColor(COLOR_MUTED).text('Applied to', 40, extraY);
    const lines = data.allocations.map(a =>
      `Installment ${a.sequence}${a.dueDate ? ` (due ${a.dueDate})` : ''} — ${fmt(a.amount, data.currency)}`,
    );
    doc.font(F.bold).fontSize(10).fillColor(COLOR_HEADING).text(lines.join('\n'), 40, extraY + 12, { width: 515 });
    extraY += 16 + lines.length * 14;
  }

  if (data.unallocatedAmount > 0) {
    doc.font(F.regular).fontSize(10).fillColor(COLOR_MUTED).text(`Other / advance — ${fmt(data.unallocatedAmount, data.currency)}`, 40, extraY);
    if (data.unallocatedNote) {
      doc.font(F.regular).fontSize(10).fillColor(COLOR_HEADING).text(data.unallocatedNote, 40, extraY + 12, { width: 515 });
      extraY += 16 + Math.max(14, doc.heightOfString(data.unallocatedNote, { width: 515 }));
    } else {
      extraY += 18;
    }
  }

  if (data.notes) {
    doc.font(F.regular).fontSize(10).fillColor(COLOR_MUTED).text('Notes', 40, extraY);
    doc.font(F.regular).fontSize(10).fillColor(COLOR_HEADING).text(data.notes, 40, extraY + 12, { width: 515 });
    extraY += 16 + Math.max(14, doc.heightOfString(data.notes, { width: 515 }));
  }

  // Balance summary
  const yStart = 470;
  doc.moveTo(40, yStart - 10).lineTo(555, yStart - 10).strokeColor(COLOR_BORDER).stroke();
  doc.font(F.bold).fontSize(12).fillColor(COLOR_HEADING).text('Account summary', 40, yStart);

  const due = data.totalAmount + data.adjustment - data.siblingDiscount;
  const paidIncluding = data.paidBefore + data.amount;
  const remaining = Math.max(0, due - paidIncluding);

  let y = yStart + 24;
  moneyRow(doc, 'Tuition', fmt(data.totalAmount, data.currency), y); y += 18;
  if (data.adjustment !== 0) {
    moneyRow(doc, data.adjustment < 0 ? 'Adjustment / discount' : 'Surcharge', fmt(data.adjustment, data.currency), y); y += 18;
  }
  if (data.siblingDiscount > 0) {
    moneyRow(doc, 'Sibling discount', fmt(-data.siblingDiscount, data.currency), y); y += 18;
  }
  moneyRow(doc, 'Total due', fmt(due, data.currency), y, { bold: true }); y += 18;
  moneyRow(doc, 'Paid before this receipt', fmt(data.paidBefore, data.currency), y); y += 18;
  moneyRow(doc, 'This payment', fmt(data.amount, data.currency), y); y += 22;

  // Divider before final line
  doc.moveTo(320, y - 6).lineTo(555, y - 6).strokeColor(COLOR_BORDER).stroke();
  moneyRow(doc, remaining === 0 ? 'Paid in full' : 'Balance remaining', fmt(remaining, data.currency), y, { bold: true, accent: true });

  // Footer
  doc.font(F.regular).fontSize(9).fillColor(COLOR_MUTED).text(
    `Generated by ${data.school.name} · This is a record of payment received.`,
    40, 780, { width: 515, align: 'center' },
  );

  doc.end();
}

export async function streamYearSummary(stream: Writable, data: YearSummaryData): Promise<void> {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const F = setupPdfFonts(doc);
  doc.pipe(stream);

  const logoBuf = await fetchLogoBuffer(data.school.logoUrl);
  const subtitle = data.academicYear ? `Tuition statement · ${data.academicYear}` : 'Tuition statement';
  drawHeader(doc, data.school, logoBuf, subtitle);

  field(doc, 'Parent', data.parentName, 40, 130, 250);
  field(doc, 'Student', data.studentName, 320, 130, 235);
  field(doc, 'Plan', data.planName, 40, 175, 515);

  // Payments table
  doc.moveTo(40, 220).lineTo(555, 220).strokeColor(COLOR_BORDER).stroke();
  doc.font(F.bold).fontSize(12).fillColor(COLOR_HEADING).text('Payment history', 40, 235);

  // Header row — 5 columns: DATE | METHOD | REFERENCE | RECORDED BY | AMOUNT
  let y = 265;
  doc.font(F.bold).fontSize(9).fillColor(COLOR_MUTED);
  doc.text('DATE', 40, y, { width: 70 });
  doc.text('METHOD', 110, y, { width: 70 });
  doc.text('REFERENCE', 180, y, { width: 130 });
  doc.text('RECORDED BY', 310, y, { width: 130 });
  doc.text('AMOUNT', 440, y, { width: 115, align: 'right' });
  y += 14;
  doc.moveTo(40, y).lineTo(555, y).strokeColor(COLOR_BORDER).stroke();
  y += 8;

  let totalPaid = 0;
  if (data.payments.length === 0) {
    doc.font(F.regular).fontSize(10).fillColor(COLOR_MUTED).text('No payments recorded yet.', 40, y, { width: 515, align: 'center' });
    y += 24;
  } else {
    for (const p of data.payments) {
      doc.font(F.regular).fontSize(10).fillColor(COLOR_HEADING);
      doc.text(p.paidOn, 40, y, { width: 70 });
      doc.text(p.method ? p.method[0].toUpperCase() + p.method.slice(1) : '—', 110, y, { width: 70 });
      doc.text(p.reference || '—', 180, y, { width: 130, ellipsis: true });
      doc.text(p.recorderName || '—', 310, y, { width: 130, ellipsis: true });
      doc.text(fmt(p.amount, data.currency), 440, y, { width: 115, align: 'right' });
      y += 14;

      // Sub-line: which installments + the unallocated portion / note
      const parts: string[] = [];
      if (p.allocations.length > 0) {
        parts.push(p.allocations.map(a => `Inst. ${a.sequence} ${fmt(a.amount, data.currency)}`).join(', '));
      }
      if (p.unallocatedAmount > 0) {
        const noteSuffix = p.unallocatedNote ? ` (${p.unallocatedNote})` : '';
        parts.push(`Other ${fmt(p.unallocatedAmount, data.currency)}${noteSuffix}`);
      }
      if (parts.length > 0) {
        doc.font(F.regular).fontSize(8).fillColor(COLOR_MUTED).text(parts.join(' · '), 40, y, { width: 515 });
        const subHeight = Math.max(12, doc.heightOfString(parts.join(' · '), { width: 515 }));
        y += subHeight;
      }
      y += 6;

      totalPaid += p.amount;
      if (y > 700) {
        doc.addPage();
        y = 60;
      }
    }
  }

  // Summary
  y += 12;
  doc.moveTo(40, y).lineTo(555, y).strokeColor(COLOR_BORDER).stroke();
  y += 14;

  const due = data.totalAmount + data.adjustment - data.siblingDiscount;
  const remaining = Math.max(0, due - totalPaid);

  moneyRow(doc, 'Tuition', fmt(data.totalAmount, data.currency), y); y += 18;
  if (data.adjustment !== 0) {
    moneyRow(doc, data.adjustment < 0 ? 'Adjustment / discount' : 'Surcharge', fmt(data.adjustment, data.currency), y); y += 18;
  }
  if (data.siblingDiscount > 0) {
    moneyRow(doc, 'Sibling discount', fmt(-data.siblingDiscount, data.currency), y); y += 18;
  }
  moneyRow(doc, 'Total due', fmt(due, data.currency), y, { bold: true }); y += 18;
  moneyRow(doc, 'Total paid', fmt(totalPaid, data.currency), y); y += 22;

  doc.moveTo(320, y - 6).lineTo(555, y - 6).strokeColor(COLOR_BORDER).stroke();
  moneyRow(doc, remaining === 0 ? 'Paid in full' : 'Balance remaining', fmt(remaining, data.currency), y, { bold: true, accent: true });

  doc.font(F.regular).fontSize(9).fillColor(COLOR_MUTED).text(
    `Generated by ${data.school.name} · ${new Date().toISOString().split('T')[0]}`,
    40, 780, { width: 515, align: 'center' },
  );

  doc.end();
}
