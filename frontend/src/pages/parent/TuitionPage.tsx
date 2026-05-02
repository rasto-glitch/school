import { useEffect, useState } from 'react';
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

export default function TuitionPage() {
  const [rows, setRows] = useState<ParentFeeRow[] | null>(null);

  useEffect(() => {
    feesApi.getParentFees()
      .then(r => setRows(r.data))
      .catch((e: any) => {
        if (e.response?.status === 403) setRows([]); // module not enabled
        else toast.error(e.response?.data?.error || 'Failed to load tuition');
      });
  }, []);

  if (rows === null) return <PageLayout title="Tuition"><LoadingSpinner /></PageLayout>;

  const downloadReceipt = async (paymentId: string) => {
    try {
      const r = await feesApi.downloadPaymentReceipt(paymentId);
      downloadBlob(r.data, `receipt-${paymentId.slice(0, 8)}.pdf`);
    } catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  const downloadStatement = async (sfId: string) => {
    try {
      const r = await feesApi.downloadStudentFeeSummary(sfId);
      downloadBlob(r.data, `tuition-statement-${sfId.slice(0, 8)}.pdf`);
    } catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
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
    <PageLayout title="Tuition" subtitle="Your tuition status and payment history">
      {rows.length === 0 ? (
        <EmptyState title="No tuition records" description="There's nothing on file yet. The school will set up your tuition plan." icon={<CreditCard className="w-8 h-8 text-gray-400" />} />
      ) : (
        <>
          {/* Family rollup */}
          <Card className="mb-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-900">Family total</h2>
              {totalBalance === 0 ? (
                <span className="text-xs font-semibold px-2 py-1 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">All paid</span>
              ) : (
                <span className="text-xs text-gray-500">Across {rows.length} {rows.length === 1 ? 'plan' : 'plans'}</span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><div className="text-xs text-gray-500 uppercase">Total</div><div className="text-lg font-bold text-gray-900">{fmt(totalDue, currency)}</div></div>
              <div><div className="text-xs text-gray-500 uppercase">Paid</div><div className="text-lg font-bold text-gray-900">{fmt(totalPaid, currency)}</div></div>
              <div><div className="text-xs text-gray-500 uppercase">Remaining</div><div className={`text-lg font-bold ${totalBalance > 0 ? 'text-primary-600' : 'text-emerald-600'}`}>{fmt(totalBalance, currency)}</div></div>
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
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${STATUS_COLOR[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                          </div>
                          <div className="text-sm text-gray-600 mt-0.5">
                            {fmt(r.paid, r.currency)} of {fmt(due, r.currency)}{r.balance > 0 && <> · {fmt(r.balance, r.currency)} remaining</>}
                          </div>
                        </div>
                        <Button size="sm" variant="ghost" onClick={() => downloadStatement(r.id)} icon={<FileDown className="w-4 h-4" />}>Statement</Button>
                      </div>
                      <div className="h-2 rounded-full bg-gray-100 overflow-hidden mb-3">
                        <div className="h-full bg-primary-500" style={{ width: `${pct}%` }} />
                      </div>

                      {r.installments.length > 0 && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                          {r.installments.map(i => (
                            <div key={i.id} className="rounded-lg bg-gray-50 px-3 py-2 text-xs">
                              <div className="text-gray-500">Installment {i.sequence}</div>
                              <div className="font-semibold text-gray-900">{fmt(i.amount, r.currency)}</div>
                              <div className="text-gray-500">due {i.dueDate}</div>
                            </div>
                          ))}
                        </div>
                      )}

                      {r.payments.length > 0 && (
                        <div>
                          <div className="text-xs font-semibold text-gray-700 uppercase mb-1.5">Payments</div>
                          <div className="divide-y divide-gray-100">
                            {r.payments.map(p => (
                              <div key={p.id} className="flex items-center gap-3 py-2">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-semibold text-gray-900">{fmt(p.amount, r.currency)}</span>
                                    <span className="text-xs text-gray-500">· {p.paidOn}</span>
                                    {p.method && <span className="text-xs text-gray-500">· {p.method}</span>}
                                  </div>
                                </div>
                                <button onClick={() => downloadReceipt(p.id)} className="p-2 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg" title="Download receipt">
                                  <FileDown className="w-4 h-4" />
                                </button>
                              </div>
                            ))}
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
