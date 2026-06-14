import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { Request, Response } from 'express';
import { adminDb as supabase } from '../utils/db';
import { logger } from '../utils/logger';
import { logAudit } from '../utils/audit';
import { sendMail } from '../utils/mailer';
import { getIo } from '../utils/notify';
import {
  sendPhoneOtp, verifyPhoneOtp, processDeliveryEvent,
  PhoneOtpDeliveryFailedError,
} from '../utils/phoneOtp';
import {
  parseIraqiPhone, phoneParseReasonMessage, maskPhone,
} from '../utils/phoneE164';
import {
  verifyStepUp, stepUpReasonMessage, type StepUpProof,
} from '../utils/stepUp';
import type { AuthRequest } from '../middleware/auth';

// Phone OTP — Stage B controllers (verify / change phone), hardened for
// account-takeover resistance (migration 051).
//
// The change flow now enforces the locked policy:
//   - Password re-auth is ALWAYS required (first-time set and change).
//   - Changing an ALREADY-VERIFIED phone additionally requires proof of
//     one existing factor (TOTP / OTP to the old phone / email OTP),
//     handled by utils/stepUp.ts.
//   - users.phone_e164 is NOT written on send anymore. The new number
//     rides on the phone_otp_codes row and is committed only on confirm,
//     so a `send` can never wipe a verified number before a code is
//     entered.
//   - On a real change, confirm opens a recovery window (revert token)
//     and alerts the email on file — mirroring the email-change anchor.
//
// Endpoints in this file:
//   POST /me/phone/send-verify-otp     — authenticated; rate-limited at route layer
//   POST /me/phone/confirm-verify-otp  — authenticated; rate-limited at route layer
//   POST /auth/recover-phone           — public; revert token IS the auth
//   POST /public/otpiq-webhook         — public; HMAC-verified inside handler

const PORTAL_URL = (process.env.FRONTEND_URL || 'http://localhost:5173').split(',')[0].trim();
const PHONE_RECOVERY_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, same as email anchor

const hashToken = (raw: string): string =>
  crypto.createHash('sha256').update(raw).digest('hex');
const generateToken = (): string =>
  crypto.randomBytes(32).toString('hex');
const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));

// ── POST /me/phone/send-verify-otp ─────────────────────────────────────────
// Body: { phone, currentPassword, proof? }. Re-authenticates (password),
// and when CHANGING an already-verified number also requires a step-up
// proof of an existing factor. Sends an OTPIQ WhatsApp code to the NEW
// number. Does NOT mutate users.phone_e164 — the swap happens on confirm.

