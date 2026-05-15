import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import multer from 'multer';
import { randomUUID } from 'crypto';

const router = Router();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const STORAGE_BUCKET = 'operator-mail';
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;   // 10 MB per file
const MAX_ATTACHMENTS = 10;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;        // 25 MB combined per send

// Multer keeps files in memory — operator mail is bounded by the limits
// above (10 files × 10 MB = 100 MB worst case, but enforced via per-file
// fileSize cap below; total-size check happens in the handler).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_ATTACHMENT_BYTES,
    files: MAX_ATTACHMENTS,
  },
});

// Display names for the from addresses we send as. The reply/compose `from`
// must be one of these keys — strict allowlist; operator can't send as
// arbitrary addresses.
const FROM_NAMES: Record<string, string> = {
  'support@scholify.krd':    'Scholify Support',
  'onboarding@scholify.krd': 'Scholify Onboarding',
  'contact@scholify.krd':    'Scholify',
  'partner@scholify.krd':    'Scholify Partnerships',
};
const OUR_INBOX_RE = /^(support|onboarding|contact|partner)@scholify\.krd$/i;

const buildFrom = (toEmail: string): string => {
  const display = FROM_NAMES[toEmail] || 'Scholify';
  return `${display} <${toEmail}>`;
};

// Given a row, returns whichever side is one of our operator inboxes.
// Compose-started threads have our address on from_email, not to_email,
// so the inbox-tab filter has to look at both ends.
const ourInboxOf = (row: { from_email: string; to_email: string }): string => {
  if (OUR_INBOX_RE.test(row.from_email)) return row.from_email.toLowerCase();
  if (OUR_INBOX_RE.test(row.to_email)) return row.to_email.toLowerCase();
  return row.to_email.toLowerCase();
};

const escape = (s: string) =>
  s.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c),
  );

const buildHtmlFromText = (text: string): string =>
  text.split(/\n{2,}/).map((p: string) => `<p>${escape(p).replace(/\n/g, '<br/>')}</p>`).join('');

const sanitizeFilename = (name: string, fallback: string): string => {
  const raw = name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
  return raw || fallback;
};

const parseCcField = (raw: unknown): string[] => {
  // Accept either a JSON array or a comma-separated string. Multer turns
  // text fields into strings, so the client typically sends comma-joined.
  if (Array.isArray(raw)) {
    return raw
      .filter((c): c is string => typeof c === 'string')
      .map(c => c.trim().toLowerCase())
      .filter(c => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c))
      .slice(0, 16);
  }
  if (typeof raw === 'string') {
    return raw
      .split(/[,\s]+/)
      .map(c => c.trim().toLowerCase())
      .filter(c => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c))
      .slice(0, 16);
  }
  return [];
};

interface UploadedAttachmentMeta {
  name: string;
  type: string;
  size: number;
  storageKey: string;
}

