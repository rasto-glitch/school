// Master-client password policy — mirrors master/server/src/utils/passwordPolicy.ts
// and the backend/frontend/mobile copies. Server is the authoritative check;
// this exists so the operator sees the rule before submit.
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
