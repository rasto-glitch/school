import { adminDb as supabase } from './db';
import { decryptSecret, verifyTotp } from './mfa';

// Supabase returns BYTEA as either a Buffer (raw) or a hex string
// (`\x...`). Normalize so the rest of the code can treat it as Buffer.
export function toBuffer(b: string | Buffer): Buffer {
  if (Buffer.isBuffer(b)) return b;
  if (typeof b === 'string') {
    if (b.startsWith('\\x')) return Buffer.from(b.slice(2), 'hex');
    return Buffer.from(b, 'base64');
  }
  return Buffer.from([]);
}

// Exported for use by the login flow when verifying a TOTP code after
// password success. Returns 'ok' / 'wrong' / 'no_mfa' so the caller can
// branch and account for the failure-attempt counter.
export type MfaVerifyResult = 'ok' | 'wrong' | 'no_mfa';

export async function verifyMfaCodeForUser(
  userId: string,
  code: string,
): Promise<MfaVerifyResult> {
  // tenant-check-allow: user_mfa is user-keyed
  const { data: row } = await supabase
    .from('user_mfa')
    .select('secret_encrypted, confirmed_at, disabled_at, recovery_codes_hash, failed_attempts')
    .eq('user_id', userId)
    .maybeSingle();
  const r = row as {
    secret_encrypted: string | Buffer;
    confirmed_at: string | null;
    disabled_at: string | null;
    recovery_codes_hash: string[];
    failed_attempts: number;
  } | null;
  if (!r || !r.confirmed_at || r.disabled_at) return 'no_mfa';

  // Recovery codes also accepted here — a non-numeric / not-6-digit
  // input is treated as a recovery-code attempt and goes through the
  // (separate) burn-on-use path.
  if (/^\d{6}$/.test(code)) {
    let secret: string;
    try { secret = decryptSecret(toBuffer(r.secret_encrypted)); }
    catch { return 'wrong'; }
    if (verifyTotp(code, secret)) {
      // tenant-check-allow: user_mfa is user-keyed
      await supabase.from('user_mfa').update({
        last_used_at: new Date().toISOString(),
        failed_attempts: 0,
      }).eq('user_id', userId);
      return 'ok';
    }
    // tenant-check-allow: user_mfa is user-keyed
    await supabase.from('user_mfa').update({
      failed_attempts: r.failed_attempts + 1,
    }).eq('user_id', userId);
    return 'wrong';
  }

  // Recovery-code path. Burn the matched hash on success.
  const { findRecoveryCodeIndex } = await import('./mfa');
  const idx = findRecoveryCodeIndex(code, r.recovery_codes_hash);
  if (idx === -1) {
    // tenant-check-allow: user_mfa is user-keyed
    await supabase.from('user_mfa').update({
      failed_attempts: r.failed_attempts + 1,
    }).eq('user_id', userId);
    return 'wrong';
  }
  const remaining = r.recovery_codes_hash.slice(0, idx).concat(r.recovery_codes_hash.slice(idx + 1));
  // tenant-check-allow: user_mfa is user-keyed
  await supabase.from('user_mfa').update({
    recovery_codes_hash: remaining,
    last_used_at: new Date().toISOString(),
    failed_attempts: 0,
  }).eq('user_id', userId);
  return 'ok';
}
