import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Calendar, X, Download, Upload, FileSpreadsheet, Plus, Trash2, ArrowUp, ArrowDown, Coffee, DoorOpen, Wand2, Lock, Unlock, Ban, CheckCircle2 } from 'lucide-react';
import { adminApi, type ScheduleSlot } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Button from '../../components/common/Button';

interface ScheduleUploadResult { placed: number; days: string[]; warnings: string[] }
interface UnplacedRow { className: string | null; subjectName: string | null; teacherName: string | null; count: number; reason: string }
interface GenResult { generated: number; demand: number; fullyPlaced: boolean; attempts: number; cleared: boolean; unplaced: UnplacedRow[] }

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
const DAY_INDEX: Record<string, number> = Object.fromEntries(DAY_NAMES.map((d, i) => [d, i]));
const ROOM_TYPES = ['classroom', 'lab', 'computer', 'gym', 'library', 'other'];

interface TeacherRow { id: string; fullName: string; subject?: string }
interface ClassRow { id: string; name: string; gradeLevel?: string; roomId?: string | null }
interface Cell { id: string; teacherId: string; classId: string; dayOfWeek: number; periodIndex: number; subjectId?: string | null; roomId?: string | null; isLocked?: boolean }
interface Room { id: string; name: string; roomType?: string | null; capacity?: number | null }
interface Subject { id: string; name: string }
type Draft = { kind: 'lesson' | 'break'; label?: string; start: string; end: string };

