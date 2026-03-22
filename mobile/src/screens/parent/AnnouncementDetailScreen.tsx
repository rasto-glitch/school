import { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { Megaphone } from 'lucide-react-native';
import { useColors } from '../../store/themeStore';
import { spacing, radius, font } from '../../theme';
import type { Announcement } from '../../types';

export default function AnnouncementDetailScreen() {
  const route = useRoute<any>();
  const announcement: Announcement = route.params?.announcement;
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  if (!announcement) return null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Gradient-style header */}
      <View style={styles.heroCard}>
        <View style={styles.heroTopRow}>
          <Megaphone size={18} color="rgba(255,255,255,0.8)" />
          <Text style={styles.heroLabel}>School Announcement</Text>
          {announcement.targetAudience && (
            <View style={styles.audienceBadge}>
              <Text style={styles.audienceBadgeText}>{announcement.targetAudience}</Text>
            </View>
          )}
        </View>
        <Text style={styles.heroTitle}>{announcement.title}</Text>
        <Text style={styles.heroDate}>
          {new Date(announcement.createdAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>

      {/* Content */}
      <View style={styles.contentCard}>
        <Text style={styles.contentText}>{announcement.content}</Text>
      </View>
    </ScrollView>
  );
}

const makeStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: 40 },
  heroCard: {
    backgroundColor: colors.primary, borderRadius: radius.lg, padding: spacing.lg,
    marginBottom: spacing.md,
  },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  heroLabel: { fontSize: font.sm, color: 'rgba(255,255,255,0.8)', fontWeight: '500', flex: 1 },
  audienceBadge: { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  audienceBadgeText: { fontSize: font.xs, color: '#fff', fontWeight: '600' },
  heroTitle: { fontSize: font.xl, fontWeight: '800', color: '#fff', marginBottom: spacing.sm },
  heroDate: { fontSize: font.xs, color: 'rgba(255,255,255,0.6)' },
  contentCard: {
    backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md,
  },
  contentText: { fontSize: font.md, color: colors.text, lineHeight: 24 },
});
