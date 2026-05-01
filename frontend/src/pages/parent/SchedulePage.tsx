import { useEffect, useMemo, useState } from 'react';
import { Calendar } from 'lucide-react';
import { parentApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Select from '../../components/common/Select';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import type { Student } from '../../types';

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
const DAY_INDEX: Record<string, number> = Object.fromEntries(DAY_NAMES.map((d, i) => [d, i]));
const DAY_LABEL: Record<string, string> = {
  sunday: 'Sunday', monday: 'Monday', tuesday: 'Tuesday',
  wednesday: 'Wednesday', thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday',
};

interface Cell { id: string; dayOfWeek: number; periodIndex: number; teachers?: { id: string; fullName: string; subject?: string } }

type View = 'week' | 'today';

export default function ParentSchedulePage() {
  const [children, setChildren] = useState<Student[]>([]);
  const [selectedChild, setSelectedChild] = useState('');
  const [periodsPerDay, setPeriodsPerDay] = useState(6);
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
        setPeriodsPerDay(d.periodsPerDay);
        setScheduleDays(d.scheduleDays || []);
        setCells(d.assignments || []);
      })
      .finally(() => setLoading(false));
  }, [selectedChild]);

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

  return (
    <PageLayout title="Schedule" subtitle="Your child's weekly classes">
      <div className="space-y-4">
        {children.length > 1 && (
          <div className="w-full sm:w-56">
            <Select
              label="Child"
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
            Whole week
          </button>
          <button
            onClick={() => setView('today')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${view === 'today' ? 'bg-white text-primary-600 shadow-sm' : 'text-gray-600'}`}
          >
            Today
          </button>
        </div>

        {loading ? (
          <LoadingSpinner />
        ) : children.length === 0 ? (
          <Card>
            <p className="text-sm text-gray-500 text-center py-6">No students linked to this account.</p>
          </Card>
        ) : view === 'today' && !todayIsScheduled ? (
          <Card>
            <div className="flex items-center gap-3 text-gray-500">
              <Calendar className="w-5 h-5" />
              <p className="text-sm">No classes scheduled for {DAY_LABEL[todayName]}.</p>
            </div>
          </Card>
        ) : visibleDays.length === 0 || cells.length === 0 ? (
          <Card>
            <div className="text-center py-8 text-gray-400 text-sm">
              No schedule has been published yet for your child's class.
            </div>
          </Card>
        ) : (
          <Card className="!p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="border-collapse text-sm w-full">
                <thead>
                  <tr>
                    <th className="bg-gray-50 border-r border-b border-gray-200 px-3 py-2 text-left font-semibold text-gray-700 min-w-[120px]">
                      Day
                    </th>
                    {Array.from({ length: periodsPerDay }, (_, i) => (
                      <th
                        key={i}
                        className="bg-blue-50 border-r border-b border-gray-200 px-3 py-2 text-center font-semibold text-gray-700"
                      >
                        Period {i + 1}
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
                          {DAY_LABEL[day]}
                        </td>
                        {Array.from({ length: periodsPerDay }, (_, i) => {
                          const cell = cellMap.get(`${dayIdx}:${i + 1}`);
                          const subject = cell?.teachers?.subject?.trim();
                          const teacher = cell?.teachers?.fullName;
                          return (
                            <td
                              key={i}
                              className="border-r border-b border-gray-200 px-3 py-2 text-center align-middle"
                            >
                              {subject ? (
                                <div>
                                  <div className="text-sm font-semibold text-gray-900">{subject}</div>
                                  {teacher && <div className="text-[11px] text-gray-500 mt-0.5">{teacher}</div>}
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
