import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, ClipboardList, Trash2, Calendar, User, GraduationCap } from 'lucide-react';
import { toast } from 'react-toastify';
import { adminApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import EmptyState from '../../components/common/EmptyState';

// Phase D — admin moderation of teacher homework/assignments (academics.oversee).
// Teachers still own their own content; this is the oversight delete that moved
// up from supervisors.

interface ContentItem {
  id: string;
  title: string;
  description?: string;
  subject?: string;
  dueDate?: string;
  createdAt: string;
  teachers?: { fullName: string };
  classes?: { name: string };
}

type Tab = 'homework' | 'assignments';

export default function AdminContentModerationPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('homework');
  const [homework, setHomework] = useState<ContentItem[]>([]);
  const [assignments, setAssignments] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    Promise.allSettled([
      adminApi.getModerationHomework(),
      adminApi.getModerationAssignments(),
    ]).then(([hw, as_]) => {
      if (hw.status === 'fulfilled') setHomework(hw.value.data || []);
      if (as_.status === 'fulfilled') setAssignments(as_.value.data || []);
    }).finally(() => setLoading(false));
  }, []);

  const handleDelete = async (id: string, title: string) => {
    if (!window.confirm(t('admin.moderation.delete_confirm', { title }))) return;
    setDeletingId(id);
    try {
      if (tab === 'homework') {
        await adminApi.deleteModerationHomework(id);
        setHomework(prev => prev.filter(h => h.id !== id));
      } else {
        await adminApi.deleteModerationAssignment(id);
        setAssignments(prev => prev.filter(a => a.id !== id));
      }
      toast.success(t('admin.moderation.deleted'));
    } catch {
      toast.error(t('admin.moderation.delete_failed'));
    } finally {
      setDeletingId(null);
    }
  };

  const items = tab === 'homework' ? homework : assignments;
  const Icon = tab === 'homework' ? BookOpen : ClipboardList;
  const accent = tab === 'homework'
    ? { bg: 'bg-blue-50', text: 'text-blue-600', tag: 'bg-blue-50 text-blue-700' }
    : { bg: 'bg-green-50', text: 'text-green-600', tag: 'bg-green-50 text-green-700' };

  return (
    <PageLayout title={t('admin.moderation.title')} subtitle={t('admin.moderation.subtitle')}>
      <div className="flex gap-2 mb-4">
        {(['homework', 'assignments'] as Tab[]).map(k => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${tab === k ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}
          >
            {k === 'homework' ? t('nav.homework') : t('nav.assignments')}
          </button>
        ))}
      </div>

      <div className="space-y-3 max-w-3xl">
        {loading ? <LoadingSpinner /> : items.length === 0 ? (
          <EmptyState icon={<Icon className="w-8 h-8 text-gray-400" />} title={tab === 'homework' ? t('supervisor.no_homework') : t('supervisor.no_assignments')} />
        ) : items.map(item => (
          <Card key={item.id} className="flex items-start gap-4">
            <div className={`w-10 h-10 rounded-xl ${accent.bg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
              <Icon className={`w-5 h-5 ${accent.text}`} />
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
                  <span className={`text-xs font-medium ${accent.tag} px-2 py-0.5 rounded-full`}>{item.subject}</span>
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
                    <Calendar className="w-3 h-3" />{t('teacher.due', { date: new Date(item.dueDate).toLocaleDateString() })}
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
