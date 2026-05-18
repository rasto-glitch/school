-- Migration 022 — chat schedule restrictions
--
-- Schools can restrict parent ↔ staff chat to specific weekdays and per-day
-- time windows (e.g. Sun–Thu, 08:00–20:00). Enforced server-side on send.
--
-- Stored OUTSIDE schools.features on purpose: writing to `features` fires the
-- features_version trigger and force-logs-out every user of the school. A chat
-- schedule is an everyday admin tweak — it must NOT invalidate sessions.
--
-- timezone:          IANA tz the open/close times are interpreted in.
-- chat_restrictions: { enabled: bool,
--                       days: { sunday: {enabled,open,close}, ... } }
--                     open/close are "HH:MM" 24h strings, local to `timezone`.
-- Idempotent / safe to re-run.

ALTER TABLE schools
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Baghdad';

ALTER TABLE schools
  ADD COLUMN IF NOT EXISTS chat_restrictions JSONB NOT NULL
  DEFAULT '{"enabled":false}'::jsonb;