export async function sendVerifyPhoneOtp(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const schoolId = req.user!.schoolId;
  const phoneRaw = (req.body?.phone ?? '') as string;
  const currentPassword = (req.body?.currentPassword ?? '') as string;
  const proof = req.body?.proof as StepUpProof | undefined;

  const parsed = parseIraqiPhone(phoneRaw);
  if (!parsed.ok) {
    res.status(400).json({ error: phoneParseReasonMessage(parsed.reason) });
    return;
  }
  const phoneE164 = parsed.e164;

  // tenant-check-allow: filtered by id = req.user.userId
  const { data: existing, error: readErr } = await supabase
    .from('users')
    .select('phone_e164, phone_verified_at, password_hash, email, schools(name)')
    .eq('id', userId)
    .maybeSingle();
  if (readErr || !existing) {
    res.status(500).json({ error: 'Failed to read user' });
    return;
  }

  // 1. Password re-auth — always. A live session is not enough to touch a
  //    contact channel. Done before anything else so the rest of the flow
  //    only runs for a re-authenticated caller.
  const passwordHash = (existing as { password_hash?: string }).password_hash || '';
  if (!currentPassword || typeof currentPassword !== 'string' || !passwordHash) {
    res.status(401).json({ error: 'Current password is required.' });
    return;
  }
  if (!(await bcrypt.compare(currentPassword, passwordHash))) {
    res.status(401).json({ error: 'Current password is incorrect.' });
    return;
  }

  const currentVerifiedPhone =
    (existing.phone_verified_at && existing.phone_e164) ? (existing.phone_e164 as string) : null;
  const isChangeToDifferent = !!currentVerifiedPhone && currentVerifiedPhone !== phoneE164;

  // 2. Step-up — only when replacing an already-verified number with a
  //    different one. First-time set, or re-verifying the same number,
  //    skip this (there is no other factor at stake, or nothing changes).
  if (isChangeToDifferent) {
    // Resend shortcut: if a change to THIS exact number was already
    // authorized recently (an open verify code to it exists), don't make
    // the user re-prove a factor just to receive the code again.
    // tenant-check-allow: filtered by user_id + school_id (req.user)
    const { data: inflight } = await supabase
      .from('phone_otp_codes')
      .select('id')
      .eq('user_id', userId)
      .eq('school_id', schoolId)
      .eq('purpose', 'verify_phone')
      .eq('phone_e164', phoneE164)
      .is('consumed_at', null)
      .gte('expires_at', new Date().toISOString())
      .limit(1)
      .maybeSingle();

    if (!inflight) {
      const su = await verifyStepUp(userId, 'change_phone', proof);
      if (!su.ok) {
        res.status(401).json({
          error: stepUpReasonMessage(su.reason),
          stepUpRequired: true,
          reason: su.reason,
          methods: su.offered,
        });
        return;
      }
    }
  }

  // 3. Send the code to the NEW number. We deliberately do NOT write
  //    users.phone_e164 here — confirm commits it from the code row.
  let result;
  try {
    result = await sendPhoneOtp({
      schoolId,
      userId,
      phoneE164,
      purpose: 'verify_phone',
      emailFallback: typeof existing.email === 'string' ? existing.email : null,
      schoolName: ((existing.schools as unknown) as { name?: string } | null)?.name,
    });
  } catch (err) {
    if (err instanceof PhoneOtpDeliveryFailedError) {
      res.status(503).json({ error: err.message });
      return;
    }
    logger.error('sendVerifyPhoneOtp failed', { error: (err as Error).message });
    res.status(500).json({ error: 'Could not send verification code' });
    return;
  }

  await logAudit({
    req,
    entityType: 'user_account',
    entityId: userId,
    action: 'update',
    label: `Phone OTP requested for ${maskPhone(phoneE164)}`,
  });

  res.status(202).json({
    codeId: result.codeId,
    expiresAt: result.expiresAt,
    deliveryAttempted: {
      whatsapp: result.whatsappQueued,
      emailFallbackImmediate: result.emailFallbackSentImmediately,
    },
  });
}

// ── POST /me/phone/confirm-verify-otp ──────────────────────────────────────
// Body: { code }. Verifies the latest open verify_phone code, commits the
// number it was sent to onto users.phone_e164 (+ verified timestamp),
// back-syncs the role table, and — if this replaced a DIFFERENT verified
// number — opens a recovery window and alerts the email on file.

