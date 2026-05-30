// Per-record PDF export for archived_employees. Sibling of
// archivedStudentPdf.ts; both share label maps + helpers in
// archivePdfShared.ts so the chrome stays consistent across the two
// download buttons in the archive detail modals.
//
// Layout: A4, school-logo + school-name header strip, then a sequence
// of sectioned key/value cards (Personal / Contact / Employment /
// Role-specific / Account / Documents), then a small footer with the
// archive id + schema version + generator. Labels honour the
// operator's UI language (?lang= query param on the route).

import PDFDocument from 'pdfkit';
import { setupPdfFonts } from './pdfFont';
import { supabase } from '../config/supabase';
import { COLORS, fetchLogoBuffer, L, type Labels, type Lang } from './archivePdfShared';

type Row = [string, string | null | undefined];

interface ArchivedEmployeeRow {
  id: string;
  school_id: string;
  role: 'teacher' | 'driver' | 'staff' | 'supervisor' | 'admin' | string;
  full_name: string;
  date_of_birth: string | null;
  age: number | null;
  phone_number: string | null;
  email: string | null;
  emergency_contact: string | null;
  position: string | null;
  subject: string | null;
  hire_date: string | null;
  departure_date: string | null;
  reason: string | null;
  account: Record<string, unknown> | null;
  teaching: Record<string, unknown> | null;
  transport: Record<string, unknown> | null;
  employment: Record<string, unknown> | null;
  payment_history: Array<{ amount: number; currency: string; paidOn: string; periodLabel: string | null; insuranceAmount: number }> | null;
  hr_address?: string | null;
  hr_national_id?: string | null;
  hr_gender?: string | null;
  hr_marital_status?: string | null;
  hr_nationality?: string | null;
  profile_picture: string | null;
  snapshot_version: number | null;
  archived_by_name?: string | null;
  archived_by_role?: string | null;
  created_at: string;
}

interface ArchivedEmployeeDocRow {
  category: string;
  document_number: string | null;
  issued_on: string | null;
  expires_on: string | null;
  scan_status: 'pending' | 'clean' | 'infected' | 'skipped' | string | null;
  sensitivity: 'low' | 'medium' | 'high' | string | null;
  redacted_at: string | null;
}

export interface ArchivedEmployeePdfData {
  school: { name: string; logoUrl: string | null };
  record: ArchivedEmployeeRow;
  documents: ArchivedEmployeeDocRow[];
  generatedBy: string;
  generatedByRole: string;
}

export async function loadArchivedEmployeeForPdf(archiveId: string, schoolId: string): Promise<ArchivedEmployeePdfData | null> {
  const [{ data: school }, { data: row }] = await Promise.all([
    supabase.from('schools').select('name, logo_url').eq('id', schoolId).single(),
    supabase.from('archived_employees').select('*').eq('id', archiveId).eq('school_id', schoolId).single(),
  ]);
  if (!row) return null;

  // Documents follow the polymorphic owner pointer that rewriteOwnership
  // ToArchive flipped to archived_employees at archive time.
  const { data: docs } = await supabase
    .from('employee_documents')
    .select('category, document_number, issued_on, expires_on, scan_status, sensitivity, redacted_at')
    .eq('school_id', schoolId)
    .eq('owner_type', 'archived_employees')
    .eq('owner_id', archiveId);

  return {
    school: { name: (school?.name as string) ?? 'School', logoUrl: (school?.logo_url as string) ?? null },
    record: row as ArchivedEmployeeRow,
    documents: (docs ?? []) as ArchivedEmployeeDocRow[],
    generatedBy: '',
    generatedByRole: '',
  };
}

