import crypto from 'crypto';
import { adminDb as supabase } from './db';
import { logger } from './logger';
import { sendMail } from './mailer';
import {
  sendVerification as otpiqSendVerification,
  OtpiqError,
  otpiqConfigured,
  type OtpiqStatus,
} from './otpiq';
import { toOtpiqFormat, maskPhone } from './phoneE164';

// Phone OTP core: code generation, hashing, send orchestration
// (OTPIQ WhatsApp + email fallback via our existing Resend SMTP),
// and verification. Migration 050 owns the schema (phone_otp_codes,
// phone_otp_delivery_events, users.phone_e164, users.phone_verified_at).
//
// Locked posture (FEATURE.md "Phone OTP"):
//   - 6-digit numeric codes, sha256-hashed at rest, 5-min TTL
//   - one row per generated code, channel lifecycle tracked via
//     per-channel timestamp columns rather than a state machine
//   - OTPIQ provider is 'whatsapp' only — if WhatsApp delivery fails,
//     we email the same code via the Resend pipeline. We do NOT pay
//     OTPIQ for SMS fallback (that's the 'whatsapp-sms' provider,
//     which we deliberately don't use)
//   - max 5 verify attempts per code; the 6th burns the code as
//     consumed_at (with a sentinel) so attackers can't brute-force
//
// Rate limits on /send live at the route layer (per-user, per-phone,
// per-IP). This module trusts the caller — it does NOT re-implement
// rate limiting here.

export type PhoneOtpPurpose = 'verify_phone' | 'forgot_password' | 'login_mfa';

const CODE_LENGTH = 6;
const TTL_MINUTES = 5;
const MAX_VERIFY_ATTEMPTS = 5;

// ── code generation + hashing ──────────────────────────────────────────────

// Cryptographic random 6-digit code. Uses crypto.randomInt for uniform
// distribution — Math.random would be predictable.
export function generateOtpCode(): string {
  // 000000 - 999999, zero-padded.
  const n = crypto.randomInt(0, 1_000_000);
  return n.toString().padStart(CODE_LENGTH, '0');
}

// Strip whitespace, then hash. Users may copy codes with spaces from
// WhatsApp; normalize before comparing.
function normalizeCode(input: string): string {
  return input.replace(/\s+/g, '');
}

export function hashOtpCode(code: string): string {
  return crypto.createHash('sha256').update(normalizeCode(code)).digest('hex');
}

function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

// ── send orchestration ────────────────────────────────────────────────────

export interface SendPhoneOtpInput {
  schoolId: string;
  userId: string;
  phoneE164: string;            // canonical +9647xxxxxxxxx
  purpose: PhoneOtpPurpose;
  // For email fallback. Optional — if missing, fallback silently no-ops
  // when WhatsApp fails, and the user must request a new code.
  emailFallback?: string | null;
  // Optional human label for the email subject — defaults to "Scholify".
  schoolName?: string | null;
}

export interface SendPhoneOtpResult {
  codeId: string;               // phone_otp_codes.id
  expiresAt: string;            // ISO timestamp
  whatsappQueued: boolean;      // OTPIQ accepted the send
  // If WhatsApp could not be queued (otpiq unconfigured, or returned
  // a transient failure), we IMMEDIATELY fire email fallback synchronously
  // and report that here. The user gets a code one way or another, or a
  // hard error if neither channel is available.
  emailFallbackSentImmediately: boolean;
}

export class PhoneOtpDeliveryFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PhoneOtpDeliveryFailedError';
  }
}

