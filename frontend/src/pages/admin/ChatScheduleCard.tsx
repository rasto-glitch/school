import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { Clock } from 'lucide-react';
import { adminApi } from '../../services/api';
import Card from '../../components/common/Card';
import Button from '../../components/common/Button';

type DayKey = 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday';
interface DayWindow { enabled: boolean; open: string; close: string; }
type Days = Record<DayKey, DayWindow>;

const DAY_ORDER: DayKey[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_LABEL: Record<DayKey, string> = {
  sunday: 'Sunday', monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday',
  thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday',
};

// Curated list; the school's stored tz is prepended if it isn't here.
const TIMEZONES = [
  'Asia/Baghdad', 'Asia/Riyadh', 'Asia/Dubai', 'Asia/Qatar', 'Asia/Kuwait',
  'Asia/Bahrain', 'Asia/Muscat', 'Asia/Amman', 'Asia/Beirut', 'Asia/Damascus',
  'Asia/Jerusalem', 'Asia/Tehran', 'Africa/Cairo', 'Europe/Istanbul', 'UTC',
];

function defaultDays(): Days {
  const d = {} as Days;
  for (const k of DAY_ORDER) {
    const weekday = k !== 'friday' && k !== 'saturday';
    d[k] = { enabled: weekday, open: '08:00', close: '20:00' };
  }
  return d;
}

function hydrateDays(raw: any): Days {
  const base = defaultDays();
  if (raw && typeof raw === 'object') {
    for (const k of DAY_ORDER) {
      const r = raw[k];
      if (r && typeof r === 'object') {
        base[k] = {
          enabled: r.enabled === true,
          open: typeof r.open === 'string' ? r.open : '08:00',
          close: typeof r.close === 'string' ? r.close : '20:00',
        };
      } else {
        base[k] = { ...base[k], enabled: false };
      }
    }
  }
  return base;
}

export default function ChatScheduleCard() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [timezone, setTimezone] = useState('Asia/Baghdad');
  const [days, setDays] = useState<Days>(defaultDays());

  useEffect(() => {
    adminApi.getSettings()
      .then(r => {
        const cr = r.data?.chatRestrictions;
        setEnabled(cr?.enabled === true);
        setDays(hydrateDays(cr?.days));
        if (r.data?.timezone) setTimezone(r.data.timezone);
      })
      .finally(() => setLoading(false));
  }, []);

  const tzOptions = TIMEZONES.includes(timezone) ? TIMEZONES : [timezone, ...TIMEZONES];

  const setDay = (k: DayKey, patch: Partial<DayWindow>) =>
    setDays(prev => ({ ...prev, [k]: { ...prev[k], ...patch } }));

  const save = async () => {
    // Client-side guard mirrors the server: enabled days need close > open.
    for (const k of DAY_ORDER) {
      const d = days[k];
      if (enabled && d.enabled && d.close <= d.open) {
        toast.error(`${DAY_LABEL[k]}: closing time must be after opening time.`);
        return;
      }
    }
    setSaving(true);
    try {
      await adminApi.updateSettings({ timezone, chatRestrictions: { enabled, days } });
      toast.success('Chat schedule saved');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to save chat schedule');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <div className="flex items-center gap-2 mb-1">
        <Clock className="w-5 h-5 text-violet-600" />
        <h2 className="font-semibold text-gray-900">Chat Schedule</h2>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        Restrict parent ↔ teacher/supervisor messaging to set days and hours. Outside the
        window, both sides see the chat as closed and can't send (existing messages stay readable).
      </p>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-10 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Master toggle */}
          <label className="flex items-center justify-between gap-3 px-3 py-2.5 bg-gray-50 rounded-xl cursor-pointer">
            <span className="text-sm font-medium text-gray-800">Enforce a chat schedule</span>
            <input
              type="checkbox"
              checked={enabled}
              onChange={e => setEnabled(e.target.checked)}
              className="h-4 w-4 accent-violet-600"
            />
          </label>

          <div className={enabled ? '' : 'opacity-50 pointer-events-none'}>
            {/* Timezone */}
            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-600 mb-1">Timezone</label>
              <select
                value={timezone}
                onChange={e => setTimezone(e.target.value)}
                className="input-field w-full text-sm"
              >
                {tzOptions.map(tz => <option key={tz} value={tz}>{tz}</option>)}
              </select>
              <p className="text-xs text-gray-400 mt-1">Open/close times below are in this timezone.</p>
            </div>

            {/* Per-day rows */}
            <div className="space-y-2">
              {DAY_ORDER.map(k => {
                const d = days[k];
                return (
                  <div key={k} className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-xl">
                    <label className="flex items-center gap-2 w-32 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={d.enabled}
                        onChange={e => setDay(k, { enabled: e.target.checked })}
                        className="h-4 w-4 accent-violet-600"
                      />
                      <span className="text-sm font-medium text-gray-800">{DAY_LABEL[k]}</span>
                    </label>
                    <div className={`flex items-center gap-2 flex-1 ${d.enabled ? '' : 'opacity-40 pointer-events-none'}`}>
                      <input
                        type="time"
                        value={d.open}
                        onChange={e => setDay(k, { open: e.target.value })}
                        className="input-field text-sm py-1.5"
                      />
                      <span className="text-xs text-gray-400">to</span>
                      <input
                        type="time"
                        value={d.close}
                        onChange={e => setDay(k, { close: e.target.value })}
                        className="input-field text-sm py-1.5"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="text-right">
            <Button onClick={save} loading={saving}>Save chat schedule</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
