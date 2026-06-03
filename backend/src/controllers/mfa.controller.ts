import { Response } from 'express';
import bcrypt from 'bcryptjs';
import { adminDb as supabase } from '../utils/db';
import { logAudit } from '../utils/audit';
import { logger } from '../utils/logger';
import {
  generateTotpSecret, buildOtpauthUri, buildQrDataUrl, verifyTotp, verifyTotpDetailed,
  encryptSecret, decryptSecret, generateRecoveryCodes,
} from '../utils/mfa';
import type { AuthRequest } from '../middleware/auth';

// Phase 1: TOTP is opt-in for admin + accountant only. The role gate is
// enforced server-side so a tampered client can't bypass it; the UI
// hides the section for other roles to match.
const MFA_ROLES = new Set(['admin', 'accountant']);

function isEligibleRole(role: string | undefined): boolean {
  return !!role && MFA_ROLES.has(role);
}

// GET /auth/mfa/status — what does the UI show?
//   { eligible: boolean, enrolled: boolean, confirmed: boolean,
//     recoveryCodesRemaining: number }
export async function getMfaStatus(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user?.userId;
  const role = req.user?.role;
  const eligible = isEligibleRole(role);
  // tenant-check-allow: user_mfa is user-keyed (PK on user_id)
  const { data: row } = await supabase
    .from('user_mfa')
    .select('confirmed_at, disabled_at, recovery_codes_hash')
    .eq('user_id', userId)
    .maybeSingle();
  const r = row as { confirmed_at: string | null; disabled_at: string | null; recovery_codes_hash: string[] } | null;
  const enrolled = !!r && r.disabled_at === null;
  const confirmed = !!r && r.confirmed_at !== null && r.disabled_at === null;
  const recoveryCodesRemaining = r?.recovery_codes_hash?.length ?? 0;
  res.json({ eligible, enrolled, confirmed, recoveryCodesRemaining });
}

