import { adminDb as supabase } from './db';
import { getAvailableFactors, sendStepUpProof, verifyStepUp, type StepUpMethod, type AvailableFactors } from './stepUp';
import { sendPhoneOtp, verifyPhoneOtp } from './phoneOtp';

// Login second-factor orchestration — Phase 1 of "phone/email OTP at sign-in".
//
// Today the only login factor is TOTP (user_mfa). This module introduces a
// factor REGISTRY (mfa_login_factors, migration 052) plus the send/verify
// dispatch that lets phone (WhatsApp/SMS OTP) and email OTP act as login
// second factors too, reusing the existing primitives:
//   * phone → phone_otp_codes (purpose 'login_mfa')          [utils/phoneOtp]
//   * email → step_up_challenges (action 'login_mfa')        [utils/stepUp]
//   * totp  → user_mfa, verified via stepUp's TOTP delegation [utils/stepUp]
//
// Phase 1 is intentionally inert in production: nothing arms phone/email yet
// (the enable/disable endpoints + hub toggles are Phase 2/3), so the registry
// is empty and getArmedLoginFactors() resolves to exactly the pre-existing
// TOTP gate. The plumbing is here and testable; the login experience does not
// change until a factor is armed.

export type LoginFactorMethod = 'totp' | 'phone' | 'email';

export interface ArmedLoginFactors {
  // Factors that are BOTH armed in the registry AND currently usable
  // (confirmed TOTP / verified phone / email on file), strongest-first.
  methods: LoginFactorMethod[];
  preferred: LoginFactorMethod | null;
}

// What can this user sign in with as a second factor? Folds the registry
// together with live availability. TOTP is special-cased for back-compat:
// a confirmed authenticator counts whether or not a 052 row exists yet, so
// users who enrolled before this migration keep being challenged.
export async function getArmedLoginFactors(userId: string): Promise<ArmedLoginFactors> {
  const factors = await getAvailableFactors(userId);

  // tenant-check-allow: mfa_login_factors is user-keyed; userId is the authenticated caller or the subject of a just-verified, school-scoped MFA ticket
  const { data: rows } = await supabase
    .from('mfa_login_factors')
    .select('factor, is_preferred')
    .eq('user_id', userId)
    .is('disabled_at', null);
  const reg = (rows as { factor: LoginFactorMethod; is_preferred: boolean }[] | null) || [];
  const armed = new Set<LoginFactorMethod>(reg.map(r => r.factor));
  const preferredRow = reg.find(r => r.is_preferred);

  const methods: LoginFactorMethod[] = [];
  if (factors.totp) methods.push('totp');                       // back-compat bridge
  if (armed.has('phone') && factors.phone) methods.push('phone');
  if (armed.has('email') && factors.email) methods.push('email');

  let preferred: LoginFactorMethod | null = null;
  if (preferredRow && methods.includes(preferredRow.factor)) preferred = preferredRow.factor;
  if (!preferred) preferred = methods[0] ?? null;

  return { methods, preferred };
}

// ── send a login OTP to a chosen channel (phone / email) ─────────────────────

export type SendLoginOtpResult =
  | { ok: true; channel: 'whatsapp' | 'email' }
  | { ok: false; reason: 'not_armed' | 'unavailable' | 'send_failed' };

// Dispatch a sign-in code. Gated on the method being armed for this user, so
// a stray ticket can't be used to spray codes to a channel the user never
// turned on. TOTP needs no send (the code comes from the authenticator app).
// Low-level dispatch: send a login-style OTP to a channel. Availability is
// checked here; the ARMED gate is the caller's job (login sends require armed,
// setup/teardown sends require only that the channel exists).
async function dispatchFactorOtp(opts: {
  schoolId: string;
  userId: string;
  method: 'phone' | 'email';
  factors: AvailableFactors;
  schoolName?: string | null;
}): Promise<SendLoginOtpResult> {
  if (opts.method === 'phone') {
    if (!opts.factors.phone) return { ok: false, reason: 'unavailable' };
    try {
      const r = await sendPhoneOtp({
        schoolId: opts.schoolId,
        userId: opts.userId,
        phoneE164: opts.factors.phone,
        purpose: 'login_mfa',
        emailFallback: opts.factors.email,       // WhatsApp down → same code by email
        schoolName: opts.schoolName,
      });
      return { ok: true, channel: r.whatsappQueued ? 'whatsapp' : 'email' };
    } catch {
      return { ok: false, reason: 'send_failed' };
    }
  }

  if (!opts.factors.email) return { ok: false, reason: 'unavailable' };
  try {
    await sendStepUpProof({
      schoolId: opts.schoolId,
      userId: opts.userId,
      action: 'login_mfa',
      channel: 'email',
      schoolName: opts.schoolName,
    });
    return { ok: true, channel: 'email' };
  } catch {
    return { ok: false, reason: 'send_failed' };
  }
}

