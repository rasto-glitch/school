import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { ArrowLeft, Bookmark, Heart, MessageCircle } from 'lucide-react';
import { academicApi } from '../services/api';
import Navbar from '../components/layout/Navbar';
import type { AcademicPost } from '../types';

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

export default function SavedPostsPage() {
  const [posts, setPosts] = useState<AcademicPost[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    academicApi.getSavedPosts()
      .then(r => setPosts(r.data ?? []))
      .finally(() => setLoading(false));
  }, []);

  const handleToggleSave = async (postId: string) => {
    try {
      await academicApi.toggleSave(postId);
      setPosts(prev => prev.filter(p => p.id !== postId));
    } catch {}
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-4xl mx-auto px-6 py-8">
        <Link to="/feed" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-6">
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>

        <h1 className="text-2xl font-bold text-gray-900 mb-1">Saved Posts</h1>
        <p className="text-sm text-gray-500 mb-6">Posts you've bookmarked</p>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : posts.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <Bookmark className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="font-medium">No saved posts yet</p>
            <p className="text-sm mt-1">Tap the bookmark icon on any post to save it here.</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {posts.map(post => {
              const authorLabel = post.author_role === 'supervisor'
                ? `${post.author_name ?? ''} — Principal`
                : `${post.author_name ?? post.teachers?.full_name ?? 'Teacher'}${post.author_subject ? ` — ${post.author_subject}` : ''}`;
              const teaser = post.body ? bodyTeaser(post.body) : null;
              return (
                <article key={post.id} className="bg-white border border-gray-100 rounded-2xl hover:shadow-md transition-all overflow-hidden">
                  <Link to={`/posts/${post.id}`} className="block group">
                    <div className="p-5">
                      <div className="flex items-center gap-2 mb-2">
                        {post.classes?.name && (
                          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{post.classes.name}</span>
                        )}
                        {post.author_role === 'supervisor' && (
                          <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full">School-wide</span>
                        )}
                        <time className="text-xs text-gray-400 ml-auto">{format(new Date(post.created_at), 'MMM d, yyyy')}</time>
                      </div>
                      <h2 className="font-semibold text-gray-900 group-hover:text-primary-600 mb-2 line-clamp-2">{post.title}</h2>
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
                      <p className="text-xs text-gray-400 mt-3">{authorLabel}</p>
                    </div>
                    {post.image_url && (
                      <img src={post.image_url} alt="" className="w-full h-auto block" />
                    )}
                  </Link>
                  <div className="flex items-center gap-4 px-5 pb-4 border-t border-gray-100 pt-3">
                    <span className="flex items-center gap-1 text-xs text-gray-500">
                      <Heart className="w-4 h-4" /> {post.likes_count ?? 0}
                    </span>
                    <span className="flex items-center gap-1 text-xs text-gray-500">
                      <MessageCircle className="w-4 h-4" /> {post.comments_count ?? 0}
                    </span>
                    <button
                      onClick={() => handleToggleSave(post.id)}
                      className="ml-auto text-xs text-primary-600 hover:text-primary-700 flex items-center gap-1"
                    >
                      <Bookmark className="w-4 h-4 fill-primary-600" /> Unsave
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
