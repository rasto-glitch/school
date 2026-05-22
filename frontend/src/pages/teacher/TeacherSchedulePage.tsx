import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar } from 'lucide-react';
import { teacherApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import LoadingSpinner from '../../components/common/LoadingSpinner';

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
const DAY_INDEX: Record<string, number> = Object.fromEntries(DAY_NAMES.map((d, i) => [d, i]));

interface Cell { id: string; dayOfWeek: number; periodIndex: number; classes?: { id: string; name: string } }

type View = 'week' | 'today';

export default function TeacherSchedulePage() {
  const { t } = useTranslation();
  const dayLabel = (day: string) => t(`common.days.${day}`);
  const [periodsPerDay, setPeriodsPerDay] = useState(6);
  const [scheduleDays, setScheduleDays] = useState<string[]>([]);
  const [cells, setCells] = useState<Cell[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('week');

  useEffect(() => {
    teacherApi.getSchedule().then(r => {
      const d = r.data;
      setPeriodsPerDay(d.periodsPerDay);
      setScheduleDays(d.scheduleDays || []);
      setCells(d.assignments || []);
    }).finally(() => setLoading(false));
  }, []);

  const orderedDays = useMemo(() =>
    [...scheduleDays].sort((a, b) => (DAY_INDEX[a] ?? 99) - (DAY_INDEX[b] ?? 99)),
  [scheduleDays]);

  const todayName = DAY_NAMES[new Date().getDay()];
  const todayIsScheduled = orderedDays.includes(todayName);
  const visibleDays = view === 'today' && todayIsScheduled ? [todayName] : orderedDays;

  const cellMap = useMemo(() => {
    const m = new Map<string, Cell>();
    for (const c of cells) m.set(`${c.dayOfWeek}:${c.periodIndex}`, c);
    return m;
  }, [cells]);

  if (loading) return <PageLayout title={t('schedule.title')}><LoadingSpinner /></PageLayout>;

  return (
    <PageLayout title={t('schedule.title')} subtitle={t('schedule.subtitle_teacher')}>
      <div className="space-y-4">
        {/* Toggle */}
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

        {view === 'today' && !todayIsScheduled ? (
          <Card>
            <div className="flex items-center gap-3 text-gray-500">
              <Calendar className="w-5 h-5" />
              <p className="text-sm">{t('schedule.no_classes_today', { day: dayLabel(todayName) })}</p>
            </div>
          </Card>
        ) : visibleDays.length === 0 || cells.length === 0 ? (
          <Card>
            <div className="text-center py-8 text-gray-400 text-sm">
              {t('schedule.none_published_teacher')}
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
                    {Array.from({ length: periodsPerDay }, (_, i) => (
                      <th
                        key={i}
                        className="bg-blue-50 border-r border-b border-gray-200 px-3 py-2 text-center font-semibold text-gray-700"
                      >
                        {t('schedule.period', { number: i + 1 })}
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
                        {Array.from({ length: periodsPerDay }, (_, i) => {
                          const cell = cellMap.get(`${dayIdx}:${i + 1}`);
                          return (
                            <td
                              key={i}
                              className="border-r border-b border-gray-200 px-3 py-2 text-center"
                            >
                              {cell?.classes?.name ? (
                                <span className="inline-block px-2.5 py-1 rounded-lg bg-primary-50 text-primary-700 text-xs font-semibold">
                                  {cell.classes.name}
                                </span>
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
