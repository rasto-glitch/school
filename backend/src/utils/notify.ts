import { Server as SocketServer } from 'socket.io';
// Notifications are server-initiated (system events, cron) — no request
// context to attach. Elevated client by design.
import { adminDb as supabase } from './db';
import { translatePush } from './notifyI18n';

let _io: SocketServer | null = null;

export function setIo(io: SocketServer) {
  _io = io;
}

export function getIo(): SocketServer | null {
  return _io;
}

export function emitToAdmins(schoolId: string, event: string, data: unknown): void {
  if (_io) _io.to(`school:${schoolId}:admins`).emit(event, data);
}

interface NotifyPayload {
  schoolId: string;
  userId: string;
  title: string;
  message: string;
  type?: string;
  relatedId?: string;
}

/**
 * Inserts a notification into the DB, emits a socket event to the user,
 * and sends an Expo push notification if the user has a registered device token.
 */
export async function notify(payload: NotifyPayload): Promise<void> {
  const { schoolId, userId, title, message, type = 'general', relatedId } = payload;

  // 1. Save to DB
  const { error: insertError } = await supabase.from('notifications').insert({
    school_id: schoolId,
    user_id: userId,
    title,
    message,
    notification_type: type,
    related_id: relatedId ?? null,
  });
  if (insertError) console.error('[notify] notifications insert failed', { type, userId, error: insertError.message });

  // 2. Real-time socket event
  if (_io) {
    _io.to(`school:${schoolId}:user:${userId}`).emit('notification', { title, message, type });
  }

  // 3. Expo push notification
  const { data: tokens } = await supabase
    .from('device_tokens')
    .select('token, language')
    .eq('user_id', userId);

  if (tokens && tokens.length > 0) {
    const messages = tokens.map((t: { token: string; language: string | null }) => {
      const { title: tTitle, body: tBody } = translatePush(title, message, type, t.language ?? 'en');
      const data: Record<string, string> = { type };
      if (relatedId) data.relatedId = relatedId;
      return { to: t.token, title: tTitle, body: tBody, data, sound: 'default', channelId: 'default', priority: 'high' };
    });

    try {
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Accept-Encoding': 'gzip, deflate' },
        body: JSON.stringify(messages.length === 1 ? messages[0] : messages),
      });
    } catch {
      // Push delivery is best-effort — never block the main flow
    }
  }
}

/**
 * Notify multiple users at once (e.g. all parents in a class).
 */
export async function notifyMany(payloads: NotifyPayload[]): Promise<void> {
  if (payloads.length === 0) return;

  // Batch DB insert
  const { error: insertError } = await supabase.from('notifications').insert(
    payloads.map(p => ({
      school_id: p.schoolId,
      user_id: p.userId,
      title: p.title,
      message: p.message,
      notification_type: p.type ?? 'general',
      related_id: p.relatedId ?? null,
    }))
  );
  if (insertError) console.error('[notifyMany] notifications insert failed', { count: payloads.length, type: payloads[0]?.type, error: insertError.message });

  // Batched device_tokens lookup — one query for all recipients instead of N.
  // SECURITY (H-4 defense-in-depth): also scope by school_id so this can
  // never deliver a push to a same-userId row stored under a different
  // school. In practice every payload arrives from a single-tenant caller,
  // so it's safe to use the first payload's schoolId as the filter.
  const userIds = Array.from(new Set(payloads.map(p => p.userId)));
  const senderSchoolIds = Array.from(new Set(payloads.map(p => p.schoolId)));
  const tokensByUser = new Map<string, { token: string; language: string | null }[]>();
  if (userIds.length > 0) {
    let q = supabase
      .from('device_tokens')
      .select('user_id, token, language')
      .in('user_id', userIds);
    if (senderSchoolIds.length === 1) q = q.eq('school_id', senderSchoolIds[0]);
    else q = q.in('school_id', senderSchoolIds);
    const { data: tokenRows } = await q;
    for (const t of (tokenRows ?? []) as { user_id: string; token: string; language: string | null }[]) {
      const arr = tokensByUser.get(t.user_id) ?? [];
      arr.push({ token: t.token, language: t.language });
      tokensByUser.set(t.user_id, arr);
    }
  }

  // Socket + push per user (push dispatched in parallel using the pre-fetched tokens)
  await Promise.all(payloads.map(p => {
    if (_io) _io.to(`school:${p.schoolId}:user:${p.userId}`).emit('notification', { title: p.title, message: p.message, type: p.type });
    const tokens = tokensByUser.get(p.userId);
    if (!tokens || tokens.length === 0) return Promise.resolve();
    return sendPushWithTokens(tokens, p.title, p.message, p.type ?? 'general', p.relatedId ? { relatedId: p.relatedId } : undefined);
  }));
}

async function sendPushWithTokens(
  tokens: { token: string; language: string | null }[],
  title: string,
  body: string,
  type: string,
  extraData?: Record<string, string>,
): Promise<void> {
  const messages = tokens.map((t) => {
    const { title: tTitle, body: tBody } = translatePush(title, body, type, t.language ?? 'en');
    return { to: t.token, title: tTitle, body: tBody, data: { type, ...extraData }, sound: 'default', channelId: 'default', priority: 'high' };
  });
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Accept-Encoding': 'gzip, deflate' },
      body: JSON.stringify(messages.length === 1 ? messages[0] : messages),
    });
  } catch {}
}

/**
 * Send a push notification for a new chat message without writing to the notifications table.
 */
export async function chatPush(userId: string, senderName: string, preview: string, conversationId?: string): Promise<void> {
  const extra: Record<string, string> = { type: 'chat' };
  if (conversationId) extra.conversationId = conversationId;
  await sendPush(userId, senderName, preview, 'chat', extra);
}

async function sendPush(userId: string, title: string, body: string, type: string, extraData?: Record<string, string>): Promise<void> {
  const { data: tokens } = await supabase.from('device_tokens').select('token, language').eq('user_id', userId);
  if (!tokens || tokens.length === 0) return;
  const messages = tokens.map((t: { token: string; language: string | null }) => {
    const { title: tTitle, body: tBody } = translatePush(title, body, type, t.language ?? 'en');
    return { to: t.token, title: tTitle, body: tBody, data: { type, ...extraData }, sound: 'default', channelId: 'default', priority: 'high' };
  });
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Accept-Encoding': 'gzip, deflate' },
      body: JSON.stringify(messages.length === 1 ? messages[0] : messages),
    });
  } catch {}
}