// Login send: gated on the method being ARMED for this user.
export async function sendLoginOtp(opts: {
  schoolId: string;
  userId: string;
  method: 'phone' | 'email';
  schoolName?: string | null;
}): Promise<SendLoginOtpResult> {
  const armed = await getArmedLoginFactors(opts.userId);
  if (!armed.methods.includes(opts.method)) return { ok: false, reason: 'not_armed' };
  const factors = await getAvailableFactors(opts.userId);
  return dispatchFactorOtp({ ...opts, factors });
}

// Setup/teardown send: a confirmation code for arming or disarming a factor,
// gated on AVAILABILITY only (the factor isn't armed yet when enabling).
export async function sendFactorSetupCode(opts: {
  schoolId: string;
  userId: string;
  method: 'phone' | 'email';
  schoolName?: string | null;
}): Promise<SendLoginOtpResult> {
  const factors = await getAvailableFactors(opts.userId);
  return dispatchFactorOtp({ ...opts, factors });
}

// ── verify a submitted login second-factor code ──────────────────────────────

export type LoginVerifyFailure = 'unavailable' | 'wrong' | 'expired' | 'too_many' | 'no_code';

export type VerifyLoginSecondFactorResult =
  | { ok: true; method: LoginFactorMethod }
  | { ok: false; reason: LoginVerifyFailure };

export async function verifyLoginSecondFactor(opts: {
  userId: string;
  schoolId: string;
  method: LoginFactorMethod;
  code: string;
}): Promise<VerifyLoginSecondFactorResult> {
  if (opts.method === 'phone') {
    const r = await verifyPhoneOtp({ schoolId: opts.schoolId, userId: opts.userId, purpose: 'login_mfa', code: opts.code });
    if (r.ok) return { ok: true, method: 'phone' };
    return { ok: false, reason: mapPhoneFailure(r.reason) };
  }

  // totp + email verify through utils/stepUp: totp delegates inline to the
  // MFA layer (and keeps its failed-attempt counter); email reads the latest
  // open step_up_challenges row for action 'login_mfa'.
  const stepMethod: StepUpMethod = opts.method === 'totp' ? 'totp' : 'email';
  const r = await verifyStepUp(opts.userId, 'login_mfa', { method: stepMethod, code: opts.code });
  if (r.ok) return { ok: true, method: opts.method };
  return { ok: false, reason: mapStepUpFailure(r.reason) };
}

function mapPhoneFailure(reason: string): LoginVerifyFailure {
  switch (reason) {
    case 'expired': return 'expired';
    case 'too_many_attempts': return 'too_many';
    case 'no_active_code': return 'no_code';
    default: return 'wrong';            // mismatch / invalid_format
  }
}

function mapStepUpFailure(reason: string): LoginVerifyFailure {
  switch (reason) {
    case 'method_unavailable': return 'unavailable';
    case 'no_active_code':
    case 'proof_required': return 'no_code';
    case 'expired': return 'expired';
    case 'too_many_attempts': return 'too_many';
    default: return 'wrong';            // bad_code
  }
}

// ── factor management (Phase 2) ──────────────────────────────────────────────

export interface FactorStatus {
  factor: LoginFactorMethod;
  available: boolean;   // channel usable (confirmed TOTP / verified phone / email on file)
  armed: boolean;       // turned on as a sign-in factor
  preferred: boolean;   // offered first at login
}

