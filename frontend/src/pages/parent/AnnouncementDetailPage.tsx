import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Megaphone, ArrowLeft, Paperclip, ExternalLink } from 'lucide-react';
import { parentApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Badge from '../../components/common/Badge';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import Button from '../../components/common/Button';
import type { Announcement } from '../../types';
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

export default function AnnouncementDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<LinkPreview | null>(null);

  useEffect(() => {
    if (!id) return;
    parentApi.getAnnouncementById(id).then(r => setAnnouncement(r.data || null)).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!announcement?.linkUrl) return;
    parentApi.getLinkPreview(announcement.linkUrl).then(r => setPreview(r.data)).catch(() => {});
  }, [announcement?.linkUrl]);

  if (loading) return <PageLayout title="Announcement"><LoadingSpinner /></PageLayout>;
  if (!announcement) return <PageLayout title="Announcement"><p className="text-gray-500">Announcement not found.</p></PageLayout>;

  return (
    <PageLayout title="Announcement">
      <div className="max-w-2xl space-y-4">
        <Button variant="ghost" size="sm" icon={<ArrowLeft className="w-4 h-4" />} onClick={() => navigate(-1)}>Back</Button>
        <div className="bg-gradient-to-r from-primary-600 to-secondary-500 rounded-2xl p-6 text-white">
          <div className="flex items-center gap-2 mb-3 opacity-80">
            <Megaphone className="w-5 h-5" />
            <span className="text-sm font-medium">School Announcement</span>
            <Badge color="gray">{announcement.targetAudience}</Badge>
          </div>
          <h1 className="text-2xl font-bold mb-3">{announcement.title}</h1>
          <p className="text-white/90 leading-relaxed whitespace-pre-wrap">{announcement.content}</p>
          <p className="text-white/60 text-xs mt-4">{format(parseISO(announcement.createdAt), 'MMMM d, yyyy · h:mm a')}</p>
        </div>
        {announcement.linkUrl && (
          <div className="p-4 bg-white rounded-2xl border border-gray-200 space-y-3">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Link</h2>
            {preview?.type === 'instagram' ? (
              <a href={announcement.linkUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-3 p-4 rounded-xl hover:opacity-90 transition-opacity"
                style={{ background: 'linear-gradient(135deg, #F58529, #DD2A7B, #8134AF)' }}>
                <span className="text-2xl">📸</span>
                <div className="min-w-0">
                  <p className="text-white font-bold text-sm">{preview.title}</p>
                  <p className="text-white/80 text-xs">{preview.description}</p>
                </div>
                <ExternalLink className="w-4 h-4 text-white ml-auto flex-shrink-0" />
              </a>
            ) : preview?.type === 'facebook' ? (
              <a href={announcement.linkUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-3 p-4 rounded-xl hover:opacity-90 transition-opacity"
                style={{ backgroundColor: '#1877F2' }}>
                <span className="text-2xl">👥</span>
                <div className="min-w-0">
                  <p className="text-white font-bold text-sm">{preview.title}</p>
                  <p className="text-white/80 text-xs">{preview.description}</p>
                </div>
                <ExternalLink className="w-4 h-4 text-white ml-auto flex-shrink-0" />
              </a>
            ) : preview?.type === 'youtube' ? (
              <div className="space-y-2">
                <iframe
                  src={`https://www.youtube.com/embed/${preview.videoId}`}
                  className="w-full rounded-xl border border-gray-200"
                  style={{ aspectRatio: '16/9' }}
                  allowFullScreen
                  title={preview.title}
                />
                <a href={announcement.linkUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-primary-600 hover:underline">
                  <ExternalLink className="w-3.5 h-3.5" /> Watch on YouTube
                </a>
              </div>
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
                  <span className="inline-flex items-center gap-1 text-xs text-primary-600 mt-1.5 group-hover:underline">
                    <ExternalLink className="w-3 h-3" /> Open link
                  </span>
                </div>
              </a>
            ) : (
              <a href={announcement.linkUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary-50 text-primary-700 rounded-xl hover:bg-primary-100 transition-colors font-medium text-sm">
                <ExternalLink className="w-4 h-4" /> Open Link
              </a>
            )}
          </div>
        )}

        {announcement.attachmentUrl && (() => {
          const ext = announcement.attachmentUrl!.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
          const isImage = ['jpg','jpeg','png','gif','webp'].includes(ext);
          const isPdf = ext === 'pdf';
          return (
            <div className="p-4 bg-white rounded-2xl border border-gray-200 space-y-2">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Attachment</h2>
              {isImage ? (
                <>
                  <img src={announcement.attachmentUrl} alt="Attachment" className="w-full max-h-72 object-contain rounded-xl border border-gray-200 bg-gray-50" />
                  <a href={announcement.attachmentUrl} download target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-primary-50 text-primary-700 rounded-xl hover:bg-primary-100 transition-colors font-medium text-sm">
                    <Paperclip className="w-4 h-4" /> Download
                  </a>
                </>
              ) : isPdf ? (
                <>
                  <iframe src={announcement.attachmentUrl} className="w-full h-96 rounded-xl border border-gray-200" title="PDF Preview" />
                  <a href={announcement.attachmentUrl} download target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-primary-50 text-primary-700 rounded-xl hover:bg-primary-100 transition-colors font-medium text-sm">
                    <Paperclip className="w-4 h-4" /> Download PDF
                  </a>
                </>
              ) : (
                <a href={announcement.attachmentUrl} download target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary-50 text-primary-700 rounded-xl hover:bg-primary-100 transition-colors font-medium text-sm">
                  <Paperclip className="w-4 h-4" /> Download Attachment
                </a>
              )}
            </div>
          );
        })()}
      </div>
    </PageLayout>
  );
}
