// Admin capability/clearance model — the single source of truth for what an
// admin can be granted (Phase A). Mirrored on the frontend in
// frontend/src/constants/clearance.ts; keep the two in lockstep.
//
// MODEL
//   * Capabilities are the stored unit (users.admin_capabilities text[]).
//   * is_owner is the top tier: Owners hold EVERY capability implicitly and
//     are the only tier that can grant the Owner bit or the IT/finance/
//     audit/settings capabilities.
//   * Presets are combinable UI bundles (a union of capabilities), NOT a
//     stored value — we never persist a preset name, only the resolved caps.
//   * enrollment.read is the baseline every admin carries.
//
// Phase A ships the model + clearance panel + login gate; routes stay on
// authorize('admin') until Phase B/C swap them onto authorizeCapability().

export const CAPABILITIES = [
  'enrollment.read',       // see students/classes/enrollment (baseline)
  'students.manage',       // add/edit/remove students, classes, transfers-in scope
  'staff.manage',          // operational employee mgmt (non-sensitive)
  'academics.oversee',     // grades release, schedule, terms, weekly summaries
  'transfers.manage',      // outgoing/incoming student transfers
  'accounts.manage',       // login accounts, credentials, resets, MFA override (IT)
  'finance.read',          // read-only finance (Owner tier only)
  'hr.read',               // read decrypted PII + high-sensitivity documents
  'hr.manage',             // HR records, documents, policies, HR-officer grants
  'audit.read',            // audit log (IT)
  'settings.manage',       // school settings, logo, academic-year transition (IT)
  'announcements.moderate',// post/delete announcements + notifications
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const CAP_SET = new Set<string>(CAPABILITIES);
export function isCapability(s: unknown): s is Capability {
  return typeof s === 'string' && CAP_SET.has(s);
}

// Baseline capability every admin carries (granted implicitly alongside any
// preset; an admin with ONLY this is still "pending" for login purposes —
// see PENDING note below).
export const BASELINE_CAPABILITY: Capability = 'enrollment.read';

// ── Preset bundles (combinable) ────────────────────────────────────────────
// The clearance panel offers these as toggle groups. Owner is special-cased
// (it sets is_owner rather than listing caps) but its capability footprint is
// "everything" — listed here for display/validation completeness.
export const PRESETS = {
  owner: {
    key: 'owner',
    // Owners hold every capability implicitly; this list is the display set.
    capabilities: [...CAPABILITIES] as Capability[],
  },
  operations: {
    key: 'operations',
    capabilities: [
      'enrollment.read', 'students.manage', 'staff.manage',
      'academics.oversee', 'transfers.manage', 'announcements.moderate',
    ] as Capability[],
  },
  it: {
    key: 'it',
    capabilities: ['accounts.manage', 'audit.read', 'settings.manage'] as Capability[],
  },
  hr: {
    key: 'hr',
    capabilities: ['staff.manage', 'hr.read', 'hr.manage'] as Capability[],
  },
} as const;

export type PresetKey = keyof typeof PRESETS;

// ── Grant scope ────────────────────────────────────────────────────────────
// Who can grant which capabilities:
//   * Owner grants anything, including the Owner bit and finance.read.
//   * An hr.manage holder (non-owner HR admin) can grant the HR bundle +
//     Operations bundle only — so HR can onboard employees AND give them
//     their operational access, but cannot mint IT/finance/audit/settings
//     access or new Owners.
// finance.read is intentionally NOT delegable — Owner-only, read-only.
export const HR_GRANTABLE_CAPABILITIES: Capability[] = Array.from(new Set<Capability>([
  ...PRESETS.hr.capabilities,
  ...PRESETS.operations.capabilities,
]));

const HR_GRANTABLE_SET = new Set<string>(HR_GRANTABLE_CAPABILITIES);

export interface GranterContext {
  isOwner: boolean;
  capabilities: Capability[];
}

// Can this granter grant/revoke the given capability?
export function canGrantCapability(granter: GranterContext, cap: Capability): boolean {
  if (granter.isOwner) return true;
  // Non-owner delegation requires hr.manage and is limited to HR∪Operations.
  if (!granter.capabilities.includes('hr.manage')) return false;
  return HR_GRANTABLE_SET.has(cap);
}

// Can this granter set/clear the Owner bit? Owner-only.
export function canGrantOwner(granter: GranterContext): boolean {
  return granter.isOwner;
}

// Can this granter even SEE the clearance panel? Owner or any hr.manage
// holder (HR sees everyone but can only toggle HR∪Operations).
export function canViewClearancePanel(ctx: GranterContext): boolean {
  return ctx.isOwner || ctx.capabilities.includes('hr.manage');
}

// ── Login gate ─────────────────────────────────────────────────────────────
// An admin is "pending clearance" (cannot log in) when they are not an Owner
// and hold zero capabilities. Note: baseline enrollment.read is only present
// once a grant has happened, so a freshly-created-but-ungranted admin has an
// empty array and is correctly blocked.
export function isPendingClearance(row: {
  is_owner?: boolean | null;
  admin_capabilities?: string[] | null;
}): boolean {
  if (row.is_owner === true) return false;
  return !row.admin_capabilities || row.admin_capabilities.length === 0;
}

// Legacy bridge (Phase A only). The old users.is_hr_officer flag still gates
// decrypted-PII / high-sensitivity-document reads (utils/employeeDocs.ts)
// until Phase B swaps those onto capabilities. So every clearance write must
// keep is_hr_officer in sync with the hr.* capabilities — an Owner or any
// holder of hr.read/hr.manage IS an HR officer for the legacy gate. Without
// this, dissolving the old HR-Officers screen would strand PII access.
export function deriveHrOfficer(isOwner: boolean, capabilities: Capability[]): boolean {
  if (isOwner) return true;
  return capabilities.includes('hr.read') || capabilities.includes('hr.manage');
}

// Sanitize an arbitrary caps array down to known capabilities, deduped, with
// the baseline always included. Used when persisting a grant.
export function normalizeCapabilities(input: unknown): Capability[] {
  const arr = Array.isArray(input) ? input : [];
  const out = new Set<Capability>();
  for (const c of arr) if (isCapability(c)) out.add(c);
  if (out.size > 0) out.add(BASELINE_CAPABILITY); // baseline rides along once any cap is granted
  return Array.from(out);
}
