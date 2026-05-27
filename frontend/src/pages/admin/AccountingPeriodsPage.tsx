import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { CalendarClock, Lock, Unlock } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { accountingApi, type AccountingPeriod } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Input from '../../components/common/Input';
import Button from '../../components/common/Button';
import Modal from '../../components/common/Modal';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';

export default function AccountingPeriodsPage() {
  const { t } = useTranslation();
  const { school } = useAuthStore();
  const isPremium = school?.features?.tuition_fees === true;
  const [rows, setRows] = useState<AccountingPeriod[] | null>(null);
  const [closing, setClosing] = useState(false);
  const [form, setForm] = useState({ periodStart: '', periodEnd: '', notes: '' });
  const [reopenTarget, setReopenTarget] = useState<AccountingPeriod | null>(null);
  const [reopenReason, setReopenReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => accountingApi.listPeriods().then(r => setRows(r.data)).catch((e: any) => toast.error(e.response?.data?.error || t('accounting.periods.load_failed')));
  useEffect(() => { if (isPremium) load(); }, [isPremium]);

  const closePeriod = async () => {
    if (!form.periodStart || !form.periodEnd) { toast.error(t('accounting.periods.both_dates')); return; }
    setBusy(true);
    try {
      await accountingApi.closePeriod(form);
      toast.success(t('accounting.periods.closed_ok'));
      setClosing(false);
      setForm({ periodStart: '', periodEnd: '', notes: '' });
      load();
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('accounting.periods.close_failed'));
    } finally { setBusy(false); }
  };

  const reopen = async () => {
    if (!reopenTarget) return;
    if (!reopenReason.trim()) { toast.error(t('accounting.periods.reason_required')); return; }
    setBusy(true);
    try {
      await accountingApi.reopenPeriod(reopenTarget.id, reopenReason);
      toast.success(t('accounting.periods.reopened_ok'));
      setReopenTarget(null);
      setReopenReason('');
      load();
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('accounting.periods.reopen_failed'));
    } finally { setBusy(false); }
  };

  if (!isPremium) return <PageLayout title={t('accounting.periods.title')}><p className="text-sm text-amber-700">{t('accounting.premium_subtitle')}</p></PageLayout>;
  if (!rows) return <PageLayout title={t('accounting.periods.title')}><LoadingSpinner /></PageLayout>;

  return (
    <PageLayout title={t('accounting.periods.title')} subtitle={t('accounting.periods.subtitle')}>
      <Card className="mb-4">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h3 className="font-semibold text-gray-900 mb-1">{t('accounting.periods.how_title')}</h3>
            <p className="text-sm text-gray-600 max-w-2xl">
              {t('accounting.periods.how_desc')}
            </p>
          </div>
          <Button onClick={() => setClosing(true)} icon={<Lock className="w-4 h-4" />}>{t('accounting.periods.close_btn')}</Button>
        </div>
      </Card>

      {rows.length === 0 ? (
        <Card><EmptyState title={t('accounting.periods.none_title')} description={t('accounting.periods.none_desc')} icon={<CalendarClock className="w-8 h-8 text-gray-400" />} /></Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium text-gray-500 border-b border-gray-100">
                  <th className="py-2 pr-3">{t('accounting.periods.col_range')}</th>
                  <th className="py-2 pr-3">{t('accounting.periods.col_status')}</th>
                  <th className="py-2 pr-3">{t('accounting.periods.col_closed')}</th>
                  <th className="py-2 pr-3">{t('accounting.periods.col_reopened')}</th>
                  <th className="py-2 pr-3">{t('accounting.periods.col_notes')}</th>
                  <th className="py-2 pr-3 text-right">{t('accounting.periods.col_actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(p => (
                  <tr key={p.id} className="border-b border-gray-50 last:border-0">
                    <td className="py-2 pr-3 text-gray-700 whitespace-nowrap">{p.periodStart} → {p.periodEnd}</td>
                    <td className="py-2 pr-3">
                      {p.isClosed ? (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-rose-50 text-rose-700"><Lock className="w-3 h-3" /> {t('accounting.periods.st_closed')}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700"><Unlock className="w-3 h-3" /> {t('accounting.periods.st_open')}</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-gray-700 text-xs">
                      <div>{p.closedAt?.slice(0, 10)}</div>
                      {p.closedByName && <div className="text-gray-500">{p.closedByName}</div>}
                    </td>
                    <td className="py-2 pr-3 text-gray-700 text-xs">
                      {p.reopenedAt ? (
                        <>
                          <div>{p.reopenedAt.slice(0, 10)}</div>
                          {p.reopenedByName && <div className="text-gray-500">{p.reopenedByName}</div>}
                          {p.reopenReason && <div className="text-gray-500 italic">"{p.reopenReason}"</div>}
                        </>
                      ) : '—'}
                    </td>
                    <td className="py-2 pr-3 text-gray-600 text-xs">{p.notes || '—'}</td>
                    <td className="py-2 pr-3 text-right">
                      {p.isClosed && (
                        <Button size="sm" variant="ghost" onClick={() => setReopenTarget(p)}>{t('accounting.periods.reopen')}</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal isOpen={closing} onClose={() => setClosing(false)} title={t('accounting.periods.close_title')}>
        <div className="space-y-3">
          <Input label={t('accounting.ledger.from')} type="date" value={form.periodStart} onChange={e => setForm({ ...form, periodStart: e.target.value })} />
          <Input label={t('accounting.ledger.to')} type="date" value={form.periodEnd} onChange={e => setForm({ ...form, periodEnd: e.target.value })} />
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">{t('accounting.periods.notes_opt')}</label>
            <textarea
              value={form.notes}
              onChange={e => setForm({ ...form, notes: e.target.value })}
              rows={2}
              className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder={t('accounting.periods.notes_ph')}
            />
          </div>
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
            {t('accounting.periods.close_warning')}
          </p>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setClosing(false)} disabled={busy}>{t('common.cancel')}</Button>
            <Button onClick={closePeriod} loading={busy} icon={<Lock className="w-4 h-4" />}>{t('accounting.periods.close_period')}</Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!reopenTarget} onClose={() => setReopenTarget(null)} title={t('accounting.periods.reopen_title', { start: reopenTarget?.periodStart, end: reopenTarget?.periodEnd })}>
        <div className="space-y-3">
          <Input label={t('accounting.periods.reason')} value={reopenReason} onChange={e => setReopenReason(e.target.value)} placeholder={t('accounting.periods.reason_ph')} />
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setReopenTarget(null)} disabled={busy}>{t('common.cancel')}</Button>
            <Button onClick={reopen} loading={busy} icon={<Unlock className="w-4 h-4" />}>{t('accounting.periods.reopen')}</Button>
          </div>
        </div>
      </Modal>
    </PageLayout>
  );
}
