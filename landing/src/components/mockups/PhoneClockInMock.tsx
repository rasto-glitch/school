import { QrCode, MapPin, Clock, Check, CalendarDays, User } from 'lucide-react';

/**
 * Reproduction of the staff Clock-In tab — status, worked time, the scan-QR
 * action and the geofence check that every employee role gets on mobile.
 */
export default function PhoneClockInMock() {
  return (
    <div className="flex h-full flex-col bg-[#F3F4F6]">
      <div className="flex items-center justify-between px-5 pt-3 text-[9px] font-semibold text-slate-800">
        <span>9:41</span>
        <span className="tracking-widest">● ● ●</span>
      </div>

      <div className="flex-1 overflow-hidden px-4 pt-3">
        <div className="text-[17px] font-extrabold text-slate-900">Clock in</div>
        <div className="text-[11px] text-slate-500">Karwan · Teacher</div>

        {/* status card */}
        <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Clocked in
            </span>
            <Clock size={15} className="text-slate-400" />
          </div>
          <div className="mt-3 text-center">
            <div className="text-[28px] font-extrabold leading-none text-slate-900">4:12</div>
            <div className="mt-1 text-[10px] text-slate-500">worked today · in at 08:03</div>
          </div>
        </div>

        {/* geofence check */}
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-white p-3 shadow-sm">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-50 text-emerald-600">
            <MapPin size={15} />
          </div>
          <div className="flex-1">
            <div className="text-[11px] font-semibold text-slate-900">Within school grounds</div>
            <div className="text-[9px] text-slate-500">42 m from reception · verified</div>
          </div>
          <Check size={15} className="text-emerald-600" />
        </div>

        {/* scan button */}
        <div className="mt-3 flex items-center justify-center gap-2 rounded-2xl bg-primary-600 py-3 text-[13px] font-bold text-white shadow-lg shadow-primary-600/20">
          <QrCode size={17} /> Scan to clock out
        </div>
        <div className="mt-2 text-center text-[9px] text-slate-400">Reception QR rotates every few seconds</div>
      </div>

      <div className="flex items-center justify-around border-t border-slate-200 bg-white px-2 pb-4 pt-2">
        {[
          { icon: Clock, label: 'Clock in', active: true },
          { icon: CalendarDays, label: 'Leave' },
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
