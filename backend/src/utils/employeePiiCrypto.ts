// Field-level encryption for Wave 2 sensitive PII (mother's name, religion,
// bank IBAN, tax ID, social insurance number). AES-256-GCM with a key
// derived from EMPLOYEE_PII_KEY via HKDF-SHA256. Same primitives as the
// master portal's MFA secret encryption.
//
// Wire format of an encrypted column:
//
//   v1:<base64url(iv)>:<base64url(ciphertext + 16-byte auth tag)>
//
// • The `v1` prefix is a version tag so a future key rotation can ship
//   `v2:` rows alongside `v1:` rows; decryption picks the right branch.
// • IV is a fresh 12 random bytes per encrypt call.
// • Ciphertext+tag is GCM's concatenated output (Node's cipher.getAuthTag
//   returns the tag separately; we append it for storage).
//
// Lookup hash (separate column, e.g. bank_iban_lookup_hash):
//
//   sha256( per_school_salt || normalized_value )
//
// • per_school_salt = HKDF(EMPLOYEE_PII_KEY, info = "pii-lookup-salt:<schoolId>")
// • normalized_value = trim + lowercase (so 'AB123' and ' ab123 ' collide).
// • Output is hex. The hash is one-way — search by hash, not by plaintext.

import crypto from 'crypto';

const VERSION = 'v1';
const ALGO = 'aes-256-gcm';
const KEY_BYTES = 32;       // AES-256
const IV_BYTES = 12;        // GCM standard
const TAG_BYTES = 16;       // GCM standard
const HKDF_HASH = 'sha256';

// HKDF salt — fixed across the deployment. Not a secret; the key is the
// secret. Mixing the schoolId into the `info` parameter gives each tenant
// a different derived key for the same source key, so a compromise of one
// school's data doesn't pivot to others without also leaking the master.
const HKDF_SALT = Buffer.from('scholify-employee-pii-v1', 'utf8');

let cachedMaster: Buffer | null = null;
function getMasterKey(): Buffer {
  if (cachedMaster) return cachedMaster;
  const raw = process.env.EMPLOYEE_PII_KEY;
  if (!raw || raw.length < 32) {
    throw new Error(
      'EMPLOYEE_PII_KEY env var is missing or shorter than 32 chars. ' +
      'Generate one with `openssl rand -base64 48` and set it in the backend env.',
    );
  }
  cachedMaster = Buffer.from(raw, 'utf8');
  return cachedMaster;
}

function deriveKey(info: string): Buffer {
  const okm = crypto.hkdfSync(HKDF_HASH, getMasterKey(), HKDF_SALT, Buffer.from(info, 'utf8'), KEY_BYTES);
  // hkdfSync returns ArrayBuffer in older typings — coerce.
  return Buffer.from(okm);
}

function schoolEncryptKey(schoolId: string): Buffer {
  return deriveKey(`pii-enc:${schoolId}`);
}

function schoolLookupSalt(schoolId: string): Buffer {
  return deriveKey(`pii-lookup-salt:${schoolId}`);
}

// ── encrypt / decrypt ──────────────────────────────────────────────────────

/**
 * Encrypts a string for storage in a sensitive column. Returns the wire
 * format `v1:<iv>:<ct+tag>`. Plaintext of '' or null returns null (i.e.
 * empty string clears the column).
 */
