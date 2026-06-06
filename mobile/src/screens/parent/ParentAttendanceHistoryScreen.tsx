// Parent-facing per-year attendance history (mobile counterpart of
// ParentAttendanceHistoryPage on the web — closes audit finding HD-6).
//
// Reads the same endpoint as the web: /parent/children/:id/attendance-history.
// Archive-gated server-side: the endpoint returns 403 when the school
// doesn't have the archive feature. We surface that as an info banner
// rather than a hard error so the screen doesn't look broken.
//
// Per-year detail (day-by-day calendar) is intentionally out of scope for
// v1 mobile — the year totals + status + class is enough for a parent to
// catch a problem; tapping into days can come later if asked.

import { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CalendarDays } from 'lucide-react-native';
import { parentApi } from '../../services/api';
import { useColors } from '../../store/themeStore';
import { spacing, radius, font, shadow } from '../../theme';
import type { Student } from '../../types';

interface AttendanceTotals { present: number; absent: number; late: number; excused: number }
interface HistoryYear {
  academicYear: string;
  gradeLevel: string;
  classId: string | null;
  className: string | null;
  status: string;
  startedOn: string;
  endedOn: string | null;
  totals: AttendanceTotals;
  frozen: boolean;
}

export default function ParentAttendanceHistoryScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [children, setChildren] = useState<Student[]>([]);
  const [selectedChild, setSelectedChild] = useState('');
  const [years, setYears] = useState<HistoryYear[]>([]);
  const [loading, setLoading] = useState(false);
  // 'archive_off' means the server returned 403 because the school
  // doesn't keep historical records. Other errors fall through as generic.
  const [error, setError] = useState<'archive_off' | 'generic' | null>(null);

  useEffect(() => {
    parentApi.getChildren().then(r => {
      const list: Student[] = r.data ?? [];
      setChildren(list);
      if (list.length === 1) setSelectedChild(list[0].id);
    }).catch(() => setError('generic'));
  }, []);

  useEffect(() => {
    if (!selectedChild) { setYears([]); setError(null); return; }
    setLoading(true);
    setError(null);
    parentApi.getChildAttendanceHistory(selectedChild)
      .then(r => setYears(r.data?.years ?? []))
      .catch((err: any) => {
        setError(err?.response?.status === 403 ? 'archive_off' : 'generic');
        setYears([]);
      })
      .finally(() => setLoading(false));
  }, [selectedChild]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md, paddingBottom: 40 }]}
    >
      <View style={styles.header}>
        <Text style={styles.title}>{t('attendance_history.parent_title')}</Text>
        <Text style={styles.subtitle}>{t('attendance_history.parent_subtitle')}</Text>
      </View>

      {children.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }}>
          {children.map(c => (
            <TouchableOpacity
              key={c.id}
              style={[styles.chip, selectedChild === c.id && styles.chipActive]}
              onPress={() => setSelectedChild(c.id)}
            >
              <Text style={[styles.chipText, selectedChild === c.id && styles.chipTextActive]}>{c.fullName}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {!selectedChild ? (
        <View style={styles.emptyBox}>
          <CalendarDays size={36} color={colors.textMuted} />
          <Text style={styles.emptyText}>{t('attendance_history.choose_child_prompt')}</Text>
        </View>
      ) : loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : error === 'archive_off' ? (
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>{t('attendance_history.archive_required_title')}</Text>
          <Text style={styles.infoBody}>{t('attendance_history.archive_required')}</Text>
        </View>
      ) : error === 'generic' ? (
        <View style={styles.infoCard}>
          <Text style={styles.infoBody}>{t('common.error')}</Text>
        </View>
      ) : years.length === 0 ? (
        <View style={styles.emptyBox}>
          <CalendarDays size={36} color={colors.textMuted} />
          <Text style={styles.emptyText}>{t('attendance_history.none')}</Text>
        </View>
      ) : (
        years.map(y => {
          const total = y.totals.present + y.totals.absent + y.totals.late + y.totals.excused;
          return (
            <View key={y.academicYear} style={styles.yearCard}>
              <View style={styles.yearHeader}>
                <Text style={styles.yearTitle}>{y.academicYear}</Text>
                <View style={styles.statusPill}>
                  <Text style={styles.statusPillText}>{t(`attendance_history.status_${y.status}`, y.status)}</Text>
                </View>
              </View>
              <Text style={styles.classLine}>
                {y.className || y.gradeLevel}
                {!y.frozen && (
                  <Text style={styles.liveBadge}>  · {t('attendance_history.live_count')}</Text>
                )}
              </Text>
              <View style={styles.totalsRow}>
                <Bucket label={t('attendance_history.present')} value={y.totals.present} color={colors.success} colors={colors} />
                <Bucket label={t('attendance_history.absent')} value={y.totals.absent} color={colors.danger} colors={colors} />
                <Bucket label={t('attendance_history.late')} value={y.totals.late} color={colors.warning} colors={colors} />
                <Bucket label={t('attendance_history.excused')} value={y.totals.excused} color={colors.primary} colors={colors} />
              </View>
              <Text style={styles.totalLine}>{t('attendance_history.total_days', { count: total })}</Text>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

function Bucket({ label, value, color, colors }: { label: string; value: number; color: string; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={{ fontSize: font.lg, fontWeight: '800', color }}>{value}</Text>
      <Text style={{ fontSize: font.xs, color: colors.textMuted, marginTop: 2 }}>{label}</Text>
    </View>
  );
}

const makeStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md },
  header: { marginBottom: spacing.md },
  title: { fontSize: font.xl, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: font.sm, color: colors.textMuted, marginTop: 2 },
  chip: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.full, paddingHorizontal: 14, paddingVertical: 8, marginRight: spacing.sm, backgroundColor: colors.card },
  chipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  chipText: { fontSize: font.sm, color: colors.textSecondary, fontWeight: '500' },
  chipTextActive: { color: colors.primary, fontWeight: '700' },
  emptyBox: { alignItems: 'center', marginTop: 60, gap: spacing.md },
  emptyText: { fontSize: font.md, color: colors.textMuted, textAlign: 'center', paddingHorizontal: spacing.lg },
  loadingBox: { alignItems: 'center', marginTop: 60 },
  infoCard: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, ...shadow.sm, marginTop: spacing.md },
  infoTitle: { fontSize: font.md, fontWeight: '700', color: colors.text, marginBottom: 4 },
  infoBody: { fontSize: font.sm, color: colors.textSecondary, lineHeight: 20 },
  yearCard: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, ...shadow.sm },
  yearHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  yearTitle: { fontSize: font.lg, fontWeight: '800', color: colors.text },
  statusPill: { backgroundColor: colors.primaryLight, paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.full },
  statusPillText: { fontSize: font.xs, fontWeight: '700', color: colors.primary },
  classLine: { fontSize: font.sm, color: colors.textSecondary, marginBottom: spacing.sm },
  liveBadge: { fontSize: font.xs, color: colors.textMuted, fontStyle: 'italic' },
  totalsRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, marginBottom: spacing.sm },
  totalLine: { fontSize: font.xs, color: colors.textMuted, textAlign: 'right' },
});
