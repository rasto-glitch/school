import { Lock, Sparkles } from 'lucide-react';

/**
 * Reproduction of the admin timetable grid (Schedule 2.0) — days across the top,
 * periods down the side, a shaded break row, and pinned lessons the solver keeps.
 */
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu'];

type Cell = { subj: string; teacher: string; tint: string; pinned?: boolean } | 'break' | null;

const ROWS: { period: string; time: string; cells: Cell[] }[] = [
  { period: '1', time: '08:00', cells: [
    { subj: 'Math', teacher: 'Mr. Karwan', tint: 'bg-primary-50 text-primary-700', pinned: true },
    { subj: 'Physics', teacher: 'Ms. Dilan', tint: 'bg-violet-50 text-violet-700' },
    { subj: 'Arabic', teacher: 'Mr. Sami', tint: 'bg-amber-50 text-amber-700' },
    { subj: 'English', teacher: 'Ms. Ava', tint: 'bg-sky-50 text-sky-700' },
    { subj: 'Math', teacher: 'Mr. Karwan', tint: 'bg-primary-50 text-primary-700' },
  ] },
  { period: '2', time: '08:50', cells: [
    { subj: 'Biology', teacher: 'Ms. Nsh', tint: 'bg-emerald-50 text-emerald-700' },
    { subj: 'Math', teacher: 'Mr. Karwan', tint: 'bg-primary-50 text-primary-700' },
    { subj: 'English', teacher: 'Ms. Ava', tint: 'bg-sky-50 text-sky-700' },
    { subj: 'Chem', teacher: 'Mr. Aland', tint: 'bg-rose-50 text-rose-700' },
    { subj: 'Physics', teacher: 'Ms. Dilan', tint: 'bg-violet-50 text-violet-700', pinned: true },
  ] },
  { period: 'break', time: '09:40', cells: ['break', 'break', 'break', 'break', 'break'] },
  { period: '3', time: '10:00', cells: [
    { subj: 'Arabic', teacher: 'Mr. Sami', tint: 'bg-amber-50 text-amber-700' },
    { subj: 'English', teacher: 'Ms. Ava', tint: 'bg-sky-50 text-sky-700' },
    { subj: 'Math', teacher: 'Mr. Karwan', tint: 'bg-primary-50 text-primary-700' },
    { subj: 'Sport', teacher: 'Mr. Beri', tint: 'bg-slate-100 text-slate-600' },
    { subj: 'Biology', teacher: 'Ms. Nsh', tint: 'bg-emerald-50 text-emerald-700' },
  ] },
];

export default function ScheduleGridMock() {
  return (
    <div className="bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-[13px] font-extrabold text-slate-900">Grade 10 · A</div>
          <div className="text-[10px] text-slate-500">Weekly timetable</div>
        </div>
        <div className="inline-flex items-center gap-1.5 rounded-md bg-primary-600 px-2.5 py-1.5 text-[10px] font-semibold text-white">
          <Sparkles size={12} /> Auto-generate
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full border-collapse text-center">
          <thead>
            <tr className="bg-slate-50 text-[10px] font-bold text-slate-500">
              <th className="w-10 border-b border-e border-slate-200 py-1.5"></th>
              {DAYS.map((d) => (
                <th key={d} className="border-b border-e border-slate-200 py-1.5 last:border-e-0">{d}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.period}>
                <td className="border-e border-t border-slate-200 bg-slate-50 py-1 align-middle text-[9px] font-semibold text-slate-400">
                  {row.period === 'break' ? '—' : row.period}
                  <div className="text-[7px] font-normal">{row.time}</div>
                </td>
                {row.cells.map((cell, i) =>
                  cell === 'break' ? (
                    <td key={i} className="border-e border-t border-slate-200 bg-slate-100/70 py-1.5 text-[8px] font-medium uppercase tracking-wide text-slate-400 last:border-e-0">
                      Break
                    </td>
                  ) : cell ? (
                    <td key={i} className="border-e border-t border-slate-200 p-1 last:border-e-0">
                      <div className={`relative rounded-md px-1 py-1 ${cell.tint}`}>
                        {cell.pinned && <Lock size={7} className="absolute right-0.5 top-0.5 opacity-60" />}
                        <div className="text-[9px] font-bold leading-tight">{cell.subj}</div>
                        <div className="text-[7px] leading-tight opacity-70">{cell.teacher}</div>
                      </div>
                    </td>
                  ) : (
                    <td key={i} className="border-e border-t border-slate-200 last:border-e-0" />
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-2.5 flex items-center gap-3 text-[9px] text-slate-500">
        <span className="inline-flex items-center gap-1"><Lock size={9} /> pinned — kept on regenerate</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-slate-100 ring-1 ring-slate-200" /> break</span>
      </div>
    </div>
  );
}
