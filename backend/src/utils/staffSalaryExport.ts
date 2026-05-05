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
  insuranceAmount: number;
  insurancePercentage: number | null;
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
  insurancePercentage: number | null;
  insuranceHeld: number;
  insurancePaidOut: boolean;
  insurancePaidOutAt: string | null;
  insurancePaidOutAmount: number | null;
  insurancePaidOutCurrency: string | null;
  insurancePaidOutNotes: string | null;
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
  if (data.insurancePercentage !== null) {
    doc.font('Helvetica').fontSize(9).fillColor(COLOR_MUTED).text('Insurance', 40, metaY);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(COLOR_HEADING).text(`${data.insurancePercentage}% deducted from each salary`, 110, metaY);
    metaY += 16;
  }
  if (data.insuranceHeld > 0 || data.insurancePaidOut) {
    doc.font('Helvetica').fontSize(9).fillColor(COLOR_MUTED).text('Insurance held', 40, metaY);
    let insStatus = `${fmt(data.insuranceHeld, data.currency)} ${data.currency}`;
    if (data.insurancePaidOut) {
      const amt = data.insurancePaidOutAmount ?? 0;
      const cur = data.insurancePaidOutCurrency ?? data.currency;
      insStatus = `Paid out ${fmt(amt, cur)} ${cur}${data.insurancePaidOutAt ? ` on ${data.insurancePaidOutAt}` : ''}`;
    } else if (data.status === 'archived') {
      insStatus += ' · Pending payout';
    }
    doc.font('Helvetica-Bold').fontSize(10).fillColor(data.insurancePaidOut ? '#059669' : COLOR_HEADING).text(insStatus, 110, metaY);
    metaY += 16;
  }
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
  doc.text('DATE', 40, y, { width: 70 });
  doc.text('PERIOD', 110, y, { width: 110 });
  doc.text('GROSS', 220, y, { width: 80, align: 'right' });
  doc.text('INSURANCE', 305, y, { width: 80, align: 'right' });
  doc.text('NET', 390, y, { width: 80, align: 'right' });
  doc.text('NOTES', 475, y, { width: 80 });
  y += 12;
  doc.moveTo(40, y).lineTo(555, y).strokeColor(COLOR_BORDER).stroke();
  y += 6;

  let totalGross = 0;
  let totalInsurance = 0;
  let totalNet = 0;
  const allSameCurrency = data.payments.every(p => p.currency === data.currency);

  for (const p of data.payments) {
    if (y > 760) { doc.addPage(); y = 60; }
    const ins = p.insuranceAmount || 0;
    const net = Math.round((p.amount - ins) * 100) / 100;
    doc.font('Helvetica').fontSize(10).fillColor(COLOR_HEADING);
    doc.text(p.paidOn, 40, y, { width: 70 });
    doc.text(p.periodLabel || '—', 110, y, { width: 110, ellipsis: true });
    doc.text(fmt(p.amount, p.currency), 220, y, { width: 80, align: 'right' });
    doc.text(ins > 0 ? fmt(ins, p.currency) : '—', 305, y, { width: 80, align: 'right' });
    doc.text(fmt(net, p.currency), 390, y, { width: 80, align: 'right' });
    doc.text(p.notes || '—', 475, y, { width: 80, ellipsis: true });
    y += 16;
    if (allSameCurrency) {
      totalGross += p.amount;
      totalInsurance += ins;
      totalNet += net;
    }
  }
  y += 6;

  if (allSameCurrency) {
    if (y > 720) { doc.addPage(); y = 60; }
    doc.moveTo(40, y).lineTo(555, y).strokeColor(COLOR_BORDER).stroke();
    y += 12;
    doc.font('Helvetica-Bold').fontSize(10).fillColor(COLOR_ACCENT).text('Totals', 40, y);
    doc.text(fmt(totalGross, data.currency), 220, y, { width: 80, align: 'right' });
    doc.text(fmt(totalInsurance, data.currency), 305, y, { width: 80, align: 'right' });
    doc.text(fmt(totalNet, data.currency), 390, y, { width: 80, align: 'right' });
    y += 18;

    if (totalInsurance > 0) {
      doc.font('Helvetica-Bold').fontSize(11).fillColor(COLOR_HEADING).text('Insurance summary', 40, y);
      y += 16;
      doc.font('Helvetica').fontSize(10).fillColor(COLOR_HEADING).text(`Total insurance withheld: ${fmt(totalInsurance, data.currency)} ${data.currency}`, 40, y);
      y += 14;
      if (data.insurancePaidOut) {
        const amt = data.insurancePaidOutAmount ?? 0;
        const cur = data.insurancePaidOutCurrency ?? data.currency;
        doc.fillColor('#059669').text(`Paid out: ${fmt(amt, cur)} ${cur}${data.insurancePaidOutAt ? ` on ${data.insurancePaidOutAt}` : ''}`, 40, y);
        y += 14;
        if (data.insurancePaidOutNotes) {
          doc.fillColor(COLOR_MUTED).fontSize(9).text(`Notes: ${data.insurancePaidOutNotes}`, 40, y, { width: 515 });
          y += 14;
        }
      } else {
        doc.fillColor('#B45309').text('Status: pending payout', 40, y);
        y += 14;
      }
    }
  }

  doc.font('Helvetica').fontSize(9).fillColor(COLOR_MUTED).text(
    `Generated by ${data.schoolName} · ${new Date().toISOString().split('T')[0]}`,
    40, 800, { width: 515, align: 'center' },
  );

  doc.end();
}

