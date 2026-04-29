import { useState, useMemo, useRef, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { HeroListSkeleton } from '../../components/Skeleton';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useBadgeStore } from '../../store/badgeStore';
import { Megaphone } from 'lucide-react-native';
import { parentApi, announcementApi } from '../../services/api';
import { useColors } from '../../store/themeStore';
import { spacing, font } from '../../theme';
import AnnouncementCard from '../../components/AnnouncementCard';
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

  const handleToggleLike = async (id: string) => {
    setItems(prev => prev.map(a => a.id === id ? {
      ...a,
      liked_by_me: !a.liked_by_me,
      likes_count: (a.likes_count ?? 0) + (a.liked_by_me ? -1 : 1),
    } : a));
    try { await announcementApi.toggleLike(id); } catch {}
  };

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
        items.map(ann => (
          <AnnouncementCard
            key={ann.id}
            announcement={ann}
            onPress={() => navigation.navigate('AnnouncementDetail', { announcement: ann })}
            onPressComment={() => navigation.navigate('AnnouncementDetail', { announcement: ann, focusComment: true })}
            onToggleLike={() => handleToggleLike(ann.id)}
          />
        ))
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
});
