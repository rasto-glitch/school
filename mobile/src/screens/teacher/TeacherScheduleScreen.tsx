import { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Calendar, Coffee } from 'lucide-react-native';
import { teacherApi } from '../../services/api';
import { useColors } from '../../store/themeStore';
import { spacing, radius, font, shadow } from '../../theme';

const DAY_NAMES = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'] as const;
const DAY_INDEX: Record<string, number> = Object.fromEntries(DAY_NAMES.map((d, i) => [d, i]));

interface Slot { kind: 'lesson' | 'break'; index?: number; label?: string; start: string; end: string }
interface Cell { dayOfWeek: number; periodIndex: number; className?: string | null; subjectName?: string | null; roomName?: string | null }
type ViewMode = 'week' | 'today';

export default function TeacherScheduleScreen() {
  const { t } = useTranslation();
  const dayLabel = (d: string) => t(`common.days.${d}`);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [skeleton, setSkeleton] = useState<Slot[]>([]);
  const [scheduleDays, setScheduleDays] = useState<string[]>([]);
  const [cells, setCells] = useState<Cell[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>('week');

  useEffect(() => {
    teacherApi.getSchedule()
      .then(r => {
        setSkeleton(r.data?.skeleton ?? []);
        setScheduleDays(r.data?.scheduleDays ?? []);
        setCells(r.data?.assignments ?? []);
      })
      .finally(() => setLoading(false));
  }, []);

  const orderedDays = useMemo(() =>
    [...scheduleDays].sort((a, b) => (DAY_INDEX[a] ?? 99) - (DAY_INDEX[b] ?? 99)),
  [scheduleDays]);

  const columns = useMemo(() => {
    let p = 0;
    return skeleton.map((s, i) => s.kind === 'lesson'
      ? { key: `c${i}`, kind: 'lesson' as const, period: ++p, start: s.start, end: s.end }
      : { key: `c${i}`, kind: 'break' as const, label: s.label || t('schedule2.break', 'Break'), start: s.start, end: s.end });
  }, [skeleton, t]);

  const todayName = DAY_NAMES[new Date().getDay()];
  const todayIsScheduled = orderedDays.includes(todayName);
  const visibleDays = view === 'today' && todayIsScheduled ? [todayName] : orderedDays;

  const cellMap = useMemo(() => {
    const m = new Map<string, Cell>();
    for (const c of cells) m.set(`${c.dayOfWeek}:${c.periodIndex}`, c);
    return m;
  }, [cells]);

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Toggle */}
      <View style={styles.toggle}>
        <TouchableOpacity
          onPress={() => setView('week')}
          style={[styles.toggleBtn, view === 'week' && styles.toggleBtnActive]}
        >
          <Text style={[styles.toggleText, view === 'week' && styles.toggleTextActive]}>{t('schedule.whole_week')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setView('today')}
          style={[styles.toggleBtn, view === 'today' && styles.toggleBtnActive]}
        >
          <Text style={[styles.toggleText, view === 'today' && styles.toggleTextActive]}>{t('common.today')}</Text>
        </TouchableOpacity>
      </View>

      {view === 'today' && !todayIsScheduled ? (
        <View style={styles.empty}>
          <Calendar size={20} color={colors.textMuted} />
          <Text style={styles.emptyText}>{t('schedule.no_classes_today', { day: dayLabel(todayName) })}</Text>
        </View>
      ) : visibleDays.length === 0 || cells.length === 0 ? (
        <View style={styles.empty}>
          <Calendar size={20} color={colors.textMuted} />
          <Text style={styles.emptyText}>{t('schedule.none_setup')}</Text>
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.table}>
            {/* Header row */}
            <View style={styles.row}>
              <View style={[styles.cell, styles.headerCell, styles.dayCol]}>
                <Text style={styles.headerText}>{t('common.day')}</Text>
              </View>
              {columns.map(col => col.kind === 'break' ? (
                <View key={col.key} style={[styles.cell, styles.headerCell, styles.breakCell]}>
                  <Coffee size={12} color={colors.warning} />
                </View>
              ) : (
                <View key={col.key} style={[styles.cell, styles.headerCell]}>
                  <Text style={styles.headerText}>{t('schedule.period_short', { n: col.period })}</Text>
                  <Text style={styles.timeText}>{col.start}</Text>
                </View>
              ))}
            </View>

            {visibleDays.map(day => {
              const dayIdx = DAY_INDEX[day];
              return (
                <View key={day} style={styles.row}>
                  <View style={[styles.cell, styles.dayCell, styles.dayCol]}>
                    <Text style={styles.dayText}>{dayLabel(day)}</Text>
                  </View>
                  {columns.map(col => {
                    if (col.kind === 'break') return <View key={col.key} style={[styles.cell, styles.breakCell]} />;
                    const cell = cellMap.get(`${dayIdx}:${col.period}`);
                    return (
                      <View key={col.key} style={styles.cell}>
                        {cell?.className ? (
                          <>
                            <Text style={styles.classText}>{cell.className}</Text>
                            {(cell.subjectName || cell.roomName) && (
                              <Text style={styles.subText}>{[cell.subjectName, cell.roomName].filter(Boolean).join(' · ')}</Text>
                            )}
                          </>
                        ) : (
                          <Text style={styles.emptyCellText}>—</Text>
                        )}
                      </View>
                    );
                  })}
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}
    </ScrollView>
  );
}

const makeStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: 40 },
  center: { alignItems: 'center', justifyContent: 'center' },

  toggle: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: radius.md, padding: 4, marginBottom: spacing.md, alignSelf: 'flex-start', ...shadow.sm },
  toggleBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.sm },
  toggleBtnActive: { backgroundColor: colors.primary },
  toggleText: { fontSize: font.xs, fontWeight: '700', color: colors.textMuted },
  toggleTextActive: { color: '#fff' },

  empty: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, ...shadow.sm },
  emptyText: { fontSize: font.sm, color: colors.textMuted, flex: 1 },

  table: { borderRadius: radius.md, overflow: 'hidden', ...shadow.sm },
  row: { flexDirection: 'row' },
  cell: {
    minWidth: 70, paddingHorizontal: 8, paddingVertical: 10,
    backgroundColor: colors.card,
    borderRightWidth: 1, borderBottomWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  dayCol: { minWidth: 100 },
  headerCell: { backgroundColor: colors.primaryLight },
  headerText: { fontSize: font.xs, fontWeight: '700', color: colors.primary },
  timeText: { fontSize: 9, color: colors.textMuted, marginTop: 1 },
  breakCell: { backgroundColor: colors.warningLight, minWidth: 44 },
  dayCell: { backgroundColor: colors.bg },
  dayText: { fontSize: font.sm, fontWeight: '700', color: colors.text },
  classText: { fontSize: font.sm, fontWeight: '600', color: colors.primary },
  subText: { fontSize: 9, color: colors.textMuted, marginTop: 1, textAlign: 'center' },
  emptyCellText: { fontSize: font.sm, color: colors.textMuted },
});