// Uploads each Multer file to `<prefix>/<idx>-<safeName>` in the storage
// bucket. Returns metadata for the JSONB column. If an upload fails we
// throw — caller decides how to bail out cleanly.
async function uploadOutboundFiles(
  files: Express.Multer.File[],
  prefix: string,
): Promise<UploadedAttachmentMeta[]> {
  const out: UploadedAttachmentMeta[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const safe = sanitizeFilename(f.originalname || `file-${i}`, `file-${i}`);
    const key = `${prefix}/${i}-${safe}`;
    const { error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(key, f.buffer, {
        contentType: f.mimetype || 'application/octet-stream',
        upsert: false,
      });
    if (error) throw new Error(`upload_failed: ${error.message}`);
    out.push({
      name: f.originalname || safe,
      type: f.mimetype || 'application/octet-stream',
      size: f.size,
      storageKey: key,
    });
  }
  return out;
}

// ── List threads ───────────────────────────────────────────────────────────
//
// GET /api/emails?inbox=support|onboarding|contact|partner|all
//                &status=all|unread|read|archived
//                &q=<substring>
//                &limit=&offset=
//
// Pulls all rows (capped at 2000), groups into threads, then filters by
// inbox if requested. We DON'T filter to_email at the SQL level because
// compose-started threads have our address on from_email — the inbox tab
// must match either side of any row in the thread.

router.get('/', async (req: Request, res: Response) => {
  const inboxParam = (req.query.inbox as string | undefined)?.trim();
  const status = (req.query.status as string | undefined)?.trim() || 'all';
  const q = (req.query.q as string | undefined)?.trim();
  const limit = Math.min(parseInt((req.query.limit as string) || '50', 10) || 50, 200);
  const offset = Math.max(parseInt((req.query.offset as string) || '0', 10) || 0, 0);

  let query = supabase
    .from('operator_emails')
    .select('id, thread_id, message_id, direction, from_email, from_name, to_email, subject, text_body, received_at, is_read, is_archived, replied_at')
    .order('received_at', { ascending: false })
    .limit(2000);

  if (status === 'archived') query = query.eq('is_archived', true);
  else query = query.eq('is_archived', false);

  if (q && q.length >= 2) {
    const pattern = `%${q.replace(/[%_\\]/g, m => '\\' + m)}%`;
    query = query.or(`subject.ilike.${pattern},text_body.ilike.${pattern},from_email.ilike.${pattern}`);
  }

  const { data, error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }

  type Row = NonNullable<typeof data>[number];
  const byThread = new Map<string, Row[]>();
  for (const r of data || []) {
    const arr = byThread.get(r.thread_id) || [];
    arr.push(r);
    byThread.set(r.thread_id, arr);
  }

  const inboxFilter = inboxParam && inboxParam !== 'all'
    ? (inboxParam.includes('@') ? inboxParam.toLowerCase() : `${inboxParam}@scholify.krd`)
    : null;

  const threads = Array.from(byThread.values())
    .map(rows => {
      rows.sort((a, b) => (a.received_at < b.received_at ? -1 : 1));
      const latest = rows[rows.length - 1];
      const first = rows[0];
      const unread = rows.some(r => r.direction === 'inbound' && !r.is_read);
      return {
        rows,
        threadId: latest.thread_id,
        latestId: latest.id,
        subject: first.subject || '(no subject)',
        preview: (latest.text_body || '').slice(0, 160),
        participant: first.direction === 'inbound'
          ? { email: first.from_email, name: first.from_name }
          : { email: first.to_email, name: null },
        inbox: ourInboxOf(first),
        messageCount: rows.length,
        latestAt: latest.received_at,
        latestDirection: latest.direction,
        unread,
        archived: rows.every(r => r.is_archived),
        replied: !!latest.replied_at || rows.some(r => r.direction === 'outbound'),
      };
    })
    .filter(t => {
      if (!inboxFilter) return true;
      return t.rows.some(r =>
        r.from_email.toLowerCase() === inboxFilter ||
        r.to_email.toLowerCase() === inboxFilter
      );
    })
    .map(({ rows: _rows, ...rest }) => rest);

  let filtered = threads;
  if (status === 'unread') filtered = threads.filter(t => t.unread);
  else if (status === 'read') filtered = threads.filter(t => !t.unread);

  filtered.sort((a, b) => (a.latestAt < b.latestAt ? 1 : -1));
  res.json({ threads: filtered.slice(offset, offset + limit) });
});

// GET /api/emails/inboxes — list of valid From addresses for the UI dropdowns
router.get('/inboxes', (_req: Request, res: Response) => {
  res.json({
    inboxes: Object.keys(FROM_NAMES).map(addr => ({ address: addr, name: FROM_NAMES[addr] })),
  });
});

// GET /api/emails/:id — fetch a single email AND all rows in its thread.
router.get('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { data: row, error } = await supabase
    .from('operator_emails')
    .select('*')
    .eq('id', id)
    .single();
  if (error || !row) { res.status(404).json({ error: 'not found' }); return; }

  const { data: thread } = await supabase
    .from('operator_emails')
    .select('*')
    .eq('thread_id', (row as { thread_id: string }).thread_id)
    .order('received_at', { ascending: true });

  res.json({
    email: row,
    thread: thread || [row],
  });
});

