import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp, TrendingDown, Wallet, AlertCircle, CalendarClock, Receipt as ReceiptIcon, BookOpenCheck, FileBarChart, ArrowRight, BarChart3 } from 'lucide-react';
import { toast } from 'react-toastify';
import { useAuthStore } from '../../store/authStore';
import { accountingApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import { fmtMoney } from '../../utils/money';

interface DashboardData {
  defaultCurrency: string;
  period: { from: string; to: string };
  monthByCurrency: { currency: string; income: number; expense: number; net: number }[];
  arByCurrency: { currency: string; balance: number }[];
  arStudentCount: number;
  upcomingSalaries: { id: string; fullName: string; amount: number; currency: string; nextPaymentDate: string }[];
  upcomingRecurringExpenses: { id: string; name: string; amount: number; currency: string; nextDueDate: string }[];
}

export default function AccountingDashboardPage() {
  const { school, user } = useAuthStore();
  const isPremium = school?.features?.tuition_fees === true;
  const role = user?.role;
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    if (!isPremium) return;
    accountingApi.getDashboard()
      .then(r => setData(r.data as DashboardData))
      .catch((e: any) => toast.error(e.response?.data?.error || 'Failed to load dashboard'));
  }, [isPremium]);

  if (!isPremium) {
    return (
      <PageLayout title="Accounting" subtitle="Premium feature">
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 max-w-xl">
          <p className="text-sm text-amber-800">The accounting module is part of the Premium plan.</p>
        </div>
      </PageLayout>
    );
  }
  if (!data) return <PageLayout title="Accounting"><LoadingSpinner /></PageLayout>;

  const reports: { to: string; icon: any; label: string; desc: string }[] = [
    { to: '/accounting/reports/ar-aging', icon: AlertCircle, label: 'AR aging', desc: 'Outstanding balances bucketed by overdue days' },
    { to: '/accounting/reports/profit-loss', icon: FileBarChart, label: 'Profit & Loss', desc: 'Income vs expense by category, period compare' },
    { to: '/accounting/reports/cash-flow', icon: BarChart3, label: 'Cash flow forecast', desc: 'Projected inflows and outflows by week' },
    { to: '/accounting/reports/tax', icon: ReceiptIcon, label: 'Tax report', desc: 'Tax / withholding collected by label' },
    { to: '/accounting/ledger', icon: BookOpenCheck, label: 'Ledger', desc: 'Every money movement, exportable' },
    { to: '/accounting/periods', icon: CalendarClock, label: 'Periods', desc: 'Close months/years to lock history' },
    { to: '/accounting/payment-accounts', icon: Wallet, label: 'Payment accounts', desc: 'Cash drawers, bank tills, balances' },
  ];

  return (
    <PageLayout title="Accounting" subtitle={role === 'accountant' ? `Welcome${user?.firstName ? `, ${user.firstName}` : ''}` : 'Money movement at a glance'}>
      {/* This month per currency */}
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">This month — {data.period.from} → {data.period.to}</h3>
      {data.monthByCurrency.length === 0 ? (
        <Card className="mb-6"><p className="text-sm text-gray-500">No movements this month yet.</p></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
          {data.monthByCurrency.map(t => (
            <Card key={t.currency}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-gray-500">{t.currency}</span>
                <Wallet className="w-4 h-4 text-gray-400" />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600 flex items-center gap-1"><TrendingUp className="w-3.5 h-3.5 text-emerald-600" /> Income</span>
                  <span className="font-semibold text-emerald-700">{fmtMoney(t.income, t.currency)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600 flex items-center gap-1"><TrendingDown className="w-3.5 h-3.5 text-rose-600" /> Expense</span>
                  <span className="font-semibold text-rose-700">{fmtMoney(t.expense, t.currency)}</span>
                </div>
                <div className="flex items-center justify-between text-sm pt-2 border-t border-gray-100">
                  <span className="text-gray-700 font-medium">Net</span>
                  <span className={`font-bold ${t.net >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{fmtMoney(t.net, t.currency)}</span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Outstanding receivables */}
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Outstanding receivables</h3>
      <Card className="mb-6">
        {data.arByCurrency.length === 0 ? (
          <p className="text-sm text-gray-500">No outstanding balances. Nice.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-sm text-gray-500">{data.arStudentCount} {data.arStudentCount === 1 ? 'student' : 'students'} have a balance:</span>
            {data.arByCurrency.map(a => (
              <span key={a.currency} className="text-sm font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-full px-3 py-1">
                {fmtMoney(a.balance, a.currency)}
              </span>
            ))}
            <Link to="/accounting/reports/ar-aging" className="ml-auto text-sm text-primary-600 hover:text-primary-700 inline-flex items-center gap-1">
              See aging report <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        )}
      </Card>

      {/* Upcoming obligations */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Card>
          <h4 className="font-semibold text-gray-900 mb-3">Upcoming staff payments (next 7 days)</h4>
          {data.upcomingSalaries.length === 0 ? (
            <p className="text-sm text-gray-400">Nothing due in the next week.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {data.upcomingSalaries.map(s => (
                <li key={s.id} className="py-2 flex items-center justify-between text-sm">
                  <span className="text-gray-700">{s.fullName} <span className="text-gray-400">· {s.nextPaymentDate}</span></span>
                  <span className="font-semibold">{fmtMoney(s.amount, s.currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <h4 className="font-semibold text-gray-900 mb-3">Recurring expenses (next 30 days)</h4>
          {data.upcomingRecurringExpenses.length === 0 ? (
            <p className="text-sm text-gray-400">No recurring expenses due.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {data.upcomingRecurringExpenses.map(r => (
                <li key={r.id} className="py-2 flex items-center justify-between text-sm">
                  <span className="text-gray-700">{r.name} <span className="text-gray-400">· {r.nextDueDate}</span></span>
                  <span className="font-semibold">{fmtMoney(r.amount, r.currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Report shortcuts */}
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Reports & tools</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {reports.map(({ to, icon: Icon, label, desc }) => (
          <Link key={to} to={to}>
            <Card hover>
              <div className="flex items-start gap-3">
                <div className="p-2.5 rounded-xl bg-primary-50 text-primary-600">
                  <Icon className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-semibold text-gray-900 mb-0.5">{label}</h4>
                  <p className="text-xs text-gray-500">{desc}</p>
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </PageLayout>
  );
}
