import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Megaphone, ArrowLeft } from 'lucide-react';
import { adminApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Badge from '../../components/common/Badge';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import Button from '../../components/common/Button';
import type { Announcement } from '../../types';
import { format, parseISO } from 'date-fns';

export default function AnnouncementDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminApi.getAnnouncements().then(r => {
      const a = (r.data || []).find((a: Announcement) => a.id === id);
      setAnnouncement(a || null);
    }).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <PageLayout title="Announcement"><LoadingSpinner /></PageLayout>;
  if (!announcement) return <PageLayout title="Announcement"><p className="text-gray-500">Announcement not found.</p></PageLayout>;

  return (
    <PageLayout title="Announcement">
      <div className="max-w-2xl space-y-4">
        <Button variant="ghost" size="sm" icon={<ArrowLeft className="w-4 h-4" />} onClick={() => navigate(-1)}>Back</Button>
        <div className="bg-gradient-to-r from-primary-600 to-secondary-500 rounded-2xl p-6 text-white">
          <div className="flex items-center gap-2 mb-3 opacity-80">
            <Megaphone className="w-5 h-5" />
            <span className="text-sm font-medium">School Announcement</span>
            <Badge color="gray">{announcement.targetAudience}</Badge>
          </div>
          <h1 className="text-2xl font-bold mb-3">{announcement.title}</h1>
          <p className="text-white/90 leading-relaxed whitespace-pre-wrap">{announcement.content}</p>
          <p className="text-white/60 text-xs mt-4">{format(parseISO(announcement.createdAt), 'MMMM d, yyyy · h:mm a')}</p>
        </div>
      </div>
    </PageLayout>
  );
}
