import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Megaphone } from 'lucide-react';
import { adminApi, parentApi } from '../../services/api';
import { useNotificationStore } from '../../store/notificationStore';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import EmptyState from '../../components/common/EmptyState';
import ErrorMessage from '../../components/common/ErrorMessage';
import { AnnouncementsSkeleton } from '../../components/common/Skeleton';
import type { Announcement } from '../../types';
import { format, parseISO } from 'date-fns';

export default function AnnouncementsPage() {
  const { t } = useTranslation();
  const setUnreadCount = useNotificationStore(s => s.setUnreadCount);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    setError(false);
    adminApi.getAnnouncements()
      .then(r => setAnnouncements(r.data || []))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
    parentApi.markTypeRead('announcement')
      .then(() => parentApi.getUnreadCount().then(r => setUnreadCount(r.data?.count ?? 0)))
      .catch(() => {});
  }, [retryKey]);

  const latest = announcements[0];
  const rest = showAll ? announcements.slice(1) : announcements.slice(1, 4);

  return (
    <PageLayout title={t('announcements.title')} subtitle={t('announcements.subtitle')}>
      {loading ? <AnnouncementsSkeleton /> : error ? (
        <ErrorMessage onRetry={() => setRetryKey(k => k + 1)} />
      ) : announcements.length === 0 ? (
        <EmptyState title={t('announcements.no_announcements')} icon={<Megaphone className="w-8 h-8 text-gray-400" />} />
      ) : (
        <div className="space-y-6">
          {/* Hero - latest */}
          {latest && (
            <div
              className="bg-gradient-to-r from-primary-600 to-secondary-500 rounded-2xl p-6 text-white cursor-pointer hover:opacity-95 transition-opacity"
              onClick={() => navigate(`/parent/announcements/${latest.id}`)}
            >
              <div className="flex items-center gap-2 mb-3">
                <Megaphone className="w-5 h-5" />
                <span className="text-sm font-medium opacity-90">Latest Announcement</span>
              </div>
              <h2 className="text-xl font-bold mb-2">{latest.title}</h2>
              <p className="opacity-90 text-sm leading-relaxed line-clamp-3">{latest.content}</p>
              <p className="text-xs opacity-70 mt-3">{format(parseISO(latest.createdAt), 'MMMM d, yyyy')}</p>
            </div>
          )}

          {/* Rest */}
          {rest.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Previous Announcements</h2>
              <div className="grid gap-3">
                {rest.map((ann) => (
                  <Card key={ann.id} hover onClick={() => navigate(`/parent/announcements/${ann.id}`)}>
                    <div className="flex items-start gap-3">
                      <div className="p-2 bg-purple-50 rounded-lg flex-shrink-0">
                        <Megaphone className="w-4 h-4 text-purple-600" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-gray-900">{ann.title}</h3>
                        <p className="text-sm text-gray-600 mt-1 line-clamp-3">{ann.content}</p>
                        <p className="text-xs text-gray-400 mt-2">{format(parseISO(ann.createdAt), 'MMM d, yyyy')}</p>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
              {!showAll && announcements.length > 4 && (
                <button onClick={() => setShowAll(true)} className="mt-4 w-full py-2 text-sm text-primary-600 hover:text-primary-700 font-medium">
                  See All Announcements ({announcements.length - 1} total)
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </PageLayout>
  );
}
