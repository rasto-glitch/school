import { useEffect, useState, useCallback } from 'react';
import { Search, Archive, FileText } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { adminApi } from '../../services/api';
import { useDebounce } from '../../hooks/useDebounce';
import Card from '../../components/common/Card';
import Input from '../../components/common/Input';
import Select from '../../components/common/Select';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import Modal from '../../components/common/Modal';
import type { ArchivedEmployee, ArchivedEmployeeListItem } from '../../types';

const ROLE_LABEL: Record<string, string> = {
  teacher: 'Teacher', driver: 'Driver', supervisor: 'Supervisor', staff: 'Staff', admin: 'Administration',
};
const ROLE_COLOR: Record<string, string> = {
  teacher: 'bg-indigo-100 text-indigo-700',
  driver: 'bg-cyan-100 text-cyan-700',
  supervisor: 'bg-violet-100 text-violet-700',
  staff: 'bg-emerald-100 text-emerald-700',
  admin: 'bg-purple-100 text-purple-700',
};
const REASON_LABEL: Record<string, string> = {
  resigned: 'Resigned', terminated: 'Terminated', contract_ended: 'Contract ended',
  retired: 'Retired', transferred: 'Transferred', other: 'Other',
};

const ROLE_FILTERS = [
  { value: 'teacher', label: 'Teachers' },
  { value: 'driver', label: 'Drivers' },
  { value: 'supervisor', label: 'Supervisors' },
  { value: 'admin', label: 'Administration' },
  { value: 'staff', label: 'Staff' },
];

const fmt = (d?: string | null) => (d ? format(parseISO(d), 'MMM d, yyyy') : '—');
const money = (a: number, c: string) => `${(Number(a) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`;

