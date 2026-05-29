// Section 5 of the NewEmployeeWizard. Lists already-uploaded documents
// (including scan status if the ClamAV worker is enabled) and renders the
// shared DocumentUploadForm inline so operators can drop in several files
// without a modal hop. The form clears itself after each successful POST.

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { FileText } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { adminApi } from '../../../../services/api';
import LoadingSpinner from '../../../common/LoadingSpinner';
import DocumentUploadForm from '../DocumentUploadForm';
import type {
  EmployeeDocument, DocumentCategory, EmployeeRole,
} from '../../../../types/employeeDocs';

interface Props {
  role: EmployeeRole;
  employeeId: string;
  /** Reports the number of uploaded documents to the wizard shell. */
  onCountChange?: (n: number) => void;
}

const fmtDate = (d?: string | null) => (d ? format(parseISO(d), 'MMM d, yyyy') : '—');

export default function DocumentsSection({ role, employeeId, onCountChange }: Props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [documents, setDocuments] = useState<EmployeeDocument[]>([]);
  const [categories, setCategories] = useState<DocumentCategory[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const [docsRes, catsRes] = await Promise.all([
        adminApi.listEmployeeDocuments(role, employeeId),
        adminApi.getEmployeeDocumentCategories(),
      ]);
      const docs: EmployeeDocument[] = docsRes.data?.documents ?? [];
      setDocuments(docs);
      setCategories(catsRes.data?.categories ?? []);
      onCountChange?.(docs.length);
    } catch {
      toast.error(t('admin.docs.failed_load'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [role, employeeId]);

  const activeCategories = useMemo(() => categories.filter(c => c.active), [categories]);
  const categoryLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categories) m.set(c.key, c.label);
    return (key: string) => m.get(key) ?? key;
  }, [categories]);

  if (loading) return <div className="flex justify-center py-6"><LoadingSpinner /></div>;

  return (
    <div className="space-y-3">
      {documents.length > 0 && (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <ul className="divide-y divide-gray-100">
            {documents.map(d => (
              <li key={d.id} className="flex items-center gap-3 px-3 py-2">
                <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-900 truncate">{categoryLabel(d.category)}</p>
                  <p className="text-xs text-gray-500 truncate">
                    {d.filename}
                    {d.uploadedAt && ` · ${fmtDate(d.uploadedAt)}`}
                  </p>
                </div>
                {d.scanStatus === 'pending' && (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700">
                    {t('admin.docs.scan_pending')}
                  </span>
                )}
                {d.scanStatus === 'infected' && (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700">
                    {t('admin.docs.scan_infected')}
                  </span>
                )}
                {d.scanStatus === 'clean' && (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                    {t('admin.wizard.scan_clean', 'Clean')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="border border-gray-200 rounded-lg p-3">
        <DocumentUploadForm
          role={role}
          employeeId={employeeId}
          categories={activeCategories}
          onUploaded={() => load()}
        />
      </div>
    </div>
  );
}
