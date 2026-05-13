import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { feesApi } from '../../services/api';
import { toast } from 'react-toastify';
import Input from '../../components/common/Input';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';
import { CreditCard, Lock, Search } from 'lucide-react';
import type { StudentRollupRow, FeeStatus, FeePlanKind } from '../../types';
import { fmtMoney as fmt } from '../../utils/money';

interface Props {
  basePath: string; // '/accounting' (used to build student detail links)
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

// Plain English for the kind badges
const KIND_LABEL: Record<FeePlanKind, string> = {
  tuition: 'Tuition',
  transport: 'Transport',
  lunch: 'Lunch',
  uniform: 'Uniform',
  exam: 'Exam',
  registration: 'Registration',
  other: 'Other',
};

export default function TuitionStudentsTab({ basePath, canWrite: _canWrite }: Props) {
  const navigate = useNavigate();
  // Kind filter lives in the URL (?kind=transport) so it survives navigating to a
  // student's detail page and back, and so that picking a student opens the matching
  // tab on the detail page automatically. Status/search stay as local state since
  // they're more transient.
  const [searchParams, setSearchParams] = useSearchParams();
  const kindFilter = (searchParams.get('kind') as 'all' | FeePlanKind | null) ?? 'all';
  const setKindFilter = (value: 'all' | FeePlanKind) => {
    const next = new URLSearchParams(searchParams);
    if (value === 'all') next.delete('kind');
    else next.set('kind', value);
    setSearchParams(next, { replace: true });
  };
  const [rows, setRows] = useState<StudentRollupRow[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | FeeStatus>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    feesApi.listStudentRollup()
      .then(r => setRows(r.data as StudentRollupRow[]))
      .catch((e: any) => toast.error(e.response?.data?.error || 'Failed to load tuition'));
  }, []);

