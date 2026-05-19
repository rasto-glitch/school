import { z } from 'zod';
import { nonEmptyStr, email } from './common';

// Auth input schemas (Phase 1a). Bounds are generous on purpose — these
// mirror what the handlers already accept; the value here is rejecting
// missing/wrong-typed/oversized input and stripping unknown keys before
// anything touches the auth/credential paths.

const password = z.string().min(1).max(200);
const newPassword = z.string().min(6, 'New password must be at least 6 characters').max(200);
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