export async function confirmVerifyPhoneOtp(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const schoolId = req.user!.schoolId;
  const code = (req.body?.code ?? '') as string;

  const result = await verifyPhoneOtp({ schoolId, userId, purpose: 'verify_phone', code });
  if (!result.ok) {
    const status = mapVerifyReasonToStatus(result.reason);
    res.status(status).json({ error: verifyReasonMessage(result.reason) });
    return;
  }
  const newPhone = result.phoneE164;

  // Snapshot the OLD state BEFORE the swap so we can detect a real change
  // and pin the recovery anchor to the number we're leaving.
  // tenant-check-allow: filtered by id = req.user.userId
  const { data: before } = await supabase
    .from('users')
    .select('phone_e164, phone_verified_at, role, email, first_name, schools(name)')
    .eq('id', userId)
    .maybeSingle();
  const oldPhone =
    (before?.phone_verified_at && before?.phone_e164) ? (before.phone_e164 as string) : null;
  const oldVerifiedAt = (before as { phone_verified_at?: string | null })?.phone_verified_at || null;
  const email = (before as { email?: string | null })?.email || null;
  const firstName = (before as { first_name?: string })?.first_name || '';
  const schoolName = ((before?.schools as unknown) as { name?: string } | null)?.name || '';

  const now = new Date().toISOString();
  const { data: stamped, error: updErr } = await supabase
    .from('users')
    .update({ phone_e164: newPhone, phone_verified_at: now })
    .eq('id', userId)
    .select('phone_e164, role')
    .single();
  if (!updErr && stamped) {
    await syncVerifiedPhoneToRoleTable(
      userId, schoolId,
      (stamped as { role: string }).role,
      (stamped as { phone_e164: string | null }).phone_e164,
    );
  }
  if (updErr) {
    logger.error('confirmVerifyPhoneOtp commit failed', { userId, error: updErr.message });
    res.status(500).json({ error: 'Could not save your phone number. Please try again.' });
    return;
  }

  const isChange = !!oldPhone && oldPhone !== newPhone;
  if (isChange) {
    await anchorPhoneAndAlert({
      userId, oldPhone: oldPhone!, oldVerifiedAt, newPhone, email, firstName, schoolName,
    });
  }

  await logAudit({
    req,
    entityType: 'user_account',
    entityId: userId,
    action: 'update',
    label: isChange ? `Phone changed to ${maskPhone(newPhone)}` : 'Phone verified',
  });

  res.json({ verifiedAt: now });
}