// PATCH /api/emails/:id — mark read/unread or archive/unarchive.
router.patch('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const patch: { is_read?: boolean; is_archived?: boolean } = {};
  if (typeof req.body?.isRead === 'boolean') patch.is_read = req.body.isRead;
  if (typeof req.body?.isArchived === 'boolean') patch.is_archived = req.body.isArchived;
  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: 'nothing to update' });
    return;
  }
  const { error } = await supabase.from('operator_emails').update(patch).eq('id', id);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true });
});

// PATCH /api/emails/thread/:threadId — operate on every row in a thread at once.
router.patch('/thread/:threadId', async (req: Request, res: Response) => {
  const { threadId } = req.params;
  const patch: { is_read?: boolean; is_archived?: boolean } = {};
  if (typeof req.body?.isRead === 'boolean') patch.is_read = req.body.isRead;
  if (typeof req.body?.isArchived === 'boolean') patch.is_archived = req.body.isArchived;
  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: 'nothing to update' });
    return;
  }
  const { error } = await supabase.from('operator_emails').update(patch).eq('thread_id', threadId);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true });
});

// GET /api/emails/attachments/:emailId/:idx/url
// Returns a short-lived signed URL for the attachment at index `idx` of the
// email's attachments JSONB array. We resolve the storage key server-side so
// the client can't construct arbitrary URLs.
router.get('/attachments/:emailId/:idx/url', async (req: Request, res: Response) => {
  const emailId = req.params.emailId as string;
  const idx = req.params.idx as string;
  const idxNum = parseInt(idx, 10);
  if (!Number.isInteger(idxNum) || idxNum < 0 || idxNum > MAX_ATTACHMENTS) {
    res.status(400).json({ error: 'bad index' });
    return;
  }
  const { data: row, error } = await supabase
    .from('operator_emails')
    .select('attachments')
    .eq('id', emailId)
    .single();
  if (error || !row) { res.status(404).json({ error: 'not found' }); return; }

  const atts = (row as { attachments: { storageKey: string | null; name?: string | null; type?: string | null }[] }).attachments;
  const att = Array.isArray(atts) ? atts[idxNum] : null;
  if (!att?.storageKey) { res.status(404).json({ error: 'no stored file' }); return; }

  const { data: signed, error: sErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(att.storageKey, 300, {
      download: att.name || true,
    });
  if (sErr || !signed) { res.status(500).json({ error: sErr?.message || 'signing failed' }); return; }
  res.json({ url: signed.signedUrl, filename: att.name, type: att.type });
});

// ── Shared outbound send (reply OR compose) ────────────────────────────────
//
// One internal helper does:
//   1. validate inputs
//   2. send via Resend (with attachments inlined as base64)
//   3. on success, upload the attachments to Supabase storage
//   4. insert the outbound row with storage keys
// Failure of step 2 short-circuits — nothing is stored, no garbage left.
// Failure of step 3 still records the row with the attachment metadata
// (without storageKey), so the operator at least sees what was sent.

interface OutboundSpec {
  fromAddr: string;
  toAddr: string;
  cc: string[];
  subject: string;
  text: string;
  html: string;
  files: Express.Multer.File[];
  // Threading context — null/undefined for compose, set for reply.
  inReplyTo: string | null;
  referencesHeader: string | null;
  threadId: string | null;
}

async function sendOutbound(spec: OutboundSpec) {
  if (!resend) throw new Error('resend not configured');

  const attachmentsForResend = spec.files.map(f => ({
    filename: f.originalname || 'attachment',
    content: f.buffer,
  }));

  const headers: Record<string, string> = {};
  if (spec.inReplyTo) headers['In-Reply-To'] = spec.inReplyTo;
  if (spec.referencesHeader) headers['References'] = spec.referencesHeader;

  const sendResult = await resend.emails.send({
    from: buildFrom(spec.fromAddr),
    to: spec.toAddr,
    cc: spec.cc.length ? spec.cc : undefined,
    subject: spec.subject,
    text: spec.text,
    html: spec.html,
    headers: Object.keys(headers).length ? headers : undefined,
    attachments: attachmentsForResend.length ? attachmentsForResend : undefined,
  });

  if (sendResult.error) {
    const err = new Error(sendResult.error.message || 'resend failed') as Error & { resendError?: unknown };
    err.resendError = sendResult.error;
    throw err;
  }

  const resendId = sendResult.data?.id || null;
  // Resend doesn't expose the actual SMTP Message-ID it generated. We
  // synthesize one keyed on the Resend id so our threading walk can match
  // when the recipient replies and quotes it in their References header.
  const synthesizedMessageId = resendId ? `<${resendId}@scholify.krd>` : null;

  // Pre-allocate the email row id so we can place files under it before
  // inserting the row. If file upload fails later, the row insert still
  // happens with the attachment metadata (sans storageKey).
  const emailId = randomUUID();
  const threadId = spec.threadId || emailId;

  let storedAttachments: UploadedAttachmentMeta[] = [];
  if (spec.files.length > 0) {
    try {
      storedAttachments = await uploadOutboundFiles(spec.files, `outbound/${emailId}`);
    } catch (err) {
      // Email went out — still record the row, just without storage keys.
      console.error('Outbound attachment upload failed', err);
      storedAttachments = spec.files.map((f, i) => ({
        name: f.originalname || `file-${i}`,
        type: f.mimetype || 'application/octet-stream',
        size: f.size,
        storageKey: '',
      }));
    }
  }

  const insertRow = {
    id: emailId,
    message_id: synthesizedMessageId,
    in_reply_to: spec.inReplyTo,
    references_header: spec.referencesHeader,
    direction: 'outbound' as const,
    from_email: spec.fromAddr,
    from_name: FROM_NAMES[spec.fromAddr] || 'Scholify',
    to_email: spec.toAddr,
    cc_emails: spec.cc,
    subject: spec.subject,
    text_body: spec.text,
    html_body: spec.html,
    thread_id: threadId,
    is_read: true,
    is_archived: false,
    resend_id: resendId,
    attachments: storedAttachments.map(a => ({
      name: a.name,
      type: a.type,
      size: a.size,
      storageKey: a.storageKey || null,
    })),
  };

  const { data: inserted, error: insErr } = await supabase
    .from('operator_emails')
    .insert(insertRow)
    .select('id, thread_id')
    .single();
  if (insErr) {
    console.error('Outbound DB insert failed (email sent successfully)', insErr);
  }

  return {
    id: inserted?.id || emailId,
    threadId: inserted?.thread_id || threadId,
    resendId,
  };
}

// POST /api/emails/:id/reply
// Multipart form: text, [subject], [cc], [fromInbox], attachments[]
// Default from-address is the original to_email; can be overridden via
// fromInbox if the operator wants to reply from a different inbox.
router.post('/:id/reply', upload.array('attachments', MAX_ATTACHMENTS), async (req: Request, res: Response) => {
  if (!resend) { res.status(503).json({ error: 'resend not configured' }); return; }

  const { id } = req.params;
  const { data: origRaw, error } = await supabase
    .from('operator_emails')
    .select('id, thread_id, message_id, references_header, from_email, to_email, subject')
    .eq('id', id)
    .single();
  if (error || !origRaw) { res.status(404).json({ error: 'not found' }); return; }
  const orig = origRaw as {
    id: string;
    thread_id: string;
    message_id: string | null;
    references_header: string | null;
    from_email: string;
    to_email: string;
    subject: string | null;
  };

  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text) { res.status(400).json({ error: 'text is required' }); return; }

  const html: string = typeof req.body?.html === 'string' && req.body.html.trim()
    ? req.body.html
    : buildHtmlFromText(text);

  const subjectIn = typeof req.body?.subject === 'string' ? req.body.subject.trim() : '';
  const subject = subjectIn || (orig.subject?.startsWith('Re:') ? orig.subject : `Re: ${orig.subject || '(no subject)'}`);

  const cc = parseCcField(req.body?.cc);

  const fromInboxIn = typeof req.body?.fromInbox === 'string' ? req.body.fromInbox.trim().toLowerCase() : '';
  const fromAddr = fromInboxIn && fromInboxIn in FROM_NAMES ? fromInboxIn : orig.to_email;

  const files = (req.files as Express.Multer.File[] | undefined) || [];
  const total = files.reduce((s, f) => s + f.size, 0);
  if (total > MAX_TOTAL_BYTES) {
    res.status(413).json({ error: `Attachments exceed ${MAX_TOTAL_BYTES / (1024 * 1024)} MB total` });
    return;
  }

  const refsChain = [
    orig.references_header || '',
    orig.message_id || '',
  ].filter(Boolean).join(' ').trim();

  try {
    const result = await sendOutbound({
      fromAddr,
      toAddr: orig.from_email,
      cc,
      subject,
      text,
      html,
      files,
      inReplyTo: orig.message_id,
      referencesHeader: refsChain || null,
      threadId: orig.thread_id,
    });

    // Flag the original as "replied"
    await supabase
      .from('operator_emails')
      .update({ replied_at: new Date().toISOString() })
      .eq('id', orig.id);

    res.json({ ok: true, id: result.id, resendId: result.resendId });
  } catch (err) {
    const e = err as Error;
    res.status(502).json({ error: e.message || 'send failed' });
  }
});

