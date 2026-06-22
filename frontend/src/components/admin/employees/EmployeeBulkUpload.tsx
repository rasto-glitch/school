// Reusable bulk-upload panel for teachers and drivers. Posts an .xlsx/.csv to
// POST /admin/employees/bulk-upload?role=… (admin.bulkUploadEmployees), which
// mirrors the students importer: in-memory parse, auto-create of missing
// classes (teacher) / buses (driver), default-password accounts flagged
// must_change_password. Carries the flat HR columns incl. National ID + DOB.
//
// The template and the post-upload credentials sheet are generated client-side
// as CSV (no xlsx dependency on the web side) — Excel opens both natively, and
// the backend's SheetJS parse reads CSV and XLSX alike.

import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Download, Upload, FileSpreadsheet, KeyRound } from 'lucide-react';
import { adminApi } from '../../../services/api';
import Card from '../../common/Card';
import Button from '../../common/Button';
import EmployeePhotoMatcher from './EmployeePhotoMatcher';

type Role = 'teacher' | 'driver';

interface Credential { id: string; fullName: string; role: string; username: string; password: string; }
interface UploadResult {
  created: number;
  skipped: number;
  total: number;
  autoCreatedClasses: string[];
  autoCreatedBuses: string[];
  autoCreatedSubjects: string[];
  credentials: Credential[];
  errors: string[];
}

// Minimal RFC-4180 CSV cell quoting (used only for the credentials sheet).
const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const toCsv = (rows: string[][]) => rows.map(r => r.map(csvCell).join(',')).join('\r\n');

const saveBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// Prepend a UTF-8 BOM so Excel reads Arabic/Kurdish names in CSV correctly.
const saveCsv = (content: string, filename: string) =>
  saveBlob(new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8;' }), filename);

export default function EmployeeBulkUpload({ role, onDone }: { role: Role; onDone?: () => void }) {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const roleLabel = role === 'teacher'
    ? t('admin.bulk_emp.teachers', 'teachers')
    : t('admin.bulk_emp.drivers', 'drivers');

  const downloadTemplate = async () => {
    setTemplateLoading(true);
    try {
      const res = await adminApi.employeeBulkTemplate(role);
      saveBlob(res.data as Blob, `${role}-bulk-template.xlsx`);
    } catch {
      toast.error(t('admin.bulk_emp.template_failed', 'Could not download the template.'));
    } finally {
      setTemplateLoading(false);
    }
  };

  const downloadCredentials = () => {
    if (!result?.credentials?.length) return;
    const rows: string[][] = [
      [t('admin.bulk_emp.col_full_name', 'Full Name'), t('admin.bulk_emp.col_username', 'Username'), t('admin.bulk_emp.col_temp_password', 'Temporary Password')],
      ...result.credentials.map(c => [c.fullName, c.username, c.password]),
    ];
    saveCsv(toCsv(rows), `${role}-credentials.csv`);
  };

  const onUpload = async () => {
    if (!file) { toast.error(t('admin.bulk_emp.select_first', 'Choose a file first.')); return; }
    setLoading(true);
    setResult(null);
    try {
      const res = await adminApi.bulkUploadEmployees(role, file);
      const data = res.data as UploadResult;
      setResult(data);
      if (data.created > 0) {
        toast.success(t('admin.bulk_emp.created_toast', { count: data.created, defaultValue: '{{count}} account(s) created.' }));
        onDone?.();
      } else {
        toast.info(t('admin.bulk_emp.none_created', 'No accounts were created — check the errors below.'));
      }
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg || t('admin.bulk_emp.failed', 'Bulk upload failed.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
    <Card>
      <div className="flex items-start gap-3 mb-4">
        <div className="w-9 h-9 bg-primary-100 rounded-lg flex items-center justify-center flex-shrink-0">
          <FileSpreadsheet className="w-5 h-5 text-primary-700" />
        </div>
        <div>
          <h2 className="font-semibold text-gray-900">
            {t('admin.bulk_emp.title', { role: roleLabel, defaultValue: 'Bulk upload {{role}}' })}
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {t('admin.bulk_emp.subtitle', 'Upload a spreadsheet to create many accounts at once. Download the template, fill one row per person, then upload it.')}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <Button type="button" variant="outline" loading={templateLoading} onClick={downloadTemplate}>
          <Download className="w-4 h-4 mr-1.5" />
          {t('admin.bulk_emp.download_template', 'Download template')}
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={e => setFile(e.target.files?.[0] ?? null)}
          className="flex-1 text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100 border border-gray-200 rounded-lg"
        />
        <Button type="button" loading={loading} onClick={onUpload} disabled={!file}>
          <Upload className="w-4 h-4 mr-1.5" />
          {t('admin.bulk_emp.upload', 'Upload')}
        </Button>
      </div>

      <p className="text-xs text-gray-400 mt-2">
        {t('admin.bulk_emp.pii_hint', 'National ID and Date of Birth are stored on the employee record. Keep the spreadsheet secure and delete your copy once accounts are created.')}
      </p>

      {result && (
        <div className="mt-4 border-t border-gray-100 pt-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            <span className="text-xs font-semibold bg-green-50 text-green-700 px-2.5 py-1 rounded-full">
              {t('admin.bulk_emp.stat_created', { count: result.created, defaultValue: '{{count}} created' })}
            </span>
            {result.skipped > 0 && (
              <span className="text-xs font-semibold bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full">
                {t('admin.bulk_emp.stat_skipped', { count: result.skipped, defaultValue: '{{count}} skipped' })}
              </span>
            )}
            {result.autoCreatedClasses.length > 0 && (
              <span className="text-xs font-semibold bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full">
                {t('admin.bulk_emp.stat_classes', { count: result.autoCreatedClasses.length, defaultValue: '{{count}} class(es) created' })}
              </span>
            )}
            {result.autoCreatedBuses.length > 0 && (
              <span className="text-xs font-semibold bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full">
                {t('admin.bulk_emp.stat_buses', { count: result.autoCreatedBuses.length, defaultValue: '{{count}} bus(es) created' })}
              </span>
            )}
            {result.autoCreatedSubjects.length > 0 && (
              <span className="text-xs font-semibold bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full">
                {t('admin.bulk_emp.stat_subjects', { count: result.autoCreatedSubjects.length, defaultValue: '{{count}} subject(s) created' })}
              </span>
            )}
          </div>

          {result.credentials.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-sm text-amber-900 font-medium mb-1">
                {t('admin.bulk_emp.creds_ready', 'Login credentials are ready.')}
              </p>
              <p className="text-xs text-amber-700 mb-2">
                {t('admin.bulk_emp.creds_hint', 'Download and hand these out. Each person must change their password on first login.')}
              </p>
              <Button type="button" variant="outline" onClick={downloadCredentials}>
                <KeyRound className="w-4 h-4 mr-1.5" />
                {t('admin.bulk_emp.download_creds', 'Download credentials')}
              </Button>
            </div>
          )}

          {result.errors.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-800 font-medium mb-1">
                {t('admin.bulk_emp.errors_title', { count: result.errors.length, defaultValue: '{{count}} row(s) had issues' })}
              </p>
              <ul className="text-xs text-red-700 list-disc list-inside space-y-0.5 max-h-40 overflow-y-auto">
                {result.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>

    {/* Teachers only (for now): match a folder of photos to the new accounts. */}
    {role === 'teacher' && result && result.credentials.length > 0 && (
      <EmployeePhotoMatcher
        role="teacher"
        targets={result.credentials.map(c => ({ id: c.id, fullName: c.fullName, username: c.username }))}
      />
    )}
    </div>
  );
}
