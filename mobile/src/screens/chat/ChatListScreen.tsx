import { useState, useCallback, useEffect } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  TextInput, ActivityIndicator, RefreshControl, Image,
} from 'react-native';
import { ChatListSkeleton as ChatSkeleton } from '../../components/Skeleton';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MessageSquare, Plus, Search, X } from 'lucide-react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { formatDistanceToNow } from 'date-fns';
import { useColors, useIsDark } from '../../store/themeStore';
import { useAuthStore } from '../../store/authStore';
import { useSocketStore } from '../../store/socketStore';
import { chatApi } from '../../services/api';
import { font } from '../../theme';
import type { Conversation, ChatUser } from '../../types';

type Nav = any;

function Avatar({ user, size, primaryColor }: { user: ChatUser; size: number; primaryColor: string }) {
  const initials = `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}`.toUpperCase();
  if (user.profilePicture) {
    return <Image source={{ uri: user.profilePicture }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  }
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: primaryColor, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#fff', fontWeight: '700', fontSize: size * 0.35 }}>{initials}</Text>
    </View>
  );
}

function roleLabel(t: (k: string) => string, role: string, subject?: string) {
  if (role === 'teacher') return subject ? `${t('nav.teacher')} · ${subject}` : t('nav.teacher');
  if (role === 'supervisor') return t('nav.supervisor');
  return t('nav.parent');
}

