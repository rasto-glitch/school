import crypto from 'crypto';
import { adminDb as supabase } from './db';
import type { Request } from 'express';

// Phase 3 trusted devices. After a successful MFA verify, a user may
// opt to remember the current browser/device for a fixed window (default
// 30 days). We mint an opaque random token, store only its sha256 hash,
// and the client persists the raw token client-side (localStorage on
// web, AsyncStorage on mobile). The client replays the raw token on
// /auth/login; if the hash matches an active row for the same user, we
// skip the MFA prompt for that login.
//
// Security notes:
//   - The token is the credential — anyone holding it skips MFA for
//     that user for the remaining trust window. Store it like a session.
//   - Stored as sha256(token); a DB dump alone can't be replayed.
//   - The trusted device cannot bypass the password. Password is still
//     required at every login. Trust only skips the second factor.
//   - Admin disabling a user's MFA revokes ALL of that user's trusted
//     devices (handled in mfa.controller).

export const TRUSTED_DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function generateTrustedDeviceToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function hashTrustedDeviceToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// Coarse device label for the user-facing list ("Chrome on Windows").
// Re-uses the same pattern as describeDevice in auth.controller — kept
// small here so we don't introduce a cross-controller import.
export function labelDevice(ua: string): string {
  if (!ua) return 'an unrecognized device';
  const s = ua.toLowerCase();
  let os = 'unknown system';
  if (s.includes('iphone') || s.includes('ipad') || /\bios\b/.test(s)) os = 'iOS';
  else if (s.includes('android')) os = 'Android';
  else if (s.includes('windows')) os = 'Windows';
  else if (s.includes('mac os') || s.includes('macintosh')) os = 'macOS';
  else if (s.includes('linux')) os = 'Linux';
  let app = 'a browser';
  if (s.includes('scholify') || s.includes('expo') || s.includes('okhttp') || s.includes('cfnetwork')) app = 'Scholify app';
  else if (s.includes('edg/')) app = 'Edge';
  else if (s.includes('chrome/')) app = 'Chrome';
  else if (s.includes('firefox/')) app = 'Firefox';
  else if (s.includes('safari/')) app = 'Safari';
  return `${app} on ${os}`;
}

export interface IssuedTrustedDevice {
  rawToken: string;
  expiresAt: string;
}

export async function issueTrustedDevice(opts: {
  userId: string;
  schoolId: string;
  req: Request;
}): Promise<IssuedTrustedDevice | null> {
  const raw = generateTrustedDeviceToken();
  const tokenHash = hashTrustedDeviceToken(raw);
  const expiresAt = new Date(Date.now() + TRUSTED_DEVICE_TTL_MS).toISOString();
  const ua = ((opts.req.headers['user-agent'] as string) || '').slice(0, 300);
  // tenant-check-allow: trusted_devices is user-keyed (school_id stored for cascade + scoping)
  const { error } = await supabase.from('trusted_devices').insert({
    user_id: opts.userId,
    school_id: opts.schoolId,
    token_hash: tokenHash,
    device_label: labelDevice(ua),
    user_agent: ua || null,
    ip: opts.req.ip || null,
    expires_at: expiresAt,
  });
  if (error) return null;
  return { rawToken: raw, expiresAt };
}

// Returns true and updates last_seen_at when the raw token matches an
// active row for the given user. Used to skip the MFA prompt at login.
// On a positive match we also nudge last_seen_at so we can show "last
// used 2 hours ago" in the device-list UI.
export async function checkTrustedDevice(rawToken: string, userId: string): Promise<boolean> {
  if (!rawToken || typeof rawToken !== 'string' || rawToken.length < 32) return false;
  const tokenHash = hashTrustedDeviceToken(rawToken);
  // tenant-check-allow: trusted_devices is user-keyed (matched by user_id + token_hash)
  const { data: row } = await supabase
    .from('trusted_devices')
    .select('id, user_id, expires_at, revoked_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();
  const r = row as { id: string; user_id: string; expires_at: string; revoked_at: string | null } | null;
  if (!r) return false;
  if (r.user_id !== userId) return false;
  if (r.revoked_at) return false;
  if (new Date(r.expires_at) <= new Date()) return false;
  // Best-effort update — last_seen_at is metadata, not a correctness
  // gate, so we don't await before returning the positive result.
  void supabase.from('trusted_devices')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', r.id);
  return true;
}

// Revoke every trusted device for a user. Called when MFA is disabled
// (self or admin) — at that point the trust is meaningless because
// the user has no second factor to back it.
export async function revokeAllTrustedDevicesForUser(userId: string): Promise<void> {
  // tenant-check-allow: trusted_devices is user-keyed
  await supabase.from('trusted_devices')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('revoked_at', null);
}
