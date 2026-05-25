import { useEffect, useState, useMemo, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { CardListSkeleton } from '../../components/Skeleton';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { GraduationCap } from 'lucide-react-native';
import { parentApi } from '../../services/api';
import { useColors, useIsDark } from '../../store/themeStore';
import { useBadgeStore } from '../../store/badgeStore';
import { spacing, radius, font, shadow } from '../../theme';
import type { Grade, Student } from '../../types';

function canonicalLabel(s: string | null | undefined): string {
  if (!s) return '';
  return s.trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function getMarkNames(g: Grade): string[] {
  if (g.marks && g.marks.length > 0) return g.marks.map(m => m.name);
  const legacy: string[] = [];
  if (g.dailyGrade) legacy.push('Daily');
  if (g.quizGrade) legacy.push('Quiz');
  if (g.monthlyExamGrade) legacy.push('Monthly');
  if (g.termExamGrade) legacy.push('Term Exam');
  return legacy;
}

function getMarkValue(g: Grade, name: string): number | null {
  if (g.marks && g.marks.length > 0) {
    const m = g.marks.find(mm => mm.name === name);
    return m ? Number(m.value) : null;
  }
  if (name === 'Daily') return g.dailyGrade ?? null;
  if (name === 'Quiz') return g.quizGrade ?? null;
  if (name === 'Monthly') return g.monthlyExamGrade ?? null;
  if (name === 'Term Exam') return g.termExamGrade ?? null;
  return null;
}

function gradeTotal(g: Grade, markNames: string[]): number {
  if (g.marks && g.marks.length > 0) {
    return g.marks.reduce((s, m) => s + (Number(m.value) || 0), 0);
  }
  return markNames.reduce((s, name) => s + (getMarkValue(g, name) || 0), 0);
}

function termAverage(subjects: string[], termData: Record<string, Grade>, markNames: string[]): number {
  const totals = subjects.map(s => termData[s] ? gradeTotal(termData[s], markNames) : 0).filter(t => t > 0);
  if (totals.length === 0) return 0;
  return Math.round((totals.reduce((a, b) => a + b, 0) / totals.length) * 10) / 10;
}

function MarkBadge({ value, colors }: { value?: number | null; colors: any }) {
  if (value == null || value === 0) return <Text style={{ color: colors.textMuted, fontSize: font.sm }}>—</Text>;
  const bg = value >= 90 ? '#F0FDF4' : value >= 75 ? '#EFF6FF' : value >= 60 ? '#FFFBEB' : '#FEF2F2';
  const color = value >= 90 ? '#15803D' : value >= 75 ? '#1D4ED8' : value >= 60 ? '#B45309' : '#DC2626';
  return (
    <View style={{ backgroundColor: bg, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
      <Text style={{ color, fontSize: font.sm, fontWeight: '700' }}>{value}</Text>
    </View>
  );
}

const SUBJECT_COL_WIDTH = 110;
const MARK_COL_WIDTH = 68;

export default function GradesScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const isDark = useIsDark();
  const [children, setChildren] = useState<Student[]>([]);
  const [selectedChild, setSelectedChild] = useState('');
  const [grades, setGrades] = useState<Grade[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const clearGrade = useBadgeStore(s => s.clearGrade);
  const setUnreadCount = useBadgeStore(s => s.setUnreadCount);

  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  useFocusEffect(
    useCallback(() => {
      clearGrade();
      parentApi.markTypeRead('grade').catch(() => {});
      parentApi.getUnreadCount().then(r => setUnreadCount(r.data?.count ?? 0)).catch(() => {});
    }, [clearGrade, setUnreadCount])
  );

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

  // Group: year → term → subject → Grade. Canonical labels collapse case
  // variations ("Term 1" vs "term 1") onto the same row.
  const byYear = useMemo(() => grades.reduce((acc, g) => {
    const yr = canonicalLabel(g.academicYear) || 'Current Year';
    const term = canonicalLabel(g.gradingPeriod) || 'Term 1';
    const subj = canonicalLabel(g.subject);
    if (!acc[yr]) acc[yr] = {};
    if (!acc[yr][term]) acc[yr][term] = {};
    acc[yr][term][subj] = g;
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

          // Collect mark names across the year, preserving insertion order
          const seen = new Set<string>();
          const markNames: string[] = [];
          for (const term of terms) {
            for (const subj of subjects) {
              const g = byYear[yr][term][subj];
              if (!g) continue;
              for (const n of getMarkNames(g)) {
                if (!seen.has(n)) { seen.add(n); markNames.push(n); }
              }
            }
          }

          const termAvgs = terms.map(tm => termAverage(subjects, byYear[yr][tm], markNames));
          const validTermAvgs = termAvgs.filter(a => a > 0);
          const yearAvg = validTermAvgs.length === 0 ? 0
            : Math.round((validTermAvgs.reduce((a, b) => a + b, 0) / validTermAvgs.length) * 10) / 10;

          const tableWidth = SUBJECT_COL_WIDTH + markNames.length * MARK_COL_WIDTH + MARK_COL_WIDTH;

          // Admin-written notes for this year, shown beneath the tables.
          const notes: { term: string; subject: string; note: string }[] = [];
          for (const term of terms) {
            for (const subj of subjects) {
              const g = byYear[yr][term][subj];
              if (g?.adminNote && g.adminNote.trim()) notes.push({ term, subject: subj, note: g.adminNote.trim() });
            }
          }

          return (
            <View key={yr} style={styles.yearCard}>
              <View style={styles.yearHeader}>
                <Text style={styles.yearTitle}>{yr}</Text>
              </View>

              {terms.map((term, ti) => (
                <View key={term} style={styles.termBlock}>
                  <View style={styles.termHeader}>
                    <Text style={styles.termTitle}>{term.toUpperCase()}</Text>
                  </View>

                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={{ width: tableWidth }}>
                      {/* Column headers */}
                      <View style={styles.tableRow}>
                        <Text style={[styles.colHeader, { width: SUBJECT_COL_WIDTH, textAlign: 'left' }]}>
                          {t('grades.subject')}
                        </Text>
                        {markNames.map(name => (
                          <Text key={name} style={[styles.colHeader, { width: MARK_COL_WIDTH }]} numberOfLines={1}>
                            {name}
                          </Text>
                        ))}
                        <Text style={[styles.colHeader, { width: MARK_COL_WIDTH }]}>
                          {t('grades.total')}
                        </Text>
                      </View>

                      {/* Subject rows */}
                      {subjects.map((subject, si) => {
                        const g = byYear[yr][term][subject];
                        const total = g ? gradeTotal(g, markNames) : 0;
                        return (
                          <View key={subject} style={[styles.tableRow, si % 2 === 0 && styles.rowEven]}>
                            <Text style={[styles.subjectCell, { width: SUBJECT_COL_WIDTH }]} numberOfLines={1}>{subject}</Text>
                            {markNames.map(name => (
                              <View key={name} style={[styles.cell, { width: MARK_COL_WIDTH }]}>
                                <MarkBadge value={g ? getMarkValue(g, name) : null} colors={colors} />
                              </View>
                            ))}
                            <View style={[styles.cell, { width: MARK_COL_WIDTH }]}>
                              <MarkBadge value={total > 0 ? total : null} colors={colors} />
                            </View>
                          </View>
                        );
                      })}

                      {/* Term average row */}
                      <View style={styles.avgRow}>
                        <Text style={[styles.avgLabel, { width: SUBJECT_COL_WIDTH + markNames.length * MARK_COL_WIDTH }]} numberOfLines={1}>
                          {t('grades.term_average')}
                        </Text>
                        <View style={[styles.cell, { width: MARK_COL_WIDTH }]}>
                          <MarkBadge value={termAvgs[ti] > 0 ? termAvgs[ti] : null} colors={colors} />
                        </View>
                      </View>
                    </View>
                  </ScrollView>
                </View>
              ))}

              {/* Admin notes */}
              {notes.map((n, i) => (
                <View key={i} style={styles.noteBox}>
                  <Text style={styles.noteLabel}>{t('grades.school_note')} · {n.subject} · {n.term}</Text>
                  <Text style={styles.noteText}>{n.note}</Text>
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

const makeStyles = (colors: ReturnType<typeof import('../../store/themeStore').useColors>, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md },
  header: { marginBottom: spacing.lg },
  title: { fontSize: font.xxl, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: font.sm, color: colors.textMuted, marginTop: 2 },
  chip: {
    borderWidth: 1.5,
    borderColor: isDark ? '#FFFFFF' : colors.border,
    borderRadius: radius.full,
    paddingHorizontal: 14, paddingVertical: 8,
    marginRight: spacing.sm,
    backgroundColor: isDark ? 'transparent' : colors.card,
  },
  chipActive: {
    borderColor: isDark ? '#FFFFFF' : colors.primary,
    backgroundColor: isDark ? '#FFFFFF' : colors.primaryLight,
  },
  chipText: { fontSize: font.sm, color: isDark ? '#FFFFFF' : colors.textSecondary, fontWeight: '500' },
  chipTextActive: { color: isDark ? '#000000' : colors.primary, fontWeight: '700' },
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
  colHeader: { fontSize: 10, fontWeight: '600', color: colors.textMuted, textAlign: 'center', textTransform: 'uppercase', letterSpacing: 0.3 },
  subjectCell: { fontSize: font.sm, fontWeight: '600', color: colors.text, paddingRight: spacing.sm },
  cell: { alignItems: 'center' },
  avgRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: spacing.sm, backgroundColor: colors.bg, borderTopWidth: 2, borderTopColor: colors.border },
  avgLabel: { fontSize: font.xs, fontWeight: '700', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.3, paddingRight: spacing.sm },
  yearAvgRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: 10, backgroundColor: colors.bg, borderTopWidth: 2, borderTopColor: colors.border },
  yearAvgLabel: { fontSize: font.sm, fontWeight: '700', color: colors.textSecondary },
  noteBox: { marginHorizontal: spacing.md, marginTop: spacing.sm, backgroundColor: colors.warningLight, borderRadius: radius.md, padding: spacing.sm },
  noteLabel: { fontSize: font.xs, fontWeight: '700', color: colors.warning, marginBottom: 2 },
  noteText: { fontSize: font.sm, color: colors.text },
});
