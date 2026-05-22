import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, CheckCircle, XCircle, PlayCircle, StopCircle } from 'lucide-react';
import { toast } from 'react-toastify';
import { supervisorApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Select from '../../components/common/Select';
import Input from '../../components/common/Input';
import Button from '../../components/common/Button';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';
import type { Class } from '../../types';
import { format, parseISO, startOfWeek } from 'date-fns';

interface Period {
  id: string;
  weekStartDate: string;
  weekEndDate: string;
  isOpen: boolean;
}

interface Summary {
  id: string;
  subject: string;
  unit?: string;
  lesson?: string;
  pages?: string;
  homeworkReminder?: string;
  weekStartDate?: string;
  classId: string;
  classes?: { name: string };
  teachers?: { fullName?: string; full_name?: string };
}

interface TeacherStatus {
  id: string;
  fullName: string;
  subject?: string;
  submitted: boolean;
}

export default function SupervisorWeeklySummaryPage() {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<Period | null | undefined>(undefined); // undefined = loading
  const [openStart, setOpenStart] = useState('');
  const [openEnd, setOpenEnd] = useState('');
  const [openingPeriod, setOpeningPeriod] = useState(false);
  const [closingPeriod, setClosingPeriod] = useState(false);

  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [classFilter, setClassFilter] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');
  const [weekFilter, setWeekFilter] = useState(format(startOfWeek(new Date()), 'yyyy-MM-dd'));
  const [loading, setLoading] = useState(true);
  const [statusList, setStatusList] = useState<TeacherStatus[]>([]);

  // Load active period + supporting data
  useEffect(() => {
    supervisorApi.getActivePeriod().then(r => setPeriod(r.data ?? null));
    supervisorApi.getClasses().then(r => setClasses(r.data || []));
    supervisorApi.getSubjects().then(r => {
      const subs: { name: string }[] = r.data || [];
      setSubjects(subs.map(s => s.name));
    });
  }, []);

  // When active period loads, lock the week filter to it
  useEffect(() => {
    if (period?.weekStartDate) setWeekFilter(period.weekStartDate);
  }, [period]);

  useEffect(() => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (classFilter) params.classId = classFilter;
    if (subjectFilter) params.subject = subjectFilter;
    if (weekFilter) params.weekStartDate = weekFilter;
    Promise.allSettled([
      supervisorApi.getWeeklySummaries(params),
      supervisorApi.getWeeklySummaryStatus(weekFilter),
    ]).then(([summariesResult, statusResult]) => {
      if (summariesResult.status === 'fulfilled') setSummaries(summariesResult.value.data || []);
      if (statusResult.status === 'fulfilled') setStatusList(statusResult.value.data || []);
    }).finally(() => setLoading(false));
  }, [classFilter, subjectFilter, weekFilter]);

  const handleOpenPeriod = async () => {
    if (!openStart || !openEnd) { toast.error(t('supervisor.select_dates')); return; }
    if (openEnd < openStart) { toast.error(t('supervisor.end_after_start')); return; }
    setOpeningPeriod(true);
    try {
      const res = await supervisorApi.openPeriod(openStart, openEnd);
      setPeriod(res.data);
      setOpenStart('');
      setOpenEnd('');
      toast.success(t('supervisor.period_opened'));
    } catch {
      toast.error(t('supervisor.open_period_failed'));
    } finally {
      setOpeningPeriod(false);
    }
  };

  const handleClosePeriod = async () => {
    if (!confirm(t('supervisor.close_confirm'))) return;
    setClosingPeriod(true);
    try {
      await supervisorApi.closePeriod();
      setPeriod(null);
      toast.success(t('supervisor.period_closed'));
    } catch {
      toast.error(t('supervisor.close_period_failed'));
    } finally {
      setClosingPeriod(false);
    }
  };

  const byClass: Record<string, { className: string; rows: Summary[] }> = {};
  summaries.forEach(s => {
    const className = s.classes?.name || s.classId;
    if (!byClass[s.classId]) byClass[s.classId] = { className, rows: [] };
    byClass[s.classId].rows.push(s);
  });

  return (
    <PageLayout title={t('supervisor.weekly_summary')} subtitle={t('supervisor.weekly_summary_subtitle')}>
      <div className="space-y-4">

        {/* ── Active Period Card ── */}
        <Card className="p-5">
          <h2 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
            <Clock className="w-4 h-4" /> {t('supervisor.submission_period')}
          </h2>
          {period === undefined ? (
            <div className="h-8 flex items-center"><div className="w-4 h-4 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" /></div>
          ) : period ? (
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-green-700 bg-green-50 px-2.5 py-1 rounded-full mb-2">
                  <span className="w-1.5 h-1.5 bg-green-500 rounded-full" /> {t('supervisor.open')}
                </span>
                <p className="text-sm text-gray-800 font-medium">
                  {format(parseISO(period.weekStartDate), 'MMM d')} — {format(parseISO(period.weekEndDate), 'MMM d, yyyy')}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">{t('supervisor.teachers_can_submit')}</p>
              </div>
              <button
                onClick={handleClosePeriod}
                disabled={closingPeriod}
                className="flex items-center gap-1.5 text-sm font-semibold text-red-600 border border-red-200 hover:bg-red-50 px-3 py-2 rounded-xl transition-colors disabled:opacity-50"
              >
                <StopCircle className="w-4 h-4" /> {t('supervisor.close_period')}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-gray-500">{t('supervisor.no_period_open')}</p>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">{t('supervisor.week_start')}</label>
                  <input
                    type="date"
                    value={openStart}
                    onChange={e => setOpenStart(e.target.value)}
                    className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">{t('supervisor.week_end')}</label>
                  <input
                    type="date"
                    value={openEnd}
                    onChange={e => setOpenEnd(e.target.value)}
                    className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <Button onClick={handleOpenPeriod} loading={openingPeriod} icon={<PlayCircle className="w-4 h-4" />}>
                  {t('supervisor.open_period')}
                </Button>
              </div>
            </div>
          )}
        </Card>

        {/* ── Filters ── */}
        <div className="flex flex-wrap gap-3">
          <div className="w-48">
            <Select label={t('supervisor.class_grade')} options={classes.map(c => ({ value: c.id, label: c.name }))} placeholder={t('common.all_classes')} value={classFilter} onChange={e => setClassFilter(e.target.value)} />
          </div>
          <div className="w-44">
            <Select label={t('common.subject')} options={subjects.map(s => ({ value: s, label: s }))} placeholder={t('common.all_subjects')} value={subjectFilter} onChange={e => setSubjectFilter(e.target.value)} />
          </div>
          <div className="w-44">
            <Input label={t('supervisor.week_starting')} type="date" value={weekFilter} onChange={e => setWeekFilter(e.target.value)} />
          </div>
        </div>

        {/* ── Submission Status ── */}
        {statusList.length > 0 && (
          <Card className="p-0 overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">{t('supervisor.submission_status')}</h2>
              <span className="text-xs text-gray-500">
                {t('supervisor.submitted_count', { done: statusList.filter(s => s.submitted).length, total: statusList.length })}
              </span>
            </div>
            <div className="divide-y divide-gray-50">
              {statusList.map(st => (
                <div key={st.id} className="flex items-center justify-between px-4 py-2.5">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{st.fullName}</p>
                    {st.subject && <p className="text-xs text-gray-400">{st.subject}</p>}
                  </div>
                  {st.submitted
                    ? <span className="flex items-center gap-1 text-xs font-medium text-green-600"><CheckCircle className="w-4 h-4" /> {t('supervisor.submitted')}</span>
                    : <span className="flex items-center gap-1 text-xs font-medium text-red-400"><XCircle className="w-4 h-4" /> {t('supervisor.not_submitted')}</span>
                  }
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* ── Summaries Table ── */}
        {loading ? <LoadingSpinner /> : summaries.length === 0 ? (
          <EmptyState
            title={t('supervisor.no_summaries')}
            description={t('supervisor.no_summaries_desc')}
            icon={<Clock className="w-8 h-8 text-gray-400" />}
          />
        ) : (
          <div className="space-y-6">
            {Object.entries(byClass).map(([classId, { className, rows }]) => (
              <Card key={classId} className="p-0 overflow-hidden">
                <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                  <h2 className="font-semibold text-gray-900">{className}</h2>
                  {weekFilter && (
                    <p className="text-xs text-gray-500">{t('supervisor.week_of', { date: format(parseISO(weekFilter), 'MMMM d, yyyy') })}</p>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        {[t('common.subject'), t('teacher.unit'), t('teacher.lessons'), t('teacher.pages'), t('teacher.homework_reminder'), t('supervisor.teacher_col')].map(h => (
                          <th key={h} className="text-left px-4 py-3 font-semibold text-gray-600 bg-white">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(row => (
                        <tr key={row.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                          <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">
                            <span className="px-2 py-0.5 bg-primary-50 text-primary-700 rounded-lg text-xs font-semibold">{row.subject}</span>
                          </td>
                          <td className="px-4 py-3 text-gray-700">{row.unit || <span className="text-gray-300">—</span>}</td>
                          <td className="px-4 py-3 text-gray-700">{row.lesson || <span className="text-gray-300">—</span>}</td>
                          <td className="px-4 py-3 text-gray-700">{row.pages || <span className="text-gray-300">—</span>}</td>
                          <td className="px-4 py-3 text-gray-700 max-w-xs">{row.homeworkReminder || <span className="text-gray-300">—</span>}</td>
                          <td className="px-4 py-3 text-xs text-gray-500">
                            {(row.teachers as any)?.fullName || (row.teachers as any)?.full_name || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </PageLayout>
  );
}
