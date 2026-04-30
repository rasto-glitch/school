import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { Plus, FileText, Paperclip, AlignLeft, Search, Filter, Heart, MessageCircle, Bookmark } from 'lucide-react';
import { academicApi } from '../services/api';
import { useAuthStore } from '../store/authStore';
import Navbar from '../components/layout/Navbar';
import type { AcademicPost, AcademicClass } from '../types';

const typeIcon = { richtext: FileText, plaintext: AlignLeft, file: Paperclip };
const typeLabel = { richtext: 'Article', plaintext: 'Note', file: 'File' };
const typeColor = {
  richtext: 'bg-indigo-50 text-indigo-600',
  plaintext: 'bg-slate-50 text-slate-600',
  file: 'bg-amber-50 text-amber-600',
};

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

function PostCard({ post, onToggleLike, onToggleSave }: {
  post: AcademicPost;
  onToggleLike: (id: string) => void;
  onToggleSave: (id: string) => void;
}) {
  const Icon = typeIcon[post.content_type];
  const rawBody = post.body || (post.content_type !== 'file' && post.content
    ? post.content.replace(/<[^>]+>/g, '')
    : '');
  const teaser = rawBody ? bodyTeaser(rawBody) : null;

  const authorLabel = post.author_role === 'supervisor'
    ? `${post.author_name ?? ''} — Principal`
    : `${post.author_name ?? post.teachers?.full_name ?? 'Teacher'}${post.author_subject ? ` — ${post.author_subject}` : ''}`;
  const authorInitial = (post.author_name ?? post.teachers?.full_name ?? '?').charAt(0).toUpperCase();

  const handleAction = (e: React.MouseEvent, fn: () => void) => {
    e.preventDefault();
    e.stopPropagation();
    fn();
  };

  return (
    <Link to={`/posts/${post.id}`} className="block group">
      <article className="bg-white border border-gray-100 rounded-2xl hover:shadow-md hover:border-primary-100 transition-all overflow-hidden">
        <div className="p-5">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${typeColor[post.content_type]}`}>
                <Icon className="w-3 h-3" /> {typeLabel[post.content_type]}
              </span>
              {post.classes?.name && (
                <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{post.classes.name}</span>
              )}
              {post.author_role === 'supervisor' && (
                <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full">School-wide</span>
              )}
            </div>
            <time className="text-xs text-gray-400 flex-shrink-0">
              {format(new Date(post.created_at), 'MMM d, yyyy')}
            </time>
          </div>
          <h2 className="font-semibold text-gray-900 group-hover:text-primary-600 transition-colors mb-2 line-clamp-2">
            {post.title}
          </h2>
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
          {post.content_type === 'file' && post.attachment_name && (
            <p className="text-sm text-amber-600 flex items-center gap-1 mt-2">
              <Paperclip className="w-3.5 h-3.5" /> {post.attachment_name}
            </p>
          )}
          <div className="flex items-center gap-2 mt-3">
            {post.author_avatar ? (
              <img src={post.author_avatar} alt="" className="w-6 h-6 rounded-full object-cover" />
            ) : (
              <div className="w-6 h-6 rounded-full bg-primary-100 text-primary-700 text-[10px] font-bold flex items-center justify-center">
                {authorInitial}
              </div>
            )}
            <p className="text-xs text-gray-400">{authorLabel}</p>
          </div>
        </div>

        {post.image_url && (
          <img
            src={post.image_url}
            alt=""
            className="w-full h-auto block"
          />
        )}

        <div className="flex items-center gap-4 px-5 py-3 border-t border-gray-100">
          <button
            onClick={(e) => handleAction(e, () => onToggleLike(post.id))}
            className={`flex items-center gap-1 text-xs ${post.liked_by_me ? 'text-rose-600' : 'text-gray-500 hover:text-rose-600'}`}
          >
            <Heart className={`w-4 h-4 ${post.liked_by_me ? 'fill-rose-600' : ''}`} />
            {post.likes_count ?? 0}
          </button>
          <span className="flex items-center gap-1 text-xs text-gray-500">
            <MessageCircle className="w-4 h-4" />
            {post.comments_count ?? 0}
          </span>
          <button
            onClick={(e) => handleAction(e, () => onToggleSave(post.id))}
            className={`ml-auto flex items-center gap-1 text-xs ${post.saved_by_me ? 'text-primary-600' : 'text-gray-500 hover:text-primary-600'}`}
          >
            <Bookmark className={`w-4 h-4 ${post.saved_by_me ? 'fill-primary-600' : ''}`} />
          </button>
        </div>
      </article>
    </Link>
  );
}

export default function FeedPage() {
  const { user } = useAuthStore();
  const [posts, setPosts] = useState<AcademicPost[]>([]);
  const [classes, setClasses] = useState<AcademicClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('');

  useEffect(() => {
    Promise.all([
      academicApi.getPosts(classFilter || undefined),
      academicApi.getClasses(),
    ]).then(([postsRes, classesRes]) => {
      setPosts(postsRes.data ?? []);
      setClasses(classesRes.data ?? []);
    }).finally(() => setLoading(false));
  }, [classFilter]);

  const filtered = posts.filter(p =>
    p.title.toLowerCase().includes(search.toLowerCase()) ||
    p.subject?.toLowerCase().includes(search.toLowerCase()) ||
    p.author_name?.toLowerCase().includes(search.toLowerCase()) ||
    p.teachers?.full_name?.toLowerCase().includes(search.toLowerCase())
  );

  const handleToggleLike = async (postId: string) => {
    const prev = posts;
    setPosts(prev.map(p => p.id === postId
      ? { ...p, liked_by_me: !p.liked_by_me, likes_count: (p.likes_count ?? 0) + (p.liked_by_me ? -1 : 1) }
      : p));
    try {
      await academicApi.toggleLike(postId);
    } catch {
      setPosts(prev);
    }
  };

  const handleToggleSave = async (postId: string) => {
    const prev = posts;
    setPosts(prev.map(p => p.id === postId ? { ...p, saved_by_me: !p.saved_by_me } : p));
    try {
      await academicApi.toggleSave(postId);
    } catch {
      setPosts(prev);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Academic Feed</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {user?.role === 'parent' ? "Posts from your child's classes" : 'All published posts'}
            </p>
          </div>
          {(user?.role === 'teacher' || user?.role === 'supervisor') && (
            <Link
              to="/posts/new"
              className="inline-flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors"
            >
              <Plus className="w-4 h-4" /> New Post
            </Link>
          )}
        </div>

        {/* Filters */}
        <div className="flex gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search posts..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full border border-gray-200 rounded-xl pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
            />
          </div>
          {classes.length > 0 && (
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <select
                value={classFilter}
                onChange={e => setClassFilter(e.target.value)}
                className="border border-gray-200 rounded-xl pl-9 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white appearance-none"
              >
                <option value="">All classes</option>
                {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
        </div>

        {/* Posts */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <FileText className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="font-medium">No posts yet</p>
            <p className="text-sm mt-1">
              {user?.role === 'teacher' ? 'Be the first to share something with your class.' : 'Check back later.'}
            </p>
          </div>
        ) : (
          <div className="grid gap-4">
            {filtered.map(post => (
              <PostCard key={post.id} post={post} onToggleLike={handleToggleLike} onToggleSave={handleToggleSave} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
