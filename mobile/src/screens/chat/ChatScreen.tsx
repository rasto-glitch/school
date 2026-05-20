import { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert, Image,
  Pressable, Linking, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Send, Paperclip, Check, X, FileText } from 'lucide-react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useHeaderHeight } from '@react-navigation/elements';
import { format, isToday, isYesterday, isSameDay } from 'date-fns';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { useColors } from '../../store/themeStore';
import { useAuthStore } from '../../store/authStore';
import { useSocketStore } from '../../store/socketStore';
import { chatApi } from '../../services/api';
import { font } from '../../theme';
import type { Conversation, ChatMessage } from '../../types';

const LIMIT = 30;

function formatTime(iso: string) {
  const d = new Date(iso);
  if (isToday(d)) return format(d, 'HH:mm');
  if (isYesterday(d)) return `Yesterday ${format(d, 'HH:mm')}`;
  return format(d, 'MMM d, HH:mm');
}

function humanSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Defense-in-depth (H-1): backend now restricts attachmentUrl to Supabase
// storage URLs, but we double-check on the client. Linking.openURL on a
// `javascript:` URL is a no-op on mobile, but `https://attacker.example/`
// would open the device browser — a phishing surface. Refuse anything
// outside Supabase storage hosts.
function isSafeAttachmentUrl(u: string | undefined): u is string {
  if (!u) return false;
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    return /\.supabase\.co$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

function DateSeparator({ date, colors }: { date: Date; colors: any }) {
  const label = isToday(date) ? 'Today' : isYesterday(date) ? 'Yesterday' : format(date, 'MMMM d, yyyy');
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 12, paddingHorizontal: 16 }}>
      <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
      <Text style={{ fontSize: 11, color: colors.textMuted, marginHorizontal: 10, fontWeight: '500' }}>{label}</Text>
      <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
    </View>
  );
}

interface BubbleProps {
  msg: ChatMessage;
  isMine: boolean;
  showAvatar: boolean;
  initials: string;
  primaryColor: string;
  colors: any;
  onLongPress: (msg: ChatMessage) => void;
}

function Bubble({ msg, isMine, showAvatar, initials, primaryColor, colors, onLongPress }: BubbleProps) {
  if (msg.isDeleted) {
    return (
      <View style={{ paddingHorizontal: 20, marginVertical: 2 }}>
        <Text style={{ fontSize: 12, color: colors.textMuted, fontStyle: 'italic', textAlign: isMine ? 'right' : 'left' }}>Message deleted</Text>
      </View>
    );
  }

  return (
    <View style={{ flexDirection: isMine ? 'row-reverse' : 'row', alignItems: 'flex-end', marginVertical: 2, paddingHorizontal: 12, gap: 8 }}>
      {/* Avatar */}
      <View style={{ width: 28, alignItems: 'center' }}>
        {showAvatar && !isMine && (
          <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: primaryColor, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{initials}</Text>
          </View>
        )}
      </View>

      <Pressable
        style={{ maxWidth: '72%' }}
        onLongPress={() => onLongPress(msg)}
        delayLongPress={400}
      >
        <View style={[
          { borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 },
          isMine
            ? { backgroundColor: primaryColor, borderBottomRightRadius: 4 }
            : { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderBottomLeftRadius: 4 },
        ]}>
          {msg.type === 'text' && (
            <Text style={{ color: isMine ? '#fff' : colors.text, fontSize: font.sm, lineHeight: 20 }}>
              {msg.content}
            </Text>
          )}

          {msg.type === 'image' && isSafeAttachmentUrl(msg.attachmentUrl) && (
            <TouchableOpacity onPress={() => Linking.openURL(msg.attachmentUrl!)}>
              <Image
                source={{ uri: msg.attachmentUrl }}
                style={{ width: 200, height: 200, borderRadius: 8 }}
                resizeMode="cover"
              />
            </TouchableOpacity>
          )}

          {msg.type === 'file' && isSafeAttachmentUrl(msg.attachmentUrl) && (
            <TouchableOpacity
              onPress={() => Linking.openURL(msg.attachmentUrl!)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
            >
              <View style={{ padding: 8, borderRadius: 8, backgroundColor: isMine ? 'rgba(255,255,255,0.2)' : colors.bg }}>
                <FileText size={20} color={isMine ? '#fff' : colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: '600', color: isMine ? '#fff' : colors.text }} numberOfLines={2}>
                  {msg.attachmentName || 'File'}
                </Text>
                {msg.attachmentSize != null && (
                  <Text style={{ fontSize: 11, color: isMine ? 'rgba(255,255,255,0.7)' : colors.textMuted }}>{humanSize(msg.attachmentSize)}</Text>
                )}
              </View>
            </TouchableOpacity>
          )}
        </View>

        <View style={{ flexDirection: isMine ? 'row-reverse' : 'row', alignItems: 'center', gap: 4, marginTop: 3, paddingHorizontal: 2 }}>
          <Text style={{ fontSize: 10, color: colors.textMuted }}>{formatTime(msg.createdAt)}</Text>
          {msg.editedAt && <Text style={{ fontSize: 10, color: colors.textMuted, fontStyle: 'italic' }}>edited</Text>}
        </View>
      </Pressable>
    </View>
  );
}