// Opens (or chains) a phone-revert window and alerts the email on file.
// Mirrors applyEmailSwapAndAnchor: the first change in a window pins the
// anchor to the original good number; chained changes keep that anchor and
// only rotate the token, so an attacker can't move the revert target by
// changing the number twice. Best-effort — never blocks the change the
// user has already completed.
async function anchorPhoneAndAlert(opts: {
  userId: string;
  oldPhone: string;
  oldVerifiedAt: string | null;
  newPhone: string;
  email: string | null;
  firstName: string;
  schoolName: string;
}): Promise<void> {
  const { userId, oldPhone, oldVerifiedAt, newPhone, email, firstName, schoolName } = opts;
  try {
    // tenant-check-allow: phone_recovery_tokens is user-keyed (no school_id by design)
    const { data: existing } = await supabase
      .from('phone_recovery_tokens')
      .select('id, anchor_phone_e164, anchor_phone_verified_at')
      .eq('user_id', userId)
      .is('used_at', null)
      .gte('expires_at', new Date().toISOString())
      .order('expires_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const raw = generateToken();
    const expiresAt = new Date(Date.now() + PHONE_RECOVERY_TTL_MS).toISOString();
    let anchorPhone: string;

    if (existing) {
      anchorPhone = (existing as { anchor_phone_e164: string }).anchor_phone_e164;
      // tenant-check-allow: id sourced from row above
      await supabase.from('phone_recovery_tokens')
        .update({ latest_phone_e164: newPhone, token_hash: hashToken(raw), expires_at: expiresAt })
        .eq('id', (existing as { id: string }).id);
    } else {
      anchorPhone = oldPhone;
      // tenant-check-allow: phone_recovery_tokens is user-keyed (no school_id by design)
      await supabase.from('phone_recovery_tokens').insert({
        user_id: userId,
        anchor_phone_e164: oldPhone,
        anchor_phone_verified_at: oldVerifiedAt,
        latest_phone_e164: newPhone,
        token_hash: hashToken(raw),
        expires_at: expiresAt,
      });
    }

    if (!email || !email.includes('@')) return; // no inbox to alert; anchor still exists for admin-assisted revert

    const link = `${PORTAL_URL}/recover-phone?token=${raw}`;
    const schoolSuffix = schoolName ? ` (${schoolName})` : '';
    const subject = `Your Scholify phone number was changed${schoolSuffix}`;
    const chip = schoolName ? `Scholify · ${escapeHtml(schoolName)} · Security alert` : 'Scholify · Security alert';
    const text = [
      `Hi ${firstName || 'there'},`,
      '',
      `The phone number on your Scholify account${schoolName ? ` at ${schoolName}` : ''} was just changed to ${maskPhone(newPhone)}.`,
      '',
      'If this was you, no action is needed.',
      '',
      "If this wasn't you, click the link below to restore your previous number and sign out every device:",
      link,
      '',
      'This link expires in 7 days.',
    ].join('\n');
    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,Inter,sans-serif;background:#f8fafc;padding:24px">
        <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden">
          <div style="background:#b91c1c;padding:20px 24px;color:#fff">
            <div style="font-size:12px;opacity:.8;letter-spacing:.06em;text-transform:uppercase">${chip}</div>
            <div style="font-size:20px;font-weight:800;margin-top:4px">${escapeHtml(subject)}</div>
          </div>
          <div style="padding:24px;color:#0f172a">
            <p style="margin:0 0 12px;font-size:14px">Hi ${escapeHtml(firstName) || 'there'},</p>
            <p style="margin:0 0 16px;font-size:14px;line-height:1.55">The phone number on your Scholify account was just changed to <strong>${escapeHtml(maskPhone(newPhone))}</strong>.</p>
            <p style="margin:0 0 16px;font-size:14px;line-height:1.55">If this was you, no action is needed.</p>
            <p style="margin:0 0 8px;font-size:14px;line-height:1.55"><strong>If this wasn't you</strong>, click below to restore your previous number to <strong>${escapeHtml(maskPhone(anchorPhone))}</strong>. This also signs out every device using your account.</p>
            <p style="margin:0 0 16px">
              <a href="${link}" style="display:inline-block;background:#b91c1c;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:600">Undo &amp; sign out everywhere</a>
            </p>
            <p style="margin:0 0 8px;font-size:12px;color:#64748b">If the button doesn't work, paste this URL into your browser:</p>
            <p style="margin:0;font-size:12px;color:#64748b;word-break:break-all">${escapeHtml(link)}</p>
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">
            <p style="margin:0;font-size:12px;color:#64748b">This recovery link expires in 7 days.</p>
          </div>
        </div>
      </div>`;
    await sendMail(email, subject, html, text);
  } catch (err) {
    logger.error('phone-change anchor/alert failed', { userId, err });
  }
}

// ── POST /auth/recover-phone ───────────────────────────────────────────────
// Public — the revert link in the security alert lands here. The token IS
// the auth. Restores the previous verified number, signs out every
// session, and burns any in-flight phone OTP / step-up codes so an
// attacker mid-flow is cut off.
export async function recoverPhone(req: Request, res: Response): Promise<void> {
  const { token } = req.body as { token?: string };
  if (!token || typeof token !== 'string') {
    res.status(400).json({ error: 'token is required' });
    return;
  }

  // tenant-check-allow: phone_recovery_tokens is user-keyed; token_hash identifies the row
  const { data: row } = await supabase
    .from('phone_recovery_tokens')
    .select('id, user_id, anchor_phone_e164, anchor_phone_verified_at, latest_phone_e164, expires_at, used_at')
    .eq('token_hash', hashToken(token))
    .maybeSingle();
  if (!row) {
    res.status(400).json({ error: 'Invalid or expired link.' });
    return;
  }
  const r = row as {
    id: string; user_id: string; anchor_phone_e164: string | null;
    anchor_phone_verified_at: string | null; latest_phone_e164: string;
    expires_at: string; used_at: string | null;
  };
  if (r.used_at) {
    res.status(400).json({ error: 'This link has already been used.' });
    return;
  }
  if (new Date(r.expires_at) <= new Date()) {
    res.status(400).json({ error: 'This link has expired.' });
    return;
  }

  // tenant-check-allow: user_id sourced from the token row
  const { data: userRow } = await supabase
    .from('users')
    .select('school_id, username, role, phone_e164')
    .eq('id', r.user_id)
    .single();
  const u = userRow as { school_id?: string; username?: string; role?: string; phone_e164?: string | null } | null;
  const schoolId = u?.school_id;
  const role = u?.role;
  const attackerPhone = u?.phone_e164 || null;

  const now = new Date().toISOString();
  // tenant-check-allow: user_id sourced from the token row
  const { error: upErr } = await supabase
    .from('users')
    .update({ phone_e164: r.anchor_phone_e164, phone_verified_at: r.anchor_phone_verified_at })
    .eq('id', r.user_id);
  if (upErr) {
    res.status(500).json({ error: 'Could not restore your phone number.' });
    return;
  }
  if (schoolId && role) {
    await syncVerifiedPhoneToRoleTable(r.user_id, schoolId, role, r.anchor_phone_e164);
  }

  // tenant-check-allow: phone_recovery_tokens is user-keyed
  await supabase.from('phone_recovery_tokens').update({ used_at: now }).eq('id', r.id);
  // Sign out every session — kicks an attacker who set the number.
  // tenant-check-allow: refresh_tokens is user-keyed
  await supabase.from('refresh_tokens').update({ revoked_at: now }).eq('user_id', r.user_id).is('revoked_at', null);
  // Burn any in-flight phone OTP + step-up codes so a mid-flight attacker is cut off.
  // tenant-check-allow: both tables user-keyed
  await supabase.from('phone_otp_codes').update({ consumed_at: now }).eq('user_id', r.user_id).is('consumed_at', null);
  await supabase.from('step_up_challenges').update({ consumed_at: now }).eq('user_id', r.user_id).is('consumed_at', null);

  // Real-time kick: any connected client clears local auth immediately.
  if (schoolId) {
    getIo()?.to(`school:${schoolId}:user:${r.user_id}`).emit('force_logout', { reason: 'phone_recovered' });
  }

  // Audit inline — unauthenticated route, actor synthesized from the user row.
  if (schoolId) {
    try {
      // tenant-check-allow: school_id sourced from the user row above
      const { error: auditErr } = await supabase.from('audit_logs').insert({
        school_id: schoolId,
        entity_type: 'user_account',
        entity_id: r.user_id,
        action: 'update',
        changes: {
          phone: { old: attackerPhone, new: r.anchor_phone_e164 },
          sessions_revoked: true,
        },
        actor_id: r.user_id,
        actor_username: u?.username ?? null,
        actor_role: role ?? null,
        label: 'phone_recovery',
        reason: 'recovery_link_used',
      });
      if (auditErr) logger.error('audit insert for recoverPhone failed', { err: auditErr });
    } catch (err) {
      logger.error('audit insert for recoverPhone threw', { err });
    }
  }

  res.json({ phone: r.anchor_phone_e164 });
}

function mapVerifyReasonToStatus(r: string): number {
  switch (r) {
    case 'no_active_code':     return 404;
    case 'expired':            return 410;
    case 'too_many_attempts':  return 429;
    case 'mismatch':           return 400;
    case 'invalid_format':     return 400;
    default:                   return 400;
  }
}

// Back-sync the user-verified canonical phone to the role-table
// phone_number contact column. This is the reverse of the
// admin → users.phone_e164 propagation (utils/adminPhonePropagation.ts).
// Together they keep the role-table contact column and the auth-grade
// users.phone_e164 column in sync from both directions, so the admin's
// teacher/parent/driver edit pages always show the latest number.
//
// Only the three roles with a role-specific table get a write here —
// admin / supervisor / reception / accountant are "bare-users-row"
// roles that have no role table, so their phone lives only on users.
async function syncVerifiedPhoneToRoleTable(
  userId: string,
  schoolId: string,
  role: string,
  phoneE164: string | null,
): Promise<void> {
  const tableByRole: Record<string, string> = {
    parent: 'parents',
    teacher: 'teachers',
    driver: 'drivers',
  };
  const table = tableByRole[role];
  if (!table) return;
  try {
    // tenant-check-allow: filtered by school_id (from req.user) + user_id (the verifying caller)
    const { error } = await supabase
      .from(table)
      .update({ phone_number: phoneE164 })
      .eq('user_id', userId)
      .eq('school_id', schoolId);
    if (error) {
      logger.warn('role-table phone back-sync failed', { table, userId, error: error.message });
    }
  } catch (err) {
    logger.warn('role-table phone back-sync threw', { table, userId, error: (err as Error).message });
  }
}

function verifyReasonMessage(r: string): string {
  switch (r) {
    case 'no_active_code':     return 'No active verification code. Please request a new one.';
    case 'expired':            return 'Code expired. Please request a new one.';
    case 'too_many_attempts':  return 'Too many incorrect attempts. Please request a new code.';
    case 'mismatch':           return 'Code is incorrect.';
    case 'invalid_format':     return 'Code must be 6 digits.';
    default:                   return 'Could not verify code.';
  }
}

// ── POST /public/otpiq-webhook ─────────────────────────────────────────────
// OTPIQ POSTs delivery state changes here. The body is signed with our
// shared secret; we HMAC-verify before doing anything with it.
//
// Response is always 200 OK so OTPIQ doesn't retry on our internal
// errors — we log and move on. If signature fails we return 401 so
// they retry with the correct secret (signals misconfiguration).

const TIMING_SAFE_HEADER_NAMES = ['x-otpiq-signature', 'x-signature', 'signature'];

export async function otpiqDeliveryWebhook(req: Request, res: Response): Promise<void> {
  const secret = process.env.OTPIQ_WEBHOOK_SECRET || '';
  if (!secret) {
    logger.warn('otpiq webhook hit but OTPIQ_WEBHOOK_SECRET unset; rejecting');
    res.status(503).json({ error: 'webhook not configured' });
    return;
  }

  const supplied = pickSignatureHeader(req);
  // Raw-body middleware is wired on this route specifically so we can
  // verify the signature against the exact bytes OTPIQ signed.
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!rawBody) {
    logger.error('otpiq webhook missing raw body — middleware not wired');
    res.status(500).json({ error: 'server misconfigured' });
    return;
  }
  if (!supplied) {
    res.status(401).json({ error: 'missing signature' });
    return;
  }

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const ok = safeHexEqual(expected, supplied);
  if (!ok) {
    logger.warn('otpiq webhook signature mismatch', { ipAddr: req.ip });
    res.status(401).json({ error: 'bad signature' });
    return;
  }

  // Body is application/json. Parse from the verified rawBody, not
  // from req.body (we don't want a parser-mutated version slipping
  // past the HMAC).
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(rawBody.toString('utf8')); }
  catch { res.status(400).json({ error: 'invalid json' }); return; }

  const smsId = String(payload.smsId || '');
  const status = String(payload.status || '');
  const lastChannel = typeof payload.lastChannel === 'string' ? payload.lastChannel : undefined;
  if (!smsId || !status) {
    res.status(400).json({ error: 'missing smsId or status' });
    return;
  }

  // Look up the linked code row so we can back-fill school_id on the
  // event landing row. Best-effort — landing row is recorded even
  // when lookup fails.
  // tenant-check-allow: webhook is public; admin client used to resolve cross-tenant lookup
  const { data: codeRow } = await supabase
    .from('phone_otp_codes')
    .select('id, school_id')
    .eq('provider_sms_id', smsId)
    .maybeSingle();

  await supabase.from('phone_otp_delivery_events').insert({
    school_id: codeRow?.school_id ?? null,
    otp_code_id: codeRow?.id ?? null,
    provider_sms_id: smsId,
    status,
    last_channel: lastChannel ?? null,
    payload_json: payload,
  });

  try {
    await processDeliveryEvent({
      providerSmsId: smsId,
      status,
      lastChannel,
      payload,
    });
  } catch (err) {
    logger.error('processDeliveryEvent threw', { smsId, error: (err as Error).message });
  }

  res.status(200).json({ ok: true });
}

function pickSignatureHeader(req: Request): string | null {
  for (const name of TIMING_SAFE_HEADER_NAMES) {
    const v = req.headers[name];
    if (typeof v === 'string' && v.length > 0) {
      // Some providers prefix with "sha256=" — strip if present.
      return v.startsWith('sha256=') ? v.slice('sha256='.length) : v;
    }
  }
  return null;
}

function safeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}
