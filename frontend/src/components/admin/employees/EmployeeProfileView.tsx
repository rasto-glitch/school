import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Edit, FileJson, FileText, ShieldAlert, UserX } from 'lucide-react';
import { format, parseISO, differenceInYears, differenceInMonths } from 'date-fns';
import Card from '../../common/Card';
import Button from '../../common/Button';
import DocumentsTab from './DocumentsTab';
import { ExtendedProfileTab, EmergencyContactsTab, AcknowledgementsTab, ActionsTab } from './Wave2Tabs';
import TerminationModal from './TerminationModal';
import EditIdentityPanel from './EditIdentityPanel';
import type { EmployeeDocument, EmployeeProfile, EmployeeRole } from '../../../types/employeeDocs';

// Shared employee profile view. Renders the header + at-a-glance strip +
// tabbed body for an active employee. Designed so a future Wave-2 adapter
// can pipe an archived_employees record through the same component and
// the only difference is a `readonly` flag that hides the upload/edit
// buttons. For now, only active employees flow through here.

type Tab = 'personal' | 'extended' | 'employment' | 'contact' | 'emergency' | 'documents' | 'acknowledgements' | 'history' | 'notes';

interface Props {
  profile: EmployeeProfile;
  documents: EmployeeDocument[];
  hrOfficer: boolean;
  /** Called after the operator saves identity edits so the page can re-fetch. */
  onSaved?: () => void;
  onExportJson?: () => void;
  onExportPdf?: () => void;
  onTerminated?: () => void;
  initialTab?: Tab;
}

const ROLE_COLOR: Record<EmployeeRole, string> = {
  teacher:    'bg-indigo-100 text-indigo-700',
  driver:     'bg-cyan-100 text-cyan-700',
  staff:      'bg-emerald-100 text-emerald-700',
  supervisor: 'bg-violet-100 text-violet-700',
  admin:      'bg-purple-100 text-purple-700',
  reception:  'bg-pink-100 text-pink-700',
  accountant: 'bg-amber-100 text-amber-700',
};

const ROLE_LABEL: Record<EmployeeRole, string> = {
  teacher: 'admin.profile.role_teacher',
  driver: 'admin.profile.role_driver',
  staff: 'admin.profile.role_staff',
  supervisor: 'admin.profile.role_supervisor',
  admin: 'admin.profile.role_admin',
  reception: 'admin.profile.role_reception',
  accountant: 'admin.profile.role_accountant',
};

const fmtDate = (d?: string | null) => (d ? format(parseISO(d), 'MMM d, yyyy') : '—');

function serviceLength(hireDate: string | null): string {
  if (!hireDate) return '—';
  try {
    const d = parseISO(hireDate);
    const years = differenceInYears(new Date(), d);
    const months = differenceInMonths(new Date(), d) - years * 12;
    if (years === 0 && months === 0) return '<1 month';
    if (years === 0) return `${months}m`;
    if (months === 0) return `${years}y`;
    return `${years}y ${months}m`;
  } catch { return '—'; }
}

