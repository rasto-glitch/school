import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDistanceToNow } from 'date-fns';
import { Search, Plus, X, Loader2, MessageSquare } from 'lucide-react';
import { chatApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { useSocketStore } from '../../store/socketStore';

export interface Conversation {
  id: string;
  otherUser: {
    id: string;
    firstName: string;
    lastName: string;
    fullName: string;
    role: string;
    subject?: string;
    profilePicture?: string;
  } | null;
  lastMessageAt: string;
  lastMessagePreview: string | null;
  lastMessageSenderId: string | null;
  lastMessageType: string;
  hasUnread: boolean;
  createdAt: string;
}

interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  role: string;
  subject?: string;
  profilePicture?: string;
}

interface Props {
  selected: string | null;
  onSelect: (conv: Conversation) => void;
  onNewConversation: (otherUserId: string) => void;
  onUnreadChange: (count: number) => void;
}

function Avatar({ user, primaryColor, size = 'md' }: { user: { firstName: string; lastName: string; profilePicture?: string }; primaryColor: string; size?: 'sm' | 'md' }) {
  const initials = `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}`.toUpperCase();
  const cls = size === 'sm' ? 'w-8 h-8 text-xs' : 'w-10 h-10 text-sm';
  if (user.profilePicture) {
    return <img src={user.profilePicture} alt="" className={`${cls} rounded-full object-cover flex-shrink-0`} />;
  }
  return (
    <div className={`${cls} rounded-full flex items-center justify-center text-white font-bold flex-shrink-0`} style={{ backgroundColor: primaryColor }}>
      {initials}
    </div>
  );
}

function roleLabel(t: (k: string, o?: any) => string, role: string, subject?: string) {
  if (role === 'teacher') return subject ? t('chat.teacher_with_subject', { subject }) : t('chat.role_teacher');
  if (role === 'supervisor') return t('chat.role_supervisor');
  return t('chat.role_parent');
}

