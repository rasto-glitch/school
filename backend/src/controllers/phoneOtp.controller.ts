import crypto from 'crypto';
import { Request, Response } from 'express';
import { adminDb as supabase } from '../utils/db';
import { logger } from '../utils/logger';
import { logAudit } from '../utils/audit';
import {
  sendPhoneOtp, verifyPhoneOtp, processDeliveryEvent,
  PhoneOtpDeliveryFailedError,
} from '../utils/phoneOtp';
import {
  parseIraqiPhone, phoneParseReasonMessage, maskPhone,
} from '../utils/phoneE164';
import type { AuthRequest } from '../middleware/auth';

// Phone OTP — Stage B controllers (verify phone). Stages C (forgot-
// password by phone) and A (login MFA by phone) ship later as
// separate endpoints; the underlying utils/phoneOtp.ts and
// migration 050 schema already accommodate them.
//
// Endpoints in this file:
//   POST /me/phone/send-verify-otp     — authenticated; rate-limited at route layer
//   POST /me/phone/confirm-verify-otp  — authenticated; rate-limited at route layer
//   POST /public/otpiq-webhook         — public; HMAC-verified inside handler

// ── POST /me/phone/send-verify-otp ─────────────────────────────────────────
// Body: { phone: string }. Normalizes to E.164 (+9647…), stamps it onto
// users.phone_e164 (clearing phone_verified_at if it changed), and
// triggers an OTPIQ WhatsApp send. Returns 202 with { codeId, expiresAt }
// — never the code itself.

export async function sendVerifyPhoneOtp(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const schoolId = req.user!.schoolId;
  const phoneRaw = (req.body?.phone ?? '') as string;

  const parsed = parseIraqiPhone(phoneRaw);
  if (!parsed.ok) {
    res.status(400).json({ error: phoneParseReasonMessage(parsed.reason) });
    return;
  }
  const phoneE164 = parsed.e164;

  // Persist the canonical phone on the user row. If it differs from
  // what's already there, clear phone_verified_at — re-verification is
  // mandatory after any phone change.
  // tenant-check-allow: filtered by id = req.user.userId, school-bound by schema
  const { data: existing, error: readErr } = await supabase
    .from('users')
    .select('phone_e164, email, schools(name)')
    .eq('id', userId)
    .maybeSingle();
  if (readErr || !existing) {
    res.status(500).json({ error: 'Failed to read user' });
    return;
  }

  const phoneChanged = existing.phone_e164 !== phoneE164;
  if (phoneChanged) {
    const { error: updErr } = await supabase
      .from('users')
      .update({ phone_e164: phoneE164, phone_verified_at: null })
      .eq('id', userId);
    if (updErr) {
      res.status(500).json({ error: 'Failed to record phone' });
      return;
    }
  }

  // Send.
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
// Body: { code: string }. Looks up the latest open verify_phone code
// for this user, validates, and on success stamps users.phone_verified_at.

export async function confirmVerifyPhoneOtp(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const schoolId = req.user!.schoolId;
  const code = (req.body?.code ?? '') as string;

  const result = await verifyPhoneOtp({
    schoolId,
    userId,
    purpose: 'verify_phone',
    code,
  });

  if (!result.ok) {
    const status = mapVerifyReasonToStatus(result.reason);
    res.status(status).json({ error: verifyReasonMessage(result.reason) });
    return;
  }

  const now = new Date().toISOString();
  const { data: stamped, error: updErr } = await supabase
    .from('users')
    .update({ phone_verified_at: now })
    .eq('id', userId)
    .select('phone_e164, role')
    .single();
  if (!updErr && stamped) {
    // Back-sync the now-verified canonical phone into the role-table
    // phone_number contact column so admin lists / employee edit pages
    // show the same number the user just verified. Best-effort.
    await syncVerifiedPhoneToRoleTable(
      userId, schoolId,
      (stamped as { role: string }).role,
      (stamped as { phone_e164: string | null }).phone_e164,
    );
  }
  if (updErr) {
    logger.error('confirmVerifyPhoneOtp stamp failed', { userId, error: updErr.message });
    // The user gave the right code; surfacing 500 here loses that. We
    // accept the verification and log the failure for ops follow-up.
  }

  await logAudit({
    req,
    entityType: 'user_account',
    entityId: userId,
    action: 'update',
    label: 'Phone verified',
  });

  res.json({ verifiedAt: now });
}

function mapVerifyReasonToStatus(r: ReturnType<typeof verifyReasonMessage> extends string ? string : never): number;
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
