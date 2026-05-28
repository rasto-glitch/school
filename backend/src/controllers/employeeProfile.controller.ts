// Employee profile — comprehensive read of one active employee. Mirrors the
// shape used by the archived-employees viewer so the same frontend component
// renders both, and serves an audited JSON / PDF export.
//
// The endpoint is admin-only; high-sensitivity columns (national_id, plus
// any high-sensitivity documents) come through redacted unless the caller
// is an HR officer. This is the single read-path that powers the new
// EmployeeProfilePage on the frontend.

import { Response } from 'express';
import PDFDocument from 'pdfkit';
import { adminDb as supabase } from '../utils/db';
import type { AuthRequest } from '../middleware/auth';
import { toCC } from '../utils/transform';
import { safeDbErrorMessage, safeDbErrorStatus } from '../utils/dbErrors';
import { logAudit } from '../utils/audit';
import { setupPdfFonts } from '../utils/pdfFont';
import {
  ROLE_TO_OWNER_TYPE, type EmployeeRole, type OwnerType,
  isHrOfficer,
} from '../utils/employeeDocs';

function roleFromParams(req: AuthRequest): EmployeeRole | null {
  const r = String(req.params.role);
  return (ROLE_TO_OWNER_TYPE as Record<string, OwnerType>)[r] ? (r as EmployeeRole) : null;
}

// ── shared HR projection columns ───────────────────────────────────────────
const HR_COLS =
  'address, hire_date, national_id, date_of_birth, marital_status, gender, ' +
  'employment_type, qualifications, notes, official_photo';

// ── loader: pulls a single employee record per role ────────────────────────
// Returns the same shape across roles so the frontend doesn't branch:
//   { role, schoolId, fullName, photo, account, contact, hr, role-specific:
//     teaching | transport | employment, account-only }
// Returns null when not found / wrong school.

interface ProfileShape {
  role: EmployeeRole;
  ownerType: OwnerType;
  ownerId: string;
  schoolId: string;
  fullName: string;
  officialPhoto: string | null;
  account: {
    userId: string | null;
    username: string | null;
    email: string | null;
    isActive: boolean | null;
    passwordChangedAt: string | null;
    createdAt: string | null;
  };
  contact: {
    phoneNumber: string | null;
    emergencyContact: string | null;
    email: string | null;
  };
  hr: {
    address: string | null;
    hireDate: string | null;
    nationalId: string | null;
    dateOfBirth: string | null;
    maritalStatus: string | null;
    gender: string | null;
    employmentType: string | null;
    qualifications: string | null;
    notes: string | null;
  };
  teaching?: {
    subjects: { id: string; name: string; classes: { id: string; name: string }[] }[];
    classes: { id: string; name: string }[];
  };
  transport?: {
    licenseNumber: string | null;
    vehicleType: string | null;
    bus: { number: string | null; plate: string | null } | null;
    studentsAssigned: number;
    age: number | null;
  };
  employment?: {
    position: string | null;
    salaryAmount: number | null;
    currency: string | null;
    nextPaymentDate: string | null;
    insurancePercentage: number | null;
  };
}

