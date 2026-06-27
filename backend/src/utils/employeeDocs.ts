// Employee-documents helpers shared by the controller, the profile read
// endpoint, and (in Wave 2) the archive rewrite + ClamAV worker.
//
// Centralizes the four things every caller needs to get right:
//   • The role → table map (matches admin.controller's EMPLOYEE_PHOTO_TABLE
//     but is owned here because documents need it on more code paths).
//   • The seed category catalog (sensitivity, label, whether expiry is
//     required). Schools can override / extend via school_document_categories.
//   • Buffer integrity checks — magic-byte sniff against the four allowed
//     MIME types, plus SHA-256 hashing for chain-of-custody.
//   • A single private-bucket constant + the signed-URL convention so
//     nothing in the codebase accidentally swaps in a public URL.

import crypto from 'crypto';
import { adminDb } from './db';
import { loadClearance, clearanceHas } from '../middleware/auth';

// ── Storage ────────────────────────────────────────────────────────────────
// Hard-coded private bucket. The operator creates it once in Supabase Studio
// (see migration 028 prelude). We do NOT read SUPABASE_STORAGE_BUCKET here
// because that env var points at the public homework-attachments bucket
// which would be unsafe for ID scans.
export const EMPLOYEE_DOCS_BUCKET = 'employee-documents';

// Signed-URL TTL in seconds. Short on purpose: long enough for a click-through,
// short enough that a leaked URL pasted into chat goes stale quickly.
export const SIGNED_URL_TTL_SECONDS = 300;

// ── Role → owner_type / table map ──────────────────────────────────────────
// Matches the existing employee photo route's :role enum. The DB stores the
// table name (matches archived_employees.role + employee_documents.owner_type).
export type EmployeeRole =
  | 'teacher' | 'driver' | 'staff'
  | 'supervisor' | 'admin' | 'reception' | 'accountant';

export type OwnerType =
  | 'teachers' | 'drivers' | 'staff_members' | 'users' | 'archived_employees';

export const ROLE_TO_OWNER_TYPE: Record<EmployeeRole, OwnerType> = {
  teacher:    'teachers',
  driver:     'drivers',
  staff:      'staff_members',
  supervisor: 'users',
  admin:      'users',
  reception:  'users',
  accountant: 'users',
};

export const ROLE_VALUES: EmployeeRole[] = [
  'teacher', 'driver', 'staff', 'supervisor', 'admin', 'reception', 'accountant',
];

export function isEmployeeRole(s: unknown): s is EmployeeRole {
  return typeof s === 'string' && (ROLE_VALUES as string[]).includes(s);
}

// ── Allowed MIME types + magic bytes ───────────────────────────────────────
// Strict allowlist. PENTEST_FINDINGS H-2: never trust client-supplied
// Content-Type — sniff the first bytes and reject mismatches.
export type AllowedMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';

export const ALLOWED_MIME_TYPES: AllowedMime[] = [
  'image/jpeg', 'image/png', 'image/webp', 'application/pdf',
];

export const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Sniffs the file's leading bytes and returns the detected MIME, or null
 * if the buffer doesn't look like any of our allowed types. Callers must
 * compare this to the client-claimed type and reject mismatches.
 */
export function sniffMime(buf: Buffer): AllowedMime | null {
  if (!buf || buf.length < 12) return null;

  // JPEG: FF D8 FF
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47 &&
    buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A
  ) return 'image/png';

  // WebP: 'RIFF' .... 'WEBP'
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return 'image/webp';

  // PDF: '%PDF'
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
    return 'application/pdf';
  }

  return null;
}

