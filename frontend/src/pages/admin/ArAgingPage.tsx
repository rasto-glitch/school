import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { AlertCircle, Search } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { accountingApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Input from '../../components/common/Input';
import Select from '../../components/common/Select';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';
import { fmtMoney } from '../../utils/money';

interface AgingRow {
  studentFeeId: string;
  studentId: string;
  studentName: string;
  className: string | null;
  parentName: string | null;
  planName: string;
  kind: string;
  currency: string;
  balance: number;
  current: number;
  b1_30: number;
  b31_60: number;
  b61_90: number;
  b90_plus: number;
}

interface AgingTotals {
  currency: string;
  balance: number;
  current: number;
  b1_30: number;
  b31_60: number;
  b61_90: number;
  b90_plus: number;
}

export default function ArAgingPage() {
  const { t } = useTranslation();
  const { school } = useAuthStore();
  const isPremium = school?.features?.tuition_fees === true;
  const [rows, setRows] = useState<AgingRow[] | null>(null);
  const [totals, setTotals] = useState<AgingTotals[]>([]);
  const [asOf, setAsOf] = useState('');
  const [search, setSearch] = useState('');
  const [bucket, setBucket] = useState<'all' | 'current' | 'b1_30' | 'b31_60' | 'b61_90' | 'b90_plus'>('all');

  useEffect(() => {
    if (!isPremium) return;
    accountingApi.getArAging()
      .then(r => {
        setRows(r.data.rows);
        setTotals(r.data.totals);
        setAsOf(r.data.asOf);
      })
      .catch((e: any) => toast.error(e.response?.data?.error || t('accounting.ar.load_failed')));
  }, [isPremium]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (q && !`${r.studentName} ${r.parentName ?? ''} ${r.className ?? ''}`.toLowerCase().includes(q)) return false;
      if (bucket === 'all') return true;
      return r[bucket] > 0.01;
    });
  }, [rows, search, bucket]);

  if (!isPremium) return <PageLayout title={t('accounting.ar.title')}><p className="text-sm text-amber-700">{t('accounting.premium_subtitle')}</p></PageLayout>;
  if (!rows) return <PageLayout title={t('accounting.ar.title')}><LoadingSpinner /></PageLayout>;

  return (
    <PageLayout title={t('accounting.ar.title')} subtitle={t('accounting.ar.subtitle', { date: asOf })}>
      {/* Totals per currency */}
      {totals.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
          {totals.map(tot => (
            <Card key={tot.currency}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-gray-500">{t('accounting.ar.total_outstanding', { currency: tot.currency })}</span>
                <AlertCircle className="w-4 h-4 text-rose-400" />
              </div>
              <div className="text-2xl font-bold text-rose-700 mb-3">{fmtMoney(tot.balance, tot.currency)}</div>
              <div className="grid grid-cols-5 gap-1.5 text-center text-xs">
                <Bucket label={t('accounting.ar.b_current')} amount={tot.current} currency={tot.currency} tone="emerald" />
                <Bucket label={t('accounting.ar.b_1_30')} amount={tot.b1_30} currency={tot.currency} tone="amber" />
                <Bucket label={t('accounting.ar.b_31_60')} amount={tot.b31_60} currency={tot.currency} tone="amber" />
                <Bucket label={t('accounting.ar.b_61_90')} amount={tot.b61_90} currency={tot.currency} tone="rose" />
                <Bucket label={t('accounting.ar.b_90_plus')} amount={tot.b90_plus} currency={tot.currency} tone="rose" />
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Filters */}
      <Card className="mb-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Input label={t('accounting.ar.search')} placeholder={t('accounting.ar.search_ph')} icon={<Search className="w-4 h-4" />} value={search} onChange={e => setSearch(e.target.value)} />
          <Select
            label={t('accounting.ar.bucket')}
            value={bucket}
            onChange={e => setBucket(e.target.value as any)}
            options={[
              { value: 'all', label: t('accounting.ar.opt_all') },
              { value: 'current', label: t('accounting.ar.b_current') },
              { value: 'b1_30', label: t('accounting.ar.b_1_30') },
              { value: 'b31_60', label: t('accounting.ar.b_31_60') },
              { value: 'b61_90', label: t('accounting.ar.b_61_90') },
              { value: 'b90_plus', label: t('accounting.ar.b_90_plus') },
            ]}
          />
          <div className="flex items-end text-xs text-gray-500">{t('accounting.ar.count_summary', { shown: filtered.length, total: rows.length })}</div>
        </div>
      </Card>

      {/* Table */}
      <Card>
        {filtered.length === 0 ? (
          <EmptyState title={t('accounting.ar.none_title')} description={t('accounting.ar.none_desc')} icon={<AlertCircle className="w-8 h-8 text-gray-400" />} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium text-gray-500 border-b border-gray-100">
                  <th className="py-2 pr-3">{t('accounting.ar.col_student')}</th>
                  <th className="py-2 pr-3">{t('accounting.ar.col_class')}</th>
                  <th className="py-2 pr-3">{t('accounting.ar.col_plan')}</th>
                  <th className="py-2 pr-3 text-right">{t('accounting.ar.b_current')}</th>
                  <th className="py-2 pr-3 text-right">{t('accounting.ar.b_1_30')}</th>
                  <th className="py-2 pr-3 text-right">{t('accounting.ar.b_31_60')}</th>
                  <th className="py-2 pr-3 text-right">{t('accounting.ar.b_61_90')}</th>
                  <th className="py-2 pr-3 text-right">{t('accounting.ar.b_90_plus')}</th>
                  <th className="py-2 pr-3 text-right">{t('accounting.ar.col_total')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.studentFeeId} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                    <td className="py-2 pr-3">
                      <Link to={`/accounting/student/${r.studentId}`} className="text-primary-700 hover:underline font-medium">
                        {r.studentName}
                      </Link>
                      {r.parentName && <div className="text-xs text-gray-500">{r.parentName}</div>}
                    </td>
                    <td className="py-2 pr-3 text-gray-700">{r.className ?? '—'}</td>
                    <td className="py-2 pr-3 text-gray-700">
                      {r.planName}
                      <div className="text-xs text-gray-400">{t(`accounting.tuition.kind.${r.kind}`)}</div>
                    </td>
                    <td className="py-2 pr-3 text-right text-gray-700">{r.current > 0.01 ? fmtMoney(r.current, r.currency) : '—'}</td>
                    <td className="py-2 pr-3 text-right text-amber-700">{r.b1_30 > 0.01 ? fmtMoney(r.b1_30, r.currency) : '—'}</td>
                    <td className="py-2 pr-3 text-right text-amber-700">{r.b31_60 > 0.01 ? fmtMoney(r.b31_60, r.currency) : '—'}</td>
                    <td className="py-2 pr-3 text-right text-rose-700">{r.b61_90 > 0.01 ? fmtMoney(r.b61_90, r.currency) : '—'}</td>
                    <td className="py-2 pr-3 text-right text-rose-700 font-medium">{r.b90_plus > 0.01 ? fmtMoney(r.b90_plus, r.currency) : '—'}</td>
                    <td className="py-2 pr-3 text-right font-bold text-rose-700">{fmtMoney(r.balance, r.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </PageLayout>
  );
}

function Bucket({ label, amount, currency, tone }: { label: string; amount: number; currency: string; tone: 'emerald' | 'amber' | 'rose' }) {
  const cls = tone === 'emerald' ? 'bg-emerald-50 text-emerald-700' : tone === 'amber' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700';
  return (
    <div className={`rounded-md py-1.5 px-1 ${cls}`}>
      <div className="text-[10px] uppercase tracking-wide font-semibold opacity-80">{label}</div>
      <div className="text-xs font-bold">{amount > 0.01 ? fmtMoney(amount, currency) : '—'}</div>
    </div>
  );
}
