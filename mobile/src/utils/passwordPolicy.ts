// Mobile-side password policy — mirrors backend/src/utils/passwordPolicy.ts.
// Kept in sync with frontend/src/utils/passwordPolicy.ts. The server is the
// authoritative check (utils/passwordPolicy.ts); this is here so the user
// sees the rule before the request goes out.
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
