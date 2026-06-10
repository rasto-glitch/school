import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { feesApi } from '../../services/api';
import { toast } from 'react-toastify';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Button from '../../components/common/Button';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';
import { CreditCard, FileDown } from 'lucide-react';
import type { StudentFeeRow, FeePayment, FeeStatus } from '../../types';

interface ParentFeeRow extends StudentFeeRow { payments: FeePayment[] }

const STATUS_COLOR: Record<FeeStatus, string> = {
  paid_up: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  current: 'bg-slate-50 text-slate-700 border-slate-200',
  due_soon: 'bg-amber-50 text-amber-700 border-amber-200',
  overdue: 'bg-rose-50 text-rose-700 border-rose-200',
};

import { fmtMoney as fmt } from '../../utils/money';

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

export default function TuitionPage() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<ParentFeeRow[] | null>(null);

  useEffect(() => {
    feesApi.getParentFees()
      .then(r => setRows(r.data))
      .catch((e: any) => {
        if (e.response?.status === 403) setRows([]); // module not enabled
        else toast.error(e.response?.data?.error || t('tuition.failed_load'));
      });
  }, [t]);

  if (rows === null) return <PageLayout title={t('tuition.title')}><LoadingSpinner /></PageLayout>;

  const downloadReceipt = async (paymentId: string) => {
    try {
      const r = await feesApi.downloadPaymentReceipt(paymentId);
      downloadBlob(r.data, `receipt-${paymentId.slice(0, 8)}.pdf`);
    } catch (e: any) { toast.error(e.response?.data?.error || t('tuition.failed')); }
  };

  const downloadStatement = async (sfId: string) => {
    try {
      const r = await feesApi.downloadStudentFeeSummary(sfId);
      downloadBlob(r.data, `tuition-statement-${sfId.slice(0, 8)}.pdf`);
    } catch (e: any) { toast.error(e.response?.data?.error || t('tuition.failed')); }
  };

  // Family rollup for header
  const totalDue = rows.reduce((s, r) => s + (r.totalAmount + r.adjustment - r.siblingDiscount), 0);
  const totalPaid = rows.reduce((s, r) => s + r.paid, 0);
  const totalBalance = rows.reduce((s, r) => s + r.balance, 0);
  const currency = rows[0]?.currency ?? 'USD';

  // Group by student so multi-year history is together
  const byStudent = new Map<string, ParentFeeRow[]>();
  for (const r of rows) {
    const arr = byStudent.get(r.studentId) ?? [];
    arr.push(r);
    byStudent.set(r.studentId, arr);
  }

  return (
    <PageLayout title={t('tuition.title')} subtitle={t('tuition.subtitle')}>
      {rows.length === 0 ? (
        <EmptyState title={t('tuition.no_records_title')} description={t('tuition.no_records_desc')} icon={<CreditCard className="w-8 h-8 text-gray-400" />} />
      ) : (
        <>
          {/* Family rollup */}
          <Card className="mb-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-900">{t('tuition.family_total')}</h2>
              {totalBalance === 0 ? (
                <span className="text-xs font-semibold px-2 py-1 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">{t('tuition.all_paid')}</span>
              ) : (
                <span className="text-xs text-gray-500">{t('tuition.across_plans', { count: rows.length })}</span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><div className="text-xs text-gray-500 uppercase">{t('common.total')}</div><div className="text-lg font-bold text-gray-900">{fmt(totalDue, currency)}</div></div>
              <div><div className="text-xs text-gray-500 uppercase">{t('tuition.paid')}</div><div className="text-lg font-bold text-gray-900">{fmt(totalPaid, currency)}</div></div>
              <div><div className="text-xs text-gray-500 uppercase">{t('tuition.remaining')}</div><div className={`text-lg font-bold ${totalBalance > 0 ? 'text-primary-600' : 'text-emerald-600'}`}>{fmt(totalBalance, currency)}</div></div>
            </div>
            <div className="h-2 rounded-full bg-gray-100 overflow-hidden mt-3">
              <div className="h-full bg-primary-500" style={{ width: `${totalDue > 0 ? Math.min(100, (totalPaid / totalDue) * 100) : 100}%` }} />
            </div>
          </Card>

          {/* Per student */}
          <div className="space-y-4">
            {Array.from(byStudent.entries()).map(([studentId, plans]) => (
              <div key={studentId} className="space-y-3">
                <h3 className="font-semibold text-gray-900">{plans[0].studentName}</h3>
                {plans.map(r => {
                  const due = r.totalAmount + r.adjustment - r.siblingDiscount;
                  const pct = due > 0 ? Math.min(100, (r.paid / due) * 100) : 100;
                  return (
                    <Card key={r.id}>
                      <div className="flex items-start justify-between mb-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-gray-900">{r.planName}</span>
                            {r.academicYear && <span className="text-xs text-gray-500">· {r.academicYear}</span>}
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${STATUS_COLOR[r.status]}`}>{t(`tuition.status.${r.status}`)}</span>
                          </div>
                          <div className="text-sm text-gray-600 mt-0.5">
                            {t('tuition.paid_of', { paid: fmt(r.paid, r.currency), due: fmt(due, r.currency) })}{r.balance > 0 && <> · {t('tuition.remaining_suffix', { amount: fmt(r.balance, r.currency) })}</>}
                          </div>
                        </div>
                        <Button size="sm" variant="ghost" onClick={() => downloadStatement(r.id)} icon={<FileDown className="w-4 h-4" />}>{t('tuition.statement')}</Button>
                      </div>
                      <div className="h-2 rounded-full bg-gray-100 overflow-hidden mb-3">
                        <div className="h-full bg-primary-500" style={{ width: `${pct}%` }} />
                      </div>

                      {r.installments.length > 0 && (() => {
                        const paidByInst = new Map<string, number>();
                        for (const p of r.payments) {
                          for (const a of p.allocations ?? []) paidByInst.set(a.installmentId, (paidByInst.get(a.installmentId) ?? 0) + a.amount);
                        }
                        return (
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                            {r.installments.map(i => {
                              const paidThis = paidByInst.get(i.id) ?? 0;
                              const fullyPaid = paidThis >= i.effectiveAmount - 0.01;
                              const partial = paidThis > 0 && !fullyPaid;
                              const adjusted = Math.abs(i.effectiveAmount - i.amount) >= 0.01;
                              return (
                                <div key={i.id} className={`rounded-lg px-3 py-2 text-xs border ${fullyPaid ? 'bg-emerald-50 border-emerald-200' : partial ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'}`}>
                                  <div className="flex items-center justify-between">
                                    <span className="text-gray-500">{t('tuition.installment', { sequence: i.sequence })}</span>
                                    {fullyPaid && <span className="text-emerald-700 font-medium">{t('tuition.paid_status')}</span>}
                                    {partial && <span className="text-amber-700 font-medium">{t('tuition.partial')}</span>}
                                  </div>
                                  <div className="font-semibold text-gray-900">{fmt(i.effectiveAmount, r.currency)}</div>
                                  {adjusted && <div className="text-gray-400 text-[10px]">{t('tuition.base', { amount: fmt(i.amount, r.currency) })}</div>}
                                  <div className="text-gray-500">{t('tuition.due_on', { date: i.dueDate })}</div>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}

                      {r.payments.length > 0 && (
                        <div>
                          <div className="text-xs font-semibold text-gray-700 uppercase mb-1.5">{t('tuition.payments')}</div>
                          <div className="divide-y divide-gray-100">
                            {r.payments.map(p => {
                              const isVoided = Boolean(p.voidedAt);
                              return (
                              <div key={p.id} className={`flex items-center gap-3 py-2 ${p.isRefund ? 'bg-rose-50/30' : ''} ${isVoided ? 'opacity-60' : ''}`}>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className={`font-semibold ${isVoided ? 'line-through text-gray-500' : p.isRefund ? 'text-rose-700' : 'text-gray-900'}`}>{p.isRefund ? '−' : ''}{fmt(p.amount, r.currency)}</span>
                                    <span className="text-xs text-gray-500">· {p.paidOn}</span>
                                    {p.isRefund && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">{t('tuition.refund_badge')}</span>}
                                    {isVoided && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-200 text-gray-700">{t('tuition.voided_badge')}</span>}
                                    {p.method && <span className="text-xs text-gray-500">· {p.method}</span>}
                                  </div>
                                  {isVoided && (
                                    <div className="text-xs text-rose-700 mt-0.5">{t('tuition.voided_on', { date: String(p.voidedAt).slice(0, 10) })}{p.voidReason ? ` · ${p.voidReason}` : ''}</div>
                                  )}
                                  <div className="text-xs text-gray-700 mt-0.5">
                                    <span className="text-gray-500">{t('tuition.recorded_by')} </span>
                                    <span className="font-medium">{p.recorderName || '—'}</span>
                                  </div>
                                  {p.allocations && p.allocations.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-1">
                                      {p.allocations.map(a => (
                                        <span key={a.installmentId} className="text-xs px-1.5 py-0.5 rounded bg-primary-50 text-primary-700 border border-primary-100">
                                          {t('tuition.inst_short', { sequence: a.sequence })} · {fmt(a.amount, r.currency)}
                                        </span>
                                      ))}
                                      {(p.unallocatedAmount ?? 0) > 0 && (
                                        <span className="text-xs px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-100">
                                          {t('tuition.other')} · {fmt(p.unallocatedAmount ?? 0, r.currency)}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                  {p.unallocatedNote && (p.unallocatedAmount ?? 0) > 0 && (
                                    <div className="text-xs text-amber-700 mt-1 italic">"{p.unallocatedNote}"</div>
                                  )}
                                </div>
                                <button onClick={() => downloadReceipt(p.id)} className="p-2 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg" title={t('common.download')}>
                                  <FileDown className="w-4 h-4" />
                                </button>
                              </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            ))}
          </div>
        </>
      )}
    </PageLayout>
  );
}
