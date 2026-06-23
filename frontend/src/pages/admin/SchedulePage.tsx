import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Calendar, X, Download, Upload, FileSpreadsheet } from 'lucide-react';
import { adminApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Button from '../../components/common/Button';

interface ScheduleUploadResult { placed: number; days: string[]; warnings: string[] }

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
const DAY_INDEX: Record<string, number> = Object.fromEntries(DAY_NAMES.map((d, i) => [d, i]));

interface TeacherRow { id: string; fullName: string; subject?: string }
interface ClassRow { id: string; name: string; gradeLevel?: string }
interface Cell { id: string; teacherId: string; classId: string; dayOfWeek: number; periodIndex: number }

export default function SchedulePage() {
  const { t } = useTranslation();
  const dayLabel = (day: string) => t(`common.days.${day}`);
  const [periodsPerDay, setPeriodsPerDay] = useState(6);
  const [scheduleDays, setScheduleDays] = useState<string[]>(['sunday','monday','tuesday','wednesday','thursday']);
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [cells, setCells] = useState<Cell[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);

  // Local edits to config (committed via Save button)
  const [draftPeriods, setDraftPeriods] = useState(6);
  const [draftDays, setDraftDays] = useState<string[]>([]);

  // Bulk upload
  const fileRef = useRef<HTMLInputElement>(null);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<ScheduleUploadResult | null>(null);

  const load = () =>
    adminApi.getSchedule().then(r => {
      const d = r.data;
      setPeriodsPerDay(d.periodsPerDay);
      setScheduleDays(d.scheduleDays);
      setDraftPeriods(d.periodsPerDay);
      setDraftDays(d.scheduleDays);
      setTeachers(d.teachers || []);
      setClasses(d.classes || []);
      setCells(d.assignments || []);
    }).finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  // Indexed lookup: cellMap[`${teacherId}:${day}:${period}`] -> classId
  const cellMap = useMemo(() => {
    const m = new Map<string, Cell>();
    for (const c of cells) m.set(`${c.teacherId}:${c.dayOfWeek}:${c.periodIndex}`, c);
    return m;
  }, [cells]);

  const orderedDays = useMemo(() =>
    [...scheduleDays].sort((a, b) => (DAY_INDEX[a] ?? 99) - (DAY_INDEX[b] ?? 99)),
  [scheduleDays]);

  const setCellClass = async (teacherId: string, dayOfWeek: number, periodIndex: number, classId: string | null) => {
    try {
      const res = await adminApi.setScheduleCell({ teacherId, dayOfWeek, periodIndex, classId });
      const key = `${teacherId}:${dayOfWeek}:${periodIndex}`;
      setCells(prev => {
        const without = prev.filter(c => `${c.teacherId}:${c.dayOfWeek}:${c.periodIndex}` !== key);
        if (!classId) return without;
        return [...without, res.data.assignment as Cell];
      });
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('admin.cell_update_failed'));
    }
  };

  const onSaveConfig = async () => {
    if (draftDays.length === 0) { toast.error(t('admin.pick_day')); return; }
    if (draftPeriods < 1 || draftPeriods > 20) { toast.error(t('admin.periods_range')); return; }
    setSavingConfig(true);
    try {
      await adminApi.updateScheduleConfig({ periodsPerDay: draftPeriods, scheduleDays: draftDays });
      toast.success(t('admin.schedule_saved'));
      await load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('admin.settings_save_failed'));
    } finally {
      setSavingConfig(false);
    }
  };

  const toggleDayDraft = (day: string) =>
    setDraftDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);

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

  const downloadTemplate = async () => {
    setTemplateBusy(true);
    try {
      const res = await adminApi.scheduleTemplate();
      saveBlob(res.data as Blob, 'schedule-template.xlsx');
    } catch {
      toast.error(t('admin.schedule_upload.template_failed', 'Could not download the template.'));
    } finally {
      setTemplateBusy(false);
    }
  };

  const onUpload = async (file: File) => {
    setUploading(true);
    setUploadResult(null);
    try {
      const res = await adminApi.uploadSchedule(file);
      const data = res.data as ScheduleUploadResult;
      setUploadResult(data);
      if (data.placed > 0) {
        toast.success(t('admin.schedule_upload.placed_toast', { count: data.placed, defaultValue: '{{count}} period(s) scheduled.' }));
        await load();
      } else {
        toast.info(t('admin.schedule_upload.none_placed', 'Nothing was scheduled — check the notes below.'));
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || t('admin.schedule_upload.failed', 'Schedule upload failed.'));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <PageLayout title={t('admin.weekly_schedule')}>
      <div className="space-y-6">
        {/* Settings */}
        <Card>
          <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Calendar className="w-4 h-4" /> {t('admin.schedule_settings')}
          </h2>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">{t('admin.classes_per_day')}</label>
              <input
                type="number"
                min={1}
                max={20}
                value={draftPeriods}
                onChange={e => setDraftPeriods(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <p className="text-xs text-gray-500 mt-1">{t('admin.classes_per_day_hint')}</p>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">{t('admin.school_days')}</label>
              <div className="mt-1 flex flex-wrap gap-2">
                {DAY_NAMES.map(day => {
                  const active = draftDays.includes(day);
                  return (
                    <button
                      type="button"
                      key={day}
                      onClick={() => toggleDayDraft(day)}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${active
                        ? 'bg-primary-600 text-white border-primary-600'
                        : 'bg-white text-gray-700 border-gray-200 hover:border-primary-300'}`}
                    >
                      {dayLabel(day)}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <Button onClick={onSaveConfig} loading={savingConfig}>{t('admin.save_settings')}</Button>
          </div>
          <p className="text-xs text-amber-600 mt-2">
            {t('admin.reduce_periods_warning')}
          </p>
        </Card>

        {/* Bulk upload — build the schedule from a subject grid (teacher
            resolved from the curriculum). */}
        <Card>
          <div className="flex items-start gap-3 mb-4">
            <div className="w-9 h-9 bg-primary-100 rounded-lg flex items-center justify-center flex-shrink-0">
              <FileSpreadsheet className="w-5 h-5 text-primary-700" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900">{t('admin.schedule_upload.title', 'Upload schedule')}</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                {t('admin.schedule_upload.subtitle', 'One sheet per day, rows are classes, columns are periods. Fill each cell with a subject — the right teacher is matched from the curriculum.')}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" loading={templateBusy} onClick={downloadTemplate}>
              <Download className="w-4 h-4 mr-1.5" />
              {t('admin.schedule_upload.download_template', 'Download template')}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f); }}
              className="flex-1 min-w-[200px] text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100 border border-gray-200 rounded-lg"
            />
            {uploading && <Upload className="w-4 h-4 text-primary-600 animate-pulse" />}
          </div>

          {uploadResult && (
            <div className="mt-4 border-t border-gray-100 pt-4 space-y-2">
              <div className="flex flex-wrap gap-2">
                <span className="text-xs font-semibold bg-green-50 text-green-700 px-2.5 py-1 rounded-full">
                  {t('admin.schedule_upload.placed_stat', { count: uploadResult.placed, defaultValue: '{{count}} placed' })}
                </span>
                {uploadResult.days.length > 0 && (
                  <span className="text-xs font-semibold bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full">
                    {t('admin.schedule_upload.days_stat', { days: uploadResult.days.join(', '), defaultValue: 'Days: {{days}}' })}
                  </span>
                )}
              </div>
              {uploadResult.warnings.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-sm text-amber-900 font-medium mb-1">
                    {t('admin.schedule_upload.notes_title', { count: uploadResult.warnings.length, defaultValue: '{{count}} note(s)' })}
                  </p>
                  <ul className="text-xs text-amber-800 list-disc list-inside space-y-0.5 max-h-48 overflow-y-auto">
                    {uploadResult.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Grid — one full-width table per day, stacked Sun→Sat */}
        {loading ? (
          <Card className="!p-0 overflow-hidden">
            <div className="p-12 text-center text-gray-400 text-sm">{t('common.loading_more')}</div>
          </Card>
        ) : teachers.length === 0 ? (
          <Card className="!p-0 overflow-hidden">
            <div className="p-12 text-center text-gray-400 text-sm">
              {t('admin.no_teachers_schedule')}
            </div>
          </Card>
        ) : (
          orderedDays.map(day => {
            const dayIdx = DAY_INDEX[day];
            return (
              <Card key={day} className="!p-0 overflow-hidden">
                <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-yellow-50">
                  <h2 className="font-bold text-gray-800">{dayLabel(day)}</h2>
                  <span className="text-xs text-gray-500">
                    {t('admin.grid_summary', { teachers: teachers.length, days: 1, periods: periodsPerDay })}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr>
                        <th className="bg-gray-50 border-r border-b border-gray-200 px-3 py-2 text-left font-semibold text-gray-700 w-48">
                          {t('supervisor.teacher_col')}
                        </th>
                        {Array.from({ length: periodsPerDay }, (_, i) => (
                          <th
                            key={`${day}-h-${i + 1}`}
                            className="bg-blue-50 border-b border-r border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-700 text-center"
                          >
                            {i + 1}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {teachers.map(tch => (
                        <tr key={tch.id} className="hover:bg-gray-50/50">
                          <td className="bg-white border-r border-b border-gray-200 px-3 py-2 font-medium text-gray-900 w-48">
                            <div className="truncate" title={tch.fullName}>{tch.fullName}</div>
                            {tch.subject && <div className="text-[10px] text-gray-500 truncate">{tch.subject}</div>}
                          </td>
                          {Array.from({ length: periodsPerDay }, (_, i) => {
                            const periodIdx = i + 1;
                            const cell = cellMap.get(`${tch.id}:${dayIdx}:${periodIdx}`);
                            return (
                              <td
                                key={`${tch.id}-${day}-${periodIdx}`}
                                className="border-b border-r border-gray-200 p-0.5 text-center"
                              >
                                <div className="flex items-center justify-center gap-0.5">
                                  <select
                                    value={cell?.classId ?? ''}
                                    onChange={e => setCellClass(tch.id, dayIdx, periodIdx, e.target.value || null)}
                                    className="w-full px-1 py-1 text-[11px] border border-transparent hover:border-gray-200 focus:border-primary-400 rounded bg-transparent focus:outline-none cursor-pointer"
                                  >
                                    <option value="">—</option>
                                    {classes.map(c => (
                                      <option key={c.id} value={c.id}>{c.name}</option>
                                    ))}
                                  </select>
                                  {cell && (
                                    <button
                                      type="button"
                                      onClick={() => setCellClass(tch.id, dayIdx, periodIdx, null)}
                                      className="text-gray-300 hover:text-rose-500"
                                      title={t('admin.clear')}
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            );
          })
        )}
      </div>
    </PageLayout>
  );
}
