import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const router = Router();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// Display names for the from addresses we send replies as. The "from" of a
// reply matches whichever inbox the original mail came in on, so the
// recipient sees a coherent thread.
const FROM_NAMES: Record<string, string> = {
  'support@scholify.krd':    'Scholify Support',
  'onboarding@scholify.krd': 'Scholify Onboarding',
  'contact@scholify.krd':    'Scholify',
  'partner@scholify.krd':    'Scholify Partnerships',
};

const buildFrom = (toEmail: string): string => {
  const display = FROM_NAMES[toEmail] || 'Scholify';
  return `${display} <${toEmail}>`;
};

const escape = (s: string) =>
  s.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c),
  );

// GET /api/emails?inbox=support|onboarding|contact|partner&status=unread|read|archived|all&q=&limit=50&offset=0
router.get('/', async (req: Request, res: Response) => {
  const inbox = (req.query.inbox as string | undefined)?.trim();
  const status = (req.query.status as string | undefined)?.trim() || 'all';
  const q = (req.query.q as string | undefined)?.trim();
  const limit = Math.min(parseInt((req.query.limit as string) || '50', 10) || 50, 200);
  const offset = Math.max(parseInt((req.query.offset as string) || '0', 10) || 0, 0);

  // We list THREADS (one row per thread, latest activity), not raw rows —
  // operator sees the conversation, not every message duplicated. Doing
  // this in SQL would need a CTE; pulling all rows and grouping in JS is
  // fine at our scale (operator mail volume) and keeps Supabase happy.
  let query = supabase
    .from('operator_emails')
    .select('id, thread_id, message_id, direction, from_email, from_name, to_email, subject, text_body, received_at, is_read, is_archived, replied_at')
    .order('received_at', { ascending: false })
    .limit(2000);

  if (inbox && inbox !== 'all') {
    const fullAddr = inbox.includes('@') ? inbox : `${inbox}@scholify.krd`;
    query = query.eq('to_email', fullAddr);
  }
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

  const threads = Array.from(byThread.values()).map(rows => {
    rows.sort((a, b) => (a.received_at < b.received_at ? -1 : 1));
    const latest = rows[rows.length - 1];
    const first = rows[0];
    const unread = rows.some(r => r.direction === 'inbound' && !r.is_read);
    return {
      threadId: latest.thread_id,
      latestId: latest.id,
      subject: first.subject || '(no subject)',
      preview: (latest.text_body || '').slice(0, 160),
      participant: first.direction === 'inbound'
        ? { email: first.from_email, name: first.from_name }
        : { email: latest.from_email, name: latest.from_name },
      inbox: first.to_email,
      messageCount: rows.length,
      latestAt: latest.received_at,
      latestDirection: latest.direction,
      unread,
      archived: rows.every(r => r.is_archived),
      replied: !!latest.replied_at || rows.some(r => r.direction === 'outbound'),
    };
  });

  if (status === 'unread') {
    res.json({ threads: threads.filter(t => t.unread).slice(offset, offset + limit) });
    return;
  }
  if (status === 'read') {
    res.json({ threads: threads.filter(t => !t.unread).slice(offset, offset + limit) });
    return;
  }
  threads.sort((a, b) => (a.latestAt < b.latestAt ? 1 : -1));
  res.json({ threads: threads.slice(offset, offset + limit) });
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

// POST /api/emails/:id/reply
// Body: { text: string, html?: string, subject?: string, cc?: string[] }
// Reply identity (`From:`) matches the original `to_email`, so the
// conversation stays on whichever inbox the customer wrote to.
router.post('/:id/reply', async (req: Request, res: Response) => {
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

  const text: string = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text) { res.status(400).json({ error: 'text is required' }); return; }

  const html: string = typeof req.body?.html === 'string' && req.body.html.trim()
    ? req.body.html
    // Fallback: render plain text as <p> blocks so Gmail/Outlook show a
    // proper HTML body. Newlines become <br>; blank lines start new <p>.
    : text.split(/\n{2,}/).map((p: string) => `<p>${escape(p).replace(/\n/g, '<br/>')}</p>`).join('');

  const subjectIn = typeof req.body?.subject === 'string' ? req.body.subject.trim() : '';
  const subject = subjectIn || (orig.subject?.startsWith('Re:') ? orig.subject : `Re: ${orig.subject || '(no subject)'}`);

  const cc = Array.isArray(req.body?.cc)
    ? req.body.cc.filter((c: unknown): c is string => typeof c === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c)).slice(0, 16)
    : undefined;

  // RFC 5322 In-Reply-To/References. Append the original message-id to the
  // existing chain (or start a new chain).
  const refsChain = [
    orig.references_header || '',
    orig.message_id || '',
  ].filter(Boolean).join(' ').trim();

  const headers: Record<string, string> = {};
  if (orig.message_id) headers['In-Reply-To'] = orig.message_id;
  if (refsChain) headers['References'] = refsChain;

  const fromAddr = orig.to_email;        // we reply AS the inbox they wrote to
  const replyResult = await resend.emails.send({
    from: buildFrom(fromAddr),
    to: orig.from_email,
    cc,
    subject,
    text,
    html,
    headers: Object.keys(headers).length ? headers : undefined,
  });

  if (replyResult.error) {
    res.status(502).json({ error: replyResult.error.message || 'resend failed' });
    return;
  }

  const resendId = replyResult.data?.id || null;
  // Resend doesn't expose the actual Message-ID it generated, so we
  // synthesize one from the Resend id for our own threading. This is
  // best-effort — if a customer replies, their MUA's References header
  // will include the real Message-ID, and our resolveThreadId() walk in
  // the inbound webhook will fall through to the existing thread via the
  // chain rooted at the original inbound message.
  const synthesizedMessageId = resendId ? `<${resendId}@scholify.krd>` : null;

  const insertRow = {
    message_id: synthesizedMessageId,
    in_reply_to: orig.message_id,
    references_header: refsChain || null,
    direction: 'outbound' as const,
    from_email: fromAddr,
    from_name: FROM_NAMES[fromAddr] || 'Scholify',
    to_email: orig.from_email,
    cc_emails: cc || [],
    subject,
    text_body: text,
    html_body: html,
    thread_id: orig.thread_id,
    is_read: true,
    is_archived: false,
    resend_id: resendId,
  };

  const { data: inserted, error: insErr } = await supabase
    .from('operator_emails')
    .insert(insertRow)
    .select('id')
    .single();
  if (insErr) {
    // Email already went out; failing the request here would mislead the
    // operator into sending again. Log and respond OK.
    console.error('Reply send succeeded but DB insert failed', insErr);
  }

  // Flag the original as "replied" so the list view shows the threading state.
  await supabase
    .from('operator_emails')
    .update({ replied_at: new Date().toISOString() })
    .eq('id', orig.id);

  res.json({ ok: true, id: inserted?.id, resendId });
});

export default router;
