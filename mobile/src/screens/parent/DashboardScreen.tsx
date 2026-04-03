import { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { DashboardSkeleton } from '../../components/Skeleton';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../store/authStore';
import { parentApi } from '../../services/api';
import type { Homework, Announcement } from '../../types';

export default function DashboardScreen() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const [homework, setHomework] = useState<Homework[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      parentApi.getHomework(),
      parentApi.getAnnouncements(),
    ]).then(([hw, ann]) => {
      setHomework((hw.data || []).slice(0, 3));
      setAnnouncements((ann.data || []).slice(0, 3));
    }).finally(() => setLoading(false));
  }, []);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('dashboard.title')}</Text>
        <Text style={styles.subtitle}>{t('dashboard.subtitle', { name: user?.firstName })}</Text>
      </View>

      {loading ? (
        <DashboardSkeleton />
      ) : (
        <>
          <Text style={styles.sectionTitle}>{t('dashboard.latest_activity')}</Text>

          {announcements.length === 0 && homework.length === 0 ? (
            <Text style={styles.empty}>{t('dashboard.no_activity')}</Text>
          ) : null}

          {announcements.map(item => (
            <View key={item.id} style={styles.card}>
              <View style={[styles.badge, { backgroundColor: '#DBEAFE' }]}>
                <Text style={[styles.badgeText, { color: '#1D4ED8' }]}>{t('dashboard.badge_announcement')}</Text>
              </View>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.cardDesc} numberOfLines={2}>{item.content}</Text>
            </View>
          ))}

          {homework.map(item => (
            <View key={item.id} style={styles.card}>
              <View style={[styles.badge, { backgroundColor: '#FEF3C7' }]}>
                <Text style={[styles.badgeText, { color: '#92400E' }]}>{t('dashboard.badge_homework')}</Text>
              </View>
              <Text style={styles.cardTitle}>{item.title}</Text>
              {item.subject && <Text style={styles.cardDesc}>{item.subject}</Text>}
              {item.dueDate && (
                <Text style={styles.cardMeta}>{t('homework.due', { date: new Date(item.dueDate).toLocaleDateString() })}</Text>
              )}
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3F4F6' },
  content: { padding: 20, paddingBottom: 40 },
  header: { marginBottom: 24 },
  title: { fontSize: 24, fontWeight: '700', color: '#111827' },
  subtitle: { fontSize: 14, color: '#6B7280', marginTop: 2 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#374151', marginBottom: 12 },
  empty: { color: '#9CA3AF', fontSize: 14, textAlign: 'center', marginTop: 24 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  badge: { alignSelf: 'flex-start', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3, marginBottom: 8 },
  badgeText: { fontSize: 11, fontWeight: '600' },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#111827', marginBottom: 4 },
  cardDesc: { fontSize: 13, color: '#6B7280' },
  cardMeta: { fontSize: 12, color: '#9CA3AF', marginTop: 4 },
});
