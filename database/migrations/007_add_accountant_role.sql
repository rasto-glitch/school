-- Add 'accountant' to users role check constraint
-- Accountants are dedicated finance/tuition users (gated by tuition_fees premium feature)
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('parent','teacher','admin','driver','supervisor','reception','accountant'));
