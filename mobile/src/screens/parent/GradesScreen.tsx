import { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Star } from 'lucide-react-native';
import { parentApi } from '../../services/api';
import { colors, spacing, radius, shadow, font } from '../../theme';
import type { Grade, Student } from '../../types';

export default function GradesScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [children, setChildren] = useState<Student[]>([]);
  const [selectedChild, setSelectedChild] = useState('');
  const [grades, setGrades] = useState<Grade[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

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

  const total = (g: Grade) => ((g.dailyGrade || 0) + (g.quizGrade || 0) + (g.monthlyExamGrade || 0) + (g.termExamGrade || 0)).toFixed(1);
  const avg = () => grades.length ? (grades.reduce((a, g) => a + parseFloat(total(g)), 0) / grades.length).toFixed(1) : '—';

  const scoreColor = (v: number) => v >= 80 ? colors.success : v >= 60 ? colors.warning : colors.danger;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md }]}
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
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : grades.length === 0 ? (
        <View style={styles.emptyBox}>
          <Star size={40} color={colors.textMuted} />
          <Text style={styles.emptyText}>{t('grades.no_grades')}</Text>
        </View>
      ) : (
        <>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>{t('grades.year_average')}</Text>
            <Text style={styles.summaryValue}>{avg()}</Text>
            <Text style={styles.summaryNote}>{grades.length} subjects</Text>
          </View>

          {grades.map(g => {
            const tot = parseFloat(total(g));
            return (
              <View key={g.id} style={styles.card}>
                <View style={styles.cardTop}>
                  <Text style={styles.subject}>{g.subject}</Text>
                  <View style={[styles.totalBadge, { backgroundColor: scoreColor(tot) + '20' }]}>
                    <Text style={[styles.totalText, { color: scoreColor(tot) }]}>{total(g)}</Text>
                  </View>
                </View>
                <View style={styles.scoreRow}>
                  {[
                    { label: t('grades.daily'), val: g.dailyGrade },
                    { label: t('grades.quiz'), val: g.quizGrade },
                    { label: t('grades.monthly'), val: g.monthlyExamGrade },
                    { label: t('grades.term'), val: g.termExamGrade },
                  ].map(s => (
                    <View key={s.label} style={styles.scoreCell}>
                      <Text style={styles.scoreVal}>{s.val}</Text>
                      <Text style={styles.scoreLabel}>{s.label}</Text>
                    </View>
                  ))}
                </View>
                {g.gradingPeriod && <Text style={styles.period}>{g.gradingPeriod} · {g.academicYear}</Text>}
              </View>
            );
          })}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: 40 },
  header: { marginBottom: spacing.lg },
  title: { fontSize: font.xxl, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: font.sm, color: colors.textMuted, marginTop: 2 },
  chip: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.full, paddingHorizontal: 14, paddingVertical: 8, marginRight: spacing.sm, backgroundColor: colors.card },
  chipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  chipText: { fontSize: font.sm, color: colors.textSecondary, fontWeight: '500' },
  chipTextActive: { color: colors.primary, fontWeight: '700' },
  emptyBox: { alignItems: 'center', marginTop: 60, gap: spacing.md },
  emptyText: { fontSize: font.md, color: colors.textMuted },
  summaryCard: { backgroundColor: colors.primary, borderRadius: radius.lg, padding: spacing.lg, alignItems: 'center', marginBottom: spacing.md, ...shadow.md },
  summaryLabel: { fontSize: font.sm, color: '#C7D2FE', fontWeight: '600' },
  summaryValue: { fontSize: 48, fontWeight: '800', color: colors.textInverse, lineHeight: 56 },
  summaryNote: { fontSize: font.xs, color: '#A5B4FC' },
  card: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, ...shadow.sm },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  subject: { fontSize: font.md, fontWeight: '700', color: colors.text },
  totalBadge: { borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 4 },
  totalText: { fontSize: font.lg, fontWeight: '800' },
  scoreRow: { flexDirection: 'row', justifyContent: 'space-around', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
  scoreCell: { alignItems: 'center', gap: 2 },
  scoreVal: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  scoreLabel: { fontSize: 10, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.3 },
  period: { fontSize: font.xs, color: colors.textMuted, marginTop: spacing.sm },
});
