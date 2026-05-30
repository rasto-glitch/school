// Year-end Promote Class wizard. Opens for one source class, lets the
// admin assign a per-student outcome (Promote / Retain / On leave /
// Withdrew / Graduate), then commits the batch.
//
// Migration 030, Phase 3 of the enrollment-history rewrite. See
// memory/student-transfer-plan.md for the locked design.

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { GraduationCap, AlertTriangle } from 'lucide-react';
import Modal from '../common/Modal';
import Button from '../common/Button';
import LoadingSpinner from '../common/LoadingSpinner';
import { adminApi } from '../../services/api';

type PromoteAction = 'promote' | 'retain' | 'on_leave' | 'withdrew' | 'graduate';

interface RosterRow {
  studentId: string;
  studentName: string;
  enrollmentId: string;
  gradeLevel: string;
  classNameSnapshot: string | null;
}

interface PreviewResponse {
  sourceClass: { id: string; name: string; gradeLevel: string | null; academicYear: string | null };
  nextClass: { id: string; name: string; gradeLevel: string | null } | null;
  nextAcademicYear: string;
  academicYear: string;
  roster: RosterRow[];
}

interface ClassOption {
  id: string;
  name: string;
  gradeLevel?: string | null;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  sourceClassId: string | null;
  allClasses: ClassOption[];
  onCompleted?: () => void;
}

interface PerStudentState {
  action: PromoteAction;
  targetClassId: string;
}