export async function sendPhoneOtp(input: SendPhoneOtpInput): Promise<SendPhoneOtpResult> {
  const code = generateOtpCode();
  const codeHash = hashOtpCode(code);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TTL_MINUTES * 60_000);

  // Insert the row first, before sending anywhere. If insertion fails,
  // we never send the code — better than a dangling delivered code we
  // can't verify against.
  // tenant-check-allow: schoolId sourced from req.user!.schoolId
  const { data: inserted, error: insertErr } = await supabase
    .from('phone_otp_codes')
    .insert({
      school_id: input.schoolId,
      user_id: input.userId,
      phone_e164: input.phoneE164,
      code_hash: codeHash,
      purpose: input.purpose,
      expires_at: expiresAt.toISOString(),
    })
    .select('id')
    .single();

  if (insertErr || !inserted) {
    logger.error('phone_otp insert failed', { error: insertErr?.message });
    throw new PhoneOtpDeliveryFailedError('Could not record OTP attempt');
  }
  const codeId = inserted.id as string;

  // Try WhatsApp via OTPIQ first.
  let whatsappQueued = false;
  let otpiqSmsId: string | null = null;
  let otpiqError: OtpiqError | null = null;

  if (otpiqConfigured()) {
    try {
      const r = await otpiqSendVerification({
        phoneNumber: toOtpiqFormat(input.phoneE164),
        verificationCode: code,
      });
      otpiqSmsId = r.smsId;
      whatsappQueued = true;
      logger.info('phone_otp whatsapp queued', {
        codeId,
        smsId: otpiqSmsId,
        phone: maskPhone(input.phoneE164),
      });
    } catch (err) {
      otpiqError = err as OtpiqError;
      logger.warn('phone_otp whatsapp queue failed', {
        codeId,
        category: otpiqError.category,
        message: otpiqError.message,
        phone: maskPhone(input.phoneE164),
      });
    }
  } else {
    logger.warn('OTPIQ not configured; skipping WhatsApp and going straight to email', { codeId });
  }

  const patch: Record<string, unknown> = {};
  if (whatsappQueued) {
    patch.provider_sms_id = otpiqSmsId;
    patch.whatsapp_sent_at = now.toISOString();
  }

  // If WhatsApp queueing failed synchronously (OTPIQ unreachable, auth
  // error, validation error), don't wait for the webhook — fire email
  // immediately. This matters most for parents who don't have WhatsApp:
  // OTPIQ returns success and webhook fires 'failed' later. The
  // webhook handler covers that path; this branch covers the case where
  // OTPIQ itself is unavailable.
  let emailFallbackSentImmediately = false;
  if (!whatsappQueued) {
    const fired = await fireEmailFallback({
      code,
      to: input.emailFallback,
      purpose: input.purpose,
      schoolName: input.schoolName,
    });
    if (fired) {
      patch.email_fallback_sent_at = now.toISOString();
      emailFallbackSentImmediately = true;
    } else if (!input.emailFallback) {
      // No WhatsApp, no email. Throw so the controller returns a 503
      // and the user sees "couldn't send the code" instead of silently
      // burning a code row they can never verify against.
      throw new PhoneOtpDeliveryFailedError(
        'OTP could not be delivered: WhatsApp is unavailable and no email is on file.',
      );
    }
  }

  if (Object.keys(patch).length > 0) {
    // tenant-check-allow: codeId returned from a school-scoped insert above
    const { error: patchErr } = await supabase
      .from('phone_otp_codes')
      .update(patch)
      .eq('id', codeId);
    if (patchErr) {
      logger.error('phone_otp patch failed', { codeId, error: patchErr.message });
    }
  }

  return {
    codeId,
    expiresAt: expiresAt.toISOString(),
    whatsappQueued,
    emailFallbackSentImmediately,
  };
}

// ── delivery-webhook orchestration ─────────────────────────────────────────

export interface DeliveryEventInput {
  providerSmsId: string;
  status: OtpiqStatus;
  lastChannel?: string;
  payload?: unknown;
}

