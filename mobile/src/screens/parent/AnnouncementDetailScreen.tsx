import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Linking,
  TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useHeaderHeight } from '@react-navigation/elements';
import {
  Heart, MessageCircle, Send, Trash2, X, CornerDownRight,
  Megaphone, ExternalLink, Paperclip, FileText, Download,
} from 'lucide-react-native';
import { parentApi, announcementApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { useColors } from '../../store/themeStore';
import { spacing, radius, font } from '../../theme';
import type { Announcement, AnnouncementComment } from '../../types';

interface LinkPreview {
  type: 'youtube' | 'instagram' | 'facebook' | 'link';
  videoId?: string;
  url: string;
  title: string;
  description: string;
  image: string;
  siteName: string;
}

function getAttachmentType(url: string): 'image' | 'pdf' | 'other' {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  return 'other';
}

function commentInitials(c: AnnouncementComment): string {
  const first = (c.users?.first_name ?? '').charAt(0);
  const last = (c.users?.last_name ?? '').charAt(0);
  return `${first}${last}`.toUpperCase() || '?';
}

export default function AnnouncementDetailScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { user, school } = useAuthStore();
  const headerHeight = useHeaderHeight();

  const initial: Announcement | undefined = route.params?.announcement;
  const announcementId: string | undefined = route.params?.announcementId ?? initial?.id;
  const focusComment: boolean = route.params?.focusComment === true;

  const [announcement, setAnnouncement] = useState<Announcement | null>(initial ?? null);
  const [comments, setComments] = useState<AnnouncementComment[]>([]);
  const [loading, setLoading] = useState(!initial);
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  const [commentText, setCommentText] = useState('');
  const [posting, setPosting] = useState(false);
  const [replyTo, setReplyTo] = useState<AnnouncementComment | null>(null);
  const inputRef = useRef<TextInput>(null);

  // Always re-fetch the canonical announcement to get fresh likes/comments counts
  useEffect(() => {
    if (!announcementId) return;
    Promise.all([
      announcementApi.getById(announcementId),
      announcementApi.getComments(announcementId),
    ])
      .then(([a, c]) => { setAnnouncement(a.data); setComments(c.data ?? []); })
      .catch(() => {
        // Fall back to parent-scoped lookup if shared route fails
        parentApi.getAnnouncementById(announcementId).then(r => setAnnouncement(r.data)).catch(() => navigation.goBack());
      })
      .finally(() => setLoading(false));
  }, [announcementId]);

  useEffect(() => {
    if (!announcement?.linkUrl) return;
    parentApi.getLinkPreview(announcement.linkUrl).then(r => setPreview(r.data)).catch(() => {});
  }, [announcement?.linkUrl]);

  useEffect(() => {
    if (!loading && focusComment) {
      const timer = setTimeout(() => inputRef.current?.focus(), 250);
      return () => clearTimeout(timer);
    }
  }, [loading, focusComment]);

  const threaded = useMemo(() => {
    const tops = comments.filter(c => !c.parent_id);
    const repliesByParent = new Map<string, AnnouncementComment[]>();
    for (const c of comments) {
      if (c.parent_id) {
        const arr = repliesByParent.get(c.parent_id) ?? [];
        arr.push(c);
        repliesByParent.set(c.parent_id, arr);
      }
    }
    return tops.map(top => ({ top, replies: repliesByParent.get(top.id) ?? [] }));
  }, [comments]);

  const handleToggleLike = async () => {
    if (!announcement) return;
    setAnnouncement({
      ...announcement,
      liked_by_me: !announcement.liked_by_me,
      likes_count: (announcement.likes_count ?? 0) + (announcement.liked_by_me ? -1 : 1),
    });
    try { await announcementApi.toggleLike(announcement.id); } catch {}
  };

  const handlePostComment = async () => {
    if (!announcement || !commentText.trim()) return;
    setPosting(true);
    try {
      const r = await announcementApi.createComment(announcement.id, commentText.trim(), replyTo?.id);
      setComments(prev => [...prev, r.data]);
      setCommentText('');
      setReplyTo(null);
      setAnnouncement({ ...announcement, comments_count: (announcement.comments_count ?? 0) + 1 });
    } catch {
      Alert.alert(t('common.error', 'Error'), t('learn.comment_failed', 'Failed to post comment'));
    } finally {
      setPosting(false);
    }
  };

  const handleStartReply = (c: AnnouncementComment) => {
    setReplyTo(c);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleToggleCommentLike = async (c: AnnouncementComment) => {
    setComments(prev => prev.map(x => x.id === c.id ? {
      ...x,
      liked_by_me: !x.liked_by_me,
      likes_count: (x.likes_count ?? 0) + (x.liked_by_me ? -1 : 1),
    } : x));
    try { await announcementApi.toggleCommentLike(c.id); } catch {}
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
              await announcementApi.deleteComment(commentId);
              const removed = comments.filter(c => c.id === commentId || c.parent_id === commentId).length;
              setComments(prev => prev.filter(c => c.id !== commentId && c.parent_id !== commentId));
              if (announcement) setAnnouncement({ ...announcement, comments_count: Math.max(0, (announcement.comments_count ?? removed) - removed) });
            } catch {}
          },
        },
      ],
    );
  };

  const renderCommenter = (c: AnnouncementComment) => {
    const role = c.users?.role;
    if (role === 'admin') {
      return school?.name || t('common.school');
    }
    const name = `${c.users?.first_name ?? ''} ${c.users?.last_name ?? ''}`.trim() || 'User';
    if (role === 'teacher' && c.author_subject) return `${name} — ${c.author_subject}`;
    return name;
  };

  const renderComment = (c: AnnouncementComment, isReply: boolean) => {
    const avatarUrl = c.users?.profile_picture;
    return (
      <View
        key={c.id}
        style={[
          styles.comment,
          { backgroundColor: colors.card, borderColor: colors.border },
          isReply && { marginLeft: 32 },
        ]}
      >
        {avatarUrl ? (
          <Image source={{ uri: avatarUrl }} style={styles.commentAvatar} />
        ) : (
          <View style={[styles.commentAvatar, { backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' }]}>
            <Text style={{ color: colors.primary, fontSize: font.xs, fontWeight: '700' }}>{commentInitials(c)}</Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={[styles.commentAuthor, { color: colors.text }]}>{renderCommenter(c)}</Text>
          <Text style={[styles.commentBody, { color: colors.text }]}>{c.body}</Text>
          <View style={styles.commentActionRow}>
            <TouchableOpacity onPress={() => handleToggleCommentLike(c)} style={styles.commentActionBtn} hitSlop={6}>
              <Heart
                size={13}
                color={c.liked_by_me ? '#E11D48' : colors.textMuted}
                fill={c.liked_by_me ? '#E11D48' : 'transparent'}
              />
              {(c.likes_count ?? 0) > 0 && (
                <Text style={[styles.commentActionText, { color: c.liked_by_me ? '#E11D48' : colors.textMuted }]}>
                  {c.likes_count}
                </Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleStartReply(c)} style={styles.commentActionBtn} hitSlop={6}>
              <CornerDownRight size={13} color={colors.textMuted} />
              <Text style={[styles.commentActionText, { color: colors.textMuted }]}>{t('learn.reply', 'Reply')}</Text>
            </TouchableOpacity>
          </View>
        </View>
        {(c.user_id === user?.id) && (
          <TouchableOpacity onPress={() => handleDeleteComment(c.id)} hitSlop={8}>
            <Trash2 size={14} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>
    );
  };

  if (loading || !announcement) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const announcerName = announcement.users?.role === 'admin'
    ? (school?.name || t('common.school'))
    : (`${announcement.users?.first_name ?? ''} ${announcement.users?.last_name ?? ''}`.trim() || t('common.school'));
  const announcerAvatar = announcement.users?.profile_picture;

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
              {announcerAvatar ? (
                <Image source={{ uri: announcerAvatar }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, { backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' }]}>
                  <Megaphone size={18} color={colors.primary} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={[styles.authorName, { color: colors.text }]} numberOfLines={1}>{announcerName}</Text>
                <Text style={[styles.postDate, { color: colors.textMuted }]}>
                  {new Date(announcement.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                </Text>
              </View>
              {announcement.targetAudience && announcement.targetAudience !== 'all' && (
                <View style={[styles.audienceChip, { backgroundColor: colors.primaryLight }]}>
                  <Text style={[styles.audienceChipText, { color: colors.primary }]}>{announcement.targetAudience}</Text>
                </View>
              )}
            </View>

            <Text style={[styles.title, { color: colors.text }]}>{announcement.title}</Text>
            {announcement.content && (
              <Text style={[styles.body, { color: colors.text }]}>{announcement.content}</Text>
            )}

            {announcement.imageUrl && (
              <Image source={{ uri: announcement.imageUrl }} style={styles.image} resizeMode="cover" />
            )}

            {announcement.linkUrl && (
              <View style={styles.linkBlock}>
                {preview?.type === 'youtube' && preview.videoId ? (
                  <TouchableOpacity style={styles.youtubeThumbnail} onPress={() => Linking.openURL(announcement.linkUrl!)}>
                    <Image source={{ uri: `https://img.youtube.com/vi/${preview.videoId}/mqdefault.jpg` }} style={styles.youtubeImg} resizeMode="cover" />
                    <View style={styles.playOverlay}>
                      <View style={styles.playBtn}><Text style={styles.playIcon}>▶</Text></View>
                    </View>
                  </TouchableOpacity>
                ) : preview && (preview.title || preview.image) ? (
                  <TouchableOpacity style={[styles.previewCard, { borderColor: colors.border }]} activeOpacity={0.75} onPress={() => Linking.openURL(announcement.linkUrl!)}>
                    {preview.image ? (
                      <Image source={{ uri: preview.image }} style={styles.previewImage} resizeMode="cover" onError={() => {}} />
                    ) : null}
                    <View style={styles.previewBody}>
                      {preview.siteName ? <Text style={[styles.previewSite, { color: colors.textMuted }]}>{preview.siteName}</Text> : null}
                      {preview.title ? <Text style={[styles.previewTitle, { color: colors.text }]} numberOfLines={2}>{preview.title}</Text> : null}
                      {preview.description ? <Text style={[styles.previewDesc, { color: colors.textSecondary }]} numberOfLines={2}>{preview.description}</Text> : null}
                    </View>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={[styles.attachBtn, { backgroundColor: colors.primaryLight }]} onPress={() => Linking.openURL(announcement.linkUrl!)}>
                    <ExternalLink size={15} color={colors.primary} />
                    <Text style={[styles.attachText, { color: colors.primary }]}>{t('detail.open_link')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {announcement.attachmentUrl && (() => {
              const type = getAttachmentType(announcement.attachmentUrl!);
              return (
                <View style={{ marginTop: spacing.sm }}>
                  {type === 'image' ? (
                    <Image source={{ uri: announcement.attachmentUrl }} style={styles.attachImage} resizeMode="contain" />
                  ) : type === 'pdf' ? (
                    <TouchableOpacity style={[styles.pdfCard, { backgroundColor: colors.primaryLight }]} onPress={() => Linking.openURL(announcement.attachmentUrl!)}>
                      <FileText size={28} color={colors.primary} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.pdfLabel, { color: colors.text }]}>{t('detail.pdf_document')}</Text>
                        <Text style={[styles.pdfSub, { color: colors.textMuted }]}>{t('detail.tap_to_open')}</Text>
                      </View>
                      <Download size={16} color={colors.primary} />
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity style={[styles.attachBtn, { backgroundColor: colors.primaryLight }]} onPress={() => Linking.openURL(announcement.attachmentUrl!)}>
                      <Paperclip size={15} color={colors.primary} />
                      <Text style={[styles.attachText, { color: colors.primary }]}>{t('detail.download_attachment')}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })()}

            <View style={[styles.actionRow, { borderTopColor: colors.border }]}>
              <TouchableOpacity onPress={handleToggleLike} style={styles.actionBtn} hitSlop={8}>
                <Heart size={20} color={announcement.liked_by_me ? '#E11D48' : colors.textMuted} fill={announcement.liked_by_me ? '#E11D48' : 'transparent'} />
                <Text style={[styles.actionCount, { color: announcement.liked_by_me ? '#E11D48' : colors.textMuted }]}>
                  {announcement.likes_count ?? 0}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => inputRef.current?.focus()} style={styles.actionBtn} hitSlop={8}>
                <MessageCircle size={20} color={colors.textMuted} />
                <Text style={[styles.actionCount, { color: colors.textMuted }]}>{announcement.comments_count ?? 0}</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={{ marginTop: spacing.md }}>
            <Text style={[styles.sectionLabel, { color: colors.text }]}>
              {t('learn.comments', 'Comments')} ({announcement.comments_count ?? 0})
            </Text>
            {comments.length === 0 ? (
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>
                {t('learn.no_comments', 'No comments yet')}
              </Text>
            ) : (
              threaded.map(({ top, replies }) => (
                <View key={top.id}>
                  {renderComment(top, false)}
                  {replies.map(r => renderComment(r, true))}
                </View>
              ))
            )}
          </View>
        </ScrollView>

        {replyTo && (
          <View style={[styles.replyPill, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
            <CornerDownRight size={13} color={colors.textMuted} />
            <Text style={[styles.replyPillText, { color: colors.textMuted }]} numberOfLines={1}>
              {t('learn.replying_to', 'Replying to')} {renderCommenter(replyTo)}
            </Text>
            <TouchableOpacity onPress={() => setReplyTo(null)} hitSlop={8}>
              <X size={14} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        )}

        <View style={[styles.inputBar, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
          <TextInput
            ref={inputRef}
            style={[styles.input, { backgroundColor: colors.bg, color: colors.text }]}
            value={commentText}
            onChangeText={setCommentText}
            placeholder={replyTo
              ? t('learn.write_reply', 'Write a reply...')
              : t('learn.write_comment', 'Write a comment...')}
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
  avatar: { width: 40, height: 40, borderRadius: 20 },
  authorName: { fontSize: font.sm, fontWeight: '600' },
  postDate: { fontSize: font.xs, marginTop: 1 },
  audienceChip: { borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  audienceChipText: { fontSize: font.xs, fontWeight: '700', textTransform: 'capitalize' },
  title: { fontSize: font.lg, fontWeight: '700', marginBottom: 8 },
  image: { width: '100%', height: 220, borderRadius: radius.md, marginTop: 4, marginBottom: 4 },
  body: { fontSize: font.sm, lineHeight: 22, marginBottom: 8 },
  linkBlock: { marginTop: spacing.sm },
  youtubeThumbnail: { borderRadius: radius.md, overflow: 'hidden', position: 'relative' },
  youtubeImg: { width: '100%', height: 180 },
  playOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  playBtn: { width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,0,0,0.85)', alignItems: 'center', justifyContent: 'center' },
  playIcon: { color: '#fff', fontSize: 20, marginLeft: 3 },
  previewCard: { borderRadius: radius.md, borderWidth: 1, overflow: 'hidden' },
  previewImage: { width: '100%', height: 140 },
  previewBody: { padding: spacing.sm },
  previewSite: { fontSize: font.xs, marginBottom: 3 },
  previewTitle: { fontSize: font.sm, fontWeight: '700', marginBottom: 3 },
  previewDesc: { fontSize: font.xs, lineHeight: 17 },
  attachBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.md, padding: spacing.sm, alignSelf: 'flex-start' },
  attachText: { fontSize: font.sm, fontWeight: '600' },
  attachImage: { width: '100%', height: 220, borderRadius: radius.md },
  pdfCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.md, padding: spacing.md },
  pdfLabel: { fontSize: font.sm, fontWeight: '700' },
  pdfSub: { fontSize: font.xs, marginTop: 2 },
  actionRow: { flexDirection: 'row', gap: 18, marginTop: 12, paddingTop: 10, borderTopWidth: 1, alignItems: 'center' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionCount: { fontSize: font.sm, fontWeight: '600' },

  sectionLabel: { fontSize: font.sm, fontWeight: '700', marginBottom: 10 },
  emptyText: { fontSize: font.sm, textAlign: 'center', padding: 20 },
  comment: { flexDirection: 'row', gap: 8, padding: 12, borderRadius: radius.md, borderWidth: 1, marginBottom: 8, alignItems: 'flex-start' },
  commentAvatar: { width: 28, height: 28, borderRadius: 14 },
  commentAuthor: { fontSize: font.xs, fontWeight: '700', marginBottom: 2 },
  commentBody: { fontSize: font.sm, lineHeight: 20 },
  commentActionRow: { flexDirection: 'row', gap: 14, marginTop: 6 },
  commentActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  commentActionText: { fontSize: 11, fontWeight: '600' },
  replyPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderTopWidth: 1 },
  replyPillText: { flex: 1, fontSize: font.xs },

  inputBar: { flexDirection: 'row', padding: spacing.sm, borderTopWidth: 1, gap: 8, alignItems: 'center' },
  input: { flex: 1, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, fontSize: font.sm },
  sendBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
