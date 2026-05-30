// Detail modal for an archived employee. Self-loads on employeeId change,
// renders the role-specific sections (teaching / transport / staff salary /
// account-only note), and exposes Restore + Download JSON actions. Used in
// both the legacy /admin/archive page and the new Archived top tab in
// /admin/employees so the two views share one implementation.
//
// Pass `employeeId={null}` to close.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Download, RotateCcw } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import i18n from '../../../i18n';
import { adminApi } from '../../../services/api';
import Modal from '../../common/Modal';
import LoadingSpinner from '../../common/LoadingSpinner';
import type { ArchivedEmployee } from '../../../types';

const fmt = (d?: string | null) => (d ? format(parseISO(d), 'MMM d, yyyy') : '—');
const money = (a: number, c: string) =>
  `${(Number(a) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`;

// values are i18n keys, resolved with t() at render
const ROLE_LABEL: Record<string, string> = {
  teacher: 'admin.arch_emp.role_teacher',
  driver: 'admin.arch_emp.role_driver',
  supervisor: 'admin.arch_emp.role_supervisor',
  staff: 'admin.arch_emp.role_staff',
  admin: 'admin.arch_emp.role_admin',
};
const ROLE_COLOR: Record<string, string> = {
  teacher: 'bg-indigo-100 text-indigo-700',
  driver: 'bg-cyan-100 text-cyan-700',
  supervisor: 'bg-violet-100 text-violet-700',
  staff: 'bg-emerald-100 text-emerald-700',
  admin: 'bg-purple-100 text-purple-700',
};
const REASON_LABEL: Record<string, string> = {
  resigned: 'admin.arch_emp.reason_resigned',
  terminated: 'admin.arch_emp.reason_terminated',
  contract_ended: 'admin.arch_emp.reason_contract_ended',
  retired: 'admin.arch_emp.reason_retired',
  transferred: 'admin.arch_emp.reason_transferred',
  other: 'admin.arch_emp.reason_other',
};

interface Props {
  employeeId: string | null;
  onClose: () => void;
  /** Called after a successful Restore so the caller can refresh its list. */
  onRestored?: () => void;
}

