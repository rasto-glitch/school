import { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Wallet, CalendarClock, History } from 'lucide-react-native';
import { CardListSkeleton } from '../../components/Skeleton';
import { teacherApi } from '../../services/api';
import { useColors } from '../../store/themeStore';
import { spacing, radius, font, shadow } from '../../theme';

interface StaffInfo {
  id: string;
  fullName: string;
  position: string | null;
  salaryAmount: number;
  currency: string;
  nextPaymentDate: string | null;
  isActive: boolean;
}

interface SalaryPayment {
  id: string;
  amount: number;
  currency: string;
  paidOn: string;
  periodLabel: string | null;
  notes: string | null;
}

function fmtMoney(amount: number, currency: string) {
  const sym: Record<string, string> = { USD: '$', EUR: '€', GBP: '£' };
  const s = sym[currency] ?? '';
  const n = amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return s ? `${s}${n}` : `${currency} ${n}`;
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T00:00:00');
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

export default function TeacherSalaryScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [staff, setStaff] = useState<StaffInfo | null>(null);
  const [payments, setPayments] = useState<SalaryPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      const r = await teacherApi.getSalary();
      setStaff(r.data?.staff ?? null);
      setPayments(r.data?.payments ?? []);
    } catch {
      setStaff(null);
      setPayments([]);
    }
  };

  useEffect(() => { load().finally(() => setLoading(false)); }, []);
  const onRefresh = () => { setRefreshing(true); load().finally(() => setRefreshing(false)); };

  const dueIn = daysUntil(staff?.nextPaymentDate ?? null);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <Text style={styles.title}>{t('salary.title', 'My Salary')}</Text>
      <Text style={styles.subtitle}>{t('salary.subtitle', 'View your salary and payment history.')}</Text>

      {loading ? (
        <CardListSkeleton count={3} />
      ) : !staff ? (
        <View style={styles.empty}>
          <Wallet size={36} color={colors.textMuted} />
          <Text style={styles.emptyText}>{t('salary.empty', 'No salary record yet. The accounting office will set this up.')}</Text>
        </View>
      ) : (
        <>
          <View style={styles.heroCard}>
            <View style={styles.heroIcon}>
              <Wallet size={22} color="#fff" />
            </View>
            <Text style={styles.heroLabel}>{t('salary.monthly_amount', 'Monthly amount')}</Text>
            <Text style={styles.heroAmount}>{fmtMoney(staff.salaryAmount, staff.currency)}</Text>
            {staff.position && <Text style={styles.heroPosition}>{staff.position}</Text>}
          </View>

          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <View style={styles.infoIconBox}>
                <CalendarClock size={16} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.infoLabel}>{t('salary.next_payment', 'Next payment')}</Text>
                <Text style={styles.infoValue}>
                  {staff.nextPaymentDate
                    ? `${staff.nextPaymentDate}${dueIn !== null ? ` · ${dueIn < 0 ? t('salary.overdue', 'overdue') : dueIn === 0 ? t('salary.today', 'today') : t('salary.in_days', { count: dueIn, defaultValue: `in ${dueIn} day${dueIn === 1 ? '' : 's'}` })}` : ''}`
                    : t('salary.not_scheduled', 'Not scheduled')}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.historyHeader}>
            <History size={16} color={colors.textMuted} />
            <Text style={styles.historyTitle}>{t('salary.payment_history', 'Payment history')}</Text>
          </View>

          {payments.length === 0 ? (
            <Text style={styles.noPayments}>{t('salary.no_payments', 'No payments recorded yet.')}</Text>
          ) : (
            payments.map(p => (
              <View key={p.id} style={styles.paymentCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.paymentAmount}>{fmtMoney(p.amount, p.currency)}</Text>
                  <Text style={styles.paymentMeta}>
                    {p.paidOn}{p.periodLabel ? ` · ${p.periodLabel}` : ''}
                  </Text>
                  {p.notes && <Text style={styles.paymentNotes}>{p.notes}</Text>}
                </View>
              </View>
            ))
          )}
        </>
      )}
    </ScrollView>
  );
}

const makeStyles = (colors: ReturnType<typeof import('../../store/themeStore').useColors>) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: 40 },
  title: { fontSize: font.xxl, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: font.sm, color: colors.textMuted, marginTop: 2, marginBottom: spacing.md },
  empty: { alignItems: 'center', marginTop: 60, gap: spacing.md, paddingHorizontal: spacing.lg },
  emptyText: { fontSize: font.sm, color: colors.textMuted, textAlign: 'center' },
  heroCard: { backgroundColor: colors.primary, borderRadius: radius.xl, padding: spacing.lg, marginBottom: spacing.md, ...shadow.md },
  heroIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  heroLabel: { fontSize: font.xs, color: 'rgba(255,255,255,0.8)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  heroAmount: { fontSize: 32, fontWeight: '800', color: '#fff', marginTop: 4 },
  heroPosition: { fontSize: font.sm, color: 'rgba(255,255,255,0.9)', marginTop: 4 },
  infoCard: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md, ...shadow.sm },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  infoIconBox: { width: 32, height: 32, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryLight },
  infoLabel: { fontSize: font.xs, color: colors.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  infoValue: { fontSize: font.md, color: colors.text, fontWeight: '600', marginTop: 2 },
  historyHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm, marginBottom: spacing.sm },
  historyTitle: { fontSize: font.xs, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  noPayments: { textAlign: 'center', color: colors.textMuted, marginTop: 20, fontSize: font.sm },
  paymentCard: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.xs, ...shadow.sm },
  paymentAmount: { fontSize: font.md, fontWeight: '700', color: colors.text },
  paymentMeta: { fontSize: font.xs, color: colors.textMuted, marginTop: 2 },
  paymentNotes: { fontSize: font.xs, color: colors.textSecondary, marginTop: 4 },
});
