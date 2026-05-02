import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { feesApi } from '../../services/api';
import { toast } from 'react-toastify';
import Input from '../../components/common/Input';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';
import { CreditCard, Lock, Search } from 'lucide-react';
import type { StudentFeeRow, FeeStatus } from '../../types';

interface Props {
  basePath: string; // '/admin/tuition' or '/reception/tuition'
  canWrite: boolean;
}

const STATUS_LABEL: Record<FeeStatus, string> = {
  paid_up: 'Paid up',
  current: 'On track',
  due_soon: 'Due soon',
  overdue: 'Overdue',
};
const STATUS_COLOR: Record<FeeStatus, string> = {
  paid_up: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  current: 'bg-slate-50 text-slate-700 border-slate-200',
  due_soon: 'bg-amber-50 text-amber-700 border-amber-200',
  overdue: 'bg-rose-50 text-rose-700 border-rose-200',
};
const BAR_COLOR: Record<FeeStatus, string> = {
  paid_up: 'bg-emerald-500',
  current: 'bg-primary-500',
  due_soon: 'bg-amber-500',
  overdue: 'bg-rose-500',
};

function fmt(amount: number, currency: string) {
  const sym: Record<string, string> = { USD: '$', EUR: '€', GBP: '£' };
  const s = sym[currency] ?? '';
  const n = amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return s ? `${s}${n}` : `${currency} ${n}`;
}

export default function TuitionStudentsTab({ basePath, canWrite: _canWrite }: Props) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<StudentFeeRow[] | null>(null);
  const [filter, setFilter] = useState<'all' | FeeStatus>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    feesApi.listStudentFees()
      .then(r => setRows(r.data))
      .catch((e: any) => toast.error(e.response?.data?.error || 'Failed to load tuition'));
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return null;
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (filter !== 'all' && r.status !== filter) return false;
      if (q && !`${r.studentName} ${r.parentName ?? ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, filter, search]);

  if (rows === null) return <LoadingSpinner />;

  const counts: Record<'all' | FeeStatus, number> = {
    all: rows.length,
    paid_up: rows.filter(r => r.status === 'paid_up').length,
    current: rows.filter(r => r.status === 'current').length,
    due_soon: rows.filter(r => r.status === 'due_soon').length,
    overdue: rows.filter(r => r.status === 'overdue').length,
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {(['all', 'overdue', 'due_soon', 'current', 'paid_up'] as const).map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              filter === s ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
            }`}
          >
            {s === 'all' ? 'All' : STATUS_LABEL[s]} <span className="ml-1 opacity-70">({counts[s]})</span>
          </button>
        ))}
        <div className="ml-auto w-full sm:w-64">
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search student or parent…" icon={<Search className="w-4 h-4 text-gray-400" />} />
        </div>
      </div>

      {!filtered || filtered.length === 0 ? (
        <EmptyState title="No students" description="No fee records match this filter." icon={<CreditCard className="w-8 h-8 text-gray-400" />} />
      ) : (
        <div className="space-y-2">
          {filtered.map(r => {
            const due = r.totalAmount + r.adjustment - r.siblingDiscount;
            const pct = due > 0 ? Math.min(100, (r.paid / due) * 100) : 100;
            return (
              <button
                key={r.id}
                onClick={() => navigate(`${basePath}/student/${r.id}`)}
                className="w-full text-left bg-white rounded-2xl border border-gray-200 p-4 hover:border-primary-300 hover:shadow-sm transition-all"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-gray-900 truncate">{r.studentName}</h3>
                      {r.className && <span className="text-xs text-gray-500">· {r.className}</span>}
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${STATUS_COLOR[r.status]}`}>
                        {STATUS_LABEL[r.status]}
                      </span>
                      {r.lockedFeatures.length > 0 && (
                        <span className="inline-flex items-center gap-1 text-xs text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full">
                          <Lock className="w-3 h-3" />
                          {r.lockedFeatures.join(', ')}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5 truncate">{r.parentName || '—'} · {r.planName}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-bold text-gray-900">{fmt(r.paid, r.currency)} <span className="text-gray-400">/ {fmt(due, r.currency)}</span></div>
                    {r.balance > 0 && <div className="text-xs text-gray-500">{fmt(r.balance, r.currency)} remaining</div>}
                    {r.balance === 0 && <div className="text-xs text-emerald-600">Paid in full</div>}
                  </div>
                </div>
                <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                  <div className={`h-full ${BAR_COLOR[r.status]}`} style={{ width: `${pct}%` }} />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
