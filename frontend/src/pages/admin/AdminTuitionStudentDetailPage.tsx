import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { feesApi, accountingApi, type PaymentAccount } from '../../services/api';
import FxConversionHint from '../../components/admin/FxConversionHint';
import { useAuthStore } from '../../store/authStore';
import { toast } from 'react-toastify';
import PageLayout from '../../components/layout/PageLayout';
import Button from '../../components/common/Button';
import Input from '../../components/common/Input';
import Card from '../../components/common/Card';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import Modal from '../../components/common/Modal';
import { ArrowLeft, Plus, Trash2, Lock, Unlock, FileDown, Pencil, Undo2 } from 'lucide-react';
import type { StudentDetail, StudentDetailPlan, FeePayment, FeeStatus, FeePlanKind } from '../../types';
import { fmtMoney as fmt } from '../../utils/money';

// i18n keys (shared accounting.tuition.*); resolved with t() at render.
const STATUS_LABEL: Record<FeeStatus, string> = {
  paid_up: 'accounting.tuition.status.paid_up',
  current: 'accounting.tuition.status.current',
  due_soon: 'accounting.tuition.status.due_soon',
  overdue: 'accounting.tuition.status.overdue',
};
const STATUS_COLOR: Record<FeeStatus, string> = {
  paid_up: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  current: 'bg-slate-50 text-slate-700 border-slate-200',
  due_soon: 'bg-amber-50 text-amber-700 border-amber-200',
  overdue: 'bg-rose-50 text-rose-700 border-rose-200',
};
const KIND_LABEL: Record<FeePlanKind, string> = {
  tuition: 'accounting.tuition.kind.tuition',
  transport: 'accounting.tuition.kind.transport',
  lunch: 'accounting.tuition.kind.lunch',
  uniform: 'accounting.tuition.kind.uniform',
  exam: 'accounting.tuition.kind.exam',
  registration: 'accounting.tuition.kind.registration',
  other: 'accounting.tuition.kind.other',
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
  const { t } = useTranslation();
  // The :id route param is now the student.id (not the student_fees.id).
  // Existing links from AR aging already pass studentId; legacy links from earlier
  // builds passing student_fees.id will 404 cleanly with "Student has no fees".
  const { id: studentId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  // ?kind=transport in the URL (set by the Students list when a kind chip is active)
  // is used to:
  //   1. Pre-select that kind's tab on first load instead of defaulting to the first plan.
  //   2. Round-trip back to the list with the same chip selected when "Back" is clicked.
  const [searchParams] = useSearchParams();
  const desiredKind = searchParams.get('kind') as FeePlanKind | null;
  const { user } = useAuthStore();
  const canWrite = user?.role === 'admin' || user?.role === 'accountant';
  const basePath = '/accounting';

  const [data, setData] = useState<StudentDetail | null>(null);
  const [activeTab, setActiveTab] = useState<string>('');  // studentFeeId of the active plan
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);

  const [showPay, setShowPay] = useState(false);
  const [showAdjust, setShowAdjust] = useState(false);
  const [refundOf, setRefundOf] = useState<FeePayment | null>(null);

  // record-payment form
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [payMethod, setPayMethod] = useState('cash');
  const [payRef, setPayRef] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [payTaxAmount, setPayTaxAmount] = useState('');
  const [payTaxLabel, setPayTaxLabel] = useState('');
  const [payAccountId, setPayAccountId] = useState<string>('');
  const [paySaving, setPaySaving] = useState(false);
  const [allocAmounts, setAllocAmounts] = useState<Record<string, string>>({});
  const [extraAmount, setExtraAmount] = useState('');
  const [extraNote, setExtraNote] = useState('');

  // adjustment form
  const [adjValue, setAdjValue] = useState('0');
  const [adjNotes, setAdjNotes] = useState('');
  const [adjSaving, setAdjSaving] = useState(false);

  // refund form
  const [refundAmount, setRefundAmount] = useState('');
  const [refundDate, setRefundDate] = useState(new Date().toISOString().slice(0, 10));
  const [refundMethod, setRefundMethod] = useState('cash');
  const [refundNotes, setRefundNotes] = useState('');
  const [refundAccountId, setRefundAccountId] = useState<string>('');
  const [refundBusy, setRefundBusy] = useState(false);

  // HD-14 — itemised late-fee history for the active plan. The plan card
  // shows the aggregate `lateFees` stat; this list shows each applied
  // late-fee row with its date, amount, and void marker so the parent
  // dispute "why is there a $X charge?" has a clear answer.
  interface LateFeeRow { id: string; appliedOn: string; amount: number; voidedAt: string | null; voidReason: string | null }
  const [lateFees, setLateFees] = useState<LateFeeRow[]>([]);

  const load = async () => {
    if (!studentId) return;
    const r = await feesApi.getStudentDetail(studentId);
    const detail = r.data as StudentDetail;
    setData(detail);
    // Pick the first plan as the default active tab on first load.
    // On subsequent reloads (after recording a payment), keep the active tab
    // if it still exists; otherwise fall back to the first plan.
    setActiveTab(prev => {
      if (prev && detail.plans.some(p => p.studentFeeId === prev)) return prev;
      // If the user arrived from a kind-filtered list (?kind=transport), open that
      // plan's tab instead of the first one. Falls back to the first plan if the
      // student doesn't have a plan of that kind.
      if (desiredKind) {
        const match = detail.plans.find(p => p.kind === desiredKind);
        if (match) return match.studentFeeId;
      }
      return detail.plans[0]?.studentFeeId ?? '';
    });
  };

  useEffect(() => {
    if (!studentId) return;
    load().catch((e: any) => toast.error(e.response?.data?.error || t('accounting.detail.load_failed')));
    accountingApi.listPaymentAccounts().then(r => {
      const active = r.data.filter(a => a.isActive);
      setAccounts(active);
      // Default both pickers to the primary (first) account so the required
      // field is pre-filled and money lands in a real account by default.
      if (active[0]) { setPayAccountId(active[0].id); setRefundAccountId(active[0].id); }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  // HD-14 — fetch the late-fee history whenever the active tab changes.
  // No pagination here; per-plan late-fee counts are small (one per
  // overdue installment per cycle).
  useEffect(() => {
    if (!activeTab) { setLateFees([]); return; }
    feesApi.listLateFees(activeTab).then(r => {
      const rows = (r.data?.data ?? []) as any[];
      setLateFees(rows.map(x => ({
        id: String(x.id),
        appliedOn: String(x.appliedOn ?? x.applied_on ?? ''),
        amount: Number(x.amount ?? 0),
        voidedAt: x.voidedAt ?? x.voided_at ?? null,
        voidReason: x.voidReason ?? x.void_reason ?? null,
      })));
    }).catch(() => setLateFees([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, data]);

  // The "currently visible" plan derived from the active tab.
  const activePlan: StudentDetailPlan | null = useMemo(() => {
    if (!data) return null;
    return data.plans.find(p => p.studentFeeId === activeTab) ?? data.plans[0] ?? null;
  }, [data, activeTab]);

  // How much of each installment has already been allocated by prior payments,
  // so the per-installment input shows "X left of Y".
  const paidByInstallment = useMemo(() => {
    const m = new Map<string, number>();
    if (!activePlan) return m;
    for (const p of activePlan.payments) {
      for (const a of p.allocations ?? []) {
        m.set(a.installmentId, (m.get(a.installmentId) ?? 0) + a.amount);
      }
    }
    return m;
  }, [activePlan]);

  if (!data) return <PageLayout title={t('accounting.tuition.students_title')}><LoadingSpinner /></PageLayout>;
  if (!activePlan) {
    return (
      <PageLayout title={data.studentName} subtitle={t('accounting.detail.no_plans_sub')}>
        <button onClick={() => navigate(basePath)} className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 mb-4">
          <ArrowLeft className="w-4 h-4" /> {t('common.back')}
        </button>
        <Card><p className="text-sm text-gray-500">{t('accounting.detail.no_plans_body')}</p></Card>
      </PageLayout>
    );
  }

  const due = activePlan.totalAmount + activePlan.adjustment - activePlan.siblingDiscount + activePlan.lateFees;
  const remaining = Math.max(0, due - activePlan.paid);

  // ── Record-payment math ──
  const allocations = activePlan.installments
    .map(i => {
      const v = allocAmounts[i.id];
      const n = Number(v);
      return v && !isNaN(n) && n > 0 ? { installmentId: i.id, amount: n } : null;
    })
    .filter((x): x is { installmentId: string; amount: number } => !!x);
  const allocSum = allocations.reduce((s, a) => s + a.amount, 0);
  const extraNum = Number(extraAmount);
  const extraValid = extraAmount && !isNaN(extraNum) && extraNum > 0 ? extraNum : 0;
  const totalPay = allocSum + extraValid;
  const hasInstallments = activePlan.installments.length > 0;
  const needsExtraNote = hasInstallments && allocations.length > 0 && extraValid > 0;

  const recordPayment = async () => {
    if (totalPay <= 0) { toast.error(t('accounting.detail.err_positive')); return; }
    if (needsExtraNote && !extraNote.trim()) { toast.error(t('accounting.detail.err_other_note')); return; }
    if (!payAccountId) { toast.error(t('accounting.detail.err_account')); return; }
    setPaySaving(true);
    try {
      await feesApi.recordPayment(activePlan.studentFeeId, {
        amount: totalPay,
        paidOn: payDate,
        method: payMethod,
        reference: payRef || undefined,
        notes: payNotes || undefined,
        allocations: allocations.length > 0 ? allocations : undefined,
        unallocatedNote: needsExtraNote ? extraNote.trim() : undefined,
        taxAmount: Number(payTaxAmount) || 0,
        taxLabel: payTaxLabel || undefined,
        paymentAccountId: payAccountId,
      });
      toast.success(t('accounting.detail.payment_recorded'));
      setShowPay(false);
      setAllocAmounts({}); setExtraAmount(''); setExtraNote(''); setPayRef(''); setPayNotes('');
      setPayTaxAmount(''); setPayTaxLabel('');
      await load();
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('accounting.detail.record_failed'));
    } finally { setPaySaving(false); }
  };

  const deletePayment = async (paymentId: string) => {
    if (!confirm(t('accounting.detail.void_confirm'))) return;
    try {
      await feesApi.deletePayment(paymentId);
      toast.success(t('accounting.detail.payment_voided'));
      await load();
    } catch (e: any) { toast.error(e.response?.data?.error || t('accounting.detail.failed')); }
  };

  const downloadReceipt = async (p: FeePayment) => {
    try {
      const r = await feesApi.downloadPaymentReceipt(p.id);
      downloadBlob(r.data, `receipt-${p.id.slice(0, 8)}.pdf`);
    } catch (e: any) { toast.error(e.response?.data?.error || t('accounting.detail.failed')); }
  };

  const downloadSummary = async () => {
    if (!activePlan) return;
    try {
      const r = await feesApi.downloadStudentFeeSummary(activePlan.studentFeeId);
      downloadBlob(r.data, `tuition-statement-${activePlan.studentFeeId.slice(0, 8)}.pdf`);
    } catch (e: any) { toast.error(e.response?.data?.error || t('accounting.detail.failed')); }
  };

  const submitRefund = async () => {
    if (!refundOf) return;
    const amt = Number(refundAmount);
    if (!isFinite(amt) || amt <= 0) { toast.error(t('accounting.detail.err_refund_positive')); return; }
    if (!refundAccountId) { toast.error(t('accounting.detail.err_refund_account')); return; }
    setRefundBusy(true);
    try {
      await feesApi.refundPayment(refundOf.id, {
        amount: amt,
        refundedOn: refundDate,
        method: refundMethod || undefined,
        notes: refundNotes || undefined,
        paymentAccountId: refundAccountId,
      });
      toast.success(t('accounting.detail.refund_recorded'));
      setRefundOf(null);
      setRefundAmount(''); setRefundNotes('');
      await load();
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('accounting.detail.refund_failed'));
    } finally { setRefundBusy(false); }
  };

  const saveAdjustment = async () => {
    if (!activePlan) return;
    setAdjSaving(true);
    try {
      await feesApi.updateStudentFee(activePlan.studentFeeId, { adjustment: Number(adjValue), notes: adjNotes || null });
      toast.success(t('accounting.detail.adjustment_saved'));
      setShowAdjust(false);
      await load();
    } catch (e: any) {
      toast.error(e.response?.data?.error || t('accounting.detail.save_failed'));
    } finally { setAdjSaving(false); }
  };

  const toggleLock = async (feature: 'grades' | 'reports') => {
    if (!data || !canWrite) return;
    const isLocked = data.lockedFeatures.includes(feature);
    const featureLabel = t(`nav.${feature}`);
    try {
      if (isLocked) {
        await feesApi.removeLock(data.studentId, feature);
        toast.success(t('accounting.detail.feature_unlocked', { feature: featureLabel }));
      } else {
        await feesApi.setLock(data.studentId, { feature, reason: 'unpaid_fees' });
        toast.success(t('accounting.detail.feature_locked', { feature: featureLabel }));
      }
      await load();
    } catch (e: any) { toast.error(e.response?.data?.error || t('accounting.detail.failed')); }
  };

  return (
    <PageLayout title={data.studentName} subtitle={data.parentName || t('accounting.detail.no_parent')}>
      <button onClick={() => navigate(desiredKind ? `${basePath}?kind=${desiredKind}` : basePath)} className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 mb-4">
        <ArrowLeft className="w-4 h-4" /> {t('accounting.detail.back_to_tuition')}
      </button>

      {/* Per-plan tabs — one tab per kind/plan. Each tab shows its own balance so the
          accountant can scan "tuition $5k, transport $300" without clicking. */}
      <div className="bg-white rounded-2xl border border-gray-200 p-1.5 mb-4 inline-flex flex-wrap gap-1">
        {data.plans.map(p => {
          const isActive = p.studentFeeId === activeTab;
          const planBal = Math.max(0, p.totalAmount + p.adjustment - p.siblingDiscount + p.lateFees - p.paid);
          return (
            <button
              key={p.studentFeeId}
              onClick={() => setActiveTab(p.studentFeeId)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors flex items-center gap-2 ${
                isActive ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <span>{KIND_LABEL[p.kind] ? t(KIND_LABEL[p.kind]) : p.kind}</span>
              <span className={`text-xs font-medium ${isActive ? 'opacity-90' : 'text-gray-400'}`}>
                {fmt(planBal, p.currency)}
              </span>
            </button>
          );
        })}
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Active-plan summary card */}
        <div className="lg:col-span-2">
          <Card>
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="font-semibold text-gray-900">{activePlan.planName}</h2>
                  {activePlan.kind !== 'tuition' && (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                      {t(`accounting.tuition.kind.${activePlan.kind}`)}
                    </span>
                  )}
                </div>
                <div className="text-sm text-gray-500">
                  {activePlan.academicYear && <>{activePlan.academicYear} · </>}
                  {data.className || t('accounting.detail.no_class')}
                </div>
              </div>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${STATUS_COLOR[activePlan.status]}`}>
                {t(STATUS_LABEL[activePlan.status])}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <Stat label={t('accounting.detail.plan_total')} value={fmt(activePlan.totalAmount, activePlan.currency)} />
              {activePlan.adjustment !== 0 && <Stat label={activePlan.adjustment < 0 ? t('accounting.detail.adjustment') : t('accounting.detail.surcharge')} value={fmt(activePlan.adjustment, activePlan.currency)} />}
              {activePlan.siblingDiscount > 0 && <Stat label={t('accounting.detail.sibling_discount')} value={`−${fmt(activePlan.siblingDiscount, activePlan.currency)}`} />}
              {activePlan.lateFees > 0 && <Stat label={t('accounting.detail.late_fees')} value={fmt(activePlan.lateFees, activePlan.currency)} />}
              <Stat label={t('accounting.detail.paid')} value={fmt(activePlan.paid, activePlan.currency)} />
              <Stat label={t('accounting.detail.balance')} value={fmt(remaining, activePlan.currency)} accent={remaining > 0} />
            </div>

            <div className="h-2 rounded-full bg-gray-100 overflow-hidden mb-1">
              <div className="h-full bg-primary-500" style={{ width: `${due > 0 ? Math.min(100, (activePlan.paid / due) * 100) : 100}%` }} />
            </div>
            <p className="text-xs text-gray-500">{t('accounting.detail.paid_of', { paid: fmt(activePlan.paid, activePlan.currency), due: fmt(due, activePlan.currency) })}</p>

            {activePlan.installments.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
                {activePlan.installments.map(i => {
                  const paidThis = paidByInstallment.get(i.id) ?? 0;
                  const fullyPaid = paidThis >= i.effectiveAmount - 0.01;
                  const partial = paidThis > 0 && !fullyPaid;
                  const adjusted = Math.abs(i.effectiveAmount - i.amount) >= 0.01;
                  return (
                    <div key={i.id} className={`rounded-lg px-3 py-2 text-xs border ${fullyPaid ? 'bg-emerald-50 border-emerald-200' : partial ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'}`}>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500">{t('accounting.detail.installment_n', { n: i.sequence })}</span>
                        {fullyPaid && <span className="text-emerald-700 font-medium">{t('accounting.detail.paid_badge')}</span>}
                        {partial && <span className="text-amber-700 font-medium">{t('accounting.detail.partial')}</span>}
                      </div>
                      <div className="font-semibold text-gray-900">{fmt(i.effectiveAmount, activePlan.currency)}</div>
                      {adjusted && <div className="text-gray-400 text-[10px]">{t('accounting.detail.base', { amount: fmt(i.amount, activePlan.currency) })}</div>}
                      {paidThis > 0 && !fullyPaid && (
                        <div className="text-amber-700">{t('accounting.detail.amount_paid', { amount: fmt(paidThis, activePlan.currency) })}</div>
                      )}
                      <div className="text-gray-500">{t('accounting.detail.due_date', { date: i.dueDate })}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* HD-14 — itemised late-fee list. Hidden when there are no
              applied late fees so the page stays uncluttered for the
              common case. Each row is dated; voided rows render with
              strike-through + label so the audit trail is visible
              even though the live aggregate ignores them. */}
          {lateFees.length > 0 && (
            <div className="mt-4">
              <h3 className="font-semibold text-gray-900 mb-2">{t('accounting.detail.late_fees_history', 'Late fees applied')}</h3>
              <Card className="!p-0">
                <div className="divide-y divide-gray-100">
                  {lateFees.map(lf => {
                    const isVoided = Boolean(lf.voidedAt);
                    return (
                      <div key={lf.id} className={`flex items-center justify-between px-4 py-2 text-xs ${isVoided ? 'opacity-60' : ''}`}>
                        <div>
                          <span className={`font-semibold ${isVoided ? 'line-through text-gray-500' : 'text-gray-900'}`}>{fmt(lf.amount, activePlan.currency)}</span>
                          <span className="text-gray-500 ml-2">· {lf.appliedOn}</span>
                          {isVoided && <span className="ml-2 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-200 text-gray-700">{t('tuition.voided_badge')}</span>}
                        </div>
                        {isVoided && (
                          <span className="text-[11px] text-rose-700">{t('tuition.voided_on', { date: String(lf.voidedAt).slice(0, 10) })}{lf.voidReason ? ` · ${lf.voidReason}` : ''}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>
            </div>
          )}

          {/* Payments for the active plan */}
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-gray-900">{t('accounting.detail.payments')} · {KIND_LABEL[activePlan.kind] ? t(KIND_LABEL[activePlan.kind]) : activePlan.kind}</h3>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={downloadSummary} icon={<FileDown className="w-4 h-4" />}>{t('accounting.detail.statement')}</Button>
                {canWrite && <Button size="sm" onClick={() => setShowPay(true)} icon={<Plus className="w-4 h-4" />}>{t('accounting.detail.record_payment')}</Button>}
              </div>
            </div>
            {activePlan.payments.length === 0 ? (
              <Card><p className="text-sm text-gray-500 text-center py-4">{t('accounting.detail.no_payments_yet')}</p></Card>
            ) : (
              <Card className="!p-0">
                <div className="divide-y divide-gray-100">
                  {/* HD-18 — index payments by id so a refund row can show
                      a "Refunds RCP-..." pointer back to the original it
                      offsets. Builds in O(n); lookup is O(1) per row. */}
                  {(() => null)()}
                  {(() => {
                    const byId = new Map(activePlan.payments.map(x => [x.id, x] as const));
                    return activePlan.payments.map(p => {
                      const orig = p.isRefund && p.refundOfPaymentId ? byId.get(p.refundOfPaymentId) : null;
                      return (
                    <div key={p.id} className={`flex items-center gap-3 px-4 py-3 ${p.isRefund ? 'bg-rose-50/30' : ''}`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`font-semibold ${p.isRefund ? 'text-rose-700' : 'text-gray-900'}`}>{p.isRefund ? '−' : ''}{fmt(p.amount, p.currency || activePlan.currency)}</span>
                          <span className="text-xs text-gray-500">· {p.paidOn}</span>
                          {p.isRefund && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">{t('accounting.detail.refund_badge')}</span>}
                          {p.receiptYear && p.receiptNumber && (
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">RCP-{p.receiptYear}-{String(p.receiptNumber).padStart(5, '0')}</span>
                          )}
                          {p.method && <span className="text-xs text-gray-500">· {p.method}</span>}
                          {p.reference && <span className="text-xs text-gray-500">· {t('accounting.detail.ref', { ref: p.reference })}</span>}
                          {(p.taxAmount ?? 0) > 0 && <span className="text-xs text-gray-500">· {t('accounting.detail.tax', { amount: fmt(p.taxAmount ?? 0, p.currency || activePlan.currency) })}{p.taxLabel ? ` (${p.taxLabel})` : ''}</span>}
                        </div>
                        {orig && (
                          <div className="text-xs text-rose-700 mt-0.5">
                            {t('accounting.detail.refunds_payment', { defaultValue: 'Refunds' })}{' '}
                            {orig.receiptYear && orig.receiptNumber
                              ? <span className="font-mono">RCP-{orig.receiptYear}-{String(orig.receiptNumber).padStart(5, '0')}</span>
                              : <span>· {orig.paidOn}</span>}{' '}
                            <span className="text-gray-500">· {fmt(orig.amount, orig.currency || activePlan.currency)}</span>
                          </div>
                        )}
                        <div className="text-xs text-gray-700 mt-0.5">
                          <span className="text-gray-500">{t('accounting.detail.recorded_by')} </span>
                          <span className="font-medium">{p.recorderName || '—'}</span>
                        </div>
                        {p.allocations && p.allocations.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {p.allocations.map(a => (
                              <span key={a.installmentId} className="text-xs px-1.5 py-0.5 rounded bg-primary-50 text-primary-700 border border-primary-100">
                                {t('accounting.detail.inst_alloc', { n: a.sequence, amount: fmt(a.amount, activePlan.currency) })}
                              </span>
                            ))}
                            {(p.unallocatedAmount ?? 0) > 0 && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-100">
                                {t('accounting.detail.other_alloc', { amount: fmt(p.unallocatedAmount ?? 0, activePlan.currency) })}
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
                    );
                  });
                  })()}
                </div>
              </Card>
            )}
          </div>
        </div>

        {/* Side panel: locks (per-student) + adjustment (per-active-plan) */}
        <div className="space-y-4">
          <Card>
            <h3 className="font-semibold text-gray-900 mb-1">{t('accounting.detail.feature_locks')}</h3>
            <p className="text-xs text-gray-500 mb-3">{t('accounting.detail.locks_desc')}</p>
            {(['grades', 'reports'] as const).map(f => {
              const locked = data.lockedFeatures.includes(f);
              return (
                <div key={f} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-b-0">
                  <span className="text-sm font-medium text-gray-800">{t(`nav.${f}`)}</span>
                  <button
                    onClick={() => toggleLock(f)}
                    disabled={!canWrite}
                    className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                      locked ? 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100' : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {locked ? <><Lock className="w-3 h-3" /> {t('accounting.detail.locked')}</> : <><Unlock className="w-3 h-3" /> {t('accounting.detail.unlocked')}</>}
                  </button>
                </div>
              );
            })}
          </Card>

          {canWrite && (
            <Card>
              <div className="flex items-center justify-between mb-1">
                <h3 className="font-semibold text-gray-900">{t('accounting.detail.adjustment')} <span className="text-xs text-gray-400 font-normal">· {KIND_LABEL[activePlan.kind] ? t(KIND_LABEL[activePlan.kind]) : activePlan.kind}</span></h3>
                <button onClick={() => { setAdjValue(String(activePlan.adjustment)); setAdjNotes(activePlan.adjustment ? t('accounting.detail.scholarship') : ''); setShowAdjust(true); }} className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg"><Pencil className="w-4 h-4" /></button>
              </div>
              <p className="text-xs text-gray-500 mb-2">{t('accounting.detail.adjustment_desc')}</p>
              <div className="text-2xl font-bold text-gray-900">{fmt(activePlan.adjustment, activePlan.currency)}</div>
            </Card>
          )}
        </div>
      </div>

      {/* Record payment modal */}
      {showPay && (
        <Modal isOpen onClose={() => setShowPay(false)} title={`${t('accounting.detail.record_payment')} · ${KIND_LABEL[activePlan.kind] ? t(KIND_LABEL[activePlan.kind]) : activePlan.kind}`}>
          <div className="space-y-3">
            {hasInstallments && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('accounting.plans.f_installments')}</label>
                <p className="text-xs text-gray-500 mb-2">{t('accounting.detail.installments_help')}</p>
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {activePlan.installments.map(i => {
                    const alreadyPaid = paidByInstallment.get(i.id) ?? 0;
                    const remainingThis = Math.max(0, i.effectiveAmount - alreadyPaid);
                    const isPaid = remainingThis === 0;
                    const adjusted = Math.abs(i.effectiveAmount - i.amount) >= 0.01;
                    return (
                      <div key={i.id} className={`rounded-lg border ${isPaid ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50 border-gray-200'} px-3 py-2`}>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <div className="text-xs text-gray-600">
                            <span className="font-semibold text-gray-900">{t('accounting.detail.installment_n', { n: i.sequence })}</span>
                            <span className="text-gray-500"> · {t('accounting.detail.due_date', { date: i.dueDate })}</span>
                            {adjusted && <span className="text-gray-400"> · {t('accounting.detail.base', { amount: fmt(i.amount, activePlan.currency) })}</span>}
                          </div>
                          <div className="text-xs text-gray-500">
                            {isPaid ? <span className="text-emerald-700 font-medium">{t('accounting.detail.paid_badge')}</span> : <>{t('accounting.detail.left_of', { left: fmt(remainingThis, activePlan.currency), total: fmt(i.effectiveAmount, activePlan.currency) })}</>}
                          </div>
                        </div>
                        {!isPaid && (
                          <Input
                            type="number"
                            step="0.01"
                            placeholder={`0.00 (${activePlan.currency})`}
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
                  label={t('accounting.detail.other_amount')}
                  type="number"
                  step="0.01"
                  value={extraAmount}
                  onChange={e => setExtraAmount(e.target.value)}
                  placeholder="0.00"
                />
                {needsExtraNote && (
                  <div className="mt-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('accounting.detail.other_note_label')} <span className="text-red-500">*</span></label>
                    <textarea
                      rows={2}
                      value={extraNote}
                      onChange={e => setExtraNote(e.target.value)}
                      placeholder={t('accounting.detail.other_note_ph')}
                      className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                )}
              </div>
            )}
            {!hasInstallments && (
              <Input
                label={t('accounting.detail.amount_currency', { currency: activePlan.currency })}
                type="number"
                step="0.01"
                value={extraAmount}
                onChange={e => setExtraAmount(e.target.value)}
                autoFocus
              />
            )}
            <div className="flex items-center justify-between rounded-lg bg-primary-50 border border-primary-200 px-3 py-2">
              <span className="text-sm font-medium text-primary-900">{t('accounting.plans.total')}</span>
              <span className="text-lg font-bold text-primary-900">{fmt(totalPay, activePlan.currency)}</span>
            </div>
            <Input label={t('accounting.detail.paid_on')} type="date" value={payDate} onChange={e => setPayDate(e.target.value)} />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('accounting.detail.method')}</label>
              <select value={payMethod} onChange={e => setPayMethod(e.target.value)} className="w-full border border-gray-300 rounded-xl px-4 py-2.5 bg-white min-h-[44px] focus:outline-none focus:ring-2 focus:ring-primary-500">
                <option value="cash">{t('accounting.detail.m_cash')}</option>
                <option value="bank">{t('accounting.detail.m_bank')}</option>
                <option value="transfer">{t('accounting.detail.m_transfer')}</option>
                <option value="card">{t('accounting.detail.m_card')}</option>
                <option value="other">{t('accounting.detail.m_other')}</option>
              </select>
            </div>
            <Input label={t('accounting.detail.reference_opt')} value={payRef} onChange={e => setPayRef(e.target.value)} placeholder={t('accounting.detail.reference_ph')} />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('accounting.detail.deposit_into')} <span className="text-rose-500">*</span></label>
              {accounts.length > 0 ? (
                <select value={payAccountId} onChange={e => setPayAccountId(e.target.value)} className="w-full border border-gray-300 rounded-xl px-4 py-2.5 bg-white min-h-[44px] focus:outline-none focus:ring-2 focus:ring-primary-500">
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.kind} · {a.currency})</option>)}
                </select>
              ) : (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">{t('accounting.detail.no_accounts_pay')}</p>
              )}
              <FxConversionHint amount={totalPay} currency={activePlan.currency} paymentAccountId={payAccountId} accounts={accounts} date={payDate} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label={t('accounting.detail.tax_included')} type="number" step="0.01" value={payTaxAmount} onChange={e => setPayTaxAmount(e.target.value)} placeholder="0.00" />
              <Input label={t('accounting.detail.tax_label')} value={payTaxLabel} onChange={e => setPayTaxLabel(e.target.value)} placeholder={t('accounting.detail.tax_label_ph')} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('accounting.detail.notes_opt')}</label>
              <textarea rows={2} value={payNotes} onChange={e => setPayNotes(e.target.value)} className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="ghost" onClick={() => setShowPay(false)}>{t('common.cancel')}</Button>
              <Button onClick={recordPayment} loading={paySaving} disabled={totalPay <= 0 || !payAccountId}>{t('accounting.detail.record')}</Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Refund modal */}
      {refundOf && (
        <Modal isOpen onClose={() => setRefundOf(null)} title={t('accounting.detail.refund_title', { amount: fmt(refundOf.amount, refundOf.currency || activePlan.currency) })}>
          <div className="space-y-3">
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
              {t('accounting.detail.refund_note')}
            </p>
            <Input label={t('accounting.detail.refund_amount')} type="number" step="0.01" value={refundAmount} onChange={e => setRefundAmount(e.target.value)} />
            <Input label={t('accounting.detail.refunded_on')} type="date" value={refundDate} onChange={e => setRefundDate(e.target.value)} />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('accounting.detail.method')}</label>
              <select value={refundMethod} onChange={e => setRefundMethod(e.target.value)} className="w-full border border-gray-300 rounded-xl px-4 py-2.5 bg-white min-h-[44px] focus:outline-none focus:ring-2 focus:ring-primary-500">
                <option value="cash">{t('accounting.detail.m_cash')}</option>
                <option value="bank">{t('accounting.detail.m_bank')}</option>
                <option value="transfer">{t('accounting.detail.m_transfer')}</option>
                <option value="card">{t('accounting.detail.m_card')}</option>
                <option value="other">{t('accounting.detail.m_other')}</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('accounting.detail.paid_from')} <span className="text-rose-500">*</span></label>
              {accounts.length > 0 ? (
                <select value={refundAccountId} onChange={e => setRefundAccountId(e.target.value)} className="w-full border border-gray-300 rounded-xl px-4 py-2.5 bg-white min-h-[44px] focus:outline-none focus:ring-2 focus:ring-primary-500">
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.kind} · {a.currency})</option>)}
                </select>
              ) : (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">{t('accounting.detail.no_accounts_refund')}</p>
              )}
              <FxConversionHint amount={Number(refundAmount) || 0} currency={refundOf.currency || activePlan.currency} paymentAccountId={refundAccountId} accounts={accounts} date={refundDate} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('accounting.detail.notes_opt')}</label>
              <textarea rows={2} value={refundNotes} onChange={e => setRefundNotes(e.target.value)} className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder={t('accounting.detail.refund_reason_ph')} />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="ghost" onClick={() => setRefundOf(null)} disabled={refundBusy}>{t('common.cancel')}</Button>
              <Button onClick={submitRefund} loading={refundBusy} disabled={!refundAccountId} icon={<Undo2 className="w-4 h-4" />}>{t('accounting.detail.refund')}</Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Adjustment modal */}
      {showAdjust && (
        <Modal isOpen onClose={() => setShowAdjust(false)} title={`${t('accounting.detail.adjustment')} · ${KIND_LABEL[activePlan.kind] ? t(KIND_LABEL[activePlan.kind]) : activePlan.kind}`}>
          <div className="space-y-3">
            <Input label={t('accounting.detail.adjustment_currency', { currency: activePlan.currency })} type="number" step="0.01" value={adjValue} onChange={e => setAdjValue(e.target.value)} />
            <p className="text-xs text-gray-500">{t('accounting.detail.adjustment_hint')}</p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('accounting.detail.reason')}</label>
              <textarea
                rows={2}
                value={adjNotes}
                onChange={e => setAdjNotes(e.target.value)}
                placeholder={t('accounting.detail.reason_ph')}
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="ghost" onClick={() => setShowAdjust(false)}>{t('common.cancel')}</Button>
              <Button onClick={saveAdjustment} loading={adjSaving}>{t('common.save')}</Button>
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
      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`text-lg font-bold ${accent ? 'text-primary-700' : 'text-gray-900'}`}>{value}</div>
    </div>
  );
}
