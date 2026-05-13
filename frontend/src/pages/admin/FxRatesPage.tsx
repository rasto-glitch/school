import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { Plus, Trash2, ArrowRight } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { accountingApi, type FxRate } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Input from '../../components/common/Input';
import Select from '../../components/common/Select';
import Button from '../../components/common/Button';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';
import { KNOWN_CURRENCIES } from '../../utils/money';

export default function FxRatesPage() {
  const { school } = useAuthStore();
  const isPremium = school?.features?.tuition_fees === true;
  const [rows, setRows] = useState<FxRate[] | null>(null);
  const [form, setForm] = useState({ fromCurrency: 'USD', toCurrency: 'IQD', rate: '', effectiveFrom: new Date().toISOString().slice(0, 10) });
  const [busy, setBusy] = useState(false);

  const load = () => accountingApi.listFxRates().then(r => setRows(r.data)).catch((e: any) => toast.error(e.response?.data?.error || 'Failed'));
  useEffect(() => { if (isPremium) load(); }, [isPremium]);

  const save = async () => {
    const rate = parseFloat(form.rate);
    if (!isFinite(rate) || rate <= 0) { toast.error('Rate must be positive'); return; }
    if (form.fromCurrency === form.toCurrency) { toast.error('From and to currencies must differ'); return; }
    setBusy(true);
    try {
      await accountingApi.setFxRate({ fromCurrency: form.fromCurrency, toCurrency: form.toCurrency, rate, effectiveFrom: form.effectiveFrom });
      toast.success('Rate saved');
      setForm(f => ({ ...f, rate: '' }));
      load();
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to save');
    } finally { setBusy(false); }
  };

  const del = async (r: FxRate) => {
    if (!confirm(`Delete ${r.fromCurrency} → ${r.toCurrency} @ ${r.effectiveFrom}?`)) return;
    try {
      await accountingApi.deleteFxRate(r.id);
      toast.success('Deleted');
      load();
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed');
    }
  };

  if (!isPremium) return <PageLayout title="FX rates"><p className="text-sm text-amber-700">Premium feature</p></PageLayout>;
  if (!rows) return <PageLayout title="FX rates"><LoadingSpinner /></PageLayout>;

  return (
    <PageLayout title="FX rates" subtitle="Multi-currency conversion rates for consolidated reports">
      <Card className="mb-4">
        <h3 className="font-semibold text-gray-900 mb-3">Add or update a rate</h3>
        <p className="text-xs text-gray-500 mb-3">1 unit of <strong>from</strong> = <em>rate</em> units of <strong>to</strong>. Reports pick the most recent rate effective on or before the report date.</p>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <Select label="From" value={form.fromCurrency} onChange={e => setForm({ ...form, fromCurrency: e.target.value })} options={KNOWN_CURRENCIES.map(c => ({ value: c, label: c }))} />
          <Select label="To" value={form.toCurrency} onChange={e => setForm({ ...form, toCurrency: e.target.value })} options={KNOWN_CURRENCIES.map(c => ({ value: c, label: c }))} />
          <Input label="Rate" type="number" step="0.0001" value={form.rate} onChange={e => setForm({ ...form, rate: e.target.value })} placeholder="e.g. 1310" />
          <Input label="Effective from" type="date" value={form.effectiveFrom} onChange={e => setForm({ ...form, effectiveFrom: e.target.value })} />
          <div className="flex items-end"><Button onClick={save} fullWidth loading={busy} icon={<Plus className="w-4 h-4" />}>Save</Button></div>
        </div>
      </Card>

      {rows.length === 0 ? (
        <Card><EmptyState title="No rates yet" description="Add a rate to enable consolidated currency reports." icon={<ArrowRight className="w-8 h-8 text-gray-400" />} /></Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium text-gray-500 border-b border-gray-100">
                  <th className="py-2 pr-3">Pair</th>
                  <th className="py-2 pr-3 text-right">Rate</th>
                  <th className="py-2 pr-3">Effective from</th>
                  <th className="py-2 pr-3 text-right"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-b border-gray-50 last:border-0">
                    <td className="py-2 pr-3 text-gray-700">{r.fromCurrency} <ArrowRight className="inline w-3 h-3 mx-1 text-gray-400" /> {r.toCurrency}</td>
                    <td className="py-2 pr-3 text-right font-medium">{Number(r.rate).toLocaleString()}</td>
                    <td className="py-2 pr-3 text-gray-700">{r.effectiveFrom}</td>
                    <td className="py-2 pr-3 text-right">
                      <button onClick={() => del(r)} className="p-1.5 rounded-lg hover:bg-rose-50"><Trash2 className="w-4 h-4 text-rose-500" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </PageLayout>
  );
}
