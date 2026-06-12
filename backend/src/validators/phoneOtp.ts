import { z } from 'zod';

// Phone OTP request schemas (migration 050 / Stage B).
//
// We accept any phone string and normalize via utils/phoneE164.ts at
// the controller layer — keeps the validation rule "non-empty bounded
// string" here and the format rules ("Iraqi, +964, 10 digits") in one
// place where they can evolve.

const phoneRaw = z.string().trim().min(1).max(40);
const otpCode = z.string().trim().regex(/^\d{6}$/, 'A 6-digit code is required.');

export const sendPhoneOtpSchema = z.object({
  phone: phoneRaw,
});

export const verifyPhoneOtpSchema = z.object({
  code: otpCode,
});

// OTPIQ webhook bodies are JSON; we accept any object and let the
// controller pick out the fields it cares about (status, smsId,
// lastChannel). Strict typing of the webhook payload would couple us
// to OTPIQ's field-naming churn — we only assert the two fields we
// actually branch on, in the controller.
export const otpiqWebhookSchema = z
  .object({
    smsId: z.string().min(1),
    status: z.string().min(1),
    lastChannel: z.string().optional(),
  })
  .passthrough();
