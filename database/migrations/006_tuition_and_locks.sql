-- ============================================================
-- 006: Tuition fees module (premium) + per-student feature locks
-- ============================================================

-- Per-student per-feature locks. Admin-controlled. Used to gate
-- access to grades/reports etc. when fees are unpaid (or any other
-- admin-decided reason). Independent of the tuition module — even
-- schools without tuition_fees can use it.
CREATE TABLE IF NOT EXISTS student_access_locks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  reason TEXT,
  locked_at TIMESTAMPTZ DEFAULT NOW(),
  locked_by UUID REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (student_id, feature)
);
CREATE INDEX IF NOT EXISTS idx_student_access_locks_student ON student_access_locks(student_id, feature);
CREATE INDEX IF NOT EXISTS idx_student_access_locks_school ON student_access_locks(school_id);

-- Tuition config on the school: currency + sibling discount rule.
-- Lives outside `features` so editing it doesn't bump features_version.
ALTER TABLE schools
  ADD COLUMN IF NOT EXISTS tuition_config JSONB
  DEFAULT '{"currency":"USD","siblingDiscount":{"enabled":false,"type":"percent","tiers":[]}}'::jsonb;

-- Fee plan = e.g. "2026-2027 Tuition for Grade 5", or "Whole-school".
CREATE TABLE IF NOT EXISTS fee_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  total_amount NUMERIC(12,2) NOT NULL CHECK (total_amount >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  applies_to TEXT NOT NULL CHECK (applies_to IN ('all','classes','manual')),
  academic_year TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fee_plans_school ON fee_plans(school_id, is_active);

-- Junction for class-targeted plans.
CREATE TABLE IF NOT EXISTS fee_plan_classes (
  fee_plan_id UUID NOT NULL REFERENCES fee_plans(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  PRIMARY KEY (fee_plan_id, class_id)
);

-- Installments inside a plan. Sequence + due_date drive the "due/overdue"
-- status computed at read time.
CREATE TABLE IF NOT EXISTS fee_installments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  fee_plan_id UUID NOT NULL REFERENCES fee_plans(id) ON DELETE CASCADE,
  sequence INT NOT NULL CHECK (sequence > 0),
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  due_date DATE NOT NULL,
  UNIQUE (fee_plan_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_fee_installments_plan ON fee_installments(fee_plan_id, sequence);

-- Per-student fee record. Created when a plan is assigned to a student.
-- `total_amount` is snapshotted from the plan; `adjustment` is for manual
-- per-student overrides (scholarships, withdrawal credits) — sibling
-- discounts are NOT stored here; they're computed live from
-- schools.tuition_config so the discount tracks family changes.
CREATE TABLE IF NOT EXISTS student_fees (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  fee_plan_id UUID NOT NULL REFERENCES fee_plans(id) ON DELETE CASCADE,
  total_amount NUMERIC(12,2) NOT NULL CHECK (total_amount >= 0),
  adjustment NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (student_id, fee_plan_id)
);
CREATE INDEX IF NOT EXISTS idx_student_fees_student ON student_fees(student_id);
CREATE INDEX IF NOT EXISTS idx_student_fees_school ON student_fees(school_id);
CREATE INDEX IF NOT EXISTS idx_student_fees_plan ON student_fees(fee_plan_id);

-- Append-only payment ledger. Deletes are allowed (admin can void a
-- mistakenly recorded payment) but no UPDATEs — a corrected amount is
-- a delete + new insert, so the audit trail is clean.
CREATE TABLE IF NOT EXISTS fee_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_fee_id UUID NOT NULL REFERENCES student_fees(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  paid_on DATE NOT NULL,
  method TEXT,
  reference TEXT,
  notes TEXT,
  recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fee_payments_student_fee ON fee_payments(student_fee_id, paid_on DESC);
CREATE INDEX IF NOT EXISTS idx_fee_payments_school ON fee_payments(school_id);
