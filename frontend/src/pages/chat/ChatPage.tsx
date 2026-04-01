import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeft, MoreVertical, MessageSquare } from 'lucide-react';
import PageLayout from '../../components/layout/PageLayout';
import ConversationList, { type Conversation } from './ConversationList';
import ChatWindow from './ChatWindow';
import { useNotificationStore } from '../../store/notificationStore';
import { useAuthStore } from '../../store/authStore';
import { chatApi } from '../../services/api';

function Avatar({ user, primaryColor }: { user: { firstName: string; lastName: string; profilePicture?: string }; primaryColor: string }) {
  const initials = `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}`.toUpperCase();
  if (user.profilePicture) {
    return <img src={user.profilePicture} alt="" className="w-9 h-9 rounded-full object-cover" />;
  }
  return (
    <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold" style={{ backgroundColor: primaryColor }}>
      {initials}
    </div>
  );
}

function roleLabel(role: string, subject?: string) {
  if (role === 'teacher') return subject ? `Teacher · ${subject}` : 'Teacher';
  if (role === 'supervisor') return 'Supervisor';
  return 'Parent';
}

export default function ChatPage() {
  const { school } = useAuthStore();
  const { setChatUnreadCount } = useNotificationStore();
  const primaryColor = school?.primaryColor || '#4F46E5';
  const [searchParams] = useSearchParams();
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list');

  // Support opening a conversation directly via ?with=userId
  useEffect(() => {
    const withId = searchParams.get('with');
    if (withId) {
      chatApi.getOrCreateConversation(withId)
        .then(res => {
          setSelected(res.data);
          setMobileView('chat');
        })
        .catch(() => {});
    }
  }, []);

  const handleSelectConversation = (conv: Conversation) => {
    setSelected(conv);
    setMobileView('chat');
  };

  const handleMessageSent = (preview: string, type: string) => {
    if (!selected) return;
    setSelected(prev => prev ? {
      ...prev,
      lastMessagePreview: preview,
      lastMessageType: type,
      lastMessageAt: new Date().toISOString(),
    } : prev);
  };

  return (
    <PageLayout title="Chat" raw>
      <div className="flex h-full">
        {/* Left panel — conversation list */}
        <div className={`
          w-full sm:w-80 lg:w-80 xl:w-96 flex-shrink-0 flex flex-col
          ${mobileView === 'chat' ? 'hidden sm:flex' : 'flex'}
        `}>
          <ConversationList
            selected={selected?.id ?? null}
            onSelect={handleSelectConversation}
            onNewConversation={() => {}}
            onUnreadChange={setChatUnreadCount}
          />
        </div>

        {/* Right panel — chat window or empty state */}
        <div className={`
          flex-1 flex flex-col min-w-0 bg-gray-50
          ${mobileView === 'list' ? 'hidden sm:flex' : 'flex'}
        `}>
          {selected && selected.otherUser ? (
            <>
              {/* Chat header */}
              <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200 flex-shrink-0">
                {/* Mobile back button */}
                <button
                  className="sm:hidden p-1.5 rounded-xl hover:bg-gray-100 transition-colors"
                  onClick={() => setMobileView('list')}
                >
                  <ArrowLeft className="w-5 h-5 text-gray-600" />
                </button>
                <Avatar user={selected.otherUser} primaryColor={primaryColor} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-gray-900 text-sm truncate">{selected.otherUser.fullName}</p>
                  <p className="text-xs text-gray-500">{roleLabel(selected.otherUser.role, selected.otherUser.subject)}</p>
                </div>
              </div>

              <ChatWindow
                key={selected.id}
                conversationId={selected.id}
                otherUser={selected.otherUser}
                onMessageSent={handleMessageSent}
              />
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-gray-400">
              <MessageSquare className="w-14 h-14 opacity-20" />
              <div className="text-center">
                <p className="font-medium text-gray-500">Select a conversation</p>
                <p className="text-sm mt-1">or start a new one with the + button</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </PageLayout>
  );
}