  // Total balance per row across all currencies — used for the right-side summary.
  // Note: this sums currencies as-is (no FX). Each currency renders separately on the row.
  const filtered = useMemo(() => {
    if (!rows) return null;
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (statusFilter !== 'all' && r.worstStatus !== statusFilter) return false;
      if (kindFilter !== 'all' && !r.kinds.includes(kindFilter)) return false;
      if (q && !`${r.studentName} ${r.parentName ?? ''} ${r.className ?? ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, statusFilter, kindFilter, search]);

  // Status chip counts (across rows that pass the kind filter, before status filter applies).
  const statusCounts = useMemo(() => {
    if (!rows) return { all: 0, overdue: 0, due_soon: 0, current: 0, paid_up: 0 } as Record<'all' | FeeStatus, number>;
    const base = rows.filter(r => kindFilter === 'all' || r.kinds.includes(kindFilter));
    return {
      all: base.length,
      overdue: base.filter(r => r.worstStatus === 'overdue').length,
      due_soon: base.filter(r => r.worstStatus === 'due_soon').length,
      current: base.filter(r => r.worstStatus === 'current').length,
      paid_up: base.filter(r => r.worstStatus === 'paid_up').length,
    };
  }, [rows, kindFilter]);

  // Kind chip counts (across rows that pass the status filter, before kind filter applies).
  const kindCounts = useMemo(() => {
    if (!rows) return { all: 0 } as Record<string, number>;
    const base = rows.filter(r => statusFilter === 'all' || r.worstStatus === statusFilter);
    const out: Record<string, number> = { all: base.length };
    for (const r of base) {
      // A row contributes to every kind it contains so chips reflect "students who have X"
      for (const k of r.kinds) out[k] = (out[k] ?? 0) + 1;
    }
    return out;
  }, [rows, statusFilter]);

  // Kinds present in the data — only show chips for kinds the school actually uses.
  const presentKinds = useMemo(() => {
    if (!rows) return [] as FeePlanKind[];
    const set = new Set<FeePlanKind>();
    for (const r of rows) for (const k of r.kinds) set.add(k);
    // Stable order: tuition first, then everything else alphabetically
    return [...set].sort((a, b) => (a === 'tuition' ? -1 : b === 'tuition' ? 1 : a.localeCompare(b)));
  }, [rows]);

  if (!filtered) return <LoadingSpinner />;

  return (
    <div>
      {/* Status chips */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {(['all', 'overdue', 'due_soon', 'current', 'paid_up'] as const).map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              statusFilter === s ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
            }`}
          >
            {s === 'all' ? 'All' : STATUS_LABEL[s]} <span className="ml-1 opacity-70">({statusCounts[s]})</span>
          </button>
        ))}
        <div className="ml-auto w-full sm:w-64">
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search student, parent, class…" icon={<Search className="w-4 h-4 text-gray-400" />} />
        </div>
      </div>

      {/* Kind chips — only render when more than one kind is in use */}
      {presentKinds.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide mr-1">Kind:</span>
          <button
            onClick={() => setKindFilter('all')}
            className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
              kindFilter === 'all' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}
          >
            All <span className="ml-1 opacity-70">({kindCounts.all ?? 0})</span>
          </button>
          {presentKinds.map(k => (
            <button
              key={k}
              onClick={() => setKindFilter(k)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                kindFilter === k
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {KIND_LABEL[k] ?? k} <span className="ml-1 opacity-70">({kindCounts[k] ?? 0})</span>
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState title="No students" description="No fee records match this filter." icon={<CreditCard className="w-8 h-8 text-gray-400" />} />
      ) : (
        <div className="space-y-2">
          {filtered.map(r => {
            // When the kind filter is active, show the totals for that kind only.
            const visiblePlans = kindFilter === 'all' ? r.plans : r.plans.filter(p => p.kind === kindFilter);
            const visibleTotals = kindFilter === 'all'
              ? r.totalsByCurrency
              : aggregateTotals(visiblePlans);
            // Plain progress bar % — uses first currency only when there are multiple (best we can do without FX rollup).
            const primary = visibleTotals[0];
            const pct = primary && primary.due > 0 ? Math.min(100, (primary.paid / primary.due) * 100) : 100;
            return (
              <button
                key={r.studentId}
                onClick={() => navigate(`${basePath}/student/${r.studentId}${kindFilter !== 'all' ? `?kind=${kindFilter}` : ''}`)}
                className="w-full text-left bg-white rounded-2xl border border-gray-200 p-4 hover:border-primary-300 hover:shadow-sm transition-all"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-gray-900 truncate">{r.studentName}</h3>
                      {r.className && <span className="text-xs text-gray-500">· {r.className}</span>}
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${STATUS_COLOR[r.worstStatus]}`}>
                        {STATUS_LABEL[r.worstStatus]}
                      </span>
                      {r.lockedFeatures.length > 0 && (
                        <span className="inline-flex items-center gap-1 text-xs text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full">
                          <Lock className="w-3 h-3" />
                          {r.lockedFeatures.join(', ')}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5 truncate">{r.parentName || '—'}</div>
                    {/* Kind badges — one per plan kind */}
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {visiblePlans.map(p => (
                        <span
                          key={p.studentFeeId}
                          className={`text-[11px] font-semibold px-1.5 py-0.5 rounded border ${
                            p.kind === 'tuition'
                              ? 'bg-slate-50 text-slate-700 border-slate-200'
                              : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                          }`}
                        >
                          {KIND_LABEL[p.kind] ?? p.kind}
                          {p.balance > 0.01 && <span className="opacity-70 ml-1">· {fmt(p.balance, p.currency)}</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    {visibleTotals.map(t => (
                      <div key={t.currency} className="text-sm">
                        <span className="font-bold text-gray-900">{fmt(t.paid, t.currency)}</span>
                        <span className="text-gray-400"> / {fmt(t.due, t.currency)}</span>
                        {t.balance > 0.01 && <div className="text-xs text-gray-500">{fmt(t.balance, t.currency)} remaining</div>}
                        {t.balance < 0.01 && t.due > 0 && <div className="text-xs text-emerald-600">Paid in full</div>}
                      </div>
                    ))}
                  </div>
                </div>
                {primary && primary.due > 0 && (
                  <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                    <div className={`h-full ${BAR_COLOR[r.worstStatus]}`} style={{ width: `${pct}%` }} />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// When a kind filter is active, only the plans of that kind contribute to totals.
// We re-derive per-currency totals from the filtered plans list rather than serving them from the server.
function aggregateTotals(plans: StudentRollupRow['plans']): StudentRollupRow['totalsByCurrency'] {
  const m = new Map<string, { due: number; paid: number; balance: number }>();
  for (const p of plans) {
    const due = p.totalAmount + p.adjustment - p.siblingDiscount + p.lateFees;
    const slot = m.get(p.currency) ?? { due: 0, paid: 0, balance: 0 };
    slot.due += due;
    slot.paid += p.paid;
    slot.balance += p.balance;
    m.set(p.currency, slot);
  }
  return Array.from(m.entries()).map(([currency, t]) => ({
    currency,
    due: Math.round(t.due * 100) / 100,
    paid: Math.round(t.paid * 100) / 100,
    balance: Math.round(t.balance * 100) / 100,
  }));
}
