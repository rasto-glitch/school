import PDFDocument from 'pdfkit';
import { setupPdfFonts } from './pdfFont';
import * as XLSX from 'xlsx';
import type { Writable } from 'stream';

// Per-student tuition history export, used by the accountant archive tab.
// Two sources feed into the same shape:
//   • Archived students — read from archived_students.payment_history (snapshot
//     taken at archive time, see admin.controller.ts archiveStudent).
//   • Graduated students — built live from student_fees + fee_payments.
// The export logic is identical regardless of source.

export interface ArchivePaymentEntry {
  amount: number;
  paidOn: string;
  method: string | null;
  reference: string | null;
  notes: string | null;
}

export interface ArchivePlanEntry {
  planName: string;
  academicYear: string | null;
  currency: string;
  totalAmount: number;
  adjustment: number;
  payments: ArchivePaymentEntry[];
}

export interface ArchivePaymentExportData {
  schoolName: string;
  schoolLogoUrl: string | null;
  studentName: string;
  status: 'archived' | 'graduated';
  parentName: string | null;
  parentPhone: string | null;
  className: string | null;
  departureDate: string | null;
  reason: string | null;
  plans: ArchivePlanEntry[];
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

import { fmtMoneyPdf as fmt } from './currency';

export async function streamArchivePaymentPdf(stream: Writable, data: ArchivePaymentExportData): Promise<void> {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const F = setupPdfFonts(doc);
  doc.pipe(stream);

  const logoBuf = await fetchLogoBuffer(data.schoolLogoUrl);

  if (logoBuf) {
    try { doc.image(logoBuf, 40, 40, { fit: [60, 60] }); } catch { /* invalid */ }
  }
  doc.font(F.pick(data.schoolName,{bold:true})).fontSize(18).fillColor(COLOR_HEADING).text(data.schoolName, 110, 48);
  const subtitle = data.status === 'archived' ? 'Archived student · Payment history' : 'Graduated student · Payment history';
  doc.font(F.regular).fontSize(10).fillColor(COLOR_MUTED).text(subtitle, 110, 72);
  doc.moveTo(40, 112).lineTo(555, 112).strokeColor(COLOR_BORDER).lineWidth(1).stroke();

  // Student strip
  doc.font(F.regular).fontSize(8).fillColor(COLOR_MUTED).text('STUDENT', 40, 128);
  doc.font(F.pick(data.studentName,{bold:true})).fontSize(13).fillColor(COLOR_HEADING).text(data.studentName, 40, 142);

  let metaY = 168;
  if (data.parentName) {
    doc.font(F.regular).fontSize(9).fillColor(COLOR_MUTED).text('Parent', 40, metaY);
    doc.font(F.pick(data.parentName,{bold:true})).fontSize(10).fillColor(COLOR_HEADING).text(`${data.parentName}${data.parentPhone ? ` · ${data.parentPhone}` : ''}`, 100, metaY);
    metaY += 16;
  }
  if (data.className) {
    doc.font(F.regular).fontSize(9).fillColor(COLOR_MUTED).text('Last class', 40, metaY);
    doc.font(F.pick(data.className,{bold:true})).fontSize(10).fillColor(COLOR_HEADING).text(data.className, 100, metaY);
    metaY += 16;
  }
  if (data.departureDate) {
    doc.font(F.regular).fontSize(9).fillColor(COLOR_MUTED).text(data.status === 'archived' ? 'Archived' : 'Graduated', 40, metaY);
    doc.font(F.bold).fontSize(10).fillColor(COLOR_HEADING).text(`${data.departureDate}${data.reason ? ` · ${data.reason}` : ''}`, 100, metaY);
    metaY += 16;
  }

  let y = Math.max(metaY + 8, 200);
  doc.moveTo(40, y).lineTo(555, y).strokeColor(COLOR_BORDER).stroke();
  y += 14;

  if (data.plans.length === 0) {
    doc.font(F.regular).fontSize(11).fillColor(COLOR_MUTED).text('No tuition plans on record for this student.', 40, y, { width: 515, align: 'center' });
    doc.end();
    return;
  }

  let grandPaid = 0;
  let grandDue = 0;
  let primaryCurrency = data.plans[0]?.currency ?? 'USD';

  for (const plan of data.plans) {
    if (y > 720) { doc.addPage(); y = 60; }

    const planLabel = plan.academicYear ? `${plan.planName} · ${plan.academicYear}` : plan.planName;
    doc.font(F.pick(planLabel,{bold:true})).fontSize(12).fillColor(COLOR_HEADING).text(planLabel, 40, y, { width: 515 });
    y += 18;

    const due = plan.totalAmount + plan.adjustment;
    const paid = plan.payments.reduce((s, p) => s + p.amount, 0);
    grandDue += due;
    grandPaid += paid;

    doc.font(F.regular).fontSize(9).fillColor(COLOR_MUTED).text(
      `Tuition ${fmt(plan.totalAmount, plan.currency)}${plan.adjustment !== 0 ? ` · Adjustment ${fmt(plan.adjustment, plan.currency)}` : ''} · Due ${fmt(due, plan.currency)} · Paid ${fmt(paid, plan.currency)}`,
      40, y, { width: 515 },
    );
    y += 16;

    // Payments table for this plan
    if (plan.payments.length === 0) {
      doc.font(F.regular).fontSize(10).fillColor(COLOR_MUTED).text('No payments recorded.', 40, y, { width: 515 });
      y += 18;
    } else {
      doc.font(F.bold).fontSize(8).fillColor(COLOR_MUTED);
      doc.text('DATE', 40, y, { width: 80 });
      doc.text('METHOD', 120, y, { width: 90 });
      doc.text('REFERENCE', 210, y, { width: 200 });
      doc.text('AMOUNT', 410, y, { width: 145, align: 'right' });
      y += 12;
      doc.moveTo(40, y).lineTo(555, y).strokeColor(COLOR_BORDER).stroke();
      y += 6;

      for (const p of plan.payments) {
        if (y > 760) { doc.addPage(); y = 60; }
        doc.font(F.regular).fontSize(10).fillColor(COLOR_HEADING);
        doc.text(p.paidOn, 40, y, { width: 80 });
        doc.text(p.method ? p.method[0].toUpperCase() + p.method.slice(1) : '—', 120, y, { width: 90 });
        doc.text(p.reference || '—', 210, y, { width: 200, ellipsis: true });
        doc.text(fmt(p.amount, plan.currency), 410, y, { width: 145, align: 'right' });
        y += 16;
      }
    }
    y += 10;
  }

  // Grand totals (only meaningful when all plans share a currency)
  const allSameCurrency = data.plans.every(p => p.currency === primaryCurrency);
  if (allSameCurrency) {
    if (y > 720) { doc.addPage(); y = 60; }
    doc.moveTo(40, y).lineTo(555, y).strokeColor(COLOR_BORDER).stroke();
    y += 12;
    doc.font(F.bold).fontSize(11).fillColor(COLOR_HEADING).text('Grand total due', 40, y);
    doc.font(F.bold).fontSize(11).fillColor(COLOR_HEADING).text(fmt(grandDue, primaryCurrency), 410, y, { width: 145, align: 'right' });
    y += 16;
    doc.font(F.regular).fontSize(11).fillColor(COLOR_MUTED).text('Grand total paid', 40, y);
    doc.font(F.regular).fontSize(11).fillColor(COLOR_HEADING).text(fmt(grandPaid, primaryCurrency), 410, y, { width: 145, align: 'right' });
    y += 16;
    const balance = Math.max(0, grandDue - grandPaid);
    doc.font(F.bold).fontSize(12).fillColor(COLOR_ACCENT).text(balance === 0 ? 'Settled in full' : 'Balance remaining', 40, y);
    doc.font(F.bold).fontSize(12).fillColor(COLOR_ACCENT).text(fmt(balance, primaryCurrency), 410, y, { width: 145, align: 'right' });
  }

  doc.font(F.pick(data.schoolName)).fontSize(9).fillColor(COLOR_MUTED).text(
    `Generated by ${data.schoolName} · ${new Date().toISOString().split('T')[0]}`,
    40, 776, { width: 515, align: 'center' },
  );

  doc.end();
}

export function buildArchivePaymentXlsx(data: ArchivePaymentExportData): Buffer {
  const wb = XLSX.utils.book_new();

  // Sheet 1 — summary per plan
  const summaryRows: (string | number)[][] = [
    ['Student', data.studentName],
    ['Status', data.status === 'archived' ? 'Archived' : 'Graduated'],
    ['Parent', data.parentName ?? ''],
    ['Parent phone', data.parentPhone ?? ''],
    ['Last class', data.className ?? ''],
    ['Date', data.departureDate ?? ''],
    ['Reason', data.reason ?? ''],
    [],
    ['Plan', 'Academic year', 'Currency', 'Total', 'Adjustment', 'Paid', 'Balance'],
  ];
  for (const plan of data.plans) {
    const due = plan.totalAmount + plan.adjustment;
    const paid = plan.payments.reduce((s, p) => s + p.amount, 0);
    summaryRows.push([
      plan.planName,
      plan.academicYear ?? '',
      plan.currency,
      plan.totalAmount,
      plan.adjustment,
      paid,
      Math.max(0, due - paid),
    ]);
  }
  const summaryWs = XLSX.utils.aoa_to_sheet(summaryRows);
  summaryWs['!cols'] = [{ wch: 26 }, { wch: 16 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');

  // Sheet 2 — flat payments list
  const paymentsRows: (string | number)[][] = [
    ['Plan', 'Academic year', 'Currency', 'Date', 'Amount', 'Method', 'Reference', 'Notes'],
  ];
  for (const plan of data.plans) {
    for (const p of plan.payments) {
      paymentsRows.push([
        plan.planName,
        plan.academicYear ?? '',
        plan.currency,
        p.paidOn,
        p.amount,
        p.method ?? '',
        p.reference ?? '',
        p.notes ?? '',
      ]);
    }
  }
  const paymentsWs = XLSX.utils.aoa_to_sheet(paymentsRows);
  paymentsWs['!cols'] = [{ wch: 24 }, { wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 22 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, paymentsWs, 'Payments');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
