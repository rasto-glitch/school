import crypto from 'crypto';
import { adminDb as supabase } from './db';
import { logger } from './logger';
import { sendMail } from './mailer';
import {
  sendVerification as otpiqSendVerification,
  OtpiqError,
  otpiqConfigured,
} from './otpiq';
import { toOtpiqFormat, maskPhone } from './phoneE164';
import { verifyMfaCodeForUser } from '../controllers/mfa.controller';

// Step-up authentication for sensitive contact changes (migration 051).
//
// Changing an ALREADY-VERIFIED phone or email must prove control of an
// existing factor — not just a live session. This module centralizes
// that proof so both the phone-change and email-change controllers
// share one implementation. The locked policy:
//
//   password (enforced by the calling controller) + ONE existing factor,
//   offered in order of strength:
//     totp  — a code from the authenticator app (or a recovery code)
//     sms   — a code sent to the user's CURRENT verified phone
//     email — a code sent to the user's email on file
//
//   First-time set (no factor enrolled at all) skips this — there is no
//   factor to prove. The controller still requires the password and
//   still verifies the NEW channel.
//
// sms/email proof codes are persisted (hashed) in step_up_challenges and
// attempt-capped. totp proofs are verified inline by the MFA layer and
// never stored here.

// 'login_mfa' reuses this store for email OTP at sign-in (migration 053).
// Phone login OTP rides phone_otp_codes (purpose login_mfa) instead.
export type StepUpAction = 'change_phone' | 'change_email' | 'login_mfa';
export type StepUpChannel = 'sms' | 'email';
export type StepUpMethod = 'totp' | StepUpChannel;

const CODE_LENGTH = 6;
// Proofs live a little longer than a normal OTP: during a change the user
// is juggling two codes (the proof, then the new-channel code).
const TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;

// ── factor discovery ────────────────────────────────────────────────────────

export interface AvailableFactors {
  totp: boolean;
  phone: string | null;   // current VERIFIED phone (+9647…), else null
  email: string | null;   // email on file, else null
}

// What can this user prove? Reads the auth-grade phone (users.phone_e164
// gated on phone_verified_at), the email on file, and whether a confirmed,
// non-disabled TOTP secret exists.
export async function getAvailableFactors(userId: string): Promise<AvailableFactors> {
  // tenant-check-allow: users row keyed by id = the authenticated caller
  const { data: u } = await supabase
    .from('users')
    .select('phone_e164, phone_verified_at, email')
    .eq('id', userId)
    .maybeSingle();
  const row = u as { phone_e164: string | null; phone_verified_at: string | null; email: string | null } | null;
  const phone = row?.phone_verified_at && row?.phone_e164 ? row.phone_e164 : null;
  const email = row?.email && row.email.includes('@') ? row.email : null;

  // tenant-check-allow: user_mfa is user-keyed
  const { data: m } = await supabase
    .from('user_mfa')
    .select('confirmed_at, disabled_at')
    .eq('user_id', userId)
    .maybeSingle();
  const mm = m as { confirmed_at: string | null; disabled_at: string | null } | null;
  const totp = !!(mm && mm.confirmed_at && !mm.disabled_at);

  return { totp, phone, email };
}

export function hasAnyFactor(f: AvailableFactors): boolean {
  return f.totp || !!f.phone || !!f.email;
}

// Methods to offer the client, strongest first. 'sms' targets the CURRENT
// verified phone (the one being replaced, for a phone change) — a valid
// factor whenever the user still controls the old number.
export function offeredMethods(f: AvailableFactors): StepUpMethod[] {
  const out: StepUpMethod[] = [];
  if (f.totp) out.push('totp');
  if (f.phone) out.push('sms');
  if (f.email) out.push('email');
  return out;
}

// ── code helpers ─────────────────────────────────────────────────────────────

function generateCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(CODE_LENGTH, '0');
}
function hashCode(code: string): string {
  return crypto.createHash('sha256').update(code.replace(/\s+/g, '')).digest('hex');
}
function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}
function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '•••';
  const name = email.slice(0, at);
  const domain = email.slice(at);
  const head = name.slice(0, 1);
  return `${head}${'•'.repeat(Math.max(1, name.length - 1))}${domain}`;
}

