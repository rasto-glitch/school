import { useMemo } from 'react';
import {
  View, Text, FlatList, StyleSheet,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePaginated } from '../../hooks/usePaginated';
import { DashboardSkeleton } from '../../components/Skeleton';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { Megaphone } from 'lucide-react-native';
import { useAuthStore } from '../../store/authStore';
import { announcementApi } from '../../services/api';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';
import { spacing, font } from '../../theme';
import { useColors } from '../../store/themeStore';
import AnnouncementCard from '../../components/AnnouncementCard';
import type { Announcement } from '../../types';

// Announcements feed for the desk roles on EmployeeTabs (admin / accountant /
// staff) — their "regular main page", mirroring the parent Feed tab. The
// backend filters the list to the caller's audiences (081).
export default function EmployeeFeedScreen() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const {
    items: announcements, setItems: setAnnouncements, loading, loadingMore, refreshing, refresh, loadMore,
  } = usePaginated<Announcement>(announcementApi.getAnnouncements);

  useRefreshOnFocus(refresh);

  const handleToggleLike = async (id: string) => {
    setAnnouncements(prev => prev.map(a => a.id === id ? {
      ...a,
      likedByMe: !a.likedByMe,
      likesCount: (a.likesCount ?? 0) + (a.likedByMe ? -1 : 1),
    } : a));
    try { await announcementApi.toggleLike(id); } catch {}
  };

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md }]}
      data={announcements}
      keyExtractor={(ann) => ann.id}
      onEndReached={loadMore}
      onEndReachedThreshold={0.6}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.greeting}>{t('dashboard.subtitle', { name: user?.firstName })}</Text>
          <Text style={styles.title}>{t('announcements.title', 'Announcements')}</Text>
        </View>
      }
      ListEmptyComponent={
        loading
          ? <DashboardSkeleton />
          : (
            <View style={styles.emptyBox}>
              <Megaphone size={40} color={colors.textMuted} />
              <Text style={styles.emptyText}>{t('announcements.no_announcements', 'No announcements yet')}</Text>
            </View>
          )
      }
      ListFooterComponent={
        loadingMore
          ? <ActivityIndicator style={{ marginVertical: spacing.md }} color={colors.primary} />
          : null
      }
      renderItem={({ item: ann }) => (
        <AnnouncementCard
          announcement={ann}
          onPress={() => navigation.navigate('AnnouncementDetail', { announcement: ann })}
          onPressComment={() => navigation.navigate('AnnouncementDetail', { announcement: ann, focusComment: true })}
          onToggleLike={() => handleToggleLike(ann.id)}
        />
      )}
    />
  );
}

const makeStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: 40 },
  header: { marginBottom: spacing.md },
  greeting: { fontSize: font.sm, color: colors.textMuted, marginBottom: 2 },
  title: { fontSize: font.xxxl, fontWeight: '700', color: colors.text },
  emptyBox: { alignItems: 'center', marginTop: 60, gap: spacing.md },
  emptyText: { fontSize: font.md, color: colors.textMuted },
});