export function encryptPii(value: string | null | undefined, schoolId: string): string | null {
  if (value == null) return null;
  const trimmed = String(value);
  if (trimmed === '') return null;

  const key = schoolEncryptKey(schoolId);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(trimmed, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const combined = Buffer.concat([ct, tag]);
  return `${VERSION}:${iv.toString('base64url')}:${combined.toString('base64url')}`;
}

/**
 * Decrypts a stored ciphertext back to plaintext. Returns null for null
 * input, throws for malformed input or auth-tag mismatch (treat as
 * tampering — the controller should 500 rather than continue silently).
 */
export function decryptPii(stored: string | null | undefined, schoolId: string): string | null {
  if (stored == null) return null;
  const s = String(stored);
  if (s === '') return null;
  const parts = s.split(':');
  if (parts.length !== 3) throw new Error('Malformed encrypted value');
  const [version, ivB64, ctB64] = parts;
  if (version !== VERSION) throw new Error(`Unsupported PII version: ${version}`);

  const iv = Buffer.from(ivB64, 'base64url');
  const combined = Buffer.from(ctB64, 'base64url');
  if (iv.length !== IV_BYTES) throw new Error('Bad IV length');
  if (combined.length < TAG_BYTES) throw new Error('Bad ciphertext length');
  const ct = combined.subarray(0, combined.length - TAG_BYTES);
  const tag = combined.subarray(combined.length - TAG_BYTES);

  const key = schoolEncryptKey(schoolId);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

// ── lookup hash ────────────────────────────────────────────────────────────

/**
 * Returns a deterministic lookup hash for a sensitive value, scoped to a
 * school. Use to search by sensitive values without storing or transmitting
 * plaintext. Normalisation: trim + lowercase (so case / whitespace
 * variations collide on the same row).
 */
export function lookupHash(value: string | null | undefined, schoolId: string): string | null {
  if (value == null) return null;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === '') return null;
  const salt = schoolLookupSalt(schoolId);
  return crypto.createHash('sha256').update(salt).update(normalized, 'utf8').digest('hex');
}

// ── high-level field set ───────────────────────────────────────────────────
// The five encrypted fields on employee_extended_profile + the three
// lookup-hash columns. Backend write paths use these helpers so the
// crypto contract is single-sourced.

export interface EncryptedProfileInput {
  motherFullName?: string | null;
  fatherFullName?: string | null;
  spouseName?: string | null;
  religion?: string | null;
  bankIban?: string | null;
  taxId?: string | null;
  socialInsuranceNo?: string | null;
}

export interface EncryptedProfileColumns {
  mother_full_name_ct: string | null;
  father_full_name_ct: string | null;
  spouse_name_ct: string | null;
  religion_ct: string | null;
  bank_iban_ct: string | null;
  tax_id_ct: string | null;
  social_insurance_no_ct: string | null;
  bank_iban_lookup_hash: string | null;
  tax_id_lookup_hash: string | null;
  social_insurance_lookup_hash: string | null;
}

/**
 * Builds the DB column patch for the encrypted set. Only fields PRESENT
 * on input land in the patch — undefined keys are skipped (so partial
 * updates don't clobber unrelated columns).
 */
export function encryptedProfilePatch(input: EncryptedProfileInput, schoolId: string): Partial<EncryptedProfileColumns> {
  const out: Partial<EncryptedProfileColumns> = {};
  if (input.motherFullName !== undefined) out.mother_full_name_ct = encryptPii(input.motherFullName, schoolId);
  if (input.fatherFullName !== undefined) out.father_full_name_ct = encryptPii(input.fatherFullName, schoolId);
  if (input.spouseName    !== undefined) out.spouse_name_ct       = encryptPii(input.spouseName, schoolId);
  if (input.religion      !== undefined) out.religion_ct          = encryptPii(input.religion, schoolId);
  if (input.bankIban !== undefined) {
    out.bank_iban_ct = encryptPii(input.bankIban, schoolId);
    out.bank_iban_lookup_hash = lookupHash(input.bankIban, schoolId);
  }
  if (input.taxId !== undefined) {
    out.tax_id_ct = encryptPii(input.taxId, schoolId);
    out.tax_id_lookup_hash = lookupHash(input.taxId, schoolId);
  }
  if (input.socialInsuranceNo !== undefined) {
    out.social_insurance_no_ct = encryptPii(input.socialInsuranceNo, schoolId);
    out.social_insurance_lookup_hash = lookupHash(input.socialInsuranceNo, schoolId);
  }
  return out;
}

/**
 * Decrypts every encrypted column on a row back to a flat plaintext object.
 * Errors on any one field bubble up — partial decrypts are not allowed
 * (a tampered field means the whole row is suspect).
 */
export function decryptProfileRow(
  row: Record<string, unknown> | null,
  schoolId: string,
): Record<string, string | null> | null {
  if (!row) return null;
  return {
    motherFullName: decryptPii(row.mother_full_name_ct as string | null, schoolId),
    fatherFullName: decryptPii(row.father_full_name_ct as string | null, schoolId),
    spouseName: decryptPii(row.spouse_name_ct as string | null, schoolId),
    religion: decryptPii(row.religion_ct as string | null, schoolId),
    bankIban: decryptPii(row.bank_iban_ct as string | null, schoolId),
    taxId: decryptPii(row.tax_id_ct as string | null, schoolId),
    socialInsuranceNo: decryptPii(row.social_insurance_no_ct as string | null, schoolId),
  };
}
