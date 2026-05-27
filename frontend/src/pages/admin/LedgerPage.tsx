import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TableVirtuoso, type TableComponents } from 'react-virtuoso';
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

// i18n keys; resolved with t() at render.
const SOURCE_LABELS: Record<SourceKey, string> = {
  fee_payment: 'accounting.ledger.src_fee',
  staff_salary_payment: 'accounting.ledger.src_salary',
  expense: 'accounting.ledger.src_expense',
};

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// Stable (module-scope) virtualized-table components — Virtuoso requires
// referentially-stable component identities or it remounts every render.
const LEDGER_TABLE_COMPONENTS: TableComponents<LedgerRow> = {
  Table: (props) => <table {...props} className="w-full text-sm" />,
  TableBody: forwardRef<HTMLTableSectionElement>((props, ref) => <tbody {...props} ref={ref} />),
  TableRow: (props) => <tr {...props} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60" />,
};

export default function LedgerPage() {
  const { t } = useTranslation();
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

  // `rows` accumulates across pages. `totals`/`categories` are whole-set
  // figures returned by the backend on every page (computed over the full
  // filtered set, never the page) — a page boundary cannot change a number.
  const [rows, setRows] = useState<LedgerRow[] | null>(null);
  const [totals, setTotals] = useState<LedgerCurrencyTotal[]>([]);
  const [categories, setCategories] = useState<LedgerCategoryTotal[]>([]);
  const [defaultCurrency, setDefaultCurrency] = useState('USD');
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const cursorRef = useRef<string | null>(null);
  const reqIdRef = useRef(0);

  // type filter is now applied server-side so it composes with pagination
  // (filtering only the current page would be wrong). It does NOT affect
  // the summary cards — those stay whole-set, matching prior behavior.
  const load = useCallback(async (cursor: string | null, typeOverride?: typeof typeFilter) => {
    const effType = typeOverride ?? typeFilter;
    const enabled = (Object.keys(enabledSources) as SourceKey[]).filter(k => enabledSources[k]);
    if (cursor === null) {
      setRows(null);
      cursorRef.current = null;
      setHasMore(false);
      if (enabled.length === 0) { setRows([]); setTotals([]); setCategories([]); return; }
    } else if (loadingMore || !cursorRef.current) {
      return;
    }
    const myReq = ++reqIdRef.current;
    if (cursor !== null) setLoadingMore(true);
    try {
      const r = await ledgerApi.get({
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        sources: enabled.join(','),
        currency: currencyFilter || undefined,
        type: effType === 'all' ? undefined : effType,
        cursor: cursor || undefined,
      });
      // A newer reload superseded this in-flight page — drop it.
      if (myReq !== reqIdRef.current) return;
      cursorRef.current = r.data.nextCursor;
      setHasMore(!!r.data.nextCursor);
      setRows(prev => (cursor === null || !prev ? r.data.rows : [...prev, ...r.data.rows]));
      if (cursor === null) {
        setTotals(r.data.totals);
        setCategories(r.data.categories);
        setDefaultCurrency(r.data.defaultCurrency);
      }
    } catch (e: any) {
      if (myReq === reqIdRef.current && cursor === null) {
        toast.error(e.response?.data?.error || t('accounting.ledger.load_failed'));
        setRows([]);
      }
      // a failed page-load keeps what we have; next scroll retries
    } finally {
      if (cursor !== null) setLoadingMore(false);
    }
  }, [typeFilter, enabledSources, startDate, endDate, currencyFilter, loadingMore]);

  const reload = useCallback(() => load(null), [load]);
  const loadMore = useCallback(() => { if (cursorRef.current) load(cursorRef.current); }, [load]);

  useEffect(() => { load(null); /* eslint-disable-next-line */ }, []);

  // type filter is server-side now → reload from the first page on change
  const onChangeType = (v: 'all' | 'income' | 'expense') => {
    setTypeFilter(v);
    load(null, v);
  };

  const visibleRows = rows ?? [];

  const [exporting, setExporting] = useState<'pdf' | 'xlsx' | null>(null);
  const exportLedger = async (kind: 'pdf' | 'xlsx') => {
    const enabled = (Object.keys(enabledSources) as SourceKey[]).filter(k => enabledSources[k]);
    if (enabled.length === 0) { toast.info(t('accounting.ledger.pick_source')); return; }
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
      toast.error(e.response?.data?.error || t('accounting.ledger.export_failed', { format: kind.toUpperCase() }));
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
      <PageLayout title={t('accounting.ledger.title')} subtitle={t('accounting.premium_subtitle')}>
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 max-w-xl">
          <h3 className="font-semibold text-amber-900 mb-1">{t('accounting.tuition.not_enabled_title')}</h3>
          <p className="text-sm text-amber-800">
            {t('accounting.tuition.not_enabled_body')}
          </p>
        </div>
      </PageLayout>
    );
  }
  if (!canWrite) {
    return (
      <PageLayout title={t('accounting.ledger.title')} subtitle={t('accounting.tuition.restricted')}>
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 max-w-xl">
          <p className="text-sm text-amber-800">{t('accounting.ledger.no_access')}</p>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout title={t('accounting.ledger.title')} subtitle={t('accounting.ledger.subtitle')}>
      {/* Filters */}
      <Card className="mb-4">
        <div className="flex items-center gap-2 mb-3">
          <FilterIcon className="w-4 h-4 text-gray-500" />
          <h3 className="font-semibold text-gray-900">{t('accounting.ledger.filters')}</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
          <Input label={t('accounting.ledger.from')} type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
          <Input label={t('accounting.ledger.to')} type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
          <Select
            label={t('accounting.ledger.currency')}
            options={[{ value: '', label: t('accounting.tuition.all') }, ...Array.from(new Set([defaultCurrency, ...totals.map(tot => tot.currency)])).map(c => ({ value: c, label: c }))]}
            value={currencyFilter}
            onChange={e => setCurrencyFilter(e.target.value)}
          />
          <Select
            label={t('accounting.ledger.direction')}
            options={[
              { value: 'all', label: t('accounting.tuition.all') },
              { value: 'income', label: t('accounting.ledger.income_only') },
              { value: 'expense', label: t('accounting.ledger.expense_only') },
            ]}
            value={typeFilter}
            onChange={e => onChangeType(e.target.value as any)}
          />
          <div className="flex items-end">
            <Button onClick={reload} fullWidth>{t('accounting.ledger.apply')}</Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-3">
          <button onClick={() => setQuickRange('this_month')} className="text-xs px-2.5 py-1 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700">{t('accounting.ledger.range_this_month')}</button>
          <button onClick={() => setQuickRange('last_month')} className="text-xs px-2.5 py-1 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700">{t('accounting.ledger.range_last_month')}</button>
          <button onClick={() => setQuickRange('last_30')} className="text-xs px-2.5 py-1 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700">{t('accounting.ledger.range_last_30')}</button>
          <button onClick={() => setQuickRange('last_90')} className="text-xs px-2.5 py-1 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700">{t('accounting.ledger.range_last_90')}</button>
          <button onClick={() => setQuickRange('ytd')} className="text-xs px-2.5 py-1 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700">{t('accounting.ledger.range_ytd')}</button>
        </div>

        <div className="flex flex-wrap gap-3 pt-3 border-t border-gray-100">
          <span className="text-sm text-gray-600">{t('accounting.ledger.sources_label')}</span>
          {(Object.keys(SOURCE_LABELS) as SourceKey[]).map(k => (
            <label key={k} className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={enabledSources[k]}
                onChange={e => setEnabledSources(s => ({ ...s, [k]: e.target.checked }))}
                className="w-4 h-4 text-primary-600"
              />
              {t(SOURCE_LABELS[k])}
            </label>
          ))}
        </div>
      </Card>

      {/* Summary cards per currency */}
      {totals.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
          {totals.map(tot => (
            <Card key={tot.currency}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-gray-500">{tot.currency}</span>
                <Wallet className="w-4 h-4 text-gray-400" />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600 flex items-center gap-1"><TrendingUp className="w-3.5 h-3.5 text-emerald-600" /> {t('accounting.income')}</span>
                  <span className="font-semibold text-emerald-700">{fmt(tot.income, tot.currency)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600 flex items-center gap-1"><TrendingDown className="w-3.5 h-3.5 text-rose-600" /> {t('accounting.expense')}</span>
                  <span className="font-semibold text-rose-700">{fmt(tot.expense, tot.currency)}</span>
                </div>
                <div className="flex items-center justify-between text-sm pt-2 border-t border-gray-100">
                  <span className="text-gray-700 font-medium">{t('accounting.net')}</span>
                  <span className={`font-bold ${tot.net >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{fmt(tot.net, tot.currency)}</span>
                </div>
                <div className="text-xs text-gray-500 pt-1">{tot.count} {tot.count === 1 ? t('accounting.ledger.entry_one') : t('accounting.ledger.entry_many')}</div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Category breakdown */}
      {categories.length > 0 && (
        <Card className="mb-4">
          <h3 className="font-semibold text-gray-900 mb-3">{t('accounting.ledger.by_category')}</h3>
          <div className="space-y-3">
            {totals.map(tot => {
              const cur = tot.currency;
              const inc = categories.filter(c => c.currency === cur && c.type === 'income');
              const exp = categories.filter(c => c.currency === cur && c.type === 'expense');
              return (
                <div key={cur}>
                  {totals.length > 1 && <div className="text-xs font-medium text-gray-500 mb-2">{cur}</div>}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <div className="text-xs font-medium text-emerald-700 mb-1.5">{t('accounting.income')}</div>
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
                      <div className="text-xs font-medium text-rose-700 mb-1.5">{t('accounting.expense')}</div>
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
            <h3 className="font-semibold text-gray-900">{t('accounting.ledger.entries')}</h3>
            {rows && <span className="text-xs text-gray-500">({visibleRows.length}{hasMore ? '+' : ''})</span>}
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
              {t('accounting.archive.pdf')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<FileSpreadsheet className="w-4 h-4" />}
              onClick={() => exportLedger('xlsx')}
              loading={exporting === 'xlsx'}
              disabled={!rows || visibleRows.length === 0 || exporting !== null}
            >
              {t('accounting.archive.excel')}
            </Button>
          </div>
        </div>

        {rows === null ? <LoadingSpinner /> : visibleRows.length === 0 ? (
          <EmptyState
            title={t('accounting.ledger.no_entries_title')}
            description={t('accounting.ledger.no_entries_desc')}
            icon={<Calendar className="w-8 h-8 text-gray-400" />}
          />
        ) : (
          <div className="overflow-x-auto">
            <TableVirtuoso
              useWindowScroll
              data={visibleRows}
              components={LEDGER_TABLE_COMPONENTS}
              increaseViewportBy={600}
              // Seamless background load — fires before the user hits bottom.
              endReached={() => loadMore()}
              fixedHeaderContent={() => (
                <tr className="text-left text-xs font-medium text-gray-500 border-b border-gray-100 bg-white">
                  <th className="py-2 pr-3 whitespace-nowrap">{t('accounting.ledger.col_date')}</th>
                  <th className="py-2 pr-3">{t('accounting.ledger.col_source')}</th>
                  <th className="py-2 pr-3">{t('accounting.ledger.col_category')}</th>
                  <th className="py-2 pr-3">{t('accounting.ledger.col_description')}</th>
                  <th className="py-2 pr-3 text-right whitespace-nowrap">{t('accounting.ledger.col_in')}</th>
                  <th className="py-2 pr-3 text-right whitespace-nowrap">{t('accounting.ledger.col_out')}</th>
                </tr>
              )}
              itemContent={(_i, r) => (
                <>
                  <td className="py-2 pr-3 text-gray-700 whitespace-nowrap">{r.date}</td>
                  <td className="py-2 pr-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      r.source === 'fee_payment' ? 'bg-emerald-50 text-emerald-700'
                      : r.source === 'staff_salary_payment' ? 'bg-amber-50 text-amber-700'
                      : 'bg-rose-50 text-rose-700'
                    }`}>
                      {t(SOURCE_LABELS[r.source])}
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
                </>
              )}
            />
            {loadingMore && (
              <div className="py-3 text-center text-xs text-gray-400">{t('accounting.ledger.loading_more')}</div>
            )}
          </div>
        )}
      </Card>
    </PageLayout>
  );
}
