// Rotating kiosk-token scheme for staff (employee) QR attendance (migration 063).
//
// Reception's web dashboard displays a QR that rotates every 60s. The QR
// encodes a STATELESS, HMAC-signed token — no per-token DB row. An employee
// scans it with the app and POSTs {token, latitude, longitude} to
// /staff-attendance/scan; the server re-derives the signature and accepts the
// token only for the CURRENT or PREVIOUS 60s window (so a code scanned right as
// it rotates still works).
//
// token = base64url( "<schoolId>.<window>.<hmacHex>" )
//   window  = floor(unixSeconds / 60)
//   hmacHex = HMAC_SHA256( STAFF_ATTENDANCE_QR_SECRET, "<schoolId>.<window>" )
//
// The schoolId is part of the signed payload AND re-checked against the
// scanning user's school, so a token minted for one school can never punch at
// another. The secret is server-side only and read from the environment at
// call time (mirrors the OTPIQ webhook-secret pattern) — until it is set the
// feature is inert (helpers return null / a 'unconfigured' verdict) rather than
// crashing the boot.

import crypto from 'crypto';

const WINDOW_SECONDS = 60;

function getSecret(): string | null {
  const s = process.env.STAFF_ATTENDANCE_QR_SECRET;
  return s && s.length >= 16 ? s : null;
}

/** True once STAFF_ATTENDANCE_QR_SECRET is configured (>= 16 chars). */
export function staffAttendanceConfigured(): boolean {
  return getSecret() !== null;
}

function currentWindow(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000 / WINDOW_SECONDS);
}

function sign(schoolId: string, window: number, key: string): string {
  return crypto.createHmac('sha256', key).update(`${schoolId}.${window}`).digest('hex');
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

export interface KioskToken {
  token: string;
  /** Seconds until the current window rolls over (drives the display refresh). */
  expiresInSeconds: number;
  rotateSeconds: number;
}

/** Mint the current kiosk token for a school. Returns null if the secret is unset. */
export function makeKioskToken(schoolId: string, nowMs: number = Date.now()): KioskToken | null {
  const key = getSecret();
  if (!key) return null;
  const window = currentWindow(nowMs);
  const mac = sign(schoolId, window, key);
  const token = Buffer.from(`${schoolId}.${window}.${mac}`).toString('base64url');
  const expiresInSeconds = WINDOW_SECONDS - (Math.floor(nowMs / 1000) % WINDOW_SECONDS);
  return { token, expiresInSeconds, rotateSeconds: WINDOW_SECONDS };
}

export type TokenReason = 'unconfigured' | 'malformed' | 'bad_signature' | 'expired' | 'wrong_school';
export type TokenVerdict = { ok: true; schoolId: string } | { ok: false; reason: TokenReason };

/**
 * Verify a scanned token against the scanning user's school. Accepts only the
 * current and previous 60s windows. Constant-time signature comparison.
 */
export function verifyKioskToken(
  token: string, expectedSchoolId: string, nowMs: number = Date.now(),
): TokenVerdict {
  const key = getSecret();
  if (!key) return { ok: false, reason: 'unconfigured' };

  // Buffer.from(_, 'base64url') does not throw in Node — it decodes whatever
  // bytes it can. The real malformed-input guards are the split + regex below;
  // this try/catch is belt-and-suspenders for exotic inputs / future engines.
  let decoded: string;
  try {
    decoded = Buffer.from(token, 'base64url').toString('utf8');
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  const parts = decoded.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [schoolId, windowStr, mac] = parts;
  // windowStr must be CANONICAL decimal. Number() would silently accept hex
  // ('0x10'), scientific ('1e3') and whitespace-padded forms — all of which
  // re-serialize to the same window in sign() and would pass the HMAC check.
  // Rejecting them keeps the token's string form 1:1 with its meaning, so a
  // future raw-token replay cache can't be bypassed by re-encoding the window.
  if (!schoolId || !/^\d{1,15}$/.test(windowStr) || !/^[0-9a-f]{64}$/.test(mac)) {
    return { ok: false, reason: 'malformed' };
  }
  const window = parseInt(windowStr, 10);

  // Signature must match for the embedded (schoolId, window).
  const expectedMac = sign(schoolId, window, key);
  if (!timingSafeEqualHex(mac, expectedMac)) return { ok: false, reason: 'bad_signature' };

  // Freshness: HMAC alone never expires, so the window check enforces rotation.
  const cur = currentWindow(nowMs);
  if (window !== cur && window !== cur - 1) return { ok: false, reason: 'expired' };

  // Tenant: the token must belong to the scanning user's school.
  if (schoolId !== expectedSchoolId) return { ok: false, reason: 'wrong_school' };

  return { ok: true, schoolId };
}
