import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image,
  RefreshControl, ActivityIndicator, Animated,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { Heart, MessageCircle, Bookmark, BookOpen, FileText } from 'lucide-react-native';
import { academicApi, parentApi } from '../../services/api';
import { useColors, useIsDark } from '../../store/themeStore';
import { useBadgeStore } from '../../store/badgeStore';
import { spacing, radius, font } from '../../theme';
import type { AcademicPost, Ebook, EbookProgress, Student } from '../../types';

function bodyTeaser(raw: string): { text: string; truncated: boolean } {
  const trimmed = raw.trim();
  if (!trimmed) return { text: '', truncated: false };
  const sentences = trimmed.match(/[^.!?\n]+[.!?\n]+/g);
  if (sentences && sentences.length >= 2) {
    const first2 = sentences.slice(0, 2).join('').trim();
    return { text: first2, truncated: first2.length < trimmed.length };
  }
  const limit = 140;
  if (trimmed.length > limit) {
    const cut = trimmed.slice(0, limit);
    const lastSpace = cut.lastIndexOf(' ');
    return { text: (lastSpace > 60 ? cut.slice(0, lastSpace) : cut).trim(), truncated: true };
  }
  return { text: trimmed, truncated: false };
}

type Tab = 'ebooks' | 'posts' | 'saved';

function authorLabel(post: AcademicPost): string {
  if (post.author_role === 'supervisor') {
    return `${post.author_name ?? ''} — Principal`;
  }
  const name = post.author_name ?? post.teachers?.full_name ?? 'Teacher';
  const subject = post.author_subject ?? post.teachers?.subject;
  return subject ? `${name} — ${subject}` : name;
}

