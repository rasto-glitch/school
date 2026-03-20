import { useEffect, useState, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, RefreshControl, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { FileText, ChevronRight } from 'lucide-react-native';
import { parentApi } from '../../services/api';
import { useColors } from '../../store/themeStore';
import { spacing, radius, font, shadow } from '../../theme';

interface Report {
  id: string;
  title?: string;
  content?: string;
  subject?: string;
  createdAt: string;
  students?: { fullName: string };
  teachers?: { fullName: string };
}

export default function ReportsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = () => parentApi.getReports().then(r => setReports(r.data || []));

  useEffect(() => { load().finally(() => setLoading(false)); }, []);
  const onRefresh = () => { setRefreshing(true); load().finally(() => setRefreshing(false)); };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md, paddingBottom: 40 }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : reports.length === 0 ? (
        <View style={styles.empty}>
          <FileText size={40} color={colors.textMuted} />
          <Text style={styles.emptyText}>{t('reports.no_reports', 'No reports yet')}</Text>
        </View>
      ) : (
        reports.map(r => (
          <TouchableOpacity
            key={r.id}
            style={styles.card}
            onPress={() => navigation.navigate('ReportDetail', { report: r })}
            activeOpacity={0.8}
          >
            <View style={styles.cardTop}>
              <View style={styles.iconBox}>
                <FileText size={18} color="#9333EA" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{r.title || 'Report'}</Text>
                {r.students?.fullName && <Text style={styles.student}>{r.students.fullName}</Text>}
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Text style={styles.date}>{new Date(r.createdAt).toLocaleDateString()}</Text>
                <ChevronRight size={16} color={colors.textMuted} />
              </View>
            </View>

            {r.content && (
              <Text style={styles.preview} numberOfLines={2}>{r.content}</Text>
            )}

            <View style={styles.footer}>
              {r.subject && <View style={styles.tag}><Text style={styles.tagText}>{r.subject}</Text></View>}
              {r.teachers?.fullName && <Text style={styles.teacher}>By {r.teachers.fullName}</Text>}
            </View>
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
  );
}

const makeStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md },
  empty: { alignItems: 'center', marginTop: 80, gap: spacing.md },
  emptyText: { fontSize: font.md, color: colors.textMuted },
  card: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, ...shadow.sm },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginBottom: spacing.sm },
  iconBox: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: '#FAF5FF', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: font.md, fontWeight: '700', color: colors.text },
  student: { fontSize: font.xs, color: colors.textMuted, marginTop: 2 },
  date: { fontSize: font.xs, color: colors.textMuted },
  preview: { fontSize: font.sm, color: colors.textSecondary, lineHeight: 20, marginBottom: spacing.sm },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tag: { backgroundColor: '#F3E8FF', borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  tagText: { fontSize: font.xs, color: '#7C3AED', fontWeight: '600' },
  teacher: { fontSize: font.xs, color: colors.textMuted },
});
