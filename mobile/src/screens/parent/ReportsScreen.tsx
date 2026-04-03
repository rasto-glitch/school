import { useState, useMemo, useRef, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native';
import { CardListSkeleton } from '../../components/Skeleton';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { FileText, ChevronRight } from 'lucide-react-native';
import { parentApi } from '../../services/api';
import { useColors } from '../../store/themeStore';
import { useBadgeStore } from '../../store/badgeStore';
import { spacing, radius, font, shadow } from '../../theme';

export interface Report {
  id: string;
  subject: string;
  attendanceNotes?: string;
  behaviorNotes?: string;
  teacherNotes?: string;
  quizMarks?: number;
  examMarks?: number;
  reportDate?: string;
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

  const clearReport = useBadgeStore(s => s.clearReport);
  const setUnreadCount = useBadgeStore(s => s.setUnreadCount);
  const initialized = useRef(false);

  const load = () => parentApi.getReports().then(r => setReports(r.data || []));

  useFocusEffect(
    useCallback(() => {
      if (!initialized.current) {
        initialized.current = true;
        load().finally(() => setLoading(false));
      } else {
        load();
      }
      clearReport();
      parentApi.markTypeRead('report').catch(() => {});
      parentApi.getUnreadCount().then(r => setUnreadCount(r.data?.count ?? 0)).catch(() => {});
    }, [])
  );

  const onRefresh = () => { setRefreshing(true); load().finally(() => setRefreshing(false)); };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md, paddingBottom: 40 }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      {loading ? (
        <CardListSkeleton count={4} />
      ) : reports.length === 0 ? (
        <View style={styles.empty}>
          <FileText size={40} color={colors.textMuted} />
          <Text style={styles.emptyText}>{t('reports.no_reports')}</Text>
        </View>
      ) : (
        reports.map(r => {
          const preview = r.teacherNotes || r.behaviorNotes || r.attendanceNotes;
          const dateStr = r.reportDate
            ? new Date(r.reportDate).toLocaleDateString()
            : new Date(r.createdAt).toLocaleDateString();
          return (
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
                  <Text style={styles.title}>{r.subject}</Text>
                  {r.students?.fullName && <Text style={styles.student}>{r.students.fullName}</Text>}
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Text style={styles.date}>{dateStr}</Text>
                  <ChevronRight size={16} color={colors.textMuted} />
                </View>
              </View>

              {preview && (
                <Text style={styles.preview} numberOfLines={2}>{preview}</Text>
              )}

              {r.teachers?.fullName && (
                <Text style={styles.teacher}>{t('reports.by_teacher', { name: r.teachers.fullName })}</Text>
              )}
            </TouchableOpacity>
          );
        })
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
  preview: { fontSize: font.sm, color: colors.textSecondary, lineHeight: 20, marginBottom: spacing.xs },
  teacher: { fontSize: font.xs, color: colors.textMuted },
});
