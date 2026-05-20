import { z } from 'zod';
import { nonEmptyStr, email } from './common';
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
});

export const forgotPasswordSchema = z.object({ username });

export const refreshSchema = z.object({ refreshToken: opaqueToken });

export const logoutSchema = z.object({ refreshToken: opaqueToken });

export const changePasswordSchema = z.object({
  currentPassword: password,
  newPassword,
});

export const resetWithTokenSchema = z.object({
  token: opaqueToken,
  newPassword,
});

export const confirmEmailSchema = z.object({ token: opaqueToken });

export const updateMyEmailSchema = z.object({ email });

export const deviceTokenSchema = z.object({
  token: opaqueToken,
  language: z.string().trim().max(16).optional(),
});

export const removeDeviceTokenSchema = z.object({ token: opaqueToken });

export const deviceLanguageSchema = z.object({
  language: z.string().trim().min(1).max(16),
});
