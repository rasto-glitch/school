import { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BookOpen } from 'lucide-react-native';
import { parentApi } from '../../services/api';
import { colors, spacing, radius, shadow, font } from '../../theme';
import type { Homework } from '../../types';

export default function HomeworkScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [homework, setHomework] = useState<Homework[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = () => parentApi.getHomework().then(r => setHomework(r.data || []));

  useEffect(() => { load().finally(() => setLoading(false)); }, []);

  const onRefresh = () => { setRefreshing(true); load().finally(() => setRefreshing(false)); };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <View style={styles.header}>
        <Text style={styles.title}>{t('homework.title')}</Text>
        <Text style={styles.subtitle}>{t('homework.subtitle')}</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : homework.length === 0 ? (
        <View style={styles.emptyBox}>
          <BookOpen size={40} color={colors.textMuted} />
          <Text style={styles.emptyText}>{t('homework.no_homework')}</Text>
        </View>
      ) : (
        homework.map(item => (
          <View key={item.id} style={styles.card}>
            <View style={styles.topRow}>
              <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
              {item.subject && (
                <View style={styles.pill}><Text style={styles.pillText}>{item.subject}</Text></View>
              )}
            </View>
            {item.classes?.name && <Text style={styles.meta}>{item.classes.name}</Text>}
            {item.description && <Text style={styles.desc} numberOfLines={3}>{item.description}</Text>}
            {item.dueDate && (
              <View style={styles.dueRow}>
                <Text style={styles.due}>{t('homework.due', { date: new Date(item.dueDate).toLocaleDateString() })}</Text>
              </View>
            )}
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: 40 },
  header: { marginBottom: spacing.lg },
  title: { fontSize: font.xxl, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: font.sm, color: colors.textMuted, marginTop: 2 },
  emptyBox: { alignItems: 'center', marginTop: 60, gap: spacing.md },
  emptyText: { fontSize: font.md, color: colors.textMuted },
  card: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, ...shadow.sm },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm, marginBottom: 6 },
  cardTitle: { flex: 1, fontSize: font.md, fontWeight: '600', color: colors.text },
  pill: { backgroundColor: colors.primaryLight, borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 3 },
  pillText: { fontSize: font.xs, fontWeight: '700', color: colors.primary },
  meta: { fontSize: font.xs, color: colors.textMuted, marginBottom: 6 },
  desc: { fontSize: font.sm, color: colors.textSecondary, lineHeight: 19 },
  dueRow: { marginTop: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 },
  due: { fontSize: font.xs, color: colors.warning, fontWeight: '700' },
});
