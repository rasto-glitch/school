// PDF + Excel export of a school's archived employees (teacher / driver /
// supervisor / staff). Sibling of archiveExport.ts (students). Used by the
// admin self-export endpoint and the master pre-disable backup.

import * as XLSX from 'xlsx';
import PDFDocument from 'pdfkit';
import { supabase } from '../config/supabase';

export interface ArchivedEmployeeRecord {
  role: string;
  fullName: string;
  dateOfBirth: string | null;
  age: number | null;
  phoneNumber: string | null;
  email: string | null;
  emergencyContact: string | null;
  position: string | null;
  subject: string | null;
  hireDate: string | null;
  departureDate: string | null;
  reason: string | null;
  account: Record<string, unknown>;
  teaching: any;
  transport: any;
  employment: any;
  paymentHistory: { amount: number; currency: string; paidOn: string; periodLabel: string | null; notes: string | null; insuranceAmount: number; insurancePercentage: number | null }[];
  createdAt: string | null;
}

export interface EmployeeArchiveSnapshot {
  schoolName: string;
  generatedAt: string;
  employees: ArchivedEmployeeRecord[];
}

const ROLE_ORDER = ['teacher', 'driver', 'supervisor', 'staff'];
const ROLE_LABEL: Record<string, string> = { teacher: 'Teachers', driver: 'Drivers', supervisor: 'Supervisors', staff: 'Staff' };

export async function loadEmployeeArchiveSnapshot(schoolId: string): Promise<EmployeeArchiveSnapshot> {
  const { data: school } = await supabase
    .from('schools').select('name').eq('id', schoolId).single();

  const { data: rows } = await supabase
    .from('archived_employees')
    .select('role, full_name, date_of_birth, age, phone_number, email, emergency_contact, position, subject, hire_date, departure_date, reason, account, teaching, transport, employment, payment_history, created_at')
    .eq('school_id', schoolId)
    .order('created_at', { ascending: false });

  const employees: ArchivedEmployeeRecord[] = (rows ?? []).map((r: any) => ({
    role: r.role,
    fullName: r.full_name,
    dateOfBirth: r.date_of_birth,
    age: r.age,
    phoneNumber: r.phone_number,
    email: r.email,
    emergencyContact: r.emergency_contact,
    position: r.position,
    subject: r.subject,
    hireDate: r.hire_date,
    departureDate: r.departure_date,
    reason: r.reason,
    account: r.account ?? {},
    teaching: r.teaching ?? [],
    transport: r.transport ?? {},
    employment: r.employment ?? {},
    paymentHistory: Array.isArray(r.payment_history) ? r.payment_history : [],
    createdAt: r.created_at,
  }));

  return {
    schoolName: school?.name ?? 'School',
    generatedAt: new Date().toISOString(),
    employees,
  };
}

function money(amount: number, currency: string): string {
  const sym: Record<string, string> = { USD: '$', EUR: '€', GBP: '£' };
  const n = (Number(amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return sym[currency] ? `${sym[currency]}${n}` : `${currency} ${n}`;
}

// ─── PDF ──────────────────────────────────────────────────────────────────

export function streamPdf(snapshot: EmployeeArchiveSnapshot, dest: NodeJS.WritableStream): void {
  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true });
  doc.pipe(dest);

  doc.fontSize(28).text(snapshot.schoolName, { align: 'left' });
  doc.moveDown(0.4);
  doc.fontSize(20).text('Employee Archive Export', { align: 'left' });
  doc.moveDown(0.6);
  doc.fontSize(11).fillColor('#6B7280').text(`Generated: ${new Date(snapshot.generatedAt).toLocaleString()}`);
  for (const role of ROLE_ORDER) {
    const n = snapshot.employees.filter(e => e.role === role).length;
    if (n > 0) doc.text(`${ROLE_LABEL[role]}: ${n}`);
  }
  doc.fillColor('black');

  if (snapshot.employees.length === 0) {
    doc.addPage();
    doc.fontSize(14).fillColor('#6B7280').text('No archived employee records.', { align: 'center' });
    doc.fillColor('black');
    doc.end();
    return;
  }

  for (const role of ROLE_ORDER) {
    const group = snapshot.employees.filter(e => e.role === role);
    if (group.length === 0) continue;
    doc.addPage();
    doc.fontSize(18).fillColor('black').text(ROLE_LABEL[role], { underline: true });
    doc.moveDown(0.5);
    group.forEach((e, i) => writeEmployeeSection(doc, e, i === 0));
  }

  doc.end();
}

