-- 082 — Master-portal pricing rework (2026-07-07).
--
-- 1. Per-school price override: schools.price_per_student ($/student/YEAR,
--    NULL = use the subscription plan's list price). Lives OUTSIDE `features`
--    so editing it never bumps features_version / forces a re-login. Only the
--    master portal reads or writes it — the school backend ignores it.
--
-- 2. Tier rename: 'pro' → 'essential' (tiers are now Basic $18 / Essential
--    $50 / Premium $100 per student per year). Only the master portal reads
--    subscription_plan; its getPlan() also maps legacy 'pro' defensively.

ALTER TABLE schools ADD COLUMN IF NOT EXISTS price_per_student NUMERIC(8,2)
  CHECK (price_per_student IS NULL OR price_per_student >= 0);

UPDATE schools SET subscription_plan = 'essential' WHERE subscription_plan = 'pro';