function computeAge(dob: string | null): number | null {
  if (!dob) return null;
  try { return differenceInYears(new Date(), parseISO(dob)); } catch { return null; }
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

export default function EmployeeProfileView({ profile: p, documents: _docs, hrOfficer, onSaved, onExportJson, onExportPdf, onTerminated, initialTab = 'personal' }: Props) {
  void _docs; // DocumentsTab refetches on its own; we don't need the prop here, but consumers pass it for symmetry / SSR.
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [exporting, setExporting] = useState<'json' | 'pdf' | null>(null);
  const [showTerminate, setShowTerminate] = useState(false);
  const [editing, setEditing] = useState(false);

  const ageStr = useMemo(() => {
    const a = computeAge(p.hr.dateOfBirth);
    return a != null ? `${a}` : null;
  }, [p.hr.dateOfBirth]);

  const handleExport = async (kind: 'json' | 'pdf') => {
    const fn = kind === 'json' ? onExportJson : onExportPdf;
    if (!fn) return;
    setExporting(kind);
    try { await fn(); } finally { setExporting(null); }
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
    { key: 'notes',            label: t('admin.profile.tab_notes') },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card>
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 rounded-full overflow-hidden bg-slate-100 flex items-center justify-center flex-shrink-0">
            {p.officialPhoto ? (
              <img src={p.officialPhoto} alt={p.fullName} className="w-full h-full object-cover" />
            ) : (
              <span className="text-slate-600 font-bold text-2xl">{p.fullName?.[0]}</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-gray-900 truncate">{p.fullName}</h1>
              <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${ROLE_COLOR[p.role]}`}>
                {t(ROLE_LABEL[p.role])}
              </span>
              {p.account.isActive === false && (
                <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">
                  {t('admin.profile.inactive')}
                </span>
              )}
              {hrOfficer && (
                <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700">
                  <ShieldAlert className="w-3 h-3" /> {t('admin.profile.hr_officer')}
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500 mt-1">
              {p.account.username && <span>{p.account.username}</span>}
              {p.contact.phoneNumber && <span> · {p.contact.phoneNumber}</span>}
              {p.contact.email && <span> · {p.contact.email}</span>}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {p.account.isActive !== false && (
              <Button
                variant={editing ? 'outline' : 'ghost'}
                size="sm"
                icon={<Edit className="w-4 h-4" />}
                onClick={() => setEditing(e => !e)}
              >
                {editing ? t('admin.profile.cancel_edit', 'Cancel edit') : t('admin.profile.edit')}
              </Button>
            )}
            {onExportJson && (
              <Button variant="outline" size="sm" icon={<FileJson className="w-4 h-4" />} onClick={() => handleExport('json')} loading={exporting === 'json'}>
                {t('admin.profile.export_json')}
              </Button>
            )}
            {onExportPdf && (
              <Button variant="outline" size="sm" icon={<FileText className="w-4 h-4" />} onClick={() => handleExport('pdf')} loading={exporting === 'pdf'}>
                {t('admin.profile.export_pdf')}
              </Button>
            )}
            {p.account.isActive !== false && (
              <Button variant="danger" size="sm" icon={<UserX className="w-4 h-4" />} onClick={() => setShowTerminate(true)}>
                {t('admin.profile.terminate')}
              </Button>
            )}
          </div>
        </div>
      </Card>

      {editing && (
        <EditIdentityPanel
          profile={p}
          onSaved={() => { setEditing(false); onSaved?.(); }}
          onCancel={() => setEditing(false)}
        />
      )}

      {/* At-a-glance */}
      <Card>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{t('admin.profile.at_a_glance')}</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-gray-500">{t('admin.profile.service')}</p>
            <p className="text-base font-semibold text-gray-900">{serviceLength(p.hr.hireDate)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">{t('admin.profile.hire_date')}</p>
            <p className="text-base font-semibold text-gray-900">{fmtDate(p.hr.hireDate)}</p>
          </div>
          {p.teaching && (
            <>
              <div>
                <p className="text-xs text-gray-500">{t('admin.profile.subjects')}</p>
                <p className="text-base font-semibold text-gray-900">{p.teaching.subjects.length}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">{t('admin.profile.classes')}</p>
                <p className="text-base font-semibold text-gray-900">{p.teaching.classes.length}</p>
              </div>
            </>
          )}
          {p.transport && (
            <>
              <div>
                <p className="text-xs text-gray-500">{t('admin.profile.bus')}</p>
                <p className="text-base font-semibold text-gray-900">{p.transport.bus?.number ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">{t('admin.profile.students_assigned')}</p>
                <p className="text-base font-semibold text-gray-900">{p.transport.studentsAssigned}</p>
              </div>
            </>
          )}
          {p.employment && (
            <>
              <div>
                <p className="text-xs text-gray-500">{t('admin.profile.position')}</p>
                <p className="text-base font-semibold text-gray-900">{p.employment.position || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">{t('admin.profile.next_payment')}</p>
                <p className="text-base font-semibold text-gray-900">{fmtDate(p.employment.nextPaymentDate)}</p>
              </div>
            </>
          )}
        </div>
      </Card>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
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
            <InfoRow label={t('admin.profile.date_of_birth')} value={`${fmtDate(p.hr.dateOfBirth)}${ageStr ? ` · ${ageStr}` : ''}`} />
            <InfoRow label={t('admin.profile.gender')} value={p.hr.gender} />
            <InfoRow label={t('admin.profile.marital_status')} value={p.hr.maritalStatus} />
            <InfoRow label={t('admin.profile.national_id')} value={p.hr.nationalId} sensitive />
            <div className="sm:col-span-2"><InfoRow label={t('admin.profile.address')} value={p.hr.address} /></div>
          </dl>
        </Card>
      )}

      {tab === 'employment' && (
        <Card>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{t('admin.profile.employment_info')}</p>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
            <InfoRow label={t('admin.profile.hire_date')} value={fmtDate(p.hr.hireDate)} />
            <InfoRow label={t('admin.profile.employment_type')} value={p.hr.employmentType} />
            {p.teaching && (
              <div className="sm:col-span-2">
                <dt className="text-xs text-gray-500 mb-2">{t('admin.profile.teaching')}</dt>
                {p.teaching.subjects.length === 0 ? <span className="text-sm text-gray-400">—</span> : (
                  <div className="space-y-2">
                    {p.teaching.subjects.map(s => (
                      <div key={s.id} className="flex items-start gap-2">
                        <span className="text-sm font-medium text-gray-700 w-32 shrink-0">{s.name}</span>
                        <div className="flex flex-wrap gap-1">
                          {s.classes.map(c => (
                            <span key={c.id} className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full">{c.name}</span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {p.transport && (
              <>
                <InfoRow label={t('admin.profile.license')} value={p.transport.licenseNumber} />
                <InfoRow label={t('admin.profile.vehicle')} value={p.transport.vehicleType} />
                <InfoRow label={t('admin.profile.bus_full')} value={p.transport.bus ? `${p.transport.bus.number ?? ''} ${p.transport.bus.plate ? `(${p.transport.bus.plate})` : ''}`.trim() : null} />
                <InfoRow label={t('admin.profile.driver_age')} value={p.transport.age != null ? String(p.transport.age) : null} />
              </>
            )}
            {p.employment && (
              <>
                <InfoRow label={t('admin.profile.position')} value={p.employment.position} />
                <InfoRow
                  label={t('admin.profile.salary')}
                  value={p.employment.salaryAmount != null ? `${p.employment.salaryAmount.toLocaleString()} ${p.employment.currency ?? ''}` : null}
                />
                <InfoRow label={t('admin.profile.insurance_pct')} value={p.employment.insurancePercentage != null ? `${p.employment.insurancePercentage}%` : null} />
              </>
            )}
            <div className="sm:col-span-2">
              <dt className="text-xs text-gray-500 mb-1">{t('admin.profile.qualifications')}</dt>
              <dd className="text-sm text-gray-800 whitespace-pre-wrap">{p.hr.qualifications || <span className="text-gray-400">—</span>}</dd>
            </div>
          </dl>
        </Card>
      )}

      {tab === 'contact' && (
        <Card>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{t('admin.profile.contact_info')}</p>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
            <InfoRow label={t('admin.profile.phone')} value={p.contact.phoneNumber} />
            <InfoRow label={t('admin.profile.email')} value={p.contact.email} />
            <div className="sm:col-span-2"><InfoRow label={t('admin.profile.emergency')} value={p.contact.emergencyContact} /></div>
            <InfoRow label={t('admin.profile.username')} value={p.account.username} />
            <InfoRow label={t('admin.profile.last_password_change')} value={fmtDate(p.account.passwordChangedAt)} />
          </dl>
        </Card>
      )}

      {tab === 'extended' && (
        <ExtendedProfileTab role={p.role} employeeId={p.ownerId} />
      )}

      {tab === 'emergency' && (
        <Card>
          <EmergencyContactsTab role={p.role} employeeId={p.ownerId} />
        </Card>
      )}

      {tab === 'documents' && (
        <Card>
          <DocumentsTab role={p.role} employeeId={p.ownerId} />
        </Card>
      )}

      {tab === 'acknowledgements' && (
        <Card>
          <AcknowledgementsTab role={p.role} employeeId={p.ownerId} />
        </Card>
      )}

      {tab === 'history' && (
        <Card>
          <ActionsTab role={p.role} employeeId={p.ownerId} />
        </Card>
      )}

      {tab === 'notes' && (
        <Card>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{t('admin.profile.notes_section')}</p>
          {p.hr.notes
            ? <p className="text-sm text-gray-800 whitespace-pre-wrap">{p.hr.notes}</p>
            : <p className="text-sm text-gray-400">{t('admin.profile.no_notes')}</p>}
        </Card>
      )}

      <TerminationModal
        isOpen={showTerminate}
        onClose={() => setShowTerminate(false)}
        role={p.role}
        employeeId={p.ownerId}
        employeeName={p.fullName}
        onCompleted={() => { setShowTerminate(false); onTerminated?.(); }}
      />
    </div>
  );
}
