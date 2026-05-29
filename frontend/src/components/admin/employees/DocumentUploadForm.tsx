// Extracted from DocumentsTab's upload modal body so the wizard can render
// the same upload flow inline (no modal chrome). The form owns its own
// upload state and calls onUploaded() after a successful POST so the caller
// can refresh whatever list it renders.
//
// Categories are passed in by the caller — the DocumentsTab already loads
// them for its table render, so we avoid a duplicate fetch. The wizard's
// Documents section loads them once on mount and passes them through.

import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { ShieldAlert, X } from 'lucide-react';
import { adminApi } from '../../../services/api';
import Button from '../../common/Button';
import Input from '../../common/Input';
import Select from '../../common/Select';
import type { DocumentCategory, EmployeeRole } from '../../../types/employeeDocs';

const ALLOWED_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';
const MAX_BYTES = 10 * 1024 * 1024;

interface Props {
  role: EmployeeRole;
  employeeId: string;
  /** Active document categories. Caller is responsible for fetching them. */
  categories: DocumentCategory[];
  /** Called after a successful upload. The form clears itself first. */
  onUploaded?: () => void;
  /** If provided, render a Cancel button (modal callers wire it to close). */
  onCancel?: () => void;
}

export default function DocumentUploadForm({ role, employeeId, categories, onUploaded, onCancel }: Props) {
  const { t } = useTranslation();
  const [uploading, setUploading] = useState(false);
  const [upFile, setUpFile] = useState<File | null>(null);
  const [upCategory, setUpCategory] = useState('');
  const [upNumber, setUpNumber] = useState('');
  const [upIssued, setUpIssued] = useState('');
  const [upExpires, setUpExpires] = useState('');
  const [upNotes, setUpNotes] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  const selectedCategoryDef = useMemo(
    () => categories.find(c => c.key === upCategory) ?? null,
    [categories, upCategory],
  );

  const reset = () => {
    setUpFile(null); setUpCategory(''); setUpNumber('');
    setUpIssued(''); setUpExpires(''); setUpNotes('');
    if (fileRef.current) fileRef.current.value = '';
  };

  const onUpload = async () => {
    if (!upFile) { toast.error(t('admin.docs.no_file')); return; }
    if (!upCategory) { toast.error(t('admin.docs.no_category')); return; }
    if (upFile.size > MAX_BYTES) { toast.error(t('admin.docs.too_large')); return; }
    setUploading(true);
    try {
      await adminApi.uploadEmployeeDocument(role, employeeId, upFile, {
        category: upCategory,
        document_number: upNumber || undefined,
        issued_on: upIssued || undefined,
        expires_on: upExpires || undefined,
        notes: upNotes || undefined,
      });
      toast.success(t('admin.docs.uploaded'));
      reset();
      onUploaded?.();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || t('admin.docs.failed_upload'));
    } finally { setUploading(false); }
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.docs.field_category')}</label>
        <Select
          value={upCategory}
          onChange={e => setUpCategory(e.target.value)}
          options={categories.map(c => ({ value: c.key, label: c.label }))}
          placeholder={t('admin.docs.field_category')}
        />
        {selectedCategoryDef?.sensitivity === 'high' && (
          <p className="text-[11px] text-rose-600 mt-1 flex items-center gap-1">
            <ShieldAlert className="w-3 h-3" /> {t('admin.docs.high_sensitivity_warn')}
          </p>
        )}
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.docs.field_file')}</label>
        <input
          ref={fileRef}
          type="file"
          accept={ALLOWED_ACCEPT}
          onChange={e => setUpFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-gray-700 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100"
        />
        <p className="text-[11px] text-gray-400 mt-1">{t('admin.docs.field_file_hint')}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.docs.field_number')}</label>
          <Input value={upNumber} onChange={e => setUpNumber(e.target.value)} placeholder={t('admin.docs.field_number_ph')} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.docs.field_issued')}</label>
          <Input type="date" value={upIssued} onChange={e => setUpIssued(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            {t('admin.docs.field_expires')}
            {selectedCategoryDef?.requiresExpiry && <span className="text-rose-600">*</span>}
          </label>
          <Input type="date" value={upExpires} onChange={e => setUpExpires(e.target.value)} />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.docs.field_notes')}</label>
        <textarea
          value={upNotes} onChange={e => setUpNotes(e.target.value)} rows={2}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      </div>

      <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
        {onCancel && (
          <Button variant="ghost" onClick={() => { reset(); onCancel(); }} icon={<X className="w-4 h-4" />}>
            {t('common.cancel')}
          </Button>
        )}
        <Button onClick={onUpload} loading={uploading} disabled={!upFile || !upCategory}>
          {t('admin.docs.do_upload')}
        </Button>
      </div>
    </div>
  );
}
