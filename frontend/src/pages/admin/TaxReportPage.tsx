import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Receipt as ReceiptIcon } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { accountingApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Input from '../../components/common/Input';
import Button from '../../components/common/Button';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';
import { fmtMoney } from '../../utils/money';

// i18n keys; resolved with t() at render.
const SOURCE_LABEL: Record<string, string> = {
  fee_payment: 'accounting.tax.src_fee',
  staff_salary_payment: 'accounting.tax.src_salary',
  expense: 'accounting.tax.src_expense',
};

interface TaxRow { source: keyof typeof SOURCE_LABEL; label: string; currency: string; amount: number }

function firstOfYearISO(): string {
  return `${new Date().getUTCFullYear()}-01-01`;
}
function todayISO(): string { return new Date().toISOString().slice(0, 10); }

export default function TaxReportPage() {
  const { t } = useTranslation();
  const { school } = useAuthStore();
  const isPremium = school?.features?.tuition_fees === true;
  const [startDate, setStartDate] = useState(firstOfYearISO());
  const [endDate, setEndDate] = useState(todayISO());
  const [rows, setRows] = useState<TaxRow[] | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const r = await accountingApi.getTaxReport({ startDate, endDate });
      setRows(r.data.rows);
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('accounting.tax.load_failed'));
    } finally { setLoading(false); }
  };
  useEffect(() => { if (isPremium) run(); /* eslint-disable-next-line */ }, []);

  if (!isPremium) return <PageLayout title={t('accounting.tax.title')}><p className="text-sm text-amber-700">{t('accounting.premium_subtitle')}</p></PageLayout>;

  // Totals by (currency, label)
  const totals = new Map<string, { currency: string; label: string; amount: number }>();
  for (const r of rows ?? []) {
    const k = `${r.currency}|${r.label}`;
    const slot = totals.get(k) ?? { currency: r.currency, label: r.label, amount: 0 };
    slot.amount += r.amount;
    totals.set(k, slot);
  }

  return (
    <PageLayout title={t('accounting.tax.title')} subtitle={t('accounting.tax.subtitle')}>
      <Card className="mb-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Input label={t('accounting.ledger.from')} type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
          <Input label={t('accounting.ledger.to')} type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
          <div className="flex items-end"><Button onClick={run} fullWidth loading={loading}>{t('accounting.pl.run')}</Button></div>
        </div>
      </Card>

      {loading ? <LoadingSpinner /> : !rows ? null : rows.length === 0 ? (
        <Card>
          <EmptyState title={t('accounting.tax.none_title')} description={t('accounting.tax.none_desc')} icon={<ReceiptIcon className="w-8 h-8 text-gray-400" />} />
        </Card>
      ) : (
        <>
          <Card className="mb-4">
            <h3 className="font-semibold text-gray-900 mb-3">{t('accounting.tax.totals_by_label')}</h3>
            <ul className="divide-y divide-gray-100">
              {Array.from(totals.values()).sort((a, b) => b.amount - a.amount).map(tot => (
                <li key={`${tot.currency}|${tot.label}`} className="py-2 flex items-center justify-between text-sm">
                  <span className="text-gray-700">{tot.label} <span className="text-gray-400">· {tot.currency}</span></span>
                  <span className="font-bold text-gray-900">{fmtMoney(tot.amount, tot.currency)}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <h3 className="font-semibold text-gray-900 mb-3">{t('accounting.tax.by_source')}</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-medium text-gray-500 border-b border-gray-100">
                    <th className="py-2 pr-3">{t('accounting.tax.col_source')}</th>
                    <th className="py-2 pr-3">{t('accounting.tax.col_label')}</th>
                    <th className="py-2 pr-3">{t('accounting.tax.col_currency')}</th>
                    <th className="py-2 pr-3 text-right">{t('accounting.tax.col_amount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-b border-gray-50 last:border-0">
                      <td className="py-2 pr-3 text-gray-700">{SOURCE_LABEL[r.source] ? t(SOURCE_LABEL[r.source]) : r.source}</td>
                      <td className="py-2 pr-3 text-gray-700">{r.label}</td>
                      <td className="py-2 pr-3 text-gray-700">{r.currency}</td>
                      <td className="py-2 pr-3 text-right font-medium">{fmtMoney(r.amount, r.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </PageLayout>
  );
}
