import { Link, useNavigate } from 'react-router-dom';
import { usePaginated } from '../hooks/usePaginated';
import { format } from 'date-fns';
import { Plus, Pencil, Trash2, Globe, EyeOff } from 'lucide-react';
import { toast } from 'react-toastify';
import { academicApi } from '../services/api';
import { useAuthStore } from '../store/authStore';
import Navbar from '../components/layout/Navbar';
import type { AcademicPost } from '../types';

function PostRow({ post, onDelete, onToggle }: {
  post: AcademicPost;
  onDelete: (id: string) => void;
  onToggle: (post: AcademicPost) => void;
}) {
  return (
    <div className="flex items-center gap-4 py-4 border-b border-gray-100 last:border-0">
      <div className="flex-1 min-w-0">
        <Link to={`/posts/${post.id}`} className="font-medium text-gray-900 hover:text-primary-600 transition-colors line-clamp-1">
          {post.title}
        </Link>
        <div className="flex items-center gap-2 mt-0.5">
          {post.classes?.name && <span className="text-xs text-gray-400">{post.classes.name}</span>}
          {post.subject && <><span className="text-gray-300">·</span><span className="text-xs text-gray-400">{post.subject}</span></>}
          <span className="text-gray-300">·</span>
          <span className="text-xs text-gray-400">{format(new Date(post.updated_at), 'MMM d, yyyy')}</span>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${post.is_published ? 'bg-emerald-50 text-emerald-700' : 'bg-yellow-50 text-yellow-700'}`}>
          {post.is_published ? 'Published' : 'Draft'}
        </span>
        <button
          onClick={() => onToggle(post)}
          title={post.is_published ? 'Unpublish' : 'Publish'}
          className="p-1.5 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
        >
          {post.is_published ? <EyeOff className="w-4 h-4" /> : <Globe className="w-4 h-4" />}
        </button>
        <Link
          to={`/posts/${post.id}/edit`}
          className="p-1.5 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
        >
          <Pencil className="w-4 h-4" />
        </Link>
        <button
          onClick={() => onDelete(post.id)}
          className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export default function MyPostsPage() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const {
    items: allPosts, setItems, loading, loadingMore, sentinelRef,
  } = usePaginated<AcademicPost>(c => academicApi.getPosts(undefined, c));

  // Teacher sees own + all published; show only their own (+ own drafts).
  // The filter applies to whatever pages have loaded; auto-scroll keeps
  // pulling more, so the list fills in progressively.
  const posts = allPosts.filter(p => p.teachers?.user_id === user?.id || !p.is_published);
  const setPosts = setItems;

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this post?')) return;
    try {
      await academicApi.deletePost(id);
      setPosts(prev => prev.filter(p => p.id !== id));
      toast.success('Post deleted');
    } catch {
      toast.error('Failed to delete');
    }
  };

  const handleToggle = async (post: AcademicPost) => {
    try {
      await academicApi.updatePost(post.id, { isPublished: !post.is_published });
      setPosts(prev => prev.map(p => p.id === post.id ? { ...p, is_published: !p.is_published } : p));
      toast.success(post.is_published ? 'Post unpublished' : 'Post published');
    } catch {
      toast.error('Failed to update post');
    }
  };

  const published = posts.filter(p => p.is_published);
  const drafts = posts.filter(p => !p.is_published);

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">My Posts</h1>
          <Link
            to="/posts/new"
            className="inline-flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors"
          >
            <Plus className="w-4 h-4" /> New Post
          </Link>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : posts.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <p className="font-medium">No posts yet</p>
            <p className="text-sm mt-1">Create your first post to share with your class.</p>
            <Link to="/posts/new" className="inline-flex items-center gap-1.5 text-sm text-primary-600 font-semibold mt-4 hover:underline">
              <Plus className="w-4 h-4" /> Create post
            </Link>
          </div>
        ) : (
          <div className="space-y-6">
            {drafts.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6">
                <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wide pt-5 pb-2">Drafts ({drafts.length})</h2>
                {drafts.map(p => <PostRow key={p.id} post={p} onDelete={handleDelete} onToggle={handleToggle} />)}
              </div>
            )}
            {published.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6">
                <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wide pt-5 pb-2">Published ({published.length})</h2>
                {published.map(p => <PostRow key={p.id} post={p} onDelete={handleDelete} onToggle={handleToggle} />)}
              </div>
            )}
            {loadingMore && (
              <p className="py-3 text-center text-sm text-gray-400">Loading…</p>
            )}
            <div ref={sentinelRef} aria-hidden className="h-px" />
          </div>
        )}
      </div>
    </div>
  );
}