function writeEmployeeSection(doc: PDFKit.PDFDocument, e: ArchivedEmployeeRecord, isFirst: boolean): void {
  if (!isFirst) doc.addPage();

  doc.fontSize(16).fillColor('black').text(e.fullName);
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor('#374151');
  if (e.position) doc.text(`Position: ${e.position}`);
  if (e.subject) doc.text(`Subject: ${e.subject}`);
  if (e.email) doc.text(`Email: ${e.email}`);
  if (e.phoneNumber) doc.text(`Phone: ${e.phoneNumber}`);
  if (e.emergencyContact) doc.text(`Emergency contact: ${e.emergencyContact}`);
  if (e.hireDate) doc.text(`Hired: ${e.hireDate}`);
  if (e.departureDate) doc.text(`Departed: ${e.departureDate}`);
  if (e.reason) doc.text(`Reason: ${e.reason}`);
  const username = (e.account as any)?.username;
  if (username) doc.text(`Login: ${username}`);

  if (e.role === 'teacher') {
    const curriculum = (e.teaching?.curriculum ?? []) as { className: string | null; subjects: string[] }[];
    if (curriculum.length > 0) {
      doc.moveDown(0.4);
      doc.fontSize(11).fillColor('black').text('Curriculum');
      doc.fontSize(10).fillColor('#374151');
      for (const c of curriculum) doc.text(`  • ${c.className ?? '—'}: ${(c.subjects || []).join(', ') || '—'}`);
    }
    const cs = e.teaching?.contentSummary;
    if (cs) {
      doc.moveDown(0.3);
      doc.fontSize(10).fillColor('#374151').text(
        `Authored: ${cs.homework ?? 0} homework · ${cs.assignments ?? 0} assignments · ${cs.grades ?? 0} grades · ${cs.reports ?? 0} reports · ${cs.weeklySummaries ?? 0} weekly summaries · ${cs.academicPosts ?? 0} posts`,
      );
    }
  }

  if (e.role === 'driver') {
    const tr = e.transport ?? {};
    doc.moveDown(0.4);
    doc.fontSize(10).fillColor('#374151');
    if (tr.busNumber) doc.text(`Bus: #${tr.busNumber}${tr.plateNumber ? ` (${tr.plateNumber})` : ''}`);
    if (tr.vehicleType) doc.text(`Vehicle: ${tr.vehicleType}`);
    if (tr.licenseNumber) doc.text(`License: ${tr.licenseNumber}`);
    const roster = (tr.studentsTransported ?? []) as { fullName: string }[];
    doc.text(`Students transported: ${roster.length}`);
    if (tr.rideRecordStats) doc.text(`Ride records: ${tr.rideRecordStats.rode ?? 0} rode / ${tr.rideRecordStats.total ?? 0} total`);
  }

  if (e.role === 'staff') {
    const em = e.employment ?? {};
    doc.moveDown(0.4);
    doc.fontSize(10).fillColor('#374151');
    if (em.salaryAmount != null) doc.text(`Salary: ${money(em.salaryAmount, em.currency ?? 'USD')} ${em.currency ?? ''}`);
    if (em.insurancePercentage != null) doc.text(`Insurance: ${em.insurancePercentage}% withheld · held ${money(em.insuranceHeld ?? 0, em.currency ?? 'USD')}`);
    if (em.insurancePaidOut) doc.text(`Insurance paid out: ${money(em.insurancePaidOutAmount ?? 0, em.insurancePaidOutCurrency ?? em.currency ?? 'USD')}${em.insurancePaidOutAt ? ` on ${em.insurancePaidOutAt}` : ''}`);
    if (e.paymentHistory.length > 0) {
      doc.moveDown(0.3);
      doc.fontSize(11).fillColor('black').text('Salary history');
      doc.fontSize(9).fillColor('#374151');
      let gross = 0, ins = 0;
      for (const p of e.paymentHistory) {
        const net = (Number(p.amount) || 0) - (Number(p.insuranceAmount) || 0);
        doc.text(`  ${p.paidOn}  ·  ${money(p.amount, p.currency)}  ·  ins ${money(p.insuranceAmount || 0, p.currency)}  ·  net ${money(net, p.currency)}${p.periodLabel ? `  ·  ${p.periodLabel}` : ''}`);
        gross += Number(p.amount) || 0; ins += Number(p.insuranceAmount) || 0;
      }
      doc.moveDown(0.2);
      doc.fontSize(10).fillColor('#111827').text(`Total gross ${money(gross, e.paymentHistory[0].currency)} · insurance ${money(ins, e.paymentHistory[0].currency)} · net ${money(gross - ins, e.paymentHistory[0].currency)}`);
    }
  }

  doc.fillColor('black');
}