export default function ChatListScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const colors = useColors();
  const isDark = useIsDark();
  const { user } = useAuthStore();
  const { socket } = useSocketStore();
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [contacts, setContacts] = useState<ChatUser[]>([]);
  const [contactSearch, setContactSearch] = useState('');
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [startingId, setStartingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await chatApi.getConversations();
      setConvs(res.data);
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Real-time conversation list updates
  useEffect(() => {
    if (!socket || !user) return;
    const onMessage = (data: any) => {
      const preview = data.type === 'text' ? (data.content || '') : data.type === 'image' ? `📷 ${t('chat.photo')}` : `📎 ${data.attachmentName || t('chat.file')}`;
      setConvs(prev => {
        const existing = prev.find(c => c.id === data.conversationId);
        if (!existing) return prev;
        const isMine = data.senderId === user.id;
        return prev
          .map(c => c.id === data.conversationId
            ? { ...c, lastMessageAt: data.createdAt, lastMessagePreview: preview, lastMessageSenderId: data.senderId, hasUnread: !isMine }
            : c)
          .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
      });
    };
    socket.on('chat:message', onMessage);
    return () => { socket.off('chat:message', onMessage); };
  }, [socket, user]);

  const onRefresh = () => { setRefreshing(true); load(); };

  const openNew = async () => {
    setShowNew(true);
    setContactSearch('');
    setLoadingContacts(true);
    try {
      const res = await chatApi.getContacts();
      setContacts(res.data);
    } catch {}
    finally { setLoadingContacts(false); }
  };

  const startConv = async (contactId: string) => {
    setStartingId(contactId);
    try {
      const res = await chatApi.getOrCreateConversation(contactId);
      const conv: Conversation = res.data;
      setConvs(prev => prev.find(c => c.id === conv.id) ? prev : [conv, ...prev]);
      setShowNew(false);
      navigation.navigate('Chat', { conversation: conv });
    } catch {}
    finally { setStartingId(null); }
  };

  const filtered = convs.filter(c => !search || c.otherUser?.fullName?.toLowerCase().includes(search.toLowerCase()));
  const filteredContacts = contacts.filter(c => !contactSearch || c.fullName.toLowerCase().includes(contactSearch.toLowerCase()));

  const s = makeStyles(colors);

  return (
    <SafeAreaView style={[s.container, { backgroundColor: colors.bg }]} edges={['bottom']}>
      {/* Search bar */}
      <View style={s.searchRow}>
        <View style={s.searchBox}>
          <Search size={14} color={colors.textMuted} />
          <TextInput
            style={[s.searchInput, { color: colors.text }]}
            placeholder={t('chat.search_ph')}
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={setSearch}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <X size={14} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity
          onPress={openNew}
          style={[
            s.newBtn,
            { backgroundColor: isDark ? 'rgba(255,255,255,0.12)' : colors.primaryLight },
          ]}
        >
          <Plus size={18} color={isDark ? '#FFFFFF' : colors.primary} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <ChatSkeleton />
      ) : filtered.length === 0 ? (
        <View style={s.empty}>
          <MessageSquare size={40} color={colors.textMuted} />
          <Text style={[s.emptyText, { color: colors.textMuted }]}>{t('chat.no_conversations')}</Text>
          <Text style={[s.emptySubText, { color: colors.textMuted }]}>{t('chat.tap_to_start')}</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          renderItem={({ item: conv }) => (
            <TouchableOpacity
              style={[s.row, { backgroundColor: colors.card, borderBottomColor: colors.border }]}
              onPress={() => {
                if (conv.hasUnread) {
                  setConvs(prev => prev.map(c => c.id === conv.id ? { ...c, hasUnread: false } : c));
                }
                navigation.navigate('Chat', { conversation: { ...conv, hasUnread: false } });
              }}
              activeOpacity={0.7}
            >
              {conv.otherUser ? (
                <Avatar user={conv.otherUser} size={46} primaryColor={colors.primary} />
              ) : (
                <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: colors.border }} />
              )}
              <View style={s.rowContent}>
                <View style={s.rowTop}>
                  <Text style={[s.rowName, { color: colors.text, fontWeight: conv.hasUnread ? '700' : '600' }]} numberOfLines={1}>
                    {conv.otherUser?.fullName || t('chat.unknown_user')}
                    {conv.otherUser?.role && conv.otherUser.role !== 'parent' && (
                      <Text style={{ fontSize: 11, fontWeight: '500', color: colors.primary }}>
                        {' '}({conv.otherUser.role === 'teacher' ? (conv.otherUser.subject || t('nav.teacher')) : conv.otherUser.role === 'supervisor' ? t('nav.supervisor') : conv.otherUser.role})
                      </Text>
                    )}
                  </Text>
                  {conv.lastMessageAt && (
                    <Text style={[s.rowTime, { color: colors.textMuted }]}>
                      {formatDistanceToNow(new Date(conv.lastMessageAt), { addSuffix: false })
                        .replace('about ', '').replace(' ago', '')}
                    </Text>
                  )}
                </View>
                <View style={s.rowBottom}>
                  <Text style={[s.rowPreview, { color: conv.hasUnread ? colors.text : colors.textSecondary, fontWeight: conv.hasUnread ? '600' : '400' }]} numberOfLines={1}>
                    {conv.lastMessagePreview
                      ? (conv.lastMessageSenderId === user?.id ? `${t('chat.you')}: ${conv.lastMessagePreview}` : conv.lastMessagePreview)
                      : t('chat.no_messages')}
                  </Text>
                  {conv.hasUnread && (
                    <View style={[s.unreadDot, { backgroundColor: colors.primary }]} />
                  )}
                </View>
              </View>
            </TouchableOpacity>
          )}
        />
      )}

      {/* New conversation modal */}
      {showNew && (
        <View style={s.modalOverlay}>
          <View style={[s.modal, { backgroundColor: colors.card }]}>
            <View style={[s.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[s.modalTitle, { color: colors.text }]}>{t('chat.new_conversation')}</Text>
              <TouchableOpacity onPress={() => setShowNew(false)} style={s.closeBtn}>
                <X size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <View style={[s.modalSearch, { borderBottomColor: colors.border }]}>
              <Search size={14} color={colors.textMuted} />
              <TextInput
                style={[s.searchInput, { color: colors.text, flex: 1 }]}
                placeholder={t('chat.search_contacts')}
                placeholderTextColor={colors.textMuted}
                value={contactSearch}
                onChangeText={setContactSearch}
                autoFocus
              />
            </View>
            {loadingContacts ? (
              <ActivityIndicator style={{ padding: 24 }} color={colors.primary} />
            ) : (
              <FlatList
                data={filteredContacts}
                keyExtractor={c => c.id}
                style={{ maxHeight: 360 }}
                ListEmptyComponent={<Text style={[s.emptyText, { color: colors.textMuted, padding: 24 }]}>{t('chat.no_contacts')}</Text>}
                renderItem={({ item: contact }) => (
                  <TouchableOpacity
                    style={[s.contactRow, { borderBottomColor: colors.borderLight }]}
                    onPress={() => startConv(contact.id)}
                    disabled={startingId === contact.id}
                    activeOpacity={0.7}
                  >
                    <Avatar user={contact} size={38} primaryColor={colors.primary} />
                    <View style={{ flex: 1 }}>
                      <Text style={[s.contactName, { color: colors.text }]}>{contact.fullName}</Text>
                      <Text style={[s.contactRole, { color: colors.textMuted }]}>{roleLabel(t, contact.role, contact.subject)}</Text>
                    </View>
                    {startingId === contact.id && <ActivityIndicator size="small" color={colors.primary} />}
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const makeStyles = (colors: ReturnType<typeof import('../../store/themeStore').useColors>) => StyleSheet.create({
  container: { flex: 1 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.card, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: colors.border },
  searchInput: { flex: 1, fontSize: font.sm, padding: 0 },
  newBtn: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyText: { fontSize: font.md, fontWeight: '600', textAlign: 'center' },
  emptySubText: { fontSize: font.sm, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  rowContent: { flex: 1, minWidth: 0 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  rowName: { flex: 1, fontSize: font.sm },
  rowTime: { fontSize: 11 },
  rowBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  rowPreview: { flex: 1, fontSize: 12, marginRight: 4 },
  unreadDot: { width: 8, height: 8, borderRadius: 4 },
  modalOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', zIndex: 100, padding: 20 },
  modal: { width: '100%', maxWidth: 400, borderRadius: 20, overflow: 'hidden' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1 },
  modalTitle: { fontSize: font.md, fontWeight: '700' },
  closeBtn: { padding: 4 },
  modalSearch: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1 },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  contactName: { fontSize: font.sm, fontWeight: '600' },
  contactRole: { fontSize: 12, marginTop: 1 },
});
