import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ClipboardList, Calendar } from 'lucide-react';
import { parentApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Select from '../../components/common/Select';
import Badge from '../../components/common/Badge';
import EmptyState from '../../components/common/EmptyState';
import ErrorMessage from '../../components/common/ErrorMessage';
import { CardListSkeleton } from '../../components/common/Skeleton';
import type { Assignment, Student } from '../../types';
import { format, parseISO } from 'date-fns';

const statusColors: Record<string, 'gray' | 'yellow' | 'green'> = {
  pending: 'yellow',
  submitted: 'gray',
  graded: 'green',
};

export default function AssignmentsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [children, setChildren] = useState<Student[]>([]);
  const [selectedChild, setSelectedChild] = useState('');
  const [selectedSubject, setSelectedSubject] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const subjects = [...new Set(assignments.map(a => a.subject).filter(Boolean))] as string[];

  useEffect(() => { parentApi.getChildren().then(r => setChildren(r.data || [])); }, []);

  useEffect(() => {
    setLoading(true);
    setError(false);
    const params: Record<string, string> = {};
    if (selectedChild) params.studentId = selectedChild;
    if (selectedSubject) params.subject = selectedSubject;
    parentApi.getAssignments(params)
      .then(r => setAssignments(r.data || []))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [selectedChild, selectedSubject, retryKey]);

  return (
    <PageLayout title={t('assignments.title')} subtitle={t('assignments.subtitle')}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-36">
            <Select options={children.map(c => ({ value: c.id, label: c.fullName }))} placeholder="All Children" value={selectedChild} onChange={e => setSelectedChild(e.target.value)} />
          </div>
          <div className="flex-1 min-w-36">
            <Select options={subjects.map(s => ({ value: s, label: s }))} placeholder="All Subjects" value={selectedSubject} onChange={e => setSelectedSubject(e.target.value)} />
          </div>
        </div>

        {loading ? <CardListSkeleton count={4} /> : error ? (
          <ErrorMessage onRetry={() => setRetryKey(k => k + 1)} />
        ) : assignments.length === 0 ? (
          <EmptyState title={t('assignments.no_assignments')} icon={<ClipboardList className="w-8 h-8 text-gray-400" />} />
        ) : (
          <div className="grid gap-4">
            {assignments.map((a) => (
              <Card key={a.id} hover onClick={() => navigate(`/parent/assignments/${a.id}`)}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="p-2 bg-green-50 rounded-lg flex-shrink-0">
                      <ClipboardList className="w-5 h-5 text-green-600" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-gray-900">{a.title}</h3>
                        {a.subject && <Badge color="secondary">{a.subject}</Badge>}
                        <Badge color={statusColors[a.submissionStatus] || 'gray'}>{a.submissionStatus}</Badge>
                      </div>
                      <p className="text-sm text-gray-500 mt-1">{a.description}</p>
                      {a.students && <p className="text-xs text-gray-400 mt-1">Student: {a.students.fullName}</p>}
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right space-y-1">
                    {a.grade !== undefined && a.grade !== null && (
                      <div className="text-lg font-bold text-primary-600">{a.grade}</div>
                    )}
                    {a.dueDate && (
                      <div className="flex items-center gap-1 text-xs text-gray-500">
                        <Calendar className="w-3 h-3" />
                        {format(parseISO(a.dueDate), 'MMM d')}
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </PageLayout>
  );
}
