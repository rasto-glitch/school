// Self-service employee profile (Wave 2.5). Lets the logged-in employee
// read + edit their own low/medium-sensitivity fields without an admin
// touching the keyboard. High-sensitivity fields (religion + SSN) stay
// HR-officer-only — the employee can neither read nor write them here.
//
// Resolution: the caller's JWT carries `role`. We map that to an
// (owner_type, owner_id) tuple by looking up the role's profile table:
//   teacher    → teachers.id WHERE user_id = jwt.userId
//   driver     → drivers.id  WHERE user_id = jwt.userId
//   supervisor / admin / reception / accountant
//              → owner_type = 'users', owner_id = jwt.userId
//   parent     → not an employee, 403
//
// Staff members logged in under another role (teacher etc) still surface
// their HR row via that role's profile table, NOT via staff_members.

import { Response } from 'express';
import { adminDb as supabase } from '../utils/db';
import type { AuthRequest } from '../middleware/auth';
import { toCC } from '../utils/transform';
import { safeDbErrorMessage, safeDbErrorStatus } from '../utils/dbErrors';
import { logAudit } from '../utils/audit';
import type { OwnerType } from '../utils/employeeDocs';
import {
  encryptedProfilePatch, decryptProfileRow,
} from '../utils/employeePiiCrypto';

interface MyOwner { ownerType: OwnerType; ownerId: string; }

/**
 * Resolves the caller's polymorphic owner. Returns null when the role
 * isn't an employee role (parent) or when the expected profile row is
 * missing (teacher with no teachers row, etc.).
 */
async function resolveMyOwner(req: AuthRequest): Promise<MyOwner | { error: string; status: number }> {
  const { schoolId, userId, role } = req.user!;
  switch (role) {
    case 'parent':
      return { error: 'Parents are not employees', status: 403 };

    case 'teacher': {
      const { data } = await supabase.from('teachers').select('id').eq('user_id', userId).eq('school_id', schoolId).maybeSingle();
      if (!data) return { error: 'No teacher record linked to this user', status: 404 };
      return { ownerType: 'teachers', ownerId: data.id };
    }
    case 'driver': {
      const { data } = await supabase.from('drivers').select('id').eq('user_id', userId).eq('school_id', schoolId).maybeSingle();
      if (!data) return { error: 'No driver record linked to this user', status: 404 };
      return { ownerType: 'drivers', ownerId: data.id };
    }
    case 'supervisor': case 'admin': case 'reception': case 'accountant':
      return { ownerType: 'users', ownerId: userId };
  }
}

// ── GET /me/employee-profile ───────────────────────────────────────────────
// Identity + the (HR-officer-redacted) extended profile + emergency contacts
// in one shot. Lets the frontend render the full "my employee record"
// editor without three round trips.

