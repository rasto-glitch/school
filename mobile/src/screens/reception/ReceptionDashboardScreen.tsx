import { useState, useMemo, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Calendar, Clock, ChevronRight } from 'lucide-react-native';
import { receptionApi, announcementApi } from '../../services/api';
import { useColors } from '../../store/themeStore';
import { spacing, radius, font, shadow } from '../../theme';
import AnnouncementCard from '../../components/AnnouncementCard';
import type { Announcement } from '../../types';

export default function ReceptionDashboardScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const navigation = useNavigation<any>();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() =>
    Promise.allSettled([
      receptionApi.getPendingAppointmentCount(),
      announcementApi.getAnnouncements(),
    ]).then(([count, ann]) => {
      if (count.status === 'fulfilled') setPendingCount(count.value.data?.count ?? 0);
      if (ann.status === 'fulfilled') {
        const b = ann.value.data;
        setAnnouncements(Array.isArray(b) ? b : b?.data ?? []);
      }
    }),
  []);

  const handleToggleAnnouncementLike = async (id: string) => {
    setAnnouncements(prev => prev.map(a => a.id === id ? {
      ...a,
      likedByMe: !a.likedByMe,
      likesCount: (a.likesCount ?? 0) + (a.likedByMe ? -1 : 1),
    } : a));
    try { await announcementApi.toggleLike(id); } catch {}
  };

  // Refresh the pending count every time the tab regains focus so the badge
  // stays current after reception confirms/rejects from the Appointments tab.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = () => { setRefreshing(true); load().finally(() => setRefreshing(false)); };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md, paddingBottom: 40 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <Text style={styles.heading}>{t('reception.dashboard_title')}</Text>
        <Text style={styles.subheading}>{t('reception.dashboard_subtitle')}</Text>

        <TouchableOpacity style={styles.card} activeOpacity={0.85} onPress={() => navigation.navigate('ReceptionAppointments')}>
          <View style={[styles.iconWrap, { backgroundColor: colors.primaryLight }]}>
            <Calendar size={24} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardLabel}>{t('nav.appointments')}</Text>
            <Text style={styles.cardCount}>{pendingCount === null ? '—' : pendingCount}</Text>
            <Text style={styles.cardPending}>{t('reception.pending')}</Text>
          </View>
          <ChevronRight size={20} color={colors.textMuted} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.card} activeOpacity={0.85} onPress={() => navigation.navigate('ReceptionAppointments')}>
          <View style={[styles.iconWrap, { backgroundColor: '#FEF3C7' }]}>
            <Clock size={24} color="#D97706" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardLabel}>{t('reception.awaiting_response')}</Text>
            <Text style={styles.cardHint}>{t('reception.click_view')}</Text>
          </View>
          <ChevronRight size={20} color={colors.textMuted} />
        </TouchableOpacity>

        {/* Announcements feed (081): reception sees 'all' + admin-targeted posts. */}
        {announcements.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>{t('announcements.title', 'Announcements')}</Text>
            {announcements.map(ann => (
              <AnnouncementCard
                key={ann.id}
                announcement={ann}
                onPress={() => navigation.navigate('AnnouncementDetail', { announcement: ann })}
                onPressComment={() => navigation.navigate('AnnouncementDetail', { announcement: ann, focusComment: true })}
                onToggleLike={() => handleToggleAnnouncementLike(ann.id)}
              />
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors: ReturnType<typeof import('../../store/themeStore').useColors>) => StyleSheet.create({
  content: { paddingHorizontal: spacing.md },
  heading: { fontSize: font.xl, fontWeight: '800', color: colors.text },
  subheading: { fontSize: font.sm, color: colors.textMuted, marginTop: 2, marginBottom: spacing.lg },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.card, borderRadius: radius.md,
    padding: spacing.md, marginBottom: spacing.sm, ...shadow.sm,
  },
  iconWrap: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  cardLabel: { fontSize: font.sm, fontWeight: '600', color: colors.textMuted },
  cardCount: { fontSize: font.xxl, fontWeight: '800', color: colors.text },
  cardPending: { fontSize: font.xs, fontWeight: '600', color: '#D97706', marginTop: 2 },
  cardHint: { fontSize: font.xs, color: colors.textMuted, marginTop: 4 },
  sectionLabel: { fontSize: font.xs, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: spacing.md, marginBottom: spacing.sm },
});
