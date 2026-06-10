import { useState, useMemo, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { CreditCard, FileDown, Receipt } from 'lucide-react-native';
import { CardListSkeleton } from '../../components/Skeleton';
import { feesApi } from '../../services/api';
import { downloadAuthPdf } from '../../utils/download';
import { useColors, useIsDark } from '../../store/themeStore';
import { spacing, radius, font, shadow } from '../../theme';
import type { ParentFeeRow, FeeStatus } from '../../types';

function statusPalette(status: FeeStatus, isDark: boolean) {
  if (isDark) {
    switch (status) {
      case 'paid_up':  return { bg: 'rgba(16,185,129,0.15)', fg: '#34D399', border: 'rgba(16,185,129,0.3)' };
      case 'overdue':  return { bg: 'rgba(239,68,68,0.15)',  fg: '#F87171', border: 'rgba(239,68,68,0.3)' };
      case 'due_soon': return { bg: 'rgba(245,158,11,0.15)', fg: '#FBBF24', border: 'rgba(245,158,11,0.3)' };
      default:         return { bg: 'rgba(255,255,255,0.08)', fg: '#E5E7EB', border: 'rgba(255,255,255,0.15)' };
    }
  }
  switch (status) {
    case 'paid_up':  return { bg: '#ECFDF5', fg: '#047857', border: '#A7F3D0' };
    case 'overdue':  return { bg: '#FEF2F2', fg: '#B91C1C', border: '#FECACA' };
    case 'due_soon': return { bg: '#FFFBEB', fg: '#B45309', border: '#FDE68A' };
    default:         return { bg: '#F8FAFC', fg: '#334155', border: '#E2E8F0' };
  }
}

function fmt(amount: number, currency: string) {
  const sym: Record<string, string> = { USD: '$', EUR: '€', GBP: '£' };
  const s = sym[currency] ?? '';
  const n = amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return s ? `${s}${n}` : `${currency} ${n}`;
}

export default function TuitionScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const isDark = useIsDark();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const statusLabel = (s: FeeStatus) => t(`tuition.status_${s}`);

  const [rows, setRows] = useState<ParentFeeRow[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await feesApi.getParentFees();
      setRows(r.data || []);
    } catch (e: any) {
      if (e.response?.status === 403) setRows([]); // module not enabled
      else setRows([]);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const downloadStatement = async (sfId: string) => {
    setBusyId(`sf:${sfId}`);
    try {
      await downloadAuthPdf(feesApi.studentFeeStatementPath(sfId), `tuition-statement-${sfId.slice(0, 8)}.pdf`);
    } catch {
      Alert.alert(t('tuition.download_failed_title'), t('tuition.statement_failed'));
    } finally {
      setBusyId(null);
    }
  };

  const downloadReceipt = async (paymentId: string) => {
    setBusyId(`p:${paymentId}`);
    try {
      await downloadAuthPdf(feesApi.paymentReceiptPath(paymentId), `receipt-${paymentId.slice(0, 8)}.pdf`);
    } catch {
      Alert.alert(t('tuition.download_failed_title'), t('tuition.receipt_failed'));
    } finally {
      setBusyId(null);
    }
  };

  if (rows === null) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md, paddingBottom: 40 }]}>
        <CardListSkeleton count={3} />
      </ScrollView>
    );
  }

  if (rows.length === 0) {
    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md, paddingBottom: 40, flexGrow: 1, justifyContent: 'center' }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <View style={styles.empty}>
          <CreditCard size={40} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>{t('tuition.no_records', 'No tuition records')}</Text>
          <Text style={styles.emptyText}>{t('tuition.no_records_desc', "There's nothing on file yet. The school will set up your tuition plan.")}</Text>
        </View>
      </ScrollView>
    );
  }

  // Family rollup
  const totalDue = rows.reduce((s, r) => s + (r.totalAmount + r.adjustment - r.siblingDiscount), 0);
  const totalPaid = rows.reduce((s, r) => s + r.paid, 0);
  const totalBalance = rows.reduce((s, r) => s + r.balance, 0);
  const currency = rows[0]?.currency ?? 'USD';
  const familyPct = totalDue > 0 ? Math.min(100, (totalPaid / totalDue) * 100) : 100;

  // Group by student
  const byStudent = new Map<string, ParentFeeRow[]>();
  for (const r of rows) {
    const arr = byStudent.get(r.studentId) ?? [];
    arr.push(r);
    byStudent.set(r.studentId, arr);
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md, paddingBottom: 40 }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      {/* Family rollup */}
      <View style={styles.rollupCard}>
        <View style={styles.rollupHeader}>
          <Text style={styles.rollupTitle}>{t('tuition.family_total', 'Family total')}</Text>
          {totalBalance === 0 ? (
            <View style={[styles.statusPill, { backgroundColor: statusPalette('paid_up', isDark).bg, borderColor: statusPalette('paid_up', isDark).border }]}>
              <Text style={[styles.statusPillText, { color: statusPalette('paid_up', isDark).fg }]}>{t('tuition.all_paid', 'All paid')}</Text>
            </View>
          ) : (
            <Text style={styles.rollupSub}>{rows.length} {rows.length === 1 ? t('tuition.plan', 'plan') : t('tuition.plans', 'plans')}</Text>
          )}
        </View>
        <View style={styles.rollupGrid}>
          <View style={styles.rollupCell}>
            <Text style={styles.rollupLabel}>{t('tuition.total', 'Total')}</Text>
            <Text style={styles.rollupValue}>{fmt(totalDue, currency)}</Text>
          </View>
          <View style={styles.rollupCell}>
            <Text style={styles.rollupLabel}>{t('tuition.paid', 'Paid')}</Text>
            <Text style={styles.rollupValue}>{fmt(totalPaid, currency)}</Text>
          </View>
          <View style={styles.rollupCell}>
            <Text style={styles.rollupLabel}>{t('tuition.remaining', 'Remaining')}</Text>
            <Text style={[styles.rollupValue, totalBalance > 0 ? { color: colors.primary } : { color: '#10B981' }]}>{fmt(totalBalance, currency)}</Text>
          </View>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${familyPct}%` }]} />
        </View>
      </View>

      {/* Per student */}
      {Array.from(byStudent.entries()).map(([studentId, plans]) => (
        <View key={studentId} style={{ marginBottom: spacing.md }}>
          <Text style={styles.studentName}>{plans[0].studentName}</Text>
          {plans.map(r => {
            const due = r.totalAmount + r.adjustment - r.siblingDiscount;
            const pct = due > 0 ? Math.min(100, (r.paid / due) * 100) : 100;
            const pal = statusPalette(r.status, isDark);
            const stmtBusy = busyId === `sf:${r.id}`;
            return (
              <View key={r.id} style={styles.planCard}>
                <View style={styles.planHeader}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.planTitleRow}>
                      <Text style={styles.planName}>{r.planName}</Text>
                      {r.academicYear && <Text style={styles.planYear}>· {r.academicYear}</Text>}
                    </View>
                    <View style={[styles.statusPill, { backgroundColor: pal.bg, borderColor: pal.border, marginTop: 4, alignSelf: 'flex-start' }]}>
                      <Text style={[styles.statusPillText, { color: pal.fg }]}>{statusLabel(r.status)}</Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    onPress={() => downloadStatement(r.id)}
                    disabled={stmtBusy}
                    style={[styles.iconBtn, stmtBusy && { opacity: 0.5 }]}
                    activeOpacity={0.7}
                  >
                    {stmtBusy ? <ActivityIndicator size="small" color={colors.primary} /> : <FileDown size={18} color={colors.primary} />}
                  </TouchableOpacity>
                </View>

                <Text style={styles.planAmounts}>
                  {fmt(r.paid, r.currency)} {t('tuition.of', 'of')} {fmt(due, r.currency)}
                  {r.balance > 0 ? `  ·  ${fmt(r.balance, r.currency)} ${t('tuition.remaining_lower', 'remaining')}` : ''}
                </Text>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${pct}%` }]} />
                </View>

                {r.installments.length > 0 && (
                  <View style={styles.installmentsGrid}>
                    {r.installments.map(i => (
                      <View key={i.id} style={styles.installmentChip}>
                        <Text style={styles.installmentLabel}>{t('tuition.installment', 'Installment')} {i.sequence}</Text>
                        <Text style={styles.installmentValue}>{fmt(i.amount, r.currency)}</Text>
                        <Text style={styles.installmentDue}>{t('tuition.due', 'due')} {i.dueDate}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {r.payments.length > 0 && (
                  <View style={{ marginTop: spacing.sm }}>
                    <Text style={styles.paymentsHeader}>{t('tuition.payments', 'Payments')}</Text>
                    {r.payments.map(p => {
                      const recBusy = busyId === `p:${p.id}`;
                      // HD-7 — mirror the web parent UI: refund rows show a
                      // negative amount + Refund badge; voided rows render
                      // with strike-through + Voided label.
                      const isVoided = Boolean(p.voidedAt);
                      return (
                        <View key={p.id} style={[styles.paymentRow, isVoided && { opacity: 0.6 }]}>
                          <View style={{ flex: 1 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                              <Text style={[
                                styles.paymentAmount,
                                isVoided && { textDecorationLine: 'line-through', color: colors.textMuted },
                                p.isRefund && !isVoided && { color: '#B91C1C' },
                              ]}>
                                {p.isRefund ? '−' : ''}{fmt(p.amount, r.currency)}
                              </Text>
                              {p.isRefund && (
                                <View style={styles.refundBadge}>
                                  <Text style={styles.refundBadgeText}>{t('tuition.refund_badge', 'REFUND')}</Text>
                                </View>
                              )}
                              {isVoided && (
                                <View style={styles.voidedBadge}>
                                  <Text style={styles.voidedBadgeText}>{t('tuition.voided_badge', 'VOIDED')}</Text>
                                </View>
                              )}
                            </View>
                            <Text style={styles.paymentMeta}>
                              {p.paidOn}{p.method ? ` · ${p.method}` : ''}
                            </Text>
                            {isVoided && (
                              <Text style={styles.voidedMeta}>
                                {t('tuition.voided_on', { date: String(p.voidedAt).slice(0, 10), defaultValue: 'Voided on {{date}}' })}{p.voidReason ? ` · ${p.voidReason}` : ''}
                              </Text>
                            )}
                          </View>
                          <TouchableOpacity
                            onPress={() => downloadReceipt(p.id)}
                            disabled={recBusy}
                            style={[styles.receiptBtn, recBusy && { opacity: 0.5 }]}
                            activeOpacity={0.7}
                          >
                            {recBusy
                              ? <ActivityIndicator size="small" color={colors.primary} />
                              : <Receipt size={16} color={colors.primary} />}
                          </TouchableOpacity>
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      ))}
    </ScrollView>
  );
}

const makeStyles = (colors: ReturnType<typeof useColors>, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.md },
  empty: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  emptyTitle: { fontSize: font.lg, fontWeight: '700', color: colors.text, marginTop: spacing.sm },
  emptyText: { fontSize: font.sm, color: colors.textMuted, textAlign: 'center', paddingHorizontal: spacing.lg },

  rollupCard: {
    backgroundColor: colors.card, borderRadius: radius.md,
    padding: spacing.md, marginBottom: spacing.md, ...shadow.sm,
  },
  rollupHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  rollupTitle: { fontSize: font.md, fontWeight: '700', color: colors.text },
  rollupSub: { fontSize: font.xs, color: colors.textMuted },
  rollupGrid: { flexDirection: 'row', gap: spacing.sm },
  rollupCell: { flex: 1 },
  rollupLabel: { fontSize: font.xs, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 },
  rollupValue: { fontSize: font.lg, fontWeight: '800', color: colors.text },

  progressTrack: {
    height: 8, borderRadius: 4, marginTop: spacing.sm,
    backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : '#F3F4F6',
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: colors.primary },

  studentName: { fontSize: font.md, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },

  planCard: {
    backgroundColor: colors.card, borderRadius: radius.md,
    padding: spacing.md, marginBottom: spacing.sm, ...shadow.sm,
  },
  planHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  planTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  planName: { fontSize: font.md, fontWeight: '700', color: colors.text },
  planYear: { fontSize: font.xs, color: colors.textMuted },
  planAmounts: { fontSize: font.sm, color: colors.textSecondary, marginTop: spacing.sm },

  statusPill: {
    borderWidth: 1, borderRadius: radius.full,
    paddingHorizontal: 10, paddingVertical: 3,
  },
  statusPillText: { fontSize: 11, fontWeight: '700' },

  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
  },

  installmentsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
  installmentChip: {
    backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#F9FAFB',
    borderRadius: radius.sm,
    paddingHorizontal: 10, paddingVertical: 8,
    minWidth: '48%',
  },
  installmentLabel: { fontSize: font.xs, color: colors.textMuted },
  installmentValue: { fontSize: font.sm, fontWeight: '700', color: colors.text, marginTop: 2 },
  installmentDue: { fontSize: font.xs, color: colors.textMuted, marginTop: 2 },

  paymentsHeader: {
    fontSize: font.xs, fontWeight: '700', color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6,
  },
  paymentRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: 8,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  paymentAmount: { fontSize: font.sm, fontWeight: '700', color: colors.text },
  paymentMeta: { fontSize: font.xs, color: colors.textMuted, marginTop: 2 },
  voidedMeta: { fontSize: font.xs, color: '#B91C1C', marginTop: 2 },
  refundBadge: {
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
    backgroundColor: isDark ? 'rgba(239,68,68,0.18)' : '#FEE2E2',
  },
  refundBadgeText: { fontSize: 9, fontWeight: '800', color: '#B91C1C', letterSpacing: 0.4 },
  voidedBadge: {
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
    backgroundColor: isDark ? 'rgba(255,255,255,0.12)' : '#E5E7EB',
  },
  voidedBadgeText: { fontSize: 9, fontWeight: '800', color: colors.textMuted, letterSpacing: 0.4 },
  receiptBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
  },
});
