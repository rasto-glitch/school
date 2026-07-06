import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { Heart, MessageCircle, Megaphone } from 'lucide-react-native';
import { useColors } from '../store/themeStore';
import { useAuthStore } from '../store/authStore';
import { spacing, radius, shadow, font } from '../theme';
import { bodyTeaser } from '../utils/bodyTeaser';
import type { Announcement } from '../types';

interface Props {
  announcement: Announcement;
  onPress: () => void;
  onPressComment: () => void;
  onToggleLike: () => void;
}

export default function AnnouncementCard({ announcement, onPress, onPressComment, onToggleLike }: Props) {
  const colors = useColors();
  const { school } = useAuthStore();
  const styles = makeStyles(colors);

  const [aspectRatio, setAspectRatio] = useState<number | null>(16 / 9);
  useEffect(() => {
    if (!announcement.imageUrl) return;
    Image.getSize(
      announcement.imageUrl,
      (w, h) => { if (w && h) setAspectRatio(w / h); },
      () => setAspectRatio(16 / 9),
    );
  }, [announcement.imageUrl]);

  const teaser = announcement.content ? bodyTeaser(announcement.content) : null;
  const announcerName = announcement.users?.role === 'admin'
    ? (school?.name || 'School')
    : (`${announcement.users?.firstName ?? ''} ${announcement.users?.lastName ?? ''}`.trim() || 'School');
  const avatarUrl = announcement.users?.profilePicture;

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={styles.card}>
      <View style={styles.body}>
        <View style={styles.header}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Megaphone size={16} color={colors.primary} />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.author} numberOfLines={1}>{announcerName}</Text>
            <Text style={styles.date}>
              {new Date(announcement.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
            </Text>
          </View>
          <View style={styles.tag}>
            <Text style={styles.tagText}>Announcement</Text>
          </View>
        </View>

        <Text style={styles.title} numberOfLines={2}>{announcement.title}</Text>
        {teaser && teaser.text.length > 0 && (
          <Text style={styles.teaser}>
            {teaser.text}
            {teaser.truncated && (
              <>
                <Text>… </Text>
                <Text style={styles.seeMore}>see more</Text>
              </>
            )}
          </Text>
        )}
      </View>

      {announcement.imageUrl && (
        <Image
          source={{ uri: announcement.imageUrl }}
          style={[styles.image, aspectRatio ? { aspectRatio } : null]}
          resizeMode="cover"
        />
      )}

      <View style={styles.actionRow}>
        <TouchableOpacity onPress={(e) => { e.stopPropagation(); onToggleLike(); }} style={styles.actionBtn} hitSlop={8}>
          <Heart
            size={18}
            color={announcement.likedByMe ? '#E11D48' : colors.textMuted}
            fill={announcement.likedByMe ? '#E11D48' : 'transparent'}
          />
          <Text style={[styles.actionCount, { color: announcement.likedByMe ? '#E11D48' : colors.textMuted }]}>
            {announcement.likesCount ?? 0}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={(e) => { e.stopPropagation(); onPressComment(); }} style={styles.actionBtn} hitSlop={8}>
          <MessageCircle size={18} color={colors.textMuted} />
          <Text style={[styles.actionCount, { color: colors.textMuted }]}>
            {announcement.commentsCount ?? 0}
          </Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

const makeStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.md, marginBottom: spacing.md, overflow: 'hidden', ...shadow.sm },
  body: { padding: spacing.md, paddingBottom: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  avatar: { width: 36, height: 36, borderRadius: 18 },
  avatarFallback: { backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  author: { fontSize: font.sm, fontWeight: '700', color: colors.text },
  date: { fontSize: font.xs, color: colors.textMuted, marginTop: 1 },
  tag: { backgroundColor: '#F3E8FF', borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  tagText: { fontSize: font.xs, fontWeight: '700', color: '#7C3AED' },
  title: { fontSize: font.md, fontWeight: '700', color: colors.text, marginBottom: 6 },
  teaser: { fontSize: font.sm, color: colors.textSecondary, lineHeight: 20 },
  seeMore: { color: colors.primary, fontWeight: '700' },
  image: { width: '100%' },
  actionRow: { flexDirection: 'row', gap: 18, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, alignItems: 'center' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionCount: { fontSize: font.sm, fontWeight: '600' },
});
