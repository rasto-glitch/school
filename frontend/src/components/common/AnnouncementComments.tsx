import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Heart, Send, CornerDownRight, X, Trash2 } from 'lucide-react';
import { announcementApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { toast } from 'react-toastify';
import type { AnnouncementComment } from '../../types';
import { format } from 'date-fns';

// Threaded comments + composer for one announcement. Self-contained (fetches
// its own comments) so it can live inline on the admin AnnouncementsPage cards
// as well as on the full detail page. Reports the live comment total through
// onCountChange so the host can keep its counter in sync.

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

interface Props {
  announcementId: string;
  onCountChange?: (count: number) => void;
}

export default function AnnouncementComments({ announcementId, onCountChange }: Props) {
  const { t } = useTranslation();
  const { user, school } = useAuthStore();
  const [comments, setComments] = useState<AnnouncementComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [commentText, setCommentText] = useState('');
  const [posting, setPosting] = useState(false);
  const [replyTo, setReplyTo] = useState<AnnouncementComment | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    announcementApi.getComments(announcementId)
      .then(r => { if (!cancelled) setComments(r.data ?? []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [announcementId]);

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

  const commenterName = (c: AnnouncementComment) => {
    if (c.users?.role === 'admin') return school?.name || 'School';
    const name = `${c.users?.first_name ?? ''} ${c.users?.last_name ?? ''}`.trim() || 'User';
    if (c.users?.role === 'teacher' && c.author_subject) return `${name} — ${c.author_subject}`;
    return name;
  };

  const handlePostComment = async () => {
    if (!commentText.trim()) return;
    setPosting(true);
    try {
      const r = await announcementApi.createComment(announcementId, commentText.trim(), replyTo?.id);
      setComments(prev => {
        const next = [...prev, r.data];
        onCountChange?.(next.length);
        return next;
      });
      setCommentText('');
      setReplyTo(null);
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
      setComments(prev => {
        const next = prev.filter(c => c.id !== commentId && c.parent_id !== commentId);
        onCountChange?.(next.length);
        return next;
      });
    } catch {
      toast.error(t('announcements.delete_failed'));
    }
  };

  return (
    <div>
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
      <div className="flex gap-2 mb-4">
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
      {loading ? (
        <p className="text-sm text-gray-400 text-center py-4">{t('common.loading')}</p>
      ) : comments.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-4">{t('announcements.no_comments')}</p>
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
    </div>
  );
}
