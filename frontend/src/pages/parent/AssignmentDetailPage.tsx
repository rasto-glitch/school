import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ClipboardList, Calendar, ArrowLeft } from 'lucide-react';
import { parentApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Badge from '../../components/common/Badge';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import Button from '../../components/common/Button';
import type { Assignment } from '../../types';
import { format, parseISO } from 'date-fns';

const statusColors: Record<string, 'yellow' | 'gray' | 'green'> = {
  pending: 'yellow', submitted: 'gray', graded: 'green',
};

export default function AssignmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    parentApi.getAssignments().then(r => {
      const a = (r.data || []).find((a: Assignment) => a.id === id);
      setAssignment(a || null);
    }).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <PageLayout title="Assignment"><LoadingSpinner /></PageLayout>;
  if (!assignment) return <PageLayout title="Assignment"><p className="text-gray-500">Assignment not found.</p></PageLayout>;

  return (
    <PageLayout title="Assignment Details">
      <div className="max-w-2xl space-y-4">
        <Button variant="ghost" size="sm" icon={<ArrowLeft className="w-4 h-4" />} onClick={() => navigate('/parent/assignments')}>Back</Button>
        <Card>
          <div className="flex items-start gap-3 mb-4">
            <div className="p-3 bg-green-50 rounded-xl flex-shrink-0">
              <ClipboardList className="w-6 h-6 text-green-600" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold text-gray-900">{assignment.title}</h1>
              <div className="flex flex-wrap items-center gap-2 mt-1">
                {assignment.subject && <Badge color="primary">{assignment.subject}</Badge>}
                {(assignment as any).classes?.name && <Badge color="secondary">{(assignment as any).classes.name}</Badge>}
                <Badge color={statusColors[assignment.submissionStatus] || 'gray'}>{assignment.submissionStatus}</Badge>
              </div>
            </div>
          </div>

          {assignment.grade !== undefined && assignment.grade !== null && (
            <div className="mb-4 p-4 bg-primary-50 rounded-xl text-center">
              <p className="text-sm text-gray-500 mb-1">Grade</p>
              <p className="text-4xl font-bold text-primary-600">{assignment.grade}</p>
            </div>
          )}

          {assignment.dueDate && (
            <div className="flex items-center gap-2 text-sm text-gray-600 mb-4 p-3 bg-gray-50 rounded-xl">
              <Calendar className="w-4 h-4 text-gray-400" />
              <span>Due: <span className="font-semibold text-gray-900">{format(parseISO(assignment.dueDate), 'EEEE, MMMM d, yyyy')}</span></span>
            </div>
          )}

          {assignment.description && (
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Description</h2>
              <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">{assignment.description}</p>
            </div>
          )}

          {(assignment as any).students?.fullName && (
            <p className="text-xs text-gray-400">Student: {(assignment as any).students.fullName}</p>
          )}
          <p className="text-xs text-gray-400 mt-1">Posted {format(parseISO(assignment.createdAt), 'MMM d, yyyy')}</p>
        </Card>
      </div>
    </PageLayout>
  );
}
