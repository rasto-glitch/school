import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, CheckCircle2, XCircle, Clock, CalendarOff, Lock } from 'lucide-react';
import { toast } from 'react-toastify';
import Card from '../common/Card';
import LoadingSpinner from '../common/LoadingSpinner';
import EmptyState from '../common/EmptyState';

export interface AttendanceTotals {
  present: number;
  absent: number;
  late: number;
  excused: number;
}

export interface HistoryYear {
  academicYear: string;
  gradeLevel: string;
  classId: string | null;
  className: string | null;
  status: string;
  startedOn: string;
  endedOn: string | null;
  totals: AttendanceTotals;
  frozen: boolean;
}

export interface DayEntry {
  date: string;
  status: 'present' | 'absent' | 'late' | 'excused';
  notes: string | null;
  className: string | null;
}

interface Props {
  loading: boolean;
  years: HistoryYear[];
  studentName: string;
  // Lazy day-loader. Called when the user expands a year. Should resolve to
  // the day list for that year, or null on a 404 (e.g. no enrollment).
  loadDays: (academicYear: string) => Promise<{ days: DayEntry[]; startedOn: string | null; endedOn: string | null } | null>;
}

const STATUS_PILL: Record<string, string> = {
  enrolled:    'bg-sky-50 text-sky-700',
  promoted:    'bg-emerald-50 text-emerald-700',
  retained:    'bg-amber-50 text-amber-700',
  on_leave:    'bg-violet-50 text-violet-700',
  withdrew:    'bg-gray-100 text-gray-600',
  transferred: 'bg-blue-50 text-blue-700',
  graduated:   'bg-purple-50 text-purple-700',
};

const DAY_COLOR: Record<DayEntry['status'], string> = {
  present: 'bg-emerald-500 text-white',
  absent:  'bg-red-500 text-white',
  late:    'bg-amber-500 text-white',
  excused: 'bg-violet-500 text-white',
};

const DAY_ICON: Record<DayEntry['status'], typeof CheckCircle2> = {
  present: CheckCircle2,
  absent:  XCircle,
  late:    Clock,
  excused: CalendarOff,
};

function attendanceRate(t: AttendanceTotals): number | null {
  const total = t.present + t.absent + t.late + t.excused;
  if (total === 0) return null;
  // Present + late count as "attended"; absent and excused don't.
  return Math.round(((t.present + t.late) / total) * 1000) / 10;
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function monthLabel(year: number, month: number, locale: string): string {
  return new Date(year, month, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
}

// Group days into per-month buckets, in chronological order. We only emit
// months that have at least one row so an empty September isn't rendered.
function groupByMonth(days: DayEntry[]): { year: number; month: number; rows: DayEntry[] }[] {
  const map = new Map<string, DayEntry[]>();
  for (const d of days) {
    const key = d.date.slice(0, 7); // YYYY-MM
    const arr = map.get(key) ?? [];
    arr.push(d);
    map.set(key, arr);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, rows]) => {
      const [y, m] = key.split('-').map(Number);
      return { year: y, month: m - 1, rows };
    });
}