// Called from the webhook controller after HMAC signature is verified
// and the event is logged to phone_otp_delivery_events. Returns
// whether an email fallback was triggered (informational; the
// controller's response to OTPIQ is unaffected).
export async function processDeliveryEvent(input: DeliveryEventInput): Promise<{ emailFallbackFired: boolean }> {
  // tenant-check-allow: webhook does not carry a JWT; adminDb is intentional and the lookup is scoped to the smsId
  const { data: row, error } = await supabase
    .from('phone_otp_codes')
    .select('id, school_id, user_id, phone_e164, code_hash, purpose, consumed_at, expires_at, email_fallback_sent_at, whatsapp_delivered_at, whatsapp_failed_at')
    .eq('provider_sms_id', input.providerSmsId)
    .maybeSingle();

  if (error || !row) {
    logger.warn('phone_otp webhook: no matching code row', { smsId: input.providerSmsId, error: error?.message });
    return { emailFallbackFired: false };
  }

  const now = new Date();
  const patch: Record<string, unknown> = {};

  if (isDeliveredStatus(input.status)) {
    if (!row.whatsapp_delivered_at) patch.whatsapp_delivered_at = now.toISOString();
  } else if (isFailureStatus(input.status)) {
    if (!row.whatsapp_failed_at) patch.whatsapp_failed_at = now.toISOString();
  }

  if (Object.keys(patch).length > 0) {
    const { error: patchErr } = await supabase
      .from('phone_otp_codes')
      .update(patch)
      .eq('id', row.id);
    if (patchErr) {
      logger.error('phone_otp webhook patch failed', { codeId: row.id, error: patchErr.message });
    }
  }

  // Email fallback decision:
  //   - delivery actually failed AND
  //   - the code is not already consumed AND
  //   - the code is not already expired AND
  //   - email fallback wasn't already fired
  // The webhook controller doesn't have the cleartext code (we hashed
  // it on send). Email fallback at this stage can ONLY tell the user
  // "your WhatsApp code didn't arrive; please request a new one" —
  // we can't email them the original. That's an acceptable UX trade:
  // it's safer (we never store cleartext) and the user will request
  // again, hitting our rate-limited /send.
  let emailFallbackFired = false;
  if (
    isFailureStatus(input.status) &&
    !row.consumed_at &&
    new Date(row.expires_at) > now &&
    !row.email_fallback_sent_at
  ) {
    const email = await lookupUserEmail(row.user_id);
    if (email) {
      try {
        await sendMail(
          email,
          'Your verification code could not be delivered',
          renderFallbackHtml(),
          renderFallbackText(),
        );
        emailFallbackFired = true;
        await supabase
          .from('phone_otp_codes')
          .update({ email_fallback_sent_at: now.toISOString() })
          .eq('id', row.id);
      } catch (err) {
        logger.error('phone_otp email fallback failed', { codeId: row.id, error: (err as Error).message });
      }
    } else {
      logger.warn('phone_otp email fallback skipped: no email on file', { userId: row.user_id });
    }
  }

  return { emailFallbackFired };
}

function isDeliveredStatus(s: OtpiqStatus): boolean {
  return s === 'delivered';
}

function isFailureStatus(s: OtpiqStatus): boolean {
  return s === 'failed' || s === 'expired' || s === 'undeliverable';
}

async function lookupUserEmail(userId: string): Promise<string | null> {
  // tenant-check-allow: webhook context — no JWT; adminDb is intentional
  const { data, error } = await supabase
    .from('users')
    .select('email')
    .eq('id', userId)
    .maybeSingle();
  if (error || !data) return null;
  const email = (data.email as string | null) || null;
  return email && email.includes('@') ? email : null;
}

async function fireEmailFallback(opts: {
  code: string;
  to?: string | null;
  purpose: PhoneOtpPurpose;
  schoolName?: string | null;
}): Promise<boolean> {
  if (!opts.to) return false;
  try {
    await sendMail(
      opts.to,
      'Your Scholify verification code',
      renderImmediateHtml(opts.code, opts.purpose, opts.schoolName),
      renderImmediateText(opts.code, opts.purpose, opts.schoolName),
    );
    return true;
  } catch (err) {
    logger.error('phone_otp immediate email fallback failed', { error: (err as Error).message });
    return false;
  }
}

function purposeLabel(purpose: PhoneOtpPurpose): string {
  switch (purpose) {
    case 'verify_phone':    return 'verify your phone number';
    case 'forgot_password': return 'reset your password';
    case 'login_mfa':       return 'sign in to your account';
  }
}

function renderImmediateText(code: string, purpose: PhoneOtpPurpose, schoolName?: string | null): string {
  const where = schoolName ? `Scholify (${schoolName})` : 'Scholify';
  return [
    `Your ${where} verification code is: ${code}`,
    '',
    `Use this code to ${purposeLabel(purpose)}. It expires in 5 minutes.`,
    '',
    "If you didn't request this code, you can safely ignore this email.",
  ].join('\n');
}