// Typed error so controllers can map to a status + safe message.
export class StepUpError extends Error {
  status: number;
  code: string;
  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = 'StepUpError';
    this.code = code;
    this.status = status;
  }
}

// ── send proof (sms → old phone, or email) ───────────────────────────────────

export interface SendProofInput {
  schoolId: string;
  userId: string;
  action: StepUpAction;
  channel: StepUpChannel;
  schoolName?: string | null;
}

export interface SendProofResult {
  channel: StepUpChannel;
  sentTo: string;   // masked destination, safe to show the user
}

export async function sendStepUpProof(input: SendProofInput): Promise<SendProofResult> {
  const factors = await getAvailableFactors(input.userId);

  if (input.channel === 'sms') {
    if (!factors.phone) throw new StepUpError('no_phone', 400, 'There is no verified phone on file to send a code to.');
    if (!otpiqConfigured()) throw new StepUpError('sms_unavailable', 503, 'Phone verification is unavailable right now. Use another method.');
  } else if (!factors.email) {
    throw new StepUpError('no_email', 400, 'There is no email on file to send a code to.');
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + TTL_MINUTES * 60_000).toISOString();

  // Supersede any earlier open proof for the same (user, action, channel)
  // so only the most recent code is live.
  // tenant-check-allow: filtered by user_id (the caller) + action/channel
  await supabase
    .from('step_up_challenges')
    .update({ consumed_at: new Date().toISOString() })
    .eq('user_id', input.userId)
    .eq('action', input.action)
    .eq('channel', input.channel)
    .is('consumed_at', null);

  // tenant-check-allow: school_id sourced from req.user!.schoolId by the caller
  const { data: ins, error } = await supabase
    .from('step_up_challenges')
    .insert({
      school_id: input.schoolId,
      user_id: input.userId,
      action: input.action,
      channel: input.channel,
      code_hash: hashCode(code),
      expires_at: expiresAt,
    })
    .select('id')
    .single();
  if (error || !ins) {
    logger.error('step_up_challenge insert failed', { error: error?.message });
    throw new StepUpError('persist_failed', 500, 'Could not start verification. Please try again.');
  }

  if (input.channel === 'sms') {
    try {
      await otpiqSendVerification({ phoneNumber: toOtpiqFormat(factors.phone!), verificationCode: code });
    } catch (err) {
      const e = err as OtpiqError;
      logger.warn('step-up sms proof send failed', { category: e.category, message: e.message, phone: maskPhone(factors.phone!) });
      throw new StepUpError('sms_send_failed', 502, "We couldn't send a code to your current phone. Use another method.");
    }
    return { channel: 'sms', sentTo: maskPhone(factors.phone!) };
  }

  try {
    await sendMail(
      factors.email!,
      input.action === 'login_mfa' ? 'Your Scholify sign-in code' : 'Your Scholify verification code',
      renderProofHtml(code, input.schoolName, input.action),
      renderProofText(code, input.schoolName, input.action),
    );
  } catch (err) {
    logger.error('step-up email proof send failed', { error: (err as Error).message });
    throw new StepUpError('email_send_failed', 502, "We couldn't send a code to your email. Use another method.");
  }
  return { channel: 'email', sentTo: maskEmail(factors.email!) };
}

// ── verify proof ─────────────────────────────────────────────────────────────

export interface StepUpProof {
  method: StepUpMethod;
  code: string;
}

export type StepUpVerifyResult =
  | { ok: true; method: StepUpMethod }
  | { ok: false; reason: StepUpFailureReason; offered: StepUpMethod[] };

export type StepUpFailureReason =
  | 'proof_required'
  | 'method_unavailable'
  | 'no_active_code'
  | 'expired'
  | 'too_many_attempts'
  | 'bad_code';

