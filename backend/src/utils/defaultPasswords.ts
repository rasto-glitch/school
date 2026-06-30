// Default per-role passwords used by the admin create flows when the
// admin doesn't type one (bulk-uploaded parents, drivers added with a
// blank password field, teachers added the same way, and the staff-only
// roles supervisor / accountant / reception). Centralised here so:
//
//   1. the create flows all reach for the same string per role, and
//   2. the change-password endpoints can reject these strings outright,
//      so a user can't "change" Parent@123 to Teacher@123 and call it
//      done.
//
// Admin role is intentionally absent — the very first admin is created
// during school setup with an explicit password, and admin↔admin
// creation should always involve a typed credential. The createAccount
// handler enforces that.

export type DefaultPasswordRole =
  | 'parent'
  | 'teacher'
  | 'driver'
  | 'supervisor'
  | 'accountant'
  | 'reception'
  | 'staff';

const DEFAULTS: Record<DefaultPasswordRole, string> = {
  parent:     'Parent@123',
  teacher:    'Teacher@123',
  driver:     'Driver@123',
  supervisor: 'Supervisor@123',
  accountant: 'Accountant@123',
  reception:  'Reception@123',
  staff:      'Staff@123',
};

export function defaultPasswordFor(role: DefaultPasswordRole): string {
  return DEFAULTS[role];
}

// Case-sensitive set of every default we ship. The change-password
// endpoints (both the regular one and the first-time variant) check
// membership here and reject — otherwise a user could "rotate" through
// the defaults and never actually pick a real password.
export const DEFAULT_PASSWORDS: ReadonlySet<string> = new Set(Object.values(DEFAULTS));

export function isDefaultPassword(p: string): boolean {
  return DEFAULT_PASSWORDS.has(p);
}
