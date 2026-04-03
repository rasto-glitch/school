import { useEffect, useState, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { CardListSkeleton } from '../../components/Skeleton';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GraduationCap } from 'lucide-react-native';
import { parentApi } from '../../services/api';
import { useColors } from '../../store/themeStore';
import { spacing, radius, font, shadow } from '../../theme';
import type { Grade, Student } from '../../types';

function termTotal(g: Grade): number {
  return (g.dailyGrade || 0) + (g.quizGrade || 0) + (g.monthlyExamGrade || 0) + (g.termExamGrade || 0);
}

function termAverage(subjects: string[], termData: Record<string, Grade>): number {
  const totals = subjects.map(s => termData[s] ? termTotal(termData[s]) : 0).filter(t => t > 0);
  if (totals.length === 0) return 0;
  return Math.round((totals.reduce((a, b) => a + b, 0) / totals.length) * 10) / 10;
}

function MarkBadge({ value, colors }: { value?: number | null; colors: any }) {
  if (!value) return <Text style={{ color: colors.textMuted, fontSize: font.sm }}>—</Text>;
  const bg = value >= 90 ? '#F0FDF4' : value >= 75 ? '#EFF6FF' : value >= 60 ? '#FFFBEB' : '#FEF2F2';
  const color = value >= 90 ? '#15803D' : value >= 75 ? '#1D4ED8' : value >= 60 ? '#B45309' : '#DC2626';
  return (
    <View style={{ backgroundColor: bg, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
      <Text style={{ color, fontSize: font.sm, fontWeight: '700' }}>{value}</Text>
    </View>
  );
}

export default function GradesScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const [children, setChildren] = useState<Student[]>([]);
  const [selectedChild, setSelectedChild] = useState('');
  const [grades, setGrades] = useState<Grade[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const styles = useMemo(() => makeStyles(colors), [colors]);

  useEffect(() => {
    parentApi.getChildren().then(r => {
      const kids = r.data || [];
      setChildren(kids);
      if (kids.length > 0) setSelectedChild(kids[0].id);
    });
  }, []);

  const load = () => parentApi.getGrades(selectedChild).then(r => setGrades(r.data || []));

  useEffect(() => {
    if (!selectedChild) return;
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [selectedChild]);

  const onRefresh = () => { setRefreshing(true); load().finally(() => setRefreshing(false)); };

  // Group: year → term → subject → Grade (same logic as web)
  const byYear = useMemo(() => grades.reduce((acc, g) => {
    const yr = g.academicYear || 'Current Year';
    const term = g.gradingPeriod || 'Term 1';
    if (!acc[yr]) acc[yr] = {};
    if (!acc[yr][term]) acc[yr][term] = {};
    acc[yr][term][g.subject] = g;
    return acc;
  }, {} as Record<string, Record<string, Record<string, Grade>>>), [grades]);

  const years = Object.keys(byYear).sort((a, b) => b.localeCompare(a));

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md, paddingBottom: 40 }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <View style={styles.header}>
        <Text style={styles.title}>{t('grades.title')}</Text>
        <Text style={styles.subtitle}>{t('grades.subtitle')}</Text>
      </View>

      {children.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }}>
          {children.map(c => (
            <TouchableOpacity key={c.id} style={[styles.chip, selectedChild === c.id && styles.chipActive]} onPress={() => setSelectedChild(c.id)}>
              <Text style={[styles.chipText, selectedChild === c.id && styles.chipTextActive]}>{c.fullName}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {loading ? (
        <CardListSkeleton count={4} />
      ) : grades.length === 0 ? (
        <View style={styles.emptyBox}>
          <GraduationCap size={40} color={colors.textMuted} />
          <Text style={styles.emptyText}>{t('grades.no_grades')}</Text>
        </View>
      ) : (
        years.map(yr => {
          const terms = Object.keys(byYear[yr]).sort();
          const subjects = Array.from(new Set(terms.flatMap(tm => Object.keys(byYear[yr][tm])))).sort();
          const termAvgs = terms.map(tm => termAverage(subjects, byYear[yr][tm]));
          const validTermAvgs = termAvgs.filter(a => a > 0);
          const yearAvg = validTermAvgs.length === 0 ? 0
            : Math.round((validTermAvgs.reduce((a, b) => a + b, 0) / validTermAvgs.length) * 10) / 10;

          return (
            <View key={yr} style={styles.yearCard}>
              {/* Year header */}
              <View style={styles.yearHeader}>
                <Text style={styles.yearTitle}>{yr}</Text>
              </View>

              {/* One table per term */}
              {terms.map((term, ti) => (
                <View key={term} style={styles.termBlock}>
                  <View style={styles.termHeader}>
                    <Text style={styles.termTitle}>{term.toUpperCase()}</Text>
                  </View>

                  {/* Column headers */}
                  <View style={styles.tableRow}>
                    <Text style={[styles.colHeader, styles.subjectCol]}>{t('grades.subject')}</Text>
                    <Text style={styles.colHeader}>{t('grades.daily')}</Text>
                    <Text style={styles.colHeader}>{t('grades.quiz')}</Text>
                    <Text style={styles.colHeader}>{t('grades.monthly')}</Text>
                    <Text style={styles.colHeader}>{t('grades.term')}</Text>
                    <Text style={styles.colHeader}>{t('grades.total')}</Text>
                  </View>

                  {/* Subject rows */}
                  {subjects.map((subject, si) => {
                    const g = byYear[yr][term][subject];
                    const total = g ? termTotal(g) : 0;
                    return (
                      <View key={subject} style={[styles.tableRow, si % 2 === 0 && styles.rowEven]}>
                        <Text style={[styles.subjectCell, styles.subjectCol]} numberOfLines={1}>{subject}</Text>
                        <View style={styles.cell}><MarkBadge value={g?.dailyGrade} colors={colors} /></View>
                        <View style={styles.cell}><MarkBadge value={g?.quizGrade} colors={colors} /></View>
                        <View style={styles.cell}><MarkBadge value={g?.monthlyExamGrade} colors={colors} /></View>
                        <View style={styles.cell}><MarkBadge value={g?.termExamGrade} colors={colors} /></View>
                        <View style={styles.cell}><MarkBadge value={total > 0 ? total : null} colors={colors} /></View>
                      </View>
                    );
                  })}

                  {/* Term average row */}
                  <View style={styles.avgRow}>
                    <Text style={[styles.avgLabel, styles.subjectCol]}>{t('grades.term_average')}</Text>
                    <View style={styles.cell} /><View style={styles.cell} /><View style={styles.cell} /><View style={styles.cell} />
                    <View style={styles.cell}><MarkBadge value={termAvgs[ti] > 0 ? termAvgs[ti] : null} colors={colors} /></View>
                  </View>
                </View>
              ))}

              {/* Year average */}
              <View style={styles.yearAvgRow}>
                <Text style={styles.yearAvgLabel}>{t('grades.year_average')}</Text>
                <MarkBadge value={yearAvg > 0 ? yearAvg : null} colors={colors} />
              </View>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const makeStyles = (colors: ReturnType<typeof import('../../store/themeStore').useColors>) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md },
  header: { marginBottom: spacing.lg },
  title: { fontSize: font.xxl, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: font.sm, color: colors.textMuted, marginTop: 2 },
  chip: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.full, paddingHorizontal: 14, paddingVertical: 8, marginRight: spacing.sm, backgroundColor: colors.card },
  chipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  chipText: { fontSize: font.sm, color: colors.textSecondary, fontWeight: '500' },
  chipTextActive: { color: colors.primary, fontWeight: '700' },
  emptyBox: { alignItems: 'center', marginTop: 60, gap: spacing.md },
  emptyText: { fontSize: font.md, color: colors.textMuted },
  yearCard: { backgroundColor: colors.card, borderRadius: radius.lg, marginBottom: spacing.md, overflow: 'hidden', ...shadow.sm },
  yearHeader: { backgroundColor: colors.bg, borderBottomWidth: 1, borderBottomColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: 10 },
  yearTitle: { fontSize: font.md, fontWeight: '700', color: colors.text },
  termBlock: { borderBottomWidth: 1, borderBottomColor: colors.border },
  termHeader: { backgroundColor: colors.primaryLight, paddingHorizontal: spacing.md, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
  termTitle: { fontSize: font.xs, fontWeight: '700', color: colors.primary, letterSpacing: 0.5 },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: spacing.sm },
  rowEven: { backgroundColor: colors.bg + '80' },
  subjectCol: { flex: 2, paddingRight: spacing.sm },
  colHeader: { flex: 1, fontSize: 10, fontWeight: '600', color: colors.textMuted, textAlign: 'center', textTransform: 'uppercase', letterSpacing: 0.3 },
  subjectCell: { fontSize: font.sm, fontWeight: '600', color: colors.text },
  cell: { flex: 1, alignItems: 'center' },
  avgRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: spacing.sm, backgroundColor: colors.bg, borderTopWidth: 2, borderTopColor: colors.border },
  avgLabel: { fontSize: font.xs, fontWeight: '700', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.3 },
  yearAvgRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: 10, backgroundColor: colors.bg, borderTopWidth: 2, borderTopColor: colors.border },
  yearAvgLabel: { fontSize: font.sm, fontWeight: '700', color: colors.textSecondary },
});
