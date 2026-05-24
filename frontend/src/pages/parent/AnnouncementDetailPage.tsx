import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { Megaphone, ArrowLeft, Paperclip, ExternalLink, Heart, MessageCircle, Send, CornerDownRight, X, Trash2 } from 'lucide-react';
import { announcementApi, parentApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import PageLayout from '../../components/layout/PageLayout';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import Button from '../../components/common/Button';
import { toast } from 'react-toastify';
import type { Announcement, AnnouncementComment } from '../../types';
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

function commentInitials(c: AnnouncementComment): string {
  const first = (c.users?.first_name ?? '').charAt(0);
  const last = (c.users?.last_name ?? '').charAt(0);
  return `${first}${last}`.toUpperCase() || '?';
}

interface CommentRowProps {
  c: AnnouncementComment;
  isReply: boolean;
  canDelete: boolean;
  displayName: string;
  onLike: () => void;
  onReply: () => void;
  onDelete: () => void;
}

function CommentRow({ c, isReply, canDelete, displayName, onLike, onReply, onDelete }: CommentRowProps) {
  const { t } = useTranslation();
  const avatarUrl = c.users?.profile_picture;
  return (
    <div className={`flex items-start gap-3 p-3 bg-gray-50 rounded-xl ${isReply ? 'ml-10' : ''}`}>
      {avatarUrl ? (
        <img src={avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
      ) : (
        <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-700 text-xs font-bold flex items-center justify-center flex-shrink-0">
          {commentInitials(c)}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-800">{displayName}</span>
          <span className="text-xs text-gray-400">{format(new Date(c.created_at), 'MMM d, HH:mm')}</span>
        </div>
        <p className="text-sm text-gray-700 mt-0.5 whitespace-pre-wrap break-words">{c.body}</p>
        <div className="flex items-center gap-4 mt-1.5">
          <button
            onClick={onLike}
            className={`flex items-center gap-1 text-xs font-medium ${c.liked_by_me ? 'text-rose-600' : 'text-gray-500 hover:text-rose-600'}`}
          >
            <Heart className={`w-3.5 h-3.5 ${c.liked_by_me ? 'fill-rose-600' : ''}`} />
            {(c.likes_count ?? 0) > 0 && <span>{c.likes_count}</span>}
          </button>
          <button
            onClick={onReply}
            className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-primary-600"
          >
            <CornerDownRight className="w-3.5 h-3.5" />
            {t('announcements.reply')}
          </button>
        </div>
      </div>
      {canDelete && (
        <button onClick={onDelete} className="text-xs text-gray-400 hover:text-red-500">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

export default function AnnouncementDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, school } = useAuthStore();
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [comments, setComments] = useState<AnnouncementComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  const [commentText, setCommentText] = useState('');
  const [posting, setPosting] = useState(false);
  const [replyTo, setReplyTo] = useState<AnnouncementComment | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const threaded = useMemo(() => {
    const tops = comments.filter(c => !c.parent_id);
    const repliesByParent = new Map<string, AnnouncementComment[]>();
    for (const c of comments) {
      if (c.parent_id) {
        const arr = repliesByParent.get(c.parent_id) ?? [];
        arr.push(c);
        repliesByParent.set(c.parent_id, arr);
      }
    }
    return tops.map(top => ({ top, replies: repliesByParent.get(top.id) ?? [] }));
  }, [comments]);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      announcementApi.getById(id),
      announcementApi.getComments(id),
    ]).then(([a, c]) => {
      setAnnouncement(a.data);
      setComments(c.data ?? []);
    }).catch(() => navigate(-1))
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

  const commenterName = (c: AnnouncementComment) => {
    if (c.users?.role === 'admin') return school?.name || 'School';
    const name = `${c.users?.first_name ?? ''} ${c.users?.last_name ?? ''}`.trim() || 'User';
    if (c.users?.role === 'teacher' && c.author_subject) return `${name} — ${c.author_subject}`;
    return name;
  };

  const handleToggleLike = async () => {
    if (!announcement) return;
    setAnnouncement({
      ...announcement,
      likedByMe: !announcement.likedByMe,
      likesCount: (announcement.likesCount ?? 0) + (announcement.likedByMe ? -1 : 1),
    });
    try { await announcementApi.toggleLike(announcement.id); } catch {}
  };

  const handlePostComment = async () => {
    if (!announcement || !commentText.trim()) return;
    setPosting(true);
    try {
      const r = await announcementApi.createComment(announcement.id, commentText.trim(), replyTo?.id);
      setComments(prev => [...prev, r.data]);
      setCommentText('');
      setReplyTo(null);
      setAnnouncement({ ...announcement, commentsCount: (announcement.commentsCount ?? 0) + 1 });
    } catch {
      toast.error(t('announcements.post_failed'));
    } finally {
      setPosting(false);
    }
  };

  const handleStartReply = (c: AnnouncementComment) => {
    setReplyTo(c);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleToggleCommentLike = async (c: AnnouncementComment) => {
    setComments(prev => prev.map(x => x.id === c.id ? {
      ...x,
      liked_by_me: !x.liked_by_me,
      likes_count: (x.likes_count ?? 0) + (x.liked_by_me ? -1 : 1),
    } : x));
    try { await announcementApi.toggleCommentLike(c.id); } catch {}
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!confirm(t('announcements.delete_confirm'))) return;
    try {
      await announcementApi.deleteComment(commentId);
      const removed = comments.filter(c => c.id === commentId || c.parent_id === commentId).length;
      setComments(prev => prev.filter(c => c.id !== commentId && c.parent_id !== commentId));
      if (announcement) setAnnouncement({ ...announcement, commentsCount: Math.max(0, (announcement.commentsCount ?? removed) - removed) });
    } catch {
      toast.error(t('announcements.delete_failed'));
    }
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
          {replyTo && (
            <div className="flex items-center gap-2 mb-2 px-3 py-2 bg-primary-50 border border-primary-100 rounded-lg text-xs text-gray-600">
              <CornerDownRight className="w-3.5 h-3.5 text-gray-500" />
              <span className="flex-1 truncate">
                {t('announcements.replying_to')} <span className="font-semibold text-gray-800">{commenterName(replyTo)}</span>
              </span>
              <button onClick={() => setReplyTo(null)} className="text-gray-500 hover:text-gray-800">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          <div className="flex gap-2 mb-5">
            <input
              ref={inputRef}
              type="text"
              value={commentText}
              onChange={e => setCommentText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !posting) handlePostComment(); }}
              placeholder={replyTo ? t('announcements.write_reply') : t('announcements.write_comment')}
              className="flex-1 border border-gray-200 rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <button
              onClick={handlePostComment}
              disabled={posting || !commentText.trim()}
              className="inline-flex items-center gap-1.5 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-semibold px-4 rounded-xl transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
          {comments.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">{t('announcements.no_comments')}</p>
          ) : (
            <ul className="space-y-3">
              {threaded.map(({ top, replies }) => (
                <li key={top.id} className="space-y-2">
                  <CommentRow
                    c={top}
                    isReply={false}
                    canDelete={top.user_id === user?.id || user?.role === 'admin'}
                    displayName={commenterName(top)}
                    onLike={() => handleToggleCommentLike(top)}
                    onReply={() => handleStartReply(top)}
                    onDelete={() => handleDeleteComment(top.id)}
                  />
                  {replies.map(r => (
                    <CommentRow
                      key={r.id}
                      c={r}
                      isReply
                      canDelete={r.user_id === user?.id || user?.role === 'admin'}
                      displayName={commenterName(r)}
                      onLike={() => handleToggleCommentLike(r)}
                      onReply={() => handleStartReply(top)}
                      onDelete={() => handleDeleteComment(r.id)}
                    />
                  ))}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </PageLayout>
  );
}