export async function getMyProfile(req: AuthRequest, res: Response): Promise<void> {
  const owner = await resolveMyOwner(req);
  if ('error' in owner) { res.status(owner.status).json({ error: owner.error }); return; }
  const { schoolId, userId } = req.user!;

  const [extRes, ecRes, userRes] = await Promise.all([
    supabase.from('employee_extended_profile').select(`
      place_of_birth, nationality, blood_type, languages_spoken, dependents_count, bank_name,
      mother_full_name_ct, father_full_name_ct, spouse_name_ct, religion_ct,
      bank_iban_ct, tax_id_ct, social_insurance_no_ct,
      consent_pii_at, redacted_at, redacted_reason, updated_at
    `).eq('school_id', schoolId).eq('owner_type', owner.ownerType).eq('owner_id', owner.ownerId).maybeSingle(),
    supabase.from('employee_emergency_contacts').select(
      'id, full_name, relationship, phone, alt_phone, email, address, priority, created_at',
    ).eq('school_id', schoolId).eq('owner_type', owner.ownerType).eq('owner_id', owner.ownerId)
      .order('priority', { ascending: true }),
    supabase.from('users').select('username, email, first_name, last_name, phone')
      .eq('id', userId).maybeSingle(),
  ]);
  if (extRes.error) { res.status(safeDbErrorStatus(extRes.error)).json({ error: safeDbErrorMessage(extRes.error) }); return; }

  const REDACTED = '[hr_officer_required]';
  const row = extRes.data;
  let extendedProfile: Record<string, unknown> | null = null;
  if (row) {
    if (row.redacted_at) {
      extendedProfile = { redacted: true, redactedAt: row.redacted_at, redactedReason: row.redacted_reason };
    } else {
      const decrypted = decryptProfileRow(row, schoolId);
      // Self always sees medium-sensitivity decrypted, never sees high
      // (religion / SSN) — those stay HR-officer-only no matter who asks.
      extendedProfile = {
        placeOfBirth: row.place_of_birth,
        nationality: row.nationality,
        bloodType: row.blood_type,
        languagesSpoken: row.languages_spoken,
        dependentsCount: row.dependents_count,
        bankName: row.bank_name,
        consentPiiAt: row.consent_pii_at,
        updatedAt: row.updated_at,
        motherFullName: decrypted?.motherFullName ?? null,
        fatherFullName: decrypted?.fatherFullName ?? null,
        spouseName: decrypted?.spouseName ?? null,
        bankIban: decrypted?.bankIban ?? null,
        taxId: decrypted?.taxId ?? null,
        religion: row.religion_ct ? REDACTED : null,
        socialInsuranceNo: row.social_insurance_no_ct ? REDACTED : null,
      };
    }
  }

  res.json({
    ownerType: owner.ownerType,
    ownerId: owner.ownerId,
    account: userRes.data ? {
      username: userRes.data.username,
      email: userRes.data.email,
      firstName: userRes.data.first_name,
      lastName: userRes.data.last_name,
      phone: userRes.data.phone,
    } : null,
    extendedProfile,
    emergencyContacts: toCC(ecRes.data ?? []),
  });
}

// ── PUT /me/extended ───────────────────────────────────────────────────────
// Self-service update of low + medium fields. Religion / SSN are silently
// stripped from the input — the employee can't elevate themselves by
// posting those keys.

interface ExtendedInput {
  placeOfBirth?: string | null;
  nationality?: string | null;
  bloodType?: string | null;
  languagesSpoken?: string[] | null;
  dependentsCount?: number | null;
  bankName?: string | null;
  motherFullName?: string;
  fatherFullName?: string;
  spouseName?: string;
  bankIban?: string;
  taxId?: string;
  // religion + socialInsuranceNo intentionally absent from the input
  // contract — even if the client sends them they're filtered out.
}

