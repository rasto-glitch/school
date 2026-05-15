import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { format } from 'date-fns';
import DOMPurify from 'dompurify';
import { ArrowLeft, Pencil, Trash2, Paperclip, Download, Heart, MessageCircle, Bookmark, Send, CornerDownRight, X } from 'lucide-react';
import { academicApi } from '../services/api';
import { useAuthStore } from '../store/authStore';
import Navbar from '../components/layout/Navbar';
import type { AcademicPost, PostComment } from '../types';
import { toast } from 'react-toastify';

function commentInitials(c: PostComment): string {
  const first = (c.users?.first_name ?? '').charAt(0);
  const last = (c.users?.last_name ?? '').charAt(0);
  return `${first}${last}`.toUpperCase() || '?';
}

interface CommentRowProps {
  c: PostComment;
  isReply: boolean;
  canDelete: boolean;
  displayName: string;
  onLike: () => void;
  onReply: () => void;
  onDelete: () => void;
}

function CommentRow({ c, isReply, canDelete, displayName, onLike, onReply, onDelete }: CommentRowProps) {
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
            Reply
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

export default function PostDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, school } = useAuthStore();
  const commenterName = (c: PostComment) => {
    if (c.users?.role === 'admin') return school?.name || 'School';
    const name = `${c.users?.first_name ?? ''} ${c.users?.last_name ?? ''}`.trim() || 'User';
    if (c.users?.role === 'teacher' && c.author_subject) return `${name} — ${c.author_subject}`;
    return name;
  };
  const [post, setPost] = useState<AcademicPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [comments, setComments] = useState<PostComment[]>([]);
  const [commentText, setCommentText] = useState('');
  const [posting, setPosting] = useState(false);
  const [replyTo, setReplyTo] = useState<PostComment | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const threaded = useMemo(() => {
    const tops = comments.filter(c => !c.parent_id);
    const repliesByParent = new Map<string, PostComment[]>();
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
      academicApi.getPost(id),
      academicApi.getComments(id),
    ]).then(([postRes, commentsRes]) => {
      setPost(postRes.data);
      setComments(commentsRes.data ?? []);
    }).catch(() => navigate('/feed'))
      .finally(() => setLoading(false));
  }, [id]);

  const isOwner = post?.author_user_id === user?.id;
  const canDelete = isOwner || user?.role === 'admin';

  const authorLabel = post?.author_role === 'supervisor'
    ? `${post.author_name ?? ''} — Principal`
    : `${post?.author_name ?? post?.teachers?.full_name ?? 'Teacher'}${post?.author_subject ? ` — ${post.author_subject}` : ''}`;

  const handleToggleLike = async () => {
    if (!post) return;
    setPost({
      ...post,
      liked_by_me: !post.liked_by_me,
      likes_count: (post.likes_count ?? 0) + (post.liked_by_me ? -1 : 1),
    });
    try { await academicApi.toggleLike(post.id); } catch {}
  };

  const handleToggleSave = async () => {
    if (!post) return;
    setPost({ ...post, saved_by_me: !post.saved_by_me });
    try { await academicApi.toggleSave(post.id); } catch {}
  };

  const handlePostComment = async () => {
    if (!post || !commentText.trim()) return;
    setPosting(true);
    try {
      const r = await academicApi.createComment(post.id, commentText.trim(), replyTo?.id);
      setComments(prev => [...prev, r.data]);
      setCommentText('');
      setReplyTo(null);
      setPost({ ...post, comments_count: (post.comments_count ?? 0) + 1 });
    } catch {
      toast.error('Failed to post comment');
    } finally {
      setPosting(false);
    }
  };

  const handleStartReply = (c: PostComment) => {
    setReplyTo(c);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleToggleCommentLike = async (c: PostComment) => {
    setComments(prev => prev.map(x => x.id === c.id ? {
      ...x,
      liked_by_me: !x.liked_by_me,
      likes_count: (x.likes_count ?? 0) + (x.liked_by_me ? -1 : 1),
    } : x));
    try { await academicApi.toggleCommentLike(c.id); } catch {}
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!confirm('Delete this comment?')) return;
    try {
      await academicApi.deleteComment(commentId);
      const removed = comments.filter(c => c.id === commentId || c.parent_id === commentId).length;
      setComments(prev => prev.filter(c => c.id !== commentId && c.parent_id !== commentId));
      if (post) setPost({ ...post, comments_count: Math.max(0, (post.comments_count ?? removed) - removed) });
    } catch {
      toast.error('Failed to delete comment');
    }
  };

  const handleDelete = async () => {
    if (!id || !confirm('Delete this post?')) return;
    setDeleting(true);
    try {
      await academicApi.deletePost(id);
      toast.success('Post deleted');
      navigate('/feed');
    } catch {
      toast.error('Failed to delete post');
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!post) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Back */}
        <button onClick={() => navigate(-1)} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-6 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        <article className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {/* Header */}
          <div className="px-8 pt-8 pb-6 border-b border-gray-100">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex flex-wrap gap-2 mb-3">
                  {post.classes?.name && (
                    <span className="text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full">{post.classes.name}</span>
                  )}
                  {post.subject && (
                    <span className="text-xs bg-primary-50 text-primary-700 px-2.5 py-1 rounded-full font-medium">{post.subject}</span>
                  )}
                  {!post.is_published && (
                    <span className="text-xs bg-yellow-50 text-yellow-700 px-2.5 py-1 rounded-full font-medium">Draft</span>
                  )}
                </div>
                <h1 className="text-2xl font-bold text-gray-900 leading-snug">{post.title}</h1>
                <div className="flex items-center gap-2 mt-3 text-sm text-gray-400">
                  {post.author_avatar ? (
                    <img src={post.author_avatar} alt="" className="w-7 h-7 rounded-full object-cover" />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-primary-100 text-primary-700 text-xs font-bold flex items-center justify-center">
                      {(post.author_name ?? post.teachers?.full_name ?? '?').charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span className="text-gray-600 font-medium">{authorLabel}</span>
                  <span>·</span>
                  <time>{format(new Date(post.created_at), 'MMMM d, yyyy')}</time>
                </div>
              </div>
              {/* Actions */}
              <div className="flex items-center gap-2 flex-shrink-0">
                {isOwner && (
                  <Link
                    to={`/posts/${post.id}/edit`}
                    className="flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-primary-600 border border-gray-200 rounded-lg px-3 py-1.5 transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" /> Edit
                  </Link>
                )}
                {canDelete && (
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="flex items-center gap-1.5 text-xs font-medium text-red-500 hover:text-red-700 border border-red-100 hover:border-red-200 rounded-lg px-3 py-1.5 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Delete
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Post image */}
          {post.image_url && (
            <div className="px-8 pt-7">
              <img src={post.image_url} alt="" className="w-full rounded-xl object-cover max-h-96" />
            </div>
          )}

          {/* Content */}
          <div className="px-8 py-7">
            {post.content_type === 'richtext' && post.content && (
              <div
                className="tiptap-content text-gray-700"
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(post.content) }}
              />
            )}

            {post.content_type === 'plaintext' && post.content && (
              <pre className="whitespace-pre-wrap text-gray-700 text-sm leading-relaxed font-sans">
                {post.content}
              </pre>
            )}

            {post.content_type === 'file' && post.attachment_url && (
              <div className="flex flex-col items-center py-8 gap-4">
                <div className="w-16 h-16 bg-amber-50 rounded-2xl flex items-center justify-center">
                  <Paperclip className="w-7 h-7 text-amber-500" />
                </div>
                <p className="text-gray-600 font-medium">{post.attachment_name ?? 'Attached file'}</p>
                <a
                  href={post.attachment_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors"
                >
                  <Download className="w-4 h-4" /> Download / Open
                </a>
              </div>
            )}
          </div>

          {/* Social actions */}
          <div className="px-8 py-4 border-t border-gray-100 flex items-center gap-5">
            <button
              onClick={handleToggleLike}
              className={`flex items-center gap-1.5 text-sm font-medium ${post.liked_by_me ? 'text-rose-600' : 'text-gray-500 hover:text-rose-600'}`}
            >
              <Heart className={`w-5 h-5 ${post.liked_by_me ? 'fill-rose-600' : ''}`} />
              {post.likes_count ?? 0}
            </button>
            <span className="flex items-center gap-1.5 text-sm text-gray-500">
              <MessageCircle className="w-5 h-5" />
              {post.comments_count ?? 0}
            </span>
            <button
              onClick={handleToggleSave}
              className={`ml-auto flex items-center gap-1.5 text-sm font-medium ${post.saved_by_me ? 'text-primary-600' : 'text-gray-500 hover:text-primary-600'}`}
            >
              <Bookmark className={`w-5 h-5 ${post.saved_by_me ? 'fill-primary-600' : ''}`} />
              {post.saved_by_me ? 'Saved' : 'Save'}
            </button>
          </div>
        </article>

        {/* Comments */}
        <section className="mt-6 bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Comments ({post.comments_count ?? 0})</h2>
          {replyTo && (
            <div className="flex items-center gap-2 mb-2 px-3 py-2 bg-primary-50 border border-primary-100 rounded-lg text-xs text-gray-600">
              <CornerDownRight className="w-3.5 h-3.5 text-gray-500" />
              <span className="flex-1 truncate">
                Replying to <span className="font-semibold text-gray-800">{commenterName(replyTo)}</span>
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
              placeholder={replyTo ? 'Write a reply...' : 'Write a comment...'}
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
            <p className="text-sm text-gray-400 text-center py-6">No comments yet. Be the first.</p>
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
    </div>
  );
}
