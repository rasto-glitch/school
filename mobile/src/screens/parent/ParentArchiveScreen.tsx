import { useEffect, useState, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GraduationCap, ChevronLeft, ChevronRight, Archive } from 'lucide-react-native';
import { parentApi } from '../../services/api';
import { useColors, useIsDark } from '../../store/themeStore';
import { spacing, radius, font, shadow } from '../../theme';

// Read-only "Past Records" for parents — frozen snapshot of a graduated or
// departed child (audit finding F6, mobile follow-up of the web page). The
// backend only links snapshots captured with original_parent_id (migration
// 017 onward); older archives stay admin/accountant-only.

interface EnrollmentHistoryEntry {
  academicYear: string;
  gradeLevel: string;
  classId: string | null;
  className: string | null;
  status: string;
  startedOn: string | null;
  endedOn: string | null;
}

interface ArchivedChildSummary {
  id: string;
  fullName: string;
  reason: string;
  departureDate: string | null;
  // Migration 030: prefer enrollmentHistory; classesAttended kept for
  // pre-backfill archives.
  enrollmentHistory?: EnrollmentHistoryEntry[];
  classesAttended?: { year: string; classId: string; className: string }[];
}

interface SnapGrade {
  academicYear: string | null;
  gradingPeriod: string | null;
  subject: string | null;
  marks?: { name: string; value: number }[] | null;
  dailyGrade?: number | null;
  quizGrade?: number | null;
  monthlyExamGrade?: number | null;
  termExamGrade?: number | null;
}
interface SnapPayment {
  amount: number; paidOn: string; method: string | null;
  currency: string | null; receiptYear: number | null; receiptNumber: number | null;
}
interface SnapPlan {
  planName: string; academicYear: string | null; currency: string;
  totalAmount: number; adjustment: number; siblingDiscount: number; lateFees: number;
  payments: SnapPayment[];
}
interface ArchivedChildDetail extends ArchivedChildSummary {
  grades: SnapGrade[];
  paymentHistory: SnapPlan[];
}

const REASON_LABEL: Record<string, string> = {
  graduated: 'Graduated', transferred: 'Transferred', withdrew: 'Withdrew',
};

