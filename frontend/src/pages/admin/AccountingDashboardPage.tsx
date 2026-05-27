import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  const { school, user } = useAuthStore();
  const isPremium = school?.features?.tuition_fees === true;
  const role = user?.role;
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    if (!isPremium) return;
    accountingApi.getDashboard()
      .then(r => setData(r.data as DashboardData))
      .catch((e: any) => toast.error(e.response?.data?.error || t('accounting.dash.load_failed')));
  }, [isPremium]);

  if (!isPremium) {
    return (
      <PageLayout title={t('accounting.title')} subtitle={t('accounting.premium_subtitle')}>
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 max-w-xl">
          <p className="text-sm text-amber-800">{t('accounting.premium_body')}</p>
        </div>
      </PageLayout>
    );
  }
  if (!data) return <PageLayout title={t('accounting.title')}><LoadingSpinner /></PageLayout>;

  const reports: { to: string; icon: any; label: string; desc: string }[] = [
    { to: '/accounting/reports/ar-aging', icon: AlertCircle, label: t('accounting.reports.ar_aging.label'), desc: t('accounting.reports.ar_aging.desc') },
    { to: '/accounting/reports/profit-loss', icon: FileBarChart, label: t('accounting.reports.profit_loss.label'), desc: t('accounting.reports.profit_loss.desc') },
    { to: '/accounting/reports/cash-flow', icon: BarChart3, label: t('accounting.reports.cash_flow.label'), desc: t('accounting.reports.cash_flow.desc') },
    { to: '/accounting/reports/tax', icon: ReceiptIcon, label: t('accounting.reports.tax.label'), desc: t('accounting.reports.tax.desc') },
    { to: '/accounting/ledger', icon: BookOpenCheck, label: t('accounting.reports.ledger.label'), desc: t('accounting.reports.ledger.desc') },
    { to: '/accounting/periods', icon: CalendarClock, label: t('accounting.reports.periods.label'), desc: t('accounting.reports.periods.desc') },
    { to: '/accounting/payment-accounts', icon: Wallet, label: t('accounting.reports.payment_accounts.label'), desc: t('accounting.reports.payment_accounts.desc') },
  ];

  return (
    <PageLayout title={t('accounting.title')} subtitle={role === 'accountant' ? (user?.firstName ? t('accounting.dash.welcome_name', { name: user.firstName }) : t('accounting.dash.welcome')) : t('accounting.dash.subtitle_glance')}>
      {/* This month per currency */}
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">{t('accounting.dash.this_month', { from: data.period.from, to: data.period.to })}</h3>
      {data.monthByCurrency.length === 0 ? (
        <Card className="mb-6"><p className="text-sm text-gray-500">{t('accounting.dash.no_movements')}</p></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
          {data.monthByCurrency.map(m => (
            <Card key={m.currency}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-gray-500">{m.currency}</span>
                <Wallet className="w-4 h-4 text-gray-400" />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600 flex items-center gap-1"><TrendingUp className="w-3.5 h-3.5 text-emerald-600" /> {t('accounting.income')}</span>
                  <span className="font-semibold text-emerald-700">{fmtMoney(m.income, m.currency)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600 flex items-center gap-1"><TrendingDown className="w-3.5 h-3.5 text-rose-600" /> {t('accounting.expense')}</span>
                  <span className="font-semibold text-rose-700">{fmtMoney(m.expense, m.currency)}</span>
                </div>
                <div className="flex items-center justify-between text-sm pt-2 border-t border-gray-100">
                  <span className="text-gray-700 font-medium">{t('accounting.net')}</span>
                  <span className={`font-bold ${m.net >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{fmtMoney(m.net, m.currency)}</span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Outstanding receivables */}
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">{t('accounting.dash.outstanding')}</h3>
      <Card className="mb-6">
        {data.arByCurrency.length === 0 ? (
          <p className="text-sm text-gray-500">{t('accounting.dash.no_outstanding')}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-sm text-gray-500">{t('accounting.dash.students_with_balance', { count: data.arStudentCount })}</span>
            {data.arByCurrency.map(a => (
              <span key={a.currency} className="text-sm font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-full px-3 py-1">
                {fmtMoney(a.balance, a.currency)}
              </span>
            ))}
            <Link to="/accounting/reports/ar-aging" className="ml-auto text-sm text-primary-600 hover:text-primary-700 inline-flex items-center gap-1">
              {t('accounting.dash.see_aging')} <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        )}
      </Card>

      {/* Upcoming obligations */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Card>
          <h4 className="font-semibold text-gray-900 mb-3">{t('accounting.dash.upcoming_salaries')}</h4>
          {data.upcomingSalaries.length === 0 ? (
            <p className="text-sm text-gray-400">{t('accounting.dash.nothing_due_week')}</p>
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
          <h4 className="font-semibold text-gray-900 mb-3">{t('accounting.dash.recurring_expenses')}</h4>
          {data.upcomingRecurringExpenses.length === 0 ? (
            <p className="text-sm text-gray-400">{t('accounting.dash.no_recurring')}</p>
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
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">{t('accounting.dash.reports_tools')}</h3>
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
