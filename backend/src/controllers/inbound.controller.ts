import { Request, Response } from 'express';
import crypto from 'crypto';
import { supabase } from '../config/supabase';
import { logger } from '../utils/logger';
import { sanitizeFilename } from '../utils/upload';

// Length-independent constant-time string comparison. Hash both sides so
// timingSafeEqual gets equal-length buffers regardless of input length
// (a raw length mismatch would itself leak via an early throw).
const safeEqual = (a: string, b: string): boolean => {
  const ah = crypto.createHash('sha256').update(a).digest();
  const bh = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ah, bh);
};

// Inbound email webhook.
//
// Called by the Cloudflare Email Worker on every incoming message to
// support@ / onboarding@ / contact@ / partner@ scholify.krd. The Worker
// parses raw MIME with postal-mime and POSTs the structured JSON below.
//
// Auth: shared secret header. The Worker holds the same value as a
// Cloudflare secret. Keep this off the per-user JWT path — these are
// machine-to-machine writes, never end-user calls.
//
// Threading: we walk in_reply_to first, then the references chain, looking
// for any existing message_id we've seen before. If none match, this email
// starts a new thread with thread_id = own id.

const MAX_BODY = 256 * 1024;     // 256 KB per text/html field
const MAX_HEADERS_TOTAL = 4 * 1024;
const STORAGE_BUCKET = 'operator-mail';
const MAX_ATTACHMENTS = 10;

interface InboundAttachment {
  filename?: string;
  mimeType?: string;
  size?: number;
  // Present only when the file is small enough (≤10 MB per the Worker).
  // Larger attachments arrive as metadata-only; the operator can fetch
  // them from Gmail.
  contentBase64?: string;
}

interface InboundPayload {
  messageId?: string;
  inReplyTo?: string;
  references?: string;            // raw References: header (space-separated)
  from?: { address?: string; name?: string };
  to?: { address?: string }[];    // we only care about which OF OUR addresses received it
  cc?: { address?: string }[];
  subject?: string;
  text?: string;
  html?: string;
  attachments?: InboundAttachment[];
  rawSize?: number;
}

const OUR_INBOXES = new Set([
  'support@scholify.krd',
  'onboarding@scholify.krd',
  'contact@scholify.krd',
  'partner@scholify.krd',
]);

const truncate = (s: unknown, n: number) =>
  typeof s === 'string' ? s.slice(0, n) : null;

const pickOurInbox = (toList: { address?: string }[] | undefined): string | null => {
  if (!Array.isArray(toList)) return null;
  for (const t of toList) {
    const a = (t?.address || '').trim().toLowerCase();
    if (OUR_INBOXES.has(a)) return a;
  }
  // Fall back to the first address — better to record under a wrong inbox
  // than to drop the email entirely if Cloudflare ever routes a previously
  // unknown address here.
  const first = toList?.[0]?.address?.trim().toLowerCase();
  return first || null;
};

const parseReferences = (raw: string | undefined): string[] => {
  if (!raw) return [];
  // RFC 5322: msg-id tokens separated by FWS. Split on whitespace and keep
  // anything that looks like <...@...>.
  return raw
    .split(/\s+/)
    .map(s => s.trim())
    .filter(s => /^<[^<>\s]+@[^<>\s]+>$/.test(s));
};

// Walk references in REVERSE order — the most recent ancestor is the
// rightmost id in the References header per RFC 5322. We use whichever
// known ancestor we find first.
const resolveThreadId = async (
  inReplyTo: string | null,
  refs: string[],
): Promise<string | null> => {
  const candidates: string[] = [];
  if (inReplyTo) candidates.push(inReplyTo);
  for (let i = refs.length - 1; i >= 0; i--) candidates.push(refs[i]);
  if (candidates.length === 0) return null;

  // tenant-check-allow: operator_emails is operator-level (no school_id by design)
  const { data } = await supabase
    .from('operator_emails')
    .select('thread_id, message_id')
    .in('message_id', candidates)
    .limit(candidates.length);

  if (!data || data.length === 0) return null;

  // Prefer the row whose message_id matches our highest-priority candidate.
  for (const cand of candidates) {
    const hit = data.find((r: { message_id: string }) => r.message_id === cand);
    if (hit) return (hit as { thread_id: string }).thread_id;
  }
  return null;
};