// POST /auth/mfa/setup — start enrollment. Generates a fresh secret +
// recovery codes, encrypts secret, stores row with confirmed_at NULL.
// Returns QR data URL + the secret string (for manual entry) + plaintext
// recovery codes (shown to user ONCE — we only store hashes).
//
// Idempotent semantics: if the user calls setup again before confirming,
// we ROTATE the secret (so an abandoned setup can't be hijacked by an
// attacker who sniffed the QR). Recovery codes are regenerated too.
export async function setupMfa(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user?.userId;
  const role = req.user?.role;
  if (!isEligibleRole(role)) {
    res.status(403).json({ error: 'Two-factor authentication is not available for this account type.' });
    return;
  }

  // Pull user + school details for the otpauth label.
  const { data: userRow } = await supabase
    .from('users')
    .select('username, schools(name)')
    .eq('id', userId)
    .single();
  const u = userRow as { username?: string; schools?: { name?: string } | null } | null;
  const username = u?.username || 'user';
  const schoolName = u?.schools?.name || '';

  // Block setup if the user already has CONFIRMED + active MFA — they
  // should disable first or regenerate via the dedicated endpoint.
  // tenant-check-allow: user_mfa is user-keyed
  const { data: existing } = await supabase
    .from('user_mfa')
    .select('confirmed_at, disabled_at')
    .eq('user_id', userId)
    .maybeSingle();
  const ex = existing as { confirmed_at: string | null; disabled_at: string | null } | null;
  if (ex && ex.confirmed_at && !ex.disabled_at) {
    res.status(409).json({ error: 'Two-factor is already enabled. Disable it first or regenerate recovery codes from settings.' });
    return;
  }

  let secret: string;
  let encrypted: Buffer;
  let codes: ReturnType<typeof generateRecoveryCodes>;
  try {
    secret = generateTotpSecret();
    encrypted = encryptSecret(secret);
    codes = generateRecoveryCodes();
  } catch (err) {
    logger.error('MFA secret gen / encrypt failed', { err });
    res.status(500).json({ error: 'Could not initialize two-factor setup. Please try again later.' });
    return;
  }

  const uri = buildOtpauthUri({ username, secret, schoolName });
  let qrDataUrl: string;
  try {
    qrDataUrl = await buildQrDataUrl(uri);
  } catch (err) {
    logger.error('MFA QR generation failed', { err });
    res.status(500).json({ error: 'Could not generate setup QR. Please try again later.' });
    return;
  }

  // Upsert by user_id (PK). Reset confirmed_at + disabled_at + counter
  // so a previously-disabled row becomes a fresh enrollment.
  // tenant-check-allow: user_mfa is user-keyed (PK on user_id)
  const { error: upErr } = await supabase
    .from('user_mfa')
    .upsert({
      user_id: userId,
      secret_encrypted: bytea(encrypted),
      recovery_codes_hash: codes.hashes,
      enrolled_at: new Date().toISOString(),
      confirmed_at: null,
      disabled_at: null,
      disabled_by: null,
      failed_attempts: 0,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
  if (upErr) {
    logger.error('MFA upsert failed', { err: upErr.message });
    res.status(500).json({ error: 'Could not save two-factor setup. Please try again later.' });
    return;
  }

  res.json({
    qrDataUrl,
    secret,
    otpauthUri: uri,
    recoveryCodes: codes.display,
  });
  void logAudit({
    req,
    entityType: 'user_mfa',
    entityId: userId!,
    action: 'create',
    after: { state: 'enrolled_pending_confirm' },
    label: 'mfa_setup',
  });
}

// POST /auth/mfa/confirm — verifies the first 6-digit code against the
// stored secret. On success, sets confirmed_at — MFA is now active for
// login from this point onward.
export async function confirmMfa(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user?.userId;
  const role = req.user?.role;
  if (!isEligibleRole(role)) {
    res.status(403).json({ error: 'Two-factor authentication is not available for this account type.' });
    return;
  }
  const { code } = req.body as { code?: string };
  if (!code || !/^\d{6}$/.test(code)) {
    res.status(400).json({ error: 'A 6-digit code is required.' });
    return;
  }

  // tenant-check-allow: user_mfa is user-keyed
  const { data: row } = await supabase
    .from('user_mfa')
    .select('secret_encrypted, confirmed_at, disabled_at')
    .eq('user_id', userId)
    .maybeSingle();
  const r = row as { secret_encrypted: string | Buffer; confirmed_at: string | null; disabled_at: string | null } | null;
  if (!r || r.disabled_at) {
    res.status(400).json({ error: 'No pending enrollment. Start setup again.' });
    return;
  }
  if (r.confirmed_at) {
    res.status(400).json({ error: 'Two-factor is already enabled.' });
    return;
  }

  let secret: string;
  try {
    secret = decryptSecret(toBuffer(r.secret_encrypted));
  } catch (err) {
    logger.error('MFA secret decrypt failed at confirm', { err });
    res.status(500).json({ error: 'Could not verify code. Please try setup again.' });
    return;
  }

  const verifyResult = verifyTotpDetailed(code, secret);
  if (!verifyResult.valid) {
    // Diagnostic logging: delta tells us "near miss" (wrong window =
    // probably clock skew) vs. "no match at any window" (probably wrong
    // secret — stale QR or wrong entry in authenticator app). We log the
    // SHA-256 of the secret instead of the secret itself so a leaked log
    // can't reveal it.
    const secretFingerprint = require('crypto').createHash('sha256').update(secret).digest('hex').slice(0, 12);
    logger.info('MFA confirm verify failed', {
      userId,
      epoch: Math.floor(Date.now() / 1000),
      delta: verifyResult.delta,
      reason: verifyResult.reason,
      codeLen: code.length,
      secretFp: secretFingerprint,
    });
    res.status(400).json({ error: 'Wrong code. Make sure you scanned the most recent QR and that your phone clock is set correctly.' });
    return;
  }

  const now = new Date().toISOString();
  // tenant-check-allow: user_mfa is user-keyed
  await supabase
    .from('user_mfa')
    .update({ confirmed_at: now, last_used_at: now, failed_attempts: 0, updated_at: now })
    .eq('user_id', userId);

  res.json({ ok: true });
  void logAudit({
    req,
    entityType: 'user_mfa',
    entityId: userId!,
    action: 'update',
    after: { state: 'active' },
    label: 'mfa_confirmed',
  });
}

// POST /auth/mfa/disable-self — user turns off their own MFA. Requires
// current password AND a current TOTP code so a session-only attacker
// can't strip the second factor.
export async function disableMfaSelf(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user?.userId;
  const { currentPassword, code } = req.body as { currentPassword?: string; code?: string };
  if (!currentPassword || typeof currentPassword !== 'string') {
    res.status(400).json({ error: 'Current password is required.' });
    return;
  }
  if (!code || !/^\d{6}$/.test(code)) {
    res.status(400).json({ error: 'A 6-digit code from your authenticator is required.' });
    return;
  }

  const { data: userRow } = await supabase
    .from('users')
    .select('password_hash')
    .eq('id', userId)
    .single();
  const passwordHash = (userRow as { password_hash?: string } | null)?.password_hash || '';
  const passwordOk = passwordHash ? await bcrypt.compare(currentPassword, passwordHash) : false;
  if (!passwordOk) {
    res.status(401).json({ error: 'Current password is incorrect.' });
    return;
  }

  // tenant-check-allow: user_mfa is user-keyed
  const { data: row } = await supabase
    .from('user_mfa')
    .select('secret_encrypted, confirmed_at, disabled_at')
    .eq('user_id', userId)
    .maybeSingle();
  const r = row as { secret_encrypted: string | Buffer; confirmed_at: string | null; disabled_at: string | null } | null;
  if (!r || !r.confirmed_at || r.disabled_at) {
    res.status(400).json({ error: 'Two-factor is not active for this account.' });
    return;
  }

  let secret: string;
  try {
    secret = decryptSecret(toBuffer(r.secret_encrypted));
  } catch (err) {
    logger.error('MFA secret decrypt failed at disable-self', { err });
    res.status(500).json({ error: 'Could not verify code. Contact an administrator if this persists.' });
    return;
  }
  if (!verifyTotp(code, secret)) {
    res.status(401).json({ error: 'Wrong code.' });
    return;
  }

  const now = new Date().toISOString();
  // Keep the row for audit; mark disabled and clear secret bytes so a
  // future DB compromise can't recover it. Recovery codes are wiped too.
  // tenant-check-allow: user_mfa is user-keyed
  await supabase
    .from('user_mfa')
    .update({
      disabled_at: now,
      disabled_by: userId,
      secret_encrypted: bytea(Buffer.from([])),
      recovery_codes_hash: [],
      updated_at: now,
    })
    .eq('user_id', userId);

  res.json({ ok: true });
  void logAudit({
    req,
    entityType: 'user_mfa',
    entityId: userId!,
    action: 'delete',
    before: { state: 'active' },
    label: 'mfa_disabled_self',
  });
}

// POST /auth/mfa/recovery-codes — regenerate. Requires a valid current
// TOTP code; this is a self-service replacement, not a panic button.
// (Lost device → use a recovery code to log in, then regenerate from
// settings. Lost everything → admin disable.)
export async function regenerateRecoveryCodes(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user?.userId;
  const { code } = req.body as { code?: string };
  if (!code || !/^\d{6}$/.test(code)) {
    res.status(400).json({ error: 'A 6-digit code is required.' });
    return;
  }

  // tenant-check-allow: user_mfa is user-keyed
  const { data: row } = await supabase
    .from('user_mfa')
    .select('secret_encrypted, confirmed_at, disabled_at')
    .eq('user_id', userId)
    .maybeSingle();
  const r = row as { secret_encrypted: string | Buffer; confirmed_at: string | null; disabled_at: string | null } | null;
  if (!r || !r.confirmed_at || r.disabled_at) {
    res.status(400).json({ error: 'Two-factor is not active for this account.' });
    return;
  }

  let secret: string;
  try {
    secret = decryptSecret(toBuffer(r.secret_encrypted));
  } catch (err) {
    logger.error('MFA secret decrypt failed at regen', { err });
    res.status(500).json({ error: 'Could not verify code. Contact an administrator.' });
    return;
  }
  if (!verifyTotp(code, secret)) {
    res.status(401).json({ error: 'Wrong code.' });
    return;
  }

  const codes = generateRecoveryCodes();
  // tenant-check-allow: user_mfa is user-keyed
  await supabase
    .from('user_mfa')
    .update({ recovery_codes_hash: codes.hashes, updated_at: new Date().toISOString() })
    .eq('user_id', userId);

  res.json({ recoveryCodes: codes.display });
  void logAudit({
    req,
    entityType: 'user_mfa',
    entityId: userId!,
    action: 'update',
    label: 'mfa_recovery_codes_regenerated',
  });
}

// POST /admin/users/:userId/mfa-disable — admin emergency disable for a
// user who's locked out (lost phone + lost recovery codes). Heavily
// audited; the admin actor + reason go into the audit row.
export async function adminDisableMfa(req: AuthRequest, res: Response): Promise<void> {
  const adminId = req.user?.userId;
  const adminRole = req.user?.role;
  const schoolId = req.user?.schoolId;
  if (adminRole !== 'admin') {
    res.status(403).json({ error: 'Only admins can disable two-factor on another account.' });
    return;
  }
  const targetUserId = (req.params as { userId: string }).userId;
  const { reason } = req.body as { reason?: string };
  if (!reason || typeof reason !== 'string' || reason.trim().length < 4) {
    res.status(400).json({ error: 'A short reason is required (4+ characters).' });
    return;
  }

  // Tenant guard — admin can only act on a user in their own school.
  const { data: targetUser } = await supabase
    .from('users')
    .select('id, school_id')
    .eq('id', targetUserId)
    .single();
  const t = targetUser as { id?: string; school_id?: string } | null;
  if (!t || t.school_id !== schoolId) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }

  // tenant-check-allow: user_mfa is user-keyed, target's row
  const { data: row } = await supabase
    .from('user_mfa')
    .select('confirmed_at, disabled_at')
    .eq('user_id', targetUserId)
    .maybeSingle();
  const r = row as { confirmed_at: string | null; disabled_at: string | null } | null;
  if (!r || !r.confirmed_at || r.disabled_at) {
    res.status(400).json({ error: 'Two-factor is not active for this user.' });
    return;
  }

  const now = new Date().toISOString();
  // tenant-check-allow: user_mfa is user-keyed
  await supabase
    .from('user_mfa')
    .update({
      disabled_at: now,
      disabled_by: adminId,
      secret_encrypted: bytea(Buffer.from([])),
      recovery_codes_hash: [],
      updated_at: now,
    })
    .eq('user_id', targetUserId);

  res.json({ ok: true });
  void logAudit({
    req,
    entityType: 'user_mfa',
    entityId: targetUserId,
    action: 'delete',
    before: { state: 'active' },
    label: 'mfa_disabled_by_admin',
    reason: reason.trim(),
  });
}

// Supabase returns BYTEA as either a Buffer (raw) or a hex string
// (`\x...`). Normalize so the rest of the code can treat it as Buffer.
function toBuffer(b: string | Buffer): Buffer {
  if (Buffer.isBuffer(b)) return b;
  if (typeof b === 'string') {
    if (b.startsWith('\\x')) return Buffer.from(b.slice(2), 'hex');
    return Buffer.from(b, 'base64');
  }
  return Buffer.from([]);
}

// PostgREST won't accept a Node Buffer as a BYTEA value — `JSON.stringify`
// turns it into `{"type":"Buffer","data":[...]}`, which Postgres rejects.
// Send the standard `\x<hex>` BYTEA literal instead; that round-trips
// cleanly through the JS-string boundary on both write and read.
function bytea(buf: Buffer): string {
  return '\\x' + buf.toString('hex');
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
  const { findRecoveryCodeIndex } = await import('../utils/mfa');
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

// Helper for the login flow: is MFA active for this user?
export async function isMfaActive(userId: string): Promise<boolean> {
  // tenant-check-allow: user_mfa is user-keyed
  const { data: row } = await supabase
    .from('user_mfa')
    .select('confirmed_at, disabled_at')
    .eq('user_id', userId)
    .maybeSingle();
  const r = row as { confirmed_at: string | null; disabled_at: string | null } | null;
  return !!r && !!r.confirmed_at && !r.disabled_at;
}

