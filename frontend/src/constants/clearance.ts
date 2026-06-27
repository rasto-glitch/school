// Admin capability/clearance model — frontend mirror of
// backend/src/constants/clearance.ts. Keep the capability keys and preset
// bundles in lockstep with the backend; the server is authoritative for
// grant SCOPE (it re-validates every change), this file only drives display
// and the toggle UI.

export const CAPABILITIES = [
  'enrollment.read',
  'students.manage',
  'staff.manage',
  'academics.oversee',
  'transfers.manage',
  'accounts.manage',
  'finance.read',
  'hr.read',
  'hr.manage',
  'audit.read',
  'settings.manage',
  'announcements.moderate',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

// Display metadata. `i18nKey` resolves a human label/description; fallbacks
// are inline so the panel renders even before translations land.
export interface CapabilityMeta {
  key: Capability;
  group: 'operations' | 'hr' | 'it' | 'finance';
  label: string;
  description: string;
}

export const CAPABILITY_META: CapabilityMeta[] = [
  { key: 'enrollment.read',       group: 'operations', label: 'View enrollment',       description: 'See students, classes and enrollment (baseline).' },
  { key: 'students.manage',       group: 'operations', label: 'Manage students',       description: 'Add, edit and remove students and classes.' },
  { key: 'staff.manage',          group: 'operations', label: 'Manage staff',          description: 'Operational employee management (non-sensitive).' },
  { key: 'academics.oversee',     group: 'operations', label: 'Oversee academics',     description: 'Grade release, schedule, terms, weekly summaries.' },
  { key: 'transfers.manage',      group: 'operations', label: 'Manage transfers',      description: 'Outgoing and incoming student transfers.' },
  { key: 'announcements.moderate',group: 'operations', label: 'Announcements',         description: 'Post and delete announcements and notifications.' },
  { key: 'hr.read',               group: 'hr',         label: 'Read HR / PII',         description: 'View decrypted PII and high-sensitivity documents.' },
  { key: 'hr.manage',             group: 'hr',         label: 'Manage HR',             description: 'HR records, documents, policies and HR grants.' },
  { key: 'accounts.manage',       group: 'it',         label: 'Manage accounts',       description: 'Login accounts, credentials, resets, MFA override.' },
  { key: 'audit.read',            group: 'it',         label: 'View audit log',        description: 'Read the school audit log.' },
  { key: 'settings.manage',       group: 'it',         label: 'School settings',       description: 'School settings, logo, academic-year transition.' },
  { key: 'finance.read',          group: 'finance',    label: 'View finance',          description: 'Read-only finance (owner only).' },
];

export const GROUP_LABELS: Record<CapabilityMeta['group'], string> = {
  operations: 'Operations',
  hr: 'Human Resources',
  it: 'IT & Accounts',
  finance: 'Finance',
};

// Preset bundles (combinable). Owner is special — it sets the owner bit
// rather than a list — so it's not a togglable bundle here.
export const PRESET_BUNDLES: { key: 'operations' | 'it' | 'hr'; label: string; capabilities: Capability[] }[] = [
  { key: 'operations', label: 'Operations', capabilities: ['enrollment.read', 'students.manage', 'staff.manage', 'academics.oversee', 'transfers.manage', 'announcements.moderate'] },
  { key: 'it',         label: 'IT',         capabilities: ['accounts.manage', 'audit.read', 'settings.manage'] },
  { key: 'hr',         label: 'HR',         capabilities: ['staff.manage', 'hr.read', 'hr.manage'] },
];
