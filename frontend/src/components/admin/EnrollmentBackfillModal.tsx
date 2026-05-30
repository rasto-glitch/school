// One-off backfill of the per-year enrollment history for students who
// pre-date migration 030. Loads a dry-run preview on open; admin reviews
// counts + cleanup report and commits. Idempotent — safe to re-run.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Database, AlertTriangle, CheckCircle2 } from 'lucide-react';
import Modal from '../common/Modal';
import Button from '../common/Button';
import LoadingSpinner from '../common/LoadingSpinner';
import { adminApi } from '../../services/api';

interface Issue {
  studentId: string;
  studentName: string;
  kind: 'no_data' | 'ambiguous_year' | 'missing_grade_level' | 'unknown_class' | 'insert_failed';
  details: string;
}

interface Report {
  dryRun: boolean;
  liveStudentsScanned: number;
  liveStudentsProcessed: number;
  liveRowsInserted: number;
  liveSkippedAlreadyHasRows: number;
  issues: Issue[];
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const ISSUE_LABEL: Record<Issue['kind'], string> = {
  no_data: 'No data',
  ambiguous_year: 'Ambiguous year',
  missing_grade_level: 'Missing grade level',
  unknown_class: 'Unknown class',
  insert_failed: 'Insert failed',
};

export default function EnrollmentBackfillModal({ isOpen, onClose }: Props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [committed, setCommitted] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setReport(null);
      setCommitted(false);
      return;
    }
    const load = async () => {
      setLoading(true);
      try {
        const r = await adminApi.previewEnrollmentBackfill();
        setReport(r.data as Report);
      } catch (err: any) {
        toast.error(err?.response?.data?.error || t('admin.bf.failed_preview', 'Failed to load preview'));
        onClose();
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [isOpen, onClose, t]);

  const onCommit = async () => {
    if (!report) return;
    if (!confirm(t('admin.bf.confirm', 'Apply backfill? This will insert per-year enrollment rows for all uncovered students.'))) return;
    setCommitting(true);
    try {
      const r = await adminApi.commitEnrollmentBackfill();
      setReport(r.data as Report);
      setCommitted(true);
      toast.success(t('admin.bf.success', 'Backfill applied'));
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('admin.bf.failed_commit', 'Backfill failed'));
    } finally {
      setCommitting(false);
    }
  };

  const title = t('admin.bf.title', 'Backfill enrollment history');

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="xl">
      {loading || !report ? (
        <div className="flex justify-center py-12"><LoadingSpinner /></div>
      ) : (
        <div className="space-y-4">
          {committed ? (
            <div className="flex items-start gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
              <span className="text-emerald-800">
                {t('admin.bf.committed_msg', 'Backfill complete. The report below reflects what was applied.')}
              </span>
            </div>
          ) : (
            <div className="flex items-start gap-2 p-3 bg-sky-50 border border-sky-200 rounded-xl text-sm">
              <Database className="w-4 h-4 text-sky-600 flex-shrink-0 mt-0.5" />
              <span className="text-sky-800">
                {t('admin.bf.preview_msg', 'Dry-run preview — no rows have been written yet. Review the report below, then commit.')}
              </span>
            </div>
          )}

          <div className="p-3 bg-gray-50 rounded-xl text-sm">
            <p className="text-xs text-gray-500 uppercase tracking-wide">{t('admin.bf.live_students', 'Live students')}</p>
            <p className="font-medium text-gray-900 mt-0.5">
              {t('admin.bf.live_summary', {
                processed: report.liveStudentsProcessed,
                skipped: report.liveSkippedAlreadyHasRows,
                total: report.liveStudentsScanned,
                defaultValue: `${report.liveStudentsProcessed} to process · ${report.liveSkippedAlreadyHasRows} already done · ${report.liveStudentsScanned} total`,
              })}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {t('admin.bf.live_rows', { count: report.liveRowsInserted, defaultValue: `${report.liveRowsInserted} enrollment rows` })}
            </p>
            <p className="text-xs text-gray-400 mt-2">
              {t('admin.bf.archived_note', 'Archived students are not modified — they remain append-only. The archive viewer uses the legacy class list for those rows.')}
            </p>
          </div>

          {report.issues.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <p className="text-sm font-medium text-gray-900">
                  {t('admin.bf.cleanup_title', { count: report.issues.length, defaultValue: `Cleanup report (${report.issues.length})` })}
                </p>
              </div>
              <div className="border border-gray-100 rounded-xl overflow-hidden max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">{t('admin.bf.col_kind', 'Kind')}</th>
                      <th className="text-left px-3 py-2 font-medium">{t('admin.bf.col_student', 'Student')}</th>
                      <th className="text-left px-3 py-2 font-medium">{t('admin.bf.col_details', 'Details')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {report.issues.map((iss, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">
                            {ISSUE_LABEL[iss.kind] || iss.kind}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-gray-700">{iss.studentName || '—'}</td>
                        <td className="px-3 py-2 text-gray-600 text-xs">{iss.details}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
            {committed ? (
              <Button onClick={onClose}>{t('common.close', 'Close')}</Button>
            ) : (
              <>
                <Button variant="outline" onClick={onClose} disabled={committing}>
                  {t('common.cancel', 'Cancel')}
                </Button>
                <Button
                  onClick={onCommit}
                  loading={committing}
                  icon={<Database className="w-4 h-4" />}
                  disabled={report.liveStudentsProcessed === 0}
                >
                  {t('admin.bf.apply', 'Apply backfill')}
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
