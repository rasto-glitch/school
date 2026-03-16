import { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { parentApi } from '../../services/api';
import type { Announcement } from '../../types';

export default function AnnouncementsScreen() {
  const { t } = useTranslation();
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    parentApi.getAnnouncements()
      .then(r => setItems(r.data || []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('announcements.title')}</Text>
        <Text style={styles.subtitle}>{t('announcements.subtitle')}</Text>
      </View>

      {loading ? (
        <ActivityIndicator color="#4F46E5" style={{ marginTop: 40 }} />
      ) : items.length === 0 ? (
        <Text style={styles.empty}>{t('announcements.no_announcements')}</Text>
      ) : (
        items.map(item => (
          <View key={item.id} style={styles.card}>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.cardContent}>{item.content}</Text>
            <Text style={styles.cardDate}>{new Date(item.createdAt).toLocaleDateString()}</Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3F4F6' },
  content: { padding: 20, paddingBottom: 40 },
  header: { marginBottom: 20 },
  title: { fontSize: 22, fontWeight: '700', color: '#111827' },
  subtitle: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  empty: { textAlign: 'center', color: '#9CA3AF', marginTop: 40, fontSize: 14 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 8 },
  cardContent: { fontSize: 14, color: '#374151', lineHeight: 20 },
  cardDate: { fontSize: 11, color: '#9CA3AF', marginTop: 10 },
});
