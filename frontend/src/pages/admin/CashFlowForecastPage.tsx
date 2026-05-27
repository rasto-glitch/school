import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { BarChart3, TrendingUp, TrendingDown } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { accountingApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Select from '../../components/common/Select';
import Button from '../../components/common/Button';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import { fmtMoney } from '../../utils/money';

interface WeekSlot { weekStart: string; byCurrency: Record<string, { inflow: number; outflow: number; net: number }> }
interface Event { date: string; currency: string; amount: number; kind: 'inflow' | 'outflow'; label: string }

export default function CashFlowForecastPage() {
  const { t } = useTranslation();
  const { school } = useAuthStore();
  const isPremium = school?.features?.tuition_fees === true;
  const [weeks, setWeeks] = useState<number>(12);
  const [data, setData] = useState<{ weeks: WeekSlot[]; events: Event[] } | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const r = await accountingApi.getCashFlow(weeks);
      setData(r.data);
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('accounting.cf.load_failed'));
    } finally { setLoading(false); }
  };
  useEffect(() => { if (isPremium) run(); /* eslint-disable-next-line */ }, []);

  if (!isPremium) return <PageLayout title={t('accounting.cf.title')}><p className="text-sm text-amber-700">{t('accounting.premium_subtitle')}</p></PageLayout>;

  // Currencies that appear across the forecast
  const currencies = Array.from(new Set((data?.weeks ?? []).flatMap(w => Object.keys(w.byCurrency))));

  return (
    <PageLayout title={t('accounting.cf.title')} subtitle={t('accounting.cf.subtitle')}>
      <Card className="mb-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Select
            label={t('accounting.cf.horizon')}
            value={String(weeks)}
            onChange={e => setWeeks(parseInt(e.target.value, 10))}
            options={[4, 8, 12, 16, 26, 52].map(w => ({ value: String(w), label: t('accounting.cf.weeks_n', { n: w }) }))}
          />
          <div className="flex items-end"><Button onClick={run} loading={loading} fullWidth>{t('accounting.pl.run')}</Button></div>
        </div>
      </Card>

      {loading ? <LoadingSpinner /> : !data ? null : data.weeks.length === 0 ? (
        <Card><p className="text-sm text-gray-500">{t('accounting.cf.no_data')}</p></Card>
      ) : (
        <>
          {currencies.map(cur => (
            <Card key={cur} className="mb-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900 flex items-center gap-2"><BarChart3 className="w-4 h-4 text-gray-500" /> {cur}</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs font-medium text-gray-500 border-b border-gray-100">
                      <th className="py-2 pr-3 whitespace-nowrap">{t('accounting.cf.col_week')}</th>
                      <th className="py-2 pr-3 text-right">{t('accounting.cf.col_inflow')}</th>
                      <th className="py-2 pr-3 text-right">{t('accounting.cf.col_outflow')}</th>
                      <th className="py-2 pr-3 text-right">{t('accounting.net')}</th>
                      <th className="py-2 pr-3 text-right whitespace-nowrap">{t('accounting.cf.col_running')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      let running = 0;
                      return data.weeks.map(w => {
                        const c = w.byCurrency[cur];
                        const inflow = c?.inflow ?? 0;
                        const outflow = c?.outflow ?? 0;
                        const net = inflow - outflow;
                        running += net;
                        return (
                          <tr key={w.weekStart} className="border-b border-gray-50 last:border-0">
                            <td className="py-2 pr-3 text-gray-700">{w.weekStart}</td>
                            <td className="py-2 pr-3 text-right text-emerald-700">{inflow > 0 ? fmtMoney(inflow, cur) : '—'}</td>
                            <td className="py-2 pr-3 text-right text-rose-700">{outflow > 0 ? fmtMoney(outflow, cur) : '—'}</td>
                            <td className={`py-2 pr-3 text-right font-medium ${net >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{net !== 0 ? fmtMoney(net, cur) : '—'}</td>
                            <td className={`py-2 pr-3 text-right font-bold ${running >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{fmtMoney(running, cur)}</td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}

          {/* Event list */}
          <Card>
            <h3 className="font-semibold text-gray-900 mb-3">{t('accounting.cf.events')}</h3>
            {data.events.length === 0 ? <p className="text-sm text-gray-400">{t('accounting.cf.no_events')}</p> : (
              <ul className="divide-y divide-gray-100">
                {data.events.map((e, i) => (
                  <li key={`${e.date}-${i}`} className="py-2 flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 text-gray-700">
                      {e.kind === 'inflow' ? <TrendingUp className="w-3.5 h-3.5 text-emerald-600" /> : <TrendingDown className="w-3.5 h-3.5 text-rose-600" />}
                      {e.label} <span className="text-gray-400">· {e.date}</span>
                    </span>
                    <span className={`font-medium ${e.kind === 'inflow' ? 'text-emerald-700' : 'text-rose-700'}`}>{fmtMoney(e.amount, e.currency)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </PageLayout>
  );
}
