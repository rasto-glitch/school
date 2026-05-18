import { useEffect, useState } from 'react';
import { feesApi, drainPages } from '../../services/api';
import { toast } from 'react-toastify';
import Card from '../../components/common/Card';
import Button from '../../components/common/Button';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';
import { RotateCcw, Archive } from 'lucide-react';
import { fmtMoney as fmt } from '../../utils/money';

interface VoidedPlan {
  id: string;
  name: string;
  totalAmount: number;
  currency: string;
  academicYear: string | null;
  voidedAt: string;
  voidReason: string | null;
  voidedByName: string | null;
}

interface VoidedPayment {
  id: string;
  amount: number;
  paidOn: string;
  method: string | null;
  reference: string | null;
  notes: string | null;
  voidedAt: string;
  voidReason: string | null;
  voidedByName: string | null;
  studentName: string | null;
  planName: string | null;
  currency: string;
}


function formatVoidedAt(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function TuitionVoidedTab() {
  const [plans, setPlans] = useState<VoidedPlan[] | null>(null);
  const [payments, setPayments] = useState<VoidedPayment[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = async () => {
    try {
      const [p, q] = await Promise.all([
        drainPages<VoidedPlan>(c => feesApi.listVoidedPlans(c)),
        drainPages<VoidedPayment>(c => feesApi.listVoidedPayments(c)),
      ]);
      setPlans(p);
      setPayments(q);
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to load voided records');
      setPlans([]);
      setPayments([]);
    }
  };

  useEffect(() => { reload(); }, []);

  const unvoidPlan = async (id: string) => {
    if (!confirm('Restore this voided plan?')) return;
    setBusy(id);
    try {
      await feesApi.unvoidPlan(id);
      toast.success('Plan restored');
      await reload();
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to restore');
    } finally { setBusy(null); }
  };

  const unvoidPayment = async (id: string) => {
    if (!confirm('Restore this voided payment? It will reappear in the student\'s payment history.')) return;
    setBusy(id);
    try {
      await feesApi.unvoidPayment(id);
      toast.success('Payment restored');
      await reload();
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to restore');
    } finally { setBusy(null); }
  };

  if (plans === null || payments === null) return <LoadingSpinner />;

  const empty = plans.length === 0 && payments.length === 0;

  return (
    <div>
      <div className="mb-4 text-sm text-gray-600">
        Voided records are kept for a recovery window before being permanently deleted. Click <span className="font-medium">Restore</span> to bring an item back.
      </div>

      {empty ? (
        <EmptyState
          title="Nothing voided"
          description="Plans and payments you delete will appear here so you can recover them."
          icon={<Archive className="w-8 h-8 text-gray-400" />}
        />
      ) : (
        <div className="space-y-6">
          {payments.length > 0 && (
            <div>
              <h3 className="font-semibold text-gray-900 mb-2">Voided payments ({payments.length})</h3>
              <div className="space-y-2">
                {payments.map(p => (
                  <Card key={p.id}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-gray-900">{fmt(p.amount, p.currency)}</span>
                          <span className="text-xs text-gray-500">· {p.paidOn}</span>
                          {p.method && <span className="text-xs text-gray-500">· {p.method}</span>}
                        </div>
                        <div className="text-sm text-gray-700 mt-0.5">
                          {p.studentName ?? '(unknown student)'}
                          {p.planName && <span className="text-gray-500"> · {p.planName}</span>}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          Voided {formatVoidedAt(p.voidedAt)}
                          {p.voidedByName && <> by <span className="font-medium text-gray-700">{p.voidedByName}</span></>}
                        </div>
                        {p.voidReason && (
                          <div className="text-xs text-rose-700 italic mt-1">"{p.voidReason}"</div>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => unvoidPayment(p.id)}
                        disabled={busy === p.id}
                        icon={<RotateCcw className="w-4 h-4" />}
                      >
                        Restore
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {plans.length > 0 && (
            <div>
              <h3 className="font-semibold text-gray-900 mb-2">Voided plans ({plans.length})</h3>
              <div className="space-y-2">
                {plans.map(pl => (
                  <Card key={pl.id}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-gray-900">{pl.name}</span>
                          {pl.academicYear && <span className="text-xs text-gray-500">· {pl.academicYear}</span>}
                          <span className="text-sm text-gray-700">{fmt(pl.totalAmount, pl.currency)}</span>
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          Voided {formatVoidedAt(pl.voidedAt)}
                          {pl.voidedByName && <> by <span className="font-medium text-gray-700">{pl.voidedByName}</span></>}
                        </div>
                        {pl.voidReason && (
                          <div className="text-xs text-rose-700 italic mt-1">"{pl.voidReason}"</div>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => unvoidPlan(pl.id)}
                        disabled={busy === pl.id}
                        icon={<RotateCcw className="w-4 h-4" />}
                      >
                        Restore
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
