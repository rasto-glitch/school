import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { HeartHandshake } from 'lucide-react';
import { adminApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Select from '../../components/common/Select';
import EmptyState from '../../components/common/EmptyState';
import { displayPercent } from '../../utils/marks';
import type { Class } from '../../types';

// Credit marks (نمرەی هاوکاری) — CREDIT_MARKS_PLAN.md P3. Per-class review of
// failing round values with inline credit allocation: one pool per student
// per round, each grant capped at the pass mark, all audited server-side.

interface OverviewSubject {
  subject: string;
  roundOne: number | null;
  roundOneCredit: number;
  roundOneEffective: number | null;
  final: number | null;
  satRemedial: boolean;
  finalCredit: number;
  finalEffective: number | null;
}
interface OverviewStudent {
  studentId: string;
  fullName: string;
  subjects: OverviewSubject[];
  remaining: { round1: number; round2: number };
}
interface Overview {
  pool: number;
  passPercent: number;
  academicYear: string;
  students: OverviewStudent[];
}

export default function CreditsPage() {
  const { t } = useTranslation();
  const [classes, setClasses] = useState<Class[]>([]);
  const [selectedClass, setSelectedClass] = useState('');
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  // Draft credit inputs keyed `${studentId}|${round}|${subject}`.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    adminApi.getClasses().then(r => setClasses(r.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedClass) { setData(null); setError(''); return; }
    setLoading(true);
    setError('');
    adminApi.getCreditsOverview(selectedClass, '')
      .then(r => { setData(r.data); setDrafts({}); })
      .catch((err: any) => setError(err.response?.data?.error || t('admin.credits.load_failed', 'Could not load the credit overview.')))
      .finally(() => setLoading(false));
  }, [selectedClass, reloadKey, t]);

  const save = async (studentId: string, round: 'round1' | 'round2', subject: string, current: number) => {
    if (!data) return;
    const key = `${studentId}|${round}|${subject}`;
    const raw = drafts[key];
    if (raw === undefined) return;               // untouched
    const amount = raw.trim() === '' ? 0 : Number(raw);
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error(t('admin.credits.err_amount', 'Credit must be a non-negative number.'));
      return;
    }
    if (amount === current) return;              // no change
    setSavingKey(key);
    try {
      await adminApi.setCreditAllocation({
        studentId, academicYear: data.academicYear, round, subject, amount,
      });
      toast.success(amount === 0
        ? t('admin.credits.removed', 'Credit removed.')
        : t('admin.credits.saved', { amount, subject, defaultValue: `+${amount} credited to ${subject}.` }));
      setReloadKey(k => k + 1);
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('admin.credits.save_failed', 'Could not save the credit.'));
    } finally {
      setSavingKey(null);
    }
  };

  const fmt = (v: number | null) => (v == null ? '—' : String(displayPercent(v)));

  const cellValue = (raw: number | null, credit: number, effective: number | null, pass: number) => {
    if (raw == null) return <span className="text-gray-300">—</span>;
    const eff = effective ?? raw;
    return (
      <span className={`font-semibold ${eff < pass ? 'text-red-600' : 'text-emerald-700'}`}>
        {fmt(eff)}
        {credit > 0 && <span className="text-violet-600 font-normal"> ({fmt(raw)}+{credit})</span>}
      </span>
    );
  };

  // Only students with something to decide: a failing round value or an
  // existing credit to review.
  const relevant = (data?.students || [])
    .map(s => ({
      ...s,
      subjects: s.subjects.filter(x =>
        (x.roundOne != null && ((x.roundOneEffective ?? x.roundOne) < (data?.passPercent ?? 50) || x.roundOneCredit > 0))
        || (x.satRemedial && x.final != null && ((x.finalEffective ?? x.final) < (data?.passPercent ?? 50) || x.finalCredit > 0))),
    }))
    .filter(s => s.subjects.length > 0);

  return (
    <PageLayout
      title={t('admin.credits.title', 'Support marks (نمرەی هاوکاری)')}
      subtitle={t('admin.credits.subtitle', 'Allocate per-round credit marks to failing subjects — capped at the pass mark, drawn from each student’s pool.')}
    >
      <div className="space-y-4">
        <div className="w-full sm:w-64">
          <Select
            label={t('common.class')}
            options={classes.map(c => ({ value: c.id, label: c.name }))}
            placeholder={t('admin.credits.pick_class', 'Pick a class')}
            value={selectedClass}
            onChange={e => setSelectedClass(e.target.value)}
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {loading && <p className="text-sm text-gray-500">{t('common.loading', 'Loading…')}</p>}

        {data && data.pool <= 0 && (
          <Card>
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
              {t('admin.credits.feature_off', 'Credit marks are off for this school. Set the per-round pool in Settings → Grading first.')}
            </p>
          </Card>
        )}

        {data && data.pool > 0 && (
          <p className="text-sm text-gray-600">
            {t('admin.credits.meta', {
              pool: data.pool, pass: data.passPercent, year: data.academicYear,
              defaultValue: `Pool: ${data.pool} per round per student · pass mark ${data.passPercent} · ${data.academicYear}`,
            })}
          </p>
        )}

        {data && data.pool > 0 && relevant.length === 0 && (
          <EmptyState
            title={t('admin.credits.none_title', 'Nothing to review')}
            description={t('admin.credits.none_desc', 'No failing round values in this class — no credits needed.')}
            icon={<HeartHandshake className="w-8 h-8 text-gray-400" />}
          />
        )}

        {data && data.pool > 0 && relevant.map(s => (
          <Card key={s.studentId} className="p-0 overflow-hidden">
            <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-gray-900">{s.fullName}</span>
              <span className="text-xs text-gray-500">
                {t('admin.credits.remaining', {
                  r1: s.remaining.round1, r2: s.remaining.round2,
                  defaultValue: `Remaining — Round One: ${s.remaining.round1} · Round Two: ${s.remaining.round2}`,
                })}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 border-b border-gray-100">
                    <th className="text-left px-4 py-2 font-medium">{t('grades.subject', 'Subject')}</th>
                    <th className="text-center px-2 py-2 font-medium">{t('admin.credits.round_one', 'Round One (خولی یەکەم)')}</th>
                    <th className="text-center px-2 py-2 font-medium">{t('admin.credits.credit', 'Credit')}</th>
                    <th className="text-center px-2 py-2 font-medium">{t('admin.credits.round_two', 'Round Two (خولی دووەم)')}</th>
                    <th className="text-center px-2 py-2 font-medium">{t('admin.credits.credit', 'Credit')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {s.subjects.map(x => {
                    const k1 = `${s.studentId}|round1|${x.subject}`;
                    const k2 = `${s.studentId}|round2|${x.subject}`;
                    return (
                      <tr key={x.subject}>
                        <td className="px-4 py-2 font-medium text-gray-800">{x.subject}</td>
                        <td className="px-2 py-2 text-center">{cellValue(x.roundOne, x.roundOneCredit, x.roundOneEffective, data.passPercent)}</td>
                        <td className="px-2 py-2 text-center">
                          <input
                            type="number" min="0" step="0.5"
                            className="input-field !py-1 w-20 text-center text-sm"
                            value={drafts[k1] ?? String(x.roundOneCredit || '')}
                            placeholder="0"
                            disabled={savingKey === k1 || x.roundOne == null}
                            onChange={e => setDrafts(prev => ({ ...prev, [k1]: e.target.value }))}
                            onBlur={() => save(s.studentId, 'round1', x.subject, x.roundOneCredit)}
                          />
                        </td>
                        <td className="px-2 py-2 text-center">
                          {x.satRemedial ? cellValue(x.final, x.finalCredit, x.finalEffective, data.passPercent) : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-2 py-2 text-center">
                          {x.satRemedial ? (
                            <input
                              type="number" min="0" step="0.5"
                              className="input-field !py-1 w-20 text-center text-sm"
                              value={drafts[k2] ?? String(x.finalCredit || '')}
                              placeholder="0"
                              disabled={savingKey === k2}
                              onChange={e => setDrafts(prev => ({ ...prev, [k2]: e.target.value }))}
                              onBlur={() => save(s.studentId, 'round2', x.subject, x.finalCredit)}
                            />
                          ) : <span className="text-gray-300">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        ))}
      </div>
    </PageLayout>
  );
}