function MonthGrid({ year, month, rows, locale }: { year: number; month: number; rows: DayEntry[]; locale: string }) {
  const { t } = useTranslation();
  const byDay = new Map(rows.map(r => [Number(r.date.slice(8, 10)), r]));
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
        {monthLabel(year, month, locale)}
      </p>
      <div className="grid grid-cols-7 gap-1">
        {(t('attendance_history.weekday_short', { returnObjects: true, defaultValue: ['S','M','T','W','T','F','S'] }) as string[]).map((d, i) => (
          <div key={i} className="text-[10px] text-center text-gray-400 font-medium">{d}</div>
        ))}
        {cells.map((day, i) => {
          if (!day) return <div key={i} className="aspect-square" />;
          const row = byDay.get(day);
          if (!row) {
            return (
              <div key={i} className="aspect-square rounded-md bg-gray-50 flex items-center justify-center text-xs text-gray-400">
                {day}
              </div>
            );
          }
          const color = DAY_COLOR[row.status];
          return (
            <div
              key={i}
              title={`${row.date} · ${row.status}${row.notes ? ` — ${row.notes}` : ''}`}
              className={`aspect-square rounded-md ${color} flex items-center justify-center text-xs font-semibold cursor-default`}
            >
              {day}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function AttendanceHistoryView({ loading, years, studentName, loadDays }: Props) {
  const { t, i18n } = useTranslation();
  const [expandedYear, setExpandedYear] = useState<string | null>(null);
  const [daysByYear, setDaysByYear] = useState<Record<string, { days: DayEntry[]; loaded: boolean; loading: boolean }>>({});

  // Auto-expand the most recent year (whichever is first in the sorted list
  // returned by the backend) when the page first loads with data.
  useEffect(() => {
    if (years.length === 0 || expandedYear) return;
    const last = years[years.length - 1];
    setExpandedYear(last.academicYear);
  }, [years, expandedYear]);

  // Lazy-load days when a year is expanded for the first time.
  useEffect(() => {
    if (!expandedYear) return;
    if (daysByYear[expandedYear]?.loaded || daysByYear[expandedYear]?.loading) return;
    setDaysByYear(prev => ({ ...prev, [expandedYear]: { days: [], loaded: false, loading: true } }));
    loadDays(expandedYear)
      .then(res => {
        setDaysByYear(prev => ({
          ...prev,
          [expandedYear]: { days: res?.days ?? [], loaded: true, loading: false },
        }));
      })
      .catch(() => {
        toast.error(t('common.error'));
        setDaysByYear(prev => ({ ...prev, [expandedYear]: { days: [], loaded: true, loading: false } }));
      });
  }, [expandedYear, daysByYear, loadDays, t]);

  const expanded = expandedYear ? daysByYear[expandedYear] : null;
  const monthlyGroups = useMemo(() => expanded ? groupByMonth(expanded.days) : [], [expanded]);

  if (loading) return <div className="flex justify-center py-12"><LoadingSpinner /></div>;
  if (years.length === 0) {
    return (
      <EmptyState
        title={t('attendance_history.empty_title', 'No attendance history yet')}
        description={t('attendance_history.empty_body', 'This student has no enrollment years on record.')}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Per-year summary */}
      <Card className="!p-0 overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
          <p className="font-semibold text-gray-900">{studentName}</p>
          <p className="text-xs text-gray-500 mt-0.5">{t('attendance_history.subtitle', 'Per-year attendance summary. Click a row to view the daily calendar.')}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-white text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
              <tr>
                <th className="text-left px-3 py-2 font-medium">{t('attendance_history.col_year', 'Year')}</th>
                <th className="text-left px-3 py-2 font-medium">{t('attendance_history.col_class', 'Class · Grade')}</th>
                <th className="text-left px-3 py-2 font-medium">{t('attendance_history.col_status', 'Status')}</th>
                <th className="text-right px-3 py-2 font-medium text-emerald-700">{t('common.present')}</th>
                <th className="text-right px-3 py-2 font-medium text-red-700">{t('common.absent')}</th>
                <th className="text-right px-3 py-2 font-medium text-amber-700">{t('common.late')}</th>
                <th className="text-right px-3 py-2 font-medium text-violet-700">{t('supervisor.excused', 'Excused')}</th>
                <th className="text-right px-3 py-2 font-medium">{t('attendance_history.col_rate', 'Rate')}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {years.map(y => {
                const rate = attendanceRate(y.totals);
                const isOpen = expandedYear === y.academicYear;
                return (
                  <tr
                    key={y.academicYear}
                    className={`hover:bg-gray-50/60 cursor-pointer ${isOpen ? 'bg-primary-50/40' : ''}`}
                    onClick={() => setExpandedYear(isOpen ? null : y.academicYear)}
                  >
                    <td className="px-3 py-2 font-semibold text-gray-900">{y.academicYear}</td>
                    <td className="px-3 py-2">
                      <span className="text-gray-700">{y.className ?? '—'}</span>
                      <span className="text-xs text-gray-400 ml-1">· {y.gradeLevel}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_PILL[y.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {t(`attendance_history.status_${y.status}`, y.status)}
                        {y.frozen && <Lock className="w-3 h-3 opacity-60" />}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{y.totals.present}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{y.totals.absent}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{y.totals.late}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{y.totals.excused}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">
                      {rate === null ? <span className="text-gray-400">—</span> : `${rate}%`}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Daily calendar for the expanded year */}
      {expandedYear && (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="font-semibold text-gray-900">{expandedYear}</p>
              <p className="text-xs text-gray-500">{t('attendance_history.daily_subtitle', 'Day-by-day attendance for this academic year.')}</p>
            </div>
            <div className="flex items-center gap-2 text-xs">
              {(['present','absent','late','excused'] as DayEntry['status'][]).map(s => {
                const Icon = DAY_ICON[s];
                return (
                  <span key={s} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${DAY_COLOR[s]}`}>
                    <Icon className="w-3 h-3" /> {t(`common.${s}`, s === 'excused' ? 'Excused' : s)}
                  </span>
                );
              })}
            </div>
          </div>

          {expanded?.loading ? (
            <div className="flex justify-center py-8"><LoadingSpinner /></div>
          ) : monthlyGroups.length === 0 ? (
            <EmptyState
              title={t('attendance_history.no_days_title', 'No marked days')}
              description={t('attendance_history.no_days_body', 'No attendance was recorded for this year.')}
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {monthlyGroups.map(g => (
                <MonthGrid key={`${g.year}-${g.month}`} year={g.year} month={g.month} rows={g.rows} locale={i18n.language || 'en'} />
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
