import crypto from 'crypto';

// The token signing key must be independent of the login secret the operator
// types, so that knowing the password does not by itself let an attacker forge
// session tokens. Prefer an explicit MASTER_JWT_SECRET; if it is not set, derive
// a distinct key from MASTER_SECRET (HMAC with a fixed label) so the portal
// still works out of the box while the key is never equal to the password.
export function masterJwtSecret(): string {
  const explicit = process.env.MASTER_JWT_SECRET;
  if (explicit && explicit.length > 0) return explicit;
  const base = process.env.MASTER_SECRET || '';
  return crypto.createHmac('sha256', base).update('master-portal:jwt:v1').digest('hex');
}

// Constant-time login-secret comparison. Hashing both sides gives
// timingSafeEqual equal-length buffers and avoids leaking length.
export function secretMatches(supplied: string): boolean {
  const expected = process.env.MASTER_SECRET || '';
  if (!expected) return false;
  const a = crypto.createHash('sha256').update(supplied).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}
