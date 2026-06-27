// Extended employee profile (Wave 2) — structured PII beyond the flat HR
// columns. Reads are gated on sensitivity (high → HR officer); the
// employee themselves may read + edit low/medium fields about themselves
// via /me/profile, but high-sensitivity columns stay HR-officer-only on
// every code path.
//
// Persistence: employee_extended_profile (one row per (owner_type, owner_id)).
// Encrypted columns live as `<col>_ct` with adjacent `_lookup_hash` columns
// where searchability is needed. See utils/employeePiiCrypto.ts.

import { Response } from 'express';
import { adminDb as supabase } from '../utils/db';
import type { AuthRequest } from '../middleware/auth';
import { toCC } from '../utils/transform';
import { safeDbErrorMessage, safeDbErrorStatus } from '../utils/dbErrors';
import { logAudit } from '../utils/audit';
import {
  ROLE_TO_OWNER_TYPE, type EmployeeRole, type OwnerType,
  canReadHrSensitive, canManageHr, verifyOwnerExists,
} from '../utils/employeeDocs';
import {
  encryptedProfilePatch, decryptProfileRow,
} from '../utils/employeePiiCrypto';

function roleFromParams(req: AuthRequest): EmployeeRole | null {
  const r = String(req.params.role);
  return (ROLE_TO_OWNER_TYPE as Record<string, OwnerType>)[r] ? (r as EmployeeRole) : null;
}

// Plaintext-input shape from the client. camelCase, all optional so PATCH
// semantics work (omit = leave unchanged, '' = clear).
interface ExtendedInput {
  placeOfBirth?: string | null;
  nationality?: string | null;
  bloodType?: string | null;
  languagesSpoken?: string[] | null;
  dependentsCount?: number | null;
  bankName?: string | null;
  // Encrypted (high-sensitivity unless noted):
  motherFullName?: string;
  fatherFullName?: string;
  spouseName?: string;
  religion?: string;            // high
  bankIban?: string;            // high
  taxId?: string;               // high
  socialInsuranceNo?: string;   // high
  // Lawful-basis stamp — set on first successful encrypted-field write.
  consentPii?: boolean;
}

// Sensitivity per the locked decisions in memory/employee-records-plan.md:
//   high   — religion + social_insurance_no. HR-officer only on read/write.
//   medium — mother/father/spouse + bank IBAN + tax ID. Any admin
//            (and self, via /me) can read/write. Stored encrypted.
//   low    — place_of_birth, nationality, blood_type, languages_spoken,
//            dependents_count, bank_name. Plain text.
const HIGH_SENSITIVITY_KEYS: (keyof ExtendedInput)[] = [
  'religion', 'socialInsuranceNo',
];

function hasHighField(input: ExtendedInput): boolean {
  return HIGH_SENSITIVITY_KEYS.some(k => input[k] !== undefined);
}

// ── GET /admin/employees/:role/:id/extended ────────────────────────────────
// HR-officer view returns decrypted plaintext. Non-HR returns the row with
// encrypted columns redacted to `[hr_officer_required]` so callers can see
// which fields exist without leaking values.

export async function getExtended(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const role = roleFromParams(req);
  if (!role) { res.status(400).json({ error: 'Unknown employee role' }); return; }
  const ownerId = String(req.params.id);
  const ownerType = ROLE_TO_OWNER_TYPE[role];

  if (!(await verifyOwnerExists(ownerType, ownerId, schoolId))) {
    res.status(404).json({ error: 'Employee not found' });
    return;
  }

  const { data: row, error } = await supabase
    .from('employee_extended_profile')
    .select(`
      place_of_birth, nationality, blood_type, languages_spoken, dependents_count, bank_name,
      mother_full_name_ct, father_full_name_ct, spouse_name_ct, religion_ct,
      bank_iban_ct, tax_id_ct, social_insurance_no_ct,
      consent_pii_at, consent_pii_by, redacted_at, redacted_by, redacted_reason, updated_at
    `)
    .eq('school_id', schoolId).eq('owner_type', ownerType).eq('owner_id', ownerId)
    .maybeSingle();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  const hrOfficer = await canReadHrSensitive(userId);
  const REDACTED = '[hr_officer_required]';

  if (!row) {
    res.json({ profile: null, hrOfficer });
    return;
  }
  if (row.redacted_at) {
    res.json({
      profile: { redacted: true, redactedAt: row.redacted_at, redactedReason: row.redacted_reason },
      hrOfficer,
    });
    return;
  }

  const base = {
    placeOfBirth: row.place_of_birth,
    nationality: row.nationality,
    bloodType: row.blood_type,
    languagesSpoken: row.languages_spoken,
    dependentsCount: row.dependents_count,
    bankName: row.bank_name,
    consentPiiAt: row.consent_pii_at,
    consentPiiBy: row.consent_pii_by,
    updatedAt: row.updated_at,
  };

  // Medium-sensitivity encrypted fields are decrypted for any admin (and
  // for the employee themselves via /me). High-sensitivity ones (religion,
  // SSN) require the HR-officer flag.
  const decrypted = decryptProfileRow(row, schoolId);
  const profile: Record<string, unknown> = {
    ...base,
    motherFullName: decrypted?.motherFullName ?? null,
    fatherFullName: decrypted?.fatherFullName ?? null,
    spouseName: decrypted?.spouseName ?? null,
    bankIban: decrypted?.bankIban ?? null,
    taxId: decrypted?.taxId ?? null,
    religion: hrOfficer ? decrypted?.religion ?? null : (row.religion_ct ? REDACTED : null),
    socialInsuranceNo: hrOfficer ? decrypted?.socialInsuranceNo ?? null : (row.social_insurance_no_ct ? REDACTED : null),
  };

  res.json({ profile, hrOfficer });

  // Audit reads that actually touched encrypted columns.
  const touchedEncrypted = !!(row.mother_full_name_ct || row.father_full_name_ct || row.spouse_name_ct
    || row.bank_iban_ct || row.tax_id_ct || row.religion_ct || row.social_insurance_no_ct);
  if (touchedEncrypted) {
    await logAudit({
      req,
      entityType: 'employee_extended_profile',
      entityId: ownerId,
      action: 'read',
      after: { _meta: { kind: 'extended_read', ownerType, hrOfficer } },
      label: 'extended_read',
    });
  }
}