function renderImmediateHtml(code: string, purpose: PhoneOtpPurpose, schoolName?: string | null): string {
  const where = schoolName ? `Scholify (${schoolName})` : 'Scholify';
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,Inter,sans-serif;background:#f8fafc;padding:24px">
      <div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:32px;text-align:center">
        <div style="font-size:12px;color:#64748b;letter-spacing:.08em;text-transform:uppercase">${where} verification</div>
        <div style="font-size:36px;font-weight:700;letter-spacing:.2em;color:#0f172a;margin:20px 0;font-family:'SF Mono',Menlo,monospace">${code}</div>
        <div style="font-size:14px;color:#475569">Use this code to ${purposeLabel(purpose)}. It expires in 5 minutes.</div>
        <div style="margin-top:24px;font-size:12px;color:#94a3b8">If you didn't request this code, you can safely ignore this email.</div>
      </div>
    </div>
  `;
}

function renderFallbackText(): string {
  return [
    'We could not deliver your Scholify verification code via WhatsApp.',
    '',
    'For security, codes are never re-sent over email. Please return to the app',
    'and request a new code — it will be delivered again.',
    '',
    "If you didn't request a code, you can safely ignore this email.",
  ].join('\n');
}

function renderFallbackHtml(): string {
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,Inter,sans-serif;background:#f8fafc;padding:24px">
      <div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:32px">
        <div style="font-size:14px;color:#0f172a">We could not deliver your Scholify verification code via WhatsApp.</div>
        <div style="margin-top:16px;font-size:14px;color:#475569">For security, codes are never re-sent over email. Please return to the app and request a new code.</div>
        <div style="margin-top:24px;font-size:12px;color:#94a3b8">If you didn't request a code, you can safely ignore this email.</div>
      </div>
    </div>
  `;
}

// ── verification ───────────────────────────────────────────────────────────

export interface VerifyPhoneOtpInput {
  schoolId: string;
  userId: string;
  purpose: PhoneOtpPurpose;
  code: string;
}

export type VerifyPhoneOtpResult =
  | { ok: true; codeId: string }
  | { ok: false; reason: VerifyOtpFailureReason };

export type VerifyOtpFailureReason =
  | 'no_active_code'      // user never requested or all codes consumed/expired
  | 'expired'             // most recent code is expired
  | 'too_many_attempts'   // the active code has been burned
  | 'mismatch'            // code did not match the latest active code's hash
  | 'invalid_format';     // not 6 digits

// Finds the user's most recent unconsumed code for this purpose.
// Increments attempts on miss; sets consumed_at on hit; burns code
// after MAX_VERIFY_ATTEMPTS misses.
export async function verifyPhoneOtp(input: VerifyPhoneOtpInput): Promise<VerifyPhoneOtpResult> {
  const code = normalizeCode(input.code);
  if (!/^\d{6}$/.test(code)) {
    return { ok: false, reason: 'invalid_format' };
  }
  const inputHash = hashOtpCode(code);

  // tenant-check-allow: filtered by school_id + user_id, both sourced from req.user
  const { data: row, error } = await supabase
    .from('phone_otp_codes')
    .select('id, code_hash, attempts, consumed_at, expires_at')
    .eq('school_id', input.schoolId)
    .eq('user_id', input.userId)
    .eq('purpose', input.purpose)
    .is('consumed_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    logger.error('verify_phone_otp lookup failed', { error: error.message });
    return { ok: false, reason: 'no_active_code' };
  }
  if (!row) {
    return { ok: false, reason: 'no_active_code' };
  }

  const now = new Date();
  if (new Date(row.expires_at) <= now) {
    return { ok: false, reason: 'expired' };
  }
  if ((row.attempts ?? 0) >= MAX_VERIFY_ATTEMPTS) {
    // Burn it so a brute-forcer can't keep trying.
    await supabase
      .from('phone_otp_codes')
      .update({ consumed_at: now.toISOString() })
      .eq('id', row.id);
    return { ok: false, reason: 'too_many_attempts' };
  }

  const matches = constantTimeEqualHex(row.code_hash as string, inputHash);

  if (!matches) {
    await supabase
      .from('phone_otp_codes')
      .update({ attempts: (row.attempts ?? 0) + 1 })
      .eq('id', row.id);
    return { ok: false, reason: 'mismatch' };
  }

  // Consume the code so it can't be replayed.
  const { error: consumeErr } = await supabase
    .from('phone_otp_codes')
    .update({ consumed_at: now.toISOString() })
    .eq('id', row.id);
  if (consumeErr) {
    logger.error('verify_phone_otp consume failed', { codeId: row.id, error: consumeErr.message });
    // The user's code was right, but we couldn't burn it. Don't reject —
    // returning ok lets them proceed; in the worst case they can use
    // the code twice within 5 minutes, which is acceptable.
  }

  return { ok: true, codeId: row.id as string };
}