async function loadProfile(role: EmployeeRole, id: string, schoolId: string): Promise<ProfileShape | null> {
  switch (role) {
    case 'teacher': {
      const { data } = await supabase
        .from('teachers')
        .select(`
          id, school_id, full_name, phone_number, emergency_contact, ${HR_COLS},
          users:user_id (id, username, email, phone, is_active, password_changed_at, created_at),
          class_subject_teachers (class_id, subject_id, classes(id, name), subjects(id, name)),
          teacher_classes (class_id, classes(id, name))
        `)
        .eq('id', id).eq('school_id', schoolId).maybeSingle();
      if (!data) return null;
      const u = data.users as unknown as {
        id: string; username: string; email: string | null; phone: string | null;
        is_active: boolean; password_changed_at: string | null; created_at: string | null;
      } | null;

      const subjMap = new Map<string, { id: string; name: string; classes: { id: string; name: string }[] }>();
      for (const r of (data.class_subject_teachers ?? []) as { class_id: string; subject_id: string; classes?: { id?: string; name?: string }; subjects?: { id?: string; name?: string } }[]) {
        const sid = r.subject_id; const sname = r.subjects?.name;
        if (!sid || !sname) continue;
        if (!subjMap.has(sid)) subjMap.set(sid, { id: sid, name: sname, classes: [] });
        if (r.class_id && !subjMap.get(sid)!.classes.some(c => c.id === r.class_id)) {
          subjMap.get(sid)!.classes.push({ id: r.class_id, name: r.classes?.name ?? '' });
        }
      }
      const classes: { id: string; name: string }[] = [];
      const seen = new Set<string>();
      for (const tc of (data.teacher_classes ?? []) as { class_id: string; classes?: { id?: string; name?: string } }[]) {
        const cid = tc.class_id; if (!cid || seen.has(cid)) continue; seen.add(cid);
        classes.push({ id: cid, name: tc.classes?.name ?? '' });
      }
      return {
        role, ownerType: 'teachers', ownerId: data.id, schoolId: data.school_id,
        fullName: data.full_name, officialPhoto: data.official_photo,
        account: {
          userId: u?.id ?? null, username: u?.username ?? null, email: u?.email ?? null,
          isActive: u?.is_active ?? null, passwordChangedAt: u?.password_changed_at ?? null,
          createdAt: u?.created_at ?? null,
        },
        contact: { phoneNumber: data.phone_number, emergencyContact: data.emergency_contact, email: u?.email ?? null },
        hr: {
          address: data.address, hireDate: data.hire_date, nationalId: data.national_id,
          dateOfBirth: data.date_of_birth, maritalStatus: data.marital_status, gender: data.gender,
          employmentType: data.employment_type, qualifications: data.qualifications, notes: data.notes,
        },
        teaching: { subjects: Array.from(subjMap.values()), classes },
      };
    }

    case 'driver': {
      const { data } = await supabase
        .from('drivers')
        .select(`
          id, school_id, full_name, phone_number, emergency_contact, license_number, vehicle_type, age, ${HR_COLS},
          users:user_id (id, username, email, phone, is_active, password_changed_at, created_at),
          buses:bus_id (bus_number, plate_number)
        `)
        .eq('id', id).eq('school_id', schoolId).maybeSingle();
      if (!data) return null;
      const u = data.users as unknown as {
        id: string; username: string; email: string | null; phone: string | null;
        is_active: boolean; password_changed_at: string | null; created_at: string | null;
      } | null;
      const b = data.buses as unknown as { bus_number: string | null; plate_number: string | null } | null;

      const { count: studentsAssigned } = await supabase
        .from('students').select('id', { count: 'exact', head: true })
        .eq('school_id', schoolId).eq('driver_id', id);

      return {
        role, ownerType: 'drivers', ownerId: data.id, schoolId: data.school_id,
        fullName: data.full_name, officialPhoto: data.official_photo,
        account: {
          userId: u?.id ?? null, username: u?.username ?? null, email: u?.email ?? null,
          isActive: u?.is_active ?? null, passwordChangedAt: u?.password_changed_at ?? null,
          createdAt: u?.created_at ?? null,
        },
        contact: { phoneNumber: data.phone_number, emergencyContact: data.emergency_contact, email: u?.email ?? null },
        hr: {
          address: data.address, hireDate: data.hire_date, nationalId: data.national_id,
          dateOfBirth: data.date_of_birth, maritalStatus: data.marital_status, gender: data.gender,
          employmentType: data.employment_type, qualifications: data.qualifications, notes: data.notes,
        },
        transport: {
          licenseNumber: data.license_number, vehicleType: data.vehicle_type, age: data.age,
          bus: b ? { number: b.bus_number, plate: b.plate_number } : null,
          studentsAssigned: studentsAssigned ?? 0,
        },
      };
    }

    case 'staff': {
      const { data } = await supabase
        .from('staff_members')
        .select(`
          id, school_id, full_name, position, salary_amount, currency, next_payment_date,
          insurance_percentage, emergency_contact, ${HR_COLS},
          users:user_id (id, username, email, phone, is_active, password_changed_at, created_at)
        `)
        .eq('id', id).eq('school_id', schoolId).is('voided_at', null).maybeSingle();
      if (!data) return null;
      const u = data.users as unknown as {
        id: string; username: string; email: string | null; phone: string | null;
        is_active: boolean; password_changed_at: string | null; created_at: string | null;
      } | null;
      return {
        role, ownerType: 'staff_members', ownerId: data.id, schoolId: data.school_id,
        fullName: data.full_name, officialPhoto: data.official_photo,
        account: {
          userId: u?.id ?? null, username: u?.username ?? null, email: u?.email ?? null,
          isActive: u?.is_active ?? null, passwordChangedAt: u?.password_changed_at ?? null,
          createdAt: u?.created_at ?? null,
        },
        contact: { phoneNumber: u?.phone ?? null, emergencyContact: data.emergency_contact, email: u?.email ?? null },
        hr: {
          address: data.address, hireDate: data.hire_date, nationalId: data.national_id,
          dateOfBirth: data.date_of_birth, maritalStatus: data.marital_status, gender: data.gender,
          employmentType: data.employment_type, qualifications: data.qualifications, notes: data.notes,
        },
        employment: {
          position: data.position, salaryAmount: data.salary_amount, currency: data.currency,
          nextPaymentDate: data.next_payment_date, insurancePercentage: data.insurance_percentage,
        },
      };
    }

    case 'supervisor':
    case 'admin':
    case 'reception':
    case 'accountant': {
      // Account-only roles: HR lives on users itself.
      const { data } = await supabase
        .from('users')
        .select(`
          id, school_id, username, email, phone, role, first_name, last_name,
          is_active, password_changed_at, created_at, emergency_contact, ${HR_COLS}
        `)
        .eq('id', id).eq('school_id', schoolId).eq('role', role).maybeSingle();
      if (!data) return null;
      return {
        role, ownerType: 'users', ownerId: data.id, schoolId: data.school_id,
        fullName: `${data.first_name ?? ''} ${data.last_name ?? ''}`.trim() || data.username,
        officialPhoto: data.official_photo,
        account: {
          userId: data.id, username: data.username, email: data.email,
          isActive: data.is_active, passwordChangedAt: data.password_changed_at,
          createdAt: data.created_at,
        },
        contact: { phoneNumber: data.phone, emergencyContact: data.emergency_contact, email: data.email },
        hr: {
          address: data.address, hireDate: data.hire_date, nationalId: data.national_id,
          dateOfBirth: data.date_of_birth, maritalStatus: data.marital_status, gender: data.gender,
          employmentType: data.employment_type, qualifications: data.qualifications, notes: data.notes,
        },
      };
    }
  }
}