export default function ArchivedEmployeeDetailModal({ employeeId, onClose, onRestored }: Props) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<ArchivedEmployee | null>(null);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    if (!employeeId) { setDetail(null); return; }
    setLoading(true);
    setDetail(null);
    adminApi.getArchivedEmployee(employeeId)
      .then(r => setDetail(r.data))
      .catch(() => toast.error(t('admin.arch_emp.failed_load')))
      .finally(() => setLoading(false));
  }, [employeeId, t]);

  const exportRecord = async () => {
    if (!detail) return;
    try {
      const r = await adminApi.exportArchivedEmployeePdf(detail.id, i18n.language || 'en');
      const url = URL.createObjectURL(r.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `archived-employee-${(detail.fullName || 'employee').replace(/[^a-z0-9-_]+/gi, '_')}.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || t('admin.arch_emp.failed_export'));
    }
  };

  const restore = async () => {
    if (!detail) return;
    if (!confirm(t('admin.arch_emp.confirm_restore', { name: detail.fullName }))) return;
    setRestoring(true);
    try {
      const r = await adminApi.restoreArchivedEmployee(detail.id);
      const creds = r.data?.username
        ? ' ' + t('admin.arch_emp.creds', { username: r.data.username, password: r.data.tempPassword })
        : '';
      toast.success(t('admin.arch_emp.restored', { name: detail.fullName }) + creds, { autoClose: 10000 });
      onClose();
      onRestored?.();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || t('admin.arch_emp.failed_restore'));
    } finally { setRestoring(false); }
  };

  return (
    <Modal isOpen={!!employeeId} onClose={onClose} title={t('admin.arch_emp.record_title')} size="lg">
      {loading ? (
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
                  {ROLE_LABEL[detail.role] ? t(ROLE_LABEL[detail.role]) : detail.role}
                </span>
                <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-amber-100 text-amber-700">
                  {REASON_LABEL[detail.reason] ? t(REASON_LABEL[detail.reason]) : detail.reason}
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{t('admin.arch_emp.personal_info')}</p>
              <dl className="space-y-2">
                <InfoRow label={t('admin.arch_emp.email')} value={detail.email || '—'} />
                <InfoRow label={t('admin.arch_emp.phone')} value={detail.phoneNumber || '—'} />
                <InfoRow label={t('admin.arch_emp.emergency')} value={detail.emergencyContact || '—'} />
                {detail.subject && <InfoRow label={t('admin.arch_emp.subject')} value={detail.subject} />}
                {detail.position && <InfoRow label={t('admin.arch_emp.position')} value={detail.position} />}
                {detail.age != null && <InfoRow label={t('admin.arch_emp.age')} value={String(detail.age)} />}
              </dl>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{t('admin.arch_emp.employment')}</p>
              <dl className="space-y-2">
                <InfoRow label={t('admin.arch_emp.hired')} value={fmt(detail.hireDate)} />
                <InfoRow label={t('admin.arch_emp.departed')} value={fmt(detail.departureDate)} />
                <InfoRow
                  label={t('admin.arch_emp.login')}
                  value={(detail.account as { username?: string } | null)?.username || '—'}
                />
                <InfoRow label={t('admin.arch_emp.archived')} value={fmt(detail.createdAt)} />
                <InfoRow
                  label={t('admin.arch_emp.archived_by')}
                  value={detail.archivedByName
                    ? `${detail.archivedByName}${detail.archivedByRole ? ` (${detail.archivedByRole})` : ''}`
                    : '—'}
                />
              </dl>
            </div>
          </div>

          {detail.role === 'teacher' && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{t('admin.arch_emp.teaching')}</p>
              {(detail.teaching?.curriculum?.length ?? 0) === 0 ? (
                <p className="text-sm text-gray-400">{t('admin.arch_emp.no_curriculum')}</p>
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
                  {t('admin.arch_emp.authored', {
                    homework: detail.teaching.contentSummary.homework ?? 0,
                    assignments: detail.teaching.contentSummary.assignments ?? 0,
                    grades: detail.teaching.contentSummary.grades ?? 0,
                    reports: detail.teaching.contentSummary.reports ?? 0,
                    weekly: detail.teaching.contentSummary.weeklySummaries ?? 0,
                    posts: detail.teaching.contentSummary.academicPosts ?? 0,
                  })}
                </p>
              )}
            </div>
          )}

          {detail.role === 'driver' && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{t('admin.arch_emp.transport')}</p>
              <dl className="space-y-2">
                <InfoRow
                  label={t('admin.arch_emp.bus')}
                  value={detail.transport?.busNumber
                    ? `#${detail.transport.busNumber}${detail.transport.plateNumber ? ` (${detail.transport.plateNumber})` : ''}`
                    : '—'}
                />
                <InfoRow label={t('admin.arch_emp.vehicle')} value={detail.transport?.vehicleType || '—'} />
                <InfoRow label={t('admin.arch_emp.license')} value={detail.transport?.licenseNumber || '—'} />
                <InfoRow label={t('admin.arch_emp.students')} value={String(detail.transport?.studentsTransported?.length ?? 0)} />
                <InfoRow
                  label={t('admin.arch_emp.ride_records')}
                  value={detail.transport?.rideRecordStats
                    ? t('admin.arch_emp.ride_stats', {
                        rode: detail.transport.rideRecordStats.rode ?? 0,
                        total: detail.transport.rideRecordStats.total ?? 0,
                      })
                    : '—'}
                />
              </dl>
            </div>
          )}

          {detail.role === 'staff' && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{t('admin.arch_emp.salary_insurance')}</p>
              <dl className="space-y-2 mb-4">
                <InfoRow
                  label={t('admin.arch_emp.salary')}
                  value={detail.employment?.salaryAmount != null
                    ? money(detail.employment.salaryAmount, detail.employment.currency || '')
                    : '—'}
                />
                <InfoRow
                  label={t('admin.arch_emp.insurance_pct')}
                  value={detail.employment?.insurancePercentage != null
                    ? `${detail.employment.insurancePercentage}%`
                    : '—'}
                />
                <InfoRow
                  label={t('admin.arch_emp.insurance_held')}
                  value={detail.employment?.insuranceHeld != null
                    ? money(detail.employment.insuranceHeld, detail.employment.currency || '')
                    : '—'}
                />
                <InfoRow
                  label={t('admin.arch_emp.insurance_paid_out')}
                  value={detail.employment?.insurancePaidOut
                    ? `${money(detail.employment.insurancePaidOutAmount ?? 0, detail.employment.insurancePaidOutCurrency || detail.employment.currency || '')}${detail.employment.insurancePaidOutAt ? ` ${t('admin.arch_emp.on_date', { date: detail.employment.insurancePaidOutAt })}` : ''}`
                    : t('admin.arch_emp.no')}
                />
              </dl>
              {detail.paymentHistory.length === 0 ? (
                <p className="text-sm text-gray-400">{t('admin.arch_emp.no_salary_payments')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="text-left px-3 py-2 font-medium text-gray-500 border border-gray-200">{t('admin.arch_emp.col_date')}</th>
                        <th className="text-right px-3 py-2 font-medium text-gray-500 border border-gray-200">{t('admin.arch_emp.col_gross')}</th>
                        <th className="text-right px-3 py-2 font-medium text-gray-500 border border-gray-200">{t('admin.arch_emp.col_insurance')}</th>
                        <th className="text-right px-3 py-2 font-medium text-gray-500 border border-gray-200">{t('admin.arch_emp.col_net')}</th>
                        <th className="text-left px-3 py-2 font-medium text-gray-500 border border-gray-200">{t('admin.arch_emp.col_period')}</th>
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
              <p className="text-xs text-gray-500 mt-3 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                {t('admin.arch_emp.staff_note')}
              </p>
            </div>
          )}

          {(detail.role === 'supervisor' || detail.role === 'admin') && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{t('admin.arch_emp.account')}</p>
              <dl className="space-y-2">
                <InfoRow
                  label={t('admin.arch_emp.username')}
                  value={(detail.account as { username?: string } | null)?.username || '—'}
                />
                <InfoRow
                  label={t('admin.arch_emp.role')}
                  value={ROLE_LABEL[detail.role] ? t(ROLE_LABEL[detail.role]) : detail.role}
                />
                <InfoRow
                  label={t('admin.arch_emp.was_active')}
                  value={(detail.account as { is_active?: boolean } | null)?.is_active === false
                    ? t('admin.arch_emp.no')
                    : t('admin.arch_emp.yes')}
                />
              </dl>
              <p className="text-xs text-gray-400 mt-3">
                {t('admin.arch_emp.account_only_note', {
                  role: ROLE_LABEL[detail.role] ? t(ROLE_LABEL[detail.role]) : detail.role,
                })}
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-4 border-t border-gray-100">
            <button
              onClick={exportRecord}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-white border border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              <Download className="w-4 h-4" /> {t('admin.arch_emp.download_pdf', 'Download PDF')}
            </button>
            <button
              onClick={restore}
              disabled={restoring}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-60"
            >
              <RotateCcw className="w-4 h-4" /> {restoring ? t('admin.arch_emp.restoring') : t('admin.arch_emp.restore')}
            </button>
          </div>
        </div>
      ) : null}
    </Modal>
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
