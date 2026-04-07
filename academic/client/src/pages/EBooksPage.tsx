import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Upload, Trash2, Search, Loader2, BookMarked } from 'lucide-react';
import { toast } from 'react-toastify';
import { academicApi } from '../services/api';
import { useAuthStore } from '../store/authStore';
import Navbar from '../components/layout/Navbar';
import type { Ebook, AcademicClass } from '../types';

function EbookCard({ ebook, canDelete, onDelete }: {
  ebook: Ebook;
  canDelete: boolean;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden hover:shadow-md hover:border-primary-100 transition-all group">
      {/* Cover */}
      <div className="h-36 bg-gradient-to-br from-primary-50 to-indigo-100 flex items-center justify-center relative">
        {ebook.cover_url ? (
          <img src={ebook.cover_url} alt={ebook.title} className="h-full w-full object-cover" />
        ) : (
          <BookMarked className="w-12 h-12 text-primary-300" />
        )}
        {canDelete && (
          <button
            onClick={() => onDelete(ebook.id)}
            className="absolute top-2 right-2 p-1.5 bg-white/90 rounded-lg text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <div className="p-4">
        <div className="flex flex-wrap gap-1.5 mb-2">
          {ebook.classes?.name && (
            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{ebook.classes.name}</span>
          )}
          {ebook.subject && (
            <span className="text-xs bg-primary-50 text-primary-700 px-2 py-0.5 rounded-full">{ebook.subject}</span>
          )}
        </div>
        <h3 className="font-semibold text-gray-900 text-sm line-clamp-2 mb-1">{ebook.title}</h3>
        {ebook.author && <p className="text-xs text-gray-400">by {ebook.author}</p>}
        {ebook.description && <p className="text-xs text-gray-500 mt-2 line-clamp-2">{ebook.description}</p>}
        <Link
          to={`/ebooks/${ebook.id}/read`}
          state={{ ebook }}
          className="mt-3 flex items-center justify-center gap-1.5 w-full py-2 bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold rounded-lg transition-colors"
        >
          <BookOpen className="w-3.5 h-3.5" /> Read
        </Link>
      </div>
    </div>
  );
}

export default function EBooksPage() {
  const { user } = useAuthStore();
  const [ebooks, setEbooks] = useState<Ebook[]>([]);
  const [classes, setClasses] = useState<AcademicClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({ title: '', subject: '', author: '', description: '', classId: '' });
  const [file, setFile] = useState<File | null>(null);

  const canUpload = user?.role === 'admin';
  const canDelete = user?.role === 'admin';

  useEffect(() => {
    Promise.all([academicApi.getEbooks(), academicApi.getClasses()])
      .then(([eb, cl]) => {
        setEbooks(eb.data ?? []);
        setClasses(cl.data ?? []);
      })
      .finally(() => setLoading(false));
  }, []);

  const filtered = ebooks.filter(e =>
    e.title.toLowerCase().includes(search.toLowerCase()) ||
    e.subject?.toLowerCase().includes(search.toLowerCase()) ||
    e.author?.toLowerCase().includes(search.toLowerCase())
  );

  const handleUpload = async () => {
    if (!form.title.trim()) { toast.error('Title is required'); return; }
    if (!file) { toast.error('Please select a PDF file'); return; }
    setUploading(true);
    try {
      const res = await academicApi.uploadEbook({ ...form, file });
      setEbooks(prev => [res.data, ...prev]);
      setForm({ title: '', subject: '', author: '', description: '', classId: '' });
      setFile(null);
      setShowUpload(false);
      toast.success('E-book uploaded');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this e-book?')) return;
    try {
      await academicApi.deleteEbook(id);
      setEbooks(prev => prev.filter(e => e.id !== id));
      toast.success('E-book deleted');
    } catch {
      toast.error('Failed to delete');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">E-Books</h1>
            <p className="text-sm text-gray-500 mt-0.5">Digital books for your classes</p>
          </div>
          {canUpload && (
            <button
              onClick={() => setShowUpload(v => !v)}
              className="inline-flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors"
            >
              <Upload className="w-4 h-4" /> Upload E-Book
            </button>
          )}
        </div>

        {/* Upload form */}
        {showUpload && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-6">
            <h2 className="font-semibold text-gray-900 mb-4">Upload New E-Book</h2>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Title <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="Book title"
                  className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Class</label>
                <select
                  value={form.classId}
                  onChange={e => setForm(f => ({ ...f, classId: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
                >
                  <option value="">All classes</option>
                  {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Subject</label>
                <input
                  type="text"
                  value={form.subject}
                  onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
                  placeholder="e.g. Mathematics"
                  className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Author</label>
                <input
                  type="text"
                  value={form.author}
                  onChange={e => setForm(f => ({ ...f, author: e.target.value }))}
                  placeholder="Author name"
                  className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Description</label>
                <input
                  type="text"
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Short description"
                  className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">File (PDF) <span className="text-red-500">*</span></label>
                <label className="flex items-center gap-3 border-2 border-dashed border-gray-200 rounded-xl px-4 py-4 cursor-pointer hover:border-primary-400 hover:bg-primary-50/20 transition-colors">
                  <Upload className="w-5 h-5 text-gray-300 flex-shrink-0" />
                  <span className="text-sm text-gray-500">{file ? file.name : 'Click to select PDF file'}</span>
                  <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={e => setFile(e.target.files?.[0] ?? null)} />
                </label>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setShowUpload(false); setFile(null); }}
                className="px-4 py-2 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleUpload}
                disabled={uploading}
                className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors"
              >
                {uploading && <Loader2 className="w-4 h-4 animate-spin" />}
                Upload
              </button>
            </div>
          </div>
        )}

        {/* Search */}
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search e-books..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full border border-gray-200 rounded-xl pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="font-medium">No e-books yet</p>
            {canUpload && <p className="text-sm mt-1">Upload the first e-book for your class.</p>}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {filtered.map(e => (
              <EbookCard key={e.id} ebook={e} canDelete={canDelete} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