// ─── EXCEL ────────────────────────────────────────────────────────────────

export function buildXlsx(snapshot: EmployeeArchiveSnapshot): Buffer {
  const wb = XLSX.utils.book_new();

  const empHeaders = ['Role', 'Full name', 'Email', 'Phone', 'Position', 'Subject', 'Hired', 'Departed', 'Reason', 'Archived'];
  const empRows = snapshot.employees.map(e => ({
    'Role': e.role,
    'Full name': e.fullName,
    'Email': e.email ?? '',
    'Phone': e.phoneNumber ?? '',
    'Position': e.position ?? '',
    'Subject': e.subject ?? '',
    'Hired': e.hireDate ?? '',
    'Departed': e.departureDate ?? '',
    'Reason': e.reason ?? '',
    'Archived': e.createdAt ? String(e.createdAt).split('T')[0] : '',
  }));
  const empSheet = empRows.length > 0 ? XLSX.utils.json_to_sheet(empRows) : XLSX.utils.aoa_to_sheet([empHeaders]);
  XLSX.utils.book_append_sheet(wb, empSheet, 'Employees');

  // Teacher curriculum sheet
  const currHeaders = ['Teacher', 'Class', 'Subjects'];
  const currRows: Record<string, string>[] = [];
  for (const e of snapshot.employees) {
    if (e.role !== 'teacher') continue;
    for (const c of (e.teaching?.curriculum ?? []) as { className: string | null; subjects: string[] }[]) {
      currRows.push({ 'Teacher': e.fullName, 'Class': c.className ?? '', 'Subjects': (c.subjects || []).join(', ') });
    }
  }
  const currSheet = currRows.length > 0 ? XLSX.utils.json_to_sheet(currRows) : XLSX.utils.aoa_to_sheet([currHeaders]);
  XLSX.utils.book_append_sheet(wb, currSheet, 'Teacher curriculum');

  // Staff salary history sheet
  const salHeaders = ['Staff', 'Date', 'Gross', 'Insurance', 'Net', 'Currency', 'Period', 'Notes'];
  const salRows: Record<string, string | number>[] = [];
  for (const e of snapshot.employees) {
    if (e.role !== 'staff') continue;
    for (const p of e.paymentHistory) {
      const ins = Number(p.insuranceAmount) || 0;
      salRows.push({
        'Staff': e.fullName, 'Date': p.paidOn, 'Gross': Number(p.amount) || 0,
        'Insurance': ins, 'Net': (Number(p.amount) || 0) - ins, 'Currency': p.currency,
        'Period': p.periodLabel ?? '', 'Notes': p.notes ?? '',
      });
    }
  }
  const salSheet = salRows.length > 0 ? XLSX.utils.json_to_sheet(salRows) : XLSX.utils.aoa_to_sheet([salHeaders]);
  XLSX.utils.book_append_sheet(wb, salSheet, 'Staff salaries');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
