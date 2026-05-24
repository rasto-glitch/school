import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Virtuoso } from 'react-virtuoso';
import { usePaginated } from '../../hooks/usePaginated';
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
  const {
    items: announcements, setItems: setAnnouncements, loading, loadingMore, error, reload, loadMore,
  } = usePaginated<Announcement>(adminApi.getAnnouncements);
  const navigate = useNavigate();

  useEffect(() => {
    parentApi.markTypeRead('announcement')
      .then(() => parentApi.getUnreadCount().then(r => setUnreadCount(r.data?.count ?? 0)))
      .catch(() => {});
  }, [setUnreadCount]);

  const handleToggleLike = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setAnnouncements(prev => prev.map(a => a.id === id ? {
      ...a,
      likedByMe: !a.likedByMe,
      likesCount: (a.likesCount ?? 0) + (a.likedByMe ? -1 : 1),
    } : a));
    try { await announcementApi.toggleLike(id); } catch {}
  };

  return (
    <PageLayout title={t('announcements.title')} subtitle={t('announcements.subtitle')}>
      {loading ? <AnnouncementsSkeleton /> : error ? (
        <ErrorMessage onRetry={reload} />
      ) : announcements.length === 0 ? (
        <EmptyState title={t('announcements.no_announcements')} icon={<Megaphone className="w-8 h-8 text-gray-400" />} />
      ) : (
        <Virtuoso
          useWindowScroll
          className="max-w-3xl mx-auto"
          data={announcements}
          endReached={loadMore}
          components={{
            Footer: () => loadingMore
              ? <p className="py-3 text-center text-sm text-gray-400">{t('common.loading_more')}</p>
              : null,
          }}
          itemContent={(_index, ann) => {
            const announcerName = ann.users?.role === 'admin'
              ? (school?.name || 'School')
              : (`${ann.users?.firstName ?? ''} ${ann.users?.lastName ?? ''}`.trim() || 'School');
            const avatar = ann.users?.profilePicture;
            const teaser = ann.content ? bodyTeaser(ann.content) : null;

            return (
              <article
                className="bg-white border border-gray-100 rounded-2xl hover:shadow-md transition-all overflow-hidden cursor-pointer mb-4"
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
                      {t('announcements.badge')}
                    </span>
                  </div>
                  <h2 className="font-semibold text-gray-900 mb-2 line-clamp-2">{ann.title}</h2>
                  {teaser && teaser.text.length > 0 && (
                    <p className="text-sm text-gray-500 leading-relaxed whitespace-pre-wrap">
                      {teaser.text}
                      {teaser.truncated && (
                        <>
                          <span>… </span>
                          <span className="text-primary-600 font-semibold">{t('common.see_more')}</span>
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
                    className={`flex items-center gap-1 text-xs ${ann.likedByMe ? 'text-rose-600' : 'text-gray-500 hover:text-rose-600'}`}
                  >
                    <Heart className={`w-4 h-4 ${ann.likedByMe ? 'fill-rose-600' : ''}`} />
                    {ann.likesCount ?? 0}
                  </button>
                  <span className="flex items-center gap-1 text-xs text-gray-500">
                    <MessageCircle className="w-4 h-4" />
                    {ann.commentsCount ?? 0}
                  </span>
                </div>
              </article>
            );
          }}
        />
      )}
    </PageLayout>
  );
}