function TypingDots({ color }: { color: string }) {
  const dots = useRef([new Animated.Value(0), new Animated.Value(0), new Animated.Value(0)]).current;
  useEffect(() => {
    const anims = dots.map((d, i) =>
      Animated.loop(Animated.sequence([
        Animated.delay(i * 150),
        Animated.timing(d, { toValue: -5, duration: 300, useNativeDriver: true }),
        Animated.timing(d, { toValue: 0, duration: 300, useNativeDriver: true }),
        Animated.delay(300),
      ]))
    );
    anims.forEach(a => a.start());
    return () => anims.forEach(a => a.stop());
  }, []);
  return (
    <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center', paddingVertical: 4 }}>
      {dots.map((d, i) => (
        <Animated.View key={i} style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: color, transform: [{ translateY: d }] }} />
      ))}
    </View>
  );
}

export default function ChatScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const conversation: Conversation = route.params?.conversation;
  const colors = useColors();
  const { user } = useAuthStore();
  const { socket } = useSocketStore();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [otherTyping, setOtherTyping] = useState(false);
  const [editingMsg, setEditingMsg] = useState<ChatMessage | null>(null);
  const [editText, setEditText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [closedMsg, setClosedMsg] = useState<string | null>(null);
  const flatRef = useRef<FlatList>(null);
  const ownTypingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const otherTypingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headerHeight = useHeaderHeight();
  const primaryColor = colors.primary;
  const otherUser = conversation?.otherUser;
  const initials = `${otherUser?.firstName?.[0] || ''}${otherUser?.lastName?.[0] || ''}`.toUpperCase();

  // Set header title with role/subject subtitle
  const roleSubtitle = otherUser?.role === 'teacher'
    ? (otherUser.subject || 'Teacher')
    : otherUser?.role === 'supervisor' ? 'Supervisor' : null;

  useEffect(() => {
    navigation.setOptions({
      headerTitle: () => (
        <View style={{ alignItems: 'center' }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>{otherUser?.fullName || 'Chat'}</Text>
          {roleSubtitle && <Text style={{ fontSize: 12, color: colors.primary, fontWeight: '500' }}>{roleSubtitle}</Text>}
        </View>
      ),
    });
  }, [otherUser, colors]);

  // Load messages
  useEffect(() => {
    chatApi.getMessages(conversation.id)
      .then(res => {
        setMessages(res.data);
        setHasMore(res.data.length === LIMIT);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    chatApi.markRead(conversation.id).catch(() => {});
  }, [conversation.id]);

  // Chat schedule: server is the single source of truth. Probe + poll.
  useEffect(() => {
    let alive = true;
    const check = () => chatApi.getChatWindow()
      .then(r => { if (alive) setClosedMsg(r.data?.open ? null : (r.data?.message || 'Chat is currently closed by the school.')); })
      .catch(() => {});
    check();
    const t = setInterval(check, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [conversation.id]);

  // Attach/detach socket listeners for this conversation
  useEffect(() => {
    if (!socket) return;

    const onMessage = (data: ChatMessage & { conversationId: string }) => {
      if (data.conversationId !== conversation.id) return;
      setMessages(prev => prev.find(m => m.id === data.id) ? prev : [...prev, data]);
      chatApi.markRead(conversation.id).catch(() => {});
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
    };
    const onEdit = (data: ChatMessage & { conversationId: string }) => {
      if (data.conversationId !== conversation.id) return;
      setMessages(prev => prev.map(m => m.id === data.id ? { ...m, content: data.content, editedAt: data.editedAt } : m));
    };
    const onDelete = (data: { id: string; conversationId: string }) => {
      if (data.conversationId !== conversation.id) return;
      setMessages(prev => prev.map(m => m.id === data.id ? { ...m, isDeleted: true, content: undefined } : m));
    };
    const onTyping = (data: { conversationId: string; senderId: string; isTyping: boolean }) => {
      if (data.conversationId !== conversation.id || data.senderId !== otherUser?.id) return;
      setOtherTyping(data.isTyping);
      if (otherTypingTimer.current) clearTimeout(otherTypingTimer.current);
      if (data.isTyping) otherTypingTimer.current = setTimeout(() => setOtherTyping(false), 3000);
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
  }, [socket, conversation.id]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || messages.length === 0) return;
    setLoadingMore(true);
    try {
      const res = await chatApi.getMessages(conversation.id, messages[0].id);
      const older: ChatMessage[] = res.data;
      setHasMore(older.length === LIMIT);
      setMessages(prev => [...older, ...prev]);
    } catch {}
    finally { setLoadingMore(false); }
  }, [conversation.id, messages, loadingMore, hasMore]);

  const emitTyping = (val: string) => {
    setText(val);
    socket?.emit('chat:typing', { conversationId: conversation.id, recipientId: otherUser?.id, isTyping: true });
    if (ownTypingTimer.current) clearTimeout(ownTypingTimer.current);
    ownTypingTimer.current = setTimeout(() => {
      socket?.emit('chat:typing', { conversationId: conversation.id, recipientId: otherUser?.id, isTyping: false });
    }, 1500);
  };

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setText('');
    socket?.emit('chat:typing', { conversationId: conversation.id, recipientId: otherUser?.id, isTyping: false });
    const tempId = `__temp__${Date.now()}`;
    const optimistic: ChatMessage = { id: tempId, senderId: user!.id, content: trimmed, type: 'text', isDeleted: false, createdAt: new Date().toISOString() };
    setMessages(prev => [...prev, optimistic]);
    setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 50);
    try {
      const res = await chatApi.sendMessage(conversation.id, { content: trimmed, type: 'text' });
      setMessages(prev => {
        const without = prev.filter(m => m.id !== tempId);
        return without.find(m => m.id === res.data.id) ? without : [...without, res.data];
      });
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
      setClosedMsg(null);
    } catch (e: any) {
      setMessages(prev => prev.filter(m => m.id !== tempId));
      if (e?.response?.status === 423) {
        setText(trimmed); // restore the unsent text
        setClosedMsg(e.response.data?.error || 'Chat is currently closed by the school.');
      }
    } finally { setSending(false); }
  };

  const handleLongPress = (msg: ChatMessage) => {
    if (msg.isDeleted) return;
    const options: string[] = [];
    const actions: (() => void)[] = [];

    if (msg.senderId === user?.id && msg.type === 'text') {
      options.push('Edit');
      actions.push(() => { setEditingMsg(msg); setEditText(msg.content || ''); });
    }
    if (msg.senderId === user?.id) {
      options.push('Delete');
      actions.push(() => {
        Alert.alert('Delete message?', 'This cannot be undone.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: async () => {
            await chatApi.deleteMessage(msg.id).catch(() => {});
            setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, isDeleted: true, content: undefined } : m));
          }},
        ]);
      });
    }
    options.push('Cancel');
    actions.push(() => {});

    Alert.alert('Message', undefined, options.map((o, i) => ({
      text: o,
      style: o === 'Cancel' ? 'cancel' : o === 'Delete' ? 'destructive' : 'default',
      onPress: actions[i],
    })));
  };

  const handlePickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission required', 'Please allow photo access.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const name = asset.fileName || `image_${Date.now()}.jpg`;
    setUploading(true);
    try {
      const uploaded = await chatApi.uploadAttachment({ uri: asset.uri, name, mimeType: asset.mimeType || 'image/jpeg' });
      const res = await chatApi.sendMessage(conversation.id, {
        type: 'image', attachmentUrl: uploaded.url, attachmentName: uploaded.name, attachmentSize: uploaded.size,
      });
      setMessages(prev => prev.find(m => m.id === res.data.id) ? prev : [...prev, res.data]);
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
    } catch { Alert.alert('Upload failed', 'Could not send image.'); }
    finally { setUploading(false); }
  };

  const handlePickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setUploading(true);
    try {
      const uploaded = await chatApi.uploadAttachment({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType || 'application/octet-stream' });
      const res = await chatApi.sendMessage(conversation.id, {
        type: 'file', attachmentUrl: uploaded.url, attachmentName: uploaded.name, attachmentSize: uploaded.size,
      });
      setMessages(prev => prev.find(m => m.id === res.data.id) ? prev : [...prev, res.data]);
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
    } catch { Alert.alert('Upload failed', 'Could not send file.'); }
    finally { setUploading(false); }
  };

  const handleAttach = () => {
    Alert.alert('Attach', undefined, [
      { text: 'Image', onPress: handlePickImage },
      { text: 'File', onPress: handlePickFile },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const saveEdit = async () => {
    if (!editingMsg || !editText.trim()) { setEditingMsg(null); return; }
    try {
      await chatApi.editMessage(editingMsg.id, editText.trim());
      setMessages(prev => prev.map(m => m.id === editingMsg.id ? { ...m, content: editText.trim(), editedAt: new Date().toISOString() } : m));
    } catch {}
    setEditingMsg(null);
  };

  // Build grouped messages with date separators
  type Item = { type: 'separator'; date: Date; key: string } | { type: 'msg'; msg: ChatMessage; showAvatar: boolean; key: string };
  const items: Item[] = [];
  messages.forEach((msg, i) => {
    const prev = messages[i - 1];
    if (!prev || !isSameDay(new Date(msg.createdAt), new Date(prev.createdAt))) {
      items.push({ type: 'separator', date: new Date(msg.createdAt), key: `sep-${msg.createdAt}` });
    }
    const sameGroup = prev && prev.senderId === msg.senderId && new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000;
    items.push({ type: 'msg', msg, showAvatar: !sameGroup, key: msg.id });
  });

  if (otherTyping) {
    items.push({ type: 'msg', msg: { id: '__typing__', senderId: otherUser?.id || '', content: '', type: 'text', isDeleted: false, createdAt: new Date().toISOString() }, showAvatar: true, key: '__typing__' });
  }

  const s = makeStyles(colors);

  return (
    <SafeAreaView style={[s.container, { backgroundColor: colors.bg }]} edges={['bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={headerHeight}>
        {loading ? (
          <ActivityIndicator style={{ flex: 1 }} color={primaryColor} />
        ) : (
          <FlatList
            ref={flatRef}
            data={items}
            keyExtractor={item => item.key}
            contentContainerStyle={{ paddingVertical: 8 }}
            onEndReached={loadMore}
            onEndReachedThreshold={0.2}
            ListHeaderComponent={loadingMore ? <ActivityIndicator size="small" color={primaryColor} style={{ padding: 8 }} /> : null}
            onContentSizeChange={() => flatRef.current?.scrollToEnd({ animated: false })}
            renderItem={({ item }) => {
              if (item.type === 'separator') {
                return <DateSeparator date={item.date} colors={colors} />;
              }
              if (item.msg.id === '__typing__') {
                return (
                  <View style={{ flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, gap: 8, marginVertical: 2 }}>
                    <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: primaryColor, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{initials}</Text>
                    </View>
                    <View style={[s.bubble, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderBottomLeftRadius: 4 }]}>
                      <TypingDots color={colors.textMuted} />
                    </View>
                  </View>
                );
              }
              return (
                <Bubble
                  msg={item.msg}
                  isMine={item.msg.senderId === user?.id}
                  showAvatar={item.showAvatar}
                  initials={initials}
                  primaryColor={primaryColor}
                  colors={colors}
                  onLongPress={handleLongPress}
                />
              );
            }}
          />
        )}

        {/* Edit bar */}
        {editingMsg && (
          <View style={[s.editBar, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
            <TextInput
              style={[s.editInput, { color: colors.text, borderColor: colors.border }]}
              value={editText}
              onChangeText={setEditText}
              multiline
              autoFocus
            />
            <TouchableOpacity onPress={() => setEditingMsg(null)} style={s.editAction}>
              <X size={18} color={colors.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity onPress={saveEdit} style={[s.editAction, { backgroundColor: colors.primaryLight }]}>
              <Check size={18} color={colors.primary} />
            </TouchableOpacity>
          </View>
        )}

        {/* Chat-closed banner */}
        {!editingMsg && closedMsg && (
          <View style={{ paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#FEF3C7', borderTopWidth: 1, borderTopColor: '#FCD34D' }}>
            <Text style={{ fontSize: 13, color: '#92400E', fontWeight: '600', textAlign: 'center' }}>
              🔒 {closedMsg}
            </Text>
          </View>
        )}

        {/* Input bar */}
        {!editingMsg && (
          <View style={[s.inputBar, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
            <TouchableOpacity
              onPress={handleAttach}
              disabled={uploading || !!closedMsg}
              style={[s.attachBtn, { backgroundColor: colors.bg, borderColor: colors.border, opacity: closedMsg ? 0.4 : 1 }]}
            >
              {uploading
                ? <ActivityIndicator size="small" color={primaryColor} />
                : <Paperclip size={18} color={colors.textMuted} />}
            </TouchableOpacity>
            <TextInput
              style={[s.input, { color: colors.text, backgroundColor: colors.bg, borderColor: colors.border, opacity: closedMsg ? 0.5 : 1 }]}
              placeholder={closedMsg ? 'Chat is closed' : 'Type a message…'}
              placeholderTextColor={colors.textMuted}
              value={text}
              onChangeText={emitTyping}
              editable={!closedMsg}
              multiline
              maxLength={2000}
            />
            <TouchableOpacity
              onPress={handleSend}
              disabled={!text.trim() || sending || !!closedMsg}
              style={[s.sendBtn, { backgroundColor: (!text.trim() || sending || closedMsg) ? colors.borderLight : primaryColor }]}
            >
              {sending ? <ActivityIndicator size="small" color="#fff" /> : <Send size={18} color="#fff" />}
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (_colors: any) => StyleSheet.create({
  container: { flex: 1 },
  bubble: { borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 },
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1 },
  input: { flex: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, fontSize: font.sm, borderWidth: 1, maxHeight: 100, lineHeight: 20 },
  attachBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  sendBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  editBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1 },
  editInput: { flex: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, fontSize: font.sm, borderWidth: 1, maxHeight: 80 },
  editAction: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
