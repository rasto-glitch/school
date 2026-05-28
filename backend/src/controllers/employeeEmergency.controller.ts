// Emergency contacts (Wave 2). Multi-row replacement for the single
// free-text emergency_contact column. Priority orders the list (1 = primary).
// Admin can manage all; the employee themselves can read + edit their own
// via /me/emergency-contacts.
//
// Rows live polymorphically on (owner_type, owner_id). On archive, the
// owner_type pointer is rewritten to 'archived_employees' by the archive
// flow so contacts survive.

import { Response } from 'express';
import { adminDb as supabase } from '../utils/db';
import type { AuthRequest } from '../middleware/auth';
import { toCC } from '../utils/transform';
import { safeDbErrorMessage, safeDbErrorStatus } from '../utils/dbErrors';
import { logAudit } from '../utils/audit';
import {
  ROLE_TO_OWNER_TYPE, type EmployeeRole, type OwnerType,
  verifyOwnerExists,
} from '../utils/employeeDocs';

function roleFromParams(req: AuthRequest): EmployeeRole | null {
  const r = String(req.params.role);
  return (ROLE_TO_OWNER_TYPE as Record<string, OwnerType>)[r] ? (r as EmployeeRole) : null;
}

interface ContactInput {
  fullName: string;
  relationship?: string | null;
  phone?: string | null;
  altPhone?: string | null;
  email?: string | null;
  address?: string | null;
  priority?: number;
}

function validateContact(input: unknown): { ok: true; v: ContactInput } | { ok: false; error: string } {
  const i = input as Record<string, unknown> | null;
  if (!i || typeof i !== 'object') return { ok: false, error: 'Invalid contact' };
  const fullName = typeof i.fullName === 'string' ? i.fullName.trim() : '';
  if (!fullName) return { ok: false, error: 'Full name is required' };
  if (fullName.length > 200) return { ok: false, error: 'Full name too long' };
  const priority = i.priority === undefined ? 1 : Number(i.priority);
  if (!Number.isFinite(priority) || priority < 1 || priority > 10) {
    return { ok: false, error: 'Priority must be between 1 and 10' };
  }
  return {
    ok: true,
    v: {
      fullName,
      relationship: typeof i.relationship === 'string' ? i.relationship.trim() || null : null,
      phone: typeof i.phone === 'string' ? i.phone.trim() || null : null,
      altPhone: typeof i.altPhone === 'string' ? i.altPhone.trim() || null : null,
      email: typeof i.email === 'string' ? i.email.trim() || null : null,
      address: typeof i.address === 'string' ? i.address.trim() || null : null,
      priority,
    },
  };
}

// ── GET /admin/employees/:role/:id/emergency-contacts ──────────────────────
export async function listForEmployee(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const role = roleFromParams(req);
  if (!role) { res.status(400).json({ error: 'Unknown employee role' }); return; }
  const ownerId = String(req.params.id);
  const ownerType = ROLE_TO_OWNER_TYPE[role];

  if (!(await verifyOwnerExists(ownerType, ownerId, schoolId))) {
    res.status(404).json({ error: 'Employee not found' });
    return;
  }

  const { data, error } = await supabase
    .from('employee_emergency_contacts')
    .select('id, full_name, relationship, phone, alt_phone, email, address, priority, created_at')
    .eq('school_id', schoolId).eq('owner_type', ownerType).eq('owner_id', ownerId)
    .order('priority', { ascending: true });
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  res.json({ contacts: toCC(data) });
}

// ── POST /admin/employees/:role/:id/emergency-contacts ─────────────────────
export async function createForEmployee(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const role = roleFromParams(req);
  if (!role) { res.status(400).json({ error: 'Unknown employee role' }); return; }
  const ownerId = String(req.params.id);
  const ownerType = ROLE_TO_OWNER_TYPE[role];

  if (!(await verifyOwnerExists(ownerType, ownerId, schoolId))) {
    res.status(404).json({ error: 'Employee not found' });
    return;
  }

  const r = validateContact(req.body);
  if (!r.ok) { res.status(400).json({ error: r.error }); return; }

  const insertRow = {
    school_id: schoolId,
    owner_type: ownerType,
    owner_id: ownerId,
    full_name: r.v.fullName,
    relationship: r.v.relationship,
    phone: r.v.phone,
    alt_phone: r.v.altPhone,
    email: r.v.email,
    address: r.v.address,
    priority: r.v.priority,
  };

  // tenant-check-allow: insertRow.school_id sourced from req.user!.schoolId; INSERT has no .eq() shape.
  const { data, error } = await supabase
    .from('employee_emergency_contacts')
    .insert(insertRow)
    .select('id, full_name, relationship, phone, alt_phone, email, address, priority, created_at')
    .single();
  if (error || !data) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  await logAudit({
    req,
    entityType: 'employee_emergency_contact',
    entityId: data.id,
    action: 'create',
    after: { full_name: data.full_name, priority: data.priority, owner_type: ownerType, owner_id: ownerId },
    label: 'emergency_contact_create',
  });

  res.status(201).json({ contact: toCC(data) });
}

// ── PATCH /admin/emergency-contacts/:id ────────────────────────────────────
export async function update(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const id = String(req.params.id);

  const { data: before, error: readErr } = await supabase
    .from('employee_emergency_contacts')
    .select('id, full_name, relationship, phone, alt_phone, email, address, priority')
    .eq('id', id).eq('school_id', schoolId).maybeSingle();
  if (readErr) { res.status(safeDbErrorStatus(readErr)).json({ error: safeDbErrorMessage(readErr) }); return; }
  if (!before) { res.status(404).json({ error: 'Contact not found' }); return; }

  const r = validateContact(req.body);
  if (!r.ok) { res.status(400).json({ error: r.error }); return; }

  const patch = {
    full_name: r.v.fullName,
    relationship: r.v.relationship,
    phone: r.v.phone,
    alt_phone: r.v.altPhone,
    email: r.v.email,
    address: r.v.address,
    priority: r.v.priority,
  };

  const { data, error } = await supabase
    .from('employee_emergency_contacts')
    .update(patch)
    .eq('id', id).eq('school_id', schoolId)
    .select('id, full_name, relationship, phone, alt_phone, email, address, priority, created_at')
    .single();
  if (error || !data) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  await logAudit({
    req, entityType: 'employee_emergency_contact', entityId: id,
    action: 'update', before, after: patch, label: 'emergency_contact_update',
  });

  res.json({ contact: toCC(data) });
}

// ── DELETE /admin/emergency-contacts/:id ───────────────────────────────────
export async function remove(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const id = String(req.params.id);

  const { data: before } = await supabase
    .from('employee_emergency_contacts')
    .select('id, full_name, priority, owner_type, owner_id')
    .eq('id', id).eq('school_id', schoolId).maybeSingle();
  if (!before) { res.status(404).json({ error: 'Contact not found' }); return; }

  const { error } = await supabase
    .from('employee_emergency_contacts')
    .delete().eq('id', id).eq('school_id', schoolId);
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  await logAudit({
    req, entityType: 'employee_emergency_contact', entityId: id,
    action: 'delete', before, label: 'emergency_contact_delete',
  });

  res.json({ ok: true });
}
