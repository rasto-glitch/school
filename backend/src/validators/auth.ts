import { z } from 'zod';
import { nonEmptyStr, email, stepUpProof } from './common';
import { strongPasswordSchema } from '../utils/passwordPolicy';

// Auth input schemas (Phase 1a). Bounds are generous on purpose — these
// mirror what the handlers already accept; the value here is rejecting
// missing/wrong-typed/oversized input and stripping unknown keys before
// anything touches the auth/credential paths.

// `password` is the user-presented current-password on login / change-password
// — it must just be a non-empty string, since legacy accounts may have
// short passwords that predate the strong-password policy. `newPassword`
// is anything that will be hashed and stored, so it must satisfy the
// policy (see utils/passwordPolicy.ts).
const password = z.string().min(1).max(200);
const newPassword = strongPasswordSchema;
const username = z.string().trim().min(1).max(100);
const opaqueToken = z.string().trim().min(1).max(512);

export const loginSchema = z.object({
  username,
  password,
  portal: z.string().trim().max(32).optional(),
  // Phase 3 — present when the client has previously been granted a
  // "remember this browser" token. Tolerated, not required.
  trustedDeviceToken: z.string().trim().min(32).max(128).optional(),
});

export const forgotPasswordSchema = z.object({ username });

export const refreshSchema = z.object({ refreshToken: opaqueToken });

export const logoutSchema = z.object({ refreshToken: opaqueToken });

export const changePasswordSchema = z.object({
  currentPassword: password,
  newPassword,
});

export const firstTimeChangePasswordSchema = z.object({
  newPassword,
});

export const resetWithTokenSchema = z.object({
  token: opaqueToken,
  newPassword,
});

export const confirmEmailSchema = z.object({ token: opaqueToken });

export const verifyEmailCodeSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, 'A 6-digit code is required.'),
});

export const recoverAccountSchema = z.object({
  token: opaqueToken,
  newPassword,
});

export const updateMyEmailSchema = z.object({
  email,
  // Re-prompt for the current password before issuing a verification code
  // (or, on first-time set, before saving). Catches the unlocked-laptop /
  // hijacked-session attacker who has a live JWT but doesn't know the
  // password. Legacy callers without this field will fail open at the
  // controller layer with a 401, which the new UIs handle.
  currentPassword: password,
  // Step-up proof of an existing factor — required by the controller when
  // CHANGING an email and a factor is enrolled (migration 051). Optional
  // here: first-time set and factor-less accounts don't send it.
  proof: stepUpProof.optional(),
});

// Public revert link from the "your phone was changed" alert.
export const recoverPhoneSchema = z.object({
  token: z.string().trim().min(1).max(512),
});

// Dispatch a step-up proof code to an existing factor.
export const stepUpSendProofSchema = z.object({
  action: z.enum(['change_phone', 'change_email']),
  channel: z.enum(['sms', 'email']),
});

export const deviceTokenSchema = z.object({
  token: opaqueToken,
  language: z.string().trim().max(16).optional(),
});

export const removeDeviceTokenSchema = z.object({ token: opaqueToken });

export const deviceLanguageSchema = z.object({
  language: z.string().trim().min(1).max(16),
});

// MFA — TOTP code is always six digits. Recovery codes are
// XXXX-XXXX-XXXX (alphanumeric, optionally without dashes / mixed case).
// We accept anything that could plausibly be either form; the controller
// normalizes + verifies.
const totpOrRecovery = z.string().trim().min(6).max(32);

export const mfaConfirmSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'A 6-digit code is required.') });
export const mfaCodeSchema = z.object({ code: totpOrRecovery });
export const mfaDisableSelfSchema = z.object({
  currentPassword: password,
  code: z.string().trim().regex(/^\d{6}$/, 'A 6-digit code is required.'),
});
export const mfaVerifyLoginSchema = z.object({
  mfaTicket: opaqueToken,
  code: totpOrRecovery,
  rememberDevice: z.boolean().optional(),
  // Which armed factor the code is for. Absent ⇒ 'totp', so clients that
  // predate phone/email login OTP keep working unchanged.
  method: z.enum(['totp', 'phone', 'email']).optional(),
});

// Dispatch a login OTP to a chosen channel mid-sign-in. The mfaTicket is the
// auth (it proves the password step); totp needs no send, so phone/email only.
export const sendLoginOtpSchema = z.object({
  mfaTicket: opaqueToken,
  method: z.enum(['phone', 'email']),
});
export const mfaAdminDisableSchema = z.object({
  reason: z.string().trim().min(4).max(500),
});

// Forced enrollment (Phase 2). The ticket is the auth — the body
// otherwise mirrors the authenticated endpoints.
export const mfaEnrollSetupSchema = z.object({
  enrollmentTicket: opaqueToken,
});
export const mfaEnrollConfirmSchema = z.object({
  enrollmentTicket: opaqueToken,
  code: z.string().trim().regex(/^\d{6}$/, 'A 6-digit code is required.'),
  rememberDevice: z.boolean().optional(),
});

// ── Login-factor management (Phase 2) ──
// phone/email are the user-manageable channels; totp is also a valid
// preferred-default target but is armed via the existing setup/confirm flow.
export const manageableFactorParam = z.object({ factor: z.enum(['phone', 'email']) });
export const preferredFactorParam = z.object({ factor: z.enum(['totp', 'phone', 'email']) });
// enable + disable share a shape: re-auth password + the 6-digit channel code.
export const factorManageSchema = z.object({
  currentPassword: password,
  code: z.string().trim().regex(/^\d{6}$/, 'A 6-digit code is required.'),
});
