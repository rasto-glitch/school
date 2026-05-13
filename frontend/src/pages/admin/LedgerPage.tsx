import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { Calendar, TrendingUp, TrendingDown, Wallet, FileText, FileSpreadsheet, Filter as FilterIcon, BookOpen } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { ledgerApi, type LedgerRow, type LedgerCurrencyTotal, type LedgerCategoryTotal } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Button from '../../components/common/Button';
import Input from '../../components/common/Input';
import Select from '../../components/common/Select';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';

type SourceKey = 'fee_payment' | 'staff_salary_payment' | 'expense';

import { fmtMoney as fmt } from '../../utils/money';

function firstOfMonthISO(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
}
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

const SOURCE_LABELS: Record<SourceKey, string> = {
  fee_payment: 'Tuition payments',
  staff_salary_payment: 'Staff salaries',
  expense: 'Expenses',
};

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function LedgerPage() {
  const { school, user } = useAuthStore();
  const role = user?.role;
  const canWrite = role === 'admin' || role === 'accountant';
  const isPremium = school?.features?.tuition_fees === true;

  const [startDate, setStartDate] = useState<string>(firstOfMonthISO());
  const [endDate, setEndDate] = useState<string>(todayISO());
  const [enabledSources, setEnabledSources] = useState<Record<SourceKey, boolean>>({
    fee_payment: true, staff_salary_payment: true, expense: true,
  });
  const [currencyFilter, setCurrencyFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'income' | 'expense'>('all');

  const [rows, setRows] = useState<LedgerRow[] | null>(null);
  const [totals, setTotals] = useState<LedgerCurrencyTotal[]>([]);
  const [categories, setCategories] = useState<LedgerCategoryTotal[]>([]);
  const [defaultCurrency, setDefaultCurrency] = useState('USD');

  const reload = async () => {
    setRows(null);
    const enabled = (Object.keys(enabledSources) as SourceKey[]).filter(k => enabledSources[k]);
    if (enabled.length === 0) {
      setRows([]);
      setTotals([]);
      setCategories([]);
      return;
    }
    try {
      const r = await ledgerApi.get({
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        sources: enabled.join(','),
        currency: currencyFilter || undefined,
      });
      setRows(r.data.rows);
      setTotals(r.data.totals);
      setCategories(r.data.categories);
      setDefaultCurrency(r.data.defaultCurrency);
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to load ledger');
      setRows([]);
    }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, []);

  const visibleRows = useMemo(() => {
    if (!rows) return [];
    return typeFilter === 'all' ? rows : rows.filter(r => r.type === typeFilter);
  }, [rows, typeFilter]);

  const [exporting, setExporting] = useState<'pdf' | 'xlsx' | null>(null);
  const exportLedger = async (kind: 'pdf' | 'xlsx') => {
    const enabled = (Object.keys(enabledSources) as SourceKey[]).filter(k => enabledSources[k]);
    if (enabled.length === 0) { toast.info('Pick at least one source first'); return; }
    setExporting(kind);
    try {
      const params = {
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        sources: enabled.join(','),
        currency: currencyFilter || undefined,
      };
      const r = kind === 'pdf' ? await ledgerApi.downloadPdf(params) : await ledgerApi.downloadXlsx(params);
      const tag = `${startDate || 'all'}-to-${endDate || 'now'}`;
      saveBlob(r.data as Blob, `ledger-${tag}.${kind}`);
    } catch (e: any) {
      toast.error(e.response?.data?.error || `Failed to export ${kind.toUpperCase()}`);
    } finally { setExporting(null); }
  };

  const setQuickRange = (kind: 'this_month' | 'last_month' | 'ytd' | 'last_30' | 'last_90') => {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    if (kind === 'this_month') {
      setStartDate(new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10));
      setEndDate(todayISO());
    } else if (kind === 'last_month') {
      setStartDate(new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10));
      setEndDate(new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10));
    } else if (kind === 'ytd') {
      setStartDate(new Date(Date.UTC(y, 0, 1)).toISOString().slice(0, 10));
      setEndDate(todayISO());
    } else if (kind === 'last_30') {
      const d = new Date(now); d.setUTCDate(d.getUTCDate() - 30);
      setStartDate(d.toISOString().slice(0, 10));
      setEndDate(todayISO());
    } else if (kind === 'last_90') {
      const d = new Date(now); d.setUTCDate(d.getUTCDate() - 90);
      setStartDate(d.toISOString().slice(0, 10));
      setEndDate(todayISO());
    }
  };

  if (!isPremium) {
    return (
      <PageLayout title="Ledger" subtitle="Premium feature">
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 max-w-xl">
          <h3 className="font-semibold text-amber-900 mb-1">Accounting module not enabled</h3>
          <p className="text-sm text-amber-800">
            The accounting module is part of the Premium plan. Contact Scholify to enable it for your school.
          </p>
        </div>
      </PageLayout>
    );
  }
  if (!canWrite) {
    return (
      <PageLayout title="Ledger" subtitle="Restricted">
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 max-w-xl">
          <p className="text-sm text-amber-800">You do not have access to the ledger.</p>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout title="Ledger" subtitle="All money movement across tuition, salaries, and operating expenses">
      {/* Filters */}
      <Card className="mb-4">
        <div className="flex items-center gap-2 mb-3">
          <FilterIcon className="w-4 h-4 text-gray-500" />
          <h3 className="font-semibold text-gray-900">Filters</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
          <Input label="From" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
          <Input label="To" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
          <Select
            label="Currency"
            options={[{ value: '', label: 'All' }, ...Array.from(new Set([defaultCurrency, ...totals.map(t => t.currency)])).map(c => ({ value: c, label: c }))]}
            value={currencyFilter}
            onChange={e => setCurrencyFilter(e.target.value)}
          />
          <Select
            label="Direction"
            options={[
              { value: 'all', label: 'All' },
              { value: 'income', label: 'Income only' },
              { value: 'expense', label: 'Expense only' },
            ]}
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value as any)}
          />
          <div className="flex items-end">
            <Button onClick={reload} fullWidth>Apply</Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-3">
          <button onClick={() => setQuickRange('this_month')} className="text-xs px-2.5 py-1 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700">This month</button>
          <button onClick={() => setQuickRange('last_month')} className="text-xs px-2.5 py-1 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700">Last month</button>
          <button onClick={() => setQuickRange('last_30')} className="text-xs px-2.5 py-1 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700">Last 30 days</button>
          <button onClick={() => setQuickRange('last_90')} className="text-xs px-2.5 py-1 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700">Last 90 days</button>
          <button onClick={() => setQuickRange('ytd')} className="text-xs px-2.5 py-1 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700">Year to date</button>
        </div>

        <div className="flex flex-wrap gap-3 pt-3 border-t border-gray-100">
          <span className="text-sm text-gray-600">Sources:</span>
          {(Object.keys(SOURCE_LABELS) as SourceKey[]).map(k => (
            <label key={k} className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={enabledSources[k]}
                onChange={e => setEnabledSources(s => ({ ...s, [k]: e.target.checked }))}
                className="w-4 h-4 text-primary-600"
              />
              {SOURCE_LABELS[k]}
            </label>
          ))}
        </div>
      </Card>

      {/* Summary cards per currency */}
      {totals.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
          {totals.map(t => (
            <Card key={t.currency}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-gray-500">{t.currency}</span>
                <Wallet className="w-4 h-4 text-gray-400" />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600 flex items-center gap-1"><TrendingUp className="w-3.5 h-3.5 text-emerald-600" /> Income</span>
                  <span className="font-semibold text-emerald-700">{fmt(t.income, t.currency)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600 flex items-center gap-1"><TrendingDown className="w-3.5 h-3.5 text-rose-600" /> Expense</span>
                  <span className="font-semibold text-rose-700">{fmt(t.expense, t.currency)}</span>
                </div>
                <div className="flex items-center justify-between text-sm pt-2 border-t border-gray-100">
                  <span className="text-gray-700 font-medium">Net</span>
                  <span className={`font-bold ${t.net >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{fmt(t.net, t.currency)}</span>
                </div>
                <div className="text-xs text-gray-500 pt-1">{t.count} {t.count === 1 ? 'entry' : 'entries'}</div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Category breakdown */}
      {categories.length > 0 && (
        <Card className="mb-4">
          <h3 className="font-semibold text-gray-900 mb-3">By category</h3>
          <div className="space-y-3">
            {totals.map(t => {
              const cur = t.currency;
              const inc = categories.filter(c => c.currency === cur && c.type === 'income');
              const exp = categories.filter(c => c.currency === cur && c.type === 'expense');
              return (
                <div key={cur}>
                  {totals.length > 1 && <div className="text-xs font-medium text-gray-500 mb-2">{cur}</div>}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <div className="text-xs font-medium text-emerald-700 mb-1.5">Income</div>
                      {inc.length === 0 ? <div className="text-xs text-gray-400">—</div> : (
                        <div className="space-y-1">
                          {inc.map(c => (
                            <div key={`${c.currency}|in|${c.category}`} className="flex items-center justify-between text-sm">
                              <span className="text-gray-700">{c.category}</span>
                              <span className="font-medium text-emerald-700">{fmt(c.amount, c.currency)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="text-xs font-medium text-rose-700 mb-1.5">Expense</div>
                      {exp.length === 0 ? <div className="text-xs text-gray-400">—</div> : (
                        <div className="space-y-1">
                          {exp.map(c => (
                            <div key={`${c.currency}|ex|${c.category}`} className="flex items-center justify-between text-sm">
                              <span className="text-gray-700">{c.category}</span>
                              <span className="font-medium text-rose-700">{fmt(c.amount, c.currency)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Table */}
      <Card>
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-gray-500" />
            <h3 className="font-semibold text-gray-900">Entries</h3>
            {rows && <span className="text-xs text-gray-500">({visibleRows.length})</span>}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              icon={<FileText className="w-4 h-4" />}
              onClick={() => exportLedger('pdf')}
              loading={exporting === 'pdf'}
              disabled={!rows || visibleRows.length === 0 || exporting !== null}
            >
              PDF
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<FileSpreadsheet className="w-4 h-4" />}
              onClick={() => exportLedger('xlsx')}
              loading={exporting === 'xlsx'}
              disabled={!rows || visibleRows.length === 0 || exporting !== null}
            >
              Excel
            </Button>
          </div>
        </div>

        {rows === null ? <LoadingSpinner /> : visibleRows.length === 0 ? (
          <EmptyState
            title="No entries in range"
            description="Try broadening the date range or enabling more sources."
            icon={<Calendar className="w-8 h-8 text-gray-400" />}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium text-gray-500 border-b border-gray-100">
                  <th className="py-2 pr-3 whitespace-nowrap">Date</th>
                  <th className="py-2 pr-3">Source</th>
                  <th className="py-2 pr-3">Category</th>
                  <th className="py-2 pr-3">Description</th>
                  <th className="py-2 pr-3 text-right whitespace-nowrap">In</th>
                  <th className="py-2 pr-3 text-right whitespace-nowrap">Out</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map(r => (
                  <tr key={r.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                    <td className="py-2 pr-3 text-gray-700 whitespace-nowrap">{r.date}</td>
                    <td className="py-2 pr-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        r.source === 'fee_payment' ? 'bg-emerald-50 text-emerald-700'
                        : r.source === 'staff_salary_payment' ? 'bg-amber-50 text-amber-700'
                        : 'bg-rose-50 text-rose-700'
                      }`}>
                        {SOURCE_LABELS[r.source]}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-gray-700">{r.category}</td>
                    <td className="py-2 pr-3 text-gray-900">
                      <div>{r.description}</div>
                      {r.reference && <div className="text-xs text-gray-500">{r.reference}</div>}
                    </td>
                    <td className="py-2 pr-3 text-right font-medium text-emerald-700 whitespace-nowrap">
                      {r.type === 'income' ? fmt(r.amount, r.currency) : ''}
                    </td>
                    <td className="py-2 pr-3 text-right font-medium text-rose-700 whitespace-nowrap">
                      {r.type === 'expense' ? fmt(r.amount, r.currency) : ''}
                    </td>
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
