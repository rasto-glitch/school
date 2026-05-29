// Field-level encryption for Wave 2 sensitive PII (mother's name, religion,
// bank IBAN, tax ID, social insurance number). AES-256-GCM with a key
// derived from EMPLOYEE_PII_KEY via HKDF-SHA256. Same primitives as the
// master portal's MFA secret encryption.
//
// Wire format of an encrypted column:
//
//   v<N>:<base64url(iv)>:<base64url(ciphertext + 16-byte auth tag)>
//
// • The `vN` prefix tags the master-key version. New writes always use
//   the highest version available; reads dispatch by the row's tag, so
//   v1 and v2 rows coexist during a rotation.
// • IV is a fresh 12 random bytes per encrypt call.
// • Ciphertext+tag is GCM's concatenated output (Node's cipher.getAuthTag
//   returns the tag separately; we append it for storage).
//
// Key rotation (Wave 3):
//   1. Generate a new key (openssl rand -base64 48). Set EMPLOYEE_PII_KEY_V2
//      alongside the existing EMPLOYEE_PII_KEY. Deploy. From here, new
//      writes are v2; old v1 rows still decrypt cleanly.
//   2. Run `npm run rotate-pii -w api` to re-encrypt every v1 row in
//      employee_extended_profile under v2.
//   3. Remove EMPLOYEE_PII_KEY (the old v1 secret) once no v1 rows remain.
//   4. Repeat with V3 / V4 / ... whenever you need to rotate again.
//
// Lookup hash (separate column, e.g. bank_iban_lookup_hash):
//
//   sha256( per_school_salt || normalized_value )
//
// • per_school_salt = HKDF(EMPLOYEE_PII_KEY, info = "pii-lookup-salt:<schoolId>")
// • normalized_value = trim + lowercase (so 'AB123' and ' ab123 ' collide).
// • Output is hex. The hash is one-way — search by hash, not by plaintext.
// • Lookup hashes are NOT bumped by key rotation — they use whichever
//   key existed when the row was last written. Re-encryption updates them
//   to the current key's salt so equality search keeps working.

import crypto from 'crypto';

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

// ── Master-key registry ────────────────────────────────────────────────────
// Versions live in env vars `EMPLOYEE_PII_KEY` (= v1, the legacy name) and
// `EMPLOYEE_PII_KEY_V<N>` for N ≥ 2. Writes use the highest version
// present; reads dispatch by wire-format version.

interface MasterKey { version: number; bytes: Buffer; }
let cachedKeys: MasterKey[] | null = null;
let cachedCurrent: MasterKey | null = null;

function loadKeys(): MasterKey[] {
  if (cachedKeys) return cachedKeys;
  const out: MasterKey[] = [];

  const v1 = process.env.EMPLOYEE_PII_KEY;
  if (v1 && v1.length >= 32) out.push({ version: 1, bytes: Buffer.from(v1, 'utf8') });

  for (let n = 2; n <= 32; n++) {
    const raw = process.env[`EMPLOYEE_PII_KEY_V${n}`];
    if (raw && raw.length >= 32) out.push({ version: n, bytes: Buffer.from(raw, 'utf8') });
  }

  if (out.length === 0) {
    throw new Error(
      'No EMPLOYEE_PII_KEY env var set, or it is shorter than 32 chars. ' +
      'Generate one with `openssl rand -base64 48` and set it in the backend env.',
    );
  }

  // Sort ascending so the last entry is current.
  out.sort((a, b) => a.version - b.version);
  cachedKeys = out;
  cachedCurrent = out[out.length - 1];
  return out;
}

function getKeyForVersion(version: number): Buffer {
  const k = loadKeys().find(k => k.version === version);
  if (!k) throw new Error(`Unknown PII key version: v${version}. Set EMPLOYEE_PII_KEY${version === 1 ? '' : `_V${version}`}.`);
  return k.bytes;
}

function currentKey(): MasterKey {
  loadKeys();
  return cachedCurrent!;
}

/** Test-only: clears the cached master keys so a new env var takes effect. */
export function _resetPiiKeyCacheForTests(): void {
  cachedKeys = null;
  cachedCurrent = null;
}

/** Read-only: which master-key version is the current encrypt target. */
export function currentPiiKeyVersion(): number {
  return currentKey().version;
}

function deriveKey(version: number, info: string): Buffer {
  const okm = crypto.hkdfSync(HKDF_HASH, getKeyForVersion(version), HKDF_SALT, Buffer.from(info, 'utf8'), KEY_BYTES);
  return Buffer.from(okm);
}

function schoolEncryptKey(schoolId: string, version: number): Buffer {
  return deriveKey(version, `pii-enc:${schoolId}`);
}

function schoolLookupSalt(schoolId: string): Buffer {
  // Lookup salt always uses the current key version. Re-encryption updates
  // the lookup hash alongside the ciphertext so equality search stays
  // correct after a rotation.
  return deriveKey(currentKey().version, `pii-lookup-salt:${schoolId}`);
}

// ── encrypt / decrypt ──────────────────────────────────────────────────────

/**
 * Encrypts a string for storage in a sensitive column. Returns the wire
 * format `vN:<iv>:<ct+tag>` where N is the current master-key version.
 * Plaintext of '' or null returns null (i.e. empty string clears the column).
 */
export function encryptPii(value: string | null | undefined, schoolId: string): string | null {
  if (value == null) return null;
  const trimmed = String(value);
  if (trimmed === '') return null;

  const ver = currentKey().version;
  const key = schoolEncryptKey(schoolId, ver);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(trimmed, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const combined = Buffer.concat([ct, tag]);
  return `v${ver}:${iv.toString('base64url')}:${combined.toString('base64url')}`;
}

/**
 * Returns the master-key version embedded in a stored ciphertext, or null
 * for null / empty / malformed input. Used by the rotation script to find
 * rows still on an old key.
 */
export function piiVersionOf(stored: string | null | undefined): number | null {
  if (stored == null) return null;
  const s = String(stored);
  if (s === '') return null;
  const m = /^v(\d+):/.exec(s);
  return m ? Number(m[1]) : null;
}

/**
 * Decrypts a stored ciphertext back to plaintext. Returns null for null
 * input, throws for malformed input or auth-tag mismatch (treat as
 * tampering — the controller should 500 rather than continue silently).
 * Dispatches by the wire-format version, so v1 + v2 rows coexist during
 * a rotation as long as both env vars are still set.
 */
export function decryptPii(stored: string | null | undefined, schoolId: string): string | null {
  if (stored == null) return null;
  const s = String(stored);
  if (s === '') return null;
  const parts = s.split(':');
  if (parts.length !== 3) throw new Error('Malformed encrypted value');
  const [vTag, ivB64, ctB64] = parts;
  const verMatch = /^v(\d+)$/.exec(vTag);
  if (!verMatch) throw new Error(`Unsupported PII version: ${vTag}`);
  const version = Number(verMatch[1]);

  const iv = Buffer.from(ivB64, 'base64url');
  const combined = Buffer.from(ctB64, 'base64url');
  if (iv.length !== IV_BYTES) throw new Error('Bad IV length');
  if (combined.length < TAG_BYTES) throw new Error('Bad ciphertext length');
  const ct = combined.subarray(0, combined.length - TAG_BYTES);
  const tag = combined.subarray(combined.length - TAG_BYTES);

  const key = schoolEncryptKey(schoolId, version);
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
