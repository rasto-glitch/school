import PDFDocument from 'pdfkit';
import * as XLSX from 'xlsx';
import type { Writable } from 'stream';

// Per-staff salary history export, used by the Salaries archive sub-tab.
// Renders a PDF or Excel workbook of one staff member's recorded payments
// alongside their basic profile (position, salary amount, currency, status).

export interface StaffPaymentEntry {
  amount: number;
  currency: string;
  paidOn: string;
  periodLabel: string | null;
  notes: string | null;
}

export interface StaffSalaryExportData {
  schoolName: string;
  schoolLogoUrl: string | null;
  fullName: string;
  position: string | null;
  salaryAmount: number;
  currency: string;
  nextPaymentDate: string | null;
  status: 'active' | 'archived';
  archiveReason: string | null;
  payments: StaffPaymentEntry[];
}

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

function fmt(amount: number, currency: string): string {
  const symbols: Record<string, string> = { USD: '$', EUR: '€', GBP: '£' };
  const sym = symbols[currency] ?? '';
  const num = amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return sym ? `${sym}${num}` : `${currency} ${num}`;
}

export async function streamStaffSalaryPdf(stream: Writable, data: StaffSalaryExportData): Promise<void> {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  doc.pipe(stream);

  const logoBuf = await fetchLogoBuffer(data.schoolLogoUrl);

  if (logoBuf) {
    try { doc.image(logoBuf, 40, 40, { fit: [60, 60] }); } catch { /* invalid */ }
  }
  doc.font('Helvetica-Bold').fontSize(18).fillColor(COLOR_HEADING).text(data.schoolName, 110, 48);
  const subtitle = data.status === 'archived' ? 'Archived staff · Salary history' : 'Staff · Salary history';
  doc.font('Helvetica').fontSize(10).fillColor(COLOR_MUTED).text(subtitle, 110, 72);
  doc.moveTo(40, 112).lineTo(555, 112).strokeColor(COLOR_BORDER).lineWidth(1).stroke();

  // Staff strip
  doc.font('Helvetica').fontSize(8).fillColor(COLOR_MUTED).text('STAFF', 40, 128);
  doc.font('Helvetica-Bold').fontSize(13).fillColor(COLOR_HEADING).text(data.fullName, 40, 142);

  let metaY = 168;
  if (data.position) {
    doc.font('Helvetica').fontSize(9).fillColor(COLOR_MUTED).text('Position', 40, metaY);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(COLOR_HEADING).text(data.position, 110, metaY);
    metaY += 16;
  }
  doc.font('Helvetica').fontSize(9).fillColor(COLOR_MUTED).text('Salary', 40, metaY);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLOR_HEADING).text(`${fmt(data.salaryAmount, data.currency)} ${data.currency}`, 110, metaY);
  metaY += 16;
  if (data.nextPaymentDate && data.status === 'active') {
    doc.font('Helvetica').fontSize(9).fillColor(COLOR_MUTED).text('Next payment', 40, metaY);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(COLOR_HEADING).text(data.nextPaymentDate, 110, metaY);
    metaY += 16;
  }
  if (data.status === 'archived') {
    doc.font('Helvetica').fontSize(9).fillColor(COLOR_MUTED).text('Status', 40, metaY);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(COLOR_HEADING).text(`Archived${data.archiveReason ? ` · ${data.archiveReason}` : ''}`, 110, metaY);
    metaY += 16;
  }

  let y = Math.max(metaY + 8, 200);
  doc.moveTo(40, y).lineTo(555, y).strokeColor(COLOR_BORDER).stroke();
  y += 14;

  doc.font('Helvetica-Bold').fontSize(12).fillColor(COLOR_HEADING).text('Payment history', 40, y);
  y += 18;

  if (data.payments.length === 0) {
    doc.font('Helvetica').fontSize(11).fillColor(COLOR_MUTED).text('No payments recorded for this staff member.', 40, y, { width: 515, align: 'center' });
    doc.end();
    return;
  }

  doc.font('Helvetica-Bold').fontSize(8).fillColor(COLOR_MUTED);
  doc.text('DATE', 40, y, { width: 80 });
  doc.text('PERIOD', 120, y, { width: 130 });
  doc.text('NOTES', 250, y, { width: 200 });
  doc.text('AMOUNT', 450, y, { width: 105, align: 'right' });
  y += 12;
  doc.moveTo(40, y).lineTo(555, y).strokeColor(COLOR_BORDER).stroke();
  y += 6;

  let totalPaid = 0;
  const allSameCurrency = data.payments.every(p => p.currency === data.currency);

  for (const p of data.payments) {
    if (y > 760) { doc.addPage(); y = 60; }
    doc.font('Helvetica').fontSize(10).fillColor(COLOR_HEADING);
    doc.text(p.paidOn, 40, y, { width: 80 });
    doc.text(p.periodLabel || '—', 120, y, { width: 130, ellipsis: true });
    doc.text(p.notes || '—', 250, y, { width: 200, ellipsis: true });
    doc.text(fmt(p.amount, p.currency), 450, y, { width: 105, align: 'right' });
    y += 16;
    if (allSameCurrency) totalPaid += p.amount;
  }
  y += 6;

  if (allSameCurrency) {
    if (y > 720) { doc.addPage(); y = 60; }
    doc.moveTo(40, y).lineTo(555, y).strokeColor(COLOR_BORDER).stroke();
    y += 12;
    doc.font('Helvetica-Bold').fontSize(11).fillColor(COLOR_ACCENT).text('Total paid', 40, y);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(COLOR_ACCENT).text(fmt(totalPaid, data.currency), 450, y, { width: 105, align: 'right' });
  }

  doc.font('Helvetica').fontSize(9).fillColor(COLOR_MUTED).text(
    `Generated by ${data.schoolName} · ${new Date().toISOString().split('T')[0]}`,
    40, 800, { width: 515, align: 'center' },
  );

  doc.end();
}

export function buildStaffSalaryXlsx(data: StaffSalaryExportData): Buffer {
  const wb = XLSX.utils.book_new();

  // Sheet 1 — summary
  const summaryRows: (string | number)[][] = [
    ['Staff', data.fullName],
    ['Position', data.position ?? ''],
    ['Salary amount', data.salaryAmount],
    ['Currency', data.currency],
    ['Next payment', data.nextPaymentDate ?? ''],
    ['Status', data.status === 'archived' ? 'Archived' : 'Active'],
    ['Archive reason', data.archiveReason ?? ''],
    [],
    ['Total payments', data.payments.length],
    ['Total paid', data.payments.filter(p => p.currency === data.currency).reduce((s, p) => s + p.amount, 0)],
  ];
  const summaryWs = XLSX.utils.aoa_to_sheet(summaryRows);
  summaryWs['!cols'] = [{ wch: 22 }, { wch: 32 }];
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');

  // Sheet 2 — flat payments list
  const paymentsRows: (string | number)[][] = [
    ['Date', 'Amount', 'Currency', 'Period', 'Notes'],
  ];
  for (const p of data.payments) {
    paymentsRows.push([
      p.paidOn,
      p.amount,
      p.currency,
      p.periodLabel ?? '',
      p.notes ?? '',
    ]);
  }
  const paymentsWs = XLSX.utils.aoa_to_sheet(paymentsRows);
  paymentsWs['!cols'] = [{ wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 22 }, { wch: 32 }];
  XLSX.utils.book_append_sheet(wb, paymentsWs, 'Payments');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
