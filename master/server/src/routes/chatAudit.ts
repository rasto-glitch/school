import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';

const router = Router();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Every privileged read is logged. Caller must supply a reason.
async function logAccess(schoolId: string, conversationId: string | null, action: 'view' | 'export', reason: string) {
  await supabase.from('chat_access_log').insert({
    school_id: schoolId,
    conversation_id: conversationId,
    action,
    reason,
  });
}

// GET /api/chat-audit/schools/:schoolId/conversations — list conversations for a school
router.get('/schools/:schoolId/conversations', async (req: Request, res: Response) => {
  const { schoolId } = req.params;

  const { data: convs, error } = await supabase
    .from('conversations')
    .select('id, parent_id, staff_id, staff_role, last_message_at, last_message_preview, created_at')
    .eq('school_id', schoolId)
    .order('last_message_at', { ascending: false, nullsFirst: false });

  if (error) { res.status(500).json({ error: error.message }); return; }
  if (!convs || convs.length === 0) { res.json([]); return; }

  const userIds = Array.from(new Set(convs.flatMap(c => [c.parent_id, c.staff_id])));
  const { data: users } = await supabase
    .from('users').select('id, first_name, last_name, role').in('id', userIds);
  const userMap: Record<string, { firstName: string; lastName: string; role: string }> = {};
  (users || []).forEach(u => {
    userMap[u.id] = { firstName: u.first_name, lastName: u.last_name, role: u.role };
  });

  const { data: messageCounts } = await supabase
    .from('messages')
    .select('conversation_id')
    .in('conversation_id', convs.map(c => c.id));
  const countMap: Record<string, number> = {};
  (messageCounts || []).forEach((m: { conversation_id: string }) => {
    countMap[m.conversation_id] = (countMap[m.conversation_id] || 0) + 1;
  });

  res.json(convs.map(c => ({
    id: c.id,
    parent: userMap[c.parent_id] || null,
    staff: userMap[c.staff_id] || null,
    staffRole: c.staff_role,
    lastMessageAt: c.last_message_at,
    lastMessagePreview: c.last_message_preview,
    createdAt: c.created_at,
    messageCount: countMap[c.id] || 0,
  })));
});

// GET /api/chat-audit/conversations/:id/messages?reason=... — full history
// Returns everything, including soft-deleted content and edit history.
router.get('/conversations/:id/messages', async (req: Request, res: Response) => {
  const { id } = req.params;
  const reason = (req.query.reason as string | undefined)?.trim();

  if (!reason || reason.length < 3) {
    res.status(400).json({ error: 'A reason of at least 3 characters is required.' });
    return;
  }

  const { data: convRaw } = await supabase
    .from('conversations').select('school_id, parent_id, staff_id').eq('id', id).single();
  if (!convRaw) { res.status(404).json({ error: 'Conversation not found' }); return; }
  const conv = convRaw as unknown as { school_id: string; parent_id: string; staff_id: string };

  const { data: messages, error } = await supabase
    .from('messages')
    .select('id, sender_id, content, type, attachment_url, attachment_name, attachment_size, is_deleted, edited_at, deleted_content, deleted_attachment_url, deleted_attachment_name, created_at')
    .eq('conversation_id', id)
    .order('created_at', { ascending: true });

  if (error) { res.status(500).json({ error: error.message }); return; }

  // Edit history for every message in this conversation
  const messageIds = (messages || []).map(m => m.id);
  let editMap: Record<string, { previousContent: string | null; editedAt: string }[]> = {};
  if (messageIds.length > 0) {
    const { data: edits } = await supabase
      .from('message_edits')
      .select('message_id, previous_content, edited_at')
      .in('message_id', messageIds)
      .order('edited_at', { ascending: true });
    (edits || []).forEach((e: { message_id: string; previous_content: string | null; edited_at: string }) => {
      if (!editMap[e.message_id]) editMap[e.message_id] = [];
      editMap[e.message_id].push({ previousContent: e.previous_content, editedAt: e.edited_at });
    });
  }

  const senderIds = Array.from(new Set((messages || []).map(m => m.sender_id)));
  const { data: users } = await supabase
    .from('users').select('id, first_name, last_name, role').in('id', senderIds);
  const userMap: Record<string, { firstName: string; lastName: string; role: string }> = {};
  (users || []).forEach(u => {
    userMap[u.id] = { firstName: u.first_name, lastName: u.last_name, role: u.role };
  });

  await logAccess(conv.school_id, String(id), 'view', reason);

  res.json({
    messages: (messages || []).map(m => ({
      id: m.id,
      sender: userMap[m.sender_id] || null,
      senderId: m.sender_id,
      content: m.content,
      type: m.type,
      attachmentUrl: m.attachment_url,
      attachmentName: m.attachment_name,
      attachmentSize: m.attachment_size,
      isDeleted: m.is_deleted,
      editedAt: m.edited_at,
      deletedContent: m.deleted_content,
      deletedAttachmentUrl: m.deleted_attachment_url,
      deletedAttachmentName: m.deleted_attachment_name,
      createdAt: m.created_at,
      edits: editMap[m.id] || [],
    })),
  });
});

