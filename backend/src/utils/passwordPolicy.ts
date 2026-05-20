import { z } from 'zod';

// Server-side password policy. Mirrored on every client surface
// (frontend/src/utils/passwordPolicy.ts, mobile/src/utils/passwordPolicy.ts,
// master/client/src/utils/passwordPolicy.ts, master/server/src/utils/passwordPolicy.ts)
// so the user gets the same error before submit and the backend rejects
// anything that slips past — this file is the only authoritative check.
//
// Rules:
//   - at least 8 characters
//   - at most 200 characters (DoS guard, matches the existing string cap)
//   - at least one uppercase letter [A-Z]
//   - at least one special character (anything that isn't a letter or digit)
//
// The auto-generated default passwords used by createTeacher / createDriver /
// the bulk parent uploader (Parent@123 / Teacher@123 / Driver@123) all satisfy
// this policy, so the controller-side defaulting path doesn't need an exemption.

export const PASSWORD_POLICY_MESSAGE =
  'Password must be at least 8 characters and include an uppercase letter and a special character.';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200;

export function isStrongPassword(p: unknown): p is string {
  if (typeof p !== 'string') return false;
  if (p.length < PASSWORD_MIN_LENGTH || p.length > PASSWORD_MAX_LENGTH) return false;
  if (!/[A-Z]/.test(p)) return false;
  if (!/[^A-Za-z0-9]/.test(p)) return false;
  return true;
}

export const strongPasswordSchema = z
  .string()
  .max(PASSWORD_MAX_LENGTH)
  .refine(isStrongPassword, { message: PASSWORD_POLICY_MESSAGE });
