// Server-side password policy — mirrors backend/src/utils/passwordPolicy.ts.
// Kept as its own file (rather than imported across workspace boundaries)
// because master/server is a separate package with its own tsconfig.
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

export function isStrongPassword(p: unknown): p is string {
  if (typeof p !== 'string') return false;
  if (p.length < PASSWORD_MIN_LENGTH || p.length > PASSWORD_MAX_LENGTH) return false;
  if (!/[A-Z]/.test(p)) return false;
  if (!/[^A-Za-z0-9]/.test(p)) return false;
  return true;
}
