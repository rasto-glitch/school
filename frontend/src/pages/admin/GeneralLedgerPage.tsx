import { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { Scale, BookText, ListTree, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { glApi, type GlAccount, type TrialBalanceCurrency, type JournalEntry } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Input from '../../components/common/Input';
import Button from '../../components/common/Button';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';
import { fmtMoney as fmt } from '../../utils/money';

type Tab = 'trial' | 'accounts' | 'journal';

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

const TYPE_LABELS: Record<string, string> = {
  asset: 'Assets',
  liability: 'Liabilities',
  equity: 'Equity',
  income: 'Income',
  expense: 'Expenses',
};

const TYPE_ORDER = ['asset', 'liability', 'equity', 'income', 'expense'];

const SOURCE_LABELS: Record<string, string> = {
  tuition_billing: 'Tuition billed',
  fee_payment: 'Tuition payment',
  refund: 'Refund',
  expense: 'Expense',
  salary: 'Salary',
  insurance_payout: 'Insurance payout',
  late_fee: 'Late fee',
  manual: 'Manual entry',
  reversal: 'Reversal',
  opening: 'Opening balance',
};

export default function GeneralLedgerPage() {
  const { school } = useAuthStore();
  const isPremium = school?.features?.tuition_fees === true;

  const [tab, setTab] = useState<Tab>('trial');

  // Trial balance
  const [asOf, setAsOf] = useState<string>(todayISO());
  const [tb, setTb] = useState<TrialBalanceCurrency[] | null>(null);
  const [tbLoading, setTbLoading] = useState(false);

  // Chart of accounts
  const [accounts, setAccounts] = useState<GlAccount[] | null>(null);

  // Journal
  const [journal, setJournal] = useState<JournalEntry[] | null>(null);

  const loadTrialBalance = useCallback(async (asOfDate: string) => {
    setTbLoading(true);
    try {
      const r = await glApi.trialBalance({ asOf: asOfDate || undefined });
      setTb(r.data.currencies);
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to load trial balance');
      setTb([]);
    } finally {
      setTbLoading(false);
    }
  }, []);

  const loadAccounts = useCallback(async () => {
    try {
      const r = await glApi.accounts();
      setAccounts(r.data);
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to load chart of accounts');
      setAccounts([]);
    }
  }, []);

  const loadJournal = useCallback(async () => {
    try {
      const r = await glApi.journal({ limit: 100 });
      setJournal(r.data);
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to load journal');
      setJournal([]);
    }
  }, []);

  useEffect(() => {
    if (!isPremium) return;
    if (tab === 'trial' && tb === null) loadTrialBalance(asOf);
    if (tab === 'accounts' && accounts === null) loadAccounts();
    if (tab === 'journal' && journal === null) loadJournal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, isPremium]);

  if (!isPremium) {
    return (
      <PageLayout title="General Ledger" subtitle="Premium feature">
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 max-w-xl">
          <h3 className="font-semibold text-amber-900 mb-1">Accounting module not enabled</h3>
          <p className="text-sm text-amber-800">
            The accounting module is part of the Premium plan. Contact Scholify to enable it for your school.
          </p>
        </div>
      </PageLayout>
    );
  }

  const tabs: { key: Tab; label: string; icon: typeof Scale }[] = [
    { key: 'trial', label: 'Trial Balance', icon: Scale },
    { key: 'accounts', label: 'Chart of Accounts', icon: ListTree },
    { key: 'journal', label: 'Journal', icon: BookText },
  ];

  return (
    <PageLayout title="General Ledger" subtitle="Double-entry book of record — every transaction, immutable and balanced">
      {/* Tabs */}
      <div className="flex flex-wrap gap-2 mb-4">
        {tabs.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                tab === t.key ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'trial' && (
        <>
          <Card className="mb-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <Input label="As of" type="date" value={asOf} onChange={e => setAsOf(e.target.value)} />
              <div className="flex items-end">
                <Button onClick={() => loadTrialBalance(asOf)} loading={tbLoading} fullWidth>Apply</Button>
              </div>
            </div>
          </Card>

          {tb === null || tbLoading ? <LoadingSpinner /> : tb.length === 0 ? (
            <EmptyState
              title="Nothing posted yet"
              description="Once tuition is billed or payments are recorded, balanced entries appear here."
              icon={<Scale className="w-8 h-8 text-gray-400" />}
            />
          ) : (
            tb.map(block => (
              <Card key={block.currency} className="mb-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-900">Trial Balance · {block.currency}</h3>
                  {block.balanced ? (
                    <span className="flex items-center gap-1 text-xs text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Balanced
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full">
                      <AlertTriangle className="w-3.5 h-3.5" /> Out of balance
                    </span>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs font-medium text-gray-500 border-b border-gray-100">
                        <th className="py-2 pr-3 whitespace-nowrap">Code</th>
                        <th className="py-2 pr-3">Account</th>
                        <th className="py-2 pr-3 text-right whitespace-nowrap">Debit</th>
                        <th className="py-2 pr-3 text-right whitespace-nowrap">Credit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {block.accounts.map(a => (
                        <tr key={a.accountId} className="border-b border-gray-50 last:border-0">
                          <td className="py-2 pr-3 text-gray-500 font-mono text-xs whitespace-nowrap">{a.code}</td>
                          <td className="py-2 pr-3 text-gray-900">{a.name}</td>
                          <td className="py-2 pr-3 text-right font-medium text-gray-900 whitespace-nowrap">
                            {a.debit ? fmt(a.debit, block.currency) : ''}
                          </td>
                          <td className="py-2 pr-3 text-right font-medium text-gray-900 whitespace-nowrap">
                            {a.credit ? fmt(a.credit, block.currency) : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-gray-200 font-semibold text-gray-900">
                        <td className="py-2 pr-3" colSpan={2}>Totals</td>
                        <td className="py-2 pr-3 text-right whitespace-nowrap">{fmt(block.totalDebit, block.currency)}</td>
                        <td className="py-2 pr-3 text-right whitespace-nowrap">{fmt(block.totalCredit, block.currency)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </Card>
            ))
          )}
        </>
      )}

      {tab === 'accounts' && (
        <Card>
          <h3 className="font-semibold text-gray-900 mb-3">Chart of Accounts</h3>
          {accounts === null ? <LoadingSpinner /> : accounts.length === 0 ? (
            <EmptyState title="No accounts" description="The chart is seeded on first use." icon={<ListTree className="w-8 h-8 text-gray-400" />} />
          ) : (
            <div className="space-y-5">
              {TYPE_ORDER.filter(type => accounts.some(a => a.type === type)).map(type => (
                <div key={type}>
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">{TYPE_LABELS[type]}</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <tbody>
                        {accounts.filter(a => a.type === type).map(a => (
                          <tr key={a.id} className="border-b border-gray-50 last:border-0">
                            <td className="py-2 pr-3 text-gray-500 font-mono text-xs whitespace-nowrap w-16">{a.code}</td>
                            <td className="py-2 pr-3 text-gray-900">
                              {a.name}
                              {!a.isActive && <span className="ml-2 text-xs text-gray-400">(inactive)</span>}
                            </td>
                            <td className="py-2 pr-3 text-right">
                              {a.isSystem && <span className="text-xs text-gray-400">system</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === 'journal' && (
        <Card>
          <h3 className="font-semibold text-gray-900 mb-3">Journal</h3>
          {journal === null ? <LoadingSpinner /> : journal.length === 0 ? (
            <EmptyState
              title="No journal entries yet"
              description="Entries are posted automatically as tuition is billed and payments are recorded."
              icon={<BookText className="w-8 h-8 text-gray-400" />}
            />
          ) : (
            <div className="space-y-3">
              {journal.map(e => (
                <div key={e.id} className="border border-gray-100 rounded-xl p-3">
                  <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-gray-400">#{e.entryNo}</span>
                      <span className="text-sm text-gray-700">{e.entryDate}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                        {SOURCE_LABELS[e.source] ?? e.source}
                      </span>
                      {e.isReversal && <span className="text-xs px-2 py-0.5 rounded-full bg-rose-50 text-rose-700">reversal</span>}
                    </div>
                    {e.memo && <span className="text-xs text-gray-500">{e.memo}</span>}
                  </div>
                  <table className="w-full text-sm">
                    <tbody>
                      {e.lines.map((l, i) => (
                        <tr key={i}>
                          <td className="py-1 pr-3 text-gray-400 font-mono text-xs whitespace-nowrap w-16">{l.code}</td>
                          <td className="py-1 pr-3 text-gray-800">
                            {l.name}
                            {l.description && <span className="text-gray-400"> — {l.description}</span>}
                          </td>
                          <td className="py-1 pr-3 text-right text-gray-900 whitespace-nowrap w-28">
                            {l.debit ? fmt(l.debit, l.currency) : ''}
                          </td>
                          <td className="py-1 pr-3 text-right text-gray-900 whitespace-nowrap w-28">
                            {l.credit ? fmt(l.credit, l.currency) : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </PageLayout>
  );
}
