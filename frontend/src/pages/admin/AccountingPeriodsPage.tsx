import { useEffect, useState } from 'react';
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
  const { school } = useAuthStore();
  const isPremium = school?.features?.tuition_fees === true;
  const [rows, setRows] = useState<AccountingPeriod[] | null>(null);
  const [closing, setClosing] = useState(false);
  const [form, setForm] = useState({ periodStart: '', periodEnd: '', notes: '' });
  const [reopenTarget, setReopenTarget] = useState<AccountingPeriod | null>(null);
  const [reopenReason, setReopenReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => accountingApi.listPeriods().then(r => setRows(r.data)).catch((e: any) => toast.error(e.response?.data?.error || 'Failed to load'));
  useEffect(() => { if (isPremium) load(); }, [isPremium]);

  const closePeriod = async () => {
    if (!form.periodStart || !form.periodEnd) { toast.error('Both dates are required'); return; }
    setBusy(true);
    try {
      await accountingApi.closePeriod(form);
      toast.success('Period closed. Edits within this range are now blocked.');
      setClosing(false);
      setForm({ periodStart: '', periodEnd: '', notes: '' });
      load();
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to close period');
    } finally { setBusy(false); }
  };

  const reopen = async () => {
    if (!reopenTarget) return;
    if (!reopenReason.trim()) { toast.error('Reason is required'); return; }
    setBusy(true);
    try {
      await accountingApi.reopenPeriod(reopenTarget.id, reopenReason);
      toast.success('Period reopened');
      setReopenTarget(null);
      setReopenReason('');
      load();
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to reopen');
    } finally { setBusy(false); }
  };

  if (!isPremium) return <PageLayout title="Accounting periods"><p className="text-sm text-amber-700">Premium feature</p></PageLayout>;
  if (!rows) return <PageLayout title="Accounting periods"><LoadingSpinner /></PageLayout>;

  return (
    <PageLayout title="Accounting periods" subtitle="Close months/years to lock financial history">
      <Card className="mb-4">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h3 className="font-semibold text-gray-900 mb-1">How period close works</h3>
            <p className="text-sm text-gray-600 max-w-2xl">
              Closing a date range blocks create/update/void on tuition payments, expenses, and staff salaries
              whose date falls inside the range. Reopening is allowed but requires a reason — both actions are audit-logged.
            </p>
          </div>
          <Button onClick={() => setClosing(true)} icon={<Lock className="w-4 h-4" />}>Close a period</Button>
        </div>
      </Card>

      {rows.length === 0 ? (
        <Card><EmptyState title="No periods yet" description="Close a date range to start locking history." icon={<CalendarClock className="w-8 h-8 text-gray-400" />} /></Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium text-gray-500 border-b border-gray-100">
                  <th className="py-2 pr-3">Range</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Closed</th>
                  <th className="py-2 pr-3">Reopened</th>
                  <th className="py-2 pr-3">Notes</th>
                  <th className="py-2 pr-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(p => (
                  <tr key={p.id} className="border-b border-gray-50 last:border-0">
                    <td className="py-2 pr-3 text-gray-700 whitespace-nowrap">{p.periodStart} → {p.periodEnd}</td>
                    <td className="py-2 pr-3">
                      {p.isClosed ? (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-rose-50 text-rose-700"><Lock className="w-3 h-3" /> Closed</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700"><Unlock className="w-3 h-3" /> Open</span>
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
                        <Button size="sm" variant="ghost" onClick={() => setReopenTarget(p)}>Reopen</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal isOpen={closing} onClose={() => setClosing(false)} title="Close accounting period">
        <div className="space-y-3">
          <Input label="From" type="date" value={form.periodStart} onChange={e => setForm({ ...form, periodStart: e.target.value })} />
          <Input label="To" type="date" value={form.periodEnd} onChange={e => setForm({ ...form, periodEnd: e.target.value })} />
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">Notes (optional)</label>
            <textarea
              value={form.notes}
              onChange={e => setForm({ ...form, notes: e.target.value })}
              rows={2}
              className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="Why is this period being closed?"
            />
          </div>
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
            After closing, no financial row dated within this range can be created, edited, or voided until the period is reopened.
          </p>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setClosing(false)} disabled={busy}>Cancel</Button>
            <Button onClick={closePeriod} loading={busy} icon={<Lock className="w-4 h-4" />}>Close period</Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!reopenTarget} onClose={() => setReopenTarget(null)} title={`Reopen ${reopenTarget?.periodStart} → ${reopenTarget?.periodEnd}`}>
        <div className="space-y-3">
          <Input label="Reason" value={reopenReason} onChange={e => setReopenReason(e.target.value)} placeholder="Required — what needs fixing?" />
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setReopenTarget(null)} disabled={busy}>Cancel</Button>
            <Button onClick={reopen} loading={busy} icon={<Unlock className="w-4 h-4" />}>Reopen</Button>
          </div>
        </div>
      </Modal>
    </PageLayout>
  );
}
