import { useState, useMemo, useRef, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native';
import { HeroListSkeleton } from '../../components/Skeleton';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useBadgeStore } from '../../store/badgeStore';
import { Megaphone, ChevronRight } from 'lucide-react-native';
import { parentApi } from '../../services/api';
import { useColors } from '../../store/themeStore';
import { spacing, radius, shadow, font } from '../../theme';
import type { Announcement } from '../../types';
import type { RootStackParamList } from '../../navigation';

export default function AnnouncementsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const initialized = useRef(false);
  const setUnreadCount = useBadgeStore(s => s.setUnreadCount);

  const load = () => parentApi.getAnnouncements().then(r => setItems(r.data || []));

  useFocusEffect(
    useCallback(() => {
      if (!initialized.current) {
        initialized.current = true;
        load().finally(() => setLoading(false));
      } else {
        load();
      }
      parentApi.markTypeRead('announcement').catch(() => {});
      parentApi.getUnreadCount().then(r => setUnreadCount(r.data?.count ?? 0)).catch(() => {});
    }, [])
  );

  const onRefresh = () => { setRefreshing(true); load().finally(() => setRefreshing(false)); };

  const latest = items[0];
  const rest = items.slice(1);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <View style={styles.header}>
        <Text style={styles.title}>{t('announcements.title')}</Text>
        <Text style={styles.subtitle}>{t('announcements.subtitle')}</Text>
      </View>

      {loading ? (
        <HeroListSkeleton />
      ) : items.length === 0 ? (
        <View style={styles.emptyBox}>
          <Megaphone size={40} color={colors.textMuted} />
          <Text style={styles.emptyText}>{t('announcements.no_announcements')}</Text>
        </View>
      ) : (
        <>
          {/* Latest — hero card */}
          {latest && (
            <TouchableOpacity
              style={styles.heroCard}
              activeOpacity={0.85}
              onPress={() => navigation.navigate('AnnouncementDetail', { announcement: latest })}
            >
              <View style={styles.heroTopRow}>
                <Megaphone size={16} color="rgba(255,255,255,0.8)" />
                <Text style={styles.heroLabel}>Latest Announcement</Text>
              </View>
              <Text style={styles.heroTitle}>{latest.title}</Text>
              <Text style={styles.heroContent} numberOfLines={3}>{latest.content}</Text>
              <Text style={styles.heroDate}>{new Date(latest.createdAt).toLocaleDateString()}</Text>
            </TouchableOpacity>
          )}

          {/* Older announcements */}
          {rest.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Previous Announcements</Text>
              {rest.map(item => (
                <TouchableOpacity
                  key={item.id}
                  style={styles.card}
                  activeOpacity={0.7}
                  onPress={() => navigation.navigate('AnnouncementDetail', { announcement: item })}
                >
                  <View style={styles.cardRow}>
                    <View style={styles.iconBox}>
                      <Megaphone size={16} color="#9333EA" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardTitle}>{item.title}</Text>
                      <Text style={styles.cardContent} numberOfLines={2}>{item.content}</Text>
                      <Text style={styles.cardDate}>{new Date(item.createdAt).toLocaleDateString()}</Text>
                    </View>
                    <ChevronRight size={16} color={colors.textMuted} style={{ alignSelf: 'center' }} />
                  </View>
                </TouchableOpacity>
              ))}
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

const makeStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: 40 },
  header: { marginBottom: spacing.lg },
  title: { fontSize: font.xxl, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: font.sm, color: colors.textMuted, marginTop: 2 },
  emptyBox: { alignItems: 'center', marginTop: 60, gap: spacing.md },
  emptyText: { fontSize: font.md, color: colors.textMuted },
  heroCard: { backgroundColor: colors.primary, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.lg },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  heroLabel: { fontSize: font.sm, color: 'rgba(255,255,255,0.8)', fontWeight: '500' },
  heroTitle: { fontSize: font.xl, fontWeight: '800', color: '#fff', marginBottom: spacing.sm },
  heroContent: { fontSize: font.sm, color: 'rgba(255,255,255,0.85)', lineHeight: 20, marginBottom: spacing.sm },
  heroDate: { fontSize: font.xs, color: 'rgba(255,255,255,0.6)' },
  sectionTitle: { fontSize: font.sm, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm },
  card: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, ...shadow.sm },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  iconBox: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: '#FAF5FF', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  cardTitle: { fontSize: font.md, fontWeight: '600', color: colors.text, marginBottom: 3 },
  cardContent: { fontSize: font.sm, color: colors.textSecondary, lineHeight: 19 },
  cardDate: { fontSize: font.xs, color: colors.textMuted, marginTop: 4 },
});