// Status of all three factors for the management hub.
export async function listFactors(userId: string): Promise<FactorStatus[]> {
  const factors = await getAvailableFactors(userId);
  const armed = await getArmedLoginFactors(userId);
  const available: Record<LoginFactorMethod, boolean> = {
    totp: factors.totp, phone: !!factors.phone, email: !!factors.email,
  };
  return (['totp', 'phone', 'email'] as LoginFactorMethod[]).map(f => ({
    factor: f,
    available: available[f],
    armed: armed.methods.includes(f),
    preferred: armed.preferred === f,
  }));
}

// Email may never be the SOLE factor. Returns false if removing `factor`
// would leave email armed with no strong partner (phone or totp) remaining.
export async function canRemoveFactor(userId: string, factor: LoginFactorMethod): Promise<boolean> {
  const armed = (await getArmedLoginFactors(userId)).methods;
  if (!armed.includes('email')) return true;
  return armed.some(m => m !== factor && (m === 'phone' || m === 'totp'));
}

// Arm a factor as a login second factor. Idempotent (re-arming flips
// disabled_at back to null). The user's FIRST factor also becomes preferred.
export async function armFactor(schoolId: string, userId: string, factor: LoginFactorMethod): Promise<void> {
  const wasFirst = (await getArmedLoginFactors(userId)).methods.length === 0;
  const now = new Date().toISOString();

  // tenant-check-allow: mfa_login_factors is user-keyed; userId is the authenticated caller
  const { data: existing } = await supabase
    .from('mfa_login_factors').select('id').eq('user_id', userId).eq('factor', factor).maybeSingle();

  if (existing) {
    // tenant-check-allow: row addressed by its own id, already user-scoped above
    await supabase.from('mfa_login_factors')
      .update({ enabled_at: now, disabled_at: null }).eq('id', (existing as { id: string }).id);
  } else {
    // tenant-check-allow: school_id + user_id sourced from the authenticated caller
    await supabase.from('mfa_login_factors')
      .insert({ school_id: schoolId, user_id: userId, factor, enabled_at: now, is_preferred: false });
  }

  if (wasFirst) await setPreferredFactor(schoolId, userId, factor);
}

// Disarm a factor. Clears its preferred flag; the login layer then falls back
// to the next strongest armed factor automatically.
export async function disarmFactor(userId: string, factor: LoginFactorMethod): Promise<void> {
  // tenant-check-allow: mfa_login_factors is user-keyed; userId is the authenticated caller
  await supabase.from('mfa_login_factors')
    .update({ disabled_at: new Date().toISOString(), is_preferred: false })
    .eq('user_id', userId).eq('factor', factor).is('disabled_at', null);
}

// Disarm EVERY login factor for a user — the admin break-glass path (a user
// locked out of a phone/email factor with no recovery codes yet).
export async function cascadeDisarmAll(userId: string): Promise<void> {
  // tenant-check-allow: mfa_login_factors is user-keyed; targets the given user's rows
  await supabase.from('mfa_login_factors')
    .update({ disabled_at: new Date().toISOString(), is_preferred: false })
    .eq('user_id', userId).is('disabled_at', null);
}

// Set the preferred (default-at-login) factor. Lazily creates a totp registry
// row when a confirmed-TOTP user picks it. Clear-then-set keeps the
// one-preferred-per-user partial unique index satisfied.
export async function setPreferredFactor(schoolId: string, userId: string, factor: LoginFactorMethod): Promise<void> {
  // tenant-check-allow: mfa_login_factors is user-keyed; userId is the authenticated caller
  const { data: existing } = await supabase
    .from('mfa_login_factors').select('id').eq('user_id', userId).eq('factor', factor).maybeSingle();
  if (!existing) {
    // tenant-check-allow: school_id + user_id sourced from the authenticated caller
    await supabase.from('mfa_login_factors')
      .insert({ school_id: schoolId, user_id: userId, factor, enabled_at: new Date().toISOString(), is_preferred: false });
  }
  // tenant-check-allow: mfa_login_factors is user-keyed; userId is the authenticated caller
  await supabase.from('mfa_login_factors').update({ is_preferred: false }).eq('user_id', userId).eq('is_preferred', true);
  // tenant-check-allow: mfa_login_factors is user-keyed; userId is the authenticated caller
  await supabase.from('mfa_login_factors').update({ is_preferred: true }).eq('user_id', userId).eq('factor', factor).is('disabled_at', null);
}
