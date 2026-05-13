import { useEffect, useMemo, useState } from 'react';
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
      .catch((e: any) => toast.error(e.response?.data?.error || 'Failed to load AR aging'));
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

  if (!isPremium) return <PageLayout title="AR aging"><p className="text-sm text-amber-700">Premium feature</p></PageLayout>;
  if (!rows) return <PageLayout title="AR aging"><LoadingSpinner /></PageLayout>;

  return (
    <PageLayout title="AR aging" subtitle={`Outstanding receivables as of ${asOf}`}>
      {/* Totals per currency */}
      {totals.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
          {totals.map(t => (
            <Card key={t.currency}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-gray-500">{t.currency} · total outstanding</span>
                <AlertCircle className="w-4 h-4 text-rose-400" />
              </div>
              <div className="text-2xl font-bold text-rose-700 mb-3">{fmtMoney(t.balance, t.currency)}</div>
              <div className="grid grid-cols-5 gap-1.5 text-center text-xs">
                <Bucket label="Current" amount={t.current} currency={t.currency} tone="emerald" />
                <Bucket label="1-30 d" amount={t.b1_30} currency={t.currency} tone="amber" />
                <Bucket label="31-60 d" amount={t.b31_60} currency={t.currency} tone="amber" />
                <Bucket label="61-90 d" amount={t.b61_90} currency={t.currency} tone="rose" />
                <Bucket label="90+ d" amount={t.b90_plus} currency={t.currency} tone="rose" />
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Filters */}
      <Card className="mb-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Input label="Search" placeholder="Student, parent, class" icon={<Search className="w-4 h-4" />} value={search} onChange={e => setSearch(e.target.value)} />
          <Select
            label="Bucket"
            value={bucket}
            onChange={e => setBucket(e.target.value as any)}
            options={[
              { value: 'all', label: 'All buckets' },
              { value: 'current', label: 'Current' },
              { value: 'b1_30', label: '1-30 days' },
              { value: 'b31_60', label: '31-60 days' },
              { value: 'b61_90', label: '61-90 days' },
              { value: 'b90_plus', label: '90+ days' },
            ]}
          />
          <div className="flex items-end text-xs text-gray-500">{filtered.length} of {rows.length} students with balance</div>
        </div>
      </Card>

      {/* Table */}
      <Card>
        {filtered.length === 0 ? (
          <EmptyState title="Nothing to show" description="Adjust the bucket or search filter." icon={<AlertCircle className="w-8 h-8 text-gray-400" />} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium text-gray-500 border-b border-gray-100">
                  <th className="py-2 pr-3">Student</th>
                  <th className="py-2 pr-3">Class</th>
                  <th className="py-2 pr-3">Plan</th>
                  <th className="py-2 pr-3 text-right">Current</th>
                  <th className="py-2 pr-3 text-right">1-30</th>
                  <th className="py-2 pr-3 text-right">31-60</th>
                  <th className="py-2 pr-3 text-right">61-90</th>
                  <th className="py-2 pr-3 text-right">90+</th>
                  <th className="py-2 pr-3 text-right">Total</th>
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
                      <div className="text-xs text-gray-400 capitalize">{r.kind}</div>
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
