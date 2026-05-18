import { useState } from 'react';
import { toast } from 'react-toastify';
import { FileText, FileSpreadsheet, DatabaseBackup, ShieldCheck } from 'lucide-react';
import { adminApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import ArchivedStudentsTab from './ArchivedStudentsTab';
import GraduatedStudentsTab from './GraduatedStudentsTab';
import ArchivedEmployeesTab from './ArchivedEmployeesTab';

export default function ArchiveManagement() {
  const [activeTab, setActiveTab] = useState<'archived' | 'graduated' | 'employees'>('archived');
  const [pdfBusy, setPdfBusy] = useState(false);
  const [xlsxBusy, setXlsxBusy] = useState(false);
  const isEmployees = activeTab === 'employees';

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

  const stamp = () => new Date().toISOString().split('T')[0];

  const downloadPdf = async () => {
    setPdfBusy(true);
    try {
      const res = isEmployees ? await adminApi.exportEmployeeArchivePdf() : await adminApi.exportArchivePdf();
      triggerDownload(res.data, `${isEmployees ? 'employee-archive' : 'archive'}-${stamp()}.pdf`);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to download PDF');
    } finally {
      setPdfBusy(false);
    }
  };

  const downloadXlsx = async () => {
    setXlsxBusy(true);
    try {
      const res = isEmployees ? await adminApi.exportEmployeeArchiveXlsx() : await adminApi.exportArchiveXlsx();
      triggerDownload(res.data, `${isEmployees ? 'employee-archive' : 'archive'}-${stamp()}.xlsx`);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to download Excel');
    } finally {
      setXlsxBusy(false);
    }
  };

  const [backupBusy, setBackupBusy] = useState(false);
  const downloadFullBackup = async () => {
    setBackupBusy(true);
    try {
      const res = await adminApi.exportFullArchiveBackup();
      triggerDownload(res.data, `archive-backup-${stamp()}.json`);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to download backup');
    } finally {
      setBackupBusy(false);
    }
  };

  const [verifyBusy, setVerifyBusy] = useState(false);
  const verifyIntegrity = async () => {
    setVerifyBusy(true);
    try {
      const res = await adminApi.verifyArchiveIntegrity();
      const d = res.data as { ok: boolean; tamperedCount: number; unhashedCount: number };
      if (d.ok) {
        toast.success(
          d.unhashedCount > 0
            ? `Integrity OK. ${d.unhashedCount} pre-019 record(s) without a baseline hash.`
            : 'Integrity verified — no tampering detected.',
          { autoClose: 7000 },
        );
      } else {
        toast.error(`Integrity check FAILED: ${d.tamperedCount} altered/broken record(s). Investigate immediately.`, { autoClose: 12000 });
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to verify integrity');
    } finally {
      setVerifyBusy(false);
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
          <button
            onClick={() => setActiveTab('employees')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === 'employees' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Employees
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
          <button
            onClick={downloadFullBackup}
            disabled={backupBusy}
            title="Full machine-readable backup of every archived student & employee — keep your own copy"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            <DatabaseBackup className="w-4 h-4" />
            {backupBusy ? 'Preparing…' : 'Full backup (JSON)'}
          </button>
          <button
            onClick={verifyIntegrity}
            disabled={verifyBusy}
            title="Recompute every snapshot hash + the audit chain and report any tampering"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            <ShieldCheck className="w-4 h-4" />
            {verifyBusy ? 'Checking…' : 'Verify integrity'}
          </button>
        </div>
      </div>

      {activeTab === 'archived' && <ArchivedStudentsTab />}
      {activeTab === 'graduated' && <GraduatedStudentsTab />}
      {activeTab === 'employees' && <ArchivedEmployeesTab />}
    </PageLayout>
  );
}
