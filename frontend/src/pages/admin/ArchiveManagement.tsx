import { useState } from 'react';
import { toast } from 'react-toastify';
import { FileText, FileSpreadsheet } from 'lucide-react';
import { adminApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import ArchivedStudentsTab from './ArchivedStudentsTab';
import GraduatedStudentsTab from './GraduatedStudentsTab';

export default function ArchiveManagement() {
  const [activeTab, setActiveTab] = useState<'archived' | 'graduated'>('archived');
  const [pdfBusy, setPdfBusy] = useState(false);
  const [xlsxBusy, setXlsxBusy] = useState(false);

  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadPdf = async () => {
    setPdfBusy(true);
    try {
      const res = await adminApi.exportArchivePdf();
      triggerDownload(res.data, `archive-${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to download PDF');
    } finally {
      setPdfBusy(false);
    }
  };

  const downloadXlsx = async () => {
    setXlsxBusy(true);
    try {
      const res = await adminApi.exportArchiveXlsx();
      triggerDownload(res.data, `archive-${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to download Excel');
    } finally {
      setXlsxBusy(false);
    }
  };

  return (
    <PageLayout title="Archive">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          <button
            onClick={() => setActiveTab('archived')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === 'archived' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Archived
          </button>
          <button
            onClick={() => setActiveTab('graduated')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === 'graduated' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Graduated
          </button>
        </div>
        <div className="flex gap-2">
          <button
            onClick={downloadPdf}
            disabled={pdfBusy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            <FileText className="w-4 h-4" />
            {pdfBusy ? 'Preparing…' : 'Download PDF'}
          </button>
          <button
            onClick={downloadXlsx}
            disabled={xlsxBusy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            <FileSpreadsheet className="w-4 h-4" />
            {xlsxBusy ? 'Preparing…' : 'Download Excel'}
          </button>
        </div>
      </div>

      {activeTab === 'archived' && <ArchivedStudentsTab />}
      {activeTab === 'graduated' && <GraduatedStudentsTab />}
    </PageLayout>
  );
}