function addMinutes(hhmm: string, mins: number): string {
  const [h, m] = (hhmm || '08:00').split(':').map(Number);
  const total = h * 60 + m + mins;
  return `${String(Math.floor((total % 1440) / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export default function SchedulePage() {
  const { t } = useTranslation();
  const dayLabel = (day: string) => t(`common.days.${day}`);

  const [scheduleDays, setScheduleDays] = useState<string[]>(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday']);
  const [skeleton, setSkeleton] = useState<ScheduleSlot[]>([]);
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [cells, setCells] = useState<Cell[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);

  const [draftDays, setDraftDays] = useState<string[]>([]);
  const [draftSkeleton, setDraftSkeleton] = useState<Draft[]>([]);

  const fileRef = useRef<HTMLInputElement>(null);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<ScheduleUploadResult | null>(null);

  const [generating, setGenerating] = useState(false);
  const [clearUnlocked, setClearUnlocked] = useState(true);
  const [genResult, setGenResult] = useState<GenResult | null>(null);

  const load = () =>
    adminApi.getSchedule().then(r => {
      const d = r.data;
      setScheduleDays(d.scheduleDays);
      setDraftDays(d.scheduleDays);
      setSkeleton(d.skeleton || []);
      setDraftSkeleton((d.skeleton || []).map((s: ScheduleSlot) => ({ kind: s.kind, label: s.label, start: s.start, end: s.end })));
      setTeachers(d.teachers || []);
      setClasses(d.classes || []);
      setCells(d.assignments || []);
      setRooms(d.rooms || []);
      setSubjects(d.subjects || []);
    }).finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  const roomsById = useMemo(() => new Map(rooms.map(r => [r.id, r])), [rooms]);
  const subjectsById = useMemo(() => new Map(subjects.map(s => [s.id, s])), [subjects]);
  const cellMap = useMemo(() => {
    const m = new Map<string, Cell>();
    for (const c of cells) m.set(`${c.teacherId}:${c.dayOfWeek}:${c.periodIndex}`, c);
    return m;
  }, [cells]);

  const orderedDays = useMemo(() =>
    [...scheduleDays].sort((a, b) => (DAY_INDEX[a] ?? 99) - (DAY_INDEX[b] ?? 99)), [scheduleDays]);

  // Render-time columns from the live skeleton: lessons carry a running period #.
  const columns = useMemo(() => {
    let p = 0;
    return skeleton.map((s, i) => s.kind === 'lesson'
      ? { key: `c${i}`, kind: 'lesson' as const, period: ++p, start: s.start, end: s.end }
      : { key: `c${i}`, kind: 'break' as const, label: s.label || 'Break', start: s.start, end: s.end });
  }, [skeleton]);

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

  // Pin/unpin a lesson — locked cells survive auto-generation.
  const toggleLock = async (cell: Cell) => {
    try {
      const res = await adminApi.setScheduleCell({
        teacherId: cell.teacherId, dayOfWeek: cell.dayOfWeek, periodIndex: cell.periodIndex,
        classId: cell.classId, subjectId: cell.subjectId ?? null, roomId: cell.roomId ?? null, isLocked: !cell.isLocked,
      });
      const key = `${cell.teacherId}:${cell.dayOfWeek}:${cell.periodIndex}`;
      setCells(prev => prev.map(c => (`${c.teacherId}:${c.dayOfWeek}:${c.periodIndex}` === key ? (res.data.assignment as Cell) : c)));
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('admin.cell_update_failed'));
    }
  };

  const onGenerate = async () => {
    setGenerating(true); setGenResult(null);
    try {
      const res = await adminApi.generateSchedule({ clearUnlocked });
      const data = res.data as GenResult;
      setGenResult(data);
      if (data.fullyPlaced) toast.success(t('schedule2.generate.done_full', { count: data.generated, defaultValue: 'Placed all {{count}} lessons.' }));
      else toast.info(t('schedule2.generate.done_partial', { count: data.generated, defaultValue: 'Placed {{count}} lessons — some couldn\'t be scheduled.' }));
      await load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('schedule2.generate.failed', 'Could not generate the timetable.'));
    } finally { setGenerating(false); }
  };

  const reasonLabel = (reason: string) =>
    reason === 'no_teacher'
      ? t('schedule2.generate.reason_no_teacher', 'no teacher assigned')
      : t('schedule2.generate.reason_no_slot', 'no free slot');

  // ── Day-structure (skeleton) editing ──
  const lastEnd = () => (draftSkeleton.length ? draftSkeleton[draftSkeleton.length - 1].end : '08:00');
  const addLesson = () => setDraftSkeleton(s => [...s, { kind: 'lesson', start: lastEnd(), end: addMinutes(lastEnd(), 45) }]);
  const addBreak = () => setDraftSkeleton(s => [...s, { kind: 'break', label: t('schedule2.break', 'Break'), start: lastEnd(), end: addMinutes(lastEnd(), 15) }]);
  const patchSlot = (i: number, patch: Partial<Draft>) => setDraftSkeleton(s => s.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const removeSlot = (i: number) => setDraftSkeleton(s => s.filter((_, idx) => idx !== i));
  const moveSlot = (i: number, dir: -1 | 1) => setDraftSkeleton(s => {
    const j = i + dir; if (j < 0 || j >= s.length) return s;
    const copy = [...s]; [copy[i], copy[j]] = [copy[j], copy[i]]; return copy;
  });

  const lessonCount = draftSkeleton.filter(s => s.kind === 'lesson').length;

  const onSaveConfig = async () => {
    if (draftDays.length === 0) { toast.error(t('admin.pick_day')); return; }
    if (lessonCount < 1) { toast.error(t('schedule2.need_lesson', 'Add at least one lesson period.')); return; }
    setSavingConfig(true);
    try {
      await adminApi.updateScheduleConfig({ scheduleDays: draftDays, skeleton: draftSkeleton });
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
    const a = document.createElement('a'); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  };
  const downloadTemplate = async () => {
    setTemplateBusy(true);
    try { const res = await adminApi.scheduleTemplate(); saveBlob(res.data as Blob, 'schedule-template.xlsx'); }
    catch { toast.error(t('admin.schedule_upload.template_failed', 'Could not download the template.')); }
    finally { setTemplateBusy(false); }
  };
  const onUpload = async (file: File) => {
    setUploading(true); setUploadResult(null);
    try {
      const res = await adminApi.uploadSchedule(file);
      const data = res.data as ScheduleUploadResult;
      setUploadResult(data);
      if (data.placed > 0) { toast.success(t('admin.schedule_upload.placed_toast', { count: data.placed, defaultValue: '{{count}} period(s) scheduled.' })); await load(); }
      else toast.info(t('admin.schedule_upload.none_placed', 'Nothing was scheduled — check the notes below.'));
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || t('admin.schedule_upload.failed', 'Schedule upload failed.'));
    } finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  return (
    <PageLayout title={t('admin.weekly_schedule')}>
      <div className="space-y-6">
        {/* Day structure (skeleton) + school days */}
        <Card>
          <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Calendar className="w-4 h-4" /> {t('schedule2.day_structure', 'Day structure')}
          </h2>
          <div className="mb-4">
            <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">{t('admin.school_days')}</label>
            <div className="mt-1 flex flex-wrap gap-2">
              {DAY_NAMES.map(day => {
                const active = draftDays.includes(day);
                return (
                  <button type="button" key={day} onClick={() => toggleDayDraft(day)}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${active ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-700 border-gray-200 hover:border-primary-300'}`}>
                    {dayLabel(day)}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">{t('schedule2.periods_breaks', 'Periods & breaks')}</label>
          <p className="text-xs text-gray-500 mb-2">{t('schedule2.day_structure_hint', 'The same layout applies to every school day. Lessons are numbered automatically; breaks are shown but never scheduled.')}</p>
          <div className="space-y-1.5">
            {draftSkeleton.map((s, i) => {
              const period = draftSkeleton.slice(0, i + 1).filter(x => x.kind === 'lesson').length;
              const isLesson = s.kind === 'lesson';
              return (
                <div key={i} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${isLesson ? 'bg-blue-50/60' : 'bg-amber-50/70'}`}>
                  <span className={`inline-flex items-center gap-1 text-[11px] font-semibold w-16 shrink-0 ${isLesson ? 'text-blue-700' : 'text-amber-700'}`}>
                    {isLesson ? <>P{period}</> : <><Coffee className="w-3 h-3" /></>}
                  </span>
                  {isLesson
                    ? <span className="text-xs text-gray-400 w-28 shrink-0">{t('schedule2.lesson', 'Lesson')}</span>
                    : <input value={s.label || ''} onChange={e => patchSlot(i, { label: e.target.value })} placeholder={t('schedule2.break', 'Break')} className="w-28 shrink-0 border border-gray-200 rounded px-2 py-1 text-xs" />}
                  <input type="time" value={s.start} onChange={e => patchSlot(i, { start: e.target.value })} className="border border-gray-200 rounded px-2 py-1 text-xs" />
                  <span className="text-gray-400 text-xs">–</span>
                  <input type="time" value={s.end} onChange={e => patchSlot(i, { end: e.target.value })} className="border border-gray-200 rounded px-2 py-1 text-xs" />
                  <div className="ml-auto flex items-center gap-0.5">
                    <button type="button" onClick={() => moveSlot(i, -1)} className="p-1 text-gray-400 hover:text-gray-700"><ArrowUp className="w-3.5 h-3.5" /></button>
                    <button type="button" onClick={() => moveSlot(i, 1)} className="p-1 text-gray-400 hover:text-gray-700"><ArrowDown className="w-3.5 h-3.5" /></button>
                    <button type="button" onClick={() => removeSlot(i)} className="p-1 text-gray-400 hover:text-rose-600"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={addLesson}>{t('schedule2.add_lesson', 'Add lesson')}</Button>
            <Button type="button" variant="outline" size="sm" icon={<Coffee className="w-3.5 h-3.5" />} onClick={addBreak}>{t('schedule2.add_break', 'Add break')}</Button>
            <span className="text-xs text-gray-500">{t('schedule2.lesson_total', { count: lessonCount, defaultValue: '{{count}} lesson period(s)' })}</span>
            <div className="ml-auto"><Button onClick={onSaveConfig} loading={savingConfig}>{t('admin.save_settings')}</Button></div>
          </div>
          <p className="text-xs text-amber-600 mt-2">{t('admin.reduce_periods_warning')}</p>
        </Card>

        {/* Rooms */}
        <RoomsCard rooms={rooms} classes={classes} onChange={load} />

        {/* Teacher availability (feeds the generator) */}
        <AvailabilityCard
          teachers={teachers}
          periods={columns.filter(c => c.kind === 'lesson').map(c => c.period as number)}
          orderedDays={orderedDays}
          dayLabel={dayLabel}
        />

        {/* Auto-generate */}
        <Card>
          <h2 className="font-semibold text-gray-900 mb-1 flex items-center gap-2"><Wand2 className="w-4 h-4" /> {t('schedule2.generate.title', 'Auto-generate timetable')}</h2>
          <p className="text-sm text-gray-500 mb-3">{t('schedule2.generate.hint', 'Fill the grid from the teaching plan, honoring teacher/class/room clashes, availability, weekly load and the daily subject cap. Locked (pinned) lessons are always kept.')}</p>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={clearUnlocked} onChange={e => setClearUnlocked(e.target.checked)} className="rounded border-gray-300" />
              {t('schedule2.generate.clear_unlocked', 'Replace unpinned lessons')}
            </label>
            <Button type="button" icon={<Wand2 className="w-4 h-4" />} loading={generating} onClick={onGenerate}>{t('schedule2.generate.run', 'Generate')}</Button>
          </div>
          {genResult && (
            <div className="mt-4 border-t border-gray-100 pt-4 space-y-2">
              <div className="flex flex-wrap gap-2">
                <span className="text-xs font-semibold bg-green-50 text-green-700 px-2.5 py-1 rounded-full">{t('schedule2.generate.placed_stat', { count: genResult.generated, defaultValue: '{{count}} placed' })}</span>
                <span className="text-xs font-semibold bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full">{t('schedule2.generate.demand_stat', { count: genResult.demand, defaultValue: '{{count}} demanded' })}</span>
              </div>
              {genResult.fullyPlaced ? (
                <p className="flex items-center gap-1.5 text-sm text-green-700"><CheckCircle2 className="w-4 h-4" /> {t('schedule2.generate.all_placed', 'Every lesson was placed.')}</p>
              ) : genResult.unplaced.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-sm text-amber-900 font-medium mb-1">{t('schedule2.generate.unplaced_title', { count: genResult.unplaced.reduce((s, u) => s + u.count, 0), defaultValue: '{{count}} lesson(s) could not be placed' })}</p>
                  <ul className="text-xs text-amber-800 list-disc list-inside space-y-0.5 max-h-48 overflow-y-auto">
                    {genResult.unplaced.map((u, i) => (
                      <li key={i}>{[u.subjectName, u.className].filter(Boolean).join(' · ')}{u.teacherName ? ` (${u.teacherName})` : ''} — {u.count} {reasonLabel(u.reason)}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Bulk upload */}
        <Card>
          <div className="flex items-start gap-3 mb-4">
            <div className="w-9 h-9 bg-primary-100 rounded-lg flex items-center justify-center flex-shrink-0"><FileSpreadsheet className="w-5 h-5 text-primary-700" /></div>
            <div>
              <h2 className="font-semibold text-gray-900">{t('admin.schedule_upload.title', 'Upload schedule')}</h2>
              <p className="text-sm text-gray-500 mt-0.5">{t('admin.schedule_upload.subtitle', 'One sheet per day, rows are classes, columns are periods. Fill each cell with a subject — the right teacher is matched from the curriculum.')}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" loading={templateBusy} onClick={downloadTemplate}><Download className="w-4 h-4 mr-1.5" />{t('admin.schedule_upload.download_template', 'Download template')}</Button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f); }}
              className="flex-1 min-w-[200px] text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100 border border-gray-200 rounded-lg" />
            {uploading && <Upload className="w-4 h-4 text-primary-600 animate-pulse" />}
          </div>
          {uploadResult && (
            <div className="mt-4 border-t border-gray-100 pt-4 space-y-2">
              <div className="flex flex-wrap gap-2">
                <span className="text-xs font-semibold bg-green-50 text-green-700 px-2.5 py-1 rounded-full">{t('admin.schedule_upload.placed_stat', { count: uploadResult.placed, defaultValue: '{{count}} placed' })}</span>
                {uploadResult.days.length > 0 && <span className="text-xs font-semibold bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full">{t('admin.schedule_upload.days_stat', { days: uploadResult.days.join(', '), defaultValue: 'Days: {{days}}' })}</span>}
              </div>
              {uploadResult.warnings.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-sm text-amber-900 font-medium mb-1">{t('admin.schedule_upload.notes_title', { count: uploadResult.warnings.length, defaultValue: '{{count}} note(s)' })}</p>
                  <ul className="text-xs text-amber-800 list-disc list-inside space-y-0.5 max-h-48 overflow-y-auto">{uploadResult.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Grid — one table per day; columns follow the skeleton (lessons editable, breaks shaded) */}
        {loading ? (
          <Card className="!p-0 overflow-hidden"><div className="p-12 text-center text-gray-400 text-sm">{t('common.loading_more')}</div></Card>
        ) : teachers.length === 0 ? (
          <Card className="!p-0 overflow-hidden"><div className="p-12 text-center text-gray-400 text-sm">{t('admin.no_teachers_schedule')}</div></Card>
        ) : (
          orderedDays.map(day => {
            const dayIdx = DAY_INDEX[day];
            return (
              <Card key={day} className="!p-0 overflow-hidden">
                <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-yellow-50">
                  <h2 className="font-bold text-gray-800">{dayLabel(day)}</h2>
                  <span className="text-xs text-gray-500">{t('admin.grid_summary', { teachers: teachers.length, days: 1, periods: columns.filter(c => c.kind === 'lesson').length })}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr>
                        <th className="bg-gray-50 border-r border-b border-gray-200 px-3 py-2 text-left font-semibold text-gray-700 w-48">{t('supervisor.teacher_col')}</th>
                        {columns.map(col => col.kind === 'break' ? (
                          <th key={col.key} className="bg-amber-50 border-b border-r border-amber-200 px-1 py-1 text-[10px] font-semibold text-amber-700 text-center align-bottom w-10" title={`${col.start}–${col.end}`}>
                            <Coffee className="w-3 h-3 mx-auto" />
                          </th>
                        ) : (
                          <th key={col.key} className="bg-blue-50 border-b border-r border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-700 text-center">
                            <div>{col.period}</div>
                            <div className="text-[9px] font-normal text-gray-400">{col.start}</div>
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
                          {columns.map(col => {
                            if (col.kind === 'break') return <td key={col.key} className="bg-amber-50/40 border-b border-r border-amber-100" />;
                            const cell = cellMap.get(`${tch.id}:${dayIdx}:${col.period}`);
                            const subjName = cell?.subjectId ? subjectsById.get(cell.subjectId)?.name : undefined;
                            const roomName = cell?.roomId ? roomsById.get(cell.roomId)?.name : undefined;
                            return (
                              <td key={col.key} className={`border-b border-r p-0.5 text-center align-top ${cell?.isLocked ? 'bg-amber-50/70 border-amber-200' : 'border-gray-200'}`}>
                                <div className="flex items-center justify-center gap-0.5">
                                  <select value={cell?.classId ?? ''} onChange={e => setCellClass(tch.id, dayIdx, col.period, e.target.value || null)}
                                    className="w-full px-1 py-1 text-[11px] border border-transparent hover:border-gray-200 focus:border-primary-400 rounded bg-transparent focus:outline-none cursor-pointer">
                                    <option value="">—</option>
                                    {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                  </select>
                                  {cell && (
                                    <button type="button" onClick={() => toggleLock(cell)} title={cell.isLocked ? t('schedule2.unpin', 'Unpin') : t('schedule2.pin', 'Pin (keep on regenerate)')}
                                      className={cell.isLocked ? 'text-amber-600' : 'text-gray-300 hover:text-amber-500'}>
                                      {cell.isLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                                    </button>
                                  )}
                                  {cell && <button type="button" onClick={() => setCellClass(tch.id, dayIdx, col.period, null)} className="text-gray-300 hover:text-rose-500" title={t('admin.clear')}><X className="w-3 h-3" /></button>}
                                </div>
                                {(subjName || roomName) && <div className="text-[9px] text-gray-400 truncate leading-tight">{[subjName, roomName].filter(Boolean).join(' · ')}</div>}
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

// ── Rooms manager: add/delete rooms + assign class home rooms ──
function RoomsCard({ rooms, classes, onChange }: { rooms: Room[]; classes: ClassRow[]; onChange: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [roomType, setRoomType] = useState('classroom');
  const [capacity, setCapacity] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await adminApi.createRoom({ name: name.trim(), roomType, capacity: capacity.trim() ? Number(capacity) : null });
      setName(''); setCapacity('');
      onChange();
    } catch (e: any) { toast.error(e.response?.data?.error || t('schedule2.room_failed', 'Could not save the room.')); }
    finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    if (!window.confirm(t('schedule2.confirm_delete_room', 'Delete this room? Lessons using it will be unassigned.'))) return;
    try { await adminApi.deleteRoom(id); onChange(); }
    catch (e: any) { toast.error(e.response?.data?.error || t('schedule2.room_failed', 'Could not save the room.')); }
  };
  const setHome = async (classId: string, roomId: string) => {
    try { await adminApi.setClassRoom(classId, roomId || null); onChange(); }
    catch (e: any) { toast.error(e.response?.data?.error || t('schedule2.room_failed', 'Could not save the room.')); }
  };

  return (
    <Card>
      <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2"><DoorOpen className="w-4 h-4" /> {t('schedule2.rooms', 'Rooms')}</h2>
      <div className="flex flex-wrap items-end gap-2 mb-3">
        <input value={name} onChange={e => setName(e.target.value)} placeholder={t('schedule2.room_name', 'Room name')} className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-40" />
        <select value={roomType} onChange={e => setRoomType(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
          {ROOM_TYPES.map(rt => <option key={rt} value={rt}>{t(`schedule2.room_type.${rt}`, rt)}</option>)}
        </select>
        <input value={capacity} onChange={e => setCapacity(e.target.value)} type="number" placeholder={t('schedule2.capacity', 'Capacity')} className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-24" />
        <Button type="button" size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={add} loading={busy}>{t('schedule2.add_room', 'Add room')}</Button>
      </div>
      {rooms.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {rooms.map(r => (
            <span key={r.id} className="inline-flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-full pl-3 pr-1.5 py-1 text-xs">
              <span className="font-medium text-gray-800">{r.name}</span>
              <span className="text-gray-400">{t(`schedule2.room_type.${r.roomType || 'other'}`, r.roomType || '')}{r.capacity ? ` · ${r.capacity}` : ''}</span>
              <button onClick={() => remove(r.id)} className="text-gray-300 hover:text-rose-500"><X className="w-3.5 h-3.5" /></button>
            </span>
          ))}
        </div>
      )}
      {classes.length > 0 && rooms.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide mb-2">{t('schedule2.home_rooms', 'Class home rooms')}</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {classes.map(c => (
              <div key={c.id} className="flex items-center gap-2 text-sm">
                <span className="text-gray-700 w-24 truncate" title={c.name}>{c.name}</span>
                <select value={c.roomId || ''} onChange={e => setHome(c.id, e.target.value)} className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs">
                  <option value="">{t('schedule2.no_room', '—')}</option>
                  {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Teacher availability: per-teacher day×period grid of blocked cells ──
function AvailabilityCard({ teachers, periods, orderedDays, dayLabel }: {
  teachers: TeacherRow[]; periods: number[]; orderedDays: string[]; dayLabel: (d: string) => string;
}) {
  const { t } = useTranslation();
  const [teacherId, setTeacherId] = useState('');
  const [blocked, setBlocked] = useState<Set<string>>(new Set());

  useEffect(() => {
    adminApi.getTeacherUnavailability().then(r => {
      const s = new Set<string>();
      for (const u of (r.data.unavailability || []) as { teacherId: string; dayOfWeek: number; periodIndex: number }[]) s.add(`${u.teacherId}:${u.dayOfWeek}:${u.periodIndex}`);
      setBlocked(s);
    }).catch(() => {});
  }, []);
  useEffect(() => { if (!teacherId && teachers.length) setTeacherId(teachers[0].id); }, [teachers, teacherId]);

  const toggle = async (d: number, p: number) => {
    if (!teacherId) return;
    const key = `${teacherId}:${d}:${p}`;
    try {
      const r = await adminApi.toggleTeacherUnavailability({ teacherId, dayOfWeek: d, periodIndex: p });
      setBlocked(prev => { const n = new Set(prev); if (r.data.blocked) n.add(key); else n.delete(key); return n; });
    } catch (e: any) { toast.error(e.response?.data?.error || t('schedule2.availability.failed', 'Could not update availability.')); }
  };

  return (
    <Card>
      <h2 className="font-semibold text-gray-900 mb-1 flex items-center gap-2"><Ban className="w-4 h-4" /> {t('schedule2.availability.title', 'Teacher availability')}</h2>
      <p className="text-sm text-gray-500 mb-3">{t('schedule2.availability.hint', 'Click a period to block it for the selected teacher. The generator won’t place any lesson in a red cell.')}</p>
      <select value={teacherId} onChange={e => setTeacherId(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm mb-3">
        {teachers.length === 0 && <option value="">—</option>}
        {teachers.map(tc => <option key={tc.id} value={tc.id}>{tc.fullName}</option>)}
      </select>
      {teacherId && periods.length > 0 && (
        <div className="overflow-x-auto">
          <table className="border-collapse text-xs">
            <thead>
              <tr>
                <th className="px-2 py-1 text-left text-gray-500 font-semibold" />
                {periods.map(p => <th key={p} className="px-1 py-1 text-center text-gray-500 font-semibold w-9">{p}</th>)}
              </tr>
            </thead>
            <tbody>
              {orderedDays.map(day => {
                const d = DAY_INDEX[day];
                return (
                  <tr key={day}>
                    <td className="px-2 py-1 text-gray-700 whitespace-nowrap">{dayLabel(day)}</td>
                    {periods.map(p => {
                      const isBlocked = blocked.has(`${teacherId}:${d}:${p}`);
                      return (
                        <td key={p} className="p-0.5">
                          <button type="button" onClick={() => toggle(d, p)}
                            className={`w-8 h-7 rounded flex items-center justify-center transition-colors ${isBlocked ? 'bg-rose-500 text-white hover:bg-rose-600' : 'bg-gray-50 hover:bg-gray-200 border border-gray-100'}`}
                            title={isBlocked ? t('schedule2.availability.blocked', 'Blocked') : t('schedule2.availability.available', 'Available')}>
                            {isBlocked ? <Ban className="w-3.5 h-3.5" /> : null}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
