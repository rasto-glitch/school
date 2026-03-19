import { useEffect, useState } from 'react';
import { ClipboardList, Trash2, Calendar, User, GraduationCap } from 'lucide-react';
import { toast } from 'react-toastify';
import { supervisorApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';

interface AssignmentItem {
  id: string;
  title: string;
  description?: string;
  subject?: string;
  dueDate?: string;
  createdAt: string;
  teachers?: { fullName: string };
  classes?: { name: string };
}

export default function SupervisorAssignmentsPage() {
  const [items, setItems] = useState<AssignmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    supervisorApi.getAssignments()
      .then(r => setItems(r.data || []))
      .catch(() => toast.error('Failed to load assignments'))
      .finally(() => setLoading(false));
  }, []);

  const handleDelete = async (id: string, title: string) => {
    if (!window.confirm(`Delete "${title}"? This cannot be undone.`)) return;
    setDeletingId(id);
    try {
      await supervisorApi.deleteAssignment(id);
      setItems(prev => prev.filter(a => a.id !== id));
      toast.success('Assignment deleted');
    } catch {
      toast.error('Failed to delete assignment');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <PageLayout title="Assignments" subtitle="All assignments assigned by teachers">
      <div className="space-y-3 max-w-3xl">
        {loading ? <LoadingSpinner /> : items.length === 0 ? (
          <EmptyState icon={ClipboardList} title="No assignments found" description="No assignments have been created yet." />
        ) : items.map(item => (
          <Card key={item.id} className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center flex-shrink-0 mt-0.5">
              <ClipboardList className="w-5 h-5 text-green-600" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold text-gray-900 truncate">{item.title}</h3>
                <button
                  onClick={() => handleDelete(item.id, item.title)}
                  disabled={deletingId === item.id}
                  className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              {item.description && <p className="text-sm text-gray-500 mt-0.5 line-clamp-2">{item.description}</p>}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2">
                {item.subject && (
                  <span className="text-xs font-medium bg-green-50 text-green-700 px-2 py-0.5 rounded-full">{item.subject}</span>
                )}
                {item.classes?.name && (
                  <span className="flex items-center gap-1 text-xs text-gray-500">
                    <GraduationCap className="w-3 h-3" />{item.classes.name}
                  </span>
                )}
                {item.teachers?.fullName && (
                  <span className="flex items-center gap-1 text-xs text-gray-500">
                    <User className="w-3 h-3" />{item.teachers.fullName}
                  </span>
                )}
                {item.dueDate && (
                  <span className="flex items-center gap-1 text-xs text-amber-600 font-medium">
                    <Calendar className="w-3 h-3" />Due {new Date(item.dueDate).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </PageLayout>
  );
}
