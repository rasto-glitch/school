import { Home, Bus, BookOpen, MessageCircle, User } from 'lucide-react';

/**
 * Reproduction of the parent Dashboard screen — gray canvas, "Latest activity"
 * feed with the real badge colours (blue announcement, amber homework) and a bus
 * card, plus the bottom tab bar. Mirrors mobile/src/screens/parent/DashboardScreen.
 */
export default function PhoneHomeMock() {
  return (
    <div className="flex h-full flex-col bg-[#F3F4F6]">
      {/* status bar */}
      <div className="flex items-center justify-between px-5 pt-3 text-[9px] font-semibold text-slate-800">
        <span>9:41</span>
        <span className="tracking-widest">● ● ●</span>
      </div>

      <div className="flex-1 overflow-hidden px-4 pt-3">
        <div className="text-[17px] font-extrabold text-slate-900">Dashboard</div>
        <div className="text-[11px] text-slate-500">Good morning, Lana</div>

        <div className="mb-2 mt-4 text-[12px] font-semibold text-slate-600">Latest activity</div>

        {/* bus card */}
        <div className="mb-2.5 rounded-xl bg-white p-3 shadow-sm">
          <div className="mb-1.5 inline-flex rounded-full bg-primary-50 px-2 py-0.5 text-[9px] font-semibold text-primary-700">Bus</div>
          <div className="flex items-center justify-between">
            <div className="text-[12px] font-semibold text-slate-900">Bus 3 · arriving soon</div>
            <div className="text-[15px] font-extrabold text-primary-600">2 min</div>
          </div>
        </div>

        {/* announcement card */}
        <div className="mb-2.5 rounded-xl bg-white p-3 shadow-sm">
          <div className="mb-1.5 inline-flex rounded-full bg-[#DBEAFE] px-2 py-0.5 text-[9px] font-semibold text-[#1D4ED8]">Announcement</div>
          <div className="text-[12px] font-semibold text-slate-900">Parent–teacher day</div>
          <div className="text-[10px] leading-snug text-slate-500">Meetings open next Thursday. Book a slot with Ms. Dilan from the app.</div>
        </div>

        {/* homework card */}
        <div className="rounded-xl bg-white p-3 shadow-sm">
          <div className="mb-1.5 inline-flex rounded-full bg-[#FEF3C7] px-2 py-0.5 text-[9px] font-semibold text-[#92400E]">Homework</div>
          <div className="text-[12px] font-semibold text-slate-900">Math · Chapter 4</div>
          <div className="text-[10px] text-slate-400">Due tomorrow</div>
        </div>
      </div>

      {/* tab bar */}
      <div className="flex items-center justify-around border-t border-slate-200 bg-white px-2 pb-4 pt-2">
        {[
          { icon: Home, label: 'Home', active: true },
          { icon: Bus, label: 'Bus' },
          { icon: BookOpen, label: 'Learn' },
          { icon: MessageCircle, label: 'Chat' },
          { icon: User, label: 'Me' },
        ].map(({ icon: Icon, label, active }) => (
          <div key={label} className={`flex flex-col items-center gap-0.5 ${active ? 'text-primary-600' : 'text-slate-400'}`}>
            <Icon size={16} />
            <span className="text-[8px] font-medium">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
