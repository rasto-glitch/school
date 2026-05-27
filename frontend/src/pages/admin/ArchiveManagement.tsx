import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { FileText, FileSpreadsheet, DatabaseBackup, ShieldCheck } from 'lucide-react';
import { adminApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import ArchivedStudentsTab from './ArchivedStudentsTab';
import GraduatedStudentsTab from './GraduatedStudentsTab';
import ArchivedEmployeesTab from './ArchivedEmployeesTab';

export default function ArchiveManagement() {
  const { t } = useTranslation();
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
      toast.error(err.response?.data?.error || t('admin.archive_mgmt.failed_pdf'));
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
      toast.error(err.response?.data?.error || t('admin.archive_mgmt.failed_excel'));
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
      toast.error(err.response?.data?.error || t('admin.archive_mgmt.failed_backup'));
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
            ? t('admin.archive_mgmt.integrity_ok_unhashed', { count: d.unhashedCount })
            : t('admin.archive_mgmt.integrity_ok'),
          { autoClose: 7000 },
        );
      } else {
        toast.error(t('admin.archive_mgmt.integrity_failed', { count: d.tamperedCount }), { autoClose: 12000 });
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('admin.archive_mgmt.failed_verify'));
    } finally {
      setVerifyBusy(false);
    }
  };

  return (
    <PageLayout title={t('admin.archive_mgmt.title')}>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          <button
            onClick={() => setActiveTab('archived')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === 'archived' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            {t('admin.archive_mgmt.tab_archived')}
          </button>
          <button
            onClick={() => setActiveTab('graduated')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === 'graduated' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            {t('admin.archive_mgmt.tab_graduated')}
          </button>
          <button
            onClick={() => setActiveTab('employees')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === 'employees' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            {t('admin.archive_mgmt.tab_employees')}
          </button>
        </div>
        <div className="flex gap-2">
          <button
            onClick={downloadPdf}
            disabled={pdfBusy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            <FileText className="w-4 h-4" />
            {pdfBusy ? t('admin.archive_mgmt.preparing') : t('admin.archive_mgmt.download_pdf')}
          </button>
          <button
            onClick={downloadXlsx}
            disabled={xlsxBusy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            <FileSpreadsheet className="w-4 h-4" />
            {xlsxBusy ? t('admin.archive_mgmt.preparing') : t('admin.archive_mgmt.download_excel')}
          </button>
          <button
            onClick={downloadFullBackup}
            disabled={backupBusy}
            title={t('admin.archive_mgmt.backup_title')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            <DatabaseBackup className="w-4 h-4" />
            {backupBusy ? t('admin.archive_mgmt.preparing') : t('admin.archive_mgmt.full_backup')}
          </button>
          <button
            onClick={verifyIntegrity}
            disabled={verifyBusy}
            title={t('admin.archive_mgmt.verify_title')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            <ShieldCheck className="w-4 h-4" />
            {verifyBusy ? t('admin.archive_mgmt.checking') : t('admin.archive_mgmt.verify_integrity')}
          </button>
        </div>
      </div>

      {activeTab === 'archived' && <ArchivedStudentsTab />}
      {activeTab === 'graduated' && <GraduatedStudentsTab />}
      {activeTab === 'employees' && <ArchivedEmployeesTab />}
    </PageLayout>
  );
}