export default function ConversationList({ selected, onSelect, onNewConversation, onUnreadChange }: Props) {
  const { t } = useTranslation();
  const { user, school } = useAuthStore();
  const { socket } = useSocketStore();
  const primaryColor = school?.primaryColor || '#4F46E5';
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showNewModal, setShowNewModal] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactSearch, setContactSearch] = useState('');
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [startingConv, setStartingConv] = useState<string | null>(null);

  useEffect(() => {
    chatApi.getConversations()
      .then(res => setConvs(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Update parent's unread count
  useEffect(() => {
    onUnreadChange(convs.filter(c => c.hasUnread).length);
  }, [convs]);

  // Socket: update conversation list when a new message arrives
  useEffect(() => {
    if (!socket || !user) return;

    const onMessage = (data: any) => {
      setConvs(prev => {
        const existing = prev.find(c => c.id === data.conversationId);
        const isCurrentSelected = data.conversationId === selected;
        const isMine = data.senderId === user.id;
        const preview = data.type === 'text' ? (data.content || '') : data.type === 'image' ? t('chat.photo_preview') : t('chat.file_preview', { name: data.attachmentName || t('chat.file') });

        if (existing) {
          return prev.map(c => c.id === data.conversationId
            ? { ...c, lastMessageAt: data.createdAt, lastMessagePreview: preview, lastMessageSenderId: data.senderId, lastMessageType: data.type, hasUnread: !isCurrentSelected && !isMine }
            : c
          ).sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
        }
        return prev;
      });
    };

    socket.on('chat:message', onMessage);
    return () => { socket.off('chat:message', onMessage); };
  }, [socket, user, selected]);

  const openNewModal = async () => {
    setShowNewModal(true);
    setContactSearch('');
    setLoadingContacts(true);
    try {
      const res = await chatApi.getContacts();
      setContacts(res.data);
    } catch {}
    finally { setLoadingContacts(false); }
  };

  const handleStartConversation = async (contactId: string) => {
    setStartingConv(contactId);
    try {
      const res = await chatApi.getOrCreateConversation(contactId);
      const conv: Conversation = res.data;
      setConvs(prev => {
        const existing = prev.find(c => c.id === conv.id);
        if (existing) return prev;
        return [conv, ...prev];
      });
      onNewConversation(conv.id);
      onSelect({ ...conv, otherUser: conv.otherUser } as Conversation);
      setShowNewModal(false);
    } catch {}
    finally { setStartingConv(null); }
  };

  const markConvRead = (convId: string) => {
    setConvs(prev => prev.map(c => c.id === convId ? { ...c, hasUnread: false } : c));
  };

  const filteredConvs = convs.filter(c =>
    !search || c.otherUser?.fullName?.toLowerCase().includes(search.toLowerCase())
  );

  const filteredContacts = contacts.filter(c =>
    !contactSearch || c.fullName.toLowerCase().includes(contactSearch.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full border-r border-gray-200 bg-white">
      {/* Header */}
      <div className="px-4 py-4 border-b border-gray-100">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-gray-900 text-base">{t('chat.messages')}</h2>
          <button
            onClick={openNewModal}
            className="p-1.5 rounded-xl hover:bg-indigo-50 text-indigo-600 transition-colors"
            title={t('chat.new_conversation')}
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('chat.search')}
            className="w-full pl-8 pr-3 py-2 text-sm bg-gray-50 rounded-xl border border-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
          </div>
        )}

        {!loading && filteredConvs.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-12 text-gray-400 px-4 text-center">
            <MessageSquare className="w-8 h-8 opacity-30" />
            <p className="text-sm">{t('chat.no_conversations')}<br />{t('chat.start_new')}</p>
          </div>
        )}

        {filteredConvs.map(conv => (
          <button
            key={conv.id}
            onClick={() => { onSelect(conv); markConvRead(conv.id); }}
            className={`w-full flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50 transition-colors text-left ${selected === conv.id ? 'bg-indigo-50 border-r-2 border-indigo-600' : ''}`}
          >
            {conv.otherUser ? (
              <Avatar user={conv.otherUser} primaryColor={primaryColor} />
            ) : (
              <div className="w-10 h-10 rounded-full bg-gray-200 flex-shrink-0" />
            )}

            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className={`text-sm truncate ${conv.hasUnread ? 'font-bold text-gray-900' : 'font-medium text-gray-800'}`}>
                  {conv.otherUser?.fullName || t('chat.unknown')}
                </span>
                {conv.lastMessageAt && (
                  <span className="text-[10px] text-gray-400 flex-shrink-0">
                    {formatDistanceToNow(new Date(conv.lastMessageAt), { addSuffix: false }).replace('about ', '').replace(' ago', '')}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between gap-2 mt-0.5">
                <p className={`text-xs truncate ${conv.hasUnread ? 'text-gray-700 font-medium' : 'text-gray-500'}`}>
                  {conv.lastMessagePreview
                    ? (conv.lastMessageSenderId === user?.id ? t('chat.you_prefix', { preview: conv.lastMessagePreview }) : conv.lastMessagePreview)
                    : <span className="italic text-gray-400">{t('chat.no_messages_preview')}</span>}
                </p>
                {conv.hasUnread && (
                  <span className="w-2 h-2 bg-indigo-600 rounded-full flex-shrink-0" />
                )}
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* New conversation modal */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm flex flex-col max-h-[70vh]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="font-bold text-gray-900">{t('chat.new_conversation')}</h3>
              <button onClick={() => setShowNewModal(false)} className="p-1.5 hover:bg-gray-100 rounded-xl transition-colors">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
            <div className="px-4 py-3 border-b border-gray-100">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input
                  value={contactSearch}
                  onChange={e => setContactSearch(e.target.value)}
                  placeholder={t('chat.search_contacts')}
                  autoFocus
                  className="w-full pl-8 pr-3 py-2 text-sm bg-gray-50 rounded-xl border border-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {loadingContacts && (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                </div>
              )}
              {!loadingContacts && filteredContacts.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-8">{t('chat.no_contacts')}</p>
              )}
              {filteredContacts.map(contact => (
                <button
                  key={contact.id}
                  onClick={() => handleStartConversation(contact.id)}
                  disabled={startingConv === contact.id}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left disabled:opacity-60"
                >
                  <Avatar user={contact} primaryColor={primaryColor} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{contact.fullName}</p>
                    <p className="text-xs text-gray-500">{roleLabel(t, contact.role, contact.subject)}</p>
                  </div>
                  {startingConv === contact.id && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
