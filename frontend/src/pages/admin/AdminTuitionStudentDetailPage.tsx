import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { feesApi, accountingApi, type PaymentAccount } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { fmtMoney as fmt } from '../../utils/money';
import { toast } from 'react-toastify';
import PageLayout from '../../components/layout/PageLayout';
import Button from '../../components/common/Button';
import Input from '../../components/common/Input';
import Card from '../../components/common/Card';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import Modal from '../../components/common/Modal';
import { ArrowLeft, Plus, Trash2, Lock, Unlock, FileDown, Pencil, Undo2 } from 'lucide-react';
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
  const canWrite = user?.role === 'admin' || user?.role === 'accountant';
  const basePath = '/accounting';

  const [data, setData] = useState<StudentFeeDetail | null>(null);
  const [showPay, setShowPay] = useState(false);
  const [showAdjust, setShowAdjust] = useState(false);
  const [refundOf, setRefundOf] = useState<FeePayment | null>(null);
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);

  // record-payment form
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [payMethod, setPayMethod] = useState('cash');
  const [payRef, setPayRef] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [payTaxAmount, setPayTaxAmount] = useState('');
  const [payTaxLabel, setPayTaxLabel] = useState('');
  const [payAccountId, setPayAccountId] = useState<string>('');
  const [paySaving, setPaySaving] = useState(false);
  // amount per installment ('' = not allocating to that one). Plus an "extra" lump field.
  const [allocAmounts, setAllocAmounts] = useState<Record<string, string>>({});
  const [extraAmount, setExtraAmount] = useState('');
  const [extraNote, setExtraNote] = useState('');

  // refund form
  const [refundAmount, setRefundAmount] = useState('');
  const [refundDate, setRefundDate] = useState(new Date().toISOString().slice(0, 10));
  const [refundMethod, setRefundMethod] = useState('cash');
  const [refundNotes, setRefundNotes] = useState('');
  const [refundBusy, setRefundBusy] = useState(false);

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
    accountingApi.listPaymentAccounts().then(r => setAccounts(r.data.filter(a => a.isActive))).catch(() => {});
  }, [id]);

  if (!data) return <PageLayout title="Tuition"><LoadingSpinner /></PageLayout>;

  const due = data.totalAmount + data.adjustment - data.siblingDiscount;
  const remaining = Math.max(0, due - data.paid);

  // How much has already been allocated to each installment from existing payments
  const paidByInstallment = new Map<string, number>();
  for (const p of data.payments) {
    for (const a of p.allocations ?? []) {
      paidByInstallment.set(a.installmentId, (paidByInstallment.get(a.installmentId) ?? 0) + a.amount);
    }
  }

  const allocations = data ? data.installments
    .map(i => {
      const v = allocAmounts[i.id];
      const n = Number(v);
      return v && !isNaN(n) && n > 0 ? { installmentId: i.id, amount: n } : null;
    })
    .filter((x): x is { installmentId: string; amount: number } => !!x) : [];
  const allocSum = allocations.reduce((s, a) => s + a.amount, 0);
  const extraNum = Number(extraAmount);
  const extraValid = extraAmount && !isNaN(extraNum) && extraNum > 0 ? extraNum : 0;
  const totalPay = allocSum + extraValid;

  const hasInstallments = data.installments.length > 0;
  const needsExtraNote = hasInstallments && allocations.length > 0 && extraValid > 0;

  const recordPayment = async () => {
    if (!id) return;
    if (totalPay <= 0) { toast.error('Enter a positive amount'); return; }
    if (needsExtraNote && !extraNote.trim()) { toast.error('Please add a note explaining the other amount'); return; }
    setPaySaving(true);
    try {
      await feesApi.recordPayment(id, {
        amount: totalPay,
        paidOn: payDate,
        method: payMethod,
        reference: payRef || undefined,
        notes: payNotes || undefined,
        allocations: allocations.length > 0 ? allocations : undefined,
        unallocatedNote: needsExtraNote ? extraNote.trim() : undefined,
        taxAmount: Number(payTaxAmount) || 0,
        taxLabel: payTaxLabel || undefined,
        paymentAccountId: payAccountId || null,
      });
      toast.success('Payment recorded');
      setShowPay(false);
      setAllocAmounts({}); setExtraAmount(''); setExtraNote(''); setPayRef(''); setPayNotes('');
      setPayTaxAmount(''); setPayTaxLabel(''); setPayAccountId('');
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

  const submitRefund = async () => {
    if (!refundOf) return;
    const amt = Number(refundAmount);
    if (!isFinite(amt) || amt <= 0) { toast.error('Enter a positive refund amount'); return; }
    setRefundBusy(true);
    try {
      await feesApi.refundPayment(refundOf.id, {
        amount: amt,
        refundedOn: refundDate,
        method: refundMethod || undefined,
        notes: refundNotes || undefined,
      });
      toast.success('Refund recorded');
      setRefundOf(null);
      setRefundAmount(''); setRefundNotes('');
      await load();
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to refund');
    } finally { setRefundBusy(false); }
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
                {data.installments.map(i => {
                  const paidThis = paidByInstallment.get(i.id) ?? 0;
                  const fullyPaid = paidThis >= i.effectiveAmount - 0.01;
                  const partial = paidThis > 0 && !fullyPaid;
                  const adjusted = Math.abs(i.effectiveAmount - i.amount) >= 0.01;
                  return (
                    <div key={i.id} className={`rounded-lg px-3 py-2 text-xs border ${fullyPaid ? 'bg-emerald-50 border-emerald-200' : partial ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'}`}>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500">Installment {i.sequence}</span>
                        {fullyPaid && <span className="text-emerald-700 font-medium">Paid</span>}
                        {partial && <span className="text-amber-700 font-medium">Partial</span>}
                      </div>
                      <div className="font-semibold text-gray-900">{fmt(i.effectiveAmount, data.currency)}</div>
                      {adjusted && <div className="text-gray-400 text-[10px]">base {fmt(i.amount, data.currency)}</div>}
                      {paidThis > 0 && !fullyPaid && (
                        <div className="text-amber-700">{fmt(paidThis, data.currency)} paid</div>
                      )}
                      <div className="text-gray-500">due {i.dueDate}</div>
                    </div>
                  );
                })}
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
                    <div key={p.id} className={`flex items-center gap-3 px-4 py-3 ${p.isRefund ? 'bg-rose-50/30' : ''}`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`font-semibold ${p.isRefund ? 'text-rose-700' : 'text-gray-900'}`}>{p.isRefund ? '−' : ''}{fmt(p.amount, p.currency || data.currency)}</span>
                          <span className="text-xs text-gray-500">· {p.paidOn}</span>
                          {p.isRefund && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">Refund</span>}
                          {p.receiptYear && p.receiptNumber && (
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">RCP-{p.receiptYear}-{String(p.receiptNumber).padStart(5, '0')}</span>
                          )}
                          {p.method && <span className="text-xs text-gray-500">· {p.method}</span>}
                          {p.reference && <span className="text-xs text-gray-500">· ref {p.reference}</span>}
                          {(p.taxAmount ?? 0) > 0 && <span className="text-xs text-gray-500">· tax {fmt(p.taxAmount ?? 0, p.currency || data.currency)}{p.taxLabel ? ` (${p.taxLabel})` : ''}</span>}
                        </div>
                        <div className="text-xs text-gray-700 mt-0.5">
                          <span className="text-gray-500">Recorded by </span>
                          <span className="font-medium">{p.recorderName || '—'}</span>
                        </div>
                        {p.allocations && p.allocations.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {p.allocations.map(a => (
                              <span key={a.installmentId} className="text-xs px-1.5 py-0.5 rounded bg-primary-50 text-primary-700 border border-primary-100">
                                Inst. {a.sequence} · {fmt(a.amount, data.currency)}
                              </span>
                            ))}
                            {(p.unallocatedAmount ?? 0) > 0 && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-100">
                                Other · {fmt(p.unallocatedAmount ?? 0, data.currency)}
                              </span>
                            )}
                          </div>
                        )}
                        {p.unallocatedNote && (p.unallocatedAmount ?? 0) > 0 && (
                          <div className="text-xs text-amber-700 mt-1 italic">"{p.unallocatedNote}"</div>
                        )}
                        {p.notes && <div className="text-xs text-gray-500 mt-1 truncate">{p.notes}</div>}
                      </div>
                      <button onClick={() => downloadReceipt(p)} className="p-2 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg" title="Download receipt">
                        <FileDown className="w-4 h-4" />
                      </button>
                      {canWrite && !p.isRefund && (
                        <button onClick={() => { setRefundOf(p); setRefundAmount(String(p.amount)); }} className="p-2 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg" title="Refund">
                          <Undo2 className="w-4 h-4" />
                        </button>
                      )}
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
            {hasInstallments && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Installments</label>
                <p className="text-xs text-gray-500 mb-2">
                  Amounts shown reflect this student's adjustment and sibling discount. Enter the amount paid against each installment — you can pay one, several, or partials.
                </p>
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {data.installments.map(i => {
                    const alreadyPaid = paidByInstallment.get(i.id) ?? 0;
                    const remainingThis = Math.max(0, i.effectiveAmount - alreadyPaid);
                    const isPaid = remainingThis === 0;
                    const adjusted = Math.abs(i.effectiveAmount - i.amount) >= 0.01;
                    return (
                      <div key={i.id} className={`rounded-lg border ${isPaid ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50 border-gray-200'} px-3 py-2`}>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <div className="text-xs text-gray-600">
                            <span className="font-semibold text-gray-900">Installment {i.sequence}</span>
                            <span className="text-gray-500"> · due {i.dueDate}</span>
                            {adjusted && <span className="text-gray-400"> · base {fmt(i.amount, data.currency)}</span>}
                          </div>
                          <div className="text-xs text-gray-500">
                            {isPaid ? <span className="text-emerald-700 font-medium">Paid</span> : <>{fmt(remainingThis, data.currency)} left of {fmt(i.effectiveAmount, data.currency)}</>}
                          </div>
                        </div>
                        {!isPaid && (
                          <Input
                            type="number"
                            step="0.01"
                            placeholder={`0.00 (${data.currency})`}
                            value={allocAmounts[i.id] ?? ''}
                            onChange={e => setAllocAmounts(prev => ({ ...prev, [i.id]: e.target.value }))}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
                <Input
                  className="mt-2"
                  label="Other amount (advance / unallocated)"
                  type="number"
                  step="0.01"
                  value={extraAmount}
                  onChange={e => setExtraAmount(e.target.value)}
                  placeholder="0.00"
                />
                {needsExtraNote && (
                  <div className="mt-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Note for the other amount <span className="text-red-500">*</span></label>
                    <p className="text-xs text-gray-500 mb-1">Required. Shown on the receipt and statement.</p>
                    <textarea
                      rows={2}
                      value={extraNote}
                      onChange={e => setExtraNote(e.target.value)}
                      placeholder="e.g. advance for next month, late fee, transport"
                      className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                )}
              </div>
            )}
            {!hasInstallments && (
              <Input
                label={`Amount (${data.currency})`}
                type="number"
                step="0.01"
                value={extraAmount}
                onChange={e => setExtraAmount(e.target.value)}
                autoFocus
              />
            )}
            <div className="flex items-center justify-between rounded-lg bg-primary-50 border border-primary-200 px-3 py-2">
              <span className="text-sm font-medium text-primary-900">Total</span>
              <span className="text-lg font-bold text-primary-900">{fmt(totalPay, data.currency)}</span>
            </div>
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
            {accounts.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Deposit into (optional)</label>
                <select value={payAccountId} onChange={e => setPayAccountId(e.target.value)} className="w-full border border-gray-300 rounded-xl px-4 py-2.5 bg-white min-h-[44px] focus:outline-none focus:ring-2 focus:ring-primary-500">
                  <option value="">— No specific account —</option>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.kind} · {a.currency})</option>)}
                </select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Input label="Tax / withholding (optional)" type="number" step="0.01" value={payTaxAmount} onChange={e => setPayTaxAmount(e.target.value)} placeholder="0.00" />
              <Input label="Tax label" value={payTaxLabel} onChange={e => setPayTaxLabel(e.target.value)} placeholder="VAT 5%, etc." />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Notes (optional)</label>
              <textarea rows={2} value={payNotes} onChange={e => setPayNotes(e.target.value)} className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="ghost" onClick={() => setShowPay(false)}>Cancel</Button>
              <Button onClick={recordPayment} loading={paySaving} disabled={totalPay <= 0}>Record</Button>
            </div>
          </div>
        </Modal>
      )}

      {refundOf && (
        <Modal isOpen onClose={() => setRefundOf(null)} title={`Refund payment of ${fmt(refundOf.amount, refundOf.currency || data.currency)}`}>
          <div className="space-y-3">
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
              The original payment is preserved. The refund is recorded as a separate negative event and a new receipt is issued.
            </p>
            <Input label="Refund amount" type="number" step="0.01" value={refundAmount} onChange={e => setRefundAmount(e.target.value)} />
            <Input label="Refunded on" type="date" value={refundDate} onChange={e => setRefundDate(e.target.value)} />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Method</label>
              <select value={refundMethod} onChange={e => setRefundMethod(e.target.value)} className="w-full border border-gray-300 rounded-xl px-4 py-2.5 bg-white min-h-[44px] focus:outline-none focus:ring-2 focus:ring-primary-500">
                <option value="cash">Cash</option>
                <option value="bank">Bank deposit</option>
                <option value="transfer">Bank transfer</option>
                <option value="card">Card</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Notes (optional)</label>
              <textarea rows={2} value={refundNotes} onChange={e => setRefundNotes(e.target.value)} className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="Why is this being refunded?" />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="ghost" onClick={() => setRefundOf(null)} disabled={refundBusy}>Cancel</Button>
              <Button onClick={submitRefund} loading={refundBusy} icon={<Undo2 className="w-4 h-4" />}>Refund</Button>
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