export function sha256Hex(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// ── Category catalog (seed) ────────────────────────────────────────────────
// Schools can override label / sensitivity or add new categories via the
// school_document_categories table. The backend merges the two when serving
// the picker. Sensitivity drives access control:
//   low    — any staff.manage admin can view
//   medium — any staff.manage admin can view (default)
//   high   — read needs hr.read; create/edit/void needs hr.manage
//
// requiresExpiry flags categories where an expiry date is realistically
// always present (passports, work permits...). The UI marks the field
// required and the expiry-digest cron looks at those. Schools can change
// this per-category if their jurisdiction differs.

export type Sensitivity = 'low' | 'medium' | 'high';

export interface CategoryDef {
  key: string;
  label: string;
  group: string;
  sensitivity: Sensitivity;
  requiresExpiry: boolean;
}

export const DOCUMENT_CATEGORIES: CategoryDef[] = [
  // identity
  { key: 'national_id_front',       label: 'National ID (front)',       group: 'identity',       sensitivity: 'high',   requiresExpiry: false },
  { key: 'national_id_back',        label: 'National ID (back)',        group: 'identity',       sensitivity: 'high',   requiresExpiry: false },
  { key: 'passport',                label: 'Passport',                  group: 'identity',       sensitivity: 'high',   requiresExpiry: true  },
  { key: 'birth_certificate',       label: 'Birth certificate',         group: 'identity',       sensitivity: 'high',   requiresExpiry: false },
  { key: 'family_book',             label: 'Family book',               group: 'identity',       sensitivity: 'high',   requiresExpiry: false },
  // right-to-work
  { key: 'residency_permit',        label: 'Residency permit',          group: 'right_to_work',  sensitivity: 'high',   requiresExpiry: true  },
  { key: 'work_permit',             label: 'Work permit',               group: 'right_to_work',  sensitivity: 'high',   requiresExpiry: true  },
  { key: 'visa',                    label: 'Visa',                      group: 'right_to_work',  sensitivity: 'high',   requiresExpiry: true  },
  { key: 'tax_card',                label: 'Tax card',                  group: 'right_to_work',  sensitivity: 'high',   requiresExpiry: false },
  { key: 'social_insurance_card',   label: 'Social insurance card',     group: 'right_to_work',  sensitivity: 'high',   requiresExpiry: false },
  // driving
  { key: 'drivers_license_front',   label: 'Driver licence (front)',    group: 'driving',        sensitivity: 'medium', requiresExpiry: true  },
  { key: 'drivers_license_back',    label: 'Driver licence (back)',     group: 'driving',        sensitivity: 'medium', requiresExpiry: true  },
  { key: 'vehicle_registration',    label: 'Vehicle registration',      group: 'driving',        sensitivity: 'medium', requiresExpiry: true  },
  // health
  { key: 'medical_fitness',         label: 'Medical fitness certificate', group: 'health',       sensitivity: 'high',   requiresExpiry: true  },
  { key: 'vaccination_record',      label: 'Vaccination record',        group: 'health',         sensitivity: 'high',   requiresExpiry: false },
  { key: 'health_insurance_card',   label: 'Health insurance card',     group: 'health',         sensitivity: 'high',   requiresExpiry: true  },
  // education
  { key: 'degree_certificate',      label: 'Degree certificate',        group: 'education',      sensitivity: 'medium', requiresExpiry: false },
  { key: 'transcript',              label: 'Transcript',                group: 'education',      sensitivity: 'medium', requiresExpiry: false },
  { key: 'teaching_license',        label: 'Teaching licence',          group: 'education',      sensitivity: 'medium', requiresExpiry: true  },
  { key: 'cpd_certificate',         label: 'CPD certificate',           group: 'education',      sensitivity: 'medium', requiresExpiry: false },
  { key: 'language_certificate',    label: 'Language certificate',      group: 'education',      sensitivity: 'medium', requiresExpiry: false },
  // employment
  { key: 'signed_contract',         label: 'Signed contract',           group: 'employment',     sensitivity: 'medium', requiresExpiry: false },
  { key: 'job_description_ack',     label: 'Job description (signed)',  group: 'employment',     sensitivity: 'medium', requiresExpiry: false },
  { key: 'nda',                     label: 'NDA',                       group: 'employment',     sensitivity: 'medium', requiresExpiry: false },
  // background
  { key: 'criminal_record_clearance', label: 'Criminal record clearance', group: 'background',  sensitivity: 'high',   requiresExpiry: true  },
  { key: 'reference_letter',        label: 'Reference letter',          group: 'background',     sensitivity: 'high',   requiresExpiry: false },
  // policies (acknowledgements — file is the signed copy)
  { key: 'code_of_conduct_ack',     label: 'Code of conduct (signed)',  group: 'policies',       sensitivity: 'low',    requiresExpiry: false },
  { key: 'child_protection_ack',    label: 'Child protection (signed)', group: 'policies',       sensitivity: 'low',    requiresExpiry: false },
  { key: 'handbook_ack',            label: 'Handbook (signed)',         group: 'policies',       sensitivity: 'low',    requiresExpiry: false },
  // performance
  { key: 'performance_review',      label: 'Performance review',        group: 'performance',    sensitivity: 'medium', requiresExpiry: false },
  { key: 'disciplinary_letter',     label: 'Disciplinary letter',       group: 'performance',    sensitivity: 'medium', requiresExpiry: false },
  { key: 'commendation',            label: 'Commendation',              group: 'performance',    sensitivity: 'medium', requiresExpiry: false },
  // catch-all
  { key: 'other',                   label: 'Other',                     group: 'other',          sensitivity: 'medium', requiresExpiry: false },
];

const SEED_BY_KEY: Map<string, CategoryDef> =
  new Map(DOCUMENT_CATEGORIES.map(c => [c.key, c]));

export interface ResolvedCategory extends CategoryDef {
  // True if this row came from a school override (vs. the seed).
  override: boolean;
  // True if the seed defines this key but a school override has disabled it.
  // (Front-end hides disabled categories from the picker but keeps them in
  // the read path so existing documents still render.)
  active: boolean;
}

/**
 * Returns the merged catalog for a school: seed categories overlaid with
 * any rows in school_document_categories. Inactive overrides mark the
 * seed category as inactive (excluded from new uploads, kept for reads).
 */
export async function getCategoriesForSchool(schoolId: string): Promise<ResolvedCategory[]> {
  const { data: overrides } = await adminDb
    .from('school_document_categories')
    .select('category, label, sensitivity, requires_expiry, is_active')
    .eq('school_id', schoolId);

  const overrideMap = new Map<string, {
    label: string; sensitivity: Sensitivity; requires_expiry: boolean; is_active: boolean;
  }>(
    (overrides ?? []).map(r => [r.category, {
      label: r.label, sensitivity: r.sensitivity as Sensitivity,
      requires_expiry: r.requires_expiry, is_active: r.is_active,
    }]),
  );

  const out: ResolvedCategory[] = [];

  for (const seed of DOCUMENT_CATEGORIES) {
    const o = overrideMap.get(seed.key);
    if (o) {
      out.push({
        key: seed.key,
        label: o.label,
        group: seed.group,
        sensitivity: o.sensitivity,
        requiresExpiry: o.requires_expiry,
        override: true,
        active: o.is_active,
      });
      overrideMap.delete(seed.key);
    } else {
      out.push({ ...seed, override: false, active: true });
    }
  }

  // Remaining overrides are school-specific additions.
  for (const [key, o] of overrideMap) {
    out.push({
      key, label: o.label, group: 'school_custom',
      sensitivity: o.sensitivity, requiresExpiry: o.requires_expiry,
      override: true, active: o.is_active,
    });
  }

  return out;
}

/**
 * Looks up a single category. Tries the school override first, then the
 * seed. Returns null if neither has it — the controller treats that as
 * a 400 'Unknown category'.
 */
export async function resolveCategory(
  schoolId: string,
  key: string,
): Promise<ResolvedCategory | null> {
  const { data: override } = await adminDb
    .from('school_document_categories')
    .select('category, label, sensitivity, requires_expiry, is_active')
    .eq('school_id', schoolId).eq('category', key)
    .maybeSingle();

  if (override) {
    const seed = SEED_BY_KEY.get(key);
    return {
      key,
      label: override.label,
      group: seed?.group ?? 'school_custom',
      sensitivity: override.sensitivity as Sensitivity,
      requiresExpiry: override.requires_expiry,
      override: true,
      active: override.is_active,
    };
  }

  const seed = SEED_BY_KEY.get(key);
  if (!seed) return null;
  return { ...seed, override: false, active: true };
}

// ── Access control (Phase B — capability-based) ─────────────────────────────
// The route gate (authorizeCapability('staff.manage')) already established the
// caller can manage staff. High-sensitivity PII / documents need an HR
// capability on top:
//   * READ  high (decrypt religion/SSN, download a high-sensitivity scan)
//           → hr.read  (or hr.manage, or Owner — all hold read access)
//   * WRITE high (upload / edit / void a high-sensitivity doc, write high PII,
//           redact) → hr.manage (or Owner)
// Clearance is loaded fresh from the DB each call (not the JWT), so a grant /
// revoke in the clearance panel takes effect on the next request — same
// philosophy as the old is_hr_officer flag this replaces.

export async function canReadHrSensitive(userId: string): Promise<boolean> {
  const c = await loadClearance(userId);
  return clearanceHas(c, 'hr.read') || clearanceHas(c, 'hr.manage');
}

export async function canManageHr(userId: string): Promise<boolean> {
  const c = await loadClearance(userId);
  return clearanceHas(c, 'hr.manage');
}

// Read gate keyed by a row's sensitivity. Low/medium are visible to any
// staff.manage admin; high needs hr.read.
export async function canReadSensitivity(
  userId: string,
  sensitivity: Sensitivity,
): Promise<boolean> {
  if (sensitivity !== 'high') return true;
  return canReadHrSensitive(userId);
}

// Write gate keyed by a row's sensitivity. Mutating a high-sensitivity
// document (upload / edit / void) needs hr.manage; low/medium is operational.
export async function canWriteSensitivity(
  userId: string,
  sensitivity: Sensitivity,
): Promise<boolean> {
  if (sensitivity !== 'high') return true;
  return canManageHr(userId);
}

// ── Owner existence check ──────────────────────────────────────────────────
// Before writing a row, verify the (owner_type, owner_id, school_id) tuple
// actually points at a real employee in this school. Without this we'd let
// an admin upload documents against a randomly-typed UUID, which would
// orphan files.

export async function verifyOwnerExists(
  ownerType: OwnerType,
  ownerId: string,
  schoolId: string,
): Promise<boolean> {
  const { data } = await adminDb
    .from(ownerType).select('id').eq('id', ownerId).eq('school_id', schoolId).maybeSingle();
  return !!data;
}

// ── Filename sanitization ──────────────────────────────────────────────────
// Reused for the human-facing `filename` column. Storage paths go through
// safeExt() (from utils/upload.ts) separately.
/* eslint-disable no-control-regex */
const CONTROL_CHARS = /[\x00-\x1F\x7F]/g;

export function safeFilename(name: string | null | undefined, fallback: string): string {
  return (name || fallback)
    .replace(CONTROL_CHARS, '')                  // strip control chars / null
    .replace(/[\\/]/g, '_')                      // strip path separators
    .replace(/[^a-zA-Z0-9._\- ]/g, '_')          // collapse rest to underscore
    .replace(/_{2,}/g, '_')
    .slice(0, 200)
    .trim() || fallback;
}
/* eslint-enable no-control-regex */
