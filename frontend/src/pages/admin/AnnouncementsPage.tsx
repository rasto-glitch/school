import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'react-toastify';
import { Megaphone, Trash2 } from 'lucide-react';
import { adminApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Input from '../../components/common/Input';
import Select from '../../components/common/Select';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import EmptyState from '../../components/common/EmptyState';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import type { Announcement } from '../../types';
import { format, parseISO } from 'date-fns';

export default function AnnouncementsPage() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const { register, handleSubmit, reset } = useForm<{
    title: string; content: string; targetAudience: string; imageUrl: string;
  }>();

  const load = () => {
    adminApi.getAnnouncements().then(r => setAnnouncements(r.data || [])).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const onSubmit = async (data: any) => {
    setSubmitting(true);
    try {
      await adminApi.createAnnouncement(data);
      toast.success('Announcement posted!');
      reset();
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed');
    } finally {
      setSubmitting(false);
    }
  };

  const onDelete = async (id: string) => {
    if (!confirm('Delete this announcement?')) return;
    await adminApi.deleteAnnouncement(id);
    toast.success('Deleted');
    load();
  };

  const audienceColor: Record<string, 'primary' | 'green' | 'secondary' | 'gray'> = {
    all: 'primary', parents: 'green', teachers: 'secondary', students: 'gray',
  };

  return (
    <PageLayout title="Announcements" subtitle="Post and manage school announcements">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Create */}
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <Megaphone className="w-5 h-5 text-primary-600" />
            <h2 className="font-semibold text-gray-900">Post Announcement</h2>
          </div>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <Input label="Title" placeholder="Announcement title" {...register('title', { required: true })} />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Content</label>
              <textarea
                className="input-field min-h-[120px] resize-none"
                placeholder="Write the full announcement here..."
                {...register('content', { required: true })}
              />
            </div>
            <Select
              label="Audience"
              options={[
                { value: 'all', label: 'Everyone' },
                { value: 'parents', label: 'Parents Only' },
                { value: 'teachers', label: 'Teachers Only' },
                { value: 'students', label: 'Students Only' },
              ]}
              {...register('targetAudience')}
            />
            <Input label="Image URL (optional)" placeholder="https://..." {...register('imageUrl')} />
            <Button type="submit" loading={submitting} fullWidth icon={<Megaphone className="w-4 h-4" />}>
              Post Announcement
            </Button>
          </form>
        </Card>

        {/* List */}
        <div>
          <h2 className="font-semibold text-gray-900 mb-3">Posted Announcements ({announcements.length})</h2>
          {loading ? <LoadingSpinner /> : announcements.length === 0 ? (
            <EmptyState title="No announcements yet" icon={<Megaphone className="w-8 h-8 text-gray-400" />} />
          ) : (
            <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
              {announcements.map(ann => (
                <Card key={ann.id}>
                  {(ann as any).imageUrl && (
                    <img src={(ann as any).imageUrl} alt="" className="w-full h-32 object-cover rounded-xl mb-3" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  )}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <h3 className="font-semibold text-gray-900">{ann.title}</h3>
                        <Badge color={audienceColor[ann.targetAudience] || 'gray'}>{ann.targetAudience}</Badge>
                      </div>
                      <p className="text-sm text-gray-600 line-clamp-2">{ann.content}</p>
                      <p className="text-xs text-gray-400 mt-1">{format(parseISO(ann.createdAt), 'MMM d, yyyy')}</p>
                    </div>
                    <button onClick={() => onDelete(ann.id)} className="p-2 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0">
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </PageLayout>
  );
}
