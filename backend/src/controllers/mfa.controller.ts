import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { adminDb as supabase } from '../utils/db';
import { logAudit } from '../utils/audit';
import { logger } from '../utils/logger';
import { sendMail } from '../utils/mailer';
import {
  generateTotpSecret, buildOtpauthUri, buildQrDataUrl, verifyTotp, verifyTotpDetailed,
  encryptSecret, decryptSecret, generateRecoveryCodes,
} from '../utils/mfa';
import { revokeAllTrustedDevicesForUser, issueTrustedDevice } from '../utils/trustedDevice';
import type { AuthRequest } from '../middleware/auth';

// Best-effort security-alert emails for MFA state changes. Same threat
// model as the email-change alert: an attacker on a hijacked session
// could enroll their own TOTP secret or disable MFA, and the legit user
// would have no signal until they were already locked out. The alert
// goes to the email on file; we never block the underlying request on a
// mail-provider hiccup.
const escapeHtmlMfa = (s: string): string =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));

async function sendMfaStateChangeAlert(opts: {
  userId: string;
  event: 'enrolled' | 'disabled_self' | 'disabled_by_admin';
  reason?: string | null;
}): Promise<void> {
  try {
    // tenant-check-allow: opts.userId is sourced by all callers from req.user (authenticated MFA endpoints) or a verified user row that was already school-scoped
    const { data: u } = await supabase
      .from('users')
      .select('email, first_name, schools(name)')
      .eq('id', opts.userId)
      .single();
    const row = u as { email?: string | null; first_name?: string; schools?: { name?: string } | null } | null;
    const email = row?.email;
    if (!email) return; // no inbox to alert; not a failure
    const firstName = row?.first_name || '';
    const schoolName = row?.schools?.name || '';
    const schoolSuffix = schoolName ? ` (${schoolName})` : '';

    const titleMap = {
      enrolled: `Two-factor authentication was enabled on your Scholify account${schoolSuffix}`,
      disabled_self: `Two-factor authentication was disabled on your Scholify account${schoolSuffix}`,
      disabled_by_admin: `Two-factor authentication was disabled by an administrator${schoolSuffix}`,
    } as const;
    const subject = titleMap[opts.event];

    const bodyLines: string[] = [`Hi ${firstName || 'there'},`, ''];
    if (opts.event === 'enrolled') {
      bodyLines.push(
        'Two-factor authentication was just enabled on your Scholify account. From now on, signing in will ask for a 6-digit code from your authenticator app.',
        '',
        "If this was you, no action is needed. If this wasn't you, change your password immediately — that signs out every device.",
      );
    } else if (opts.event === 'disabled_self') {
      bodyLines.push(
        'Two-factor authentication was just disabled on your Scholify account.',
        '',
        "If this was you, no action is needed. If this wasn't you, change your password immediately — someone may have access to your session.",
      );
    } else {
      bodyLines.push(
        'A school administrator just disabled two-factor authentication on your account.',
        '',
        'This is normal if you asked them to help you recover access (lost phone, lost recovery codes).',
      );
      if (opts.reason) bodyLines.push('', `Reason given: ${opts.reason}`);
      bodyLines.push('', 'If you did not ask for this, contact your school administrator immediately.');
    }
    const text = bodyLines.join('\n');

    const chipColor = opts.event === 'enrolled' ? '#16A34A' : '#B91C1C';
    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,Inter,sans-serif;background:#f8fafc;padding:24px">
        <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden">
          <div style="background:${chipColor};padding:20px 24px;color:#fff">
            <div style="font-size:12px;opacity:.85;letter-spacing:.06em;text-transform:uppercase">Scholify${schoolName ? ` · ${escapeHtmlMfa(schoolName)}` : ''} · Security alert</div>
            <div style="font-size:20px;font-weight:800;margin-top:4px">${escapeHtmlMfa(subject)}</div>
          </div>
          <div style="padding:24px;color:#0f172a">
            ${bodyLines.map(l => l ? `<p style="margin:0 0 12px;font-size:14px;line-height:1.55">${escapeHtmlMfa(l)}</p>` : '').join('')}
          </div>
        </div>
      </div>`;
    await sendMail(email, subject, html, text);
  } catch (err) {
    logger.error('MFA state-change alert send failed', { err, event: opts.event, userId: opts.userId });
  }
}

// Phase 2 scope: every role that touches student records or financial
// data is eligible. The role gate is enforced server-side so a tampered
// client can't bypass it; the UI hides the section for other roles
// (parent, driver) to match.
const MFA_ROLES = new Set(['admin', 'accountant', 'teacher', 'supervisor', 'reception']);

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

// Inner helper: generate a fresh secret + recovery codes, encrypt, upsert
// the row, build the QR + URI. Used by both the authenticated setup
// endpoint and the ticket-based forced-enrollment endpoint. Doesn't
// know about the request/response — caller decides how to surface the
// result and whether to audit.
async function generateAndStoreMfaSetup(opts: { userId: string; username: string; schoolName: string }):
  Promise<{ qrDataUrl: string; secret: string; otpauthUri: string; recoveryCodes: string[] } | { error: string; status: number }> {
  // Block setup if the user already has CONFIRMED + active MFA.
  // tenant-check-allow: user_mfa is user-keyed
  const { data: existing } = await supabase
    .from('user_mfa')
    .select('confirmed_at, disabled_at')
    .eq('user_id', opts.userId)
    .maybeSingle();
  const ex = existing as { confirmed_at: string | null; disabled_at: string | null } | null;
  if (ex && ex.confirmed_at && !ex.disabled_at) {
    return { error: 'Two-factor is already enabled. Disable it first or regenerate recovery codes from settings.', status: 409 };
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
    return { error: 'Could not initialize two-factor setup. Please try again later.', status: 500 };
  }

  const uri = buildOtpauthUri({ username: opts.username, secret, schoolName: opts.schoolName });
  let qrDataUrl: string;
  try {
    qrDataUrl = await buildQrDataUrl(uri);
  } catch (err) {
    logger.error('MFA QR generation failed', { err });
    return { error: 'Could not generate setup QR. Please try again later.', status: 500 };
  }

  // tenant-check-allow: user_mfa is user-keyed (PK on user_id)
  const { error: upErr } = await supabase
    .from('user_mfa')
    .upsert({
      user_id: opts.userId,
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
    return { error: 'Could not save two-factor setup. Please try again later.', status: 500 };
  }

  return { qrDataUrl, secret, otpauthUri: uri, recoveryCodes: codes.display };
}

// Inner helper: verify a TOTP code against a user's pending enrollment,
// activate on match. Same pattern as generateAndStoreMfaSetup.
async function verifyAndActivateMfa(userId: string, code: string):
  Promise<{ ok: true } | { error: string; status: number }> {
  // tenant-check-allow: user_mfa is user-keyed
  const { data: row } = await supabase
    .from('user_mfa')
    .select('secret_encrypted, confirmed_at, disabled_at')
    .eq('user_id', userId)
    .maybeSingle();
  const r = row as { secret_encrypted: string | Buffer; confirmed_at: string | null; disabled_at: string | null } | null;
  if (!r || r.disabled_at) {
    return { error: 'No pending enrollment. Start setup again.', status: 400 };
  }
  if (r.confirmed_at) {
    return { error: 'Two-factor is already enabled.', status: 400 };
  }
  let secret: string;
  try { secret = decryptSecret(toBuffer(r.secret_encrypted)); }
  catch (err) {
    logger.error('MFA secret decrypt failed at confirm', { err });
    return { error: 'Could not verify code. Please try setup again.', status: 500 };
  }
  const result = verifyTotpDetailed(code, secret);
  if (!result.valid) {
    const secretFingerprint = require('crypto').createHash('sha256').update(secret).digest('hex').slice(0, 12);
    logger.info('MFA confirm verify failed', {
      userId,
      epoch: Math.floor(Date.now() / 1000),
      delta: result.delta,
      reason: result.reason,
      codeLen: code.length,
      secretFp: secretFingerprint,
    });
    return { error: 'Wrong code. Make sure you scanned the most recent QR and that your phone clock is set correctly.', status: 400 };
  }
  const now = new Date().toISOString();
  // tenant-check-allow: user_mfa is user-keyed
  await supabase
    .from('user_mfa')
    .update({ confirmed_at: now, last_used_at: now, failed_attempts: 0, updated_at: now })
    .eq('user_id', userId);
  return { ok: true };
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

  const result = await generateAndStoreMfaSetup({ userId: userId!, username, schoolName });
  if ('error' in result) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json(result);
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
  const result = await verifyAndActivateMfa(userId!, code);
  if ('error' in result) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json({ ok: true });
  void logAudit({
    req,
    entityType: 'user_mfa',
    entityId: userId!,
    action: 'update',
    after: { state: 'active' },
    label: 'mfa_confirmed',
  });
  void sendMfaStateChangeAlert({ userId: userId!, event: 'enrolled' });
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

  // Trusted devices represent "I previously cleared MFA from here"; with
  // MFA off, that promise is meaningless. Revoke them all so the next
  // login is a clean slate.
  await revokeAllTrustedDevicesForUser(userId!);

  res.json({ ok: true });
  void logAudit({
    req,
    entityType: 'user_mfa',
    entityId: userId!,
    action: 'delete',
    before: { state: 'active' },
    label: 'mfa_disabled_self',
  });
  void sendMfaStateChangeAlert({ userId: userId!, event: 'disabled_self' });
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

  // Same reasoning as self-disable: trust dies when MFA dies.
  await revokeAllTrustedDevicesForUser(targetUserId);

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
  void sendMfaStateChangeAlert({ userId: targetUserId, event: 'disabled_by_admin', reason: reason.trim() });
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

// Forced-enrollment endpoints (Phase 2). The user passed the password
// step but didn't have MFA on, and the school requires it for their
// role. Login issued an `enrollmentTicket` instead of tokens; these
// endpoints accept that ticket as proof of password-success and walk
// the user through setup + confirm. The successful confirm here ALSO
// issues real tokens, so the user lands logged-in.

interface EnrollmentTicketPayload {
  userId: string;
  schoolId: string;
  role: string;
  type: string;
}

function verifyEnrollmentTicket(ticket: string): EnrollmentTicketPayload | null {
  try {
    const payload = jwt.verify(ticket, process.env.JWT_SECRET!, { algorithms: ['HS256'] }) as EnrollmentTicketPayload;
    if (payload.type !== 'mfa_enrollment_ticket') return null;
    if (!payload.userId || !payload.schoolId || !payload.role) return null;
    return payload;
  } catch { return null; }
}

// POST /auth/login/mfa-enroll-setup — ticket-authenticated mirror of
// /auth/mfa/setup. Public route (the ticket is the auth).
export async function enrollSetupViaTicket(req: Request, res: Response): Promise<void> {
  const { enrollmentTicket } = req.body as { enrollmentTicket?: string };
  if (!enrollmentTicket) {
    res.status(400).json({ error: 'enrollmentTicket is required' });
    return;
  }
  const payload = verifyEnrollmentTicket(enrollmentTicket);
  if (!payload) {
    res.status(401).json({ error: 'Your enrollment session has expired. Please sign in again.' });
    return;
  }
  if (!isEligibleRole(payload.role)) {
    res.status(403).json({ error: 'Two-factor authentication is not available for this account type.' });
    return;
  }

  // Fetch username + school name for the otpauth label, and re-validate
  // the user is still active.
  // tenant-check-allow: payload.userId comes from the just-verified enrollment ticket, minted in login() only after a school-scoped password match
  const { data: userRow } = await supabase
    .from('users')
    .select('username, is_active, schools(name)')
    .eq('id', payload.userId)
    .single();
  const u = userRow as { username?: string; is_active?: boolean; schools?: { name?: string } | null } | null;
  if (!u || !u.is_active) {
    res.status(401).json({ error: 'Account is not active.' });
    return;
  }
  const username = u.username || 'user';
  const schoolName = u.schools?.name || '';

  const result = await generateAndStoreMfaSetup({ userId: payload.userId, username, schoolName });
  if ('error' in result) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json(result);

  // Audit — inline (no req.user) using payload as actor.
  try {
    await supabase.from('audit_logs').insert({
      school_id: payload.schoolId,
      entity_type: 'user_mfa',
      entity_id: payload.userId,
      action: 'create',
      changes: { state: 'enrolled_pending_confirm' },
      actor_id: payload.userId,
      actor_username: username,
      actor_role: payload.role,
      label: 'mfa_setup',
      reason: 'forced_enrollment',
    });
  } catch (err) { logger.error('audit insert for enroll-setup failed', { err }); }
}

// POST /auth/login/mfa-enroll-confirm — ticket-authenticated confirm.
// On success: activates MFA AND issues the real token pair (the user is
// now logged in). Also optionally issues a trusted device token if the
// client asked to remember the browser.
export async function enrollConfirmViaTicket(req: Request, res: Response): Promise<void> {
  const { enrollmentTicket, code, rememberDevice } = req.body as { enrollmentTicket?: string; code?: string; rememberDevice?: boolean };
  if (!enrollmentTicket) {
    res.status(400).json({ error: 'enrollmentTicket is required' });
    return;
  }
  if (!code || !/^\d{6}$/.test(code)) {
    res.status(400).json({ error: 'A 6-digit code is required.' });
    return;
  }
  const payload = verifyEnrollmentTicket(enrollmentTicket);
  if (!payload) {
    res.status(401).json({ error: 'Your enrollment session has expired. Please sign in again.' });
    return;
  }

  const result = await verifyAndActivateMfa(payload.userId, code);
  if ('error' in result) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  // Pull full user + school for token issue + response (mirrors
  // verifyMfaLogin's shape). Tokens are issued via a dynamic import to
  // keep this controller free of cross-controller circular dependencies.
  // tenant-check-allow: payload.userId comes from the just-verified enrollment ticket, minted in login() only after a school-scoped password match
  const { data: user } = await supabase
    .from('users')
    .select('id, username, role, first_name, last_name, profile_picture, email, is_active')
    .eq('id', payload.userId)
    .single();
  if (!user || !(user as { is_active: boolean }).is_active) {
    res.status(401).json({ error: 'Account is not active.' });
    return;
  }
  const { data: school } = await supabase
    .from('schools')
    .select('id, name, slug, logo_url, primary_color, secondary_color, features, features_version, timezone, is_active')
    .eq('id', payload.schoolId)
    .single();
  if (!school || !(school as { is_active: boolean }).is_active) {
    res.status(401).json({ error: 'School is not active.' });
    return;
  }

  const auth = await import('./auth.controller');
  const u = user as { id: string; username: string; role: string; first_name: string; last_name: string; profile_picture: string | null; email: string | null };
  const s = school as { id: string; name: string; slug: string; logo_url: string | null; primary_color: string | null; secondary_color: string | null; features: Record<string, unknown> | null; features_version: number | null; timezone: string | null };
  const featuresVersion = s.features_version ?? 1;
  const { token, refreshToken } = await auth.issueTokenPair(
    { id: u.id, role: u.role, username: u.username },
    s.id,
    featuresVersion,
    req,
  );

  let trustedDeviceToken: string | undefined;
  if (rememberDevice) {
    const issued = await issueTrustedDevice({ userId: u.id, schoolId: s.id, req });
    if (issued) trustedDeviceToken = issued.rawToken;
  }

  res.json({
    token,
    refreshToken,
    user: {
      id: u.id,
      username: u.username,
      role: u.role,
      firstName: u.first_name,
      lastName: u.last_name,
      profilePicture: u.profile_picture,
      email: u.email || null,
    },
    school: {
      id: s.id,
      name: s.name,
      slug: s.slug,
      logoUrl: s.logo_url,
      primaryColor: s.primary_color,
      secondaryColor: s.secondary_color,
      features: s.features ?? {},
      timezone: s.timezone || 'Asia/Baghdad',
    },
    ...(trustedDeviceToken ? { trustedDeviceToken } : {}),
  });

  try {
    await supabase.from('audit_logs').insert({
      school_id: s.id,
      entity_type: 'user_mfa',
      entity_id: u.id,
      action: 'update',
      changes: { state: 'active' },
      actor_id: u.id,
      actor_username: u.username,
      actor_role: u.role,
      label: 'mfa_confirmed',
      reason: 'forced_enrollment',
    });
    // Also log the session creation — forced enrollment is a login event.
    const ua = ((req.headers['user-agent'] as string) || '').slice(0, 300);
    await supabase.from('audit_logs').insert({
      school_id: s.id,
      entity_type: 'user_session',
      entity_id: u.id,
      action: 'create',
      changes: { factor: 'forced_enrollment', ip: req.ip || null, user_agent: ua || null },
      actor_id: u.id,
      actor_username: u.username,
      actor_role: u.role,
      label: 'login_success',
      reason: 'forced_enrollment',
    });
  } catch (err) { logger.error('audit insert for enroll-confirm failed', { err }); }
  void sendMfaStateChangeAlert({ userId: u.id, event: 'enrolled' });
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

