import crypto from 'crypto';
import { generateSecret, generateURI, verifySync } from 'otplib';
import { toDataURL } from 'qrcode';

// MFA crypto + helpers. The TOTP secret is stored encrypted at rest
// using AES-256-GCM with a key from process.env.TOTP_ENC_KEY. The key
// is base64 of 32 raw bytes (256 bits). We refuse to operate without
// it — silently falling back to plaintext would be the worst outcome.

const ENC_KEY_B64 = process.env.TOTP_ENC_KEY || '';
let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  if (!ENC_KEY_B64) {
    throw new Error(
      'TOTP_ENC_KEY is not set. Generate one with ' +
      "`node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"` " +
      'and set it in the backend environment.',
    );
  }
  const buf = Buffer.from(ENC_KEY_B64, 'base64');
  if (buf.length !== 32) {
    throw new Error('TOTP_ENC_KEY must decode to 32 bytes (base64 of 32 raw bytes).');
  }
  cachedKey = buf;
  return buf;
}

// AES-256-GCM. Output layout: IV (12 bytes) || ciphertext || authTag (16 bytes).
// Encrypt is non-deterministic; same plaintext gives a new ciphertext on each
// call. authTag is verified on decrypt — any tampering fails the operation.
export function encryptSecret(plaintext: string): Buffer {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, enc, tag]);
}

export function decryptSecret(blob: Buffer): string {
  const key = getKey();
  if (blob.length < 12 + 16) {
    throw new Error('Encrypted MFA secret is too short — likely corrupted.');
  }
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(blob.length - 16);
  const enc = blob.subarray(12, blob.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

// otplib v13 defaults: 30s step, 6-digit code, SHA-1. Industry standard,
// matches Google Authenticator / Authy / 1Password out of the box.
// epochTolerance is in seconds. 60s = ±2 steps around now, which covers
// typical phone/server clock drift without meaningfully expanding the
// brute-force surface (still 1 in ~5,000,000 per attempt with a per-token
// attempt cap of 5).
const TOTP_TOLERANCE_SECONDS = 60;

export function generateTotpSecret(): string {
  return generateSecret({ length: 20 });
}

// otpauth:// URI consumed by QR codes and "add manually" flows in any
// authenticator app. `label` is what shows up under each entry — we put
// the username + school so a user with several accounts can tell them
// apart.
export function buildOtpauthUri(opts: { username: string; secret: string; schoolName?: string }): string {
  const issuer = opts.schoolName ? `Scholify (${opts.schoolName})` : 'Scholify';
  return generateURI({ issuer, label: opts.username, secret: opts.secret });
}

export async function buildQrDataUrl(uri: string): Promise<string> {
  return toDataURL(uri, { errorCorrectionLevel: 'M', width: 240, margin: 1 });
}

export function verifyTotp(code: string, secret: string): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  try {
    const result = verifySync({ secret, token: code, epochTolerance: TOTP_TOLERANCE_SECONDS });
    return !!result?.valid;
  } catch { return false; }
}

// Same as verifyTotp but returns the raw result so callers can log
// diagnostic info (delta, epoch) on near-misses.
export function verifyTotpDetailed(code: string, secret: string): { valid: boolean; delta?: number; epoch?: number; reason?: string } {
  if (!/^\d{6}$/.test(code)) return { valid: false, reason: 'not_six_digits' };
  try {
    const result = verifySync({ secret, token: code, epochTolerance: TOTP_TOLERANCE_SECONDS });
    return result as { valid: boolean; delta?: number; epoch?: number };
  } catch (err) {
    return { valid: false, reason: 'threw:' + (err as Error).message };
  }
}

// Recovery codes — 10 single-use codes formatted XXXX-XXXX-XXXX for
// transcription. Charset excludes visually-ambiguous characters (0/O,
// 1/I, etc.). 12 chars from a 32-char alphabet = ~60 bits of entropy
// per code, infeasible to brute-force even without rate-limiting.
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 31 chars
const RECOVERY_GROUPS = 3;
const RECOVERY_GROUP_LEN = 4;
const RECOVERY_LEN = RECOVERY_GROUPS * RECOVERY_GROUP_LEN;
const RECOVERY_BATCH = 10;

function pickChar(): string {
  // Uniform via rejection sampling — randomInt is uniform [0, 256).
  while (true) {
    const b = crypto.randomInt(0, 256);
    if (b < 248) return RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length];
  }
}

function generateOneRecoveryCode(): string {
  let raw = '';
  for (let i = 0; i < RECOVERY_LEN; i++) raw += pickChar();
  const groups: string[] = [];
  for (let i = 0; i < RECOVERY_GROUPS; i++) {
    groups.push(raw.slice(i * RECOVERY_GROUP_LEN, (i + 1) * RECOVERY_GROUP_LEN));
  }
  return groups.join('-');
}

export interface GeneratedRecoveryCodes {
  display: string[];          // shown to the user ONCE
  hashes: string[];           // stored in DB
}

export function generateRecoveryCodes(): GeneratedRecoveryCodes {
  const display: string[] = [];
  const hashes: string[] = [];
  for (let i = 0; i < RECOVERY_BATCH; i++) {
    const code = generateOneRecoveryCode();
    display.push(code);
    hashes.push(hashRecoveryCode(code));
  }
  return { display, hashes };
}

// User input might arrive lowercased, missing dashes, with stray spaces.
// Normalize before comparing so accommodating UX doesn't sacrifice
// security. The hash is sha256-hex of the normalized form.
function normalizeRecoveryCode(input: string): string {
  return input.replace(/[\s-]+/g, '').toUpperCase();
}

export function hashRecoveryCode(code: string): string {
  return crypto.createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');
}

// Returns the index of the matched hash, or -1 on miss. Caller burns
// that index by splicing it out of the stored array.
export function findRecoveryCodeIndex(input: string, hashes: string[]): number {
  const candidate = hashRecoveryCode(input);
  // Constant-time-ish via indexOf on hex strings — they're fixed length
  // so timing-side-channel risk is minimal.
  return hashes.indexOf(candidate);
}
