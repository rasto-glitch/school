import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { toast } from 'react-toastify';
import { Scale, BookText, ListTree, CheckCircle2, AlertTriangle, TrendingUp, FileBarChart } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import {
  glApi,
  type GlAccount, type TrialBalanceCurrency, type JournalEntry,
  type IncomeStatementCurrency, type BalanceSheetCurrency, type AccountLedger,
} from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Input from '../../components/common/Input';
import Button from '../../components/common/Button';
import Modal from '../../components/common/Modal';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';
import { fmtMoney as fmt } from '../../utils/money';

type Tab = 'trial' | 'pl' | 'balance' | 'accounts' | 'journal';

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function firstOfYearISO(): string {
  return new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1)).toISOString().slice(0, 10);
}

const TYPE_LABELS: Record<string, string> = {
  asset: 'Assets', liability: 'Liabilities', equity: 'Equity', income: 'Income', expense: 'Expenses',
};
const TYPE_ORDER = ['asset', 'liability', 'equity', 'income', 'expense'];

const SOURCE_LABELS: Record<string, string> = {
  tuition_billing: 'Tuition billed', fee_payment: 'Tuition payment', refund: 'Refund',
  expense: 'Expense', salary: 'Salary', insurance_payout: 'Insurance payout',
  late_fee: 'Late fee', manual: 'Manual entry', reversal: 'Reversal', opening: 'Opening balance',
};

