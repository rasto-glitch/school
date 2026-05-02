import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { feesApi } from '../../services/api';
import { toast } from 'react-toastify';
import Input from '../../components/common/Input';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';
import { Users, Search, ChevronDown, ChevronUp } from 'lucide-react';
import type { FamilyFeeGroup, FeeStatus } from '../../types';

interface Props { basePath: string }

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

export default function TuitionFamiliesTab({ basePath }: Props) {
  const navigate = useNavigate();
  const [groups, setGroups] = useState<FamilyFeeGroup[] | null>(null);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    feesApi.listFamilies()
      .then(r => setGroups(r.data))
      .catch((e: any) => toast.error(e.response?.data?.error || 'Failed to load families'));
  }, []);

  const filtered = useMemo(() => {
    if (!groups) return null;
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(g =>
      g.parentName.toLowerCase().includes(q) ||
      g.students.some(s => s.studentName.toLowerCase().includes(q))
    );
  }, [groups, search]);

  if (groups === null) return <LoadingSpinner />;

  const toggle = (id: string) =>
    setExpanded(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });

  return (
    <div>
      <div className="mb-4 max-w-sm">
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search family or student…" icon={<Search className="w-4 h-4 text-gray-400" />} />
      </div>

      {!filtered || filtered.length === 0 ? (
        <EmptyState title="No families" icon={<Users className="w-8 h-8 text-gray-400" />} />
      ) : (
        <div className="space-y-2">
          {filtered.map(g => {
            const due = g.totalDue;
            const pct = due > 0 ? Math.min(100, (g.totalPaid / due) * 100) : 100;
            const isOpen = expanded.has(g.parentId);
            return (
              <div key={g.parentId || g.parentName} className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                <button
                  onClick={() => toggle(g.parentId)}
                  className="w-full text-left p-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-gray-900 truncate">{g.parentName}</h3>
                        <span className="text-xs text-gray-500">· {g.students.length} {g.students.length === 1 ? 'student' : 'students'}</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0 flex items-center gap-3">
                      <div>
                        <div className="text-sm font-bold text-gray-900">{fmt(g.totalPaid, g.currency)} <span className="text-gray-400">/ {fmt(due, g.currency)}</span></div>
                        {g.totalBalance > 0
                          ? <div className="text-xs text-gray-500">{fmt(g.totalBalance, g.currency)} remaining</div>
                          : <div className="text-xs text-emerald-600">Paid in full</div>}
                      </div>
                      {isOpen ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                    </div>
                  </div>
                  <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                    <div className="h-full bg-primary-500" style={{ width: `${pct}%` }} />
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-gray-100 bg-gray-50 divide-y divide-gray-100">
                    {g.students.map(s => {
                      const sDue = s.totalAmount + s.adjustment - s.siblingDiscount;
                      const sPct = sDue > 0 ? Math.min(100, (s.paid / sDue) * 100) : 100;
                      return (
                        <button
                          key={s.id}
                          onClick={() => navigate(`${basePath}/student/${s.id}`)}
                          className="w-full text-left px-4 py-3 hover:bg-white transition-colors"
                        >
                          <div className="flex items-start justify-between gap-3 mb-1.5">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium text-gray-900 truncate">{s.studentName}</span>
                                {s.className && <span className="text-xs text-gray-500">· {s.className}</span>}
                                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${STATUS_COLOR[s.status]}`}>
                                  {STATUS_LABEL[s.status]}
                                </span>
                              </div>
                              <div className="text-xs text-gray-500">{s.planName}</div>
                            </div>
                            <div className="text-right text-xs">
                              <div className="font-semibold text-gray-900">{fmt(s.paid, s.currency)} / {fmt(sDue, s.currency)}</div>
                            </div>
                          </div>
                          <div className="h-1.5 rounded-full bg-gray-200 overflow-hidden">
                            <div className="h-full bg-primary-500" style={{ width: `${sPct}%` }} />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
