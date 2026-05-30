// Read-only documents list for the archived profile. Mirrors the
// active-employee DocumentsTab layout (category / number / expires /
// uploaded / size + scan status badge) but drops upload / edit / void
// actions — archived data is immutable. Download still works because
// the signed-URL endpoint queries employee_documents by id only and
// doesn't care about owner_type.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Download, ShieldAlert } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { adminApi } from '../../../../services/api';
import Card from '../../../common/Card';
import EmptyState from '../../../common/EmptyState';
import type { EmployeeDocument, Sensitivity } from '../../../../types/employeeDocs';

interface Props {
  documents: EmployeeDocument[];
  hrOfficer: boolean;
}

const fmtDate = (d?: string | null) => (d ? format(parseISO(d), 'MMM d, yyyy') : '—');
const fmtBytes = (n?: number) => {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

const sensitivityClass: Record<Sensitivity, string> = {
  low: 'bg-gray-100 text-gray-600',
  medium: 'bg-blue-50 text-blue-700',
  high: 'bg-rose-50 text-rose-700',
};

export default function ArchivedDocumentsView({ documents, hrOfficer }: Props) {
  const { t } = useTranslation();
  const [downloading, setDownloading] = useState<string | null>(null);

  const onDownload = async (doc: EmployeeDocument) => {
    setDownloading(doc.id);
    try {
      const r = await adminApi.getEmployeeDocumentSignedUrl(doc.id);
      const url = r.data?.url;
      if (!url) { toast.error(t('admin.docs.failed_link')); return; }
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || t('admin.docs.failed_link'));
    } finally { setDownloading(null); }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">{t('admin.docs.title')}</h3>
          <p className="text-xs text-gray-500 mt-0.5">{t('admin.arch_profile.docs_subtitle', 'Read-only view of documents on file at the time of archive.')}</p>
        </div>
        {!hrOfficer && (
          <span className="inline-flex items-center gap-1 text-[11px] text-gray-500 bg-gray-50 px-2 py-1 rounded-full">
            <ShieldAlert className="w-3 h-3" /> {t('admin.docs.hr_officer_hint')}
          </span>
        )}
      </div>

      {documents.length === 0 ? (
        <EmptyState title={t('admin.docs.empty')} />
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">{t('admin.docs.col_category')}</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">{t('admin.docs.col_number')}</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">{t('admin.docs.col_expires')}</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">{t('admin.docs.col_uploaded')}</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">{t('admin.docs.col_size')}</th>
                  <th className="text-right px-3 py-2 text-xs font-medium text-gray-500">{t('admin.docs.col_actions')}</th>
                </tr>
              </thead>
              <tbody>
                {documents.map(d => (
                  <tr key={d.id} className="border-b border-gray-50 last:border-0">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-gray-900">{d.category}</span>
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${sensitivityClass[d.sensitivity]}`}>
                          {t(`admin.docs.sensitivity_${d.sensitivity}`)}
                        </span>
                        {d.scanStatus === 'pending' && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700">{t('admin.docs.scan_pending')}</span>
                        )}
                        {d.scanStatus === 'infected' && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700">{t('admin.docs.scan_infected')}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      {d.redacted ? <span className="text-gray-400">{t('admin.docs.redacted')}</span> : d.documentNumber || <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-3 py-2 text-gray-700">{d.redacted ? '—' : fmtDate(d.expiresOn ?? null)}</td>
                    <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{fmtDate(d.uploadedAt)}</td>
                    <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{d.redacted ? '—' : fmtBytes(d.byteSize)}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        {!d.redacted && d.scanStatus !== 'infected' && (
                          <button
                            type="button" onClick={() => onDownload(d)}
                            disabled={d.scanStatus === 'pending' || downloading === d.id}
                            title={t('admin.docs.download')}
                            className="p-1.5 rounded-md hover:bg-gray-100 text-gray-600 disabled:opacity-40 disabled:cursor-not-allowed"
                          ><Download className="w-4 h-4" /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