// ── document list (mirrors employeeDocs.controller's listForEmployee) ──────
async function loadDocuments(
  ownerType: OwnerType, ownerId: string, schoolId: string, hrOfficer: boolean,
): Promise<{ documents: Record<string, unknown>[] }> {
  const { data } = await supabase
    .from('employee_documents')
    .select(`
      id, category, sensitivity, filename, mime_type, byte_size, sha256, scan_status,
      document_number, issued_on, expires_on, notes, uploaded_at
    `)
    .eq('school_id', schoolId)
    .eq('owner_type', ownerType).eq('owner_id', ownerId)
    .is('voided_at', null)
    .order('uploaded_at', { ascending: false });

  const documents = (data ?? []).map(row => {
    if (row.sensitivity === 'high' && !hrOfficer) {
      return {
        id: row.id, category: row.category, sensitivity: row.sensitivity,
        scan_status: row.scan_status, uploaded_at: row.uploaded_at, redacted: true,
      };
    }
    return { ...row, redacted: false };
  });
  return { documents: toCC(documents) as Record<string, unknown>[] };
}

// HR officer view sees everything; otherwise mask sensitive PII columns.
function redactProfile(p: ProfileShape, hrOfficer: boolean): ProfileShape {
  if (hrOfficer) return p;
  return { ...p, hr: { ...p.hr, nationalId: p.hr.nationalId ? '[hr_officer_required]' : null } };
}