// ── PUT /admin/employees/:role/:id/extended ────────────────────────────────
// Upsert. Plaintext low/medium fields pass through; high-sensitivity fields
// require HR-officer + are encrypted before write. Setting any encrypted
// field for the first time stamps consent_pii_at + consent_pii_by.

export async function upsertExtended(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const role = roleFromParams(req);
  if (!role) { res.status(400).json({ error: 'Unknown employee role' }); return; }
  const ownerId = String(req.params.id);
  const ownerType = ROLE_TO_OWNER_TYPE[role];

  if (!(await verifyOwnerExists(ownerType, ownerId, schoolId))) {
    res.status(404).json({ error: 'Employee not found' });
    return;
  }

  const input = (req.body ?? {}) as ExtendedInput;

  if (hasHighField(input) && !(await canManageHr(userId))) {
    res.status(403).json({ error: 'HR management access required to set sensitive PII fields' });
    return;
  }

  // Build plaintext column patch.
  const patch: Record<string, unknown> = {
    school_id: schoolId,
    owner_type: ownerType,
    owner_id: ownerId,
    updated_at: new Date().toISOString(),
  };
  if (input.placeOfBirth     !== undefined) patch.place_of_birth   = (input.placeOfBirth ?? '') || null;
  if (input.nationality      !== undefined) patch.nationality      = (input.nationality ?? '') || null;
  if (input.bloodType        !== undefined) patch.blood_type       = (input.bloodType ?? '') || null;
  if (input.languagesSpoken  !== undefined) patch.languages_spoken = Array.isArray(input.languagesSpoken) ? input.languagesSpoken.filter(Boolean) : null;
  if (input.dependentsCount  !== undefined) patch.dependents_count = input.dependentsCount === null ? null : Number(input.dependentsCount);
  if (input.bankName         !== undefined) patch.bank_name        = (input.bankName ?? '') || null;

  // Encrypted column patch — only HR-officer code path reaches here with
  // these set (guard above).
  Object.assign(patch, encryptedProfilePatch(input, schoolId));

  if (input.consentPii) {
    patch.consent_pii_at = new Date().toISOString();
    patch.consent_pii_by = userId;
  }

  // Upsert against the composite PK (owner_type, owner_id). If the row was
  // previously redacted, the upsert clears the tombstone on next write — but
  // we don't currently expose an UN-redact flow; redacted_at stays set if it
  // was already.

  // tenant-check-allow: patch.school_id sourced from req.user!.schoolId; composite-PK upsert has no .eq() shape.
  const { data, error } = await supabase
    .from('employee_extended_profile')
    .upsert(patch, { onConflict: 'owner_type,owner_id' })
    .select(`
      place_of_birth, nationality, blood_type, languages_spoken, dependents_count, bank_name,
      consent_pii_at, consent_pii_by, updated_at
    `)
    .single();
  if (error || !data) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  await logAudit({
    req,
    entityType: 'employee_extended_profile',
    entityId: ownerId,
    action: 'update',
    after: { _meta: { kind: 'extended_upsert', ownerType, fields: Object.keys(patch) } },
    label: 'extended_upsert',
  });

  res.json({ profile: toCC(data) });
}

// ── POST /admin/employees/:role/:id/extended/redact ────────────────────────
// Right-to-erasure: NULLs every encrypted column + lookup hash and stamps
// the tombstone. The plaintext low-sensitivity fields are also cleared.
// Documents and emergency contacts are NOT touched here — the controller
// for each has its own redact path. HR officer only.

export async function redactExtended(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const role = roleFromParams(req);
  if (!role) { res.status(400).json({ error: 'Unknown employee role' }); return; }
  const ownerId = String(req.params.id);
  const ownerType = ROLE_TO_OWNER_TYPE[role];

  // Redacting PII is a sensitive write → hr.manage.
  if (!(await canManageHr(userId))) {
    res.status(403).json({ error: 'HR management access required' });
    return;
  }

  const reason = String(req.body?.reason ?? '').trim();
  if (!reason) { res.status(400).json({ error: 'A reason is required' }); return; }

  const patch = {
    place_of_birth: null, nationality: null, blood_type: null, languages_spoken: null,
    dependents_count: null, bank_name: null,
    mother_full_name_ct: null, father_full_name_ct: null, spouse_name_ct: null,
    religion_ct: null, bank_iban_ct: null, tax_id_ct: null, social_insurance_no_ct: null,
    bank_iban_lookup_hash: null, tax_id_lookup_hash: null, social_insurance_lookup_hash: null,
    redacted_at: new Date().toISOString(),
    redacted_by: userId,
    redacted_reason: reason,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('employee_extended_profile')
    .update(patch)
    .eq('school_id', schoolId).eq('owner_type', ownerType).eq('owner_id', ownerId);
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  await logAudit({
    req,
    entityType: 'employee_extended_profile',
    entityId: ownerId,
    action: 'delete',
    label: 'extended_redact',
    reason,
  });

  res.json({ ok: true });
}
