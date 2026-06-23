// Admin grades import/export — the report-card grid round-trip.
// Pick a year + term, download a per-class grid template (students × subjects),
// fill marks, and upload to create RELEASED grades. The same grid shape exports
// (cell = the student's total) so a school can extract grades for their records
// or a government system. Upload reads year/term from the file itself.

import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Download, Upload, FileSpreadsheet, FileDown } from 'lucide-react';
import { adminApi } from '../../services/api';
import Card from '../common/Card';
import Button from '../common/Button';
import Select from '../common/Select';
import Input from '../common/Input';

interface UploadResult { placed: number; warnings: string[] }

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

export default function GradeImportExport({ terms, onImported }: { terms: string[]; onImported?: () => void }) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [year, setYear] = useState('');
  const [term, setTerm] = useState(terms[0] ?? '');
  const [templateBusy, setTemplateBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);

  const needYearTerm = () => {
    if (!year.trim() || !term.trim()) {
      toast.error(t('grade_io.pick_year_term', 'Choose an academic year and a term first.'));
      return false;
    }
    return true;
  };

  const downloadTemplate = async () => {
    if (!needYearTerm()) return;
    setTemplateBusy(true);
    try {
      const res = await adminApi.gradesTemplate(year.trim(), term.trim());
      saveBlob(res.data as Blob, 'grades-template.xlsx');
    } catch {
      toast.error(t('grade_io.template_failed', 'Could not download the template.'));
    } finally {
      setTemplateBusy(false);
    }
  };

  const onExport = async () => {
    if (!needYearTerm()) return;
    setExportBusy(true);
    try {
      const res = await adminApi.exportGrades(year.trim(), term.trim());
      saveBlob(res.data as Blob, `grades-${year.trim()}-${term.trim()}.xlsx`);
    } catch (err: unknown) {
      // Blob responses carry JSON errors as a Blob — read it for the message.
      const e = err as { response?: { data?: Blob | { error?: string }; status?: number } };
      let msg = '';
      if (e.response?.data instanceof Blob) { try { msg = JSON.parse(await e.response.data.text())?.error; } catch { /* ignore */ } }
      toast.error(msg || t('grade_io.export_failed', 'No grades to export for that year and term.'));
    } finally {
      setExportBusy(false);
    }
  };

  const onUpload = async (file: File) => {
    setUploading(true);
    setResult(null);
    try {
      const res = await adminApi.uploadGrades(file);
      const data = res.data as UploadResult;
      setResult(data);
      if (data.placed > 0) {
        toast.success(t('grade_io.placed_toast', { count: data.placed, defaultValue: '{{count}} grade(s) imported.' }));
        onImported?.();
      } else {
        toast.info(t('grade_io.none_placed', 'No grades were imported — check the notes below.'));
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || t('grade_io.upload_failed', 'Grade upload failed.'));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <Card>
      <div className="flex items-start gap-3 mb-4">
        <div className="w-9 h-9 bg-primary-100 rounded-lg flex items-center justify-center flex-shrink-0">
          <FileSpreadsheet className="w-5 h-5 text-primary-700" />
        </div>
        <div>
          <h2 className="font-semibold text-gray-900">{t('grade_io.title', 'Import / export grades')}</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {t('grade_io.subtitle', 'One sheet per class — rows are students, columns are subjects. Imported grades are released to parents immediately.')}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('grade_io.year', 'Academic Year')}</label>
          <Input placeholder="2023-2024" value={year} onChange={e => setYear(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('grade_io.term', 'Term')}</label>
          <Select
            options={terms.map(tm => ({ value: tm, label: tm }))}
            placeholder={t('grade_io.select_term', 'Select term')}
            value={term}
            onChange={e => setTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" loading={templateBusy} onClick={downloadTemplate}>
          <Download className="w-4 h-4 mr-1.5" />
          {t('grade_io.download_template', 'Download template')}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f); }}
          className="flex-1 min-w-[180px] text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100 border border-gray-200 rounded-lg"
        />
        {uploading && <Upload className="w-4 h-4 text-primary-600 animate-pulse" />}
        <Button type="button" variant="outline" loading={exportBusy} onClick={onExport}>
          <FileDown className="w-4 h-4 mr-1.5" />
          {t('grade_io.export', 'Export grades')}
        </Button>
      </div>

      {result && (
        <div className="mt-4 border-t border-gray-100 pt-4 space-y-2">
          <span className="text-xs font-semibold bg-green-50 text-green-700 px-2.5 py-1 rounded-full">
            {t('grade_io.placed_stat', { count: result.placed, defaultValue: '{{count}} imported' })}
          </span>
          {result.warnings.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-sm text-amber-900 font-medium mb-1">
                {t('grade_io.notes_title', { count: result.warnings.length, defaultValue: '{{count}} note(s)' })}
              </p>
              <ul className="text-xs text-amber-800 list-disc list-inside space-y-0.5 max-h-48 overflow-y-auto">
                {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
