import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { feesApi } from '../../services/api';
import { toast } from 'react-toastify';
import Button from '../../components/common/Button';
import Input from '../../components/common/Input';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import Card from '../../components/common/Card';
import { Plus, Trash2, BellRing } from 'lucide-react';
import type { TuitionConfig, SiblingDiscountTier } from '../../types';

export default function TuitionSettingsTab() {
  const { t } = useTranslation();
  const [cfg, setCfg] = useState<TuitionConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [notifyTitle, setNotifyTitle] = useState(() => t('accounting.settings.notify_default_title'));
  const [notifyMsg, setNotifyMsg] = useState(() => t('accounting.settings.notify_default_msg'));
  const [notifyBusy, setNotifyBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState({ overdue: true, due_soon: true, current: false });

  useEffect(() => {
    feesApi.getConfig()
      .then(r => setCfg(r.data))
      .catch((e: any) => toast.error(e.response?.data?.error || t('accounting.settings.load_failed')));
  }, []);

  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      const r = await feesApi.updateConfig(cfg);
      setCfg(r.data);
      toast.success(t('accounting.settings.saved'));
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('accounting.settings.save_failed'));
    } finally { setSaving(false); }
  };

  const setTier = (idx: number, tier: SiblingDiscountTier) => {
    if (!cfg) return;
    const tiers = [...cfg.siblingDiscount.tiers];
    tiers[idx] = tier;
    setCfg({ ...cfg, siblingDiscount: { ...cfg.siblingDiscount, tiers } });
  };
  const addTier = () => cfg && setCfg({ ...cfg, siblingDiscount: { ...cfg.siblingDiscount, tiers: [...cfg.siblingDiscount.tiers, { minSiblings: 2, value: 10 }] } });
  const removeTier = (idx: number) => cfg && setCfg({ ...cfg, siblingDiscount: { ...cfg.siblingDiscount, tiers: cfg.siblingDiscount.tiers.filter((_, k) => k !== idx) } });

  const sendBroadcast = async () => {
    setNotifyBusy(true);
    try {
      const filters = (Object.keys(statusFilter) as (keyof typeof statusFilter)[]).filter(k => statusFilter[k]);
      if (filters.length === 0) { toast.error(t('accounting.settings.err_select_status')); return; }
      const r = await feesApi.notifyDue({ title: notifyTitle, message: notifyMsg, statusFilter: filters });
      toast.success(t('accounting.settings.notify_sent', { count: r.data.notified }));
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('accounting.settings.send_failed'));
    } finally { setNotifyBusy(false); }
  };

  if (!cfg) return <LoadingSpinner />;

  return (
    <div className="space-y-6 max-w-2xl">
      <Card>
        <h3 className="font-semibold text-gray-900 mb-1">{t('accounting.settings.currency_title')}</h3>
        <p className="text-sm text-gray-500 mb-3">{t('accounting.settings.currency_desc')}</p>
        <Input value={cfg.currency} onChange={e => setCfg({ ...cfg, currency: e.target.value.toUpperCase().slice(0, 8) })} className="max-w-[140px]" />
      </Card>

      <Card>
        <h3 className="font-semibold text-gray-900 mb-1">{t('accounting.settings.sibling_title')}</h3>
        <p className="text-sm text-gray-500 mb-3">{t('accounting.settings.sibling_desc')}</p>

        <label className="flex items-center gap-2 text-sm text-gray-700 mb-3">
          <input type="checkbox" checked={cfg.siblingDiscount.enabled} onChange={e => setCfg({ ...cfg, siblingDiscount: { ...cfg.siblingDiscount, enabled: e.target.checked } })} className="w-4 h-4 rounded border-gray-300 text-primary-600" />
          {t('accounting.settings.sibling_enable')}
        </label>

        {cfg.siblingDiscount.enabled && (
          <>
            <div className="mb-3">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('accounting.settings.discount_type')}</label>
              <div className="flex gap-2">
                {(['percent', 'fixed'] as const).map(ty => (
                  <button
                    key={ty}
                    type="button"
                    onClick={() => setCfg({ ...cfg, siblingDiscount: { ...cfg.siblingDiscount, type: ty } })}
                    className={`flex-1 px-3 py-2 rounded-xl border text-sm font-medium transition-colors ${
                      cfg.siblingDiscount.type === ty ? 'bg-primary-50 border-primary-300 text-primary-700' : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                    }`}
                  >{ty === 'percent' ? t('accounting.settings.type_percent') : t('accounting.settings.type_fixed')}</button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              {cfg.siblingDiscount.tiers.length === 0 && (
                <p className="text-xs text-gray-500">{t('accounting.settings.no_tiers')}</p>
              )}
              {cfg.siblingDiscount.tiers.map((tier, idx) => (
                <div key={idx} className="flex items-end gap-2">
                  <div className="w-32">
                    <Input label={idx === 0 ? t('accounting.settings.min_siblings') : ''} type="number" min={2} value={tier.minSiblings} onChange={e => setTier(idx, { ...tier, minSiblings: Math.max(2, Number(e.target.value)) })} />
                  </div>
                  <div className="flex-1">
                    <Input label={idx === 0 ? (cfg.siblingDiscount.type === 'percent' ? t('accounting.settings.discount_pct') : t('accounting.settings.discount_fixed', { currency: cfg.currency })) : ''} type="number" step="0.01" min={0} value={tier.value} onChange={e => setTier(idx, { ...tier, value: Number(e.target.value) })} />
                  </div>
                  <button onClick={() => removeTier(idx)} className="p-2 text-gray-400 hover:text-red-500 mb-0.5"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
              <button onClick={addTier} className="text-xs text-primary-600 hover:underline inline-flex items-center gap-1"><Plus className="w-3 h-3" /> {t('accounting.settings.add_tier')}</button>
            </div>
          </>
        )}

        <div className="flex justify-end mt-4">
          <Button onClick={save} loading={saving}>{t('accounting.settings.save_settings')}</Button>
        </div>
      </Card>

      <Card>
        <h3 className="font-semibold text-gray-900 mb-1 flex items-center gap-2"><BellRing className="w-4 h-4 text-primary-600" /> {t('accounting.settings.reminder_title')}</h3>
        <p className="text-sm text-gray-500 mb-3">{t('accounting.settings.reminder_desc')}</p>

        <Input label={t('accounting.settings.f_title')} value={notifyTitle} onChange={e => setNotifyTitle(e.target.value)} />
        <div className="mt-3">
          <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('accounting.settings.f_message')}</label>
          <textarea
            value={notifyMsg}
            onChange={e => setNotifyMsg(e.target.value)}
            rows={3}
            className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <div className="mt-3">
          <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('accounting.settings.send_to')}</label>
          <div className="flex flex-wrap gap-3">
            {(['overdue', 'due_soon', 'current'] as const).map(s => (
              <label key={s} className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={statusFilter[s]} onChange={e => setStatusFilter(p => ({ ...p, [s]: e.target.checked }))} className="w-4 h-4 rounded border-gray-300 text-primary-600" />
                {s === 'overdue' ? t('accounting.settings.st_overdue') : s === 'due_soon' ? t('accounting.settings.st_due_soon') : t('accounting.settings.st_current')}
              </label>
            ))}
          </div>
        </div>
        <div className="flex justify-end mt-4">
          <Button onClick={sendBroadcast} loading={notifyBusy} icon={<BellRing className="w-4 h-4" />}>{t('accounting.settings.send_reminder')}</Button>
        </div>
      </Card>
    </div>
  );
}
