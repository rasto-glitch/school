import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Calendar, X } from 'lucide-react';
import { adminApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Button from '../../components/common/Button';

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

        {/* Grid */}
        <Card className="!p-0 overflow-hidden">
          <div className="p-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">{t('admin.weekly_grid')}</h2>
            <span className="text-xs text-gray-500">
              {t('admin.grid_summary', { teachers: teachers.length, days: orderedDays.length, periods: periodsPerDay })}
            </span>
          </div>

          {loading ? (
            <div className="p-12 text-center text-gray-400 text-sm">{t('common.loading_more')}</div>
          ) : teachers.length === 0 ? (
            <div className="p-12 text-center text-gray-400 text-sm">
              {t('admin.no_teachers_schedule')}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="border-collapse text-xs">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-20 bg-gray-50 border-r border-b border-gray-200 px-3 py-2 text-left font-semibold text-gray-700 min-w-[140px]">
                      {t('supervisor.teacher_col')}
                    </th>
                    {orderedDays.map(day => (
                      <th
                        key={day}
                        colSpan={periodsPerDay}
                        className="bg-yellow-100 border-b border-r border-gray-200 px-2 py-1 text-center font-bold text-gray-800"
                      >
                        {dayLabel(day)}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    <th className="sticky left-0 z-20 bg-gray-50 border-r border-b border-gray-200 px-3 py-1"></th>
                    {orderedDays.flatMap(day =>
                      Array.from({ length: periodsPerDay }, (_, i) => (
                        <th
                          key={`${day}-${i + 1}`}
                          className="bg-blue-50 border-b border-r border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-700 text-center min-w-[70px]"
                        >
                          {i + 1}
                        </th>
                      ))
                    )}
                  </tr>
                </thead>
                <tbody>
                  {teachers.map(tch => (
                    <tr key={tch.id} className="hover:bg-gray-50/50">
                      <td className="sticky left-0 z-10 bg-white border-r border-b border-gray-200 px-3 py-2 font-medium text-gray-900">
                        <div className="truncate max-w-[180px]" title={tch.fullName}>{tch.fullName}</div>
                        {tch.subject && <div className="text-[10px] text-gray-500 truncate">{tch.subject}</div>}
                      </td>
                      {orderedDays.flatMap(day =>
                        Array.from({ length: periodsPerDay }, (_, i) => {
                          const dayIdx = DAY_INDEX[day];
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
                        })
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </PageLayout>
  );
}
