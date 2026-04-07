import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { format } from 'date-fns';
import { ArrowLeft, Pencil, Trash2, Paperclip, Download } from 'lucide-react';
import { academicApi } from '../services/api';
import { useAuthStore } from '../store/authStore';
import Navbar from '../components/layout/Navbar';
import type { AcademicPost } from '../types';
import { toast } from 'react-toastify';

export default function PostDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [post, setPost] = useState<AcademicPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!id) return;
    academicApi.getPost(id)
      .then(r => setPost(r.data))
      .catch(() => navigate('/feed'))
      .finally(() => setLoading(false));
  }, [id]);

  const isOwner = user?.role === 'teacher' && post?.teachers?.user_id === user?.id;
  const canDelete = isOwner || user?.role === 'admin';

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
                  <span>by <span className="text-gray-600 font-medium">{post.teachers?.full_name ?? 'Teacher'}</span></span>
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
                dangerouslySetInnerHTML={{ __html: post.content }}
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
        </article>
      </div>
    </div>
  );
}
