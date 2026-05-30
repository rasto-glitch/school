// Source-side Outgoing Transfers list (migration 032 — phase A).
//
// Lists every transfer initiated by this school with status filters.
// Clicking a row in-progress opens the wizard to resume it; completed
// and cancelled transfers are read-only.

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { format, parseISO } from 'date-fns';
import { Send, RefreshCw } from 'lucide-react';
import { adminApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Select from '../../components/common/Select';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import TransferWizard from '../../components/admin/TransferWizard';

interface TransferRow {
  id: string;
  status: 'pending_consent' | 'consented' | 'bundle_generated' | 'completed' | 'cancelled';
  studentId: string | null;
  studentNameSnapshot: string;
  destinationSchoolName: string;
  destinationCity: string | null;
  destinationCountry: string | null;
  destinationContact: string | null;
  consentSignedAt: string | null;
  bundleGeneratedAt: string | null;
  completedAt: string | null;
  cancelledReason: string | null;
  createdAt: string;
}

const STATUS_PILL: Record<TransferRow['status'], string> = {
  pending_consent:  'bg-amber-50 text-amber-700',
  consented:        'bg-sky-50 text-sky-700',
  bundle_generated: 'bg-violet-50 text-violet-700',
  completed:        'bg-emerald-50 text-emerald-700',
  cancelled:        'bg-gray-100 text-gray-600',
};

const fmt = (d: string | null) => (d ? format(parseISO(d), 'MMM d, yyyy · HH:mm') : '—');

export default function TransfersPage() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<TransferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [wizardId, setWizardId] = useState<{ studentId: string; studentName: string } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await adminApi.listTransfers(statusFilter || undefined);
      setRows((r.data || []) as TransferRow[]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [statusFilter]);

  const counts = useMemo(() => {
    const c = { pending_consent: 0, consented: 0, bundle_generated: 0, completed: 0, cancelled: 0 };
    for (const r of rows) c[r.status]++;
    return c;
  }, [rows]);

  const isResumable = (s: TransferRow['status']) =>
    s === 'pending_consent' || s === 'consented' || s === 'bundle_generated';

  const statusLabel = (s: TransferRow['status']) =>
    t(`admin.transfer.status_${s}`, defaultStatusLabel(s));

  return (
    <PageLayout title={t('admin.transfer.page_title', 'Outgoing transfers')}>
      <div className="space-y-4">
        {/* Header chrome */}
        <div className="flex flex-wrap gap-3 items-center">
          <div className="w-56">
            <Select
              options={[
                { value: 'pending_consent',  label: `${statusLabel('pending_consent')} (${counts.pending_consent})` },
                { value: 'consented',        label: `${statusLabel('consented')} (${counts.consented})` },
                { value: 'bundle_generated', label: `${statusLabel('bundle_generated')} (${counts.bundle_generated})` },
                { value: 'completed',        label: `${statusLabel('completed')} (${counts.completed})` },
                { value: 'cancelled',        label: `${statusLabel('cancelled')} (${counts.cancelled})` },
              ]}
              placeholder={t('admin.transfer.all_statuses', 'All statuses')}
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
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

        {/* Table */}
        {loading ? (
          <div className="flex justify-center py-16"><LoadingSpinner /></div>
        ) : rows.length === 0 ? (
          <Card className="text-center py-16">
            <Send className="w-10 h-10 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">{t('admin.transfer.empty', 'No transfers yet')}</p>
            <p className="text-xs text-gray-400 mt-1">
              {t('admin.transfer.empty_hint', 'Open a student’s profile to start one.')}
            </p>
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
                      {r.destinationCity && <span className="text-xs text-gray-400 ml-1">· {r.destinationCity}</span>}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_PILL[r.status]}`}>
                        {statusLabel(r.status)}
                      </span>
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
      </div>

      {/* Wizard — opened from Resume on an in-progress row. New transfers
          are started from the student profile, not here. */}
      <TransferWizard
        isOpen={!!wizardId}
        onClose={() => { setWizardId(null); void load(); }}
        studentId={wizardId?.studentId ?? null}
        studentName={wizardId?.studentName}
        onCompleted={load}
      />
    </PageLayout>
  );
}

function defaultStatusLabel(status: TransferRow['status']): string {
  switch (status) {
    case 'pending_consent':  return 'Pending consent';
    case 'consented':        return 'Consented';
    case 'bundle_generated': return 'Bundle generated';
    case 'completed':        return 'Completed';
    case 'cancelled':        return 'Cancelled';
  }
}