// GET /api/chat-audit/conversations/:id/export?reason=... — CSV
router.get('/conversations/:id/export', async (req: Request, res: Response) => {
  const { id } = req.params;
  const reason = (req.query.reason as string | undefined)?.trim();

  if (!reason || reason.length < 3) {
    res.status(400).json({ error: 'A reason of at least 3 characters is required.' });
    return;
  }

  const { data: convRaw } = await supabase
    .from('conversations').select('school_id').eq('id', id).single();
  if (!convRaw) { res.status(404).json({ error: 'Conversation not found' }); return; }
  const conv = convRaw as unknown as { school_id: string };

  const { data: messages } = await supabase
    .from('messages')
    .select('id, sender_id, content, type, attachment_url, attachment_name, is_deleted, edited_at, deleted_content, created_at')
    .eq('conversation_id', id)
    .order('created_at', { ascending: true });

  const senderIds = Array.from(new Set((messages || []).map(m => m.sender_id)));
  const { data: users } = await supabase
    .from('users').select('id, first_name, last_name, role').in('id', senderIds);
  const userMap: Record<string, { name: string; role: string }> = {};
  (users || []).forEach(u => {
    userMap[u.id] = { name: `${u.first_name} ${u.last_name}`.trim(), role: u.role };
  });

  const messageIds = (messages || []).map(m => m.id);
  let editMap: Record<string, { previousContent: string | null; editedAt: string }[]> = {};
  if (messageIds.length > 0) {
    const { data: edits } = await supabase
      .from('message_edits').select('message_id, previous_content, edited_at').in('message_id', messageIds)
      .order('edited_at', { ascending: true });
    (edits || []).forEach((e: { message_id: string; previous_content: string | null; edited_at: string }) => {
      if (!editMap[e.message_id]) editMap[e.message_id] = [];
      editMap[e.message_id].push({ previousContent: e.previous_content, editedAt: e.edited_at });
    });
  }

  const esc = (v: string | null | undefined) => {
    if (v == null) return '';
    return `"${String(v).replace(/"/g, '""')}"`;
  };

  const header = 'created_at,sender_name,sender_role,type,content,attachment_name,attachment_url,is_deleted,deleted_content,edited_at,prior_versions\n';
  const rows = (messages || []).map(m => {
    const user = userMap[m.sender_id] || { name: '(unknown)', role: '' };
    const priorVersions = (editMap[m.id] || [])
      .map(e => `[${e.editedAt}] ${e.previousContent ?? ''}`)
      .join(' || ');
    return [
      esc(m.created_at),
      esc(user.name),
      esc(user.role),
      esc(m.type),
      esc(m.content),
      esc(m.attachment_name),
      esc(m.attachment_url),
      esc(m.is_deleted ? 'true' : 'false'),
      esc(m.deleted_content),
      esc(m.edited_at),
      esc(priorVersions),
    ].join(',');
  }).join('\n');

  await logAccess(conv.school_id, String(id), 'export', reason);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="chat-${id}.csv"`);
  res.send(header + rows + '\n');
});

// GET /api/chat-audit/access-log?schoolId=... — view audit-access history
router.get('/access-log', async (req: Request, res: Response) => {
  const schoolId = req.query.schoolId as string | undefined;

  let query = supabase
    .from('chat_access_log')
    .select('id, school_id, conversation_id, action, reason, accessed_at')
    .order('accessed_at', { ascending: false })
    .limit(500);
  if (schoolId) query = query.eq('school_id', schoolId);

  const { data, error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data || []);
});

export default router;
