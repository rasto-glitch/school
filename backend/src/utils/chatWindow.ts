// Chat schedule enforcement.
//
// A school may restrict parent ↔ staff chat to specific weekdays and per-day
// time windows. Times are interpreted in the school's IANA timezone. This is
// the single source of truth — both the send gate (chat.controller) and the
// GET /chat/window probe call isChatOpen() so web and mobile never do their
// own timezone math.

export type DayKey =
  | 'sunday' | 'monday' | 'tuesday' | 'wednesday'
  | 'thursday' | 'friday' | 'saturday';

export interface DayWindow {
  enabled: boolean;
  open?: string;   // "HH:MM" 24h, local to the school timezone
  close?: string;  // "HH:MM" 24h
}

export interface ChatRestrictions {
  enabled: boolean;
  days?: Partial<Record<DayKey, DayWindow>>;
}

export interface ChatWindowState {
  open: boolean;
  /** When closed: the next weekday chat reopens (omitted if never). */
  opensDay?: DayKey;
  /** When closed: "HH:MM" the next window opens. */
  opensTime?: string;
  /** English fallback sentence for the 423 body / clients without i18n. */
  message?: string;
}

const DAY_ORDER: DayKey[] = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
];

function localParts(tz: string, at: Date): { day: DayKey; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at);

  const weekday = parts.find(p => p.type === 'weekday')?.value?.toLowerCase() as DayKey;
  let hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
  if (hour === 24) hour = 0; // some ICU builds emit "24" for midnight under hour12:false
  return { day: weekday, minutes: hour * 60 + minute };
}

/** "HH:MM" → minutes since local midnight, or null if malformed. */
function toMinutes(hhmm?: string): number | null {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(':').map(Number);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/** 480 → "8:00 AM" (for the English fallback message only). */
function fmt12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function dayLabel(d: DayKey): string {
  return d.charAt(0).toUpperCase() + d.slice(1);
}

/** Find the next day+time chat opens, scanning today (later) then up to 7 days. */
function findNextOpening(
  days: Partial<Record<DayKey, DayWindow>>,
  nowDay: DayKey,
  nowMin: number,
): { day: DayKey; time: string } | null {
  const startIdx = DAY_ORDER.indexOf(nowDay);
  for (let offset = 0; offset <= 7; offset++) {
    const day = DAY_ORDER[(startIdx + offset) % 7];
    const w = days[day];
    if (!w?.enabled) continue;
    const o = toMinutes(w.open);
    const c = toMinutes(w.close);
    if (o === null || c === null || c <= o) continue;
    // Today's window only counts if it hasn't already closed.
    if (offset === 0 && nowMin >= o) continue;
    return { day, time: w.open as string };
  }
  return null;
}

/**
 * Authoritative open/closed decision.
 * Fails OPEN on a bad timezone or absent config so a typo can never lock an
 * entire school out of chat.
 */
export function isChatOpen(
  restrictions: ChatRestrictions | null | undefined,
  timezone: string | null | undefined,
  at: Date = new Date(),
): ChatWindowState {
  if (!restrictions || restrictions.enabled !== true) return { open: true };

  let nowDay: DayKey;
  let nowMin: number;
  try {
    const p = localParts(timezone || 'Asia/Baghdad', at);
    nowDay = p.day;
    nowMin = p.minutes;
  } catch {
    return { open: true };
  }

  const days = restrictions.days || {};
  const today = days[nowDay];
  if (today?.enabled) {
    const o = toMinutes(today.open);
    const c = toMinutes(today.close);
    if (o !== null && c !== null && c > o && nowMin >= o && nowMin < c) {
      return { open: true };
    }
  }

  const next = findNextOpening(days, nowDay, nowMin);
  if (!next) {
    return { open: false, message: 'Chat is currently closed by the school.' };
  }
  return {
    open: false,
    opensDay: next.day,
    opensTime: next.time,
    message: `Chat is closed. It reopens ${dayLabel(next.day)} at ${fmt12(next.time)}.`,
  };
}
