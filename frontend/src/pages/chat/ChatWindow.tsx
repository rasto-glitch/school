import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { format, isToday, isYesterday, isSameDay } from 'date-fns';
import { Loader2, MessageSquare, X } from 'lucide-react';
import { chatApi, parentApi } from '../../services/api';
import { useSocketStore } from '../../store/socketStore';
import { useAuthStore } from '../../store/authStore';
import MessageBubble, { type Message } from './MessageBubble';
import MessageInput from './MessageInput';
import InviteCard from './InviteCard';

interface ConversationUser {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  role: string;
  subject?: string;
  profilePicture?: string;
}

interface Props {
  conversationId: string;
  otherUser: ConversationUser;
  onMessageSent: (preview: string, type: string) => void;
}

function DateSeparator({ date }: { date: Date }) {
  const { t } = useTranslation();
  const label = isToday(date) ? t('common.today')
    : isYesterday(date) ? t('common.yesterday')
    : format(date, 'MMMM d, yyyy');
  return (
    <div className="flex items-center gap-3 my-4 px-4">
      <div className="flex-1 h-px bg-gray-200" />
      <span className="text-xs text-gray-400 font-medium">{label}</span>
      <div className="flex-1 h-px bg-gray-200" />
    </div>
  );
}

export default function ChatWindow({ conversationId, otherUser, onMessageSent }: Props) {
  const { t } = useTranslation();
  const { user, school } = useAuthStore();
  const { socket } = useSocketStore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [otherTyping, setOtherTyping] = useState(false);
  const [closedMsg, setClosedMsg] = useState<string | null>(null);
  // Invite flow
  const isParent = user?.role === 'parent';
  const canInvite = user?.role === 'supervisor';
  const [completing, setCompleting] = useState<Message | null>(null);
  const [completeReason, setCompleteReason] = useState('');
  const [completeDate, setCompleteDate] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [sendInviteOpen, setSendInviteOpen] = useState(false);
  const [sendReason, setSendReason] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const primaryColor = school?.primaryColor || '#4F46E5';
  const LIMIT = 30;

  // Load initial messages
  useEffect(() => {
    setMessages([]);
    setLoading(true);
    setHasMore(true);

    chatApi.getMessages(conversationId)
      .then(res => {
        const msgs: Message[] = res.data;
        setMessages(msgs);
        setHasMore(msgs.length === LIMIT);
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    // Mark read
    chatApi.markRead(conversationId).catch(() => {});
  }, [conversationId]);

  // Chat schedule: probe the server (single source of truth) on open + poll.
  useEffect(() => {
    let alive = true;
    const check = () => chatApi.getChatWindow()
      .then(r => { if (alive) setClosedMsg(r.data?.open ? null : (r.data?.message || t('chat.chat_closed'))); })
      .catch(() => {});
    check();
    const timer = setInterval(check, 60_000);
    return () => { alive = false; clearInterval(timer); };
  }, [conversationId]);

  // Scroll to bottom on first load
  useEffect(() => {
    if (!loading) {
      bottomRef.current?.scrollIntoView({ behavior: 'instant' });
    }
  }, [loading]);

  // Socket: incoming messages
  useEffect(() => {
    if (!socket) return;

    const onMessage = (data: Message & { conversationId: string }) => {
      if (data.conversationId !== conversationId) return;
      setMessages(prev => {
        if (prev.find(m => m.id === data.id)) return prev;
        return [...prev, data];
      });
      chatApi.markRead(conversationId).catch(() => {});
      // Auto-scroll if near bottom
      const el = scrollRef.current;
      if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 120) {
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
      }
    };

    const onEdit = (data: Message & { conversationId: string }) => {
      if (data.conversationId !== conversationId) return;
      setMessages(prev => prev.map(m => m.id === data.id ? { ...m, content: data.content, editedAt: data.editedAt } : m));
    };

    const onDelete = (data: { id: string; conversationId: string }) => {
      if (data.conversationId !== conversationId) return;
      setMessages(prev => prev.map(m => m.id === data.id ? { ...m, isDeleted: true, content: undefined } : m));
    };

    const onTyping = (data: { conversationId: string; senderId: string; isTyping: boolean }) => {
      if (data.conversationId !== conversationId || data.senderId !== otherUser.id) return;
      setOtherTyping(data.isTyping);
      if (typingTimer.current) clearTimeout(typingTimer.current);
      if (data.isTyping) {
        typingTimer.current = setTimeout(() => setOtherTyping(false), 3000);
      }
    };

    socket.on('chat:message', onMessage);
    socket.on('chat:edit', onEdit);
    socket.on('chat:delete', onDelete);
    socket.on('chat:typing', onTyping);

    return () => {
      socket.off('chat:message', onMessage);
      socket.off('chat:edit', onEdit);
      socket.off('chat:delete', onDelete);
      socket.off('chat:typing', onTyping);
    };
  }, [socket, conversationId, otherUser.id]);

  // Scroll to bottom when typing indicator appears
  useEffect(() => {
    if (otherTyping) {
      const el = scrollRef.current;
      if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 160) {
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
      }
    }
  }, [otherTyping]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || messages.length === 0) return;
    const firstId = messages[0].id;
    const prevHeight = scrollRef.current?.scrollHeight || 0;
    setLoadingMore(true);
    try {
      const res = await chatApi.getMessages(conversationId, firstId);
      const older: Message[] = res.data;
      setHasMore(older.length === LIMIT);
      setMessages(prev => [...older, ...prev]);
      // Restore scroll position
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight - prevHeight;
        }
      });
    } catch {}
    finally { setLoadingMore(false); }
  }, [conversationId, messages, loadingMore, hasMore]);

  const handleScroll = useCallback(() => {
    if (scrollRef.current && scrollRef.current.scrollTop < 80) {
      loadMore();
    }
  }, [loadMore]);

  const handleSend = async (data: { content?: string; type: string; attachmentUrl?: string; attachmentName?: string; attachmentSize?: number }) => {
    try {
      const res = await chatApi.sendMessage(conversationId, data);
      const sent: Message = res.data;
      setMessages(prev => prev.find(m => m.id === sent.id) ? prev : [...prev, sent]);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
      const preview = data.type === 'text' ? (data.content || '') : data.type === 'image' ? t('chat.photo_preview') : t('chat.file_preview', { name: data.attachmentName || t('chat.file') });
      onMessageSent(preview, data.type);
      setClosedMsg(null);
    } catch (e: any) {
      if (e?.response?.status === 423) {
        setClosedMsg(e.response.data?.error || t('chat.chat_closed'));
      }
    }
  };

  const handleEdit = async (msg: Message) => {
    try {
      await chatApi.editMessage(msg.id, msg.content || '');
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, content: msg.content, editedAt: new Date().toISOString() } : m));
    } catch {}
  };

  const handleDelete = async (msgId: string) => {
    if (!confirm(t('chat.delete_message_confirm'))) return;
    try {
      await chatApi.deleteMessage(msgId);
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, isDeleted: true, content: undefined } : m));
    } catch {}
  };

  const handleTyping = (isTyping: boolean) => {
    if (!socket || !user) return;
    socket.emit('chat:typing', { conversationId, recipientId: otherUser.id, isTyping });
  };

  // ── Meeting-invite cards ──────────────────────────────────────────────────
  const patchAppointment = (apptId: string, patch: Partial<NonNullable<Message['appointment']>>) =>
    setMessages(prev => prev.map(m =>
      m.appointment?.id === apptId ? { ...m, appointment: { ...m.appointment, ...patch } as any } : m));

  const submitComplete = async () => {
    if (!completing?.appointment) return;
    const apptId = completing.appointment.id;
    setInviteBusy(true);
    try {
      await parentApi.completeInvite(apptId, {
        reason: completeReason.trim() || undefined,
        requestedDate: completeDate || undefined,
      });
      patchAppointment(apptId, { status: 'pending', reason: completeReason.trim() || undefined, requestedDate: completeDate || undefined });
      setCompleting(null);
      setCompleteReason('');
      setCompleteDate('');
    } catch {}
    finally { setInviteBusy(false); }
  };

  const handleDecline = async (msg: Message) => {
    if (!msg.appointment) return;
    if (!confirm(t('chat.invite.decline_confirm'))) return;
    const apptId = msg.appointment.id;
    setInviteBusy(true);
    try {
      await parentApi.declineInvite(apptId);
      patchAppointment(apptId, { status: 'rejected' });
    } catch {}
    finally { setInviteBusy(false); }
  };

  const handleSendInvite = async () => {
    setInviteBusy(true);
    try {
      const res = await chatApi.sendInvite(conversationId, sendReason.trim() || undefined);
      const sent: Message = res.data;
      setMessages(prev => prev.find(m => m.id === sent.id) ? prev : [...prev, sent]);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
      onMessageSent(t('chat.invite.preview'), 'invite');
      setSendInviteOpen(false);
      setSendReason('');
      setClosedMsg(null);
    } catch (e: any) {
      if (e?.response?.status === 423) setClosedMsg(e.response.data?.error || t('chat.chat_closed'));
    }
    finally { setInviteBusy(false); }
  };

  // Refetch the latest page on tab focus so invite-card statuses stay fresh
  // (the other side completing/declining doesn't push a socket event).
  useEffect(() => {
    const onFocus = () => {
      chatApi.getMessages(conversationId).then(res => {
        const fresh: Message[] = res.data;
        const apptStatus: Record<string, NonNullable<Message['appointment']>> = {};
        fresh.forEach(m => { if (m.appointment) apptStatus[m.appointment.id] = m.appointment; });
        setMessages(prev => prev.map(m =>
          m.appointment && apptStatus[m.appointment.id]
            ? { ...m, appointment: apptStatus[m.appointment.id] }
            : m));
      }).catch(() => {});
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [conversationId]);

  const initials = `${otherUser.firstName?.[0] || ''}${otherUser.lastName?.[0] || ''}`.toUpperCase();

  // Group messages for visual grouping (same sender within 5 min)
  const grouped = messages.map((msg, i) => {
    const prev = messages[i - 1];
    const sameGroup = prev &&
      prev.senderId === msg.senderId &&
      new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000;
    const showDate = !prev || !isSameDay(new Date(msg.createdAt), new Date(prev.createdAt));
    return { msg, showAvatar: !sameGroup, showDate };
  });

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Messages area */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-2"
      >
        {loadingMore && (
          <div className="flex justify-center py-2">
            <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
          </div>
        )}

        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400 py-16">
            <MessageSquare className="w-10 h-10 opacity-30" />
            <p className="text-sm">{t('chat.no_messages_yet')}</p>
          </div>
        )}

        {grouped.map(({ msg, showAvatar, showDate }) => (
          <div key={msg.id}>
            {showDate && <DateSeparator date={new Date(msg.createdAt)} />}
            {msg.type === 'invite' ? (
              <InviteCard
                msg={msg}
                isParent={isParent}
                primaryColor={primaryColor}
                busy={inviteBusy}
                onChooseTime={(m) => { setCompleteReason(''); setCompleteDate(''); setCompleting(m); }}
                onDecline={handleDecline}
              />
            ) : (
              <MessageBubble
                msg={msg}
                isMine={msg.senderId === user?.id}
                showAvatar={showAvatar}
                avatarInitials={initials}
                primaryColor={primaryColor}
                onEdit={handleEdit}
                onDelete={handleDelete}
              />
            )}
          </div>
        ))}

        {/* Typing indicator */}
        {otherTyping && (
          <div className="flex items-end gap-2 mb-2 mt-1">
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ backgroundColor: primaryColor }}>
              {initials}
            </div>
            <div className="bg-white border border-gray-100 rounded-2xl rounded-bl-md px-4 py-3 shadow-sm">
              <div className="flex gap-1 items-center">
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {closedMsg && (
        <div className="px-4 py-2.5 bg-amber-50 border-t border-amber-200 text-center text-sm text-amber-800 font-medium">
          🔒 {closedMsg}
        </div>
      )}

      <MessageInput
        conversationId={conversationId}
        onSend={handleSend}
        onTyping={handleTyping}
        disabled={!!closedMsg}
        onInvite={canInvite ? () => { setSendReason(''); setSendInviteOpen(true); } : undefined}
      />

      {/* Parent: fill the invite inline (reason + preferred date) */}
      {completing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !inviteBusy && setCompleting(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold text-gray-900">{t('chat.invite.fill_title')}</h3>
              <button onClick={() => !inviteBusy && setCompleting(null)} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-4 h-4" /></button>
            </div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('chat.invite.your_reason')}</label>
            <textarea
              value={completeReason}
              onChange={e => setCompleteReason(e.target.value)}
              rows={2}
              maxLength={300}
              placeholder={t('chat.invite.your_reason_ph')}
              className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 mb-3"
            />
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('chat.invite.preferred_date')}</label>
            <input
              type="date"
              value={completeDate}
              onChange={e => setCompleteDate(e.target.value)}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 mb-4"
            />
            <div className="flex gap-2">
              <button onClick={() => setCompleting(null)} disabled={inviteBusy} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50">{t('chat.invite.cancel')}</button>
              <button onClick={submitComplete} disabled={inviteBusy} className="flex-1 py-2.5 rounded-xl text-white text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-1.5" style={{ backgroundColor: primaryColor }}>
                {inviteBusy && <Loader2 className="w-4 h-4 animate-spin" />}{t('chat.invite.submit')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Supervisor: compose an invite */}
      {sendInviteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !inviteBusy && setSendInviteOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold text-gray-900">{t('chat.invite.send_title')}</h3>
              <button onClick={() => !inviteBusy && setSendInviteOpen(false)} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-sm text-gray-500 mb-3">{t('chat.invite.send_desc', { name: otherUser.fullName })}</p>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('chat.invite.reason_label')}</label>
            <textarea
              value={sendReason}
              onChange={e => setSendReason(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder={t('chat.invite.send_reason_ph')}
              className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 mb-4"
            />
            <div className="flex gap-2">
              <button onClick={() => setSendInviteOpen(false)} disabled={inviteBusy} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50">{t('chat.invite.cancel')}</button>
              <button onClick={handleSendInvite} disabled={inviteBusy} className="flex-1 py-2.5 rounded-xl text-white text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-1.5" style={{ backgroundColor: primaryColor }}>
                {inviteBusy && <Loader2 className="w-4 h-4 animate-spin" />}{t('chat.invite.send')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
