import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  RefreshControl, TouchableOpacity, Alert,
} from 'react-native';
import { CardListSkeleton } from '../../components/Skeleton';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CheckCircle, XCircle, ChevronDown, ChevronUp, PlayCircle, StopCircle, ChevronLeft, ChevronRight, X } from 'lucide-react-native';
import { supervisorApi } from '../../services/api';
import { useColors } from '../../store/themeStore';
import { spacing, radius, font, shadow } from '../../theme';
import { format, parseISO, startOfWeek, addWeeks, subWeeks } from 'date-fns';

interface Period {
  id: string;
  weekStartDate: string;
  weekEndDate: string;
  isOpen: boolean;
}

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

  const [period, setPeriod] = useState<Period | null | undefined>(undefined);
  const [openStart, setOpenStart] = useState('');
  const [openEnd, setOpenEnd] = useState('');
  const [periodLoading, setPeriodLoading] = useState(false);
  const [showStartCal, setShowStartCal] = useState(false);
  const [showEndCal, setShowEndCal] = useState(false);
  const [startCalView, setStartCalView] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [endCalView, setEndCalView] = useState(() => { const d = new Date(); d.setDate(1); return d; });

  const [weekStart, setWeekStart] = useState(startOfWeek(new Date()));
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [statusList, setStatusList] = useState<TeacherStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedClass, setExpandedClass] = useState<string | null>(null);

  const weekStr = format(weekStart, 'yyyy-MM-dd');

  // Load active period
  useEffect(() => {
    supervisorApi.getActivePeriod().then(r => {
      const p = r.data ?? null;
      setPeriod(p);
      if (p?.weekStartDate) setWeekStart(parseISO(p.weekStartDate));
    });
  }, []);

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

  const handleOpenPeriod = async () => {
    if (!openStart || !openEnd) { Alert.alert('Missing dates', 'Enter both start and end dates (YYYY-MM-DD)'); return; }
    if (openEnd < openStart) { Alert.alert('Invalid', 'End date must be after start date'); return; }
    setPeriodLoading(true);
    try {
      const res = await supervisorApi.openPeriod(openStart, openEnd);
      const p: Period = res.data;
      setPeriod(p);
      setWeekStart(parseISO(p.weekStartDate));
      setOpenStart('');
      setOpenEnd('');
    } catch {
      Alert.alert('Error', 'Failed to open period');
    } finally {
      setPeriodLoading(false);
    }
  };

  const handleClosePeriod = () => {
    Alert.alert('Close Period', 'Teachers will no longer be able to submit. Continue?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Close', style: 'destructive', onPress: async () => {
          setPeriodLoading(true);
          try {
            await supervisorApi.closePeriod();
            setPeriod(null);
          } catch {
            Alert.alert('Error', 'Failed to close period');
          } finally {
            setPeriodLoading(false);
          }
        },
      },
    ]);
  };

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

      {/* ── Active Period Card ── */}
      <View style={styles.periodCard}>
        <Text style={styles.periodLabel}>Submission Period</Text>
        {period === undefined ? (
          <ActivityIndicator color={colors.primary} size="small" />
        ) : period ? (
          <View style={styles.periodOpen}>
            <View style={{ flex: 1 }}>
              <View style={styles.openBadge}>
                <View style={[styles.dot, { backgroundColor: colors.success }]} />
                <Text style={[styles.openBadgeText, { color: colors.success }]}>Open</Text>
              </View>
              <Text style={styles.periodDates}>
                {format(parseISO(period.weekStartDate), 'MMM d')} — {format(parseISO(period.weekEndDate), 'MMM d, yyyy')}
              </Text>
              <Text style={styles.periodSub}>Teachers can submit their weekly summary</Text>
            </View>
            <TouchableOpacity onPress={handleClosePeriod} disabled={periodLoading} style={styles.closeBtn}>
              {periodLoading
                ? <ActivityIndicator color={colors.danger} size="small" />
                : <><StopCircle size={16} color={colors.danger} /><Text style={[styles.closeBtnText, { color: colors.danger }]}>Close</Text></>}
            </TouchableOpacity>
          </View>
        ) : (
          <View>
            <Text style={styles.noPeriodText}>No active period. Select dates to open one.</Text>

            <Text style={styles.inputLabel}>Start Date</Text>
            <TouchableOpacity style={styles.datePickerBtn} onPress={() => setShowStartCal(v => !v)} activeOpacity={0.7}>
              <Text style={[styles.datePickerText, !openStart && { color: colors.textMuted }]}>
                {openStart ? new Date(openStart + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : 'Select start date'}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {openStart ? <TouchableOpacity onPress={() => { setOpenStart(''); setShowStartCal(false); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><X size={14} color={colors.textMuted} /></TouchableOpacity> : null}
                <ChevronRight size={14} color={colors.textMuted} style={{ transform: [{ rotate: showStartCal ? '90deg' : '0deg' }] }} />
              </View>
            </TouchableOpacity>
            {showStartCal && (() => {
              const yr = startCalView.getFullYear(), mo = startCalView.getMonth();
              const fd = new Date(yr, mo, 1).getDay();
              const dim = new Date(yr, mo + 1, 0).getDate();
              const cells: (number | null)[] = [...Array(fd).fill(null), ...Array.from({ length: dim }, (_, i) => i + 1)];
              while (cells.length % 7 !== 0) cells.push(null);
              return (
                <View style={styles.calBox}>
                  <View style={styles.calHeader}>
                    <TouchableOpacity onPress={() => setStartCalView(new Date(yr, mo - 1, 1))} style={styles.calNav}><ChevronLeft size={16} color={colors.text} /></TouchableOpacity>
                    <Text style={styles.calMonthText}>{startCalView.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</Text>
                    <TouchableOpacity onPress={() => setStartCalView(new Date(yr, mo + 1, 1))} style={styles.calNav}><ChevronRight size={16} color={colors.text} /></TouchableOpacity>
                  </View>
                  <View style={styles.calDayRow}>{['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => <Text key={d} style={styles.calDayLabel}>{d}</Text>)}</View>
                  {Array.from({ length: cells.length / 7 }, (_, row) => (
                    <View key={row} style={styles.calWeekRow}>
                      {cells.slice(row * 7, row * 7 + 7).map((day, col) => {
                        if (!day) return <View key={col} style={styles.calCell} />;
                        const iso = `${yr}-${String(mo + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                        const sel = openStart === iso;
                        return (
                          <TouchableOpacity key={col} style={[styles.calCell, sel && styles.calCellSel]} onPress={() => { setOpenStart(iso); setShowStartCal(false); }}>
                            <Text style={[styles.calDayNum, sel && styles.calDayNumSel]}>{day}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  ))}
                </View>
              );
            })()}

            <Text style={[styles.inputLabel, { marginTop: spacing.sm }]}>End Date</Text>
            <TouchableOpacity style={styles.datePickerBtn} onPress={() => setShowEndCal(v => !v)} activeOpacity={0.7}>
              <Text style={[styles.datePickerText, !openEnd && { color: colors.textMuted }]}>
                {openEnd ? new Date(openEnd + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : 'Select end date'}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {openEnd ? <TouchableOpacity onPress={() => { setOpenEnd(''); setShowEndCal(false); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><X size={14} color={colors.textMuted} /></TouchableOpacity> : null}
                <ChevronRight size={14} color={colors.textMuted} style={{ transform: [{ rotate: showEndCal ? '90deg' : '0deg' }] }} />
              </View>
            </TouchableOpacity>
            {showEndCal && (() => {
              const yr = endCalView.getFullYear(), mo = endCalView.getMonth();
              const fd = new Date(yr, mo, 1).getDay();
              const dim = new Date(yr, mo + 1, 0).getDate();
              const cells: (number | null)[] = [...Array(fd).fill(null), ...Array.from({ length: dim }, (_, i) => i + 1)];
              while (cells.length % 7 !== 0) cells.push(null);
              return (
                <View style={styles.calBox}>
                  <View style={styles.calHeader}>
                    <TouchableOpacity onPress={() => setEndCalView(new Date(yr, mo - 1, 1))} style={styles.calNav}><ChevronLeft size={16} color={colors.text} /></TouchableOpacity>
                    <Text style={styles.calMonthText}>{endCalView.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</Text>
                    <TouchableOpacity onPress={() => setEndCalView(new Date(yr, mo + 1, 1))} style={styles.calNav}><ChevronRight size={16} color={colors.text} /></TouchableOpacity>
                  </View>
                  <View style={styles.calDayRow}>{['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => <Text key={d} style={styles.calDayLabel}>{d}</Text>)}</View>
                  {Array.from({ length: cells.length / 7 }, (_, row) => (
                    <View key={row} style={styles.calWeekRow}>
                      {cells.slice(row * 7, row * 7 + 7).map((day, col) => {
                        if (!day) return <View key={col} style={styles.calCell} />;
                        const iso = `${yr}-${String(mo + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                        const sel = openEnd === iso;
                        return (
                          <TouchableOpacity key={col} style={[styles.calCell, sel && styles.calCellSel]} onPress={() => { setOpenEnd(iso); setShowEndCal(false); }}>
                            <Text style={[styles.calDayNum, sel && styles.calDayNumSel]}>{day}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  ))}
                </View>
              );
            })()}

            <TouchableOpacity onPress={handleOpenPeriod} disabled={periodLoading || !openStart || !openEnd} style={[styles.openPeriodBtn, { backgroundColor: (!openStart || !openEnd) ? colors.textMuted : colors.primary }]}>
              {periodLoading
                ? <ActivityIndicator color="#fff" size="small" />
                : <><PlayCircle size={16} color="#fff" /><Text style={styles.openBtnText}>Open Period</Text></>}
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* ── Week navigator (for viewing history) ── */}
      <View style={styles.weekNav}>
        <TouchableOpacity onPress={() => setWeekStart((w: Date) => subWeeks(w, 1))} style={styles.weekBtn}>
          <ChevronDown size={18} color={colors.primary} />
        </TouchableOpacity>
        <Text style={styles.weekLabel}>Week of {format(weekStart, 'MMM d, yyyy')}</Text>
        <TouchableOpacity onPress={() => setWeekStart((w: Date) => addWeeks(w, 1))} style={styles.weekBtn}>
          <ChevronUp size={18} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {/* ── Submission status ── */}
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

      {/* ── Summaries ── */}
      {loading ? (
        <CardListSkeleton count={4} />
      ) : summaries.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>No summaries submitted for this week.</Text>
        </View>
      ) : (
        Object.entries(byClass).map(([classId, { name, rows }]) => {
          const expanded = expandedClass === classId;
          return (
            <View key={classId} style={styles.classCard}>
              <TouchableOpacity style={styles.classHeader} onPress={() => setExpandedClass(expanded ? null : classId)}>
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
  // Period card
  periodCard: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md, ...shadow.sm },
  periodLabel: { fontSize: font.xs, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm },
  periodOpen: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  openBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  openBadgeText: { fontSize: font.xs, fontWeight: '700' },
  periodDates: { fontSize: font.md, fontWeight: '700', color: colors.text },
  periodSub: { fontSize: font.xs, color: colors.textMuted, marginTop: 2 },
  closeBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: colors.dangerLight, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 6 },
  closeBtnText: { fontSize: font.xs, fontWeight: '700' },
  noPeriodText: { fontSize: font.sm, color: colors.textMuted, marginBottom: spacing.sm },
  inputLabel: { fontSize: font.xs, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.xs },
  datePickerBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.bg, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border },
  datePickerText: { fontSize: font.sm, fontWeight: '600', color: colors.text },
  calBox: { backgroundColor: colors.bg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.sm, marginBottom: spacing.sm },
  calHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  calNav: { padding: 6 },
  calMonthText: { fontSize: font.sm, fontWeight: '700', color: colors.text },
  calDayRow: { flexDirection: 'row', marginBottom: 4 },
  calDayLabel: { flex: 1, textAlign: 'center', fontSize: 10, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase' },
  calWeekRow: { flexDirection: 'row' },
  calCell: { flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  calCellSel: { backgroundColor: colors.primary },
  calDayNum: { fontSize: font.sm, color: colors.text },
  calDayNumSel: { color: '#fff', fontWeight: '700' },
  openPeriodBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm },
  openBtnText: { color: '#fff', fontSize: font.md, fontWeight: '700' },
  // Week nav
  weekNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.card, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, marginBottom: spacing.md, ...shadow.sm },
  weekBtn: { padding: spacing.sm },
  weekLabel: { fontSize: font.sm, fontWeight: '600', color: colors.text },
  // Status
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
  // Summaries
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
