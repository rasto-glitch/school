import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Virtuoso } from 'react-virtuoso';
import { usePaginated } from '../../hooks/usePaginated';
import { toast } from 'react-toastify';
import { Megaphone, Trash2, Paperclip, X, Image as ImageIcon, Heart, MessageCircle } from 'lucide-react';
import { adminApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Input from '../../components/common/Input';
import Select from '../../components/common/Select';
import Button from '../../components/common/Button';
import EmptyState from '../../components/common/EmptyState';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import type { Announcement } from '../../types';
import { format, parseISO } from 'date-fns';

export default function AnnouncementsPage() {
  const { school } = useAuthStore();
  const {
    items: announcements, loading, loadingMore, reload, loadMore,
  } = usePaginated<Announcement>(adminApi.getAnnouncements);
  const [submitting, setSubmitting] = useState(false);

  const { register, handleSubmit, reset } = useForm<{
    title: string; content: string; targetAudience: string; linkUrl: string;
  }>();

  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [uploadingCover, setUploadingCover] = useState(false);


  const onCoverChange = (file: File | null) => {
    setCoverFile(file);
    if (coverPreview) URL.revokeObjectURL(coverPreview);
    setCoverPreview(file ? URL.createObjectURL(file) : null);
  };

  const onSubmit = async (data: any) => {
    setSubmitting(true);
    try {
      let imageUrl: string | undefined;
      if (coverFile) {
        setUploadingCover(true);
        const r = await adminApi.uploadAnnouncementImage(coverFile);
        imageUrl = r.data?.url;
        setUploadingCover(false);
      }

      const fd = new FormData();
      Object.entries(data).forEach(([k, v]) => { if (v != null && v !== '') fd.append(k, String(v)); });
      if (attachedFile) fd.append('attachment', attachedFile);
      if (imageUrl) fd.append('imageUrl', imageUrl);

      await adminApi.createAnnouncement(fd);
      toast.success('Announcement posted!');
      reset();
      setAttachedFile(null);
      onCoverChange(null);
      if (fileRef.current) fileRef.current.value = '';
      if (imageRef.current) imageRef.current.value = '';
      reload();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed');
    } finally {
      setSubmitting(false);
      setUploadingCover(false);
    }
  };

  const onDelete = async (id: string) => {
    if (!confirm('Delete this announcement?')) return;
    await adminApi.deleteAnnouncement(id);
    toast.success('Deleted');
    reload();
  };

  return (
    <PageLayout title="Announcements" subtitle="Post and manage school announcements">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Composer — styled like a post composer */}
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <Megaphone className="w-5 h-5 text-primary-600" />
            <h2 className="font-semibold text-gray-900">Post Announcement</h2>
          </div>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <Input label="Title" placeholder="Announcement title" {...register('title', { required: true })} />

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Body</label>
              <textarea
                className="input-field min-h-[140px] resize-none"
                placeholder="Write the announcement here…"
                {...register('content', { required: true })}
              />
            </div>

            {/* Cover image */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Cover image (optional)</label>
              <input ref={imageRef} type="file" accept="image/*" className="hidden" onChange={e => onCoverChange(e.target.files?.[0] || null)} />
              {coverPreview ? (
                <div className="relative rounded-xl overflow-hidden border border-gray-200">
                  <img src={coverPreview} alt="" className="w-full h-auto block" />
                  <button
                    type="button"
                    onClick={() => onCoverChange(null)}
                    className="absolute top-2 right-2 bg-white/90 hover:bg-white text-gray-700 rounded-full p-1.5 shadow"
                    aria-label="Remove cover"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => imageRef.current?.click()}
                  className="flex items-center gap-2 px-3 py-2 border border-dashed border-gray-300 rounded-xl text-sm text-gray-500 hover:border-primary-400 hover:text-primary-600 transition-colors w-full"
                >
                  <ImageIcon className="w-4 h-4" /> Add cover image
                </button>
              )}
            </div>

            <Select
              label="Audience"
              options={[
                { value: 'all', label: 'Everyone' },
                { value: 'parents', label: 'Parents Only' },
                { value: 'teachers', label: 'Teachers Only' },
                { value: 'students', label: 'Students Only' },
              ]}
              {...register('targetAudience')}
            />
            <Input label="Link (optional)" placeholder="https://youtube.com/watch?v=… or any URL" {...register('linkUrl')} />

            {/* Attachment */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Attachment (optional)</label>
              <input ref={fileRef} type="file" className="hidden" onChange={e => setAttachedFile(e.target.files?.[0] || null)} />
              {attachedFile ? (
                <div className="flex items-center gap-2 p-2.5 bg-primary-50 border border-primary-200 rounded-xl text-sm">
                  <Paperclip className="w-4 h-4 text-primary-600 flex-shrink-0" />
                  <span className="flex-1 truncate text-primary-700 font-medium">{attachedFile.name}</span>
                  <button type="button" onClick={() => { setAttachedFile(null); if (fileRef.current) fileRef.current.value = ''; }}>
                    <X className="w-4 h-4 text-primary-400 hover:text-primary-600" />
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-2 px-3 py-2 border border-dashed border-gray-300 rounded-xl text-sm text-gray-500 hover:border-primary-400 hover:text-primary-600 transition-colors w-full">
                  <Paperclip className="w-4 h-4" /> Attach a file
                </button>
              )}
            </div>

            <Button type="submit" loading={submitting || uploadingCover} fullWidth icon={<Megaphone className="w-4 h-4" />}>
              Post Announcement
            </Button>
          </form>
        </Card>

        {/* Posted announcements — post-style cards */}
        <div>
          <h2 className="font-semibold text-gray-900 mb-3">Posted Announcements ({announcements.length})</h2>
          {loading ? <LoadingSpinner /> : announcements.length === 0 ? (
            <EmptyState title="No announcements yet" icon={<Megaphone className="w-8 h-8 text-gray-400" />} />
          ) : (
            <Virtuoso
              useWindowScroll
              data={announcements}
              endReached={loadMore}
              components={{
                Footer: () => loadingMore
                  ? <p className="py-3 text-center text-sm text-gray-400">Loading…</p>
                  : null,
              }}
              itemContent={(_index, ann) => {
                const announcerName = ann.users?.role === 'admin'
                  ? (school?.name || 'School')
                  : (`${ann.users?.first_name ?? ''} ${ann.users?.last_name ?? ''}`.trim() || 'School');
                const avatar = ann.users?.profile_picture;

                return (
                  <article className="bg-white border border-gray-100 rounded-2xl overflow-hidden mb-4">
                    <div className="p-4">
                      <div className="flex items-center gap-3 mb-3">
                        {avatar ? (
                          <img src={avatar} alt="" className="w-9 h-9 rounded-full object-cover" />
                        ) : (
                          <div className="w-9 h-9 rounded-full bg-primary-50 flex items-center justify-center">
                            <Megaphone className="w-4 h-4 text-primary-600" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-gray-900 truncate">{announcerName}</p>
                          <p className="text-xs text-gray-400">{format(parseISO(ann.createdAt), 'MMM d, yyyy')}</p>
                        </div>
                        <span className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full font-semibold">
                          {ann.targetAudience === 'all' ? 'Everyone' : ann.targetAudience}
                        </span>
                        <button
                          onClick={() => onDelete(ann.id)}
                          className="p-1.5 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4 text-red-500" />
                        </button>
                      </div>
                      <h3 className="font-semibold text-gray-900 mb-2 line-clamp-2">{ann.title}</h3>
                      <p className="text-sm text-gray-600 leading-relaxed line-clamp-3 whitespace-pre-wrap">{ann.content}</p>
                    </div>
                    {ann.imageUrl && (
                      <img src={ann.imageUrl} alt="" className="w-full h-auto block" />
                    )}
                    <div className="flex items-center gap-4 px-4 py-3 border-t border-gray-100">
                      <span className="flex items-center gap-1 text-xs text-gray-500">
                        <Heart className="w-4 h-4" /> {ann.likes_count ?? 0}
                      </span>
                      <span className="flex items-center gap-1 text-xs text-gray-500">
                        <MessageCircle className="w-4 h-4" /> {ann.comments_count ?? 0}
                      </span>
                    </div>
                  </article>
                );
              }}
            />
          )}
        </div>
      </div>
    </PageLayout>
  );
}