export async function putMyExtended(req: AuthRequest, res: Response): Promise<void> {
  const owner = await resolveMyOwner(req);
  if ('error' in owner) { res.status(owner.status).json({ error: owner.error }); return; }
  const { schoolId, userId } = req.user!;

  // Whitelist input — explicitly drop religion + socialInsuranceNo.
  const i = (req.body ?? {}) as Record<string, unknown>;
  const input: ExtendedInput = {};
  if (i.placeOfBirth !== undefined) input.placeOfBirth = i.placeOfBirth as string | null;
  if (i.nationality  !== undefined) input.nationality  = i.nationality  as string | null;
  if (i.bloodType    !== undefined) input.bloodType    = i.bloodType    as string | null;
  if (i.languagesSpoken !== undefined) input.languagesSpoken = i.languagesSpoken as string[] | null;
  if (i.dependentsCount !== undefined) input.dependentsCount = (i.dependentsCount === null ? null : Number(i.dependentsCount)) as number | null;
  if (i.bankName     !== undefined) input.bankName     = i.bankName     as string | null;
  if (i.motherFullName !== undefined) input.motherFullName = String(i.motherFullName);
  if (i.fatherFullName !== undefined) input.fatherFullName = String(i.fatherFullName);
  if (i.spouseName     !== undefined) input.spouseName     = String(i.spouseName);
  if (i.bankIban       !== undefined) input.bankIban       = String(i.bankIban);
  if (i.taxId          !== undefined) input.taxId          = String(i.taxId);

  const patch: Record<string, unknown> = {
    school_id: schoolId,
    owner_type: owner.ownerType,
    owner_id: owner.ownerId,
    updated_at: new Date().toISOString(),
  };
  if (input.placeOfBirth     !== undefined) patch.place_of_birth   = (input.placeOfBirth ?? '') || null;
  if (input.nationality      !== undefined) patch.nationality      = (input.nationality ?? '') || null;
  if (input.bloodType        !== undefined) patch.blood_type       = (input.bloodType ?? '') || null;
  if (input.languagesSpoken  !== undefined) patch.languages_spoken = Array.isArray(input.languagesSpoken) ? input.languagesSpoken.filter(Boolean) : null;
  if (input.dependentsCount  !== undefined) patch.dependents_count = input.dependentsCount;
  if (input.bankName         !== undefined) patch.bank_name        = (input.bankName ?? '') || null;
  Object.assign(patch, encryptedProfilePatch(input, schoolId));

  // First-time consent stamp.
  const { data: existing } = await supabase
    .from('employee_extended_profile').select('consent_pii_at')
    .eq('school_id', schoolId).eq('owner_type', owner.ownerType).eq('owner_id', owner.ownerId).maybeSingle();
  const hasEncryptedInput = !!(input.motherFullName || input.fatherFullName || input.spouseName || input.bankIban || input.taxId);
  if (hasEncryptedInput && !existing?.consent_pii_at) {
    patch.consent_pii_at = new Date().toISOString();
    patch.consent_pii_by = userId;
  }

  // tenant-check-allow: patch.school_id sourced from req.user!.schoolId; composite-PK upsert has no .eq() shape.
  const { error } = await supabase
    .from('employee_extended_profile')
    .upsert(patch, { onConflict: 'owner_type,owner_id' });
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  await logAudit({
    req, entityType: 'employee_extended_profile', entityId: owner.ownerId,
    action: 'update',
    after: { _meta: { kind: 'self_update', ownerType: owner.ownerType } },
    label: 'extended_self_update',
  });

  res.json({ ok: true });
}

