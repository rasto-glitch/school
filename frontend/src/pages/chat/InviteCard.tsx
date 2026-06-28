import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { CalendarClock, CheckCircle2, Clock, XCircle, Loader2 } from 'lucide-react';
import type { Message } from './MessageBubble';

interface Props {
  msg: Message;
  isParent: boolean;       // current viewer is the invited parent
  primaryColor: string;
  busy: boolean;
  onChooseTime: (msg: Message) => void;
  onDecline: (msg: Message) => void;
}

// In-chat meeting-invite card (Phase D chat extension). Renders the live
// appointment status; the invited parent fills it inline (Choose a time) or
// declines — no redirect. The supervisor sees the same card update live.
export default function InviteCard({ msg, isParent, primaryColor, busy, onChooseTime, onDecline }: Props) {
  const { t } = useTranslation();
  const appt = msg.appointment;
  const status = appt?.status ?? 'invited';
  const reason = appt?.inviteReason || msg.content;

  const fmt = (iso?: string) => (iso ? format(new Date(iso), 'MMM d, yyyy') : '');

  return (
    <div className="flex justify-center my-3 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5" style={{ backgroundColor: primaryColor }}>
          <CalendarClock className="w-4 h-4 text-white" />
          <span className="text-sm font-semibold text-white">{t('chat.invite.title')}</span>
        </div>

        <div className="px-4 py-3 space-y-2">
          {reason && (
            <p className="text-sm text-gray-700">
              <span className="text-gray-400">{t('chat.invite.reason_label')}: </span>
              {reason}
            </p>
          )}

          {/* Status line */}
          {status === 'invited' && !isParent && (
            <p className="flex items-center gap-1.5 text-sm text-gray-500">
              <Clock className="w-4 h-4" /> {t('chat.invite.waiting')}
            </p>
          )}
          {status === 'pending' && (
            <p className="flex items-center gap-1.5 text-sm text-amber-600">
              <Clock className="w-4 h-4" /> {t('chat.invite.status_pending')}
            </p>
          )}
          {status === 'approved' && (
            <p className="flex items-center gap-1.5 text-sm text-green-600">
              <CheckCircle2 className="w-4 h-4" />
              {appt?.scheduledDate
                ? t('chat.invite.scheduled_for', { date: fmt(appt.scheduledDate) })
                : t('chat.invite.status_approved')}
            </p>
          )}
          {status === 'rejected' && (
            <p className="flex items-center gap-1.5 text-sm text-gray-400">
              <XCircle className="w-4 h-4" /> {t('chat.invite.status_declined')}
            </p>
          )}

          {/* Parent actions — only while still invited */}
          {status === 'invited' && isParent && (
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => onChooseTime(msg)}
                disabled={busy}
                className="flex-1 py-2 rounded-xl text-white text-sm font-semibold active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
                style={{ backgroundColor: primaryColor }}
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarClock className="w-4 h-4" />}
                {t('chat.invite.choose_time')}
              </button>
              <button
                onClick={() => onDecline(msg)}
                disabled={busy}
                className="px-4 py-2 rounded-xl border border-gray-200 text-gray-600 text-sm font-semibold hover:bg-gray-50 active:scale-95 transition-all disabled:opacity-50"
              >
                {t('chat.invite.decline')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
