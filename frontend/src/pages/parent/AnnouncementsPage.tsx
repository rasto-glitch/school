import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Megaphone, Heart, MessageCircle } from 'lucide-react';
import { adminApi, parentApi, announcementApi } from '../../services/api';
import { useNotificationStore } from '../../store/notificationStore';
import { useAuthStore } from '../../store/authStore';
import PageLayout from '../../components/layout/PageLayout';
import EmptyState from '../../components/common/EmptyState';
import ErrorMessage from '../../components/common/ErrorMessage';
import { AnnouncementsSkeleton } from '../../components/common/Skeleton';
import type { Announcement } from '../../types';
import { format, parseISO } from 'date-fns';

function bodyTeaser(raw: string): { text: string; truncated: boolean } {
  const trimmed = raw.trim();
  if (!trimmed) return { text: '', truncated: false };
  const sentences = trimmed.match(/[^.!?\n]+[.!?\n]+/g);
  if (sentences && sentences.length >= 2) {
    const first2 = sentences.slice(0, 2).join('').trim();
    return { text: first2, truncated: first2.length < trimmed.length };
  }
  const limit = 180;
  if (trimmed.length > limit) {
    const cut = trimmed.slice(0, limit);
    const lastSpace = cut.lastIndexOf(' ');
    return { text: (lastSpace > 80 ? cut.slice(0, lastSpace) : cut).trim(), truncated: true };
  }
  return { text: trimmed, truncated: false };
}

export default function AnnouncementsPage() {
  const { t } = useTranslation();
  const { school } = useAuthStore();
  const setUnreadCount = useNotificationStore(s => s.setUnreadCount);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

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

  const handleToggleLike = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setAnnouncements(prev => prev.map(a => a.id === id ? {
      ...a,
      liked_by_me: !a.liked_by_me,
      likes_count: (a.likes_count ?? 0) + (a.liked_by_me ? -1 : 1),
    } : a));
    try { await announcementApi.toggleLike(id); } catch {}
  };

  return (
    <PageLayout title={t('announcements.title')} subtitle={t('announcements.subtitle')}>
      {loading ? <AnnouncementsSkeleton /> : error ? (
        <ErrorMessage onRetry={() => setRetryKey(k => k + 1)} />
      ) : announcements.length === 0 ? (
        <EmptyState title={t('announcements.no_announcements')} icon={<Megaphone className="w-8 h-8 text-gray-400" />} />
      ) : (
        <div className="max-w-3xl space-y-4">
          {announcements.map(ann => {
            const announcerName = ann.users?.role === 'admin'
              ? (school?.name || 'School')
              : (`${ann.users?.first_name ?? ''} ${ann.users?.last_name ?? ''}`.trim() || 'School');
            const avatar = ann.users?.profile_picture;
            const teaser = ann.content ? bodyTeaser(ann.content) : null;

            return (
              <article
                key={ann.id}
                className="bg-white border border-gray-100 rounded-2xl hover:shadow-md transition-all overflow-hidden cursor-pointer"
                onClick={() => navigate(`/parent/announcements/${ann.id}`)}
              >
                <div className="p-5">
                  <div className="flex items-center gap-3 mb-3">
                    {avatar ? (
                      <img src={avatar} alt="" className="w-10 h-10 rounded-full object-cover" />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-primary-50 flex items-center justify-center">
                        <Megaphone className="w-5 h-5 text-primary-600" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-900 truncate">{announcerName}</p>
                      <p className="text-xs text-gray-400">{format(parseISO(ann.createdAt), 'MMM d, yyyy')}</p>
                    </div>
                    <span className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full font-semibold">
                      Announcement
                    </span>
                  </div>
                  <h2 className="font-semibold text-gray-900 mb-2 line-clamp-2">{ann.title}</h2>
                  {teaser && teaser.text.length > 0 && (
                    <p className="text-sm text-gray-500 leading-relaxed whitespace-pre-wrap">
                      {teaser.text}
                      {teaser.truncated && (
                        <>
                          <span>… </span>
                          <span className="text-primary-600 font-semibold">see more</span>
                        </>
                      )}
                    </p>
                  )}
                </div>

                {ann.imageUrl && (
                  <img src={ann.imageUrl} alt="" className="w-full h-auto block" />
                )}

                <div className="flex items-center gap-4 px-5 py-3 border-t border-gray-100">
                  <button
                    onClick={(e) => handleToggleLike(ann.id, e)}
                    className={`flex items-center gap-1 text-xs ${ann.liked_by_me ? 'text-rose-600' : 'text-gray-500 hover:text-rose-600'}`}
                  >
                    <Heart className={`w-4 h-4 ${ann.liked_by_me ? 'fill-rose-600' : ''}`} />
                    {ann.likes_count ?? 0}
                  </button>
                  <span className="flex items-center gap-1 text-xs text-gray-500">
                    <MessageCircle className="w-4 h-4" />
                    {ann.comments_count ?? 0}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </PageLayout>
  );
}
