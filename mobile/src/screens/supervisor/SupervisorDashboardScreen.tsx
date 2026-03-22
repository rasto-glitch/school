import { useEffect, useState, useMemo, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, RefreshControl, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertCircle, Users, CheckCircle, Clock } from 'lucide-react-native';
import { supervisorApi } from '../../services/api';
import { useColors } from '../../store/themeStore';
import { spacing, radius, font, shadow } from '../../theme';

interface AbsentRecord {
  id: string;
  status: 'absent' | 'late';
  notes?: string;
  students?: { id: string; fullName: string; classes?: { name: string } };
  teachers?: { fullName: string };
}

interface ClassSummary {
  id: string;
  name: string;
  present: number;
  absent: number;
  late: number;
  total: number;
}

export default function SupervisorDashboardScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [absentList, setAbsentList] = useState<AbsentRecord[]>([]);
  const [summary, setSummary] = useState<ClassSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  const load = useCallback(async () => {
    const [ab, sm] = await Promise.allSettled([
      supervisorApi.getAbsentToday(),
      supervisorApi.getAttendanceSummary(),
    ]);
    if (ab.status === 'fulfilled') setAbsentList(ab.value.data || []);
    if (sm.status === 'fulfilled') setSummary((sm.value.data || []).filter((c: ClassSummary) => c.total > 0));
  }, []);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);

  const onRefresh = () => { setRefreshing(true); load().finally(() => setRefreshing(false)); };

  const totalAbsent = absentList.filter(r => r.status === 'absent').length;
  const totalLate = absentList.filter(r => r.status === 'late').length;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <Text style={styles.title}>Dashboard</Text>
      <Text style={styles.subtitle}>{today}</Text>

      {/* Stats row */}
      <View style={styles.statsRow}>
        <View style={[styles.statCard, { backgroundColor: colors.dangerLight }]}>
          <AlertCircle size={20} color={colors.danger} />
          <Text style={[styles.statNum, { color: colors.danger }]}>{totalAbsent}</Text>
          <Text style={[styles.statLabel, { color: colors.danger }]}>Absent</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: colors.warningLight }]}>
          <Clock size={20} color={colors.warning} />
          <Text style={[styles.statNum, { color: colors.warning }]}>{totalLate}</Text>
          <Text style={[styles.statLabel, { color: colors.warning }]}>Late</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: colors.successLight }]}>
          <Users size={20} color={colors.success} />
          <Text style={[styles.statNum, { color: colors.success }]}>{summary.reduce((a, c) => a + c.present, 0)}</Text>
          <Text style={[styles.statLabel, { color: colors.success }]}>Present</Text>
        </View>
      </View>

      {loading ? <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} /> : (
        <>
          {/* Absent / Late today */}
          <Text style={styles.sectionLabel}>Absent & Late Today</Text>
          {absentList.length === 0 ? (
            <View style={styles.emptyCard}>
              <CheckCircle size={28} color={colors.success} />
              <Text style={styles.emptyText}>All students present today</Text>
            </View>
          ) : (
            absentList.map(r => (
              <View key={r.id} style={styles.absentCard}>
                <View style={[styles.statusDot, { backgroundColor: r.status === 'absent' ? colors.danger : colors.warning }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.studentName}>{r.students?.fullName ?? '—'}</Text>
                  <Text style={styles.studentMeta}>
                    {r.students?.classes?.name ?? ''}
                    {r.teachers?.fullName ? ` · ${r.teachers.fullName}` : ''}
                  </Text>
                  {r.notes && <Text style={styles.noteText}>{r.notes}</Text>}
                </View>
                <View style={[styles.statusBadge, { backgroundColor: r.status === 'absent' ? colors.danger + '20' : colors.warning + '20' }]}>
                  <Text style={[styles.statusBadgeText, { color: r.status === 'absent' ? colors.danger : colors.warning }]}>
                    {r.status === 'absent' ? 'Absent' : 'Late'}
                  </Text>
                </View>
              </View>
            ))
          )}

          {/* Class summary */}
          {summary.length > 0 && (
            <>
              <Text style={[styles.sectionLabel, { marginTop: spacing.lg }]}>Attendance by Class</Text>
              {summary.map(cls => {
                const presentPct = cls.total > 0 ? cls.present / cls.total : 0;
                return (
                  <View key={cls.id} style={styles.summaryCard}>
                    <View style={styles.summaryTop}>
                      <Text style={styles.className}>{cls.name}</Text>
                      <Text style={styles.classTotal}>{cls.present}/{cls.total}</Text>
                    </View>
                    <View style={styles.barBg}>
                      <View style={[styles.barFill, { width: `${presentPct * 100}%` as any, backgroundColor: presentPct >= 0.8 ? colors.success : presentPct >= 0.6 ? colors.warning : colors.danger }]} />
                    </View>
                    <View style={styles.summaryRow}>
                      {cls.absent > 0 && <Text style={[styles.summaryChip, { color: colors.danger }]}>{cls.absent} absent</Text>}
                      {cls.late > 0 && <Text style={[styles.summaryChip, { color: colors.warning }]}>{cls.late} late</Text>}
                      {cls.present > 0 && <Text style={[styles.summaryChip, { color: colors.success }]}>{cls.present} present</Text>}
                    </View>
                  </View>
                );
              })}
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

const makeStyles = (colors: ReturnType<typeof import('../../store/themeStore').useColors>) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: 40 },
  title: { fontSize: font.xxxl, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: font.sm, color: colors.textMuted, marginTop: 2, marginBottom: spacing.md },
  statsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  statCard: { flex: 1, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', gap: 4 },
  statNum: { fontSize: font.xxl, fontWeight: '800' },
  statLabel: { fontSize: font.xs, fontWeight: '600' },
  sectionLabel: { fontSize: font.xs, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm },
  emptyCard: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.lg, alignItems: 'center', gap: spacing.sm, ...shadow.sm },
  emptyText: { fontSize: font.sm, color: colors.textMuted },
  absentCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.xs, ...shadow.sm },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  studentName: { fontSize: font.sm, fontWeight: '600', color: colors.text },
  studentMeta: { fontSize: font.xs, color: colors.textMuted, marginTop: 1 },
  noteText: { fontSize: font.xs, color: colors.textSecondary, marginTop: 2, fontStyle: 'italic' },
  statusBadge: { borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  statusBadgeText: { fontSize: 11, fontWeight: '700' },
  summaryCard: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.xs, ...shadow.sm },
  summaryTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
  className: { fontSize: font.sm, fontWeight: '600', color: colors.text },
  classTotal: { fontSize: font.sm, fontWeight: '700', color: colors.primary },
  barBg: { height: 6, backgroundColor: colors.border, borderRadius: 3, marginBottom: spacing.sm, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3 },
  summaryRow: { flexDirection: 'row', gap: spacing.md },
  summaryChip: { fontSize: font.xs, fontWeight: '600' },
});
