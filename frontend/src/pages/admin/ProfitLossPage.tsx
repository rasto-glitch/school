import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { FileBarChart, TrendingUp, TrendingDown } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { accountingApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Input from '../../components/common/Input';
import Button from '../../components/common/Button';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import { fmtMoney } from '../../utils/money';

interface PLLine { category: string; amount: number }
interface PLBlock {
  currency: string;
  income: PLLine[];
  expense: PLLine[];
  incomeTotal: number;
  expenseTotal: number;
  net: number;
}

function firstOfMonthISO(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
}
function todayISO(): string { return new Date().toISOString().slice(0, 10); }

// HD-17 — academic-year range helper. Scholify uses a September boundary
// (matches academicYearOf() on the backend). Returns ISO dates so the
// existing date inputs accept the value with no further parsing.
function academicYearRange(offset: 0 | -1 = 0): { start: string; end: string } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const inFall = now.getUTCMonth() + 1 >= 9;
  const startYear = (inFall ? y : y - 1) + offset;
  const start = `${startYear}-09-01`;
  const end = `${startYear + 1}-08-31`;
  return { start, end };
}

export default function ProfitLossPage() {
  const { t } = useTranslation();
  const { school } = useAuthStore();
  const isPremium = school?.features?.tuition_fees === true;
  const [startDate, setStartDate] = useState(firstOfMonthISO());
  const [endDate, setEndDate] = useState(todayISO());
  const [compare, setCompare] = useState(true);
  const [current, setCurrent] = useState<PLBlock[] | null>(null);
  const [prior, setPrior] = useState<PLBlock[] | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const r = await accountingApi.getProfitLoss({ startDate, endDate, ...(compare ? { compare: '1' } : {}) });
      setCurrent(r.data.current);
      setPrior(r.data.prior ?? null);
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('accounting.pl.load_failed'));
    } finally { setLoading(false); }
  };
  useEffect(() => { if (isPremium) run(); /* eslint-disable-next-line */ }, []);

  if (!isPremium) return <PageLayout title={t('accounting.reports.profit_loss.label')}><p className="text-sm text-amber-700">{t('accounting.premium_subtitle')}</p></PageLayout>;

  return (
    <PageLayout title={t('accounting.reports.profit_loss.label')} subtitle={t('accounting.pl.subtitle')}>
      <Card className="mb-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Input label={t('accounting.ledger.from')} type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
          <Input label={t('accounting.ledger.to')} type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
          <label className="flex items-end gap-2 text-sm pb-1">
            <input type="checkbox" checked={compare} onChange={e => setCompare(e.target.checked)} className="w-4 h-4 text-primary-600" />
            {t('accounting.pl.compare')}
          </label>
          <div className="flex items-end"><Button onClick={run} fullWidth loading={loading}>{t('accounting.pl.run')}</Button></div>
        </div>
        {/* HD-17 — preset chips for the most common ranges. Saves the
            accountant from typing two ISO dates every time they want
            this-academic-year vs. last-academic-year P&Ls. The current
            month is the existing default; keeping that chip for parity. */}
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <button type="button" className="px-2 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50" onClick={() => { setStartDate(firstOfMonthISO()); setEndDate(todayISO()); }}>{t('accounting.pl.preset_this_month', 'This month')}</button>
          <button type="button" className="px-2 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50" onClick={() => { const r = academicYearRange(0); setStartDate(r.start); setEndDate(r.end); }}>{t('accounting.pl.preset_this_year', 'This academic year')}</button>
          <button type="button" className="px-2 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50" onClick={() => { const r = academicYearRange(-1); setStartDate(r.start); setEndDate(r.end); }}>{t('accounting.pl.preset_prev_year', 'Previous academic year')}</button>
        </div>
      </Card>

      {loading ? <LoadingSpinner /> : !current ? null : current.length === 0 ? (
        <Card><p className="text-sm text-gray-500">{t('accounting.pl.no_movements')}</p></Card>
      ) : (
        <div className="space-y-4">
          {current.map(block => {
            const priorBlock = prior?.find(p => p.currency === block.currency);
            return (
              <Card key={block.currency}>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <FileBarChart className="w-4 h-4 text-gray-500" />
                    <h3 className="font-semibold text-gray-900">{block.currency}</h3>
                  </div>
                  <div className={`text-lg font-bold ${block.net >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{fmtMoney(block.net, block.currency)}</div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Income column */}
                  <div>
                    <div className="flex items-center gap-1.5 text-sm font-medium text-emerald-700 mb-2 pb-1.5 border-b border-emerald-100">
                      <TrendingUp className="w-3.5 h-3.5" /> {t('accounting.income')}
                    </div>
                    {block.income.length === 0 ? <p className="text-xs text-gray-400 py-1">—</p> : (
                      <ul className="space-y-1">
                        {block.income.map(l => (
                          <li key={l.category} className="flex items-center justify-between text-sm">
                            <span className="capitalize text-gray-700">{l.category}</span>
                            <span className="font-medium text-emerald-700">{fmtMoney(l.amount, block.currency)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="mt-2 pt-2 border-t border-gray-100 flex items-center justify-between text-sm">
                      <span className="font-semibold text-gray-700">{t('accounting.plans.total')}</span>
                      <span className="font-bold text-emerald-700">{fmtMoney(block.incomeTotal, block.currency)}</span>
                    </div>
                    {priorBlock && (
                      <div className="mt-1 text-xs text-gray-500 flex items-center justify-between">
                        <span>{t('accounting.pl.prior')}</span>
                        <span>{fmtMoney(priorBlock.incomeTotal, block.currency)} · {pct(block.incomeTotal, priorBlock.incomeTotal)}</span>
                      </div>
                    )}
                  </div>
                  {/* Expense column */}
                  <div>
                    <div className="flex items-center gap-1.5 text-sm font-medium text-rose-700 mb-2 pb-1.5 border-b border-rose-100">
                      <TrendingDown className="w-3.5 h-3.5" /> {t('accounting.expense')}
                    </div>
                    {block.expense.length === 0 ? <p className="text-xs text-gray-400 py-1">—</p> : (
                      <ul className="space-y-1">
                        {block.expense.map(l => (
                          <li key={l.category} className="flex items-center justify-between text-sm">
                            <span className="capitalize text-gray-700">{l.category}</span>
                            <span className="font-medium text-rose-700">{fmtMoney(l.amount, block.currency)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="mt-2 pt-2 border-t border-gray-100 flex items-center justify-between text-sm">
                      <span className="font-semibold text-gray-700">{t('accounting.plans.total')}</span>
                      <span className="font-bold text-rose-700">{fmtMoney(block.expenseTotal, block.currency)}</span>
                    </div>
                    {priorBlock && (
                      <div className="mt-1 text-xs text-gray-500 flex items-center justify-between">
                        <span>{t('accounting.pl.prior')}</span>
                        <span>{fmtMoney(priorBlock.expenseTotal, block.currency)} · {pct(block.expenseTotal, priorBlock.expenseTotal)}</span>
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </PageLayout>
  );
}

function pct(current: number, prior: number): string {
  if (prior < 0.01) return current > 0 ? '+∞' : '0%';
  const d = ((current - prior) / prior) * 100;
  return `${d >= 0 ? '+' : ''}${d.toFixed(1)}%`;
}
