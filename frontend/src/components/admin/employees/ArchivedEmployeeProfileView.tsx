// Full-page archived-employee profile view. Mirrors EmployeeProfileView's
// shape (header card + at-a-glance + tabs) but read-only end to end. The
// only mutations the surface exposes are Restore (lifted off the modal)
// and Download PDF (the per-record PDF we already ship).

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Download, RotateCcw, ShieldAlert } from 'lucide-react';
import { format, parseISO, differenceInYears, differenceInMonths } from 'date-fns';
import i18n from '../../../i18n';
import Card from '../../common/Card';
import Button from '../../common/Button';
import { adminApi } from '../../../services/api';
import ArchivedDocumentsView from './archived/ArchivedDocumentsView';
import ArchivedExtendedView from './archived/ArchivedExtendedView';
import ArchivedEmergencyView from './archived/ArchivedEmergencyView';
import ArchivedAcknowledgementsView from './archived/ArchivedAcknowledgementsView';
import ArchivedActionsView from './archived/ArchivedActionsView';
import type { ArchivedEmployeeProfileResponse } from '../../../types/employeeRecords';

type Tab = 'personal' | 'extended' | 'employment' | 'contact' | 'emergency' | 'documents' | 'acknowledgements' | 'history';

interface Props {
  data: ArchivedEmployeeProfileResponse;
  onRestored: () => void;
}

const ROLE_COLOR: Record<string, string> = {
  teacher: 'bg-indigo-100 text-indigo-700',
  driver: 'bg-cyan-100 text-cyan-700',
  staff: 'bg-emerald-100 text-emerald-700',
  supervisor: 'bg-violet-100 text-violet-700',
  admin: 'bg-purple-100 text-purple-700',
};

const fmtDate = (d?: string | null) => (d ? format(parseISO(d), 'MMM d, yyyy') : '—');

function serviceLength(hireDate: string | null, departureDate: string | null): string {
  if (!hireDate) return '—';
  try {
    const start = parseISO(hireDate);
    const end = departureDate ? parseISO(departureDate) : new Date();
    const years = differenceInYears(end, start);
    const months = differenceInMonths(end, start) - years * 12;
    if (years === 0 && months === 0) return '<1 month';
    if (years === 0) return `${months}m`;
    if (months === 0) return `${years}y`;
    return `${years}y ${months}m`;
  } catch { return '—'; }
}

function InfoRow({ label, value, sensitive = false }: { label: string; value: string | null | undefined; sensitive?: boolean }) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <dt className="text-xs text-gray-500 w-36 shrink-0 pt-0.5 flex items-center gap-1">
        {label}
        {sensitive && <ShieldAlert className="w-3 h-3 text-rose-500" />}
      </dt>
      <dd className="text-sm text-gray-800 break-words min-w-0">{value || <span className="text-gray-400">—</span>}</dd>
    </div>
  );
}

