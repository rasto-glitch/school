import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Save, Lock } from 'lucide-react';
import { teacherApi } from '../../services/api';
import { useTeacherProfile } from '../../hooks/useTeacherProfile';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Select from '../../components/common/Select';
import Button from '../../components/common/Button';
import type { Class, WeeklySummary } from '../../types';
import { format, parseISO } from 'date-fns';

interface Period {
  id: string;
  weekStartDate: string;
  weekEndDate: string;
  isOpen: boolean;
}

export default function WeeklySummaryPage() {
  const { t } = useTranslation();
  const { subjectsForClass } = useTeacherProfile();
  const [period, setPeriod] = useState<Period | null | undefined>(undefined); // undefined = loading
  const [classes, setClasses] = useState<Class[]>([]);
  const [selectedSubject, setSelectedSubject] = useState('');
  const [selectedClass, setSelectedClass] = useState('');
  const [rows, setRows] = useState<Record<string, Partial<WeeklySummary>>>({});
  const [loading, setLoading] = useState(false);

  const subjectOptions = subjectsForClass(selectedClass);

  useEffect(() => {
    teacherApi.getClasses().then(r => setClasses(r.data || []));
    teacherApi.getActivePeriod().then(r => setPeriod(r.data ?? null));
  }, []);

  // Keep the subject in sync with the selected class's curriculum.
  useEffect(() => {
    const opts = subjectsForClass(selectedClass);
    if (opts.length === 1) setSelectedSubject(opts[0].name);
    else setSelectedSubject(prev => (prev && opts.some(o => o.name === prev) ? prev : ''));
  }, [selectedClass, subjectsForClass]);

  // Load existing submission for the active period
  useEffect(() => {
    if (!selectedClass || !period?.weekStartDate || !selectedSubject) { setRows({}); return; }
    teacherApi.getWeeklySummary({ classId: selectedClass, weekStartDate: period.weekStartDate })
      .then(r => {
        const data: WeeklySummary[] = r.data || [];
        const existing = data.find(item => item.subject === selectedSubject);
        setRows({ [selectedSubject]: existing || { subject: selectedSubject } });
      });
  }, [selectedClass, period?.weekStartDate, selectedSubject]);

  const updateRow = (subject: string, field: string, value: string) => {
    setRows(prev => ({ ...prev, [subject]: { ...prev[subject], [field]: value } }));
  };

  const saveAll = async () => {
    if (!selectedClass) { toast.error(t('teacher.select_class_first')); return; }
    if (!selectedSubject) { toast.error(t('teacher.select_subject_first')); return; }
    setLoading(true);
    try {
      await teacherApi.upsertWeeklySummary({
        classId: selectedClass,
        subject: selectedSubject,
        ...rows[selectedSubject],
      });
      toast.success(t('teacher.summary_saved'));
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('teacher.save_summary_failed'));
    } finally {
      setLoading(false);
    }
  };

  const subjects = selectedSubject ? [selectedSubject] : [];

  return (
    <PageLayout title={t('teacher.weekly_summary')}>
      <div className="space-y-4">

        {/* Active period banner */}
        {period === undefined ? (
          <div className="h-12 flex items-center"><div className="w-4 h-4 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : period ? (
          <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
            <span className="w-2 h-2 bg-green-500 rounded-full flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-green-800">
                {t('teacher.active_period', { start: format(parseISO(period.weekStartDate), 'MMM d'), end: format(parseISO(period.weekEndDate), 'MMM d, yyyy') })}
              </p>
              <p className="text-xs text-green-600">{t('teacher.submit_below')}</p>
            </div>
            <Lock className="w-3.5 h-3.5 text-green-500 ml-auto" />
          </div>
        ) : (
          <div className="flex items-center gap-3 bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3">
            <span className="w-2 h-2 bg-yellow-400 rounded-full flex-shrink-0" />
            <p className="text-sm text-yellow-800 font-medium">{t('teacher.no_active_period')}</p>
          </div>
        )}

        {/* Controls */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="w-48">
            <Select
              label={t('common.class')}
              options={classes.map(c => ({ value: c.id, label: c.name }))}
              placeholder={t('teacher.select_class')}
              value={selectedClass}
              onChange={e => setSelectedClass(e.target.value)}
            />
          </div>
          <div className="flex-1 min-w-44">
            {selectedClass && subjectOptions.length === 0 ? (
              <>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('common.subject')}</label>
                <p className="text-sm text-amber-600">{t('teacher.no_subject_for_class')}</p>
              </>
            ) : (
              <Select
                label={t('common.subject')}
                options={subjectOptions.map(s => ({ value: s.name, label: s.name }))}
                placeholder={t('teacher.select_subject')}
                value={selectedSubject}
                onChange={e => setSelectedSubject(e.target.value)}
              />
            )}
          </div>
          <Button onClick={saveAll} loading={loading} disabled={!period} icon={<Save className="w-4 h-4" />}>
            {t('common.save')}
          </Button>
        </div>

        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {[t('common.subject'), t('teacher.unit'), t('teacher.lessons'), t('teacher.pages'), t('teacher.homework_reminder')].map(h => (
                  <th key={h} className="text-left px-4 py-3 font-semibold text-gray-700 first:rounded-tl-2xl last:rounded-tr-2xl">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {subjects.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-gray-500">{t('teacher.enter_subject_hint')}</td></tr>
              ) : subjects.map((subject, i) => (
                <tr key={subject} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                  <td className="px-4 py-2 font-medium text-gray-900 whitespace-nowrap">{subject}</td>
                  {(['unit', 'lesson', 'pages', 'homeworkReminder'] as const).map(field => (
                    <td key={field} className="px-4 py-2">
                      <input
                        className="w-full border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary-400 bg-white disabled:bg-gray-50 disabled:text-gray-400"
                        value={(rows[subject] as any)?.[field] || ''}
                        onChange={e => updateRow(subject, field, e.target.value)}
                        placeholder={period ? '—' : t('teacher.no_active_period_short')}
                        disabled={!period}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </PageLayout>
  );
}