function fmtMoney(amount: number, currency: string) {
  const sym: Record<string, string> = { USD: '$', EUR: '€', GBP: '£' };
  const s = sym[currency] ?? '';
  const n = (Number(amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return s ? `${s}${n}` : `${currency} ${n}`;
}

function markNamesOf(g: SnapGrade): string[] {
  if (g.marks && g.marks.length > 0) return g.marks.map(m => m.name);
  const legacy: string[] = [];
  if (g.dailyGrade) legacy.push('Daily');
  if (g.quizGrade) legacy.push('Quiz');
  if (g.monthlyExamGrade) legacy.push('Monthly');
  if (g.termExamGrade) legacy.push('Term Exam');
  return legacy;
}
function markValue(g: SnapGrade, name: string): number | null {
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
function rowTotal(g: SnapGrade, names: string[]): number {
  if (g.marks && g.marks.length > 0) return g.marks.reduce((s, m) => s + (Number(m.value) || 0), 0);
  return names.reduce((s, n) => s + (markValue(g, n) || 0), 0);
}
function collectNames(grades: SnapGrade[]): string[] {
  const seen: string[] = [];
  for (const g of grades) for (const n of markNamesOf(g)) if (!seen.includes(n)) seen.push(n);
  return seen;
}

export default function ParentArchiveScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const isDark = useIsDark();
  const styles = makeStyles(colors, isDark);

  const [list, setList] = useState<ArchivedChildSummary[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ArchivedChildDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    parentApi.getArchivedChildren()
      .then(r => setList((r.data || []) as ArchivedChildSummary[]))
      .catch(() => setList([]));
  }, []);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    setDetailLoading(true);
    parentApi.getArchivedChild(selectedId)
      .then(r => setDetail(r.data as ArchivedChildDetail))
      .catch(() => setDetail(null))
      .finally(() => setDetailLoading(false));
  }, [selectedId]);

  const grouped = useMemo(() => {
    const out = new Map<string, Map<string, SnapGrade[]>>();
    for (const g of detail?.grades ?? []) {
      const yr = g.academicYear || '—';
      const term = g.gradingPeriod || '—';
      if (!out.has(yr)) out.set(yr, new Map());
      const bt = out.get(yr)!;
      if (!bt.has(term)) bt.set(term, []);
      bt.get(term)!.push(g);
    }
    return out;
  }, [detail]);

  // ---- List ----
  if (!selectedId) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={{ padding: spacing.md, paddingBottom: insets.bottom + spacing.lg }}>
        {list === null ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
        ) : list.length === 0 ? (
          <View style={styles.emptyBox}>
            <Archive size={32} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>{t('past_records.empty_title', 'No past records')}</Text>
            <Text style={styles.emptySub}>
              {t('past_records.empty_sub', 'When a child graduates or leaves, their final record appears here.')}
            </Text>
          </View>
        ) : (
          list.map(c => (
            <TouchableOpacity key={c.id} style={styles.card} activeOpacity={0.7} onPress={() => setSelectedId(c.id)}>
              <View style={styles.avatar}>
                <GraduationCap size={20} color={isDark ? '#FFFFFF' : colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardName}>{c.fullName}</Text>
                <Text style={styles.cardSub}>
                  {REASON_LABEL[c.reason] || c.reason}{c.departureDate ? ` · ${c.departureDate}` : ''}
                </Text>
              </View>
              <ChevronRight size={16} color={colors.textMuted} />
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    );
  }

  // ---- Detail ----
  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: spacing.md, paddingBottom: insets.bottom + spacing.lg }}>
      <TouchableOpacity style={styles.backRow} onPress={() => setSelectedId(null)} activeOpacity={0.7}>
        <ChevronLeft size={18} color={colors.primary} />
        <Text style={styles.backText}>{t('past_records.back', 'All records')}</Text>
      </TouchableOpacity>

      {detailLoading || !detail ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
      ) : (
        <>
          <Text style={styles.title}>{detail.fullName}</Text>
          <Text style={styles.subtitle}>
            {REASON_LABEL[detail.reason] || detail.reason}{detail.departureDate ? ` · ${detail.departureDate}` : ''}
          </Text>

          {(() => {
            const history = detail.enrollmentHistory ?? [];
            const legacy = detail.classesAttended ?? [];
            const rows = history.length
              ? history.map(e => ({
                  academicYear: e.academicYear,
                  label: e.gradeLevel + (e.className ? ` · ${e.className}` : ''),
                }))
              : legacy.map(c => ({ academicYear: c.year, label: c.className }));
            if (rows.length === 0) return null;
            return (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>{t('past_records.academic_progression', 'Academic progression')}</Text>
                <View style={styles.chipWrap}>
                  {rows.map((r, i) => (
                    <View key={i} style={styles.chip}>
                      <Text style={styles.chipText}>{r.academicYear}: {r.label}</Text>
                    </View>
                  ))}
                </View>
              </View>
            );
          })()}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('past_records.grades', 'Grades')}</Text>
            {grouped.size === 0 ? (
              <Text style={styles.muted}>{t('past_records.no_grades', 'No grades recorded.')}</Text>
            ) : (
              Array.from(grouped.entries()).map(([year, byTerm]) => (
                <View key={year} style={{ marginBottom: spacing.md }}>
                  <Text style={styles.yearLabel}>{year}</Text>
                  {Array.from(byTerm.entries()).map(([term, grades]) => {
                    const names = collectNames(grades);
                    return (
                      <View key={term} style={styles.termBox}>
                        <Text style={styles.termHeader}>{term}</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                          <View>
                            <View style={[styles.tr, styles.trHead]}>
                              <Text style={[styles.th, styles.colSubject]}>{t('past_records.subject', 'Subject')}</Text>
                              {names.map(n => <Text key={n} style={[styles.th, styles.colMark]}>{n}</Text>)}
                              <Text style={[styles.th, styles.colMark]}>{t('past_records.total', 'Total')}</Text>
                            </View>
                            {grades.map((g, i) => (
                              <View key={i} style={styles.tr}>
                                <Text style={[styles.td, styles.colSubject]}>{g.subject || '—'}</Text>
                                {names.map(n => {
                                  const v = markValue(g, n);
                                  return <Text key={n} style={[styles.td, styles.colMark]}>{v ?? '—'}</Text>;
                                })}
                                <Text style={[styles.td, styles.colMark, styles.totalCell]}>{rowTotal(g, names)}</Text>
                              </View>
                            ))}
                          </View>
                        </ScrollView>
                      </View>
                    );
                  })}
                </View>
              ))
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('past_records.tuition', 'Tuition history')}</Text>
            {(detail.paymentHistory ?? []).length === 0 ? (
              <Text style={styles.muted}>{t('past_records.no_tuition', 'No tuition records.')}</Text>
            ) : (
              detail.paymentHistory.map((plan, i) => {
                const paid = plan.payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
                const due = plan.totalAmount + plan.adjustment + plan.lateFees - plan.siblingDiscount;
                return (
                  <View key={i} style={styles.planBox}>
                    <View style={styles.planHead}>
                      <Text style={styles.planName}>{plan.planName}{plan.academicYear ? ` · ${plan.academicYear}` : ''}</Text>
                      <Text style={styles.planAmt}>{fmtMoney(paid, plan.currency)} / {fmtMoney(due, plan.currency)}</Text>
                    </View>
                    {plan.payments.map((p, j) => {
                      const rcp = p.receiptYear && p.receiptNumber
                        ? `RCP-${p.receiptYear}-${String(p.receiptNumber).padStart(5, '0')}` : null;
                      return (
                        <View key={j} style={styles.payRow}>
                          <Text style={styles.payDate}>{p.paidOn}{p.method ? ` · ${p.method}` : ''}</Text>
                          {rcp && <Text style={styles.payRcp}>{rcp}</Text>}
                          <Text style={styles.payAmt}>{fmtMoney(p.amount, p.currency || plan.currency)}</Text>
                        </View>
                      );
                    })}
                  </View>
                );
              })
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const makeStyles = (colors: ReturnType<typeof useColors>, _isDark: boolean) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  emptyBox: { alignItems: 'center', padding: spacing.xl, marginTop: spacing.xl },
  emptyTitle: { fontSize: font.lg, fontWeight: '700', color: colors.text, marginTop: spacing.md },
  emptySub: { fontSize: font.sm, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xs },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.md,
    marginBottom: spacing.sm, ...shadow.sm,
  },
  avatar: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
  },
  cardName: { fontSize: font.md, fontWeight: '700', color: colors.text },
  cardSub: { fontSize: font.xs, color: colors.textMuted, marginTop: 2 },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: spacing.sm },
  backText: { fontSize: font.sm, color: colors.primary, fontWeight: '600' },
  title: { fontSize: font.xl, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: font.sm, color: colors.textMuted, marginTop: 2, marginBottom: spacing.md },
  section: {
    backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.md,
    marginBottom: spacing.md, ...shadow.sm,
  },
  sectionTitle: { fontSize: font.md, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  muted: { fontSize: font.sm, color: colors.textMuted },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { backgroundColor: colors.primaryLight, borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { fontSize: font.xs, color: colors.primary, fontWeight: '600' },
  yearLabel: { fontSize: font.sm, fontWeight: '800', color: colors.text, marginBottom: 4 },
  termBox: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden', marginBottom: spacing.sm },
  termHeader: {
    backgroundColor: colors.primaryLight, color: colors.primary, fontWeight: '700',
    fontSize: font.sm, paddingHorizontal: spacing.md, paddingVertical: 6,
  },
  tr: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border },
  trHead: { borderTopWidth: 0, backgroundColor: colors.bg },
  th: { fontSize: font.xs, fontWeight: '700', color: colors.textMuted, paddingHorizontal: 10, paddingVertical: 6 },
  td: { fontSize: font.sm, color: colors.text, paddingHorizontal: 10, paddingVertical: 6 },
  colSubject: { width: 130 },
  colMark: { width: 70, textAlign: 'center' },
  totalCell: { fontWeight: '800' },
  planBox: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm },
  planHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' },
  planName: { fontSize: font.sm, fontWeight: '700', color: colors.text, flexShrink: 1 },
  planAmt: { fontSize: font.xs, color: colors.textMuted },
  payRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.bg, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 5, marginTop: 4, gap: 6,
  },
  payDate: { fontSize: font.xs, color: colors.textSecondary, flexShrink: 1 },
  payRcp: { fontSize: font.xs, color: colors.textMuted },
  payAmt: { fontSize: font.xs, fontWeight: '700', color: colors.text },
});