export default function PromoteClassModal({ isOpen, onClose, sourceClassId, allClasses, onCompleted }: Props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [perStudent, setPerStudent] = useState<Record<string, PerStudentState>>({});
  const [yearEndDate, setYearEndDate] = useState<string>(() => new Date().toISOString().slice(0, 10));

  // Load the preview whenever the modal opens for a new source class.
  useEffect(() => {
    if (!isOpen || !sourceClassId) {
      setPreview(null);
      setPerStudent({});
      return;
    }
    const load = async () => {
      setLoading(true);
      try {
        const r = await adminApi.previewPromoteClass(sourceClassId);
        const data = r.data as PreviewResponse;
        setPreview(data);
        // Default each student to "promote" with the suggested next class.
        const defaults: Record<string, PerStudentState> = {};
        for (const row of data.roster) {
          defaults[row.studentId] = {
            action: 'promote',
            targetClassId: data.nextClass?.id ?? '',
          };
        }
        setPerStudent(defaults);
      } catch (err: any) {
        toast.error(err?.response?.data?.error || t('admin.promote.failed_preview', 'Failed to load class roster'));
        onClose();
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [isOpen, sourceClassId, onClose, t]);

  const setAction = (studentId: string, action: PromoteAction) => {
    setPerStudent(prev => {
      const cur = prev[studentId] || { action: 'promote', targetClassId: '' };
      // Adjust the suggested target when the action changes.
      let target = cur.targetClassId;
      if (action === 'retain') target = preview?.sourceClass.id || '';
      else if (action === 'promote') target = preview?.nextClass?.id || '';
      else target = ''; // on_leave / withdrew / graduate — no target
      return { ...prev, [studentId]: { action, targetClassId: target } };
    });
  };

  const setTarget = (studentId: string, classId: string) => {
    setPerStudent(prev => ({
      ...prev,
      [studentId]: { ...(prev[studentId] || { action: 'promote' as PromoteAction, targetClassId: '' }), targetClassId: classId },
    }));
  };

  // Summary counts for the footer.
  const summary = useMemo(() => {
    const tally: Record<PromoteAction, number> = { promote: 0, retain: 0, on_leave: 0, withdrew: 0, graduate: 0 };
    for (const s of Object.values(perStudent)) tally[s.action]++;
    return tally;
  }, [perStudent]);

  const needsTarget = (a: PromoteAction) => a === 'promote' || a === 'retain';

  // Validation: every promote/retain must have a target class.
  const missingTargets = useMemo(
    () => Object.entries(perStudent).filter(([, s]) => needsTarget(s.action) && !s.targetClassId).length,
    [perStudent],
  );

  const onCommit = async () => {
    if (!preview || !sourceClassId) return;
    if (missingTargets > 0) {
      toast.error(t('admin.promote.missing_targets', { count: missingTargets, defaultValue: `${missingTargets} student(s) need a target class` }));
      return;
    }
    if (!confirm(t('admin.promote.confirm_commit', 'Commit year-end outcomes? This is the final action for this class.'))) return;

    setCommitting(true);
    try {
      const outcomes = preview.roster.map(row => {
        const s = perStudent[row.studentId];
        return {
          studentId: row.studentId,
          action: s.action,
          ...(needsTarget(s.action) ? { targetClassId: s.targetClassId } : {}),
        };
      });
      const r = await adminApi.commitPromoteClass(sourceClassId, {
        academicYear: preview.academicYear,
        nextAcademicYear: preview.nextAcademicYear,
        yearEndDate,
        outcomes,
      });
      const data = r.data as { processed: number; failed: number; results: Array<{ studentId: string; ok: boolean; error?: string }> };
      if (data.failed > 0) {
        toast.warn(t('admin.promote.partial_success', { processed: data.processed, failed: data.failed, defaultValue: `Processed ${data.processed}, ${data.failed} failed` }));
      } else {
        toast.success(t('admin.promote.success', { processed: data.processed, defaultValue: `Processed ${data.processed} students` }));
      }
      onCompleted?.();
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('admin.promote.failed_commit', 'Failed to commit outcomes'));
    } finally {
      setCommitting(false);
    }
  };

  const sourceClassName = preview?.sourceClass.name || '';
  const title = t('admin.promote.title', { className: sourceClassName, defaultValue: `Promote class — ${sourceClassName}` });

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="xl">
      {loading || !preview ? (
        <div className="flex justify-center py-12"><LoadingSpinner /></div>
      ) : (
        <div className="space-y-4">
          {/* Context header */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="p-3 bg-gray-50 rounded-xl">
              <p className="text-xs text-gray-500 uppercase tracking-wide">{t('admin.promote.closing_year', 'Closing academic year')}</p>
              <p className="font-medium text-gray-900 mt-0.5">{preview.academicYear}</p>
            </div>
            <div className="p-3 bg-primary-50 rounded-xl">
              <p className="text-xs text-primary-700 uppercase tracking-wide">{t('admin.promote.opening_year', 'Opening academic year')}</p>
              <p className="font-medium text-primary-900 mt-0.5">{preview.nextAcademicYear}</p>
            </div>
          </div>

          {!preview.nextClass && (
            <div className="flex gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm">
              <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <span className="text-amber-800">
                {t('admin.promote.no_next_class', 'No next class is configured for this class. Pick a target class for each promoted student manually.')}
              </span>
            </div>
          )}

          {/* Year-end date */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">{t('admin.promote.year_end_date', 'Year-end date (recorded as ended_on)')}</label>
            <input
              type="date"
              value={yearEndDate}
              onChange={e => setYearEndDate(e.target.value)}
              className="border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          {/* Roster */}
          {preview.roster.length === 0 ? (
            <div className="text-center py-12 text-gray-500 text-sm">
              {t('admin.promote.empty_roster', 'No enrolled students in this class for the closing year.')}
            </div>
          ) : (
            <div className="border border-gray-100 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">{t('admin.promote.col_student', 'Student')}</th>
                    <th className="text-left px-3 py-2 font-medium">{t('admin.promote.col_action', 'Action')}</th>
                    <th className="text-left px-3 py-2 font-medium">{t('admin.promote.col_target', 'Target class')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {preview.roster.map(row => {
                    const state = perStudent[row.studentId] || { action: 'promote' as PromoteAction, targetClassId: '' };
                    return (
                      <tr key={row.studentId} className="hover:bg-gray-50/60">
                        <td className="px-3 py-2">
                          <div className="font-medium text-gray-900">{row.studentName}</div>
                          <div className="text-xs text-gray-500">{row.gradeLevel}</div>
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={state.action}
                            onChange={e => setAction(row.studentId, e.target.value as PromoteAction)}
                            className="border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
                          >
                            <option value="promote">{t('admin.promote.action_promote', 'Promote')}</option>
                            <option value="retain">{t('admin.promote.action_retain', 'Retain')}</option>
                            <option value="on_leave">{t('admin.promote.action_on_leave', 'On leave')}</option>
                            <option value="withdrew">{t('admin.promote.action_withdrew', 'Withdrew')}</option>
                            <option value="graduate">{t('admin.promote.action_graduate', 'Graduate')}</option>
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          {needsTarget(state.action) ? (
                            <select
                              value={state.targetClassId}
                              onChange={e => setTarget(row.studentId, e.target.value)}
                              className={`border rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white ${
                                state.targetClassId ? 'border-gray-200' : 'border-amber-300'
                              }`}
                            >
                              <option value="">{t('admin.promote.pick_class', '— pick class —')}</option>
                              {allClasses.map(c => (
                                <option key={c.id} value={c.id}>{c.name}{c.gradeLevel ? ` · ${c.gradeLevel}` : ''}</option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Summary + commit */}
          {preview.roster.length > 0 && (
            <>
              <div className="flex flex-wrap gap-3 text-xs">
                <span className="px-2 py-1 bg-emerald-50 text-emerald-700 rounded-full">
                  {t('admin.promote.tally_promote', { count: summary.promote, defaultValue: `${summary.promote} promote` })}
                </span>
                <span className="px-2 py-1 bg-amber-50 text-amber-700 rounded-full">
                  {t('admin.promote.tally_retain', { count: summary.retain, defaultValue: `${summary.retain} retain` })}
                </span>
                <span className="px-2 py-1 bg-sky-50 text-sky-700 rounded-full">
                  {t('admin.promote.tally_on_leave', { count: summary.on_leave, defaultValue: `${summary.on_leave} on leave` })}
                </span>
                <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded-full">
                  {t('admin.promote.tally_withdrew', { count: summary.withdrew, defaultValue: `${summary.withdrew} withdrew` })}
                </span>
                <span className="px-2 py-1 bg-purple-50 text-purple-700 rounded-full">
                  {t('admin.promote.tally_graduate', { count: summary.graduate, defaultValue: `${summary.graduate} graduate` })}
                </span>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
                <Button variant="outline" onClick={onClose} disabled={committing}>
                  {t('common.cancel', 'Cancel')}
                </Button>
                <Button
                  onClick={onCommit}
                  loading={committing}
                  icon={<GraduationCap className="w-4 h-4" />}
                  disabled={missingTargets > 0}
                >
                  {t('admin.promote.commit', 'Commit year-end outcomes')}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
