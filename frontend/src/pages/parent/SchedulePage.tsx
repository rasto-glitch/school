import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, Coffee } from 'lucide-react';
import { parentApi, type ScheduleSlot } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Select from '../../components/common/Select';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import type { Student } from '../../types';

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
const DAY_INDEX: Record<string, number> = Object.fromEntries(DAY_NAMES.map((d, i) => [d, i]));

interface Cell { dayOfWeek: number; periodIndex: number; teacherName?: string | null; subjectName?: string | null; roomName?: string | null }

type View = 'week' | 'today';

export default function ParentSchedulePage() {
  const { t } = useTranslation();
  const dayLabel = (day: string) => t(`common.days.${day}`);
  const [children, setChildren] = useState<Student[]>([]);
  const [selectedChild, setSelectedChild] = useState('');
  const [skeleton, setSkeleton] = useState<ScheduleSlot[]>([]);
  const [scheduleDays, setScheduleDays] = useState<string[]>([]);
  const [cells, setCells] = useState<Cell[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('week');

  useEffect(() => {
    parentApi.getChildren().then(r => {
      const kids: Student[] = r.data || [];
      setChildren(kids);
      if (kids.length > 0) setSelectedChild(kids[0].id);
    }).finally(() => {
      // children alone don't end loading; schedule fetch will
    });
  }, []);

  useEffect(() => {
    if (!selectedChild) { setLoading(false); return; }
    setLoading(true);
    parentApi.getSchedule(selectedChild)
      .then(r => {
        const d = r.data;
        setSkeleton(d.skeleton || []);
        setScheduleDays(d.scheduleDays || []);
        setCells(d.assignments || []);
      })
      .finally(() => setLoading(false));
  }, [selectedChild]);

  const orderedDays = useMemo(() =>
    [...scheduleDays].sort((a, b) => (DAY_INDEX[a] ?? 99) - (DAY_INDEX[b] ?? 99)),
  [scheduleDays]);

  const columns = useMemo(() => {
    let p = 0;
    return skeleton.map((s, i) => s.kind === 'lesson'
      ? { key: `c${i}`, kind: 'lesson' as const, period: ++p, start: s.start, end: s.end }
      : { key: `c${i}`, kind: 'break' as const, label: s.label || t('schedule2.break', 'Break'), start: s.start, end: s.end });
  }, [skeleton, t]);

  const todayName = DAY_NAMES[new Date().getDay()];
  const todayIsScheduled = orderedDays.includes(todayName);
  const visibleDays = view === 'today' && todayIsScheduled ? [todayName] : orderedDays;

  const cellMap = useMemo(() => {
    const m = new Map<string, Cell>();
    for (const c of cells) m.set(`${c.dayOfWeek}:${c.periodIndex}`, c);
    return m;
  }, [cells]);

  return (
    <PageLayout title={t('schedule.title')} subtitle={t('schedule.subtitle')}>
      <div className="space-y-4">
        {children.length > 1 && (
          <div className="w-full sm:w-56">
            <Select
              label={t('common.child')}
              options={children.map(c => ({ value: c.id, label: c.fullName }))}
              value={selectedChild}
              onChange={e => setSelectedChild(e.target.value)}
            />
          </div>
        )}

        <div className="inline-flex rounded-xl bg-gray-100 p-1">
          <button
            onClick={() => setView('week')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${view === 'week' ? 'bg-white text-primary-600 shadow-sm' : 'text-gray-600'}`}
          >
            {t('schedule.whole_week')}
          </button>
          <button
            onClick={() => setView('today')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${view === 'today' ? 'bg-white text-primary-600 shadow-sm' : 'text-gray-600'}`}
          >
            {t('common.today')}
          </button>
        </div>

        {loading ? (
          <LoadingSpinner />
        ) : children.length === 0 ? (
          <Card>
            <p className="text-sm text-gray-500 text-center py-6">{t('schedule.no_students')}</p>
          </Card>
        ) : view === 'today' && !todayIsScheduled ? (
          <Card>
            <div className="flex items-center gap-3 text-gray-500">
              <Calendar className="w-5 h-5" />
              <p className="text-sm">{t('schedule.no_classes_today', { day: dayLabel(todayName) })}</p>
            </div>
          </Card>
        ) : visibleDays.length === 0 || cells.length === 0 ? (
          <Card>
            <div className="text-center py-8 text-gray-400 text-sm">
              {t('schedule.none_published')}
            </div>
          </Card>
        ) : (
          <Card className="!p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="border-collapse text-sm w-full">
                <thead>
                  <tr>
                    <th className="bg-gray-50 border-r border-b border-gray-200 px-3 py-2 text-left font-semibold text-gray-700 min-w-[120px]">
                      {t('schedule.day')}
                    </th>
                    {columns.map(col => col.kind === 'break' ? (
                      <th key={col.key} className="bg-amber-50 border-r border-b border-amber-200 px-1 py-2 text-center w-10 align-middle" title={`${col.label} · ${col.start}–${col.end}`}><Coffee className="w-3.5 h-3.5 mx-auto text-amber-600" /></th>
                    ) : (
                      <th key={col.key} className="bg-blue-50 border-r border-b border-gray-200 px-3 py-2 text-center font-semibold text-gray-700">
                        <div>{t('schedule.period', { number: col.period })}</div>
                        <div className="text-[10px] font-normal text-gray-400">{col.start}–{col.end}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleDays.map(day => {
                    const dayIdx = DAY_INDEX[day];
                    return (
                      <tr key={day} className="hover:bg-gray-50/50">
                        <td className="border-r border-b border-gray-200 px-3 py-2 font-bold text-gray-900 bg-yellow-50">
                          {dayLabel(day)}
                        </td>
                        {columns.map(col => {
                          if (col.kind === 'break') return <td key={col.key} className="border-r border-b border-amber-100 bg-amber-50/40" />;
                          const cell = cellMap.get(`${dayIdx}:${col.period}`);
                          const subject = cell?.subjectName?.trim();
                          return (
                            <td key={col.key} className="border-r border-b border-gray-200 px-3 py-2 text-center align-middle">
                              {subject ? (
                                <div>
                                  <div className="text-sm font-semibold text-gray-900">{subject}</div>
                                  {cell?.teacherName && <div className="text-[11px] text-gray-500 mt-0.5">{cell.teacherName}</div>}
                                  {cell?.roomName && <div className="text-[10px] text-gray-400">{cell.roomName}</div>}
                                </div>
                              ) : (
                                <span className="text-gray-300">—</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </PageLayout>
  );
}
