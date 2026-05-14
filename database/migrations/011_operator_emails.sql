-- 011_operator_emails.sql
-- Adds a single table for operator-level mail (Scholify's own support /
-- onboarding / contact / partner inboxes). NOT tenant data — no school_id.
--
-- Inbound rows are inserted by the backend webhook (called from the
-- Cloudflare Email Worker). Outbound rows are inserted by the master portal
-- when an operator replies via Resend. Threading is by message_id /
-- in_reply_to / references_header, materialized into thread_id at insert
-- time so the inbox UI can fetch a whole conversation with one query.

CREATE TABLE IF NOT EXISTS operator_emails (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- RFC 5322 Message-ID. Unique per email; inbound from a sender can collide
  -- across replays so we use a partial unique index (see below).
  message_id         TEXT,
  in_reply_to        TEXT,
  references_header  TEXT,

  direction          TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),

  from_email         TEXT NOT NULL,
  from_name          TEXT,
  to_email           TEXT NOT NULL,         -- which of our inboxes (support@, onboarding@, ...)
  cc_emails          TEXT[] DEFAULT '{}'::TEXT[],

  subject            TEXT,
  text_body          TEXT,
  html_body          TEXT,

  -- All emails that share a conversation point to the same thread_id. The
  -- root message of a thread has thread_id = id (set in a trigger below).
  thread_id          UUID NOT NULL,

  received_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  is_read            BOOLEAN NOT NULL DEFAULT FALSE,
  is_archived        BOOLEAN NOT NULL DEFAULT FALSE,

  -- Filled when an outbound reply has been sent against this row.
  replied_at         TIMESTAMPTZ,

  -- For outbound rows: Resend's returned message id (useful for tracing).
  resend_id          TEXT,

  -- Attachment metadata only in v1 — { name, type, size }[]. We do NOT
  -- store the file bytes here; if needed they can be retrieved from the
  -- Gmail forward or added later in a v2.
  attachments        JSONB NOT NULL DEFAULT '[]'::JSONB,

  raw_size           INTEGER
);

-- Inbound webhooks should be idempotent on message_id, but the column is
-- NULLable because some MTAs omit it. A partial unique index handles both.
CREATE UNIQUE INDEX IF NOT EXISTS operator_emails_message_id_key
  ON operator_emails (message_id)
  WHERE message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS operator_emails_thread_idx
  ON operator_emails (thread_id, received_at);

CREATE INDEX IF NOT EXISTS operator_emails_inbox_idx
  ON operator_emails (to_email, received_at DESC);

CREATE INDEX IF NOT EXISTS operator_emails_unread_idx
  ON operator_emails (is_read, received_at DESC)
  WHERE is_archived = FALSE;
