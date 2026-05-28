import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Download, Edit2, Plus, ShieldAlert, Trash2, X } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { adminApi } from '../../../services/api';
import Button from '../../common/Button';
import Card from '../../common/Card';
import Input from '../../common/Input';
import Select from '../../common/Select';
import Modal from '../../common/Modal';
import LoadingSpinner from '../../common/LoadingSpinner';
import EmptyState from '../../common/EmptyState';
import type {
  EmployeeDocument, DocumentCategory, EmployeeRole, Sensitivity,
} from '../../../types/employeeDocs';

// Wave 1 documents tab. Lives inside EmployeeProfileView. Loads the
// category catalog + documents in parallel on mount; refetches after every
// mutation. Sensitive-row rendering matches the backend's redaction model.

const ALLOWED_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';
const MAX_BYTES = 10 * 1024 * 1024;

interface Props {
  role: EmployeeRole;
  employeeId: string;
}

const fmtDate = (d?: string | null) => (d ? format(parseISO(d), 'MMM d, yyyy') : '—');
const fmtBytes = (n?: number) => {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

function sensitivityBadge(s: Sensitivity, t: (k: string) => string) {
  const map: Record<Sensitivity, string> = {
    low: 'bg-gray-100 text-gray-600',
    medium: 'bg-blue-50 text-blue-700',
    high: 'bg-rose-50 text-rose-700',
  };
  return (
    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${map[s]}`}>
      {t(`admin.docs.sensitivity_${s}`)}
    </span>
  );
}

function expiryPill(expiresOn: string | null | undefined, t: (k: string, opts?: Record<string, unknown>) => string) {
  if (!expiresOn) return <span className="text-xs text-gray-400">—</span>;
  const days = Math.ceil((new Date(expiresOn).getTime() - Date.now()) / (24 * 3600 * 1000));
  const cls =
    days < 0 ? 'bg-rose-100 text-rose-700'
    : days <= 30 ? 'bg-amber-100 text-amber-700'
    : 'bg-emerald-50 text-emerald-700';
  const label =
    days < 0 ? t('admin.docs.expired', { date: expiresOn })
    : t('admin.docs.expires_in', { date: expiresOn, days });
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>{label}</span>;
}

export default function DocumentsTab({ role, employeeId }: Props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [documents, setDocuments] = useState<EmployeeDocument[]>([]);
  const [categories, setCategories] = useState<DocumentCategory[]>([]);
  const [hrOfficer, setHrOfficer] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);

  // Per-row metadata edit state
  const [editingDoc, setEditingDoc] = useState<EmployeeDocument | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editNumber, setEditNumber] = useState('');
  const [editIssued, setEditIssued] = useState('');
  const [editExpires, setEditExpires] = useState('');
  const [editNotes, setEditNotes] = useState('');

  // Upload form state
  const [upFile, setUpFile] = useState<File | null>(null);
  const [upCategory, setUpCategory] = useState('');
  const [upNumber, setUpNumber] = useState('');
  const [upIssued, setUpIssued] = useState('');
  const [upExpires, setUpExpires] = useState('');
  const [upNotes, setUpNotes] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [docsRes, catsRes] = await Promise.all([
        adminApi.listEmployeeDocuments(role, employeeId),
        adminApi.getEmployeeDocumentCategories(),
      ]);
      setDocuments(docsRes.data?.documents ?? []);
      setHrOfficer(!!docsRes.data?.hrOfficer);
      setCategories(catsRes.data?.categories ?? []);
    } catch (e) {
      toast.error(t('admin.docs.failed_load'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [role, employeeId]);

  const activeCategories = useMemo(
    () => categories.filter(c => c.active),
    [categories],
  );
  const categoryLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categories) m.set(c.key, c.label);
    return (key: string) => m.get(key) ?? key;
  }, [categories]);
  const selectedCategoryDef = useMemo(
    () => activeCategories.find(c => c.key === upCategory) ?? null,
    [activeCategories, upCategory],
  );

  const resetUploadForm = () => {
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
      resetUploadForm();
      setShowUpload(false);
      await load();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || t('admin.docs.failed_upload'));
    } finally { setUploading(false); }
  };

  const onDownload = async (doc: EmployeeDocument) => {
    try {
      const r = await adminApi.getEmployeeDocumentSignedUrl(doc.id);
      const url = r.data?.url;
      if (!url) { toast.error(t('admin.docs.failed_link')); return; }
      // Open in a new tab — Content-Disposition: attachment makes the browser
      // download instead of rendering, defending against H-2-style XSS.
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || t('admin.docs.failed_link'));
    }
  };

  const openEdit = (doc: EmployeeDocument) => {
    setEditingDoc(doc);
    setEditNumber(doc.documentNumber ?? '');
    setEditIssued(doc.issuedOn ?? '');
    setEditExpires(doc.expiresOn ?? '');
    setEditNotes(doc.notes ?? '');
  };

  const saveEdit = async () => {
    if (!editingDoc) return;
    setSavingEdit(true);
    try {
      await adminApi.updateEmployeeDocument(editingDoc.id, {
        document_number: editNumber || null,
        issued_on: editIssued || null,
        expires_on: editExpires || null,
        notes: editNotes || null,
      });
      toast.success(t('admin.docs.saved'));
      setEditingDoc(null);
      await load();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || t('admin.docs.failed_save'));
    } finally { setSavingEdit(false); }
  };

  const onVoid = async (doc: EmployeeDocument) => {
    const reason = prompt(t('admin.docs.void_reason_prompt'));
    if (!reason || !reason.trim()) return;
    try {
      await adminApi.voidEmployeeDocument(doc.id, reason.trim());
      toast.success(t('admin.docs.voided'));
      await load();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || t('admin.docs.failed_void'));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">{t('admin.docs.title')}</h3>
          <p className="text-xs text-gray-500 mt-0.5">{t('admin.docs.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {!hrOfficer && (
            <span className="inline-flex items-center gap-1 text-[11px] text-gray-500 bg-gray-50 px-2 py-1 rounded-full">
              <ShieldAlert className="w-3 h-3" /> {t('admin.docs.hr_officer_hint')}
            </span>
          )}
          <Button size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => setShowUpload(true)}>
            {t('admin.docs.upload')}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><LoadingSpinner /></div>
      ) : documents.length === 0 ? (
        <EmptyState title={t('admin.docs.empty')} description={t('admin.docs.empty_hint')} />
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
                  <tr key={d.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-900">{categoryLabel(d.category)}</span>
                        {sensitivityBadge(d.sensitivity, t)}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      {d.redacted ? <span className="text-gray-400">{t('admin.docs.redacted')}</span>
                        : d.documentNumber || <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      {d.redacted ? <span className="text-gray-400">—</span> : expiryPill(d.expiresOn ?? null, t)}
                    </td>
                    <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{fmtDate(d.uploadedAt)}</td>
                    <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{d.redacted ? '—' : fmtBytes(d.byteSize)}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        {!d.redacted && (
                          <button
                            type="button" onClick={() => onDownload(d)}
                            title={t('admin.docs.download')}
                            className="p-1.5 rounded-md hover:bg-gray-100 text-gray-600"
                          ><Download className="w-4 h-4" /></button>
                        )}
                        {!d.redacted && (
                          <button
                            type="button" onClick={() => openEdit(d)}
                            title={t('admin.docs.edit_meta')}
                            className="p-1.5 rounded-md hover:bg-gray-100 text-gray-600"
                          ><Edit2 className="w-4 h-4" /></button>
                        )}
                        {!d.redacted && (
                          <button
                            type="button" onClick={() => onVoid(d)}
                            title={t('admin.docs.void')}
                            className="p-1.5 rounded-md hover:bg-rose-50 text-rose-600"
                          ><Trash2 className="w-4 h-4" /></button>
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

      {/* Upload modal */}
      <Modal isOpen={showUpload} onClose={() => { setShowUpload(false); resetUploadForm(); }} title={t('admin.docs.upload_title')} size="md">
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.docs.field_category')}</label>
            <Select
              value={upCategory}
              onChange={e => setUpCategory(e.target.value)}
              options={activeCategories.map(c => ({ value: c.key, label: c.label }))}
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
            <Button variant="ghost" onClick={() => { setShowUpload(false); resetUploadForm(); }} icon={<X className="w-4 h-4" />}>{t('common.cancel')}</Button>
            <Button onClick={onUpload} loading={uploading} disabled={!upFile || !upCategory}>{t('admin.docs.do_upload')}</Button>
          </div>
        </div>
      </Modal>

      {/* Edit metadata modal */}
      <Modal isOpen={!!editingDoc} onClose={() => setEditingDoc(null)} title={t('admin.docs.edit_title')} size="md">
        {editingDoc && (
          <div className="space-y-3">
            <p className="text-xs text-gray-500">{categoryLabel(editingDoc.category)} · {editingDoc.filename}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.docs.field_number')}</label>
                <Input value={editNumber} onChange={e => setEditNumber(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.docs.field_issued')}</label>
                <Input type="date" value={editIssued} onChange={e => setEditIssued(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.docs.field_expires')}</label>
                <Input type="date" value={editExpires} onChange={e => setEditExpires(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('admin.docs.field_notes')}</label>
              <textarea
                value={editNotes} onChange={e => setEditNotes(e.target.value)} rows={2}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <Button variant="ghost" onClick={() => setEditingDoc(null)}>{t('common.cancel')}</Button>
              <Button onClick={saveEdit} loading={savingEdit}>{t('common.save')}</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