export default function ArchivedEmployeeProfileView({ data, onRestored }: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('personal');
  const [exporting, setExporting] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const r = data.record;
  const ageStr = useMemo(() => (r.age != null ? String(r.age) : null), [r.age]);

  const onDownloadPdf = async () => {
    setExporting(true);
    try {
      const res = await adminApi.exportArchivedEmployeePdf(r.id, i18n.language || 'en');
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `archived-employee-${(r.fullName || 'employee').replace(/[^a-z0-9-_]+/gi, '_')}.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || t('admin.arch_emp.failed_export'));
    } finally { setExporting(false); }
  };

  const onRestore = async () => {
    if (!confirm(t('admin.arch_emp.confirm_restore', { name: r.fullName }))) return;
    setRestoring(true);
    try {
      const res = await adminApi.restoreArchivedEmployee(r.id);
      const creds = res.data?.username
        ? ' ' + t('admin.arch_emp.creds', { username: res.data.username, password: res.data.tempPassword })
        : '';
      toast.success(t('admin.arch_emp.restored', { name: r.fullName }) + creds, { autoClose: 10000 });
      onRestored();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || t('admin.arch_emp.failed_restore'));
    } finally { setRestoring(false); }
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: 'personal',         label: t('admin.profile.tab_personal') },
    { key: 'extended',         label: t('admin.profile.tab_extended') },
    { key: 'employment',       label: t('admin.profile.tab_employment') },
    { key: 'contact',          label: t('admin.profile.tab_contact') },
    { key: 'emergency',        label: t('admin.profile.tab_emergency') },
    { key: 'documents',        label: t('admin.profile.tab_documents') },
    { key: 'acknowledgements', label: t('admin.profile.tab_acks') },
    { key: 'history',          label: t('admin.profile.tab_history') },
  ];

  return (
    <div className="space-y-4">
      {/* Header card */}
      <Card>
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 rounded-full overflow-hidden bg-slate-100 flex items-center justify-center flex-shrink-0">
            {r.profilePicture ? (
              <img src={r.profilePicture} alt={r.fullName} className="w-full h-full object-cover" />
            ) : (
              <span className="text-slate-600 font-bold text-2xl">{r.fullName?.[0]}</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-gray-900 truncate">{r.fullName}</h1>
              <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${ROLE_COLOR[r.role] ?? 'bg-gray-100 text-gray-700'}`}>
                {t(`admin.profile.role_${r.role}`, r.role)}
              </span>
              <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-amber-100 text-amber-800">
                {t(`admin.arch_emp.reason_${r.reason ?? 'other'}`, r.reason ?? '—')}
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-1">
              {t('admin.arch_emp.departed')} {fmtDate(r.departureDate)} · {t('admin.arch_emp.archived')} {fmtDate(r.createdAt)}
              {r.archivedByName && ` · ${t('admin.arch_emp.archived_by')} ${r.archivedByName}`}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button variant="outline" size="sm" icon={<Download className="w-4 h-4" />} onClick={onDownloadPdf} loading={exporting}>
              {t('admin.arch_emp.download_pdf', 'Download PDF')}
            </Button>
            <Button size="sm" icon={<RotateCcw className="w-4 h-4" />} onClick={onRestore} loading={restoring}>
              {t('admin.arch_emp.restore')}
            </Button>
          </div>
        </div>
      </Card>

      {/* At-a-glance */}
      <Card>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{t('admin.profile.at_a_glance')}</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-gray-500">{t('admin.profile.service')}</p>
            <p className="text-base font-semibold text-gray-900">{serviceLength(r.hireDate, r.departureDate)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">{t('admin.profile.hire_date')}</p>
            <p className="text-base font-semibold text-gray-900">{fmtDate(r.hireDate)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">{t('admin.arch_emp.departed')}</p>
            <p className="text-base font-semibold text-gray-900">{fmtDate(r.departureDate)}</p>
          </div>
          {r.role === 'staff' && r.employment?.position && (
            <div>
              <p className="text-xs text-gray-500">{t('admin.profile.position')}</p>
              <p className="text-base font-semibold text-gray-900">{r.employment.position}</p>
            </div>
          )}
        </div>
      </Card>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {tabs.map(tt => (
          <button
            key={tt.key} onClick={() => setTab(tt.key)}
            className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${tab === tt.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >{tt.label}</button>
        ))}
      </div>

      {tab === 'personal' && (
        <Card>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{t('admin.profile.personal_info')}</p>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
            <InfoRow label={t('admin.profile.date_of_birth')} value={`${fmtDate(r.dateOfBirth)}${ageStr ? ` · ${ageStr}` : ''}`} />
          </dl>
        </Card>
      )}

      {tab === 'extended' && (
        <ArchivedExtendedView profile={data.extendedProfile} hrOfficer={data.hrOfficer} />
      )}

      {tab === 'employment' && (
        <Card>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{t('admin.profile.employment_info')}</p>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
            <InfoRow label={t('admin.profile.hire_date')} value={fmtDate(r.hireDate)} />
            <InfoRow label={t('admin.arch_emp.departed')} value={fmtDate(r.departureDate)} />
            <InfoRow label={t('admin.arch_emp.reason')} value={t(`admin.arch_emp.reason_${r.reason ?? 'other'}`, r.reason ?? '—')} />
            <InfoRow label={t('admin.arch_emp.archived')} value={fmtDate(r.createdAt)} />
            {r.role === 'teacher' && r.teaching?.curriculum?.length > 0 && (
              <div className="sm:col-span-2 mt-3">
                <dt className="text-xs text-gray-500 mb-2">{t('admin.arch_emp.teaching')}</dt>
                <div className="space-y-2">
                  {(r.teaching.curriculum as { className: string | null; subjects: string[] }[]).map((c, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className="text-sm font-medium text-gray-700 w-32 shrink-0">{c.className ?? '—'}</span>
                      <div className="flex flex-wrap gap-1">
                        {(c.subjects || []).map(s => (
                          <span key={s} className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full">{s}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {r.role === 'driver' && r.transport && (
              <>
                <InfoRow label={t('admin.arch_emp.bus')} value={r.transport.busNumber ? `#${r.transport.busNumber}${r.transport.plateNumber ? ` (${r.transport.plateNumber})` : ''}` : null} />
                <InfoRow label={t('admin.arch_emp.vehicle')} value={r.transport.vehicleType} />
                <InfoRow label={t('admin.arch_emp.license')} value={r.transport.licenseNumber} />
              </>
            )}
            {r.role === 'staff' && r.employment && (
              <>
                <InfoRow label={t('admin.profile.position')} value={r.employment.position} />
                <InfoRow label={t('admin.profile.salary')} value={r.employment.salaryAmount != null ? `${r.employment.salaryAmount.toLocaleString()} ${r.employment.currency ?? ''}` : null} />
                <InfoRow label={t('admin.profile.insurance_pct')} value={r.employment.insurancePercentage != null ? `${r.employment.insurancePercentage}%` : null} />
              </>
            )}
          </dl>
        </Card>
      )}

      {tab === 'contact' && (
        <Card>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{t('admin.profile.contact_info')}</p>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
            <InfoRow label={t('admin.profile.phone')} value={r.phoneNumber} />
            <InfoRow label={t('admin.profile.email')} value={r.email} />
            <div className="sm:col-span-2"><InfoRow label={t('admin.profile.emergency')} value={r.emergencyContact} /></div>
            <InfoRow label={t('admin.profile.username')} value={(r.account as { username?: string } | null)?.username ?? null} />
          </dl>
        </Card>
      )}

      {tab === 'emergency' && (
        <ArchivedEmergencyView contacts={data.emergencyContacts} />
      )}

      {tab === 'documents' && (
        <ArchivedDocumentsView documents={data.documents} hrOfficer={data.hrOfficer} />
      )}

      {tab === 'acknowledgements' && (
        <ArchivedAcknowledgementsView acknowledgements={data.acknowledgements} />
      )}

      {tab === 'history' && (
        <ArchivedActionsView actions={data.actions} />
      )}
    </div>
  );
}
