-- Migration 047 — chat_attachments ownership table (HD-11 from
-- HISTORICAL_DATA_AUDIT.md).
--
-- The chat-files bucket has been receiving uploads via /chat/upload since
-- the chat feature shipped, but NOTHING in the database recorded that
-- those files existed. The upload returned a publicUrl, the client
-- pasted it into a message, and the file then lived in storage with no
-- DB row that owned it. As a result:
--
--   * if the client failed to send the message after upload, the file
--     became an immediate orphan with zero forensic trace;
--   * the orphan-sweep work (HD-15) couldn't tell "untracked upload"
--     from "active message attachment" without scanning every message
--     and string-matching URLs;
--   * we couldn't even ask "who uploaded this file?" given a key.
--
-- This migration adds a thin ownership table. Every chat upload from
-- this point on writes a row. The sweep (HD-15) reads from here.
--
-- Intentionally NO FK to `messages`. The link from the messages side is
-- already captured by messages.attachment_url; duplicating it as an FK
-- would force the upload endpoint to know the message_id, which doesn't
-- exist yet at upload time (clients upload first, send the message
-- referencing the URL second). The sweep distinguishes "linked" from
-- "orphan" by checking whether any message's attachment_url contains
-- the storage_path. Simpler than a two-phase upload protocol.

CREATE TABLE IF NOT EXISTS chat_attachments (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id     UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  -- FK-less so a user-delete doesn't orphan the audit trail.
  uploader_id   UUID,
  storage_bucket TEXT NOT NULL DEFAULT 'chat-files',
  storage_path  TEXT NOT NULL,
  content_type  TEXT,
  byte_size     BIGINT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, storage_path)
);

CREATE INDEX IF NOT EXISTS idx_chat_attachments_school
  ON chat_attachments (school_id, created_at DESC);

-- For the orphan sweep (HD-15): "find attachments older than N days
-- with no message referencing them" benefits from an index on
-- created_at when filtered by school.
CREATE INDEX IF NOT EXISTS idx_chat_attachments_age
  ON chat_attachments (school_id, created_at);
