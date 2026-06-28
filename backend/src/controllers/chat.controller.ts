import { Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { safeExt } from '../utils/upload';
import { safeAttachmentMime } from '../utils/storageMime';
import { toCC } from '../utils/transform';
import type { AuthRequest } from '../middleware/auth';
import { getIo, chatPush, notify } from '../utils/notify';
import { isChatOpen, type ChatWindowState } from '../utils/chatWindow';
import { safeDbErrorMessage, safeDbErrorStatus } from '../utils/dbErrors';
// Elevated client for STORAGE-only operations. Authorization for uploads
// is enforced at the route layer (authenticate + authorize). The path the
// controller writes to is built from JWT claims, not the request body, so
// the tenant scope is set in TypeScript before the storage call — no need
// to rely on storage.objects RLS. Matches the pattern in auth.controller's
// profile-picture upload.
import { adminDb } from '../utils/db';

// ── helpers ────────────────────────────────────────────────────────────────

function emitToUser(schoolId: string, userId: string, event: string, data: unknown) {
  getIo()?.to(`school:${schoolId}:user:${userId}`).emit(event, data);
}

/** Resolve the school's current chat-window state (single source of truth). */
async function schoolChatWindow(db: SupabaseClient, schoolId: string): Promise<ChatWindowState> {
  const { data } = await db
    .from('schools')
    .select('timezone, chat_restrictions')
    .eq('id', schoolId)
    .single();
  return isChatOpen(data?.chat_restrictions, data?.timezone);
}

async function buildConvWithUser(db: SupabaseClient, conv: any, userId: string, schoolId: string) {
  const otherId = conv.parent_id === userId ? conv.staff_id : conv.parent_id;
  const { data: other } = await db
    .from('users').select('id, first_name, last_name, profile_picture, role')
    .eq('id', otherId).maybeSingle();

  let subject: string | undefined;
  if (other?.role === 'teacher') {
    const { data: t } = await db
      .from('teachers').select('subject').eq('user_id', otherId).eq('school_id', schoolId).maybeSingle();
    subject = t?.subject;
  }

  const { data: readRow } = await db
    .from('conversation_reads').select('last_read_at')
    .eq('conversation_id', conv.id).eq('user_id', userId).maybeSingle();

  const hasUnread = conv.last_message_sender_id &&
    conv.last_message_sender_id !== userId &&
    (!readRow?.last_read_at || new Date(conv.last_message_at) > new Date(readRow.last_read_at));

  return {
    id: conv.id,
    otherUser: other ? {
      id: other.id,
      firstName: other.first_name,
      lastName: other.last_name,
      fullName: `${other.first_name} ${other.last_name}`.trim(),
      role: other.role,
      subject,
      profilePicture: other.profile_picture,
    } : null,
    lastMessageAt: conv.last_message_at,
    lastMessagePreview: conv.last_message_preview,
    lastMessageSenderId: conv.last_message_sender_id,
    lastMessageType: conv.last_message_type,
    hasUnread,
    createdAt: conv.created_at,
  };
}

// ── GET /chat/contacts ─────────────────────────────────────────────────────
// Parent → teachers of their children's classes + supervisors
// Teacher/Supervisor → all parents in school
export async function getContacts(req: AuthRequest, res: Response): Promise<void> {
  const { userId, schoolId, role } = req.user!;

  if (role === 'parent') {
    const contacts: any[] = [];

    // 1. Find parent record (best-effort — missing record just means no teacher contacts)
    const { data: parentRecord } = await req.db!
      .from('parents').select('id').eq('user_id', userId).eq('school_id', schoolId).maybeSingle();

    if (parentRecord) {
      // 2. Children's class IDs
      const { data: children } = await req.db!
        .from('students').select('class_id').eq('parent_id', parentRecord.id).eq('school_id', schoolId);

      const classIds = (children || []).map((c: any) => c.class_id).filter(Boolean);

      if (classIds.length > 0) {
        // 3. Teacher IDs for those classes
        const { data: tcRows } = await req.db!
          .from('teacher_classes').select('teacher_id').in('class_id', classIds);
        const teacherIds = [...new Set((tcRows || []).map((r: any) => r.teacher_id))] as string[];

        if (teacherIds.length > 0) {
          // 4a. Teacher profile rows
          const { data: teachers } = await req.db!
            .from('teachers')
            .select('id, user_id, full_name, subject')
            .in('id', teacherIds)
            .eq('school_id', schoolId);

          if (teachers && teachers.length > 0) {
            // 4b. Fetch user rows separately to avoid join ambiguity
            const teacherUserIds = teachers.map((t: any) => t.user_id);
            const { data: teacherUsers } = await req.db!
              .from('users').select('id, first_name, last_name, profile_picture, is_active')
              .in('id', teacherUserIds).eq('is_active', true);

            const userMap: Record<string, any> = {};
            (teacherUsers || []).forEach((u: any) => { userMap[u.id] = u; });

            teachers.forEach((t: any) => {
              const u = userMap[t.user_id];
              if (!u) return;
              contacts.push({
                id: t.user_id,
                firstName: u.first_name,
                lastName: u.last_name,
                fullName: t.full_name,
                role: 'teacher',
                subject: t.subject,
                profilePicture: u.profile_picture,
              });
            });
          }
        }
      }
    }

    // 5. Supervisors — always included regardless of parent record
    const { data: supers } = await req.db!
      .from('users').select('id, first_name, last_name, profile_picture')
      .eq('school_id', schoolId).eq('role', 'supervisor').eq('is_active', true);

    (supers || []).forEach((s: any) => {
      contacts.push({
        id: s.id,
        firstName: s.first_name,
        lastName: s.last_name,
        fullName: `${s.first_name} ${s.last_name}`.trim(),
        role: 'supervisor',
        profilePicture: s.profile_picture,
      });
    });

    res.json(contacts);
  } else {
    // Teacher / Supervisor → all parents in this school.
    // L-5: the previous implementation fetched parents.user_id[] then did
    // `.in('id', parentUserIds)` against users — a URL with 1000+ UUIDs
    // exceeds PostgREST / Cloudflare URL limits in any school over ~150
    // parents, silently returning [] (the error was never checked). Query
    // users directly by role + school instead, then attach parents.full_name
    // by a second small lookup.
    const { data: parentUsers, error: usersErr } = await req.db!
      .from('users')
      .select('id, first_name, last_name, profile_picture')
      .eq('school_id', schoolId)
      .eq('role', 'parent')
      .eq('is_active', true)
      .order('first_name');
    if (usersErr) {
      res.status(safeDbErrorStatus(usersErr)).json({ error: safeDbErrorMessage(usersErr) });
      return;
    }
    const users = parentUsers ?? [];
    if (users.length === 0) { res.json([]); return; }

    const userIds = users.map((u: any) => u.id);
    // Page through parents.full_name in chunks so a 1000+-parent school
    // never exceeds the URL length cap (~250 uuids ≈ 9-10 kB).
    const CHUNK = 200;
    const nameMap: Record<string, string> = {};
    for (let i = 0; i < userIds.length; i += CHUNK) {
      const slice = userIds.slice(i, i + CHUNK);
      const { data: parents } = await req.db!
        .from('parents')
        .select('user_id, full_name')
        .eq('school_id', schoolId)
        .in('user_id', slice);
      (parents ?? []).forEach((p: any) => {
        if (p.user_id) nameMap[p.user_id] = p.full_name;
      });
    }

    const contacts = users.map((u: any) => ({
      id: u.id,
      firstName: u.first_name,
      lastName: u.last_name,
      fullName: nameMap[u.id] || `${u.first_name} ${u.last_name}`.trim(),
      role: 'parent',
      profilePicture: u.profile_picture,
    }));

    res.json(contacts);
  }
}

// ── GET /chat/conversations ────────────────────────────────────────────────
export async function getConversations(req: AuthRequest, res: Response): Promise<void> {
  const { userId, schoolId } = req.user!;

  const { data: convs } = await req.db!
    .from('conversations')
    .select('id, parent_id, staff_id, staff_role, last_message_at, last_message_preview, last_message_sender_id, last_message_type, created_at')
    .eq('school_id', schoolId)
    .or(`parent_id.eq.${userId},staff_id.eq.${userId}`)
    .order('last_message_at', { ascending: false });

  if (!convs || convs.length === 0) { res.json([]); return; }

  // Collect other-participant user IDs
  const otherIds = convs.map((c: any) => c.parent_id === userId ? c.staff_id : c.parent_id);
  const uniqueIds = [...new Set(otherIds)];

  const { data: users } = await req.db!
    .from('users').select('id, first_name, last_name, profile_picture, role')
    .in('id', uniqueIds as string[]);

  // Teachers info (for subject)
  const teacherUserIds = (users || []).filter((u: any) => u.role === 'teacher').map((u: any) => u.id);
  let teacherMap: Record<string, string> = {};
  if (teacherUserIds.length > 0) {
    const { data: teacherRows } = await req.db!
      .from('teachers').select('user_id, subject').eq('school_id', schoolId).in('user_id', teacherUserIds);
    (teacherRows || []).forEach((t: any) => { teacherMap[t.user_id] = t.subject; });
  }

  const userMap: Record<string, any> = {};
  (users || []).forEach((u: any) => { userMap[u.id] = u; });

  // Read receipts
  const convIds = convs.map((c: any) => c.id);
  const { data: reads } = await req.db!
    .from('conversation_reads').select('conversation_id, last_read_at')
    .eq('user_id', userId).in('conversation_id', convIds);
  const readMap: Record<string, string> = {};
  (reads || []).forEach((r: any) => { readMap[r.conversation_id] = r.last_read_at; });

  const result = convs.map((c: any) => {
    const otherId = c.parent_id === userId ? c.staff_id : c.parent_id;
    const other = userMap[otherId];
    const lastRead = readMap[c.id];
    const hasUnread =
      c.last_message_sender_id &&
      c.last_message_sender_id !== userId &&
      (!lastRead || new Date(c.last_message_at) > new Date(lastRead));

    return {
      id: c.id,
      otherUser: other ? {
        id: other.id,
        firstName: other.first_name,
        lastName: other.last_name,
        fullName: `${other.first_name} ${other.last_name}`.trim(),
        role: other.role,
        subject: teacherMap[other.id],
        profilePicture: other.profile_picture,
      } : null,
      lastMessageAt: c.last_message_at,
      lastMessagePreview: c.last_message_preview,
      lastMessageSenderId: c.last_message_sender_id,
      lastMessageType: c.last_message_type,
      hasUnread,
      createdAt: c.created_at,
    };
  });

  res.json(result);
}

// ── POST /chat/conversations ───────────────────────────────────────────────
// Get or create a conversation with another user
export async function getOrCreateConversation(req: AuthRequest, res: Response): Promise<void> {
  const { userId, schoolId, role } = req.user!;
  const { otherUserId } = req.body;

  if (!otherUserId) { res.status(400).json({ error: 'otherUserId is required' }); return; }

  // Determine parent_id vs staff_id
  let parentId: string;
  let staffId: string;
  let staffRole: string;

  if (role === 'parent') {
    parentId = userId;
    staffId = otherUserId;
    // Look up other user's role
    const { data: other } = await req.db!.from('users').select('role').eq('id', otherUserId).single();
    if (!other || !['teacher', 'supervisor'].includes(other.role)) {
      res.status(400).json({ error: 'Invalid staff user' }); return;
    }
    staffRole = other.role;
  } else {
    staffId = userId;
    staffRole = role;
    parentId = otherUserId;
    // Verify other is a parent in same school
    const { data: other } = await req.db!.from('users').select('role, school_id').eq('id', otherUserId).single();
    if (!other || other.role !== 'parent' || other.school_id !== schoolId) {
      res.status(400).json({ error: 'Invalid parent user' }); return;
    }
  }

  // Upsert conversation
  const { data: existing } = await req.db!
    .from('conversations')
    .select('id, parent_id, staff_id, staff_role, last_message_at, last_message_preview, last_message_sender_id, last_message_type, created_at')
    .eq('school_id', schoolId)
    .eq('parent_id', parentId)
    .eq('staff_id', staffId)
    .single();

  if (existing) {
    res.json(await buildConvWithUser(req.db!, existing, userId, schoolId));
    return;
  }

  const { data: created, error } = await req.db!
    .from('conversations')
    .insert({ school_id: schoolId, parent_id: parentId, staff_id: staffId, staff_role: staffRole })
    .select('id, parent_id, staff_id, staff_role, last_message_at, last_message_preview, last_message_sender_id, last_message_type, created_at')
    .single();

  if (error || !created) { res.status(500).json({ error: 'Could not create conversation' }); return; }

  res.json(await buildConvWithUser(req.db!, created, userId, schoolId));
}

// ── GET /chat/conversations/:id/messages ───────────────────────────────────
export async function getMessages(req: AuthRequest, res: Response): Promise<void> {
  const { userId, schoolId } = req.user!;
  const { id } = req.params;
  const before = req.query.before as string | undefined; // cursor: message id
  const LIMIT = 30;

  // Verify access
  const { data: conv } = await req.db!
    .from('conversations').select('parent_id, staff_id')
    .eq('id', id).eq('school_id', schoolId).single();

  if (!conv || (conv.parent_id !== userId && conv.staff_id !== userId)) {
    res.status(403).json({ error: 'Forbidden' }); return;
  }

  let query = req.db!
    .from('messages')
    .select('id, sender_id, content, type, attachment_url, attachment_name, attachment_size, related_appointment_id, is_deleted, edited_at, created_at')
    .eq('conversation_id', id)
    // Composite ordering so messages sharing a created_at have a stable,
    // deterministic order (id tiebreak) — prevents the cursor skipping or
    // duplicating messages on identical timestamps.
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(LIMIT);

  if (before) {
    const { data: cursor } = await req.db!
      .from('messages').select('created_at, id').eq('id', before).single();
    if (cursor) {
      // "Older than the cursor row" in (created_at, id) order.
      query = query.or(
        `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
      );
    }
  }

  const { data: messages } = await query;
  const rows = (messages || []).reverse();

  // Chat invite cards (migration 062): attach each invite message's live
  // appointment so the card renders the current status (invited / pending /
  // approved+date / rejected) for both sides without a second client request.
  const apptIds = [...new Set(
    rows.filter((m: any) => m.type === 'invite' && m.related_appointment_id)
        .map((m: any) => m.related_appointment_id),
  )] as string[];
  const apptMap: Record<string, any> = {};
  if (apptIds.length > 0) {
    const { data: appts } = await req.db!
      .from('appointments')
      .select('id, status, invite_reason, reason, requested_date, scheduled_date')
      .eq('school_id', schoolId)
      .in('id', apptIds);
    (appts || []).forEach((a: any) => { apptMap[a.id] = a; });
  }

  res.json(rows.map((m: any) => {
    const out = toCC(m) as Record<string, unknown>;
    if (m.type === 'invite' && m.related_appointment_id) {
      const a = apptMap[m.related_appointment_id];
      out.appointment = a ? toCC(a) : null;
    }
    return out;
  }));
}

// ── POST /chat/conversations/:id/messages ─────────────────────────────────
export async function sendMessage(req: AuthRequest, res: Response): Promise<void> {
  const { userId, schoolId } = req.user!;
  const { id } = req.params;
  const { content, type = 'text', attachmentUrl, attachmentName, attachmentSize } = req.body;

  if (type === 'text' && !content?.trim()) {
    res.status(400).json({ error: 'Message content is required' }); return;
  }

  // Verify access
  const { data: conv } = await req.db!
    .from('conversations').select('parent_id, staff_id')
    .eq('id', id).eq('school_id', schoolId).single();

  if (!conv || (conv.parent_id !== userId && conv.staff_id !== userId)) {
    res.status(403).json({ error: 'Forbidden' }); return;
  }

  // Chat schedule: freeze sends (both sides) outside the school's window.
  const win = await schoolChatWindow(req.db!, schoolId);
  if (!win.open) {
    res.status(423).json({
      error: win.message || 'Chat is closed by the school.',
      chatClosed: true,
      opensDay: win.opensDay,
      opensTime: win.opensTime,
    });
    return;
  }

  const { data: msg, error } = await req.db!
    .from('messages')
    .insert({
      conversation_id: id,
      sender_id: userId,
      content: content || null,
      type,
      attachment_url: attachmentUrl || null,
      attachment_name: attachmentName || null,
      attachment_size: attachmentSize || null,
    })
    .select('id, sender_id, content, type, attachment_url, attachment_name, attachment_size, is_deleted, edited_at, created_at')
    .single();

  if (error || !msg) { res.status(500).json({ error: 'Failed to send message' }); return; }

  // Update conversation preview
  const preview = type === 'text' ? (content || '').substring(0, 100)
    : type === 'image' ? '📷 Photo'
    : `📎 ${attachmentName || 'File'}`;

  await req.db!.from('conversations').update({
    last_message_at: msg.created_at,
    last_message_preview: preview,
    last_message_sender_id: userId,
    last_message_type: type,
  }).eq('id', id);

  const outMsg = toCC(msg) as Record<string, unknown>;

  // Emit to both participants
  const recipientId = conv.parent_id === userId ? conv.staff_id : conv.parent_id;
  const eventPayload = { ...outMsg, conversationId: id };
  emitToUser(schoolId, recipientId, 'chat:message', eventPayload);
  emitToUser(schoolId, userId, 'chat:message', eventPayload);

  // Push notification to recipient (best-effort)
  const { data: sender } = await req.db!.from('users').select('first_name, last_name').eq('id', userId).single();
  if (sender) {
    const senderName = `${sender.first_name} ${sender.last_name}`.trim();
    chatPush(recipientId, senderName, preview, id as string).catch(() => {});
  }

  res.status(201).json(outMsg);
}

// ── POST /chat/conversations/:id/invite ────────────────────────────────────
// Phase D (chat extension) — a supervisor invites the parent in this thread to
// a meeting. Creates an appointment (status 'invited', invited_by=caller) and
// posts a type='invite' chat message that carries related_appointment_id. The
// parent fills it inline from the card → existing /parent/appointments flow.
export async function sendInvite(req: AuthRequest, res: Response): Promise<void> {
  const { userId, schoolId, role } = req.user!;
  const { id } = req.params;
  const { reason } = req.body;

  if (role !== 'supervisor') { res.status(403).json({ error: 'Only supervisors can send meeting invites.' }); return; }

  // Verify the caller is THIS conversation's supervisor.
  const { data: conv } = await req.db!
    .from('conversations').select('parent_id, staff_id, staff_role')
    .eq('id', id).eq('school_id', schoolId).single();
  if (!conv || conv.staff_id !== userId || conv.staff_role !== 'supervisor') {
    res.status(403).json({ error: 'Forbidden' }); return;
  }

  // Chat schedule: respect the school's window (same gate as sending a message).
  const win = await schoolChatWindow(req.db!, schoolId);
  if (!win.open) {
    res.status(423).json({ error: win.message || 'Chat is closed by the school.', chatClosed: true, opensDay: win.opensDay, opensTime: win.opensTime });
    return;
  }

  // conversation.parent_id is a users.id; appointments.parent_id needs parents.id.
  const { data: parent } = await req.db!
    .from('parents').select('id, full_name').eq('user_id', conv.parent_id).eq('school_id', schoolId).maybeSingle();
  if (!parent) { res.status(404).json({ error: 'This parent has no parent record to invite.' }); return; }

  // 1. Create the appointment invite.
  const { data: appt, error: apptErr } = await req.db!
    .from('appointments')
    .insert({
      school_id: schoolId,
      parent_id: parent.id,
      invited_by: userId,
      invite_reason: reason || null,
      student_ids: [],
      status: 'invited',
    })
    .select('id, status, invite_reason, reason, requested_date, scheduled_date')
    .single();
  if (apptErr || !appt) { res.status(500).json({ error: 'Could not create the invite.' }); return; }

  // 2. Post the in-chat invite card message.
  const { data: msg, error: msgErr } = await req.db!
    .from('messages')
    .insert({
      conversation_id: id,
      sender_id: userId,
      content: reason || null,
      type: 'invite',
      related_appointment_id: appt.id,
    })
    .select('id, sender_id, content, type, attachment_url, attachment_name, attachment_size, related_appointment_id, is_deleted, edited_at, created_at')
    .single();
  if (msgErr || !msg) { res.status(500).json({ error: 'Could not post the invite.' }); return; }

  // Update conversation preview.
  const preview = '📅 Meeting invitation';
  await req.db!.from('conversations').update({
    last_message_at: msg.created_at,
    last_message_preview: preview,
    last_message_sender_id: userId,
    last_message_type: 'invite',
  }).eq('id', id);

  const outMsg = toCC(msg) as Record<string, unknown>;
  outMsg.appointment = toCC(appt);

  // Emit to both participants (same path as sendMessage).
  const eventPayload = { ...outMsg, conversationId: id };
  emitToUser(schoolId, conv.parent_id, 'chat:message', eventPayload);
  emitToUser(schoolId, userId, 'chat:message', eventPayload);

  // In-app notification + push to the parent.
  const { data: sender } = await req.db!.from('users').select('first_name, last_name').eq('id', userId).single();
  const senderName = sender ? `${sender.first_name} ${sender.last_name}`.trim() : 'Your school';
  notify({
    schoolId, userId: conv.parent_id,
    title: 'Meeting invitation',
    message: `${senderName} invited you to a meeting${reason ? `: ${reason}` : ''}. Open the chat to choose a time or decline.`,
    type: 'appointment',
    relatedId: appt.id,
  }).catch(() => {});
  chatPush(conv.parent_id, senderName, preview, id as string).catch(() => {});

  res.status(201).json(outMsg);
}

// ── PATCH /chat/messages/:msgId ───────────────────────────────────────────
export async function editMessage(req: AuthRequest, res: Response): Promise<void> {
  const { userId, schoolId } = req.user!;
  const { msgId } = req.params;
  const { content } = req.body;

  if (!content?.trim()) { res.status(400).json({ error: 'content is required' }); return; }

  // Fetch message + conversation (include current content so we can snapshot it)
  const { data: msg } = await req.db!
    .from('messages')
    .select('id, sender_id, conversation_id, type, content')
    .eq('id', msgId).single();

  if (!msg || msg.sender_id !== userId || msg.type !== 'text') {
    res.status(403).json({ error: 'Forbidden' }); return;
  }

  // Verify conversation belongs to school
  const { data: conv } = await req.db!
    .from('conversations').select('parent_id, staff_id')
    .eq('id', msg.conversation_id).eq('school_id', schoolId).single();

  if (!conv) { res.status(403).json({ error: 'Forbidden' }); return; }

  // Preserve the prior version for audit before overwriting
  if (msg.content != null) {
    await req.db!.from('message_edits').insert({
      message_id: msgId,
      previous_content: msg.content,
    });
  }

  const { data: updated } = await req.db!
    .from('messages')
    .update({ content, edited_at: new Date().toISOString() })
    .eq('id', msgId)
    .select('id, sender_id, content, type, attachment_url, attachment_name, attachment_size, is_deleted, edited_at, created_at')
    .single();

  const out = toCC(updated) as Record<string, unknown>;
  const recipientId = conv.parent_id === userId ? conv.staff_id : conv.parent_id;
  const eventPayload = { ...out, conversationId: msg.conversation_id };
  emitToUser(schoolId, recipientId, 'chat:edit', eventPayload);
  emitToUser(schoolId, userId, 'chat:edit', eventPayload);

  res.json(out);
}

// ── DELETE /chat/messages/:msgId ──────────────────────────────────────────
export async function deleteMessage(req: AuthRequest, res: Response): Promise<void> {
  const { userId, schoolId } = req.user!;
  const { msgId } = req.params;

  const { data: msg } = await req.db!
    .from('messages').select('sender_id, conversation_id, content, attachment_url, attachment_name').eq('id', msgId).single();

  if (!msg || msg.sender_id !== userId) { res.status(403).json({ error: 'Forbidden' }); return; }

  const { data: conv } = await req.db!
    .from('conversations').select('parent_id, staff_id')
    .eq('id', msg.conversation_id).eq('school_id', schoolId).single();
  if (!conv) { res.status(403).json({ error: 'Forbidden' }); return; }

  // Snapshot pre-deletion state into the audit-only columns, then null the
  // user-facing fields so existing clients still render "message deleted".
  await req.db!.from('messages')
    .update({
      is_deleted: true,
      content: null,
      attachment_url: null,
      attachment_name: null,
      attachment_size: null,
      deleted_content: msg.content ?? null,
      deleted_attachment_url: msg.attachment_url ?? null,
      deleted_attachment_name: msg.attachment_name ?? null,
    })
    .eq('id', msgId);

  const eventPayload = { id: msgId, conversationId: msg.conversation_id };
  const recipientId = conv.parent_id === userId ? conv.staff_id : conv.parent_id;
  emitToUser(schoolId, recipientId, 'chat:delete', eventPayload);
  emitToUser(schoolId, userId, 'chat:delete', eventPayload);

  res.json({ success: true });
}

// ── POST /chat/conversations/:id/read ─────────────────────────────────────
export async function markRead(req: AuthRequest, res: Response): Promise<void> {
  const { userId, schoolId } = req.user!;
  const { id } = req.params;

  const { data: conv } = await req.db!
    .from('conversations').select('parent_id, staff_id')
    .eq('id', id).eq('school_id', schoolId).single();

  if (!conv || (conv.parent_id !== userId && conv.staff_id !== userId)) {
    res.status(403).json({ error: 'Forbidden' }); return;
  }

  await req.db!.from('conversation_reads')
    .upsert({ conversation_id: id, user_id: userId, last_read_at: new Date().toISOString() },
      { onConflict: 'conversation_id,user_id' });

  res.json({ success: true });
}

// ── GET /chat/unread-count ─────────────────────────────────────────────────
export async function getUnreadCount(req: AuthRequest, res: Response): Promise<void> {
  const { userId, schoolId } = req.user!;

  const { data: convs } = await req.db!
    .from('conversations')
    .select('id, last_message_at, last_message_sender_id')
    .eq('school_id', schoolId)
    .or(`parent_id.eq.${userId},staff_id.eq.${userId}`)
    .neq('last_message_sender_id', userId);

  if (!convs || convs.length === 0) { res.json({ count: 0 }); return; }

  const convIds = convs.map((c: any) => c.id);
  const { data: reads } = await req.db!
    .from('conversation_reads').select('conversation_id, last_read_at')
    .eq('user_id', userId).in('conversation_id', convIds);
  const readMap: Record<string, string> = {};
  (reads || []).forEach((r: any) => { readMap[r.conversation_id] = r.last_read_at; });

  const count = convs.filter((c: any) => {
    const lastRead = readMap[c.id];
    return !lastRead || new Date(c.last_message_at) > new Date(lastRead);
  }).length;

  res.json({ count });
}

// ── GET /chat/window ───────────────────────────────────────────────────────
// Lets web/mobile proactively disable the composer. The send endpoint still
// enforces (423) — this is UX, not the gate.
export async function getChatWindow(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const win = await schoolChatWindow(req.db!, schoolId);
  res.json(win);
}

// ── POST /chat/upload ──────────────────────────────────────────────────────
export async function uploadAttachment(req: AuthRequest, res: Response): Promise<void> {
  const { userId, schoolId } = req.user!;
  const file = (req as any).file;
  if (!file) { res.status(400).json({ error: 'No file provided' }); return; }

  const ext = safeExt(file.originalname, '.bin');
  const path = `${schoolId}/${userId}/${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
  const storedMime = safeAttachmentMime(file.mimetype);

  // Storage write goes through adminDb — see the import banner. Authz
  // is enforced at the route layer (chatRoles) and the path is built
  // from JWT claims above. contentType comes from the allowlist
  // (storageMime.ts) so client-claimed text/html / image/svg+xml never
  // lands as the stored Content-Type — pentest H-2 belt-and-suspenders.
  const { error } = await adminDb.storage
    .from('chat-files')
    .upload(path, file.buffer, { contentType: storedMime, upsert: false });

  if (error) { res.status(500).json({ error: 'Upload failed' }); return; }

  // HD-11 — record the upload in chat_attachments so the orphan sweep
  // (HD-15) can tell tracked files from leftovers, and so we can answer
  // "who uploaded the file at <key>?" given just the path. Best-effort:
  // if the DB write fails the upload still succeeds (the file is already
  // in storage and the user shouldn't see a transient failure), but
  // we log so it's visible in operator monitoring.
  const { error: trackErr } = await adminDb
    .from('chat_attachments')
    .insert({
      school_id: schoolId,
      uploader_id: userId,
      storage_bucket: 'chat-files',
      storage_path: path,
      content_type: storedMime,
      byte_size: file.size,
    });
  if (trackErr) {
    console.error(`[chat-upload] failed to record attachment ${path}: ${trackErr.message}`);
  }

  const { data: { publicUrl } } = adminDb.storage.from('chat-files').getPublicUrl(path);

  const isImage = storedMime.startsWith('image/');

  res.json({
    url: publicUrl,
    name: file.originalname,
    size: file.size,
    type: isImage ? 'image' : 'file',
  });
}