export default function ArchivedEmployeesTab() {
  const [rows, setRows] = useState<ArchivedEmployeeListItem[]>([]);
  const [roleFilter, setRoleFilter] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<ArchivedEmployee | null>(null);

  const debouncedSearch = useDebounce(search, 400);

  const load = useCallback(() => {
    setLoading(true);
    adminApi.getArchivedEmployees({
      ...(roleFilter ? { role: roleFilter } : {}),
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
    })
      .then(r => setRows(r.data || []))
      .finally(() => setLoading(false));
  }, [roleFilter, debouncedSearch]);

  useEffect(() => { load(); }, [load]);

  const openDetail = async (id: string) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetail(null);
    try {
      const r = await adminApi.getArchivedEmployee(id);
      setDetail(r.data);
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex-1 min-w-48">
          <Input
            placeholder="Search archived employees..."
            icon={<Search className="w-4 h-4" />}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="w-48">
          <Select
            options={ROLE_FILTERS}
            placeholder="All roles"
            value={roleFilter}
            onChange={e => setRoleFilter(e.target.value)}
          />
        </div>
        {!loading && (
          <span className="text-sm text-gray-400">
            {rows.length} record{rows.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><LoadingSpinner /></div>
      ) : rows.length === 0 ? (
        <Card className="text-center py-16">
          <Archive className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">No archived employees</p>
          <p className="text-xs text-gray-400 mt-1">
            Teachers, drivers, supervisors and staff appear here when removed while the archive feature is on
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {rows.map(e => (
            <button key={e.id} onClick={() => openDetail(e.id)} className="text-left w-full">
              <Card className="hover:shadow-md hover:border-primary-200 transition-all cursor-pointer h-full">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-slate-600 font-bold text-sm">{e.fullName?.[0]}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-gray-900 truncate">{e.fullName}</p>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ROLE_COLOR[e.role] || 'bg-gray-100 text-gray-600'}`}>
                        {ROLE_LABEL[e.role] || e.role}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {REASON_LABEL[e.reason] || e.reason} · left {fmt(e.departureDate)}
                    </p>
                    {(e.position || e.subject) && (
                      <p className="text-xs text-gray-400 truncate mt-0.5">{e.position || e.subject}</p>
                    )}
                  </div>
                  <FileText className="w-4 h-4 text-gray-300 flex-shrink-0 mt-1" />
                </div>
              </Card>
            </button>
          ))}
        </div>
      )}

      <Modal
        isOpen={detailOpen}
        onClose={() => { setDetailOpen(false); setDetail(null); }}
        title="Archived Employee Record"
        size="lg"
      >
        {detailLoading ? (
          <div className="flex justify-center py-10"><LoadingSpinner /></div>
        ) : detail ? (
          <div className="space-y-6">
            <div className="flex items-center gap-3 pb-4 border-b border-gray-100">
              <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center flex-shrink-0">
                <span className="text-slate-600 font-bold text-lg">{detail.fullName?.[0]}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-bold text-gray-900 text-lg">{detail.fullName}</p>
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${ROLE_COLOR[detail.role] || 'bg-gray-100 text-gray-600'}`}>
                    {ROLE_LABEL[detail.role] || detail.role}
                  </span>
                  <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-amber-100 text-amber-700">
                    {REASON_LABEL[detail.reason] || detail.reason}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Personal Info</p>
                <dl className="space-y-2">
                  <InfoRow label="Email" value={detail.email || '—'} />
                  <InfoRow label="Phone" value={detail.phoneNumber || '—'} />
                  <InfoRow label="Emergency" value={detail.emergencyContact || '—'} />
                  {detail.subject && <InfoRow label="Subject" value={detail.subject} />}
                  {detail.position && <InfoRow label="Position" value={detail.position} />}
                  {detail.age != null && <InfoRow label="Age" value={String(detail.age)} />}
                </dl>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Employment</p>
                <dl className="space-y-2">
                  <InfoRow label="Hired" value={fmt(detail.hireDate)} />
                  <InfoRow label="Departed" value={fmt(detail.departureDate)} />
                  <InfoRow label="Login" value={(detail.account as any)?.username || '—'} />
                  <InfoRow label="Archived" value={fmt(detail.createdAt)} />
                </dl>
              </div>
            </div>

            {detail.role === 'teacher' && (
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Teaching</p>
                {(detail.teaching?.curriculum?.length ?? 0) === 0 ? (
                  <p className="text-sm text-gray-400">No curriculum records</p>
                ) : (
                  <div className="space-y-2">
                    {(detail.teaching.curriculum as { className: string | null; subjects: string[] }[]).map((c, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className="text-xs font-medium text-gray-500 w-32 shrink-0 pt-0.5">{c.className || '—'}</span>
                        <div className="flex flex-wrap gap-1">
                          {(c.subjects || []).map(s => (
                            <span key={s} className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full">{s}</span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {detail.teaching?.contentSummary && (
                  <p className="text-xs text-gray-500 mt-3">
                    Authored: {detail.teaching.contentSummary.homework ?? 0} homework · {detail.teaching.contentSummary.assignments ?? 0} assignments · {detail.teaching.contentSummary.grades ?? 0} grades · {detail.teaching.contentSummary.reports ?? 0} reports · {detail.teaching.contentSummary.weeklySummaries ?? 0} weekly summaries · {detail.teaching.contentSummary.academicPosts ?? 0} posts
                  </p>
                )}
              </div>
            )}

            {detail.role === 'driver' && (
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Transport</p>
                <dl className="space-y-2">
                  <InfoRow label="Bus" value={detail.transport?.busNumber ? `#${detail.transport.busNumber}${detail.transport.plateNumber ? ` (${detail.transport.plateNumber})` : ''}` : '—'} />
                  <InfoRow label="Vehicle" value={detail.transport?.vehicleType || '—'} />
                  <InfoRow label="License" value={detail.transport?.licenseNumber || '—'} />
                  <InfoRow label="Students" value={String(detail.transport?.studentsTransported?.length ?? 0)} />
                  <InfoRow
                    label="Ride records"
                    value={detail.transport?.rideRecordStats ? `${detail.transport.rideRecordStats.rode ?? 0} rode / ${detail.transport.rideRecordStats.total ?? 0} total` : '—'}
                  />
                </dl>
              </div>
            )}

            {detail.role === 'staff' && (
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Salary & Insurance</p>
                <dl className="space-y-2 mb-4">
                  <InfoRow label="Salary" value={detail.employment?.salaryAmount != null ? money(detail.employment.salaryAmount, detail.employment.currency || '') : '—'} />
                  <InfoRow label="Insurance %" value={detail.employment?.insurancePercentage != null ? `${detail.employment.insurancePercentage}%` : '—'} />
                  <InfoRow label="Insurance held" value={detail.employment?.insuranceHeld != null ? money(detail.employment.insuranceHeld, detail.employment.currency || '') : '—'} />
                  <InfoRow
                    label="Insurance paid out"
                    value={detail.employment?.insurancePaidOut ? `${money(detail.employment.insurancePaidOutAmount ?? 0, detail.employment.insurancePaidOutCurrency || detail.employment.currency || '')}${detail.employment.insurancePaidOutAt ? ` on ${detail.employment.insurancePaidOutAt}` : ''}` : 'No'}
                  />
                </dl>
                {detail.paymentHistory.length === 0 ? (
                  <p className="text-sm text-gray-400">No salary payments recorded</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-gray-50">
                          <th className="text-left px-3 py-2 font-medium text-gray-500 border border-gray-200">Date</th>
                          <th className="text-right px-3 py-2 font-medium text-gray-500 border border-gray-200">Gross</th>
                          <th className="text-right px-3 py-2 font-medium text-gray-500 border border-gray-200">Insurance</th>
                          <th className="text-right px-3 py-2 font-medium text-gray-500 border border-gray-200">Net</th>
                          <th className="text-left px-3 py-2 font-medium text-gray-500 border border-gray-200">Period</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.paymentHistory.map((p, i) => {
                          const ins = Number(p.insuranceAmount) || 0;
                          return (
                            <tr key={i} className="hover:bg-gray-50">
                              <td className="px-3 py-2 border border-gray-200 text-gray-700">{p.paidOn}</td>
                              <td className="px-3 py-2 border border-gray-200 text-right">{money(p.amount, p.currency)}</td>
                              <td className="px-3 py-2 border border-gray-200 text-right">{ins ? money(ins, p.currency) : '—'}</td>
                              <td className="px-3 py-2 border border-gray-200 text-right font-medium">{money((Number(p.amount) || 0) - ins, p.currency)}</td>
                              <td className="px-3 py-2 border border-gray-200 text-gray-600">{p.periodLabel || '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <dt className="text-xs text-gray-400 w-28 shrink-0 pt-0.5">{label}</dt>
      <dd className="text-sm text-gray-800 font-medium break-words min-w-0">{value}</dd>
    </div>
  );
}
