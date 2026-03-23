import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { BarChart2 } from 'lucide-react';
import { parentApi } from '../../services/api';
import { useNotificationStore } from '../../store/notificationStore';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Select from '../../components/common/Select';
import EmptyState from '../../components/common/EmptyState';
import ErrorMessage from '../../components/common/ErrorMessage';
import { CardListSkeleton } from '../../components/common/Skeleton';
import type { Report, Student } from '../../types';
import { format, parseISO } from 'date-fns';

export default function ReportsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setUnreadCount = useNotificationStore(s => s.setUnreadCount);
  const [reports, setReports] = useState<Report[]>([]);
  const [children, setChildren] = useState<Student[]>([]);
  const [selectedChild, setSelectedChild] = useState('');
  const [selectedSubject, setSelectedSubject] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const subjects = [...new Set(reports.map(r => r.subject).filter(Boolean))];

  useEffect(() => { parentApi.getChildren().then(r => setChildren(r.data || [])); }, []);

  useEffect(() => {
    setLoading(true);
    setError(false);
    const params: Record<string, string> = {};
    if (selectedChild) params.studentId = selectedChild;
    if (selectedSubject) params.subject = selectedSubject;
    parentApi.getReports(params)
      .then(r => setReports(r.data || []))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
    parentApi.markTypeRead('report')
      .then(() => parentApi.getUnreadCount().then(r => setUnreadCount(r.data?.count ?? 0)))
      .catch(() => {});
  }, [selectedChild, selectedSubject, retryKey]);

  return (
    <PageLayout title={t('reports.title')} subtitle={t('reports.subtitle')}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-36">
            <Select options={children.map(c => ({ value: c.id, label: c.fullName }))} placeholder="All Children" value={selectedChild} onChange={e => setSelectedChild(e.target.value)} />
          </div>
          <div className="flex-1 min-w-36">
            <Select options={subjects.map(s => ({ value: s, label: s }))} placeholder="All Subjects" value={selectedSubject} onChange={e => setSelectedSubject(e.target.value)} />
          </div>
        </div>

        {loading ? <CardListSkeleton count={3} /> : error ? (
          <ErrorMessage onRetry={() => setRetryKey(k => k + 1)} />
        ) : reports.length === 0 ? (
          <EmptyState title={t('reports.no_reports')} icon={<BarChart2 className="w-8 h-8 text-gray-400" />} />
        ) : (
          <div className="grid gap-4">
            {reports.map((r) => (
              <Card key={r.id} hover onClick={() => navigate(`/parent/reports/${r.id}`)}>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-gray-900">{r.subject}</h3>
                    {r.students && <p className="text-xs text-gray-500">{r.students.fullName}</p>}
                  </div>
                  {r.reportDate && (
                    <span className="text-xs text-gray-400">{format(parseISO(r.reportDate), 'MMM d, yyyy')}</span>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                  {r.quizMarks !== undefined && (
                    <div className="bg-blue-50 rounded-xl p-3 text-center">
                      <div className="text-lg font-bold text-blue-600">{r.quizMarks}</div>
                      <div className="text-xs text-gray-500">Quiz</div>
                    </div>
                  )}
                  {r.examMarks !== undefined && (
                    <div className="bg-green-50 rounded-xl p-3 text-center">
                      <div className="text-lg font-bold text-green-600">{r.examMarks}</div>
                      <div className="text-xs text-gray-500">Exam</div>
                    </div>
                  )}
                </div>
                {r.attendanceNotes && (
                  <div className="mb-2">
                    <span className="text-xs font-semibold text-gray-500 uppercase">Attendance: </span>
                    <span className="text-sm text-gray-700">{r.attendanceNotes}</span>
                  </div>
                )}
                {r.behaviorNotes && (
                  <div className="mb-2">
                    <span className="text-xs font-semibold text-gray-500 uppercase">Behavior: </span>
                    <span className="text-sm text-gray-700">{r.behaviorNotes}</span>
                  </div>
                )}
                {r.teacherNotes && (
                  <div className="bg-gray-50 rounded-xl p-3 mt-2">
                    <span className="text-xs font-semibold text-gray-500 uppercase block mb-1">Teacher Notes</span>
                    <p className="text-sm text-gray-700">{r.teacherNotes}</p>
                  </div>
                )}
                {r.teachers && <p className="text-xs text-gray-400 mt-2">By {r.teachers.fullName}</p>}
              </Card>
            ))}
          </div>
        )}
      </div>
    </PageLayout>
  );
}
