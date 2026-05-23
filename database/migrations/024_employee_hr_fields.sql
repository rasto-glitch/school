-- 024_employee_hr_fields.sql
-- Employee HR records: the Employees tab is the single home for everything a
-- school keeps about a staff member. Adds common HR/identity fields to every
-- employee-bearing surface, plus a professional photo (official_photo) that is
-- distinct from the self-set app avatar (users.profile_picture):
--   • app avatar  → users.profile_picture (the user sets it themselves)
--   • official    → *.official_photo (admin-uploaded, kept forever for
--                    contracts / the employee profile; never overrides the avatar)
--
-- Account-only roles (supervisor / admin / reception / accountant) have no
-- profile table, so their HR fields live on `users`. teachers / drivers /
-- staff_members keep theirs on their own tables (matching how phone /
-- emergency_contact are already stored per-table).

-- ── users (supervisor / admin / reception / accountant; harmless on others) ──
ALTER TABLE users ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS hire_date DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS national_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS marital_status TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS gender TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS employment_type TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS qualifications TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS emergency_contact TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS official_photo TEXT;

-- ── teachers (emergency_contact + profile_picture already exist) ──
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS hire_date DATE;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS national_id TEXT;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS marital_status TEXT;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS gender TEXT;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS employment_type TEXT;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS qualifications TEXT;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS official_photo TEXT;

-- ── drivers (emergency_contact + profile_picture + age already exist) ──
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS hire_date DATE;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS national_id TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS marital_status TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS gender TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS employment_type TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS qualifications TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS official_photo TEXT;

-- ── staff_members ──
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS hire_date DATE;
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS national_id TEXT;
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS marital_status TEXT;
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS gender TEXT;
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS employment_type TEXT;
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS qualifications TEXT;
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS emergency_contact TEXT;
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS official_photo TEXT;

-- ── archived_employees: allow reception + accountant to be archived ──
-- These are bare `users`-row roles (no profile table) just like supervisor;
-- they archive through the same path. Widen the role CHECK accordingly.
ALTER TABLE archived_employees DROP CONSTRAINT IF EXISTS archived_employees_role_check;
ALTER TABLE archived_employees ADD CONSTRAINT archived_employees_role_check
  CHECK (role IN ('teacher', 'driver', 'supervisor', 'staff', 'admin', 'reception', 'accountant'));
