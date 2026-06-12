import { adminDb as supabase } from './db';
import { logger } from './logger';
import { parseIraqiPhone } from './phoneE164';

// Admin-trusted phone propagation. When an admin sets or updates a
// parent / teacher / driver / reception / accountant phone_number on
// the role table, mirror the value to users.phone_e164 + stamp
// users.phone_verified_at so the user receives WhatsApp OTPs at that
// number without re-entering it themselves.
//
// Mirrors the email pattern (admin sets users.email and that's it).
// The trade-off the school accepts: a typo'd phone silently routes
// OTPs to a stranger. We mitigate by:
//   - Normalising to canonical +964 form first (so admins typing
//     '0750…' or '+964 750 …' all converge).
//   - Refusing to populate users.phone_e164 for non-IQ / malformed
//     input — the role-table column keeps the original text as
//     contact info, but the auth-grade column stays NULL so we never
//     send a code to a definitely-wrong number.
//
// Best-effort: errors are logged and swallowed. The role-table
// phone_number write is the contract; the users.phone_e164 mirror is
// a convenience copy.

export async function propagateAdminSetPhone(
  userId: string,
  rawPhone: string | null | undefined,
): Promise<void> {
  if (!userId) return;
  try {
    // Admin cleared the field → clear the OTP-grade column too.
    if (rawPhone == null || rawPhone === '') {
      // tenant-check-allow: userId comes from a row we just inserted/updated under the admin's school-scoped controller
      await supabase
        .from('users')
        .update({ phone_e164: null, phone_verified_at: null })
        .eq('id', userId);
      return;
    }

    const parsed = parseIraqiPhone(rawPhone);
    if (!parsed.ok) {
      // Non-IQ or malformed input — keep auth-grade column NULL so we
      // never attempt to send a code to a number we can't validate.
      logger.info('admin phone propagation: skipping OTP-grade column write', {
        userId, reason: parsed.reason,
      });
      // tenant-check-allow: see above
      await supabase
        .from('users')
        .update({ phone_e164: null, phone_verified_at: null })
        .eq('id', userId);
      return;
    }

    // tenant-check-allow: see above
    await supabase
      .from('users')
      .update({
        phone_e164: parsed.e164,
        phone_verified_at: new Date().toISOString(),
      })
      .eq('id', userId);
  } catch (err) {
    logger.error('admin phone propagation failed', {
      userId, error: (err as Error).message,
    });
  }
}