// ── GET /admin/employees/:role/:id ─────────────────────────────────────────
export async function getProfile(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const role = roleFromParams(req);
  if (!role) { res.status(400).json({ error: 'Unknown employee role' }); return; }
  const id = String(req.params.id);

  try {
    const profile = await loadProfile(role, id, schoolId);
    if (!profile) { res.status(404).json({ error: 'Employee not found' }); return; }

    const hrOfficer = await isHrOfficer(userId);
    const { documents } = await loadDocuments(profile.ownerType, profile.ownerId, schoolId, hrOfficer);

    await logAudit({
      req,
      entityType: 'employee_profile',
      entityId: profile.ownerId,
      action: 'read',
      after: { _meta: { kind: 'profile_view', role, ownerType: profile.ownerType } },
      label: 'profile_view',
    });

    res.json({
      profile: toCC(redactProfile(profile, hrOfficer)),
      documents,
      hrOfficer,
    });
  } catch (err) {
    const e = err as { code?: string; message?: string } | null;
    res.status(safeDbErrorStatus(e)).json({ error: safeDbErrorMessage(e) });
  }
}

// ── GET /admin/employees/:role/:id/export.json ─────────────────────────────
export async function exportProfileJson(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const role = roleFromParams(req);
  if (!role) { res.status(400).json({ error: 'Unknown employee role' }); return; }
  const id = String(req.params.id);

  const profile = await loadProfile(role, id, schoolId);
  if (!profile) { res.status(404).json({ error: 'Employee not found' }); return; }
  const hrOfficer = await isHrOfficer(userId);
  const { documents } = await loadDocuments(profile.ownerType, profile.ownerId, schoolId, hrOfficer);

  const payload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    role,
    profile: toCC(redactProfile(profile, hrOfficer)),
    documents,
  };

  await logAudit({
    req,
    entityType: 'employee_profile',
    entityId: profile.ownerId,
    action: 'export',
    after: { _meta: { kind: 'json_export', role } },
    label: 'profile_export_json',
  });

  const filename = `employee-${role}-${profile.fullName.replace(/[^a-z0-9-_]+/gi, '_')}.json`;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(JSON.stringify(payload, null, 2));
}