// POST /api/emails/compose
// Multipart form: from, to, [cc], subject, text, [html], attachments[]
router.post('/compose', upload.array('attachments', MAX_ATTACHMENTS), async (req: Request, res: Response) => {
  if (!resend) { res.status(503).json({ error: 'resend not configured' }); return; }

  const fromIn = typeof req.body?.from === 'string' ? req.body.from.trim().toLowerCase() : '';
  if (!fromIn || !(fromIn in FROM_NAMES)) {
    res.status(400).json({ error: 'invalid from address' });
    return;
  }

  const toIn = typeof req.body?.to === 'string' ? req.body.to.trim() : '';
  if (!toIn || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toIn)) {
    res.status(400).json({ error: 'invalid to address' });
    return;
  }

  const subject = typeof req.body?.subject === 'string' ? req.body.subject.trim() : '';
  if (!subject) { res.status(400).json({ error: 'subject is required' }); return; }

  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text) { res.status(400).json({ error: 'text is required' }); return; }

  const html: string = typeof req.body?.html === 'string' && req.body.html.trim()
    ? req.body.html
    : buildHtmlFromText(text);

  const cc = parseCcField(req.body?.cc);

  const files = (req.files as Express.Multer.File[] | undefined) || [];
  const total = files.reduce((s, f) => s + f.size, 0);
  if (total > MAX_TOTAL_BYTES) {
    res.status(413).json({ error: `Attachments exceed ${MAX_TOTAL_BYTES / (1024 * 1024)} MB total` });
    return;
  }

  try {
    const result = await sendOutbound({
      fromAddr: fromIn,
      toAddr: toIn,
      cc,
      subject,
      text,
      html,
      files,
      inReplyTo: null,
      referencesHeader: null,
      threadId: null, // new thread
    });
    res.json({ ok: true, id: result.id, threadId: result.threadId, resendId: result.resendId });
  } catch (err) {
    const e = err as Error;
    res.status(502).json({ error: e.message || 'send failed' });
  }
});

export default router;
