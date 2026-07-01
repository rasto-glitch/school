import { Bus, MapPin, Navigation } from 'lucide-react';

/**
 * Reproduction of the parent bus-tracking view — a live route with the bus en
 * route and the proximity alert parents receive before it reaches their stop.
 */
export default function BusTrackMock() {
  return (
    <div className="relative h-full w-full overflow-hidden bg-[#eef1f6]">
      {/* stylised map */}
      <div className="absolute inset-0">
        {/* soft blocks = city */}
        <div className="absolute left-6 top-8 h-16 w-20 rounded-md bg-white/70" />
        <div className="absolute right-8 top-6 h-20 w-16 rounded-md bg-white/70" />
        <div className="absolute bottom-10 left-10 h-16 w-24 rounded-md bg-white/70" />
        <div className="absolute bottom-8 right-6 h-14 w-14 rounded-md bg-white/70" />
        {/* route */}
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 320 260" preserveAspectRatio="none">
          <path d="M40 220 C 90 180, 90 120, 150 110 S 250 90, 280 40" fill="none" stroke="#4F46E5" strokeWidth="3.5" strokeLinecap="round" strokeDasharray="2 9" opacity="0.7" />
        </svg>
        {/* home marker */}
        <div className="absolute" style={{ left: '78%', top: '12%' }}>
          <div className="grid h-6 w-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-emerald-500 text-white shadow-lg ring-4 ring-emerald-500/20">
            <MapPin size={12} />
          </div>
        </div>
        {/* bus marker */}
        <div className="absolute" style={{ left: '44%', top: '44%' }}>
          <div className="grid h-8 w-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-primary-600 text-white shadow-lg ring-4 ring-primary-600/25">
            <Bus size={15} />
          </div>
        </div>
      </div>

      {/* proximity alert card */}
      <div className="absolute inset-x-3 bottom-3 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur">
        <div className="flex items-center gap-2.5">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary-50 text-primary-600">
            <Navigation size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-bold text-slate-900">Bus 3 is 2 minutes away</div>
            <div className="text-[10px] text-slate-500">Route 3 · Ms. Hana driving · updated 4s ago</div>
          </div>
          <div className="text-right">
            <div className="text-[15px] font-extrabold leading-none text-primary-600">2:10</div>
            <div className="text-[9px] text-slate-400">to your stop</div>
          </div>
        </div>
        <div className="mt-2.5 flex gap-1">
          {['10 min', '5 min', '2 min', 'Arrived'].map((s, i) => (
            <div key={s} className="flex-1 text-center">
              <div className={`h-1 rounded-full ${i <= 2 ? 'bg-primary-500' : 'bg-slate-200'}`} />
              <div className={`mt-1 text-[8px] font-medium ${i === 2 ? 'text-primary-600' : 'text-slate-400'}`}>{s}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
