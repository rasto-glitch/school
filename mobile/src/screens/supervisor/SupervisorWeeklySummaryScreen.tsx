import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  RefreshControl, TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CheckCircle, XCircle, ChevronDown, ChevronUp } from 'lucide-react-native';
import { supervisorApi } from '../../services/api';
import { useColors } from '../../store/themeStore';
import { spacing, radius, font, shadow } from '../../theme';
import { format, startOfWeek, addWeeks, subWeeks } from 'date-fns';

interface Summary {
  id: string;
  subject: string;
  unit?: string;
  lesson?: string;
  pages?: string;
  homeworkReminder?: string;
  classId: string;
  classes?: { name: string };
  teachers?: { fullName?: string };
}

interface TeacherStatus {
  id: string;
  fullName: string;
  subject?: string;
  submitted: boolean;
}

export default function SupervisorWeeklySummaryScreen({ embedded = false }: { embedded?: boolean }) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [weekStart, setWeekStart] = useState(startOfWeek(new Date()));
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [statusList, setStatusList] = useState<TeacherStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedClass, setExpandedClass] = useState<string | null>(null);

  const weekStr = format(weekStart, 'yyyy-MM-dd');

  const load = useCallback(async (week: string) => {
    const [sumRes, statRes] = await Promise.allSettled([
      supervisorApi.getWeeklySummaries({ weekStartDate: week }),
      supervisorApi.getWeeklySummaryStatus(week),
    ]);
    if (sumRes.status === 'fulfilled') setSummaries(sumRes.value.data || []);
    if (statRes.status === 'fulfilled') setStatusList(statRes.value.data || []);
  }, []);

  useEffect(() => { load(weekStr).finally(() => setLoading(false)); }, [weekStr]);

  const onRefresh = () => { setRefreshing(true); load(weekStr).finally(() => setRefreshing(false)); };

  // Group by class
  const byClass: Record<string, { name: string; rows: Summary[] }> = {};
  summaries.forEach(s => {
    const name = s.classes?.name || s.classId;
    if (!byClass[s.classId]) byClass[s.classId] = { name, rows: [] };
    byClass[s.classId].rows.push(s);
  });

  const submitted = statusList.filter(t => t.submitted).length;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: embedded ? spacing.md : insets.top + spacing.md }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      {!embedded && <Text style={styles.title}>Weekly Summary</Text>}

      {/* Week navigator */}
      <View style={styles.weekNav}>
        <TouchableOpacity onPress={() => setWeekStart((w: Date) => subWeeks(w, 1))} style={styles.weekBtn}>
          <ChevronDown size={18} color={colors.primary} />
        </TouchableOpacity>
        <Text style={styles.weekLabel}>
          Week of {format(weekStart, 'MMM d, yyyy')}
        </Text>
        <TouchableOpacity onPress={() => setWeekStart((w: Date) => addWeeks(w, 1))} style={styles.weekBtn}>
          <ChevronUp size={18} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {/* Submission status summary */}
      {statusList.length > 0 && (
        <View style={styles.statusCard}>
          <View style={styles.statusHeader}>
            <Text style={styles.statusTitle}>Submission Status</Text>
            <Text style={styles.statusCount}>{submitted}/{statusList.length} submitted</Text>
          </View>
          {statusList.map(t => (
            <View key={t.id} style={styles.statusRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.teacherName}>{t.fullName}</Text>
                {t.subject && <Text style={styles.teacherSubject}>{t.subject}</Text>}
              </View>
              {t.submitted
                ? <View style={styles.submittedBadge}><CheckCircle size={13} color={colors.success} /><Text style={[styles.badgeText, { color: colors.success }]}>Submitted</Text></View>
                : <View style={styles.missingBadge}><XCircle size={13} color={colors.danger} /><Text style={[styles.badgeText, { color: colors.danger }]}>Missing</Text></View>
              }
            </View>
          ))}
        </View>
      )}

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : summaries.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>No summaries submitted for this week.</Text>
        </View>
      ) : (
        Object.entries(byClass).map(([classId, { name, rows }]) => {
          const expanded = expandedClass === classId;
          return (
            <View key={classId} style={styles.classCard}>
              <TouchableOpacity
                style={styles.classHeader}
                onPress={() => setExpandedClass(expanded ? null : classId)}
              >
                <Text style={styles.className}>{name}</Text>
                <View style={styles.classHeaderRight}>
                  <Text style={styles.rowCount}>{rows.length} subject{rows.length !== 1 ? 's' : ''}</Text>
                  {expanded ? <ChevronUp size={16} color={colors.textMuted} /> : <ChevronDown size={16} color={colors.textMuted} />}
                </View>
              </TouchableOpacity>
              {expanded && rows.map(row => (
                <View key={row.id} style={styles.summaryRow}>
                  <View style={styles.subjectTag}>
                    <Text style={styles.subjectTagText}>{row.subject}</Text>
                  </View>
                  <View style={styles.summaryDetails}>
                    {row.unit && <Text style={styles.detailText}><Text style={styles.detailLabel}>Unit: </Text>{row.unit}</Text>}
                    {row.lesson && <Text style={styles.detailText}><Text style={styles.detailLabel}>Lesson: </Text>{row.lesson}</Text>}
                    {row.pages && <Text style={styles.detailText}><Text style={styles.detailLabel}>Pages: </Text>{row.pages}</Text>}
                    {row.homeworkReminder && <Text style={styles.detailText}><Text style={styles.detailLabel}>HW: </Text>{row.homeworkReminder}</Text>}
                    {row.teachers?.fullName && <Text style={styles.teacherTag}>{row.teachers.fullName}</Text>}
                  </View>
                </View>
              ))}
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const makeStyles = (colors: ReturnType<typeof import('../../store/themeStore').useColors>) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: 40 },
  title: { fontSize: font.xxxl, fontWeight: '800', color: colors.text, marginBottom: spacing.md },
  weekNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.card, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, marginBottom: spacing.md, ...shadow.sm },
  weekBtn: { padding: spacing.sm },
  weekLabel: { fontSize: font.sm, fontWeight: '600', color: colors.text },
  statusCard: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md, ...shadow.sm },
  statusHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
  statusTitle: { fontSize: font.sm, fontWeight: '700', color: colors.text },
  statusCount: { fontSize: font.sm, color: colors.textMuted },
  statusRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.borderLight },
  teacherName: { fontSize: font.sm, fontWeight: '600', color: colors.text },
  teacherSubject: { fontSize: font.xs, color: colors.textMuted, marginTop: 1 },
  submittedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.successLight, borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  missingBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.dangerLight, borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: font.xs, fontWeight: '700' },
  emptyCard: { alignItems: 'center', marginTop: 60 },
  emptyText: { fontSize: font.md, color: colors.textMuted },
  classCard: { backgroundColor: colors.card, borderRadius: radius.md, marginBottom: spacing.sm, overflow: 'hidden', ...shadow.sm },
  classHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md },
  className: { fontSize: font.md, fontWeight: '700', color: colors.text },
  classHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowCount: { fontSize: font.xs, color: colors.textMuted },
  summaryRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.borderLight, alignItems: 'flex-start' },
  subjectTag: { backgroundColor: colors.primaryLight, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 4, minWidth: 72, alignItems: 'center' },
  subjectTagText: { fontSize: font.xs, fontWeight: '700', color: colors.primary },
  summaryDetails: { flex: 1, gap: 2 },
  detailText: { fontSize: font.xs, color: colors.textSecondary },
  detailLabel: { fontWeight: '700', color: colors.text },
  teacherTag: { fontSize: font.xs, color: colors.textMuted, marginTop: 2, fontStyle: 'italic' },
});
