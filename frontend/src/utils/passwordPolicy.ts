// Client-side password policy — mirrors backend/src/utils/passwordPolicy.ts.
// Used by every form that creates or resets a password so the user gets the
// same error before submit, and the server still rejects anything that
// slips past as a defense-in-depth.
//
// Rules:
//   - at least 8 characters
//   - at most 200 characters
//   - at least one uppercase letter [A-Z]
//   - at least one special character (anything that isn't a letter or digit)

export const PASSWORD_POLICY_MESSAGE =
  'Password must be at least 8 characters and include an uppercase letter and a special character.';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200;

export function isStrongPassword(p: string | undefined | null): p is string {
  if (typeof p !== 'string') return false;
  if (p.length < PASSWORD_MIN_LENGTH || p.length > PASSWORD_MAX_LENGTH) return false;
  if (!/[A-Z]/.test(p)) return false;
  if (!/[^A-Za-z0-9]/.test(p)) return false;
  return true;
}
