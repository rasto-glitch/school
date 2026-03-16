import { useEffect, useState } from 'react';
import { Clock, CheckCircle, XCircle } from 'lucide-react';
import { adminApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Select from '../../components/common/Select';
import Input from '../../components/common/Input';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';
import type { Class } from '../../types';
import { format, parseISO, startOfWeek } from 'date-fns';

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

export default function AdminWeeklySummaryPage() {
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [classFilter, setClassFilter] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');
  const [weekFilter, setWeekFilter] = useState(format(startOfWeek(new Date()), 'yyyy-MM-dd'));
  const [loading, setLoading] = useState(true);
  const [statusList, setStatusList] = useState<TeacherStatus[]>([]);

  useEffect(() => {
    adminApi.getClasses().then(r => setClasses(r.data || []));
    adminApi.getSubjects().then(r => {
      const subs: { name: string }[] = r.data || [];
      setSubjects(subs.map(s => s.name));
    });
  }, []);

  useEffect(() => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (classFilter) params.classId = classFilter;
    if (subjectFilter) params.subject = subjectFilter;
    if (weekFilter) params.weekStartDate = weekFilter;
    Promise.allSettled([
      adminApi.getWeeklySummaries(params),
      adminApi.getWeeklySummaryStatus(weekFilter),
    ]).then(([summariesResult, statusResult]) => {
      if (summariesResult.status === 'fulfilled') setSummaries(summariesResult.value.data || []);
      if (statusResult.status === 'fulfilled') setStatusList(statusResult.value.data || []);
    }).finally(() => setLoading(false));
  }, [classFilter, subjectFilter, weekFilter]);

  // Group summaries by class for display
  const byClass: Record<string, { className: string; rows: Summary[] }> = {};
  summaries.forEach(s => {
    const className = s.classes?.name || s.classId;
    if (!byClass[s.classId]) byClass[s.classId] = { className, rows: [] };
    byClass[s.classId].rows.push(s);
  });

  return (
    <PageLayout title="Weekly Summary" subtitle="All teacher weekly curriculum submissions">
      <div className="space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <div className="w-48">
            <Select
              label="Class / Grade"
              options={classes.map(c => ({ value: c.id, label: c.name }))}
              placeholder="All Classes"
              value={classFilter}
              onChange={e => setClassFilter(e.target.value)}
            />
          </div>
          <div className="w-44">
            <Select
              label="Subject"
              options={subjects.map(s => ({ value: s, label: s }))}
              placeholder="All Subjects"
              value={subjectFilter}
              onChange={e => setSubjectFilter(e.target.value)}
            />
          </div>
          <div className="w-44">
            <Input
              label="Week Starting"
              type="date"
              value={weekFilter}
              onChange={e => setWeekFilter(e.target.value)}
            />
          </div>
        </div>

        {/* Submission Status */}
        {statusList.length > 0 && (
          <Card className="p-0 overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Submission Status</h2>
              <span className="text-xs text-gray-500">
                {statusList.filter(t => t.submitted).length} / {statusList.length} submitted
              </span>
            </div>
            <div className="divide-y divide-gray-50">
              {statusList.map(t => (
                <div key={t.id} className="flex items-center justify-between px-4 py-2.5">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{t.fullName}</p>
                    {t.subject && <p className="text-xs text-gray-400">{t.subject}</p>}
                  </div>
                  {t.submitted
                    ? <span className="flex items-center gap-1 text-xs font-medium text-green-600"><CheckCircle className="w-4 h-4" /> Submitted</span>
                    : <span className="flex items-center gap-1 text-xs font-medium text-red-400"><XCircle className="w-4 h-4" /> Not submitted</span>
                  }
                </div>
              ))}
            </div>
          </Card>
        )}

        {loading ? <LoadingSpinner /> : summaries.length === 0 ? (
          <EmptyState
            title="No weekly summaries found"
            description="Teachers haven't submitted summaries for the selected filters yet."
            icon={<Clock className="w-8 h-8 text-gray-400" />}
          />
        ) : (
          <div className="space-y-6">
            {Object.entries(byClass).map(([classId, { className, rows }]) => (
              <Card key={classId} className="p-0 overflow-hidden">
                <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                  <h2 className="font-semibold text-gray-900">{className}</h2>
                  {weekFilter && (
                    <p className="text-xs text-gray-500">
                      Week of {format(parseISO(weekFilter), 'MMMM d, yyyy')}
                    </p>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        {['Subject', 'Unit', 'Lessons', 'Pages', 'Homework Reminder', 'Teacher'].map(h => (
                          <th key={h} className="text-left px-4 py-3 font-semibold text-gray-600 bg-white">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(row => (
                        <tr key={row.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                          <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">
                            <span className="px-2 py-0.5 bg-primary-50 text-primary-700 rounded-lg text-xs font-semibold">
                              {row.subject}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-700">{row.unit || <span className="text-gray-300">—</span>}</td>
                          <td className="px-4 py-3 text-gray-700">{row.lesson || <span className="text-gray-300">—</span>}</td>
                          <td className="px-4 py-3 text-gray-700">{row.pages || <span className="text-gray-300">—</span>}</td>
                          <td className="px-4 py-3 text-gray-700 max-w-xs">
                            {row.homeworkReminder || <span className="text-gray-300">—</span>}
                          </td>
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
