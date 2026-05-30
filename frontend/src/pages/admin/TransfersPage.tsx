// Transfers page with Outgoing + Incoming tabs (migrations 032 + 034).
//
// Outgoing: every transfer this school initiated. Resume buttons re-open
// the wizard mid-flow. Source-only view scoped by school_id.
// Incoming: every transfer where THIS school is the destination_school_id.
// Detail view + accept/reject. Cross-school read explicitly authorised
// by the destination_school_id column.

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { format, parseISO } from 'date-fns';
import { Send, RefreshCw, Inbox, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { adminApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Select from '../../components/common/Select';
import Input from '../../components/common/Input';
import Button from '../../components/common/Button';
import Modal from '../../components/common/Modal';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import TransferWizard from '../../components/admin/TransferWizard';

type TransferStatus =
  | 'pending_consent' | 'consented' | 'bundle_generated'
  | 'awaiting_destination' | 'destination_imported' | 'destination_rejected'
  | 'completed' | 'cancelled';

interface OutgoingRow {
  id: string;
  status: TransferStatus;
  studentId: string | null;
  studentNameSnapshot: string;
  destinationKind: 'non_scholify' | 'scholify';
  destinationSchoolName: string;
  destinationCity: string | null;
  destinationCountry: string | null;
  destinationContact: string | null;
  destinationRejectedReason: string | null;
  consentSignedAt: string | null;
  bundleGeneratedAt: string | null;
  completedAt: string | null;
  cancelledReason: string | null;
  createdAt: string;
}

interface IncomingRow {
  id: string;
  status: TransferStatus;
  studentNameSnapshot: string;
  destinationKind: 'non_scholify' | 'scholify';
  destinationSchoolId: string | null;
  destinationSchoolName: string;
  sourceSchoolName: string | null;
  consentSignedAt: string | null;
  bundleGeneratedAt: string | null;
  destinationViewedAt: string | null;
  destinationAcceptedAt: string | null;
  destinationRejectedAt: string | null;
  destinationRejectedReason: string | null;
  destinationImportedStudentId: string | null;
  createdAt: string;
}

const STATUS_PILL: Record<TransferStatus, string> = {
  pending_consent:       'bg-amber-50 text-amber-700',
  consented:             'bg-sky-50 text-sky-700',
  bundle_generated:      'bg-violet-50 text-violet-700',
  awaiting_destination:  'bg-blue-50 text-blue-700',
  destination_imported:  'bg-teal-50 text-teal-700',
  destination_rejected:  'bg-red-50 text-red-700',
  completed:             'bg-emerald-50 text-emerald-700',
  cancelled:             'bg-gray-100 text-gray-600',
};

const fmt = (d: string | null) => (d ? format(parseISO(d), 'MMM d, yyyy · HH:mm') : '—');

const defaultStatusLabel = (s: TransferStatus): string => {
  switch (s) {
    case 'pending_consent':       return 'Pending consent';
    case 'consented':             return 'Consented';
    case 'bundle_generated':      return 'Bundle generated';
    case 'awaiting_destination':  return 'Awaiting destination';
    case 'destination_imported':  return 'Destination imported';
    case 'destination_rejected':  return 'Destination rejected';
    case 'completed':             return 'Completed';
    case 'cancelled':             return 'Cancelled';
  }
};

export default function TransfersPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'outgoing' | 'incoming'>('outgoing');
  const statusLabel = (s: TransferStatus) => t(`admin.transfer.status_${s}`, defaultStatusLabel(s));

  return (
    <PageLayout title={t('admin.transfer.page_title', 'Transfers')}>
      <div className="space-y-4">
        {/* Tab switcher */}
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          <button
            onClick={() => setTab('outgoing')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-2 ${
              tab === 'outgoing' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Send className="w-4 h-4" /> {t('admin.transfer.tab_outgoing', 'Outgoing')}
          </button>
          <button
            onClick={() => setTab('incoming')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-2 ${
              tab === 'incoming' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Inbox className="w-4 h-4" /> {t('admin.transfer.tab_incoming', 'Incoming')}
          </button>
        </div>

        {tab === 'outgoing'
          ? <OutgoingPanel t={t} statusLabel={statusLabel} />
          : <IncomingPanel t={t} statusLabel={statusLabel} />}
      </div>
    </PageLayout>
  );
}

// ─── OUTGOING ─────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function OutgoingPanel({ t, statusLabel }: { t: any; statusLabel: (s: TransferStatus) => string }) {
  const [rows, setRows] = useState<OutgoingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [wizardId, setWizardId] = useState<{ studentId: string; studentName: string } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await adminApi.listTransfers(statusFilter || undefined);
      setRows((r.data || []) as OutgoingRow[]);
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [statusFilter]);

  const counts = useMemo(() => {
    const c: Record<TransferStatus, number> = {
      pending_consent: 0, consented: 0, bundle_generated: 0,
      awaiting_destination: 0, destination_imported: 0, destination_rejected: 0,
      completed: 0, cancelled: 0,
    };
    for (const r of rows) c[r.status]++;
    return c;
  }, [rows]);

  const isResumable = (s: TransferStatus) =>
    s === 'pending_consent' || s === 'consented' || s === 'bundle_generated' ||
    s === 'awaiting_destination' || s === 'destination_imported' || s === 'destination_rejected';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center">
        <div className="w-56">
          <Select
            options={(['pending_consent', 'consented', 'bundle_generated',
              'awaiting_destination', 'destination_imported', 'destination_rejected',
              'completed', 'cancelled'] as TransferStatus[]).map(s => ({
                value: s, label: `${statusLabel(s)} (${counts[s]})`,
              }))}
            placeholder={t('admin.transfer.all_statuses', 'All statuses')}
            value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          />
        </div>
        <button onClick={load} className="text-xs text-gray-500 hover:text-gray-900 flex items-center gap-1">
          <RefreshCw className="w-3.5 h-3.5" /> {t('admin.transfer.refresh', 'Refresh')}
        </button>
        {!loading && (
          <span className="text-sm text-gray-400">
            {t('admin.transfer.count', { count: rows.length, defaultValue: `${rows.length} transfer(s)` })}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><LoadingSpinner /></div>
      ) : rows.length === 0 ? (
        <Card className="text-center py-16">
          <Send className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">{t('admin.transfer.empty', 'No transfers yet')}</p>
          <p className="text-xs text-gray-400 mt-1">{t('admin.transfer.empty_hint', 'Open a student’s profile to start one.')}</p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="text-left px-3 py-2 font-medium">{t('admin.transfer.col_student', 'Student')}</th>
                <th className="text-left px-3 py-2 font-medium">{t('admin.transfer.col_destination', 'Destination')}</th>
                <th className="text-left px-3 py-2 font-medium">{t('admin.transfer.col_status', 'Status')}</th>
                <th className="text-left px-3 py-2 font-medium">{t('admin.transfer.col_started', 'Started')}</th>
                <th className="text-left px-3 py-2 font-medium">{t('admin.transfer.col_action', '')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-gray-50/60">
                  <td className="px-3 py-2 font-medium text-gray-900">{r.studentNameSnapshot}</td>
                  <td className="px-3 py-2 text-gray-700">
                    {r.destinationSchoolName}
                    {r.destinationKind === 'scholify' && (
                      <span className="text-xs text-violet-700 bg-violet-50 rounded-full px-1.5 py-0.5 ml-1">Scholify</span>
                    )}
                    {r.destinationCity && <span className="text-xs text-gray-400 ml-1">· {r.destinationCity}</span>}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_PILL[r.status]}`}>
                      {statusLabel(r.status)}
                    </span>
                    {r.status === 'destination_rejected' && r.destinationRejectedReason && (
                      <p className="text-xs text-red-600 mt-1">{r.destinationRejectedReason}</p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{fmt(r.createdAt)}</td>
                  <td className="px-3 py-2">
                    {isResumable(r.status) && r.studentId && (
                      <button
                        onClick={() => setWizardId({ studentId: r.studentId!, studentName: r.studentNameSnapshot })}
                        className="text-xs text-primary-700 hover:bg-primary-50 rounded-lg px-2 py-1"
                      >
                        {t('admin.transfer.resume', 'Resume')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <TransferWizard
        isOpen={!!wizardId}
        onClose={() => { setWizardId(null); void load(); }}
        studentId={wizardId?.studentId ?? null}
        studentName={wizardId?.studentName}
        onCompleted={load}
      />
    </div>
  );
}

// ─── INCOMING ─────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function IncomingPanel({ t, statusLabel }: { t: any; statusLabel: (s: TransferStatus) => string }) {
  const [rows, setRows] = useState<IncomingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await adminApi.listIncomingTransfers(statusFilter || undefined);
      setRows((r.data || []) as IncomingRow[]);
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [statusFilter]);

  const counts = useMemo(() => {
    const c: Record<TransferStatus, number> = {
      pending_consent: 0, consented: 0, bundle_generated: 0,
      awaiting_destination: 0, destination_imported: 0, destination_rejected: 0,
      completed: 0, cancelled: 0,
    };
    for (const r of rows) c[r.status]++;
    return c;
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center">
        <div className="w-56">
          <Select
            options={(['awaiting_destination', 'destination_imported', 'destination_rejected', 'completed'] as TransferStatus[]).map(s => ({
              value: s, label: `${statusLabel(s)} (${counts[s]})`,
            }))}
            placeholder={t('admin.transfer.all_statuses', 'All statuses')}
            value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          />
        </div>
        <button onClick={load} className="text-xs text-gray-500 hover:text-gray-900 flex items-center gap-1">
          <RefreshCw className="w-3.5 h-3.5" /> {t('admin.transfer.refresh', 'Refresh')}
        </button>
        {!loading && (
          <span className="text-sm text-gray-400">
            {t('admin.transfer.count', { count: rows.length, defaultValue: `${rows.length} transfer(s)` })}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><LoadingSpinner /></div>
      ) : rows.length === 0 ? (
        <Card className="text-center py-16">
          <Inbox className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">{t('admin.transfer.empty_incoming', 'No incoming transfers')}</p>
          <p className="text-xs text-gray-400 mt-1">{t('admin.transfer.empty_incoming_hint', 'Transfers sent by other Scholify schools will appear here.')}</p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="text-left px-3 py-2 font-medium">{t('admin.transfer.col_student', 'Student')}</th>
                <th className="text-left px-3 py-2 font-medium">{t('admin.transfer.col_source', 'From')}</th>
                <th className="text-left px-3 py-2 font-medium">{t('admin.transfer.col_status', 'Status')}</th>
                <th className="text-left px-3 py-2 font-medium">{t('admin.transfer.col_sent', 'Sent')}</th>
                <th className="text-left px-3 py-2 font-medium">{t('admin.transfer.col_action', '')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-gray-50/60">
                  <td className="px-3 py-2 font-medium text-gray-900">{r.studentNameSnapshot}</td>
                  <td className="px-3 py-2 text-gray-700">{r.sourceSchoolName || '—'}</td>
                  <td className="px-3 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_PILL[r.status]}`}>
                      {statusLabel(r.status)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{fmt(r.createdAt)}</td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => setDetailId(r.id)}
                      className="text-xs text-primary-700 hover:bg-primary-50 rounded-lg px-2 py-1"
                    >
                      {t('admin.transfer.review', 'Review')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <IncomingDetailModal
        isOpen={!!detailId} onClose={() => { setDetailId(null); void load(); }}
        transferId={detailId} t={t} statusLabel={statusLabel}
      />
    </div>
  );
}

// ─── INCOMING DETAIL / ACCEPT / REJECT ────────────────────────────────

interface IncomingDetail {
  transfer: IncomingRow & {
    consentParentName: string | null;
    consentWitnessName: string | null;
    consentWitnessRole: string | null;
    bundleSha256: string | null;
  };
  sourceSchool: { name: string; abbreviation: string | null } | null;
  bundle: {
    student: { fullName: string; dateOfBirth: string | null; phoneNumber: string | null; homeAddress: string | null };
    parents: Array<{ fullName: string; phoneNumber: string | null }>;
    academicRecord: {
      enrollmentHistory: Array<{ academicYear: string; gradeLevel: string; className: string | null; status: string }>;
      grades: Array<Record<string, unknown>>;
    };
  } | null;
}

interface ClassOption { id: string; name: string; gradeLevel?: string | null }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function IncomingDetailModal({ isOpen, onClose, transferId, t, statusLabel }: {
  isOpen: boolean; onClose: () => void; transferId: string | null;
  t: any; statusLabel: (s: TransferStatus) => string;
}) {
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<IncomingDetail | null>(null);
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [targetClassId, setTargetClassId] = useState('');
  const [parentLink, setParentLink] = useState<'create_new' | 'none'>('create_new');
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  useEffect(() => {
    if (!isOpen || !transferId) {
      setDetail(null); setTargetClassId(''); setRejectMode(false); setRejectReason('');
      return;
    }
    const load = async () => {
      setLoading(true);
      try {
        const [d, c] = await Promise.all([
          adminApi.getIncomingTransfer(transferId),
          adminApi.getClasses(),
        ]);
        setDetail(d.data as IncomingDetail);
        setClasses((c.data || []) as ClassOption[]);
      } catch (err: any) {
        toast.error(err?.response?.data?.error || t('admin.transfer.failed_load_incoming', 'Failed to load transfer'));
        onClose();
      } finally { setLoading(false); }
    };
    void load();
  }, [isOpen, transferId, onClose, t]);

  const onAccept = async () => {
    if (!detail || !transferId) return;
    if (!targetClassId) {
      toast.error(t('admin.transfer.target_class_required', 'Pick a class for the student'));
      return;
    }
    if (!confirm(t('admin.transfer.confirm_accept', 'Accept this transfer? A new student record will be created in your school and placed in the selected class.'))) return;
    setBusy(true);
    try {
      await adminApi.acceptIncomingTransfer(transferId, { classId: targetClassId, parentLink });
      toast.success(t('admin.transfer.accepted', 'Transfer accepted — student created.'));
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('admin.transfer.failed_accept', 'Failed to accept'));
    } finally { setBusy(false); }
  };

  const onReject = async () => {
    if (!transferId) return;
    if (!rejectReason.trim()) {
      toast.error(t('admin.transfer.reject_reason_required', 'A reason is required'));
      return;
    }
    setBusy(true);
    try {
      await adminApi.rejectIncomingTransfer(transferId, rejectReason.trim());
      toast.success(t('admin.transfer.rejected', 'Transfer rejected.'));
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('admin.transfer.failed_reject', 'Failed to reject'));
    } finally { setBusy(false); }
  };

  const canAct = detail?.transfer.status === 'awaiting_destination';
  const title = detail
    ? t('admin.transfer.review_title', { name: detail.transfer.studentNameSnapshot, defaultValue: `Incoming transfer · ${detail.transfer.studentNameSnapshot}` })
    : t('admin.transfer.review', 'Review');

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="xl">
      {loading || !detail ? (
        <div className="flex justify-center py-12"><LoadingSpinner /></div>
      ) : (
        <div className="space-y-4">
          {/* Header */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="p-3 bg-gray-50 rounded-xl">
              <p className="text-xs text-gray-500 uppercase tracking-wide">{t('admin.transfer.from', 'From')}</p>
              <p className="font-medium text-gray-900 mt-0.5">{detail.sourceSchool?.name || '—'}</p>
            </div>
            <div className="p-3 bg-gray-50 rounded-xl">
              <p className="text-xs text-gray-500 uppercase tracking-wide">{t('admin.transfer.col_status', 'Status')}</p>
              <span className={`inline-block mt-0.5 text-xs px-2 py-0.5 rounded-full ${STATUS_PILL[detail.transfer.status]}`}>
                {statusLabel(detail.transfer.status)}
              </span>
            </div>
          </div>

          {/* Student preview */}
          {detail.bundle && (
            <div className="space-y-3">
              <div className="p-3 bg-gray-50 rounded-xl">
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">{t('admin.transfer.student', 'Student')}</p>
                <p className="font-medium text-gray-900">{detail.bundle.student.fullName}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {detail.bundle.student.dateOfBirth && `DOB ${detail.bundle.student.dateOfBirth}`}
                  {detail.bundle.student.phoneNumber && ` · ${detail.bundle.student.phoneNumber}`}
                </p>
              </div>
              {detail.bundle.parents.length > 0 && (
                <div className="p-3 bg-gray-50 rounded-xl">
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">{t('admin.transfer.parents', 'Parents')}</p>
                  {detail.bundle.parents.map((p, i) => (
                    <p key={i} className="text-sm text-gray-700">
                      {p.fullName}{p.phoneNumber && ` · ${p.phoneNumber}`}
                    </p>
                  ))}
                </div>
              )}
              <div className="p-3 bg-gray-50 rounded-xl">
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">{t('admin.transfer.academic_record', 'Academic record')}</p>
                {detail.bundle.academicRecord.enrollmentHistory.length === 0 ? (
                  <p className="text-xs text-gray-400">{t('admin.transfer.no_progression', 'No progression recorded')}</p>
                ) : (
                  <div className="space-y-1.5">
                    {detail.bundle.academicRecord.enrollmentHistory.map((e, i) => (
                      <p key={i} className="text-sm text-gray-700">
                        <span className="text-xs text-gray-500 mr-2">{e.academicYear}</span>
                        {e.gradeLevel}{e.className ? ` · ${e.className}` : ''}
                      </p>
                    ))}
                  </div>
                )}
                <p className="text-xs text-gray-500 mt-2">
                  {t('admin.transfer.grades_count', { count: detail.bundle.academicRecord.grades.length, defaultValue: `${detail.bundle.academicRecord.grades.length} graded entries in the bundle` })}
                </p>
              </div>
            </div>
          )}

          {/* Consent info */}
          <div className="p-3 bg-gray-50 rounded-xl text-xs">
            <p className="text-gray-500 uppercase tracking-wide mb-1">{t('admin.transfer.consent', 'Consent')}</p>
            <p className="text-gray-700">
              {t('admin.transfer.consent_line', {
                parent: detail.transfer.consentParentName || '—',
                witness: detail.transfer.consentWitnessName || '—',
                defaultValue: `Signed by ${detail.transfer.consentParentName || '—'}; witness ${detail.transfer.consentWitnessName || '—'}`,
              })}
            </p>
            {detail.transfer.bundleSha256 && (
              <p className="text-gray-400 font-mono break-all mt-1">SHA-256: {detail.transfer.bundleSha256}</p>
            )}
          </div>

          {/* Accept / reject actions */}
          {canAct && !rejectMode && (
            <div className="space-y-3 border-t border-gray-100 pt-4">
              <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm">
                <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <span className="text-amber-800">
                  {t('admin.transfer.accept_warning', 'Accepting creates a fresh student in YOUR school with a new enrollment row for the current year. Past years from the source are not materialised as live enrollments — they remain visible via the transfer bundle.')}
                </span>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  {t('admin.transfer.place_in_class', 'Place in class *')}
                </label>
                <select
                  value={targetClassId} onChange={e => setTargetClassId(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">{t('admin.transfer.pick_class', '— pick a class —')}</option>
                  {classes.map(c => (
                    <option key={c.id} value={c.id}>{c.name}{c.gradeLevel ? ` · ${c.gradeLevel}` : ''}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  {t('admin.transfer.parent_link', 'Parent linking')}
                </label>
                <select
                  value={parentLink} onChange={e => setParentLink(e.target.value as 'create_new' | 'none')}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="create_new">{t('admin.transfer.parent_create_new', 'Create new parent record (no login yet)')}</option>
                  <option value="none">{t('admin.transfer.parent_skip', 'Skip — I will link the parent later')}</option>
                </select>
              </div>
              <div className="flex justify-between gap-2">
                <Button variant="outline" onClick={() => setRejectMode(true)} disabled={busy} icon={<XCircle className="w-4 h-4" />}>
                  {t('admin.transfer.reject', 'Reject')}
                </Button>
                <Button onClick={onAccept} loading={busy} disabled={!targetClassId} icon={<CheckCircle2 className="w-4 h-4" />}>
                  {t('admin.transfer.accept_and_import', 'Accept & import')}
                </Button>
              </div>
            </div>
          )}

          {canAct && rejectMode && (
            <div className="space-y-3 border-t border-gray-100 pt-4">
              <Input
                label={t('admin.transfer.reject_reason', 'Reason for rejection *')}
                placeholder={t('admin.transfer.reject_reason_ph', 'Brief explanation visible to the source admin')}
                value={rejectReason} onChange={e => setRejectReason(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => { setRejectMode(false); setRejectReason(''); }} disabled={busy}>
                  {t('common.cancel', 'Cancel')}
                </Button>
                <Button onClick={onReject} loading={busy} disabled={!rejectReason.trim()} icon={<XCircle className="w-4 h-4" />}>
                  {t('admin.transfer.confirm_reject', 'Confirm rejection')}
                </Button>
              </div>
            </div>
          )}

          {!canAct && detail.transfer.status === 'destination_imported' && (
            <div className="flex items-start gap-2 p-3 bg-teal-50 border border-teal-200 rounded-xl text-sm">
              <CheckCircle2 className="w-4 h-4 text-teal-600 flex-shrink-0 mt-0.5" />
              <span className="text-teal-800">
                {t('admin.transfer.already_imported', 'Already accepted — the student exists in your roster. The source school will archive on their end shortly.')}
              </span>
            </div>
          )}
          {!canAct && detail.transfer.status === 'destination_rejected' && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm">
              <XCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
              <span className="text-red-800">
                {t('admin.transfer.already_rejected', { reason: detail.transfer.destinationRejectedReason || '—',
                  defaultValue: `Already rejected. Reason: ${detail.transfer.destinationRejectedReason || '—'}` })}
              </span>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
