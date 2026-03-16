import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Megaphone, BookOpen, FileText } from 'lucide-react-native';
import { useAuthStore } from '../../store/authStore';
import { parentApi } from '../../services/api';
import { colors, spacing, radius, shadow, font } from '../../theme';
import type { Homework, Announcement } from '../../types';

export default function FeedScreen() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const insets = useSafeAreaInsets();
  const [homework, setHomework] = useState<Homework[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    const [hw, ann] = await Promise.all([
      parentApi.getHomework(),
      parentApi.getAnnouncements(),
    ]);
    setHomework(hw.data || []);
    setAnnouncements(ann.data || []);
  };

  useEffect(() => { load().finally(() => setLoading(false)); }, []);

  const onRefresh = () => {
    setRefreshing(true);
    load().finally(() => setRefreshing(false));
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.greeting}>{t('dashboard.subtitle', { name: user?.firstName })}</Text>
        <Text style={styles.title}>{t('dashboard.title')}</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <>
          {/* Announcements */}
          {announcements.length > 0 && (
            <>
              <SectionHeader icon={<Megaphone size={14} color={colors.primary} />} label={t('nav.announcements')} />
              {announcements.map(item => (
                <View key={item.id} style={styles.card}>
                  <Text style={styles.cardTitle}>{item.title}</Text>
                  <Text style={styles.cardBody} numberOfLines={3}>{item.content}</Text>
                  <Text style={styles.cardMeta}>{new Date(item.createdAt).toLocaleDateString()}</Text>
                </View>
              ))}
            </>
          )}

          {/* Homework */}
          {homework.length > 0 && (
            <>
              <SectionHeader icon={<BookOpen size={14} color={colors.warning} />} label={t('nav.homework')} />
              {homework.map(item => (
                <View key={item.id} style={styles.card}>
                  <View style={styles.row}>
                    <Text style={[styles.cardTitle, { flex: 1 }]}>{item.title}</Text>
                    {item.subject && <Pill label={item.subject} color={colors.primary} bg={colors.primaryLight} />}
                  </View>
                  {item.classes?.name && <Text style={styles.cardMeta}>{item.classes.name}</Text>}
                  {item.description && <Text style={styles.cardBody} numberOfLines={2}>{item.description}</Text>}
                  {item.dueDate && (
                    <Text style={styles.due}>{t('homework.due', { date: new Date(item.dueDate).toLocaleDateString() })}</Text>
                  )}
                </View>
              ))}
            </>
          )}

          {announcements.length === 0 && homework.length === 0 && (
            <View style={styles.emptyBox}>
              <FileText size={40} color={colors.textMuted} />
              <Text style={styles.emptyText}>{t('dashboard.no_activity')}</Text>
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

function SectionHeader({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <View style={styles.sectionHeader}>
      {icon}
      <Text style={styles.sectionLabel}>{label}</Text>
    </View>
  );
}

function Pill({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.pillText, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: 40 },
  header: { marginBottom: spacing.lg },
  greeting: { fontSize: font.sm, color: colors.textMuted, marginBottom: 2 },
  title: { fontSize: font.xxxl, fontWeight: '700', color: colors.text },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.md, marginBottom: spacing.sm },
  sectionLabel: { fontSize: font.sm, fontWeight: '700', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  card: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, ...shadow.sm },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginBottom: 4 },
  cardTitle: { fontSize: font.md, fontWeight: '600', color: colors.text, marginBottom: 4 },
  cardBody: { fontSize: font.sm, color: colors.textSecondary, lineHeight: 19 },
  cardMeta: { fontSize: font.xs, color: colors.textMuted, marginTop: 6 },
  due: { fontSize: font.xs, color: colors.warning, fontWeight: '700', marginTop: 6 },
  pill: { borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 3 },
  pillText: { fontSize: font.xs, fontWeight: '700' },
  emptyBox: { alignItems: 'center', marginTop: 60, gap: spacing.md },
  emptyText: { fontSize: font.md, color: colors.textMuted },
});
