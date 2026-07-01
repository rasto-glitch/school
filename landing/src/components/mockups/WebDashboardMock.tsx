import {
  LayoutDashboard, Users, GraduationCap, Bus, Wallet, CalendarDays,
  MessagesSquare, Settings, Search, ClipboardCheck, FileClock, ShieldAlert,
} from 'lucide-react';

/**
 * Faithful reproduction of the admin "oversight cockpit" dashboard — sidebar,
 * KPI cards and the real "Needs your attention" region with actionable rows.
 * Built from the actual design tokens (indigo #4F46E5, slate) so a screenshot
 * can replace it later without a visual jump. Static / non-interactive.
 */
export default function WebDashboardMock() {
  return (
    <div className="flex h-[440px] w-full bg-slate-50 text-slate-900">
      {/* Sidebar */}
      <aside className="hidden w-44 shrink-0 flex-col border-e border-slate-200 bg-white px-3 py-4 sm:flex">
        <div className="mb-5 flex items-center gap-2 px-1">
          <div className="grid h-7 w-7 place-items-center rounded-lg bg-primary-600 text-[13px] font-black text-white">S</div>
          <span className="text-sm font-extrabold tracking-tight">Scholify</span>
        </div>
        <nav className="flex flex-col gap-0.5 text-[12px] font-medium text-slate-500">
          {[
            { icon: LayoutDashboard, label: 'Dashboard', active: true },
            { icon: Users, label: 'Students' },
            { icon: GraduationCap, label: 'Grades' },
            { icon: CalendarDays, label: 'Timetable' },
            { icon: Bus, label: 'Transport' },
            { icon: Wallet, label: 'Finance' },
            { icon: MessagesSquare, label: 'Chat' },
            { icon: Settings, label: 'Settings' },
          ].map(({ icon: Icon, label, active }) => (
            <div
              key={label}
              className={`flex items-center gap-2 rounded-lg px-2.5 py-2 ${
                active ? 'bg-primary-50 font-semibold text-primary-700' : ''
              }`}
            >
              <Icon size={14} />
              {label}
            </div>
          ))}
        </nav>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5">
          <div className="flex items-center gap-2 rounded-lg bg-slate-100 px-2.5 py-1.5 text-[11px] text-slate-400">
            <Search size={13} />
            <span>Search students, staff…</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-[11px] font-medium text-slate-500 md:inline">Al-Noor International</span>
            <div className="grid h-7 w-7 place-items-center rounded-full bg-primary-100 text-[11px] font-bold text-primary-700">RA</div>
          </div>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-hidden px-4 py-4">
          <div className="text-[15px] font-extrabold">Good morning, Rasto</div>
          <div className="mb-3 text-[11px] text-slate-500">Tuesday, 12 May · Term 2 in progress</div>

          {/* KPIs */}
          <div className="grid grid-cols-4 gap-2.5">
            {[
              { icon: Users, label: 'Students', value: '486', sub: '+12 this month', tint: 'text-primary-600 bg-primary-50' },
              { icon: GraduationCap, label: 'Teachers', value: '38', sub: '6 subjects', tint: 'text-violet-600 bg-violet-50' },
              { icon: Bus, label: 'Buses live', value: '4', sub: 'on route now', tint: 'text-amber-600 bg-amber-50' },
              { icon: Wallet, label: 'Collected', value: '$18.4k', sub: 'this month', tint: 'text-emerald-600 bg-emerald-50' },
            ].map(({ icon: Icon, label, value, sub, tint }) => (
              <div key={label} className="rounded-xl border border-slate-200 bg-white p-2.5">
                <div className={`mb-1.5 inline-flex h-6 w-6 items-center justify-center rounded-md ${tint}`}>
                  <Icon size={13} />
                </div>
                <div className="text-[16px] font-extrabold leading-none">{value}</div>
                <div className="mt-1 text-[10px] font-medium text-slate-500">{label}</div>
                <div className="text-[9px] text-slate-400">{sub}</div>
              </div>
            ))}
          </div>

          {/* Needs your attention */}
          <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
            <div className="mb-2 flex items-center gap-1.5 text-[12px] font-bold">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              Needs your attention
            </div>
            <div className="flex flex-col gap-1.5">
              {[
                { icon: FileClock, tint: 'text-amber-600 bg-amber-50', text: '3 teachers haven’t filed Term 2 grades', action: 'Remind' },
                { icon: ClipboardCheck, tint: 'text-sky-600 bg-sky-50', text: 'Attendance missing for 2 classes today', action: 'Notify' },
                { icon: ShieldAlert, tint: 'text-rose-600 bg-rose-50', text: '5 failed sign-ins on one account', action: 'Review' },
              ].map(({ icon: Icon, tint, text, action }) => (
                <div key={text} className="flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-2">
                  <div className="flex items-center gap-2 text-[11px] font-medium text-slate-700">
                    <span className={`inline-flex h-5 w-5 items-center justify-center rounded-md ${tint}`}>
                      <Icon size={12} />
                    </span>
                    {text}
                  </div>
                  <span className="rounded-md bg-primary-600 px-2 py-1 text-[10px] font-semibold text-white">{action}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