// ── /me/emergency-contacts CRUD ────────────────────────────────────────────
// Same shape + validation as the admin endpoints, scoped to the caller's
// owner. Employees manage their own emergency-contact list.

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
  if (!Number.isFinite(priority) || priority < 1 || priority > 10) return { ok: false, error: 'Priority must be 1..10' };
  return {
    ok: true, v: {
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

export async function createMyContact(req: AuthRequest, res: Response): Promise<void> {
  const owner = await resolveMyOwner(req);
  if ('error' in owner) { res.status(owner.status).json({ error: owner.error }); return; }
  const { schoolId } = req.user!;
  const r = validateContact(req.body);
  if (!r.ok) { res.status(400).json({ error: r.error }); return; }

  const insertRow = {
    school_id: schoolId,
    owner_type: owner.ownerType,
    owner_id: owner.ownerId,
    full_name: r.v.fullName, relationship: r.v.relationship,
    phone: r.v.phone, alt_phone: r.v.altPhone, email: r.v.email, address: r.v.address,
    priority: r.v.priority,
  };
  // tenant-check-allow: insertRow.school_id sourced from req.user!.schoolId; INSERT has no .eq() shape.
  const { data, error } = await supabase.from('employee_emergency_contacts').insert(insertRow)
    .select('id, full_name, relationship, phone, alt_phone, email, address, priority, created_at').single();
  if (error || !data) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  await logAudit({
    req, entityType: 'employee_emergency_contact', entityId: data.id,
    action: 'create', after: { _meta: { kind: 'self', ownerType: owner.ownerType } },
    label: 'emergency_contact_self_create',
  });
  res.status(201).json({ contact: toCC(data) });
}

export async function updateMyContact(req: AuthRequest, res: Response): Promise<void> {
  const owner = await resolveMyOwner(req);
  if ('error' in owner) { res.status(owner.status).json({ error: owner.error }); return; }
  const { schoolId } = req.user!;
  const id = String(req.params.id);

  // Verify ownership: the contact must belong to this caller's owner.
  const { data: existing } = await supabase
    .from('employee_emergency_contacts')
    .select('id, owner_type, owner_id')
    .eq('id', id).eq('school_id', schoolId).maybeSingle();
  if (!existing) { res.status(404).json({ error: 'Contact not found' }); return; }
  if (existing.owner_type !== owner.ownerType || existing.owner_id !== owner.ownerId) {
    res.status(403).json({ error: 'You can only edit your own contacts' }); return;
  }

  const r = validateContact(req.body);
  if (!r.ok) { res.status(400).json({ error: r.error }); return; }
  const patch = {
    full_name: r.v.fullName, relationship: r.v.relationship,
    phone: r.v.phone, alt_phone: r.v.altPhone, email: r.v.email, address: r.v.address,
    priority: r.v.priority,
  };
  const { data, error } = await supabase
    .from('employee_emergency_contacts').update(patch)
    .eq('id', id).eq('school_id', schoolId)
    .select('id, full_name, relationship, phone, alt_phone, email, address, priority, created_at').single();
  if (error || !data) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  await logAudit({
    req, entityType: 'employee_emergency_contact', entityId: id,
    action: 'update', after: { _meta: { kind: 'self' } },
    label: 'emergency_contact_self_update',
  });
  res.json({ contact: toCC(data) });
}

export async function deleteMyContact(req: AuthRequest, res: Response): Promise<void> {
  const owner = await resolveMyOwner(req);
  if ('error' in owner) { res.status(owner.status).json({ error: owner.error }); return; }
  const { schoolId } = req.user!;
  const id = String(req.params.id);

  const { data: existing } = await supabase
    .from('employee_emergency_contacts')
    .select('id, owner_type, owner_id')
    .eq('id', id).eq('school_id', schoolId).maybeSingle();
  if (!existing) { res.status(404).json({ error: 'Contact not found' }); return; }
  if (existing.owner_type !== owner.ownerType || existing.owner_id !== owner.ownerId) {
    res.status(403).json({ error: 'You can only delete your own contacts' }); return;
  }

  const { error } = await supabase
    .from('employee_emergency_contacts').delete()
    .eq('id', id).eq('school_id', schoolId);
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  await logAudit({
    req, entityType: 'employee_emergency_contact', entityId: id,
    action: 'delete', label: 'emergency_contact_self_delete',
  });
  res.json({ ok: true });
}

// ── /me/acknowledgements (Wave 3) ──────────────────────────────────────────
// Mirrors the admin endpoints in employeeAcknowledgements.controller but
// scoped to the caller's own owner. Lets the employee see required
// policies and sign them without an admin keystroke.

export async function listMyAcknowledgements(req: AuthRequest, res: Response): Promise<void> {
  const owner = await resolveMyOwner(req);
  if ('error' in owner) { res.status(owner.status).json({ error: owner.error }); return; }
  const { schoolId } = req.user!;

  const [policiesRes, acksRes] = await Promise.all([
    supabase.from('school_policies')
      .select('id, policy_key, label, version, is_required, is_active, document_url')
      .eq('school_id', schoolId).eq('is_active', true)
      .order('policy_key', { ascending: true }).order('version', { ascending: false }),
    supabase.from('employee_acknowledgements')
      .select('id, policy_id, policy_key, policy_version, acknowledged_at, signed_document_id')
      .eq('school_id', schoolId).eq('owner_type', owner.ownerType).eq('owner_id', owner.ownerId)
      .order('acknowledged_at', { ascending: false }),
  ]);
  if (policiesRes.error) { res.status(safeDbErrorStatus(policiesRes.error)).json({ error: safeDbErrorMessage(policiesRes.error) }); return; }
  if (acksRes.error) { res.status(safeDbErrorStatus(acksRes.error)).json({ error: safeDbErrorMessage(acksRes.error) }); return; }

  const activeByKey = new Map<string, { id: string; label: string; version: number; isRequired: boolean; documentUrl: string | null }>();
  for (const p of (policiesRes.data ?? [])) {
    if (activeByKey.has(p.policy_key)) continue;
    activeByKey.set(p.policy_key, {
      id: p.id, label: p.label, version: p.version,
      isRequired: p.is_required, documentUrl: p.document_url,
    });
  }
  const latestAckByKey = new Map<string, { id: string; policyVersion: number; acknowledgedAt: string; signedDocumentId: string | null }>();
  for (const a of (acksRes.data ?? [])) {
    if (latestAckByKey.has(a.policy_key)) continue;
    latestAckByKey.set(a.policy_key, {
      id: a.id, policyVersion: a.policy_version,
      acknowledgedAt: a.acknowledged_at, signedDocumentId: a.signed_document_id,
    });
  }

  const items: {
    policyKey: string; label: string;
    activePolicyId: string | null; activeVersion: number | null; documentUrl: string | null;
    isRequired: boolean;
    status: 'unsigned' | 'signed' | 'stale';
    ack: { id: string; policyVersion: number; acknowledgedAt: string; signedDocumentId: string | null } | null;
  }[] = [];

  const seenKeys = new Set<string>();
  for (const [key, p] of activeByKey) {
    const ack = latestAckByKey.get(key) ?? null;
    const status = !ack ? 'unsigned' : ack.policyVersion < p.version ? 'stale' : 'signed';
    items.push({
      policyKey: key, label: p.label,
      activePolicyId: p.id, activeVersion: p.version, documentUrl: p.documentUrl,
      isRequired: p.isRequired, status, ack,
    });
    seenKeys.add(key);
  }
  for (const [key, ack] of latestAckByKey) {
    if (seenKeys.has(key)) continue;
    items.push({
      policyKey: key, label: key,
      activePolicyId: null, activeVersion: null, documentUrl: null,
      isRequired: false, status: 'signed', ack,
    });
  }

  res.json({ items });
}

export async function createMyAcknowledgement(req: AuthRequest, res: Response): Promise<void> {
  const owner = await resolveMyOwner(req);
  if ('error' in owner) { res.status(owner.status).json({ error: owner.error }); return; }
  const { schoolId, userId } = req.user!;

  const policyId = String(req.body?.policyId ?? '').trim();
  if (!policyId) { res.status(400).json({ error: 'policyId is required' }); return; }

  const { data: policy } = await supabase
    .from('school_policies').select('id, policy_key, version, is_active')
    .eq('id', policyId).eq('school_id', schoolId).maybeSingle();
  if (!policy) { res.status(404).json({ error: 'Policy not found' }); return; }
  if (!policy.is_active) { res.status(400).json({ error: 'Policy is not active' }); return; }

  // PENTEST H-3: XFF is attacker-controllable; we record it for the
  // legal-record value, not for security decisions.
  const xff = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  const ip = xff || req.ip || null;
  const ua = String(req.headers['user-agent'] ?? '').slice(0, 500) || null;

  const insertRow = {
    school_id: schoolId,
    owner_type: owner.ownerType, owner_id: owner.ownerId,
    policy_id: policyId, policy_key: policy.policy_key, policy_version: policy.version,
    ip_address: ip, user_agent: ua,
    signed_document_id: null,
    recorded_by: userId,
  };

  // tenant-check-allow: insertRow.school_id sourced from req.user!.schoolId; INSERT has no .eq() shape.
  const { data, error } = await supabase
    .from('employee_acknowledgements').insert(insertRow)
    .select('id, policy_id, policy_key, policy_version, acknowledged_at, signed_document_id')
    .single();
  if (error || !data) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  await logAudit({
    req, entityType: 'employee_acknowledgement', entityId: data.id,
    action: 'create',
    after: {
      _meta: { kind: 'self_sign' },
      policy_key: data.policy_key, policy_version: data.policy_version,
      owner_type: owner.ownerType, owner_id: owner.ownerId,
    },
    label: 'acknowledgement_self_create',
  });

  res.status(201).json({ acknowledgement: toCC(data) });
}
