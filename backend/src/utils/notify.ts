import { Server as SocketServer } from 'socket.io';
import { supabase } from '../config/supabase';
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
  await supabase.from('notifications').insert({
    school_id: schoolId,
    user_id: userId,
    title,
    message,
    notification_type: type,
    related_id: relatedId ?? null,
  });

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
      return { to: t.token, title: tTitle, body: tBody, data: { type }, sound: 'default', channelId: 'default', priority: 'high' };
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
  await supabase.from('notifications').insert(
    payloads.map(p => ({
      school_id: p.schoolId,
      user_id: p.userId,
      title: p.title,
      message: p.message,
      notification_type: p.type ?? 'general',
      related_id: p.relatedId ?? null,
    }))
  );

  // Socket + push per user
  await Promise.all(payloads.map(p => {
    if (_io) _io.to(`school:${p.schoolId}:user:${p.userId}`).emit('notification', { title: p.title, message: p.message, type: p.type });
    return sendPush(p.userId, p.title, p.message, p.type ?? 'general');
  }));
}

/**
 * Send a push notification for a new chat message without writing to the notifications table.
 */
export async function chatPush(userId: string, senderName: string, preview: string): Promise<void> {
  await sendPush(userId, senderName, preview, 'chat');
}

async function sendPush(userId: string, title: string, body: string, type: string): Promise<void> {
  const { data: tokens } = await supabase.from('device_tokens').select('token, language').eq('user_id', userId);
  if (!tokens || tokens.length === 0) return;
  const messages = tokens.map((t: { token: string; language: string | null }) => {
    const { title: tTitle, body: tBody } = translatePush(title, body, type, t.language ?? 'en');
    return { to: t.token, title: tTitle, body: tBody, data: { type }, sound: 'default', channelId: 'default', priority: 'high' };
  });
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Accept-Encoding': 'gzip, deflate' },
      body: JSON.stringify(messages.length === 1 ? messages[0] : messages),
    });
  } catch {}
}
