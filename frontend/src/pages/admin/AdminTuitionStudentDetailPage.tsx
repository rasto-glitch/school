import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { feesApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { toast } from 'react-toastify';
import PageLayout from '../../components/layout/PageLayout';
import Button from '../../components/common/Button';
import Input from '../../components/common/Input';
import Card from '../../components/common/Card';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import Modal from '../../components/common/Modal';
import { ArrowLeft, Plus, Trash2, Lock, Unlock, FileDown, Pencil } from 'lucide-react';
import type { StudentFeeRow, FeePayment, FeeStatus } from '../../types';

interface StudentFeeDetail extends StudentFeeRow { payments: FeePayment[] }

const STATUS_LABEL: Record<FeeStatus, string> = {
  paid_up: 'Paid up', current: 'On track', due_soon: 'Due soon', overdue: 'Overdue',
};
const STATUS_COLOR: Record<FeeStatus, string> = {
  paid_up: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  current: 'bg-slate-50 text-slate-700 border-slate-200',
  due_soon: 'bg-amber-50 text-amber-700 border-amber-200',
  overdue: 'bg-rose-50 text-rose-700 border-rose-200',
};

function fmt(amount: number, currency: string) {
  const sym: Record<string, string> = { USD: '$', EUR: '€', GBP: '£' };
  const s = sym[currency] ?? '';
  const n = amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return s ? `${s}${n}` : `${currency} ${n}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function AdminTuitionStudentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const canWrite = user?.role === 'admin';
  const basePath = user?.role === 'reception' ? '/reception/tuition' : '/admin/tuition';

  const [data, setData] = useState<StudentFeeDetail | null>(null);
  const [showPay, setShowPay] = useState(false);
  const [showAdjust, setShowAdjust] = useState(false);

  // record-payment form
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [payMethod, setPayMethod] = useState('cash');
  const [payRef, setPayRef] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [paySaving, setPaySaving] = useState(false);

  // adjustment form
  const [adjValue, setAdjValue] = useState('0');
  const [adjNotes, setAdjNotes] = useState('');
  const [adjSaving, setAdjSaving] = useState(false);

  const load = async () => {
    if (!id) return;
    const r = await feesApi.getStudentFee(id);
    setData(r.data);
  };

  useEffect(() => {
    if (!id) return;
    load().catch((e: any) => toast.error(e.response?.data?.error || 'Failed to load'));
  }, [id]);

  if (!data) return <PageLayout title="Tuition"><LoadingSpinner /></PageLayout>;

  const due = data.totalAmount + data.adjustment - data.siblingDiscount;
  const remaining = Math.max(0, due - data.paid);

  const recordPayment = async () => {
    if (!id) return;
    const amount = Number(payAmount);
    if (isNaN(amount) || amount <= 0) { toast.error('Enter a positive amount'); return; }
    setPaySaving(true);
    try {
      await feesApi.recordPayment(id, { amount, paidOn: payDate, method: payMethod, reference: payRef || undefined, notes: payNotes || undefined });
      toast.success('Payment recorded');
      setShowPay(false);
      setPayAmount(''); setPayRef(''); setPayNotes('');
      await load();
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to record payment');
    } finally { setPaySaving(false); }
  };

  const deletePayment = async (paymentId: string) => {
    if (!confirm('Void this payment? It will be removed from the ledger.')) return;
    try {
      await feesApi.deletePayment(paymentId);
      toast.success('Payment voided');
      await load();
    } catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  const downloadReceipt = async (p: FeePayment) => {
    try {
      const r = await feesApi.downloadPaymentReceipt(p.id);
      downloadBlob(r.data, `receipt-${p.id.slice(0, 8)}.pdf`);
    } catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  const downloadSummary = async () => {
    if (!id) return;
    try {
      const r = await feesApi.downloadStudentFeeSummary(id);
      downloadBlob(r.data, `tuition-statement-${id.slice(0, 8)}.pdf`);
    } catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  const saveAdjustment = async () => {
    if (!id) return;
    setAdjSaving(true);
    try {
      await feesApi.updateStudentFee(id, { adjustment: Number(adjValue), notes: adjNotes || null });
      toast.success('Adjustment saved');
      setShowAdjust(false);
      await load();
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to save');
    } finally { setAdjSaving(false); }
  };

  const toggleLock = async (feature: 'grades' | 'reports') => {
    if (!data || !canWrite) return;
    const isLocked = data.lockedFeatures.includes(feature);
    try {
      if (isLocked) {
        await feesApi.removeLock(data.studentId, feature);
        toast.success(`${feature} unlocked`);
      } else {
        await feesApi.setLock(data.studentId, { feature, reason: 'unpaid_fees' });
        toast.success(`${feature} locked`);
      }
      await load();
    } catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  return (
    <PageLayout title={data.studentName} subtitle={data.parentName || 'No parent linked'}>
      <button onClick={() => navigate(basePath)} className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to tuition
      </button>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Summary card */}
        <div className="lg:col-span-2">
          <Card>
            <div className="flex items-start justify-between mb-3">
              <div>
                <h2 className="font-semibold text-gray-900">{data.planName}</h2>
                <div className="text-sm text-gray-500">
                  {data.academicYear && <>{data.academicYear} · </>}
                  {data.className || 'No class'}
                </div>
              </div>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${STATUS_COLOR[data.status]}`}>
                {STATUS_LABEL[data.status]}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <Stat label="Tuition" value={fmt(data.totalAmount, data.currency)} />
              {data.adjustment !== 0 && <Stat label={data.adjustment < 0 ? 'Adjustment' : 'Surcharge'} value={fmt(data.adjustment, data.currency)} />}
              {data.siblingDiscount > 0 && <Stat label="Sibling discount" value={`−${fmt(data.siblingDiscount, data.currency)}`} />}
              <Stat label="Paid" value={fmt(data.paid, data.currency)} />
              <Stat label="Balance" value={fmt(remaining, data.currency)} accent={remaining > 0} />
            </div>

            <div className="h-2 rounded-full bg-gray-100 overflow-hidden mb-1">
              <div className="h-full bg-primary-500" style={{ width: `${due > 0 ? Math.min(100, (data.paid / due) * 100) : 100}%` }} />
            </div>
            <p className="text-xs text-gray-500">{fmt(data.paid, data.currency)} of {fmt(due, data.currency)}</p>

            {data.installments.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
                {data.installments.map(i => (
                  <div key={i.id} className="rounded-lg bg-gray-50 px-3 py-2 text-xs">
                    <div className="text-gray-500">Installment {i.sequence}</div>
                    <div className="font-semibold text-gray-900">{fmt(i.amount, data.currency)}</div>
                    <div className="text-gray-500">due {i.dueDate}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Payments */}
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-gray-900">Payments</h3>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={downloadSummary} icon={<FileDown className="w-4 h-4" />}>Statement</Button>
                {canWrite && <Button size="sm" onClick={() => setShowPay(true)} icon={<Plus className="w-4 h-4" />}>Record payment</Button>}
              </div>
            </div>
            {data.payments.length === 0 ? (
              <Card><p className="text-sm text-gray-500 text-center py-4">No payments recorded yet.</p></Card>
            ) : (
              <Card className="!p-0">
                <div className="divide-y divide-gray-100">
                  {data.payments.map(p => (
                    <div key={p.id} className="flex items-center gap-3 px-4 py-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-gray-900">{fmt(p.amount, data.currency)}</span>
                          <span className="text-xs text-gray-500">· {p.paidOn}</span>
                          {p.method && <span className="text-xs text-gray-500">· {p.method}</span>}
                          {p.reference && <span className="text-xs text-gray-500">· ref {p.reference}</span>}
                        </div>
                        {p.notes && <div className="text-xs text-gray-500 mt-0.5 truncate">{p.notes}</div>}
                      </div>
                      <button onClick={() => downloadReceipt(p)} className="p-2 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg" title="Download receipt">
                        <FileDown className="w-4 h-4" />
                      </button>
                      {canWrite && (
                        <button onClick={() => deletePayment(p.id)} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg" title="Void">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        </div>

        {/* Side panel: locks + adjustments */}
        <div className="space-y-4">
          <Card>
            <h3 className="font-semibold text-gray-900 mb-1">Feature locks</h3>
            <p className="text-xs text-gray-500 mb-3">Lock specific portal features for this student until fees are settled. Critical features (attendance, bus, chat) stay available.</p>
            {(['grades', 'reports'] as const).map(f => {
              const locked = data.lockedFeatures.includes(f);
              return (
                <div key={f} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-b-0">
                  <span className="text-sm font-medium text-gray-800 capitalize">{f}</span>
                  <button
                    onClick={() => toggleLock(f)}
                    disabled={!canWrite}
                    className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                      locked ? 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100' : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {locked ? <><Lock className="w-3 h-3" /> Locked</> : <><Unlock className="w-3 h-3" /> Unlocked</>}
                  </button>
                </div>
              );
            })}
          </Card>

          {canWrite && (
            <Card>
              <div className="flex items-center justify-between mb-1">
                <h3 className="font-semibold text-gray-900">Adjustment</h3>
                <button onClick={() => { setAdjValue(String(data.adjustment)); setAdjNotes(data.adjustment ? 'Scholarship' : ''); setShowAdjust(true); }} className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg"><Pencil className="w-4 h-4" /></button>
              </div>
              <p className="text-xs text-gray-500 mb-2">Manual override on top of plan total. Negative for scholarships, positive for surcharges. Sibling discount is computed separately.</p>
              <div className="text-2xl font-bold text-gray-900">{fmt(data.adjustment, data.currency)}</div>
            </Card>
          )}
        </div>
      </div>

      {showPay && (
        <Modal isOpen onClose={() => setShowPay(false)} title="Record payment">
          <div className="space-y-3">
            <Input label={`Amount (${data.currency})`} type="number" step="0.01" value={payAmount} onChange={e => setPayAmount(e.target.value)} autoFocus />
            <Input label="Paid on" type="date" value={payDate} onChange={e => setPayDate(e.target.value)} />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Method</label>
              <select value={payMethod} onChange={e => setPayMethod(e.target.value)} className="w-full border border-gray-300 rounded-xl px-4 py-2.5 bg-white min-h-[44px] focus:outline-none focus:ring-2 focus:ring-primary-500">
                <option value="cash">Cash</option>
                <option value="bank">Bank deposit</option>
                <option value="transfer">Bank transfer</option>
                <option value="card">Card</option>
                <option value="other">Other</option>
              </select>
            </div>
            <Input label="Reference (optional)" value={payRef} onChange={e => setPayRef(e.target.value)} placeholder="Receipt no., transfer ID…" />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Notes (optional)</label>
              <textarea rows={2} value={payNotes} onChange={e => setPayNotes(e.target.value)} className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="ghost" onClick={() => setShowPay(false)}>Cancel</Button>
              <Button onClick={recordPayment} loading={paySaving}>Record</Button>
            </div>
          </div>
        </Modal>
      )}

      {showAdjust && (
        <Modal isOpen onClose={() => setShowAdjust(false)} title="Adjustment">
          <div className="space-y-3">
            <Input label={`Adjustment (${data.currency})`} type="number" step="0.01" value={adjValue} onChange={e => setAdjValue(e.target.value)} />
            <p className="text-xs text-gray-500">Negative reduces the bill (scholarship). Positive adds a surcharge.</p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Reason</label>
              <textarea rows={2} value={adjNotes} onChange={e => setAdjNotes(e.target.value)} className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="ghost" onClick={() => setShowAdjust(false)}>Cancel</Button>
              <Button onClick={saveAdjustment} loading={adjSaving}>Save</Button>
            </div>
          </div>
        </Modal>
      )}
    </PageLayout>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
      <div className={`text-lg font-bold ${accent ? 'text-primary-600' : 'text-gray-900'}`}>{value}</div>
    </div>
  );
}