export const inboundEmail = async (req: Request, res: Response) => {
  // Constant-time secret check (see safeEqual). The Worker is the only
  // legitimate caller; everyone else gets 401 with no detail.
  const expected = process.env.INBOUND_EMAIL_SECRET;
  if (!expected) {
    logger.error('INBOUND_EMAIL_SECRET not configured; rejecting all inbound mail');
    return res.status(503).json({ error: 'inbound disabled' });
  }
  const supplied = (req.headers['x-inbound-secret'] || '') as string;
  if (!safeEqual(supplied, expected)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const payload = req.body as InboundPayload;
  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ error: 'bad payload' });
  }

  const fromAddr = payload.from?.address?.trim().toLowerCase();
  if (!fromAddr) return res.status(400).json({ error: 'missing from' });

  const toAddr = pickOurInbox(payload.to);
  if (!toAddr) return res.status(400).json({ error: 'missing to' });

  const messageId = truncate(payload.messageId, 998); // RFC 2822 line-length cap
  const inReplyTo = truncate(payload.inReplyTo, 998);
  const refsRaw = truncate(payload.references, MAX_HEADERS_TOTAL);
  const refs = parseReferences(payload.references);

  // Idempotency: if we've already stored this Message-ID, do nothing.
  // Cloudflare may retry on transient failure.
  if (messageId) {
    // tenant-check-allow: operator_emails is operator-level (no school_id by design)
    const { data: existing } = await supabase
      .from('operator_emails')
      .select('id')
      .eq('message_id', messageId)
      .maybeSingle();
    if (existing) return res.status(200).json({ ok: true, deduped: true });
  }

  const threadIdFromAncestor = await resolveThreadId(inReplyTo, refs);

  const row = {
    message_id: messageId,
    in_reply_to: inReplyTo,
    references_header: refsRaw,
    direction: 'inbound' as const,
    from_email: fromAddr.slice(0, 320),
    from_name: truncate(payload.from?.name, 200),
    to_email: toAddr.slice(0, 320),
    cc_emails: (payload.cc || [])
      .map(c => c?.address?.trim().toLowerCase())
      .filter((a): a is string => !!a)
      .slice(0, 32),
    subject: truncate(payload.subject, 998),
    text_body: truncate(payload.text, MAX_BODY),
    html_body: truncate(payload.html, MAX_BODY),
    // Placeholder thread_id; we patch it to self.id below if no ancestor.
    thread_id: threadIdFromAncestor || '00000000-0000-0000-0000-000000000000',
    attachments: Array.isArray(payload.attachments)
      ? payload.attachments
          .slice(0, MAX_ATTACHMENTS)
          .map(a => ({
            name: truncate(a?.filename, 255),
            type: truncate(a?.mimeType, 127),
            size: typeof a?.size === 'number' ? a.size : null,
            // storageKey filled in after upload below
            storageKey: null as string | null,
          }))
      : [],
    raw_size: typeof payload.rawSize === 'number' ? payload.rawSize : null,
  };

  // tenant-check-allow: operator_emails is operator-level (no school_id by design)
  const { data: inserted, error } = await supabase
    .from('operator_emails')
    .insert(row)
    .select('id, thread_id')
    .single();

  if (error || !inserted) {
    logger.error('Failed to insert inbound email', { error, messageId });
    return res.status(500).json({ error: 'insert failed' });
  }

  // If no ancestor was found, this email is the root of a new thread —
  // point thread_id at the row's own id so the inbox query can JOIN cleanly.
  if (!threadIdFromAncestor) {
    // tenant-check-allow: operator_emails is operator-level (no school_id by design)
    await supabase
      .from('operator_emails')
      .update({ thread_id: inserted.id })
      .eq('id', inserted.id);
  }

  // Attachment uploads. Best-effort: even if one fails, the row stays in
  // place with metadata so the operator at least sees the filename in the
  // inbox UI. We only update the row if at least one upload succeeded.
  const incoming = Array.isArray(payload.attachments)
    ? payload.attachments.slice(0, MAX_ATTACHMENTS)
    : [];
  if (incoming.some(a => a?.contentBase64)) {
    const storedAttachments = await Promise.all(
      row.attachments.map(async (att, idx) => {
        const src = incoming[idx];
        if (!src?.contentBase64) return att;
        try {
          const buf = Buffer.from(src.contentBase64, 'base64');
          const safe = sanitizeFilename(att.name, `file-${idx}`);
          const key = `inbound/${inserted.id}/${idx}-${safe}`;
          const { error: upErr } = await supabase.storage
            .from(STORAGE_BUCKET)
            .upload(key, buf, {
              contentType: att.type || 'application/octet-stream',
              upsert: false,
            });
          if (upErr) {
            logger.error('Inbound attachment upload failed', { error: upErr, key });
            return att;
          }
          return { ...att, storageKey: key };
        } catch (err) {
          logger.error('Inbound attachment decode/upload threw', { err, idx });
          return att;
        }
      }),
    );
    // tenant-check-allow: operator_emails is operator-level (no school_id by design)
    await supabase
      .from('operator_emails')
      .update({ attachments: storedAttachments })
      .eq('id', inserted.id);
  }

  return res.status(200).json({ ok: true, id: inserted.id });
};
