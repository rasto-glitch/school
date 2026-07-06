import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { Megaphone, ArrowLeft, Paperclip, ExternalLink, Heart, MessageCircle } from 'lucide-react';
import { announcementApi, parentApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import PageLayout from '../../components/layout/PageLayout';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import Button from '../../components/common/Button';
import AnnouncementComments from '../../components/common/AnnouncementComments';
import type { Announcement } from '../../types';
import { format, parseISO } from 'date-fns';

interface LinkPreview {
  type: 'youtube' | 'instagram' | 'facebook' | 'link';
  videoId?: string;
  url: string;
  title: string;
  description: string;
  image: string;
  siteName: string;
}

export default function AnnouncementDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { school } = useAuthStore();
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<LinkPreview | null>(null);

  useEffect(() => {
    if (!id) return;
    announcementApi.getById(id)
      .then(a => setAnnouncement(a.data))
      .catch(() => navigate(-1))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!announcement?.linkUrl) return;
    parentApi.getLinkPreview(announcement.linkUrl).then(r => setPreview(r.data)).catch(() => {});
  }, [announcement?.linkUrl]);

  const announcerName = (() => {
    if (!announcement) return '';
    return announcement.users?.role === 'admin'
      ? (school?.name || 'School')
      : (`${announcement.users?.firstName ?? ''} ${announcement.users?.lastName ?? ''}`.trim() || 'School');
  })();
  const announcerAvatar = announcement?.users?.profilePicture;

  const handleToggleLike = async () => {
    if (!announcement) return;
    setAnnouncement({
      ...announcement,
      likedByMe: !announcement.likedByMe,
      likesCount: (announcement.likesCount ?? 0) + (announcement.likedByMe ? -1 : 1),
    });
    try { await announcementApi.toggleLike(announcement.id); } catch {}
  };

  if (loading) return <PageLayout title={t('announcements.detail_title')}><LoadingSpinner /></PageLayout>;
  if (!announcement) return <PageLayout title={t('announcements.detail_title')}><p className="text-gray-500">{t('announcements.not_found')}</p></PageLayout>;

  return (
    <PageLayout title={t('announcements.detail_title')}>
      <div className="max-w-2xl space-y-4">
        <Button variant="ghost" size="sm" icon={<ArrowLeft className="w-4 h-4" />} onClick={() => navigate(-1)}>{t('common.back')}</Button>

        <article className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="p-6">
            <div className="flex items-center gap-3 mb-4">
              {announcerAvatar ? (
                <img src={announcerAvatar} alt="" className="w-11 h-11 rounded-full object-cover" />
              ) : (
                <div className="w-11 h-11 rounded-full bg-primary-50 flex items-center justify-center">
                  <Megaphone className="w-5 h-5 text-primary-600" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-gray-900 truncate">{announcerName}</p>
                <p className="text-xs text-gray-400">{format(parseISO(announcement.createdAt), 'MMMM d, yyyy · h:mm a')}</p>
              </div>
              {announcement.targetAudience && announcement.targetAudience !== 'all' && (
                <span className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full font-semibold capitalize">
                  {announcement.targetAudience}
                </span>
              )}
            </div>

            <h1 className="text-2xl font-bold text-gray-900 mb-3">{announcement.title}</h1>
            <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">{announcement.content}</p>
          </div>

          {announcement.imageUrl && (
            <img src={announcement.imageUrl} alt="" className="w-full h-auto block" />
          )}

          {announcement.linkUrl && (
            <div className="px-6 pb-6">
              {preview?.type === 'youtube' ? (
                <iframe
                  src={`https://www.youtube.com/embed/${preview.videoId}`}
                  className="w-full rounded-xl border border-gray-200"
                  style={{ aspectRatio: '16/9' }}
                  allowFullScreen
                  title={preview.title}
                />
              ) : preview && (preview.title || preview.image) ? (
                <a href={announcement.linkUrl} target="_blank" rel="noopener noreferrer"
                  className="flex gap-3 p-3 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors group">
                  {preview.image && (
                    <img src={preview.image} alt="" className="w-20 h-20 object-cover rounded-lg flex-shrink-0" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  )}
                  <div className="min-w-0 flex-1">
                    {preview.siteName && <p className="text-xs text-gray-400 mb-0.5">{preview.siteName}</p>}
                    {preview.title && <p className="font-semibold text-gray-900 text-sm leading-snug line-clamp-2">{preview.title}</p>}
                    {preview.description && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{preview.description}</p>}
                  </div>
                </a>
              ) : (
                <a href={announcement.linkUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary-50 text-primary-700 rounded-xl hover:bg-primary-100 transition-colors font-medium text-sm">
                  <ExternalLink className="w-4 h-4" /> {t('announcements.open_link')}
                </a>
              )}
            </div>
          )}

          {announcement.attachmentUrl && (() => {
            const ext = announcement.attachmentUrl!.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
            const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
            const isPdf = ext === 'pdf';
            return (
              <div className="px-6 pb-6 space-y-2">
                {isImage ? (
                  <img src={announcement.attachmentUrl} alt="Attachment" className="w-full max-h-72 object-contain rounded-xl border border-gray-200 bg-gray-50" />
                ) : isPdf ? (
                  <iframe src={announcement.attachmentUrl} className="w-full h-96 rounded-xl border border-gray-200" title="PDF Preview" />
                ) : null}
                <a href={announcement.attachmentUrl} download target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-primary-50 text-primary-700 rounded-xl hover:bg-primary-100 transition-colors font-medium text-sm">
                  <Paperclip className="w-4 h-4" /> {t('common.download')}
                </a>
              </div>
            );
          })()}

          <div className="px-6 py-4 border-t border-gray-100 flex items-center gap-5">
            <button
              onClick={handleToggleLike}
              className={`flex items-center gap-1.5 text-sm font-medium ${announcement.likedByMe ? 'text-rose-600' : 'text-gray-500 hover:text-rose-600'}`}
            >
              <Heart className={`w-5 h-5 ${announcement.likedByMe ? 'fill-rose-600' : ''}`} />
              {announcement.likesCount ?? 0}
            </button>
            <span className="flex items-center gap-1.5 text-sm text-gray-500">
              <MessageCircle className="w-5 h-5" />
              {announcement.commentsCount ?? 0}
            </span>
          </div>
        </article>

        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">{t('announcements.comments')} ({announcement.commentsCount ?? 0})</h2>
          <AnnouncementComments
            announcementId={announcement.id}
            onCountChange={count => setAnnouncement(prev => prev ? { ...prev, commentsCount: count } : prev)}
          />
        </section>
      </div>
    </PageLayout>
  );
}
