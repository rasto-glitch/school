-- Migration 059 — drop users.is_hr_officer (Phase B).
--
-- The HR-officer sub-role flag (migration 028) is fully replaced by the
-- hr.read / hr.manage capabilities introduced in Phase A (migration 058).
-- As of Phase B the backend gates decrypted-PII and high-sensitivity-document
-- access on those capabilities (utils/employeeDocs.ts: canReadHrSensitive /
-- canManageHr) and the promote/demote HR-officer endpoints are removed. The
-- column has no remaining readers, so it's dropped here.
--
-- Phase A backfilled every existing admin to Owner (which holds hr.read +
-- hr.manage implicitly), and the clearance panel kept is_hr_officer in sync
-- with the hr.* caps in the interim, so no access is lost by dropping it.

DROP INDEX IF EXISTS idx_users_hr_officer;
ALTER TABLE users DROP COLUMN IF EXISTS is_hr_officer;
