import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, ImagePlus, X } from 'lucide-react';
import { toast } from 'react-toastify';
import { academicApi } from '../services/api';
import Navbar from '../components/layout/Navbar';
import RichTextEditor from '../components/editor/RichTextEditor';
import type { AcademicClass, AcademicPost } from '../types';

export default function EditPostPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [classes, setClasses] = useState<AcademicClass[]>([]);
  const [post, setPost] = useState<AcademicPost | null>(null);
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [classId, setClassId] = useState('');
  const [content, setContent] = useState('');
  const [image, setImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    Promise.all([academicApi.getPost(id), academicApi.getClasses()]).then(([postRes, classRes]) => {
      const p: AcademicPost = postRes.data;
      setPost(p);
      setTitle(p.title);
      setSubject(p.subject ?? '');
      setClassId(p.class_id);
      setContent(p.content ?? '');
      if (p.image_url) setImagePreview(p.image_url);
      setClasses(classRes.data ?? []);
    }).catch(() => navigate('/feed')).finally(() => setLoading(false));
  }, [id]);

  const handleSave = async (publish: boolean) => {
    if (!title.trim()) { toast.error('Title is required'); return; }
    setSaving(true);
    try {
      let imageUrl: string | undefined;
      if (image) {
        const imgRes = await academicApi.uploadFile(image);
        imageUrl = imgRes.data.url;
      } else if (!imagePreview && post?.image_url) {
        // Image was removed
        imageUrl = '';
      }

      const res = await academicApi.updatePost(id!, {
        title: title.trim(),
        subject: subject.trim() || undefined,
        classId,
        content: post?.content_type !== 'file' ? content : undefined,
        isPublished: publish,
        ...(imageUrl !== undefined && { imageUrl }),
      });
      toast.success(publish ? 'Post published!' : 'Draft saved');
      navigate(`/posts/${res.data.id}`);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to save post');
    } finally {
      setSaving(false);
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

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-4xl mx-auto px-6 py-8">
        <button onClick={() => navigate(-1)} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-6 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
          <h1 className="text-xl font-bold text-gray-900 mb-6">Edit Post</h1>

          <div className="space-y-5">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">Title</label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Class</label>
                <select
                  value={classId}
                  onChange={e => setClassId(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
                >
                  {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Subject</label>
                <input
                  type="text"
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>

            {post?.content_type === 'richtext' && (
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Content</label>
                <RichTextEditor content={content} onChange={setContent} />
              </div>
            )}

            {post?.content_type === 'plaintext' && (
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Content</label>
                <textarea
                  value={content}
                  onChange={e => setContent(e.target.value)}
                  rows={10}
                  className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-y font-mono"
                />
              </div>
            )}

            {post?.content_type === 'file' && (
              <p className="text-sm text-gray-500 bg-gray-50 rounded-xl px-4 py-3">
                File posts cannot be re-uploaded. To change the file, delete this post and create a new one.
              </p>
            )}

            {/* Post Image */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">Post Image <span className="text-gray-400 font-normal">(optional)</span></label>
              {imagePreview ? (
                <div className="relative inline-block">
                  <img src={imagePreview} alt="Preview" className="h-32 rounded-xl object-cover border border-gray-200" />
                  <button
                    type="button"
                    onClick={() => { setImage(null); setImagePreview(''); }}
                    className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <label className="flex items-center gap-3 border-2 border-dashed border-gray-200 rounded-xl px-4 py-4 cursor-pointer hover:border-primary-400 hover:bg-primary-50/20 transition-colors">
                  <ImagePlus className="w-5 h-5 text-gray-300 flex-shrink-0" />
                  <span className="text-sm text-gray-500">Click to add an image</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={e => {
                      const f = e.target.files?.[0];
                      if (f) {
                        setImage(f);
                        setImagePreview(URL.createObjectURL(f));
                      }
                    }}
                  />
                </label>
              )}
            </div>
          </div>

          <div className="flex gap-3 mt-8 pt-6 border-t border-gray-100">
            <button
              onClick={() => handleSave(false)}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 border border-gray-200 rounded-xl text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Save as Draft
            </button>
            <button
              onClick={() => handleSave(true)}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 rounded-xl text-sm font-semibold text-white transition-colors"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {post?.is_published ? 'Save Changes' : 'Publish'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
