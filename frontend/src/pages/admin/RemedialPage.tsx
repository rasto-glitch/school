import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Repeat, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { adminApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Select from '../../components/common/Select';
import Button from '../../components/common/Button';
import EmptyState from '../../components/common/EmptyState';
import { displayPercent } from '../../utils/marks';
import type { Class } from '../../types';

// One Round Two entry from /admin/remedial-overview (REMEDIAL_TERM_PLAN.md P4).
interface RemedialRow {
  id: string;
  studentId: string;
  studentName: string;
  subject: string;
  forPeriod: string;
  roundOne: number | null;
  // Credit marks (079): support credit per round + the effective values the
  // retake decision / official standing use.
  roundOneCredit: number;
  roundOneEffective: number | null;
  final: number | null;
  finalCredit: number;
  finalEffective: number | null;
  carryName: string | null;
  carryValue: number;
  carryMissing: boolean;
  examValue: number | null;
  isReleased: boolean;
}

export default function RemedialPage() {
  const { t } = useTranslation();
  const [classes, setClasses] = useState<Class[]>([]);
  const [selectedClass, setSelectedClass] = useState('');
  const [rows, setRows] = useState<RemedialRow[]>([]);
  const [meta, setMeta] = useState<{ termName: string; examMax: number; passPercent: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [releasing, setReleasing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    adminApi.getClasses().then(r => setClasses(r.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedClass) { setRows([]); setMeta(null); setError(''); return; }
    setLoading(true);
    setError('');
    setChecked(new Set());
    adminApi.getRemedialOverview(selectedClass)
      .then(r => {
        setRows(r.data?.entries || []);
        setMeta({
          termName: r.data?.termName || '',
          examMax: Number(r.data?.examMax) || 0,
          passPercent: Number(r.data?.passPercent) || 50,
        });
      })
      .catch((err: any) => setError(err.response?.data?.error || t('admin.remedial.load_failed')))
      .finally(() => setLoading(false));
  }, [selectedClass, reloadKey, t]);

  const releasable = rows.filter(r => r.examValue != null && !r.isReleased);

  const toggle = (id: string) =>
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const release = async (ids: string[]) => {
    if (ids.length === 0) return;
    setReleasing(true);
    try {
      const r = await adminApi.releaseRemedialGrades(ids);
      toast.success(t('admin.remedial.released_toast', { count: r.data?.released ?? ids.length }));
      setReloadKey(k => k + 1);
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('admin.remedial.release_failed'));
    } finally {
      setReleasing(false);
    }
  };

  // Shows the EFFECTIVE value (after any support credit) and annotates the
  // credit — "50 (47+3)" — so the reviewer sees why a subject counts as
  // passing (credit marks, 079). Display floors to 1 dp (strict banding).
  const passBadge = (value: number | null, credit = 0, effective: number | null = null) => {
    if (value == null || !meta) return <span className="text-gray-300">—</span>;
    const eff = effective ?? value;
    const failing = eff < meta.passPercent;
    return (
      <span className={`text-sm font-semibold ${failing ? 'text-red-600' : 'text-gray-800'}`}>
        {displayPercent(eff)}
        {credit > 0 && <span className="text-violet-600 font-normal"> ({displayPercent(value)}+{credit})</span>}
      </span>
    );
  };

  return (
    <PageLayout title={t('admin.remedial.title')} subtitle={t('admin.remedial.subtitle')}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="w-full sm:w-64">
            <Select
              label={t('common.class')}
              options={classes.map(c => ({ value: c.id, label: c.name }))}
              placeholder={t('admin.remedial.pick_class')}
              value={selectedClass}
              onChange={e => setSelectedClass(e.target.value)}
            />
          </div>
          {releasable.length > 0 && (
            <div className="flex gap-2">
              <Button
                onClick={() => release([...checked].filter(id => releasable.some(r => r.id === id)))}
                loading={releasing}
                disabled={checked.size === 0}
              >
                {t('admin.remedial.release_selected', { count: [...checked].filter(id => releasable.some(r => r.id === id)).length })}
              </Button>
              <Button onClick={() => release(releasable.map(r => r.id))} loading={releasing} variant="secondary">
                {t('admin.remedial.release_all', { count: releasable.length })}
              </Button>
            </div>
          )}
        </div>

        {!selectedClass ? (
          <EmptyState title={t('admin.remedial.pick_class')} icon={<Repeat className="w-8 h-8 text-gray-400" />} />
        ) : loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <div key={i} className="h-12 bg-gray-100 rounded-xl animate-pulse" />)}
          </div>
        ) : error ? (
          <Card><p className="text-sm text-amber-700">{error}</p></Card>
        ) : rows.length === 0 ? (
          <EmptyState title={t('admin.remedial.empty')} icon={<CheckCircle2 className="w-8 h-8 text-gray-400" />} />
        ) : (
          <Card className="p-0 overflow-hidden">
            {meta && (
              <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 text-sm text-gray-600">
                {t('admin.remedial.meta', { term: meta.termName, max: meta.examMax, pass: meta.passPercent })}
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-white text-xs text-gray-500">
                    <th className="px-3 py-2 w-8" />
                    <th className="text-left px-3 py-2 font-medium">{t('common.student')}</th>
                    <th className="text-left px-3 py-2 font-medium">{t('common.subject')}</th>
                    <th className="text-left px-3 py-2 font-medium">{t('admin.remedial.col_retake_for')}</th>
                    <th className="text-center px-3 py-2 font-medium">{t('grades.round_one')}</th>
                    <th className="text-center px-3 py-2 font-medium">{t('admin.remedial.col_carry')}</th>
                    <th className="text-center px-3 py-2 font-medium">{t('admin.remedial.col_exam')}</th>
                    <th className="text-center px-3 py-2 font-medium">{t('grades.round_two')}</th>
                    <th className="text-center px-3 py-2 font-medium">{t('admin.remedial.col_status')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {rows.map(r => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2.5 text-center">
                        {r.examValue != null && !r.isReleased && (
                          <input
                            type="checkbox"
                            checked={checked.has(r.id)}
                            onChange={() => toggle(r.id)}
                            className="rounded border-gray-300"
                          />
                        )}
                      </td>
                      <td className="px-3 py-2.5 font-medium text-gray-800">{r.studentName}</td>
                      <td className="px-3 py-2.5 text-gray-700">{r.subject}</td>
                      <td className="px-3 py-2.5 text-gray-700">{r.forPeriod}</td>
                      <td className="px-3 py-2.5 text-center">{passBadge(r.roundOne, r.roundOneCredit, r.roundOneEffective)}</td>
                      <td className="px-3 py-2.5 text-center text-gray-700">
                        {r.carryName ? (
                          r.carryMissing ? (
                            <span className="inline-flex items-center gap-1 text-amber-600 text-xs">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              {t('admin.remedial.carry_missing')}
                            </span>
                          ) : `${r.carryValue}`
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-center text-gray-800">
                        {r.examValue != null ? r.examValue : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-center">{passBadge(r.final, r.finalCredit, r.finalEffective)}</td>
                      <td className="px-3 py-2.5 text-center">
                        {r.examValue == null ? (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                            {t('admin.remedial.status_pending_exam')}
                          </span>
                        ) : r.isReleased ? (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                            {t('admin.remedial.status_released')}
                          </span>
                        ) : (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">
                            {t('admin.remedial.status_awaiting_release')}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </PageLayout>
  );
}
