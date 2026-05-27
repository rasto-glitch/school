import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Wallet, Plus, Trash2, Pencil } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { accountingApi, type PaymentAccount } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Input from '../../components/common/Input';
import Select from '../../components/common/Select';
import Button from '../../components/common/Button';
import Modal from '../../components/common/Modal';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';
import { fmtMoney, KNOWN_CURRENCIES } from '../../utils/money';

interface AccountForm { id?: string; name: string; kind: PaymentAccount['kind']; currency: string; openingBalance: string; notes: string; isActive: boolean }
const empty: AccountForm = { name: '', kind: 'cash', currency: 'USD', openingBalance: '0', notes: '', isActive: true };

export default function PaymentAccountsPage() {
  const { t } = useTranslation();
  const { school } = useAuthStore();
  const isPremium = school?.features?.tuition_fees === true;
  const [rows, setRows] = useState<PaymentAccount[] | null>(null);
  const [form, setForm] = useState<AccountForm | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => accountingApi.listPaymentAccounts().then(r => setRows(r.data)).catch((e: any) => toast.error(e.response?.data?.error || t('accounting.pa.load_failed')));
  useEffect(() => { if (isPremium) load(); }, [isPremium]);

  const save = async () => {
    if (!form) return;
    if (!form.name.trim()) { toast.error(t('accounting.pa.name_required')); return; }
    setBusy(true);
    try {
      if (form.id) {
        await accountingApi.updatePaymentAccount(form.id, {
          name: form.name, kind: form.kind, currency: form.currency,
          openingBalance: Number(form.openingBalance) || 0, notes: form.notes || null, isActive: form.isActive,
        });
      } else {
        await accountingApi.createPaymentAccount({
          name: form.name, kind: form.kind, currency: form.currency,
          openingBalance: Number(form.openingBalance) || 0, notes: form.notes || null,
        });
      }
      toast.success(t('accounting.pa.saved'));
      setForm(null);
      load();
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('accounting.pa.save_failed'));
    } finally { setBusy(false); }
  };

  const deactivate = async (a: PaymentAccount) => {
    if (!confirm(t('accounting.pa.deactivate_confirm', { name: a.name }))) return;
    try {
      await accountingApi.deletePaymentAccount(a.id);
      toast.success(t('accounting.pa.deactivated'));
      load();
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('accounting.pa.failed'));
    }
  };

  if (!isPremium) return <PageLayout title={t('accounting.pa.title')}><p className="text-sm text-amber-700">{t('accounting.premium_subtitle')}</p></PageLayout>;
  if (!rows) return <PageLayout title={t('accounting.pa.title')}><LoadingSpinner /></PageLayout>;

  return (
    <PageLayout title={t('accounting.pa.title')} subtitle={t('accounting.pa.subtitle')}>
      <div className="flex justify-end mb-4">
        <Button onClick={() => setForm(empty)} icon={<Plus className="w-4 h-4" />}>{t('accounting.pa.new_account')}</Button>
      </div>

      {rows.length === 0 ? (
        <Card><EmptyState title={t('accounting.pa.none_title')} description={t('accounting.pa.none_desc')} icon={<Wallet className="w-8 h-8 text-gray-400" />} /></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {rows.map(a => (
            <Card key={a.id} className={!a.isActive ? 'opacity-60' : ''}>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h4 className="font-semibold text-gray-900">{a.name}</h4>
                  <span className="text-xs text-gray-500">{t(`accounting.pa.kind_${a.kind}`)} · {a.currency}{!a.isActive && ` · ${t('accounting.pa.inactive')}`}</span>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => setForm({ id: a.id, name: a.name, kind: a.kind, currency: a.currency, openingBalance: String(a.openingBalance), notes: a.notes ?? '', isActive: a.isActive })} className="p-1.5 rounded-lg hover:bg-gray-100"><Pencil className="w-4 h-4 text-gray-500" /></button>
                  {a.isActive && <button onClick={() => deactivate(a)} className="p-1.5 rounded-lg hover:bg-rose-50"><Trash2 className="w-4 h-4 text-rose-500" /></button>}
                </div>
              </div>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">{t('accounting.pa.opening')}</span><span className="font-medium">{fmtMoney(a.openingBalance, a.currency)}</span></div>
                <div className="flex justify-between pt-1.5 border-t border-gray-100">
                  <span className="text-gray-700 font-medium">{t('accounting.pa.current')}</span>
                  <span className={`font-bold ${(a.balance ?? 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{fmtMoney(a.balance ?? a.openingBalance, a.currency)}</span>
                </div>
                {a.notes && <p className="text-xs text-gray-500 italic pt-1 border-t border-gray-100">{a.notes}</p>}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal isOpen={!!form} onClose={() => setForm(null)} title={form?.id ? t('accounting.pa.edit_account') : t('accounting.pa.new_title')}>
        {form && (
          <div className="space-y-3">
            <Input label={t('accounting.pa.f_name')} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder={t('accounting.pa.name_ph')} />
            <div className="grid grid-cols-2 gap-3">
              <Select
                label={t('accounting.pa.f_kind')}
                value={form.kind}
                onChange={e => setForm({ ...form, kind: e.target.value as any })}
                options={[
                  { value: 'cash', label: t('accounting.pa.kind_cash') },
                  { value: 'bank', label: t('accounting.pa.kind_bank') },
                  { value: 'wallet', label: t('accounting.pa.kind_wallet') },
                  { value: 'other', label: t('accounting.pa.kind_other') },
                ]}
              />
              <Select
                label={t('accounting.pa.f_currency')}
                value={form.currency}
                onChange={e => setForm({ ...form, currency: e.target.value })}
                options={KNOWN_CURRENCIES.map(c => ({ value: c, label: c }))}
              />
            </div>
            <Input label={t('accounting.pa.f_opening')} type="number" step="0.01" value={form.openingBalance} onChange={e => setForm({ ...form, openingBalance: e.target.value })} />
            <Input label={t('accounting.pa.f_notes')} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder={t('accounting.pa.optional')} />
            {form.id && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.isActive} onChange={e => setForm({ ...form, isActive: e.target.checked })} className="w-4 h-4 text-primary-600" />
                {t('accounting.pa.active_hint')}
              </label>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setForm(null)} disabled={busy}>{t('common.cancel')}</Button>
              <Button onClick={save} loading={busy}>{t('common.save')}</Button>
            </div>
          </div>
        )}
      </Modal>
    </PageLayout>
  );
}
