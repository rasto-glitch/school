import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image,
  TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useHeaderHeight } from '@react-navigation/elements';
import { Heart, MessageCircle, Bookmark, Send, Trash2 } from 'lucide-react-native';
import { academicApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { useColors } from '../../store/themeStore';
import { spacing, radius, font } from '../../theme';
import type { AcademicPost, PostComment } from '../../types';

function authorLabel(post: AcademicPost): string {
  if (post.author_role === 'supervisor') {
    return `${post.author_name ?? ''} — Principal`;
  }
  const name = post.author_name ?? post.teachers?.full_name ?? 'Teacher';
  const subject = post.author_subject ?? post.teachers?.subject;
  return subject ? `${name} — ${subject}` : name;
}

export default function PostDetailScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { user } = useAuthStore();
  const postId: string = route.params?.postId;
  const focusComment: boolean = route.params?.focusComment === true;
  const headerHeight = useHeaderHeight();

  const [post, setPost] = useState<AcademicPost | null>(null);
  const [comments, setComments] = useState<PostComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [commentText, setCommentText] = useState('');
  const [posting, setPosting] = useState(false);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!postId) return;
    Promise.all([academicApi.getPost(postId), academicApi.getComments(postId)])
      .then(([p, c]) => { setPost(p.data); setComments(c.data ?? []); })
      .catch(() => navigation.goBack())
      .finally(() => setLoading(false));
  }, [postId]);

  useEffect(() => {
    if (!loading && focusComment) {
      const timer = setTimeout(() => inputRef.current?.focus(), 250);
      return () => clearTimeout(timer);
    }
  }, [loading, focusComment]);

  const handleToggleLike = async () => {
    if (!post) return;
    setPost({ ...post, liked_by_me: !post.liked_by_me, likes_count: (post.likes_count ?? 0) + (post.liked_by_me ? -1 : 1) });
    try { await academicApi.toggleLike(post.id); } catch {}
  };

  const handleToggleSave = async () => {
    if (!post) return;
    setPost({ ...post, saved_by_me: !post.saved_by_me });
    try { await academicApi.toggleSave(post.id); } catch {}
  };

  const handlePostComment = async () => {
    if (!post || !commentText.trim()) return;
    setPosting(true);
    try {
      const r = await academicApi.createComment(post.id, commentText.trim());
      setComments(prev => [...prev, r.data]);
      setCommentText('');
      setPost({ ...post, comments_count: (post.comments_count ?? 0) + 1 });
    } catch {
      Alert.alert(t('common.error', 'Error'), t('learn.comment_failed', 'Failed to post comment'));
    } finally {
      setPosting(false);
    }
  };

  const handleDeleteComment = (commentId: string) => {
    Alert.alert(
      t('learn.delete_comment', 'Delete comment?'),
      '',
      [
        { text: t('common.cancel', 'Cancel'), style: 'cancel' },
        {
          text: t('common.delete', 'Delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await academicApi.deleteComment(commentId);
              setComments(prev => prev.filter(c => c.id !== commentId));
              if (post) setPost({ ...post, comments_count: Math.max(0, (post.comments_count ?? 1) - 1) });
            } catch {}
          },
        },
      ],
    );
  };

  if (loading || !post) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={headerHeight}
      >
      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xl }}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.header}>
            <View style={[styles.avatar, { backgroundColor: colors.primaryLight }]}>
              <Text style={[styles.avatarText, { color: colors.primary }]}>
                {(post.author_name ?? '?').charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.authorName, { color: colors.text }]} numberOfLines={1}>{authorLabel(post)}</Text>
              <Text style={[styles.postDate, { color: colors.textMuted }]}>
                {new Date(post.created_at).toLocaleDateString()}
              </Text>
            </View>
          </View>

          <Text style={[styles.title, { color: colors.text }]}>{post.title}</Text>
          {post.image_url && (
            <Image source={{ uri: post.image_url }} style={styles.image} resizeMode="cover" />
          )}
          {post.body && <Text style={[styles.body, { color: colors.text }]}>{post.body}</Text>}
          {post.content_type !== 'file' && post.content && (
            <Text style={[styles.body, { color: colors.text }]}>
              {post.content.replace(/<[^>]+>/g, '')}
            </Text>
          )}

          <View style={[styles.actionRow, { borderTopColor: colors.border }]}>
            <TouchableOpacity onPress={handleToggleLike} style={styles.actionBtn} hitSlop={8}>
              <Heart size={20} color={post.liked_by_me ? '#E11D48' : colors.textMuted} fill={post.liked_by_me ? '#E11D48' : 'transparent'} />
              <Text style={[styles.actionCount, { color: post.liked_by_me ? '#E11D48' : colors.textMuted }]}>
                {post.likes_count ?? 0}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => inputRef.current?.focus()} style={styles.actionBtn} hitSlop={8}>
              <MessageCircle size={20} color={colors.textMuted} />
              <Text style={[styles.actionCount, { color: colors.textMuted }]}>{post.comments_count ?? 0}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleToggleSave} style={[styles.actionBtn, { marginLeft: 'auto' }]} hitSlop={8}>
              <Bookmark size={20} color={post.saved_by_me ? colors.primary : colors.textMuted} fill={post.saved_by_me ? colors.primary : 'transparent'} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Comments */}
        <View style={{ marginTop: spacing.md }}>
          <Text style={[styles.sectionLabel, { color: colors.text }]}>
            {t('learn.comments', 'Comments')} ({post.comments_count ?? 0})
          </Text>
          {comments.length === 0 ? (
            <Text style={[styles.emptyText, { color: colors.textMuted }]}>
              {t('learn.no_comments', 'No comments yet')}
            </Text>
          ) : (
            comments.map(c => (
              <View key={c.id} style={[styles.comment, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.commentAuthor, { color: colors.text }]}>
                    {c.users?.first_name} {c.users?.last_name}
                  </Text>
                  <Text style={[styles.commentBody, { color: colors.text }]}>{c.body}</Text>
                </View>
                {(c.user_id === user?.id) && (
                  <TouchableOpacity onPress={() => handleDeleteComment(c.id)} hitSlop={8}>
                    <Trash2 size={14} color={colors.textMuted} />
                  </TouchableOpacity>
                )}
              </View>
            ))
          )}
        </View>
      </ScrollView>

      {/* Comment input */}
      <View style={[styles.inputBar, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
        <TextInput
          ref={inputRef}
          style={[styles.input, { backgroundColor: colors.bg, color: colors.text }]}
          value={commentText}
          onChangeText={setCommentText}
          placeholder={t('learn.write_comment', 'Write a comment...')}
          placeholderTextColor={colors.textMuted}
        />
        <TouchableOpacity
          onPress={handlePostComment}
          disabled={posting || !commentText.trim()}
          style={[styles.sendBtn, { backgroundColor: colors.primary, opacity: !commentText.trim() || posting ? 0.5 : 1 }]}
        >
          <Send size={16} color="#fff" />
        </TouchableOpacity>
      </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: font.md, fontWeight: '700' },
  authorName: { fontSize: font.sm, fontWeight: '600' },
  postDate: { fontSize: font.xs, marginTop: 1 },
  title: { fontSize: font.lg, fontWeight: '700', marginBottom: 8 },
  image: { width: '100%', height: 220, borderRadius: radius.md, marginBottom: 10 },
  body: { fontSize: font.sm, lineHeight: 22, marginBottom: 8 },
  actionRow: { flexDirection: 'row', gap: 18, marginTop: 12, paddingTop: 10, borderTopWidth: 1, alignItems: 'center' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionCount: { fontSize: font.sm, fontWeight: '600' },

  sectionLabel: { fontSize: font.sm, fontWeight: '700', marginBottom: 10 },
  emptyText: { fontSize: font.sm, textAlign: 'center', padding: 20 },
  comment: { flexDirection: 'row', gap: 8, padding: 12, borderRadius: radius.md, borderWidth: 1, marginBottom: 8, alignItems: 'flex-start' },
  commentAuthor: { fontSize: font.xs, fontWeight: '700', marginBottom: 2 },
  commentBody: { fontSize: font.sm, lineHeight: 20 },

  inputBar: { flexDirection: 'row', padding: spacing.sm, borderTopWidth: 1, gap: 8, alignItems: 'center' },
  input: { flex: 1, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, fontSize: font.sm },
  sendBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
