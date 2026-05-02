import { useEffect, useState } from 'react';
import { feesApi } from '../../services/api';
import { toast } from 'react-toastify';
import Button from '../../components/common/Button';
import Input from '../../components/common/Input';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import Card from '../../components/common/Card';
import { Plus, Trash2, BellRing } from 'lucide-react';
import type { TuitionConfig, SiblingDiscountTier } from '../../types';

export default function TuitionSettingsTab() {
  const [cfg, setCfg] = useState<TuitionConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [notifyTitle, setNotifyTitle] = useState('Tuition payment reminder');
  const [notifyMsg, setNotifyMsg] = useState('A tuition payment is due. Please contact the school office for details.');
  const [notifyBusy, setNotifyBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState({ overdue: true, due_soon: true, current: false });

  useEffect(() => {
    feesApi.getConfig()
      .then(r => setCfg(r.data))
      .catch((e: any) => toast.error(e.response?.data?.error || 'Failed to load config'));
  }, []);

  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      const r = await feesApi.updateConfig(cfg);
      setCfg(r.data);
      toast.success('Settings saved');
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to save');
    } finally { setSaving(false); }
  };

  const setTier = (idx: number, t: SiblingDiscountTier) => {
    if (!cfg) return;
    const tiers = [...cfg.siblingDiscount.tiers];
    tiers[idx] = t;
    setCfg({ ...cfg, siblingDiscount: { ...cfg.siblingDiscount, tiers } });
  };
  const addTier = () => cfg && setCfg({ ...cfg, siblingDiscount: { ...cfg.siblingDiscount, tiers: [...cfg.siblingDiscount.tiers, { minSiblings: 2, value: 10 }] } });
  const removeTier = (idx: number) => cfg && setCfg({ ...cfg, siblingDiscount: { ...cfg.siblingDiscount, tiers: cfg.siblingDiscount.tiers.filter((_, k) => k !== idx) } });

  const sendBroadcast = async () => {
    setNotifyBusy(true);
    try {
      const filters = (Object.keys(statusFilter) as (keyof typeof statusFilter)[]).filter(k => statusFilter[k]);
      if (filters.length === 0) { toast.error('Select at least one status to notify'); return; }
      const r = await feesApi.notifyDue({ title: notifyTitle, message: notifyMsg, statusFilter: filters });
      toast.success(`Notification sent to ${r.data.notified} parent${r.data.notified === 1 ? '' : 's'}`);
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to send');
    } finally { setNotifyBusy(false); }
  };

  if (!cfg) return <LoadingSpinner />;

  return (
    <div className="space-y-6 max-w-2xl">
      <Card>
        <h3 className="font-semibold text-gray-900 mb-1">Currency</h3>
        <p className="text-sm text-gray-500 mb-3">Default currency for new plans. Existing plans keep their currency.</p>
        <Input value={cfg.currency} onChange={e => setCfg({ ...cfg, currency: e.target.value.toUpperCase().slice(0, 8) })} className="max-w-[140px]" />
      </Card>

      <Card>
        <h3 className="font-semibold text-gray-900 mb-1">Sibling discount</h3>
        <p className="text-sm text-gray-500 mb-3">Applied automatically when a parent has multiple students with fees in the same academic year. Discount is computed at read time, not stored — so it stays correct as siblings enroll or graduate.</p>

        <label className="flex items-center gap-2 text-sm text-gray-700 mb-3">
          <input type="checkbox" checked={cfg.siblingDiscount.enabled} onChange={e => setCfg({ ...cfg, siblingDiscount: { ...cfg.siblingDiscount, enabled: e.target.checked } })} className="w-4 h-4 rounded border-gray-300 text-primary-600" />
          Enable sibling discount
        </label>

        {cfg.siblingDiscount.enabled && (
          <>
            <div className="mb-3">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Discount type</label>
              <div className="flex gap-2">
                {(['percent', 'fixed'] as const).map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setCfg({ ...cfg, siblingDiscount: { ...cfg.siblingDiscount, type: t } })}
                    className={`flex-1 px-3 py-2 rounded-xl border text-sm font-medium transition-colors ${
                      cfg.siblingDiscount.type === t ? 'bg-primary-50 border-primary-300 text-primary-700' : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                    }`}
                  >{t === 'percent' ? '% of tuition' : 'Fixed amount'}</button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              {cfg.siblingDiscount.tiers.length === 0 && (
                <p className="text-xs text-gray-500">No tiers yet. Add one — e.g. "2 siblings → 10%".</p>
              )}
              {cfg.siblingDiscount.tiers.map((t, idx) => (
                <div key={idx} className="flex items-end gap-2">
                  <div className="w-32">
                    <Input label={idx === 0 ? 'Min siblings' : ''} type="number" min={2} value={t.minSiblings} onChange={e => setTier(idx, { ...t, minSiblings: Math.max(2, Number(e.target.value)) })} />
                  </div>
                  <div className="flex-1">
                    <Input label={idx === 0 ? (cfg.siblingDiscount.type === 'percent' ? 'Discount %' : `Discount (${cfg.currency})`) : ''} type="number" step="0.01" min={0} value={t.value} onChange={e => setTier(idx, { ...t, value: Number(e.target.value) })} />
                  </div>
                  <button onClick={() => removeTier(idx)} className="p-2 text-gray-400 hover:text-red-500 mb-0.5"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
              <button onClick={addTier} className="text-xs text-primary-600 hover:underline inline-flex items-center gap-1"><Plus className="w-3 h-3" /> Add tier</button>
            </div>
          </>
        )}

        <div className="flex justify-end mt-4">
          <Button onClick={save} loading={saving}>Save settings</Button>
        </div>
      </Card>

      <Card>
        <h3 className="font-semibold text-gray-900 mb-1 flex items-center gap-2"><BellRing className="w-4 h-4 text-primary-600" /> Send payment reminder</h3>
        <p className="text-sm text-gray-500 mb-3">Notify parents whose tuition isn't paid up. Parents with the "Paid up" status are automatically excluded.</p>

        <Input label="Title" value={notifyTitle} onChange={e => setNotifyTitle(e.target.value)} />
        <div className="mt-3">
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Message</label>
          <textarea
            value={notifyMsg}
            onChange={e => setNotifyMsg(e.target.value)}
            rows={3}
            className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <div className="mt-3">
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Send to parents who are…</label>
          <div className="flex flex-wrap gap-3">
            {(['overdue', 'due_soon', 'current'] as const).map(s => (
              <label key={s} className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={statusFilter[s]} onChange={e => setStatusFilter(p => ({ ...p, [s]: e.target.checked }))} className="w-4 h-4 rounded border-gray-300 text-primary-600" />
                {s === 'overdue' ? 'Overdue' : s === 'due_soon' ? 'Due soon' : 'On track (not yet paid)'}
              </label>
            ))}
          </div>
        </div>
        <div className="flex justify-end mt-4">
          <Button onClick={sendBroadcast} loading={notifyBusy} icon={<BellRing className="w-4 h-4" />}>Send reminder</Button>
        </div>
      </Card>
    </div>
  );
}