// Verify a single-factor proof for `action`. The caller has already
// checked the password. Returns the offered method list on failure so the
// client can guide the user to an alternative.
export async function verifyStepUp(
  userId: string,
  action: StepUpAction,
  proof: StepUpProof | undefined,
): Promise<StepUpVerifyResult> {
  const factors = await getAvailableFactors(userId);
  const offered = offeredMethods(factors);

  if (!proof || !proof.method || typeof proof.code !== 'string' || !proof.code.trim()) {
    return { ok: false, reason: 'proof_required', offered };
  }

  if (proof.method === 'totp') {
    if (!factors.totp) return { ok: false, reason: 'method_unavailable', offered };
    const r = await verifyMfaCodeForUser(userId, proof.code.trim());
    if (r === 'ok') return { ok: true, method: 'totp' };
    return { ok: false, reason: r === 'no_mfa' ? 'method_unavailable' : 'bad_code', offered };
  }

  // sms / email — look up the latest open challenge for this channel.
  const channel: StepUpChannel = proof.method;
  if ((channel === 'sms' && !factors.phone) || (channel === 'email' && !factors.email)) {
    return { ok: false, reason: 'method_unavailable', offered };
  }
  const code = proof.code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(code)) return { ok: false, reason: 'bad_code', offered };

  // tenant-check-allow: filtered by user_id (the caller) + action/channel
  const { data: row } = await supabase
    .from('step_up_challenges')
    .select('id, code_hash, attempts, consumed_at, expires_at')
    .eq('user_id', userId)
    .eq('action', action)
    .eq('channel', channel)
    .is('consumed_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const r = row as { id: string; code_hash: string; attempts: number | null; consumed_at: string | null; expires_at: string } | null;

  if (!r) return { ok: false, reason: 'no_active_code', offered };
  if (new Date(r.expires_at) <= new Date()) return { ok: false, reason: 'expired', offered };
  if ((r.attempts ?? 0) >= MAX_ATTEMPTS) {
    await supabase.from('step_up_challenges').update({ consumed_at: new Date().toISOString() }).eq('id', r.id);
    return { ok: false, reason: 'too_many_attempts', offered };
  }
  if (!constantTimeEqualHex(r.code_hash, hashCode(code))) {
    await supabase.from('step_up_challenges').update({ attempts: (r.attempts ?? 0) + 1 }).eq('id', r.id);
    return { ok: false, reason: 'bad_code', offered };
  }
  await supabase.from('step_up_challenges').update({ consumed_at: new Date().toISOString() }).eq('id', r.id);
  return { ok: true, method: channel };
}

// Maps a verify failure to a safe user-facing message.
export function stepUpReasonMessage(reason: StepUpFailureReason): string {
  switch (reason) {
    case 'proof_required':     return 'Additional verification is required to change this.';
    case 'method_unavailable': return 'That verification method is not available on your account.';
    case 'no_active_code':     return 'No active verification code. Request a new one.';
    case 'expired':            return 'That verification code expired. Request a new one.';
    case 'too_many_attempts':  return 'Too many incorrect attempts. Request a new code.';
    case 'bad_code':           return 'That verification code is incorrect.';
  }
}

// ── proof email body ─────────────────────────────────────────────────────────

function renderProofText(code: string, schoolName?: string | null, action?: StepUpAction): string {
  const where = schoolName ? `Scholify (${schoolName})` : 'Scholify';
  const instruction = action === 'login_mfa'
    ? 'Enter this code to finish signing in. It expires in 10 minutes.'
    : 'Enter this code to confirm a change to your account contact details. It expires in 10 minutes.';
  return [
    `Your ${where} verification code is: ${code}`,
    '',
    instruction,
    '',
    "If you didn't request this, you can ignore this email — and consider changing your password.",
  ].join('\n');
}

function renderProofHtml(code: string, schoolName?: string | null, action?: StepUpAction): string {
  const where = schoolName ? `Scholify (${schoolName})` : 'Scholify';
  const instruction = action === 'login_mfa'
    ? 'Enter this code to finish signing in. It expires in 10 minutes.'
    : 'Enter this code to confirm a change to your account contact details. It expires in 10 minutes.';
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,Inter,sans-serif;background:#f8fafc;padding:24px">
      <div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:32px;text-align:center">
        <div style="font-size:12px;color:#64748b;letter-spacing:.08em;text-transform:uppercase">${where} verification</div>
        <div style="font-size:36px;font-weight:700;letter-spacing:.2em;color:#0f172a;margin:20px 0;font-family:'SF Mono',Menlo,monospace">${code}</div>
        <div style="font-size:14px;color:#475569">${instruction}</div>
        <div style="margin-top:24px;font-size:12px;color:#94a3b8">If you didn't request this, you can ignore this email — and consider changing your password.</div>
      </div>
    </div>
  `;
}
