import { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Calendar } from 'lucide-react-native';
import { parentApi } from '../../services/api';
import { useColors, useIsDark } from '../../store/themeStore';
import { spacing, radius, font, shadow } from '../../theme';
import type { Student } from '../../types';

const DAY_NAMES = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'] as const;
const DAY_INDEX: Record<string, number> = Object.fromEntries(DAY_NAMES.map((d, i) => [d, i]));

interface Cell { id: string; dayOfWeek: number; periodIndex: number; teachers?: { id: string; fullName: string; subject?: string } }
type ViewMode = 'week' | 'today';

export default function ParentScheduleScreen() {
  const { t } = useTranslation();
  const dayLabel = (d: string) => t(`common.days.${d}`);
  const colors = useColors();
  const isDark = useIsDark();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const [children, setChildren] = useState<Student[]>([]);
  const [selectedChildId, setSelectedChildId] = useState<string>('');
  const [periodsPerDay, setPeriodsPerDay] = useState(6);
  const [scheduleDays, setScheduleDays] = useState<string[]>([]);
  const [cells, setCells] = useState<Cell[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>('week');

  useEffect(() => {
    parentApi.getChildren()
      .then(r => {
        const kids: Student[] = r.data || [];
        setChildren(kids);
        if (kids.length > 0) setSelectedChildId(kids[0].id);
        else setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedChildId) return;
    setLoading(true);
    parentApi.getSchedule(selectedChildId)
      .then(r => {
        setPeriodsPerDay(r.data?.periodsPerDay ?? 6);
        setScheduleDays(r.data?.scheduleDays ?? []);
        setCells(r.data?.assignments ?? []);
      })
      .finally(() => setLoading(false));
  }, [selectedChildId]);

  const orderedDays = useMemo(() =>
    [...scheduleDays].sort((a, b) => (DAY_INDEX[a] ?? 99) - (DAY_INDEX[b] ?? 99)),
  [scheduleDays]);

  const todayName = DAY_NAMES[new Date().getDay()];
  const todayIsScheduled = orderedDays.includes(todayName);
  const visibleDays = view === 'today' && todayIsScheduled ? [todayName] : orderedDays;

  const cellMap = useMemo(() => {
    const m = new Map<string, Cell>();
    for (const c of cells) m.set(`${c.dayOfWeek}:${c.periodIndex}`, c);
    return m;
  }, [cells]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Child chips */}
      {children.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.childStrip}>
          {children.map(c => {
            const active = c.id === selectedChildId;
            return (
              <TouchableOpacity
                key={c.id}
                onPress={() => setSelectedChildId(c.id)}
                style={[styles.childChip, active && styles.childChipActive]}
              >
                <Text style={[styles.childChipName, active && styles.childChipNameActive]} numberOfLines={1}>
                  {c.fullName}
                </Text>
                {(c as any).classes?.name && (
                  <Text style={[styles.childChipClass, active && styles.childChipClassActive]} numberOfLines={1}>
                    {(c as any).classes.name}
                  </Text>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

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

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : children.length === 0 ? (
        <View style={styles.empty}>
          <Calendar size={20} color={colors.textMuted} />
          <Text style={styles.emptyText}>{t('learn.no_children')}</Text>
        </View>
      ) : view === 'today' && !todayIsScheduled ? (
        <View style={styles.empty}>
          <Calendar size={20} color={colors.textMuted} />
          <Text style={styles.emptyText}>{t('schedule.no_classes_today', { day: dayLabel(todayName) })}</Text>
        </View>
      ) : visibleDays.length === 0 || cells.length === 0 ? (
        <View style={styles.empty}>
          <Calendar size={20} color={colors.textMuted} />
          <Text style={styles.emptyText}>{t('schedule.none_published')}</Text>
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.table}>
            <View style={styles.row}>
              <View style={[styles.cell, styles.headerCell, styles.dayCol]}>
                <Text style={styles.headerText}>{t('common.day')}</Text>
              </View>
              {Array.from({ length: periodsPerDay }, (_, i) => (
                <View key={i} style={[styles.cell, styles.headerCell]}>
                  <Text style={styles.headerText}>{t('schedule.period_short', { n: i + 1 })}</Text>
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
                  {Array.from({ length: periodsPerDay }, (_, i) => {
                    const cell = cellMap.get(`${dayIdx}:${i + 1}`);
                    const subject = cell?.teachers?.subject?.trim();
                    const teacher = cell?.teachers?.fullName;
                    return (
                      <View key={i} style={styles.cell}>
                        {subject ? (
                          <>
                            <Text style={styles.subjectText}>{subject}</Text>
                            {teacher && <Text style={styles.teacherText} numberOfLines={1}>{teacher}</Text>}
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

const makeStyles = (colors: ReturnType<typeof useColors>, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: 40 },

  childStrip: { gap: 8, paddingBottom: spacing.sm },
  childChip: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border,
    backgroundColor: colors.card, minWidth: 100,
  },
  childChipActive: {
    borderColor: isDark ? '#FFFFFF' : colors.primary,
    backgroundColor: isDark ? '#FFFFFF' : colors.primaryLight,
  },
  childChipName: { fontSize: font.sm, fontWeight: '700', color: colors.text },
  childChipNameActive: { color: isDark ? '#000000' : colors.primary },
  childChipClass: { fontSize: font.xs, color: colors.textMuted, marginTop: 2 },
  childChipClassActive: { color: isDark ? '#000000' : colors.primary },

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
    minWidth: 96, paddingHorizontal: 8, paddingVertical: 10,
    backgroundColor: colors.card,
    borderRightWidth: 1, borderBottomWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  dayCol: { minWidth: 100 },
  headerCell: { backgroundColor: colors.primaryLight },
  headerText: { fontSize: font.xs, fontWeight: '700', color: colors.primary },
  dayCell: { backgroundColor: colors.bg },
  dayText: { fontSize: font.sm, fontWeight: '700', color: colors.text },
  subjectText: { fontSize: font.sm, fontWeight: '700', color: colors.text, textAlign: 'center' },
  teacherText: { fontSize: 10, color: colors.textMuted, marginTop: 2, textAlign: 'center', maxWidth: 90 },
  emptyCellText: { fontSize: font.sm, color: colors.textMuted },
});