function moneyFmt(amount: number, currency: string): string {
  const n = (Number(amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sym: Record<string, string> = { USD: '$', EUR: '€', GBP: '£' };
  return sym[currency] ? `${sym[currency]}${n}` : `${currency} ${n}`;
}

function reasonLabel(reason: string | null, l: Labels): string {
  if (!reason) return l.em_dash;
  const map: Record<string, keyof Labels> = {
    resigned: 'reason_resigned',
    terminated: 'reason_terminated',
    contract_ended: 'reason_contract_ended',
    retired: 'reason_retired',
    transferred: 'reason_transferred',
    other: 'reason_other',
  };
  const k = map[reason];
  return k ? l[k] : reason;
}

function roleLabel(role: string, l: Labels): string {
  const map: Record<string, keyof Labels> = {
    teacher: 'role_teacher',
    driver: 'role_driver',
    staff: 'role_staff',
    supervisor: 'role_supervisor',
    admin: 'role_admin',
    reception: 'role_reception',
    accountant: 'role_accountant',
  };
  const k = map[role];
  return k ? l[k] : role;
}

function scanLabel(s: string | null, l: Labels): string {
  switch (s) {
    case 'clean': return l.scan_status_clean;
    case 'pending': return l.scan_status_pending;
    case 'infected': return l.scan_status_infected;
    case 'skipped': return l.scan_status_skipped;
    default: return l.em_dash;
  }
}

export async function streamArchivedEmployeePdf(
  data: ArchivedEmployeePdfData,
  lang: Lang,
  dest: NodeJS.WritableStream,
): Promise<void> {
  const l = L[lang];
  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
  const F = setupPdfFonts(doc);
  doc.pipe(dest);

  // ─── Header strip ────────────────────────────────────────────────────
  const logoBuf = await fetchLogoBuffer(data.school.logoUrl);
  if (logoBuf) {
    try { doc.image(logoBuf, 40, 40, { fit: [56, 56] }); } catch { /* invalid */ }
  }
  doc.font(F.pick(data.school.name, { bold: true })).fontSize(18).fillColor(COLORS.heading)
    .text(data.school.name, 110, 46);
  doc.font(F.regular).fontSize(10).fillColor(COLORS.muted)
    .text(l.archived_employee_record, 110, 70);
  doc.moveTo(40, 108).lineTo(555, 108).strokeColor(COLORS.border).lineWidth(1).stroke();

  // ─── Identity card ───────────────────────────────────────────────────
  const r = data.record;
  doc.font(F.pick(r.full_name, { bold: true })).fontSize(22).fillColor(COLORS.heading)
    .text(r.full_name, 40, 124);
  const sub = [roleLabel(r.role, l), reasonLabel(r.reason, l), r.departure_date].filter(Boolean).join(' · ');
  doc.font(F.regular).fontSize(11).fillColor(COLORS.muted).text(sub, 40, 152);

  let y = 184;

  // Section card writer.
  function section(title: string, rows: Row[]): void {
    const filtered = rows.filter(([, v]) => v != null && v !== '');
    if (filtered.length === 0) return;
    // Title
    doc.font(F.bold).fontSize(9).fillColor(COLORS.muted).text(title.toUpperCase(), 40, y);
    y += 14;
    // Two-column key/value layout, with wrapping
    const colW = 250, gap = 15, keyW = 110;
    let col = 0;
    let startY = y;
    let rowMaxY = y;
    for (const [k, v] of filtered) {
      const x = 40 + col * (colW + gap);
      doc.font(F.regular).fontSize(9).fillColor(COLORS.muted)
        .text(k, x, y, { width: keyW });
      const valueStr = String(v);
      doc.font(F.pick(valueStr, { bold: true })).fontSize(10).fillColor(COLORS.body)
        .text(valueStr, x + keyW, y, { width: colW - keyW });
      const after = doc.y;
      rowMaxY = Math.max(rowMaxY, after);
      col = (col + 1) % 2;
      if (col === 0) {
        y = rowMaxY + 4;
        startY = y;
      } else {
        y = startY; // second column starts on same row
      }
    }
    if (col !== 0) y = rowMaxY + 4;
    y += 10;
    doc.moveTo(40, y - 6).lineTo(555, y - 6).strokeColor(COLORS.border).stroke();
  }

  section(l.sec_personal, [
    [l.date_of_birth, r.date_of_birth],
    [l.age, r.age != null ? String(r.age) : null],
    [l.gender, r.hr_gender],
    [l.marital_status, r.hr_marital_status],
    [l.nationality, r.hr_nationality],
    [l.national_id, r.hr_national_id],
    [l.address, r.hr_address],
  ]);

  section(l.sec_contact, [
    [l.phone, r.phone_number],
    [l.email, r.email],
    [l.emergency_contact, r.emergency_contact],
  ]);

  section(l.sec_employment, [
    [l.hire_date, r.hire_date],
    [l.departure_date, r.departure_date],
    [l.reason, reasonLabel(r.reason, l)],
    [l.archived_at, r.created_at ? String(r.created_at).slice(0, 10) : null],
    [l.archived_by, r.archived_by_name ? `${r.archived_by_name}${r.archived_by_role ? ` (${r.archived_by_role})` : ''}` : null],
    [l.position, r.position],
    [l.subject, r.subject],
  ]);

  // Role-specific
  if (r.role === 'teacher') {
    const teaching = (r.teaching ?? {}) as { curriculum?: Array<{ className: string | null; subjects: string[] }>; contentSummary?: Record<string, number> };
    const curriculum = teaching.curriculum ?? [];
    if (curriculum.length > 0) {
      doc.font(F.bold).fontSize(9).fillColor(COLORS.muted).text(l.sec_teaching.toUpperCase(), 40, y);
      y += 14;
      doc.font(F.bold).fontSize(10).fillColor(COLORS.heading).text(l.curriculum, 40, y);
      y += 14;
      doc.font(F.regular).fontSize(10).fillColor(COLORS.body);
      for (const c of curriculum) {
        const text = `  • ${c.className ?? l.em_dash}: ${(c.subjects || []).join(', ') || l.em_dash}`;
        doc.font(F.pick(text)).text(text, 40, y);
        y = doc.y + 2;
      }
      const cs = teaching.contentSummary;
      if (cs) {
        const summary = `${l.authored}: ${cs.homework ?? 0} ${l.homework} · ${cs.assignments ?? 0} ${l.assignments} · ${cs.grades ?? 0} ${l.grades} · ${cs.reports ?? 0} ${l.reports} · ${cs.weeklySummaries ?? 0} ${l.weekly_summaries} · ${cs.academicPosts ?? 0} ${l.academic_posts}`;
        y += 4;
        doc.font(F.regular).fontSize(9).fillColor(COLORS.muted).text(summary, 40, y, { width: 515 });
        y = doc.y + 2;
      }
      y += 8;
      doc.moveTo(40, y - 4).lineTo(555, y - 4).strokeColor(COLORS.border).stroke();
    }
  }

  if (r.role === 'driver') {
    const tr = (r.transport ?? {}) as { busNumber?: string; plateNumber?: string; vehicleType?: string; licenseNumber?: string; studentsTransported?: Array<unknown>; rideRecordStats?: { rode?: number; total?: number } };
    const transportRows: Row[] = [
      [l.bus, tr.busNumber ? `#${tr.busNumber}${tr.plateNumber ? ` (${tr.plateNumber})` : ''}` : null],
      [l.vehicle, tr.vehicleType ?? null],
      [l.license, tr.licenseNumber ?? null],
      [l.students_transported, tr.studentsTransported ? String(tr.studentsTransported.length) : null],
      [l.ride_records, tr.rideRecordStats ? `${tr.rideRecordStats.rode ?? 0} / ${tr.rideRecordStats.total ?? 0}` : null],
    ];
    section(l.sec_transport, transportRows);
  }

  if (r.role === 'staff') {
    const em = (r.employment ?? {}) as { salaryAmount?: number; currency?: string; insurancePercentage?: number; insuranceHeld?: number; insurancePaidOut?: boolean; insurancePaidOutAmount?: number; insurancePaidOutCurrency?: string; insurancePaidOutAt?: string };
    section(l.sec_compensation, [
      [l.salary, em.salaryAmount != null ? moneyFmt(em.salaryAmount, em.currency ?? 'USD') : null],
      [l.insurance_pct, em.insurancePercentage != null ? `${em.insurancePercentage}%` : null],
      [l.insurance_held, em.insuranceHeld != null ? moneyFmt(em.insuranceHeld, em.currency ?? 'USD') : null],
      [l.insurance_paid_out_amount, em.insurancePaidOut && em.insurancePaidOutAmount != null
        ? moneyFmt(em.insurancePaidOutAmount, em.insurancePaidOutCurrency ?? em.currency ?? 'USD') : null],
      [l.insurance_paid_out_at, em.insurancePaidOutAt ?? null],
    ]);

    const payments = r.payment_history ?? [];
    if (payments.length > 0) {
      // Salary history table.
      doc.font(F.bold).fontSize(9).fillColor(COLORS.muted).text(l.salary_history.toUpperCase(), 40, y);
      y += 16;
      const cols = [
        { label: l.col_date, w: 80 },
        { label: l.col_gross, w: 100 },
        { label: l.col_insurance, w: 100 },
        { label: l.col_net, w: 100 },
        { label: l.col_period, w: 135 },
      ];
      let x = 40;
      doc.font(F.bold).fontSize(9).fillColor(COLORS.heading);
      for (const c of cols) { doc.text(c.label, x, y, { width: c.w }); x += c.w; }
      y += 14;
      doc.moveTo(40, y - 4).lineTo(555, y - 4).strokeColor(COLORS.border).stroke();
      let gross = 0, ins = 0;
      const currency = payments[0]?.currency ?? 'USD';
      for (const p of payments) {
        const net = (Number(p.amount) || 0) - (Number(p.insuranceAmount) || 0);
        gross += Number(p.amount) || 0;
        ins += Number(p.insuranceAmount) || 0;
        x = 40;
        doc.font(F.regular).fontSize(9).fillColor(COLORS.body);
        doc.text(p.paidOn, x, y, { width: cols[0].w }); x += cols[0].w;
        doc.text(moneyFmt(p.amount, p.currency), x, y, { width: cols[1].w }); x += cols[1].w;
        doc.text(moneyFmt(p.insuranceAmount || 0, p.currency), x, y, { width: cols[2].w }); x += cols[2].w;
        doc.text(moneyFmt(net, p.currency), x, y, { width: cols[3].w }); x += cols[3].w;
        const periodStr = p.periodLabel ?? l.em_dash;
        doc.font(F.pick(periodStr)).text(periodStr, x, y, { width: cols[4].w });
        y = doc.y + 2;
        if (y > 770) { doc.addPage(); y = 50; }
      }
      y += 4;
      doc.moveTo(40, y).lineTo(555, y).strokeColor(COLORS.border).stroke();
      y += 8;
      doc.font(F.bold).fontSize(10).fillColor(COLORS.heading)
        .text(`${l.total_gross}: ${moneyFmt(gross, currency)}   ·   ${l.total_insurance}: ${moneyFmt(ins, currency)}   ·   ${l.total_net}: ${moneyFmt(gross - ins, currency)}`, 40, y, { width: 515 });
      y = doc.y + 12;
    }
  }

  // Account
  const acc = (r.account ?? {}) as { username?: string; isActive?: boolean; is_active?: boolean };
  if (acc.username) {
    section(l.sec_account, [
      [l.username, acc.username],
      [l.role_field, roleLabel(r.role, l)],
      [l.was_active, acc.isActive ?? acc.is_active ? l.yes : l.no],
    ]);
  }

  // Documents
  if (y > 720) { doc.addPage(); y = 50; }
  doc.font(F.bold).fontSize(9).fillColor(COLORS.muted).text(l.sec_documents.toUpperCase(), 40, y);
  y += 16;
  if (data.documents.length === 0) {
    doc.font(F.regular).fontSize(10).fillColor(COLORS.muted).text(l.no_documents, 40, y);
    y = doc.y + 12;
  } else {
    const cols = [
      { label: l.docs_col_category, w: 150 },
      { label: l.docs_col_number, w: 110 },
      { label: l.docs_col_issued, w: 80 },
      { label: l.docs_col_expires, w: 80 },
      { label: l.docs_col_status, w: 95 },
    ];
    let x = 40;
    doc.font(F.bold).fontSize(9).fillColor(COLORS.heading);
    for (const c of cols) { doc.text(c.label, x, y, { width: c.w }); x += c.w; }
    y += 14;
    doc.moveTo(40, y - 4).lineTo(555, y - 4).strokeColor(COLORS.border).stroke();
    for (const d of data.documents) {
      x = 40;
      const isRedacted = !!d.redacted_at;
      const cells: string[] = [
        d.category || l.em_dash,
        isRedacted ? l.redacted : (d.document_number || l.em_dash),
        isRedacted ? l.em_dash : (d.issued_on || l.em_dash),
        isRedacted ? l.em_dash : (d.expires_on || l.em_dash),
        scanLabel(d.scan_status, l),
      ];
      doc.font(F.regular).fontSize(9).fillColor(COLORS.body);
      for (let i = 0; i < cols.length; i++) {
        const text = cells[i];
        doc.font(F.pick(text)).text(text, x, y, { width: cols[i].w });
        x += cols[i].w;
      }
      y = doc.y + 4;
      if (y > 770) { doc.addPage(); y = 50; }
    }
    y += 6;
  }

  // ─── Footer (last page) ──────────────────────────────────────────────
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.font(F.regular).fontSize(8).fillColor(COLORS.muted)
      .text(
        `${l.archive_id}: ${r.id}   ·   ${l.schema_version}: ${r.snapshot_version ?? 1}   ·   ${l.generated}: ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC   ·   ${l.by} ${data.generatedBy || l.em_dash}${data.generatedByRole ? ` (${data.generatedByRole})` : ''}`,
        40, 800, { width: 515, align: 'left' },
      );
  }

  doc.end();
}
