import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Upload, Loader2, ImagePlus, X } from 'lucide-react';
import { toast } from 'react-toastify';
import { academicApi } from '../services/api';
import { useAuthStore } from '../store/authStore';
import Navbar from '../components/layout/Navbar';
import RichTextEditor from '../components/editor/RichTextEditor';
import type { AcademicClass } from '../types';

type ContentType = 'richtext' | 'plaintext' | 'file';

export default function CreatePostPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isSupervisor = user?.role === 'supervisor';
  const [classes, setClasses] = useState<AcademicClass[]>([]);
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [classId, setClassId] = useState('');
  const [body, setBody] = useState('');
  const [contentType, setContentType] = useState<ContentType>('richtext');
  const [content, setContent] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [image, setImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isSupervisor) return;
    academicApi.getClasses().then(r => {
      setClasses(r.data ?? []);
      if (r.data?.[0]?.id) setClassId(r.data[0].id);
    });
  }, [isSupervisor]);

  const uploadImage = async (file: File): Promise<string> => {
    const res = await academicApi.uploadFile(file);
    return res.data.url;
  };

  const handleSave = async (publish: boolean) => {
    if (!title.trim()) { toast.error('Title is required'); return; }
    if (!isSupervisor && !classId) { toast.error('Please select a class'); return; }
    if (contentType !== 'file' && !content.trim()) { toast.error('Content is required'); return; }
    if (contentType === 'file' && !file) { toast.error('Please select a file'); return; }

    setSaving(true);
    try {
      let attachmentUrl: string | undefined;
      let attachmentName: string | undefined;
      let imageUrl: string | undefined;

      if (contentType === 'file' && file) {
        const uploadRes = await academicApi.uploadFile(file);
        attachmentUrl = uploadRes.data.url;
        attachmentName = uploadRes.data.name;
      }

      if (image) {
        const imgRes = await academicApi.uploadFile(image);
        imageUrl = imgRes.data.url;
      }

      const res = await academicApi.createPost({
        title: title.trim(),
        subject: subject.trim() || undefined,
        classId: isSupervisor ? undefined : classId,
        content: contentType !== 'file' ? content : undefined,
        body: body.trim() || undefined,
        contentType,
        isPublished: publish,
        imageUrl,
        ...(attachmentUrl && { attachmentUrl, attachmentName }),
      } as any);

      toast.success(publish ? 'Post published!' : 'Draft saved');
      navigate(`/posts/${res.data.id}`);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to save post');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-4xl mx-auto px-6 py-8">
        <button onClick={() => navigate(-1)} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-6 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
          <h1 className="text-xl font-bold text-gray-900 mb-6">New Post</h1>

          <div className="space-y-5">
            {/* Title */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">Title <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Newton's Laws of Motion — Explained"
                className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>

            {/* Class + Subject (class hidden for supervisor — posts are school-wide) */}
            {isSupervisor ? (
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                This post will be published <strong>school-wide</strong> to all parents.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5">Class <span className="text-red-500">*</span></label>
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
                    placeholder="e.g. Physics"
                    className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              </div>
            )}

            {/* Short body (200-char teaser shown in feed) */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                Short description <span className="text-gray-400 font-normal">(optional — shown as teaser in feed, 200 char max)</span>
              </label>
              <textarea
                value={body}
                onChange={e => setBody(e.target.value.slice(0, 200))}
                placeholder="One-sentence summary..."
                rows={2}
                maxLength={200}
                className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
              />
              <div className="text-right text-xs text-gray-400 mt-1">{body.length}/200</div>
            </div>

            {/* Post Image — thumbnail */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">Cover Image <span className="text-gray-400 font-normal">(optional — shown as thumbnail)</span></label>
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
                  <span className="text-sm text-gray-500">Click to add a cover image</span>
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

            {/* Content type */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-2">Content type</label>
              <div className="flex gap-2">
                {(['richtext', 'plaintext', 'file'] as ContentType[]).map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setContentType(t)}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${contentType === t ? 'bg-primary-600 text-white border-primary-600' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}
                  >
                    {t === 'richtext' ? 'Rich Text' : t === 'plaintext' ? 'Plain Text' : 'File Upload'}
                  </button>
                ))}
              </div>
            </div>

            {/* Content area */}
            {contentType === 'richtext' && (
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Content <span className="text-red-500">*</span></label>
                <RichTextEditor
                  content={content}
                  onChange={setContent}
                  placeholder="Write your topic explanation, notes, or summary here..."
                  onUploadImage={uploadImage}
                />
              </div>
            )}

            {contentType === 'plaintext' && (
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Content <span className="text-red-500">*</span></label>
                <textarea
                  value={content}
                  onChange={e => setContent(e.target.value)}
                  placeholder="Write your notes here..."
                  rows={10}
                  className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-y font-mono"
                />
              </div>
            )}

            {contentType === 'file' && (
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">File <span className="text-red-500">*</span></label>
                <label className="flex flex-col items-center justify-center border-2 border-dashed border-gray-200 rounded-xl px-6 py-10 cursor-pointer hover:border-primary-400 hover:bg-primary-50/30 transition-colors">
                  <Upload className="w-8 h-8 text-gray-300 mb-2" />
                  <span className="text-sm font-medium text-gray-600">{file ? file.name : 'Click to upload file'}</span>
                  <span className="text-xs text-gray-400 mt-1">PDF, Word, PowerPoint, images, etc.</span>
                  <input type="file" className="hidden" onChange={e => setFile(e.target.files?.[0] ?? null)} />
                </label>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3 mt-8 pt-6 border-t border-gray-100">
            <button
              type="button"
              onClick={() => handleSave(false)}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 border border-gray-200 rounded-xl text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Save as Draft
            </button>
            <button
              type="button"
              onClick={() => handleSave(true)}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 rounded-xl text-sm font-semibold text-white transition-colors"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Publish
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
