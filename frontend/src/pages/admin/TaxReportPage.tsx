import { useEffect, useState } from 'react';
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

const SOURCE_LABEL: Record<string, string> = {
  fee_payment: 'Tuition payment',
  staff_salary_payment: 'Staff salary',
  expense: 'Expense',
};

interface TaxRow { source: keyof typeof SOURCE_LABEL; label: string; currency: string; amount: number }

function firstOfYearISO(): string {
  return `${new Date().getUTCFullYear()}-01-01`;
}
function todayISO(): string { return new Date().toISOString().slice(0, 10); }

export default function TaxReportPage() {
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
      toast.error(e.response?.data?.error || 'Failed to load tax report');
    } finally { setLoading(false); }
  };
  useEffect(() => { if (isPremium) run(); /* eslint-disable-next-line */ }, []);

  if (!isPremium) return <PageLayout title="Tax report"><p className="text-sm text-amber-700">Premium feature</p></PageLayout>;

  // Totals by (currency, label)
  const totals = new Map<string, { currency: string; label: string; amount: number }>();
  for (const r of rows ?? []) {
    const k = `${r.currency}|${r.label}`;
    const slot = totals.get(k) ?? { currency: r.currency, label: r.label, amount: 0 };
    slot.amount += r.amount;
    totals.set(k, slot);
  }

  return (
    <PageLayout title="Tax report" subtitle="Tax / withholding by label">
      <Card className="mb-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Input label="From" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
          <Input label="To" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
          <div className="flex items-end"><Button onClick={run} fullWidth loading={loading}>Run</Button></div>
        </div>
      </Card>

      {loading ? <LoadingSpinner /> : !rows ? null : rows.length === 0 ? (
        <Card>
          <EmptyState title="No tax recorded" description="Add tax amounts on payments, salaries, or expenses to see them here." icon={<ReceiptIcon className="w-8 h-8 text-gray-400" />} />
        </Card>
      ) : (
        <>
          <Card className="mb-4">
            <h3 className="font-semibold text-gray-900 mb-3">Totals by label</h3>
            <ul className="divide-y divide-gray-100">
              {Array.from(totals.values()).sort((a, b) => b.amount - a.amount).map(t => (
                <li key={`${t.currency}|${t.label}`} className="py-2 flex items-center justify-between text-sm">
                  <span className="text-gray-700">{t.label} <span className="text-gray-400">· {t.currency}</span></span>
                  <span className="font-bold text-gray-900">{fmtMoney(t.amount, t.currency)}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <h3 className="font-semibold text-gray-900 mb-3">By source</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-medium text-gray-500 border-b border-gray-100">
                    <th className="py-2 pr-3">Source</th>
                    <th className="py-2 pr-3">Label</th>
                    <th className="py-2 pr-3">Currency</th>
                    <th className="py-2 pr-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-b border-gray-50 last:border-0">
                      <td className="py-2 pr-3 text-gray-700">{SOURCE_LABEL[r.source] ?? r.source}</td>
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