export function buildStaffSalaryXlsx(data: StaffSalaryExportData): Buffer {
  const wb = XLSX.utils.book_new();

  const samePay = data.payments.filter(p => p.currency === data.currency);
  const totalGross = samePay.reduce((s, p) => s + p.amount, 0);
  const totalInsurance = samePay.reduce((s, p) => s + (p.insuranceAmount || 0), 0);
  const totalNet = totalGross - totalInsurance;

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
    ['Insurance percentage', data.insurancePercentage !== null ? `${data.insurancePercentage}%` : '—'],
    ['Insurance withheld (total)', totalInsurance],
    ['Insurance held in account', data.insuranceHeld],
    ['Insurance paid out', data.insurancePaidOut ? 'Yes' : 'No'],
    ['Insurance paid out at', data.insurancePaidOutAt ?? ''],
    ['Insurance paid out amount', data.insurancePaidOutAmount ?? ''],
    ['Insurance paid out currency', data.insurancePaidOutCurrency ?? ''],
    ['Insurance paid out notes', data.insurancePaidOutNotes ?? ''],
    [],
    ['Total payments', data.payments.length],
    ['Total gross', totalGross],
    ['Total insurance', totalInsurance],
    ['Total net', totalNet],
  ];
  const summaryWs = XLSX.utils.aoa_to_sheet(summaryRows);
  summaryWs['!cols'] = [{ wch: 28 }, { wch: 32 }];
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');

  // Sheet 2 — flat payments list
  const paymentsRows: (string | number)[][] = [
    ['Date', 'Gross', 'Insurance %', 'Insurance', 'Net', 'Currency', 'Period', 'Notes'],
  ];
  for (const p of data.payments) {
    const ins = p.insuranceAmount || 0;
    paymentsRows.push([
      p.paidOn,
      p.amount,
      p.insurancePercentage !== null && p.insurancePercentage !== undefined ? p.insurancePercentage : '',
      ins,
      Math.round((p.amount - ins) * 100) / 100,
      p.currency,
      p.periodLabel ?? '',
      p.notes ?? '',
    ]);
  }
  const paymentsWs = XLSX.utils.aoa_to_sheet(paymentsRows);
  paymentsWs['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 22 }, { wch: 32 }];
  XLSX.utils.book_append_sheet(wb, paymentsWs, 'Payments');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
