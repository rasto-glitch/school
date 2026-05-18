-- Migration 014 — allow 'admin' in the employee archive
--
-- The new admin "Employees" tab adds an Administration sub-tab that can
-- archive admin users the same way teachers/supervisors are archived
-- (snapshot the users row, then delete it via archive_employee_atomic).
-- Migration 013 constrained archived_employees.role to
-- ('teacher','driver','supervisor','staff'); widen it to include 'admin'.
--
-- archive_employee_atomic() itself does NOT validate role (it only inserts
-- + deletes the users row), so no function change is needed — only the
-- table CHECK constraint.

ALTER TABLE archived_employees DROP CONSTRAINT IF EXISTS archived_employees_role_check;
ALTER TABLE archived_employees
  ADD CONSTRAINT archived_employees_role_check
  CHECK (role IN ('teacher', 'driver', 'supervisor', 'staff', 'admin'));
