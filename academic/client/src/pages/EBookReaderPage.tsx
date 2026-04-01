import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { ArrowLeft, Download, ExternalLink } from 'lucide-react';
import { academicApi } from '../services/api';
import Navbar from '../components/layout/Navbar';
import type { Ebook } from '../types';

export default function EBookReaderPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [ebook, setEbook] = useState<Ebook | null>(location.state?.ebook ?? null);
  const [loading, setLoading] = useState(!location.state?.ebook);

  useEffect(() => {
    if (ebook || !id) return;
    // If navigated directly (no state), fetch the list and find it
    academicApi.getEbooks()
      .then(r => {
        const found = (r.data ?? []).find((e: Ebook) => e.id === id);
        if (found) setEbook(found);
        else navigate('/ebooks');
      })
      .finally(() => setLoading(false));
  }, [id]);

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

  if (!ebook) return null;

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      {/* Top bar */}
      <div className="bg-gray-800 border-b border-gray-700 px-4 h-12 flex items-center gap-4 flex-shrink-0">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-sm text-gray-300 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-white truncate">{ebook.title}</span>
          {ebook.classes?.name && (
            <span className="ml-2 text-xs text-gray-400">{ebook.classes.name}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <a
            href={ebook.file_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-gray-300 hover:text-white border border-gray-600 hover:border-gray-400 rounded-lg px-3 py-1.5 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" /> Open in new tab
          </a>
          <a
            href={ebook.file_url}
            download
            className="flex items-center gap-1.5 text-xs bg-primary-600 hover:bg-primary-700 text-white rounded-lg px-3 py-1.5 transition-colors"
          >
            <Download className="w-3.5 h-3.5" /> Download
          </a>
        </div>
      </div>

      {/* PDF viewer */}
      <div className="flex-1">
        <iframe
          src={`${ebook.file_url}#toolbar=1&navpanes=1&view=FitH`}
          title={ebook.title}
          className="w-full h-full border-0"
          style={{ height: 'calc(100vh - 48px)' }}
        />
      </div>
    </div>
  );
}
