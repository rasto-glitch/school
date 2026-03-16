import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BookOpen, Paperclip, Calendar } from 'lucide-react';
import { parentApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Select from '../../components/common/Select';
import Badge from '../../components/common/Badge';
import EmptyState from '../../components/common/EmptyState';
import ErrorMessage from '../../components/common/ErrorMessage';
import { CardListSkeleton } from '../../components/common/Skeleton';
import type { Homework, Student } from '../../types';
import { format, isPast, parseISO } from 'date-fns';

export default function HomeworkPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [homework, setHomework] = useState<Homework[]>([]);
  const [children, setChildren] = useState<Student[]>([]);
  const [selectedChild, setSelectedChild] = useState('');
  const [selectedSubject, setSelectedSubject] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const subjects = [...new Set(homework.map(h => h.subject).filter(Boolean))] as string[];

  useEffect(() => {
    parentApi.getChildren().then(r => setChildren(r.data || []));
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(false);
    const params: Record<string, string> = {};
    if (selectedChild) params.studentId = selectedChild;
    if (selectedSubject) params.subject = selectedSubject;
    parentApi.getHomework(params)
      .then(r => setHomework(r.data || []))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [selectedChild, selectedSubject, retryKey]);

  const isOverdue = (dueDate?: string) => dueDate ? isPast(parseISO(dueDate)) : false;

  return (
    <PageLayout title={t('homework.title')} subtitle={t('homework.subtitle')}>
      <div className="space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-36">
            <Select
              options={children.map(c => ({ value: c.id, label: c.fullName }))}
              placeholder="All Children"
              value={selectedChild}
              onChange={e => setSelectedChild(e.target.value)}
            />
          </div>
          <div className="flex-1 min-w-36">
            <Select
              options={subjects.map(s => ({ value: s, label: s }))}
              placeholder="All Subjects"
              value={selectedSubject}
              onChange={e => setSelectedSubject(e.target.value)}
            />
          </div>
        </div>

        {loading ? <CardListSkeleton count={4} /> : error ? (
          <ErrorMessage onRetry={() => setRetryKey(k => k + 1)} />
        ) : homework.length === 0 ? (
          <EmptyState title={t('homework.no_homework')} icon={<BookOpen className="w-8 h-8 text-gray-400" />} />
        ) : (
          <div className="grid gap-4">
            {homework.map((hw) => (
              <Card key={hw.id} hover onClick={() => navigate(`/parent/homework/${hw.id}`)}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="p-2 bg-primary-50 rounded-lg flex-shrink-0">
                      <BookOpen className="w-5 h-5 text-primary-600" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-gray-900">{hw.title}</h3>
                        {hw.subject && <Badge color="primary">{hw.subject}</Badge>}
                      </div>
                      <p className="text-sm text-gray-500 mt-1 line-clamp-2">{hw.description}</p>
                      {hw.attachmentUrl && (
                        <a href={hw.attachmentUrl} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 mt-2 text-xs text-secondary-600 hover:text-secondary-700 font-medium">
                          <Paperclip className="w-3 h-3" /> Download attachment
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <div className="flex items-center gap-1 text-xs text-gray-500">
                      <Calendar className="w-3 h-3" />
                      {hw.dueDate ? (
                        <span className={isOverdue(hw.dueDate) ? 'text-red-500 font-medium' : ''}>
                          {format(parseISO(hw.dueDate), 'MMM d, yyyy')}
                        </span>
                      ) : 'No due date'}
                    </div>
                    {isOverdue(hw.dueDate) && <Badge color="red">Overdue</Badge>}
                    <p className="text-xs text-gray-400 mt-1">{hw.classes?.name}</p>
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
