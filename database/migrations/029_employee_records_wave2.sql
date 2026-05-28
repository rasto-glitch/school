-- 029_employee_records_wave2.sql
-- Wave 2 of the employee legal-compliance records system. Builds on Wave 1
-- (migration 028) to add the structured PII, emergency contacts, per-school
-- acknowledgement policies, employee action log (reviews / warnings /
-- terminations), plus the audit-log widening for the new entity types.
-- See memory/employee-records-plan.md for the locked decisions and the
-- two-wave plan.
--
-- Encryption-at-rest: the columns marked "encrypted" below store the
-- ciphertext + IV + auth tag in a single `vN:<base64-iv>:<base64-ct+tag>`
-- string, produced by backend/src/utils/employeePiiCrypto.ts. The DB never
-- sees plaintext. A separate `<col>_lookup_hash` column is set for fields
-- the backend needs to search by (national ID search, IBAN-duplicate
-- detection) — it stores `sha256(value + per-school-salt)` so equality
-- lookups work without decrypting.
--
-- Archive coverage: on archive (admin.controller's performEmployeeArchive),
-- the new Wave-2 tables' owner_type pointer is rewritten from
-- 'teachers'/'drivers'/'staff_members'/'users' to 'archived_employees' with
-- the new archive id. employee_documents (from Wave 1) gets the same
-- rewrite. The rows survive the cascade because their school_id + owner_id
-- aren't FKs — they're polymorphic pointers.

-- ── employee_extended_profile ──────────────────────────────────────────────
-- One row per (owner_type, owner_id). Owner can be teachers/drivers/
-- staff_members/users (active) or archived_employees (after archive).
-- Sensitive columns (mother/father/spouse/religion/SSN/IBAN) store
-- ciphertext; their lookup_hash counterparts enable equality search.
-- redacted_at is set by the right-to-erasure flow: it NULLs every
-- encrypted column + the lookup hashes and keeps the row as a tombstone so
-- the archive integrity chain (which references this row's existence)
-- still verifies.

CREATE TABLE IF NOT EXISTS employee_extended_profile (
  school_id              UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  owner_type             TEXT NOT NULL,
  owner_id               UUID NOT NULL,

  -- Plaintext fields — non-sensitive or low-sensitivity by spec.
  place_of_birth         TEXT,
  nationality            TEXT,
  blood_type             TEXT,
  languages_spoken       TEXT[],
  dependents_count       INTEGER,
  bank_name              TEXT,

  -- Encrypted fields. NULL means "not set" — empty string means error.
  mother_full_name_ct    TEXT,
  father_full_name_ct    TEXT,
  spouse_name_ct         TEXT,
  religion_ct            TEXT,
  bank_iban_ct           TEXT,
  tax_id_ct              TEXT,
  social_insurance_no_ct TEXT,

  -- Lookup hashes for the searchable encrypted fields.
  bank_iban_lookup_hash       TEXT,
  tax_id_lookup_hash          TEXT,
  social_insurance_lookup_hash TEXT,

  -- Lawful-basis record (GDPR-style consent stamp).
  consent_pii_at         TIMESTAMPTZ,
  consent_pii_by         UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Right-to-erasure tombstone.
  redacted_at            TIMESTAMPTZ,
  redacted_by            UUID REFERENCES users(id) ON DELETE SET NULL,
  redacted_reason        TEXT,

  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (owner_type, owner_id),
  CONSTRAINT employee_extended_profile_owner_type_check CHECK (
    owner_type IN ('users','teachers','drivers','staff_members','archived_employees')
  )
);

CREATE INDEX IF NOT EXISTS idx_employee_extended_profile_school
  ON employee_extended_profile(school_id);

-- Lookup hash indexes (partial — null-skipping).
CREATE INDEX IF NOT EXISTS idx_employee_extended_profile_iban_hash
  ON employee_extended_profile(school_id, bank_iban_lookup_hash)
  WHERE bank_iban_lookup_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_employee_extended_profile_taxid_hash
  ON employee_extended_profile(school_id, tax_id_lookup_hash)
  WHERE tax_id_lookup_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_employee_extended_profile_si_hash
  ON employee_extended_profile(school_id, social_insurance_lookup_hash)
  WHERE social_insurance_lookup_hash IS NOT NULL;

-- ── employee_emergency_contacts ────────────────────────────────────────────
-- Multi-contact replacement for the free-text emergency_contact column on
-- users/teachers/drivers/staff_members. Wave 1's column stays in place for
-- one release as a fallback read; Wave 3 drops it once admins have
-- migrated. Priority ordering (1 = primary).

CREATE TABLE IF NOT EXISTS employee_emergency_contacts (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id    UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  owner_type   TEXT NOT NULL,
  owner_id     UUID NOT NULL,
  full_name    TEXT NOT NULL,
  relationship TEXT,
  phone        TEXT,
  alt_phone    TEXT,
  email        TEXT,
  address      TEXT,
  priority     SMALLINT NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT employee_emergency_contacts_owner_type_check CHECK (
    owner_type IN ('users','teachers','drivers','staff_members','archived_employees')
  ),
  CONSTRAINT employee_emergency_contacts_priority_check CHECK (priority BETWEEN 1 AND 10)
);

CREATE INDEX IF NOT EXISTS idx_employee_emergency_contacts_owner
  ON employee_emergency_contacts(school_id, owner_type, owner_id, priority);

-- ── school_policies ────────────────────────────────────────────────────────
-- Per-school registry of acknowledgement policies (code of conduct, child
-- protection, handbook, etc.). The admin manages these. version increments
-- on a content change; old acknowledgements stay attached to their
-- previous version so the audit trail survives policy updates.

CREATE TABLE IF NOT EXISTS school_policies (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id    UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  policy_key   TEXT NOT NULL,          -- machine name, e.g. 'code_of_conduct'
  label        TEXT NOT NULL,           -- human label, e.g. 'Code of Conduct'
  version      INTEGER NOT NULL DEFAULT 1,
  body         TEXT,                    -- optional Markdown policy text
  document_url TEXT,                    -- optional link to a hosted PDF
  is_required  BOOLEAN NOT NULL DEFAULT TRUE,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, policy_key, version)
);

CREATE INDEX IF NOT EXISTS idx_school_policies_school
  ON school_policies(school_id, is_active);

-- ── employee_acknowledgements ──────────────────────────────────────────────
-- One row per (employee, policy_id) acknowledgement. policy_id captures the
-- exact policy version that was signed, so re-signing after a policy update
-- creates a new row (not an update). Optional signed_document_id links the
-- scanned signature page to employee_documents.

CREATE TABLE IF NOT EXISTS employee_acknowledgements (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id           UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  owner_type          TEXT NOT NULL,
  owner_id            UUID NOT NULL,
  policy_id           UUID NOT NULL REFERENCES school_policies(id) ON DELETE CASCADE,
  policy_key          TEXT NOT NULL,    -- denormalized for fast lookup
  policy_version      INTEGER NOT NULL,
  acknowledged_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address          INET,
  user_agent          TEXT,
  signed_document_id  UUID REFERENCES employee_documents(id) ON DELETE SET NULL,
  recorded_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT employee_acknowledgements_owner_type_check CHECK (
    owner_type IN ('users','teachers','drivers','staff_members','archived_employees')
  )
);

CREATE INDEX IF NOT EXISTS idx_employee_acknowledgements_owner
  ON employee_acknowledgements(school_id, owner_type, owner_id, policy_key);
CREATE INDEX IF NOT EXISTS idx_employee_acknowledgements_policy
  ON employee_acknowledgements(school_id, policy_id);

-- ── employee_actions ───────────────────────────────────────────────────────
-- Append-only log of HR events on an employee: review, warning,
-- commendation, role_change, contract_change, termination. The append-only
-- trigger blocks UPDATE / DELETE — once logged, this is the legal record.
-- rating is nullable; only reviews carry it.

CREATE TABLE IF NOT EXISTS employee_actions (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id    UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  owner_type   TEXT NOT NULL,
  owner_id     UUID NOT NULL,
  kind         TEXT NOT NULL,
  occurred_on  DATE NOT NULL,
  summary      TEXT NOT NULL,
  rating       SMALLINT,
  document_id  UUID REFERENCES employee_documents(id) ON DELETE SET NULL,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by_name TEXT,
  created_by_role TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT employee_actions_owner_type_check CHECK (
    owner_type IN ('users','teachers','drivers','staff_members','archived_employees')
  ),
  CONSTRAINT employee_actions_kind_check CHECK (
    kind IN ('review','warning','commendation','role_change','contract_change','termination')
  ),
  CONSTRAINT employee_actions_rating_check CHECK (
    rating IS NULL OR (rating BETWEEN 1 AND 5)
  )
);

CREATE INDEX IF NOT EXISTS idx_employee_actions_owner
  ON employee_actions(school_id, owner_type, owner_id, occurred_on DESC);

-- Append-only trigger — same pattern as archived_employees / audit_logs.
CREATE OR REPLACE FUNCTION employee_actions_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'employee_actions is append-only (got %)', TG_OP
    USING ERRCODE = '0A000';
END $$;

DROP TRIGGER IF EXISTS trg_employee_actions_append_only ON employee_actions;
CREATE TRIGGER trg_employee_actions_append_only
  BEFORE UPDATE OR DELETE ON employee_actions
  FOR EACH STATEMENT EXECUTE FUNCTION employee_actions_append_only();

-- ── audit_logs widening (Wave 2 entity types) ──────────────────────────────
-- Builds on Wave 1's widening (migration 028). Adds the new Wave 2 entity
-- types so the new controllers can log writes.

ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_entity_type_check;
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_entity_type_check CHECK (
  entity_type IN (
    'student','fee_plan','student_fee','fee_payment','staff_member','staff_salary_payment',
    'expense_category','expense_template','expense',
    'accounting_period','payment_account','fx_rate','late_fee',
    'teacher','driver','supervisor','admin','reception','accountant',
    -- Wave 1
    'employee_document','employee_profile',
    -- Wave 2
    'employee_extended_profile','employee_emergency_contact',
    'school_policy','employee_acknowledgement','employee_action',
    'hr_officer'
  )
);

-- ── users.is_hr_officer constraint ─────────────────────────────────────────
-- Only admins may carry the HR-officer flag. The backend enforces this at
-- promote-time; this CHECK is a belt-and-braces guard against direct DB
-- writes (e.g. operator scripts).
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_hr_officer_role_check;
ALTER TABLE users ADD CONSTRAINT users_hr_officer_role_check CHECK (
  is_hr_officer = FALSE OR role = 'admin'
);

-- ── Notifications: surface HR-officer promotions to other admins ──────────
-- The existing notifications table is enough — Wave 2 doesn't need a new
-- schema, just a new notification_type value. Documented here for
-- reference: 'hr_officer_promoted' / 'hr_officer_demoted' with related_id
-- pointing at the promoted user's id.