function PostCard({ post, onPress, onToggleLike, onToggleSave, onPressComment }: {
  post: AcademicPost;
  onPress: () => void;
  onToggleLike: () => void;
  onToggleSave: () => void;
  onPressComment: () => void;
}) {
  const { t } = useTranslation();
  const colors = useColors();
  const [imgAspect, setImgAspect] = useState<number>(16 / 9);

  useEffect(() => {
    if (!post.image_url) return;
    Image.getSize(
      post.image_url,
      (w, h) => { if (w > 0 && h > 0) setImgAspect(w / h); },
      () => {},
    );
  }, [post.image_url]);

  const fullText = post.content_type !== 'file' && post.content
    ? post.content.replace(/<[^>]+>/g, '').trim()
    : '';
  const shortBody = (post.body ?? '').trim();
  const displayText = shortBody || fullText;
  const teaser = displayText ? bodyTeaser(displayText) : null;
  const hasMore = !!(teaser && shortBody && fullText && fullText.length > shortBody.length);
  const showSeeMore = !!(teaser && (teaser.truncated || hasMore));

  return (
    <TouchableOpacity style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.cardHeader}>
        {post.author_avatar ? (
          <Image source={{ uri: post.author_avatar }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, { backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' }]}>
            <Text style={[styles.avatarText, { color: colors.primary }]}>
              {(post.author_name ?? '?').charAt(0).toUpperCase()}
            </Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={[styles.authorName, { color: colors.text }]} numberOfLines={1}>{authorLabel(post)}</Text>
          <Text style={[styles.postDate, { color: colors.textMuted }]}>
            {new Date(post.created_at).toLocaleDateString()}
          </Text>
        </View>
        {post.author_role === 'supervisor' && (
          <View style={[styles.badge, { backgroundColor: '#FEF3C7' }]}>
            <Text style={[styles.badgeText, { color: '#92400E' }]}>School-wide</Text>
          </View>
        )}
      </View>
      <Text style={[styles.postTitle, { color: colors.text }]} numberOfLines={2}>{post.title}</Text>
      {teaser && teaser.text.length > 0 && (
        <Text style={[styles.postBody, { color: colors.textMuted }]}>
          {teaser.text}
          {showSeeMore && (
            <>
              <Text>… </Text>
              <Text style={{ color: colors.primary, fontWeight: '600' }} onPress={onPress}>
                {t('learn.see_more', 'see more')}
              </Text>
            </>
          )}
        </Text>
      )}
      {post.image_url && (
        <Image
          source={{ uri: post.image_url }}
          style={[styles.postImage, { aspectRatio: imgAspect }]}
          resizeMode="cover"
        />
      )}
      <View style={[styles.actionRow, { borderTopColor: colors.border }]}>
        <TouchableOpacity onPress={onToggleLike} style={styles.actionBtn} hitSlop={8}>
          <Heart
            size={18}
            color={post.liked_by_me ? '#E11D48' : colors.textMuted}
            fill={post.liked_by_me ? '#E11D48' : 'transparent'}
          />
          <Text style={[styles.actionCount, { color: post.liked_by_me ? '#E11D48' : colors.textMuted }]}>
            {post.likes_count ?? 0}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onPressComment} style={styles.actionBtn} hitSlop={8}>
          <MessageCircle size={18} color={colors.textMuted} />
          <Text style={[styles.actionCount, { color: colors.textMuted }]}>{post.comments_count ?? 0}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onToggleSave} style={[styles.actionBtn, { marginLeft: 'auto' }]} hitSlop={8}>
          <Bookmark
            size={18}
            color={post.saved_by_me ? colors.primary : colors.textMuted}
            fill={post.saved_by_me ? colors.primary : 'transparent'}
          />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

function EbookCard({ ebook, progress, onOpen }: {
  ebook: Ebook;
  progress?: EbookProgress;
  onOpen: () => void;
}) {
  const colors = useColors();
  const isDark = useIsDark();
  const percent = progress?.percent ?? 0;

  return (
    <TouchableOpacity onPress={onOpen} activeOpacity={0.8} style={[styles.ebookCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[
        styles.ebookCover,
        {
          backgroundColor: isDark ? 'transparent' : colors.primaryLight,
          borderWidth: isDark ? 1.5 : 0,
          borderColor: isDark ? '#FFFFFF' : 'transparent',
        },
      ]}>
        {ebook.cover_url ? (
          <Image source={{ uri: ebook.cover_url }} style={styles.ebookCoverImage} />
        ) : (
          <BookOpen size={32} color={isDark ? '#FFFFFF' : colors.primary} />
        )}
      </View>
      <View style={styles.ebookBody}>
        <Text style={[styles.ebookTitle, { color: colors.text }]} numberOfLines={2}>{ebook.title}</Text>
        {ebook.author && <Text style={[styles.ebookAuthor, { color: colors.textMuted }]}>{ebook.author}</Text>}
        <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
          <View style={[styles.progressFill, { backgroundColor: colors.primary, width: `${percent}%` }]} />
        </View>
        <View style={styles.progressRow}>
          <Text style={[styles.progressText, { color: colors.textMuted }]}>{Math.round(percent)}%</Text>
          {progress?.current_page != null && progress?.total_pages != null && (
            <Text style={[styles.progressText, { color: colors.textMuted }]}>
              p. {progress.current_page} / {progress.total_pages}
            </Text>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const TABS: Tab[] = ['ebooks', 'posts', 'saved'];

export default function LearnScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const isDark = useIsDark();
  const navigation = useNavigation<any>();
  const { postCount, clearPost } = useBadgeStore();
  const [tab, setTab] = useState<Tab>('ebooks');
  const [posts, setPosts] = useState<AcademicPost[]>([]);
  const [saved, setSaved] = useState<AcademicPost[]>([]);
  const [ebooks, setEbooks] = useState<Ebook[]>([]);
  const [progress, setProgress] = useState<EbookProgress[]>([]);
  const [children, setChildren] = useState<Student[]>([]);
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [segmentedWidth, setSegmentedWidth] = useState(0);
  const underlineX = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!segmentedWidth) return;
    const idx = TABS.indexOf(tab);
    Animated.spring(underlineX, {
      toValue: idx * (segmentedWidth / TABS.length),
      useNativeDriver: true,
      tension: 120,
      friction: 14,
    }).start();
  }, [tab, segmentedWidth, underlineX]);

  const load = useCallback(async () => {
    try {
      const [p, s, e, pr, c] = await Promise.allSettled([
        academicApi.getPosts(),
        academicApi.getSavedPosts(),
        academicApi.getEbooks(),
        academicApi.getEbookProgress(),
        parentApi.getChildren(),
      ]);
      if (p.status === 'fulfilled') setPosts(p.value.data ?? []);
      if (s.status === 'fulfilled') setSaved(s.value.data ?? []);
      if (e.status === 'fulfilled') setEbooks(e.value.data ?? []);
      if (pr.status === 'fulfilled') setProgress(pr.value.data ?? []);
      if (c.status === 'fulfilled') {
        const kids: Student[] = c.value.data ?? [];
        setChildren(kids);
        setSelectedChildId(prev => prev && kids.some(k => k.id === prev) ? prev : (kids[0]?.id ?? null));
      }
    } catch {}
  }, []);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);

  // When the user enters the Posts sub-tab, clear the post badge.
  useEffect(() => {
    if (tab !== 'posts') return;
    if (postCount === 0) return;
    clearPost();
    parentApi.markTypeRead('post').catch(() => {});
  }, [tab, postCount, clearPost]);

  const selectedChild = useMemo(
    () => children.find(c => c.id === selectedChildId) ?? null,
    [children, selectedChildId],
  );

  const visibleEbooks = useMemo(() => {
    if (!selectedChild) return [];
    const classId = selectedChild.classId;
    return ebooks.filter(e => !e.class_id || e.class_id === classId);
  }, [ebooks, selectedChild]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const handleToggleLike = async (postId: string) => {
    setPosts(prev => prev.map(p => p.id === postId
      ? { ...p, liked_by_me: !p.liked_by_me, likes_count: (p.likes_count ?? 0) + (p.liked_by_me ? -1 : 1) }
      : p));
    try { await academicApi.toggleLike(postId); } catch { load(); }
  };

  const handleToggleSave = async (postId: string) => {
    const target = posts.find(p => p.id === postId) ?? saved.find(p => p.id === postId);
    const newSaved = !(target?.saved_by_me);
    setPosts(prev => prev.map(p => p.id === postId ? { ...p, saved_by_me: newSaved } : p));
    setSaved(prev => newSaved
      ? (target ? [{ ...target, saved_by_me: true }, ...prev.filter(p => p.id !== postId)] : prev)
      : prev.filter(p => p.id !== postId));
    try { await academicApi.toggleSave(postId); } catch { load(); }
  };

  const openEbook = (ebook: Ebook) => {
    if (!selectedChild) return;
    navigation.navigate('EbookReader', {
      ebook,
      studentId: selectedChild.id,
      studentName: selectedChild.fullName,
    });
  };

  const progressByKey = useMemo(() => {
    const map = new Map<string, EbookProgress>();
    for (const p of progress) map.set(`${p.student_id}:${p.ebook_id}`, p);
    return map;
  }, [progress]);

  const emptyLabel = tab === 'posts'
    ? t('learn.no_posts', 'No posts yet')
    : tab === 'saved'
      ? t('learn.no_saved', 'No saved posts')
      : !selectedChild
        ? t('learn.no_children', 'No students linked to this account.')
        : t('learn.no_ebooks_for_class', 'No e-books for this class yet');

  const mainList =
    tab === 'posts' ? posts :
    tab === 'saved' ? saved :
    visibleEbooks;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      {/* Segmented tabs */}
      <View
        style={[styles.segmented, { backgroundColor: colors.card, borderBottomColor: colors.border }]}
        onLayout={e => setSegmentedWidth(e.nativeEvent.layout.width)}
      >
        {TABS.map(key => {
          const active = tab === key;
          const activeColor = isDark ? '#FFFFFF' : colors.primary;
          const mutedColor = isDark ? 'rgba(255,255,255,0.6)' : colors.textMuted;
          const showPostBadge = key === 'posts' && postCount > 0;
          return (
            <TouchableOpacity
              key={key}
              onPress={() => setTab(key)}
              style={styles.segment}
              activeOpacity={0.7}
            >
              <View style={styles.segmentInner}>
                <Text style={[styles.segmentText, { color: active ? activeColor : mutedColor }]}>
                  {key === 'ebooks' ? t('learn.tab_ebooks', 'E-Books') : key === 'posts' ? t('learn.tab_posts', 'Posts') : t('learn.tab_saved', 'Saved')}
                </Text>
                {showPostBadge && (
                  <View style={styles.segmentBadge}>
                    <Text style={styles.segmentBadgeText}>{postCount > 99 ? '99+' : postCount}</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          );
        })}
        {segmentedWidth > 0 && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.segmentUnderline,
              {
                width: segmentedWidth / TABS.length,
                backgroundColor: isDark ? '#FFFFFF' : colors.primary,
                transform: [{ translateX: underlineX }],
              },
            ]}
          />
        )}
      </View>

      {/* Child selector — only shown on the E-Books tab */}
      {tab === 'ebooks' && children.length > 0 && (
        <View style={[styles.childStrip, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.childStripContent}
          >
            {children.map(c => {
              const active = c.id === selectedChildId;
              const chipBorder = isDark ? '#FFFFFF' : (active ? colors.primary : colors.border);
              const chipBg = isDark
                ? (active ? '#FFFFFF' : 'transparent')
                : (active ? colors.primaryLight : 'transparent');
              const nameColor = isDark
                ? (active ? '#000000' : '#FFFFFF')
                : (active ? colors.primary : colors.text);
              const classColor = isDark
                ? (active ? '#000000' : 'rgba(255,255,255,0.7)')
                : (active ? colors.primary : colors.textMuted);
              return (
                <TouchableOpacity
                  key={c.id}
                  onPress={() => setSelectedChildId(c.id)}
                  activeOpacity={0.7}
                  style={[
                    styles.childChip,
                    { borderColor: chipBorder, backgroundColor: chipBg },
                  ]}
                >
                  <Text style={[styles.childChipName, { color: nameColor }]} numberOfLines={1}>
                    {c.fullName}
                  </Text>
                  {c.classes?.name && (
                    <Text style={[styles.childChipClass, { color: classColor }]} numberOfLines={1}>
                      {c.classes.name}
                    </Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      <ScrollView
        contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
        ) : mainList.length === 0 ? (
          <View style={styles.empty}>
            <FileText size={40} color={colors.textMuted} />
            <Text style={[styles.emptyText, { color: colors.textMuted }]}>{emptyLabel}</Text>
          </View>
        ) : tab === 'ebooks' ? (
          visibleEbooks.map(e => (
            <EbookCard
              key={e.id}
              ebook={e}
              progress={selectedChild ? progressByKey.get(`${selectedChild.id}:${e.id}`) : undefined}
              onOpen={() => openEbook(e)}
            />
          ))
        ) : (
          (tab === 'posts' ? posts : saved).map(p => (
            <PostCard
              key={p.id}
              post={p}
              onPress={() => navigation.navigate('PostDetail', { postId: p.id })}
              onPressComment={() => navigation.navigate('PostDetail', { postId: p.id, focusComment: true })}
              onToggleLike={() => handleToggleLike(p.id)}
              onToggleSave={() => handleToggleSave(p.id)}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  segmented: { flexDirection: 'row', borderBottomWidth: 1, position: 'relative' },
  segment: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  segmentInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  segmentText: { fontSize: font.sm, fontWeight: '600' },
  segmentBadge: {
    minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: '#EF4444',
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4,
  },
  segmentBadgeText: { fontSize: 9, fontWeight: '800', color: '#fff' },
  segmentUnderline: { position: 'absolute', bottom: 0, left: 0, height: 2 },

  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { marginTop: 12, fontSize: font.sm },

  card: {
    borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: font.md, fontWeight: '700' },
  authorName: { fontSize: font.sm, fontWeight: '600' },
  postDate: { fontSize: font.xs, marginTop: 1 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  badgeText: { fontSize: 10, fontWeight: '700' },
  postTitle: { fontSize: font.md, fontWeight: '700', marginBottom: 4 },
  postBody: { fontSize: font.sm, lineHeight: 20 },
  postImage: { width: '100%', borderRadius: radius.md, marginTop: 10 },
  actionRow: { flexDirection: 'row', gap: 18, marginTop: 12, paddingTop: 10, borderTopWidth: 1, alignItems: 'center' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  actionCount: { fontSize: font.xs, fontWeight: '600' },

  ebookCard: { flexDirection: 'row', borderWidth: 1, borderRadius: radius.lg, padding: 12, marginBottom: spacing.md, gap: 12 },
  ebookCover: { width: 72, height: 96, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  ebookCoverImage: { width: '100%', height: '100%' },

  childStrip: { borderBottomWidth: 1 },
  childStripContent: { paddingHorizontal: spacing.md, paddingVertical: 10, gap: 8, alignItems: 'center' },
  childChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1.5, minWidth: 100 },
  childChipName: { fontSize: font.sm, fontWeight: '700' },
  childChipClass: { fontSize: font.xs, marginTop: 2 },
  ebookBody: { flex: 1, justifyContent: 'center' },
  ebookTitle: { fontSize: font.sm, fontWeight: '700', marginBottom: 2 },
  ebookAuthor: { fontSize: font.xs, marginBottom: 10 },
  progressTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  progressText: { fontSize: 10, fontWeight: '600' },
});
