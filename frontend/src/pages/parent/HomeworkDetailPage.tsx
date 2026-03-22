import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { BookOpen, Paperclip, Calendar, ArrowLeft } from 'lucide-react';
import { parentApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Badge from '../../components/common/Badge';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import Button from '../../components/common/Button';
import type { Homework } from '../../types';
import { format, parseISO, isPast } from 'date-fns';

export default function HomeworkDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [homework, setHomework] = useState<Homework | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    parentApi.getHomeworkById(id).then(r => setHomework(r.data || null)).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <PageLayout title="Homework"><LoadingSpinner /></PageLayout>;
  if (!homework) return <PageLayout title="Homework"><p className="text-gray-500">Homework not found.</p></PageLayout>;

  const overdue = homework.dueDate ? isPast(parseISO(homework.dueDate)) : false;

  return (
    <PageLayout title="Homework Details">
      <div className="max-w-2xl space-y-4">
        <Button variant="ghost" size="sm" icon={<ArrowLeft className="w-4 h-4" />} onClick={() => navigate('/parent/homework')}>Back</Button>
        <Card>
          <div className="flex items-start gap-3 mb-4">
            <div className="p-3 bg-blue-50 rounded-xl flex-shrink-0">
              <BookOpen className="w-6 h-6 text-blue-600" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold text-gray-900">{homework.title}</h1>
              <div className="flex flex-wrap items-center gap-2 mt-1">
                {homework.subject && <Badge color="primary">{homework.subject}</Badge>}
                {homework.classes?.name && <Badge color="secondary">{homework.classes.name}</Badge>}
                {overdue && <Badge color="red">Overdue</Badge>}
              </div>
            </div>
          </div>

          {homework.dueDate && (
            <div className="flex items-center gap-2 text-sm text-gray-600 mb-4 p-3 bg-gray-50 rounded-xl">
              <Calendar className="w-4 h-4 text-gray-400" />
              <span>Due: <span className={`font-semibold ${overdue ? 'text-red-500' : 'text-gray-900'}`}>{format(parseISO(homework.dueDate), 'EEEE, MMMM d, yyyy')}</span></span>
            </div>
          )}

          {homework.description && (
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Description</h2>
              <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">{homework.description}</p>
            </div>
          )}

          {homework.attachmentUrl && (() => {
            const ext = homework.attachmentUrl.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
            const isImage = ['jpg','jpeg','png','gif','webp'].includes(ext);
            const isPdf = ext === 'pdf';
            return (
              <div>
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Attachment</h2>
                {isImage ? (
                  <div className="space-y-2">
                    <img src={homework.attachmentUrl} alt="Attachment" className="w-full max-h-72 object-contain rounded-xl border border-gray-200 bg-gray-50" />
                    <a href={homework.attachmentUrl} download target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2 bg-primary-50 text-primary-700 rounded-xl hover:bg-primary-100 transition-colors font-medium text-sm">
                      <Paperclip className="w-4 h-4" /> Download
                    </a>
                  </div>
                ) : isPdf ? (
                  <div className="space-y-2">
                    <iframe src={homework.attachmentUrl} className="w-full h-96 rounded-xl border border-gray-200" title="PDF Preview" />
                    <a href={homework.attachmentUrl} download target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2 bg-primary-50 text-primary-700 rounded-xl hover:bg-primary-100 transition-colors font-medium text-sm">
                      <Paperclip className="w-4 h-4" /> Download PDF
                    </a>
                  </div>
                ) : (
                  <a href={homework.attachmentUrl} download target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary-50 text-primary-700 rounded-xl hover:bg-primary-100 transition-colors font-medium text-sm">
                    <Paperclip className="w-4 h-4" /> Download Attachment
                  </a>
                )}
              </div>
            );
          })()}

          <p className="text-xs text-gray-400 mt-4">Posted {format(parseISO(homework.createdAt), 'MMM d, yyyy')}</p>
        </Card>
      </div>
    </PageLayout>
  );
}