// ── GET /admin/employees/:role/:id/export.pdf ──────────────────────────────
// Minimal printable HR file. Header + sectioned key/value + documents table.
export async function exportProfilePdf(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const role = roleFromParams(req);
  if (!role) { res.status(400).json({ error: 'Unknown employee role' }); return; }
  const id = String(req.params.id);

  const profile = await loadProfile(role, id, schoolId);
  if (!profile) { res.status(404).json({ error: 'Employee not found' }); return; }
  const hrOfficer = await isHrOfficer(userId);
  const { documents } = await loadDocuments(profile.ownerType, profile.ownerId, schoolId, hrOfficer);
  const p = redactProfile(profile, hrOfficer);

  await logAudit({
    req,
    entityType: 'employee_profile',
    entityId: profile.ownerId,
    action: 'export',
    after: { _meta: { kind: 'pdf_export', role } },
    label: 'profile_export_pdf',
  });

  const filename = `employee-${role}-${profile.fullName.replace(/[^a-z0-9-_]+/gi, '_')}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.pipe(res);
  const fonts = setupPdfFonts(doc);

  // Header
  doc.font(fonts.pick(p.fullName, { bold: true })).fontSize(20).text(p.fullName);
  doc.moveDown(0.2);
  doc.font(fonts.regular).fontSize(11).fillColor('#555')
    .text(`${role.charAt(0).toUpperCase()}${role.slice(1)} · Generated ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC`);
  doc.moveDown(1).fillColor('#000');

  function section(title: string, rows: [string, string | null | undefined][]): void {
    doc.font(fonts.bold).fontSize(11).fillColor('#666').text(title.toUpperCase(), { underline: false });
    doc.moveDown(0.3);
    for (const [k, v] of rows) {
      doc.font(fonts.regular).fontSize(10).fillColor('#666').text(k, { continued: true });
      doc.font(fonts.pick(v ?? '', { bold: true })).fillColor('#000').text(`  ${v || '—'}`);
    }
    doc.moveDown(0.6).fillColor('#000');
  }

  section('Account', [
    ['Username', p.account.username],
    ['Email', p.account.email],
    ['Active', p.account.isActive === false ? 'No' : 'Yes'],
    ['Account created', p.account.createdAt?.slice(0, 10) ?? null],
  ]);

  section('Personal', [
    ['Date of birth', p.hr.dateOfBirth],
    ['Gender', p.hr.gender],
    ['Marital status', p.hr.maritalStatus],
    ['National ID', p.hr.nationalId],
    ['Address', p.hr.address],
  ]);

  section('Contact', [
    ['Phone', p.contact.phoneNumber],
    ['Emergency contact', p.contact.emergencyContact],
  ]);

  section('Employment', [
    ['Hire date', p.hr.hireDate],
    ['Employment type', p.hr.employmentType],
    ['Qualifications', p.hr.qualifications],
  ]);

  if (p.teaching) {
    const subjects = p.teaching.subjects.map(s => {
      const classes = s.classes.map(c => c.name).filter(Boolean).join(', ');
      return classes ? `${s.name} (${classes})` : s.name;
    }).join('; ') || '—';
    section('Teaching', [['Subjects & classes', subjects]]);
  }
  if (p.transport) {
    section('Transport', [
      ['Licence', p.transport.licenseNumber],
      ['Vehicle', p.transport.vehicleType],
      ['Bus', p.transport.bus ? `${p.transport.bus.number ?? ''} ${p.transport.bus.plate ? `(${p.transport.bus.plate})` : ''}`.trim() : null],
      ['Students assigned', String(p.transport.studentsAssigned)],
    ]);
  }
  if (p.employment) {
    section('Position & salary', [
      ['Position', p.employment.position],
      ['Salary', p.employment.salaryAmount != null ? `${p.employment.salaryAmount} ${p.employment.currency ?? ''}` : null],
      ['Next payment', p.employment.nextPaymentDate],
    ]);
  }

  // Documents appendix
  doc.addPage();
  doc.font(fonts.bold).fontSize(14).text('Documents on file');
  doc.moveDown(0.5);
  if (documents.length === 0) {
    doc.font(fonts.regular).fontSize(10).fillColor('#666').text('No documents uploaded.');
  } else {
    doc.font(fonts.regular).fontSize(9).fillColor('#000');
    for (const d of documents as { category?: string; documentNumber?: string | null; expiresOn?: string | null; uploadedAt?: string | null; sha256?: string; redacted?: boolean }[]) {
      const line = d.redacted
        ? `· ${d.category} — [hr_officer_required]`
        : `· ${d.category}${d.documentNumber ? ` #${d.documentNumber}` : ''}` +
          `${d.expiresOn ? ` · expires ${d.expiresOn}` : ''}` +
          `${d.uploadedAt ? ` · uploaded ${d.uploadedAt.slice(0, 10)}` : ''}`;
      doc.text(line);
      if (d.sha256 && !d.redacted) {
        doc.fillColor('#888').text(`     sha256: ${d.sha256}`);
        doc.fillColor('#000');
      }
    }
  }
  doc.moveDown(1);
  doc.fontSize(8).fillColor('#999').text(
    'This document is an exported employee HR record. The SHA-256 hashes below each document name verify chain-of-custody — the file in storage hashes to the same value at audit time.',
    { width: 495 },
  );

  doc.end();
}