export default function GeneralLedgerPage() {
  const { school } = useAuthStore();
  const isPremium = school?.features?.tuition_fees === true;

  const [tab, setTab] = useState<Tab>('trial');

  // Trial balance
  const [asOf, setAsOf] = useState<string>(todayISO());
  const [tb, setTb] = useState<TrialBalanceCurrency[] | null>(null);
  const [tbLoading, setTbLoading] = useState(false);

  // P&L
  const [plStart, setPlStart] = useState<string>(firstOfYearISO());
  const [plEnd, setPlEnd] = useState<string>(todayISO());
  const [pl, setPl] = useState<IncomeStatementCurrency[] | null>(null);
  const [plLoading, setPlLoading] = useState(false);

  // Balance sheet
  const [bsAsOf, setBsAsOf] = useState<string>(todayISO());
  const [bs, setBs] = useState<BalanceSheetCurrency[] | null>(null);
  const [bsLoading, setBsLoading] = useState(false);

  // Chart of accounts
  const [accounts, setAccounts] = useState<GlAccount[] | null>(null);

  // Journal
  const [journal, setJournal] = useState<JournalEntry[] | null>(null);

  // Account drill-down modal
  const [ledger, setLedger] = useState<AccountLedger | null>(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);

  const loadTrialBalance = useCallback(async (d: string) => {
    setTbLoading(true);
    try { setTb((await glApi.trialBalance({ asOf: d || undefined })).data.currencies); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed to load trial balance'); setTb([]); }
    finally { setTbLoading(false); }
  }, []);

  const loadPl = useCallback(async (s: string, e: string) => {
    setPlLoading(true);
    try { setPl((await glApi.incomeStatement({ startDate: s || undefined, endDate: e || undefined })).data.currencies); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Failed to load income statement'); setPl([]); }
    finally { setPlLoading(false); }
  }, []);

  const loadBs = useCallback(async (d: string) => {
    setBsLoading(true);
    try { setBs((await glApi.balanceSheet({ asOf: d || undefined })).data.currencies); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed to load balance sheet'); setBs([]); }
    finally { setBsLoading(false); }
  }, []);

  const loadAccounts = useCallback(async () => {
    try { setAccounts((await glApi.accounts()).data); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed to load chart of accounts'); setAccounts([]); }
  }, []);

  const loadJournal = useCallback(async () => {
    try { setJournal((await glApi.journal({ limit: 100 })).data); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed to load journal'); setJournal([]); }
  }, []);

  const openAccount = useCallback(async (id: string) => {
    setLedgerLoading(true);
    setLedger({ account: { id, code: '', name: '', type: '' }, debitNormal: true, startDate: null, endDate: null, currencies: [] });
    try { setLedger((await glApi.accountLedger(id)).data); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed to load account'); setLedger(null); }
    finally { setLedgerLoading(false); }
  }, []);

  useEffect(() => {
    if (!isPremium) return;
    if (tab === 'trial' && tb === null) loadTrialBalance(asOf);
    if (tab === 'pl' && pl === null) loadPl(plStart, plEnd);
    if (tab === 'balance' && bs === null) loadBs(bsAsOf);
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
    { key: 'pl', label: 'Income (P&L)', icon: TrendingUp },
    { key: 'balance', label: 'Balance Sheet', icon: FileBarChart },
    { key: 'accounts', label: 'Chart of Accounts', icon: ListTree },
    { key: 'journal', label: 'Journal', icon: BookText },
  ];

  const acctBtn = (id: string, label: ReactNode) => (
    <button onClick={() => openAccount(id)} className="text-left hover:text-primary-700 hover:underline">{label}</button>
  );

  return (
    <PageLayout title="General Ledger" subtitle="Double-entry book of record — every transaction, immutable and balanced">
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

      {/* ── Trial Balance ── */}
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
            <EmptyState title="Nothing posted yet" description="Once tuition is billed or payments are recorded, balanced entries appear here." icon={<Scale className="w-8 h-8 text-gray-400" />} />
          ) : tb.map(block => (
            <Card key={block.currency} className="mb-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900">Trial Balance · {block.currency}</h3>
                <BalancedBadge balanced={block.balanced} />
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
                        <td className="py-2 pr-3 text-gray-900">{acctBtn(a.accountId, a.name)}</td>
                        <td className="py-2 pr-3 text-right font-medium text-gray-900 whitespace-nowrap">{a.debit ? fmt(a.debit, block.currency) : ''}</td>
                        <td className="py-2 pr-3 text-right font-medium text-gray-900 whitespace-nowrap">{a.credit ? fmt(a.credit, block.currency) : ''}</td>
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
          ))}
        </>
      )}

      {/* ── Income Statement (P&L) ── */}
      {tab === 'pl' && (
        <>
          <Card className="mb-4">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
              <Input label="From" type="date" value={plStart} onChange={e => setPlStart(e.target.value)} />
              <Input label="To" type="date" value={plEnd} onChange={e => setPlEnd(e.target.value)} />
              <div className="flex items-end">
                <Button onClick={() => loadPl(plStart, plEnd)} loading={plLoading} fullWidth>Apply</Button>
              </div>
            </div>
          </Card>
          {pl === null || plLoading ? <LoadingSpinner /> : pl.length === 0 ? (
            <EmptyState title="No income or expenses in range" description="Try a wider date range." icon={<TrendingUp className="w-8 h-8 text-gray-400" />} />
          ) : pl.map(b => (
            <Card key={b.currency} className="mb-4">
              <h3 className="font-semibold text-gray-900 mb-3">Income Statement · {b.currency}</h3>
              <Section title="Income" rows={b.income} currency={b.currency} total={b.totalIncome} totalLabel="Total income" tone="emerald" />
              <div className="h-3" />
              <Section title="Expenses" rows={b.expense} currency={b.currency} total={b.totalExpense} totalLabel="Total expenses" tone="rose" />
              <div className="flex items-center justify-between mt-3 pt-3 border-t-2 border-gray-200">
                <span className="font-semibold text-gray-900">Net {b.netIncome >= 0 ? 'profit' : 'loss'}</span>
                <span className={`font-bold ${b.netIncome >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{fmt(b.netIncome, b.currency)}</span>
              </div>
            </Card>
          ))}
        </>
      )}

      {/* ── Balance Sheet ── */}
      {tab === 'balance' && (
        <>
          <Card className="mb-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <Input label="As of" type="date" value={bsAsOf} onChange={e => setBsAsOf(e.target.value)} />
              <div className="flex items-end">
                <Button onClick={() => loadBs(bsAsOf)} loading={bsLoading} fullWidth>Apply</Button>
              </div>
            </div>
          </Card>
          {bs === null || bsLoading ? <LoadingSpinner /> : bs.length === 0 ? (
            <EmptyState title="Nothing on the books yet" description="Record some transactions to populate the balance sheet." icon={<FileBarChart className="w-8 h-8 text-gray-400" />} />
          ) : bs.map(b => (
            <Card key={b.currency} className="mb-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900">Balance Sheet · {b.currency}</h3>
                <BalancedBadge balanced={b.balanced} />
              </div>
              <Section title="Assets" rows={b.assets} currency={b.currency} total={b.totalAssets} totalLabel="Total assets" tone="gray" />
              <div className="h-3" />
              <Section title="Liabilities" rows={b.liabilities} currency={b.currency} total={b.totalLiabilities} totalLabel="Total liabilities" tone="gray" />
              <div className="h-3" />
              <Section
                title="Equity" currency={b.currency} tone="gray"
                rows={[...b.equity, { code: '', name: 'Current period earnings', amount: b.currentEarnings }]}
                total={b.totalEquity} totalLabel="Total equity"
              />
              <div className="flex items-center justify-between mt-3 pt-3 border-t-2 border-gray-200">
                <span className="font-semibold text-gray-900">Liabilities + Equity</span>
                <span className="font-bold text-gray-900">{fmt(b.totalLiabilities + b.totalEquity, b.currency)}</span>
              </div>
            </Card>
          ))}
        </>
      )}

      {/* ── Chart of Accounts ── */}
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
                              {acctBtn(a.id, a.name)}
                              {!a.isActive && <span className="ml-2 text-xs text-gray-400">(inactive)</span>}
                            </td>
                            <td className="py-2 pr-3 text-right">{a.isSystem && <span className="text-xs text-gray-400">system</span>}</td>
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

      {/* ── Journal ── */}
      {tab === 'journal' && (
        <Card>
          <h3 className="font-semibold text-gray-900 mb-3">Journal</h3>
          {journal === null ? <LoadingSpinner /> : journal.length === 0 ? (
            <EmptyState title="No journal entries yet" description="Entries are posted automatically as money moves." icon={<BookText className="w-8 h-8 text-gray-400" />} />
          ) : (
            <div className="space-y-3">
              {journal.map(e => (
                <div key={e.id} className="border border-gray-100 rounded-xl p-3">
                  <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-gray-400">#{e.entryNo}</span>
                      <span className="text-sm text-gray-700">{e.entryDate}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{SOURCE_LABELS[e.source] ?? e.source}</span>
                      {e.isReversal && <span className="text-xs px-2 py-0.5 rounded-full bg-rose-50 text-rose-700">reversal</span>}
                    </div>
                    {e.memo && <span className="text-xs text-gray-500">{e.memo}</span>}
                  </div>
                  <table className="w-full text-sm">
                    <tbody>
                      {e.lines.map((l, i) => (
                        <tr key={i}>
                          <td className="py-1 pr-3 text-gray-400 font-mono text-xs whitespace-nowrap w-16">{l.code}</td>
                          <td className="py-1 pr-3 text-gray-800">{l.name}{l.description && <span className="text-gray-400"> — {l.description}</span>}</td>
                          <td className="py-1 pr-3 text-right text-gray-900 whitespace-nowrap w-28">{l.debit ? fmt(l.debit, l.currency) : ''}</td>
                          <td className="py-1 pr-3 text-right text-gray-900 whitespace-nowrap w-28">{l.credit ? fmt(l.credit, l.currency) : ''}</td>
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

      {/* ── Account drill-down ── */}
      <Modal isOpen={ledger !== null} onClose={() => setLedger(null)} title={ledger ? `${ledger.account.code} ${ledger.account.name}`.trim() : 'Account'} size="xl">
        {ledgerLoading || !ledger ? <LoadingSpinner /> : ledger.currencies.length === 0 ? (
          <p className="text-sm text-gray-500 py-4">No activity on this account.</p>
        ) : (
          <div className="space-y-5">
            {ledger.currencies.map(c => (
              <div key={c.currency}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">{c.currency}</span>
                  <span className="text-xs text-gray-500">Opening {fmt(c.opening, c.currency)} · Closing <strong className="text-gray-800">{fmt(c.closing, c.currency)}</strong></span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs font-medium text-gray-500 border-b border-gray-100">
                        <th className="py-2 pr-3 whitespace-nowrap">Date</th>
                        <th className="py-2 pr-3">Description</th>
                        <th className="py-2 pr-3 text-right whitespace-nowrap">Debit</th>
                        <th className="py-2 pr-3 text-right whitespace-nowrap">Credit</th>
                        <th className="py-2 pr-3 text-right whitespace-nowrap">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.rows.map((r, i) => (
                        <tr key={i} className="border-b border-gray-50 last:border-0">
                          <td className="py-1.5 pr-3 text-gray-600 whitespace-nowrap">{r.date}</td>
                          <td className="py-1.5 pr-3 text-gray-800">
                            <span className="text-xs text-gray-400 mr-1">#{r.entryNo}</span>
                            {SOURCE_LABELS[r.source] ?? r.source}{r.memo ? ` · ${r.memo}` : ''}
                          </td>
                          <td className="py-1.5 pr-3 text-right whitespace-nowrap">{r.debit ? fmt(r.debit, c.currency) : ''}</td>
                          <td className="py-1.5 pr-3 text-right whitespace-nowrap">{r.credit ? fmt(r.credit, c.currency) : ''}</td>
                          <td className="py-1.5 pr-3 text-right font-medium text-gray-900 whitespace-nowrap">{fmt(r.balance, c.currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </PageLayout>
  );
}

function BalancedBadge({ balanced }: { balanced: boolean }) {
  return balanced ? (
    <span className="flex items-center gap-1 text-xs text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
      <CheckCircle2 className="w-3.5 h-3.5" /> Balanced
    </span>
  ) : (
    <span className="flex items-center gap-1 text-xs text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full">
      <AlertTriangle className="w-3.5 h-3.5" /> Out of balance
    </span>
  );
}

function Section({ title, rows, currency, total, totalLabel, tone }: {
  title: string;
  rows: { code: string; name: string; amount: number }[];
  currency: string;
  total: number;
  totalLabel: string;
  tone: 'emerald' | 'rose' | 'gray';
}) {
  const toneClass = tone === 'emerald' ? 'text-emerald-700' : tone === 'rose' ? 'text-rose-700' : 'text-gray-900';
  return (
    <div>
      <div className={`text-xs font-semibold uppercase tracking-wide mb-1.5 ${tone === 'gray' ? 'text-gray-500' : toneClass}`}>{title}</div>
      {rows.length === 0 ? <div className="text-xs text-gray-400 mb-1">—</div> : (
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.code}-${i}`} className="border-b border-gray-50 last:border-0">
                <td className="py-1.5 pr-3 text-gray-500 font-mono text-xs whitespace-nowrap w-16">{r.code}</td>
                <td className="py-1.5 pr-3 text-gray-800">{r.name}</td>
                <td className={`py-1.5 pr-3 text-right font-medium whitespace-nowrap ${toneClass}`}>{fmt(r.amount, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="flex items-center justify-between pt-1.5 mt-0.5 border-t border-gray-100 text-sm">
        <span className="font-medium text-gray-700">{totalLabel}</span>
        <span className="font-semibold text-gray-900">{fmt(total, currency)}</span>
      </div>
    </div>
  );
}
