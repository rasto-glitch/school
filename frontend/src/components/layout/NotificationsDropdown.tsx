import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bell, Calendar, KeyRound, MessageSquare, Megaphone, Star, FileText, Loader2 } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { useNotificationStore } from '../../store/notificationStore';
import { adminApi } from '../../services/api';

interface NotificationsDropdownProps {
  open: boolean;
  onClose: () => void;
}

type InboxRow = {
  id: string;
  title: string;
  message: string;
  notificationType: string;
  relatedId?: string | null;
  isRead: boolean;
  createdAt: string;
};

type SummaryRow = { icon: React.ElementType; tone: string; label: string; count: number; href: string };

function iconForType(type: string): { icon: React.ElementType; tone: string } {
  switch (type) {
    case 'grade_pending':
    case 'grade':
      return { icon: Star, tone: 'bg-amber-50 text-amber-600' };
    case 'announcement':
      return { icon: Megaphone, tone: 'bg-purple-50 text-purple-600' };
    case 'appointment':
      return { icon: Calendar, tone: 'bg-blue-50 text-blue-600' };
    case 'report':
      return { icon: FileText, tone: 'bg-teal-50 text-teal-600' };
    case 'chat':
      return { icon: MessageSquare, tone: 'bg-primary-50 text-primary-600' };
    default:
      return { icon: Bell, tone: 'bg-gray-50 text-gray-600' };
  }
}

function timeAgo(iso: string, t: (k: string, fallback: string, opts?: Record<string, unknown>) => string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = Math.max(0, now - then);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return t('top_bar.just_now', 'just now');
  if (min < 60) return t('top_bar.mins_ago', '{{count}}m ago', { count: min });
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return t('top_bar.hours_ago', '{{count}}h ago', { count: hrs });
  const days = Math.floor(hrs / 24);
  return t('top_bar.days_ago', '{{count}}d ago', { count: days });
}

export default function NotificationsDropdown({ open, onClose }: NotificationsDropdownProps) {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const {
    unreadCount,
    pendingAppointmentCount,
    teacherUnreadCount,
    adminUnreadCount, setAdminUnreadCount,
    adminResetRequestCount,
  } = useNotificationStore();
  const isRTL = ['ar', 'ku'].includes(i18n.language);

  const [inbox, setInbox] = useState<InboxRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [marking, setMarking] = useState(false);

  // Fetch admin inbox when the dropdown opens for an admin
  useEffect(() => {
    if (!open) return;
    if (user?.role !== 'admin') return;
    setLoading(true);
    adminApi.getInbox(10)
      .then(r => setInbox((r.data?.data || []) as InboxRow[]))
      .catch(() => setInbox([]))
      .finally(() => setLoading(false));
  }, [open, user?.role]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !user) return null;

  const summary: SummaryRow[] = [];
  let viewAllHref = '';

  if (user.role === 'admin') {
    if (pendingAppointmentCount > 0) {
      summary.push({
        icon: Calendar, tone: 'bg-blue-50 text-blue-600',
        label: t('top_bar.notif_appointments', '{{count}} appointment requests', { count: pendingAppointmentCount }),
        count: pendingAppointmentCount, href: '/admin/appointments',
      });
    }
    if (adminResetRequestCount > 0) {
      summary.push({
        icon: KeyRound, tone: 'bg-amber-50 text-amber-600',
        label: t('top_bar.notif_reset_requests', '{{count}} password reset requests', { count: adminResetRequestCount }),
        count: adminResetRequestCount, href: '/admin/accounts',
      });
    }
  } else if (user.role === 'parent') {
    if (unreadCount > 0) {
      summary.push({
        icon: MessageSquare, tone: 'bg-primary-50 text-primary-600',
        label: t('top_bar.notif_unread', '{{count}} new notifications', { count: unreadCount }),
        count: unreadCount, href: '/parent/notifications',
      });
    }
    viewAllHref = '/parent/notifications';
  } else if (user.role === 'teacher') {
    if (teacherUnreadCount > 0) {
      summary.push({
        icon: MessageSquare, tone: 'bg-primary-50 text-primary-600',
        label: t('top_bar.notif_unread', '{{count}} new notifications', { count: teacherUnreadCount }),
        count: teacherUnreadCount, href: '/teacher/notifications',
      });
    }
    viewAllHref = '/teacher/notifications';
  } else if (user.role === 'supervisor') {
    viewAllHref = '/supervisor/notifications';
  } else if (user.role === 'reception') {
    if (pendingAppointmentCount > 0) {
      summary.push({
        icon: Calendar, tone: 'bg-blue-50 text-blue-600',
        label: t('top_bar.notif_appointments', '{{count}} appointment requests', { count: pendingAppointmentCount }),
        count: pendingAppointmentCount, href: '/reception/appointments',
      });
    }
  }

  const handleNavigate = (href: string) => {
    onClose();
    navigate(href);
  };

  const handleInboxClick = async (row: InboxRow) => {
    if (!row.isRead) {
      adminApi.markNotificationRead(row.id).catch(() => {});
      setInbox(prev => prev.map(r => r.id === row.id ? { ...r, isRead: true } : r));
      setAdminUnreadCount(Math.max(0, adminUnreadCount - 1));
    }
    onClose();
  };

  const handleMarkAllRead = async () => {
    if (user.role !== 'admin') return;
    setMarking(true);
    try {
      await adminApi.markAllNotificationsRead();
      setInbox(prev => prev.map(r => ({ ...r, isRead: true })));
      setAdminUnreadCount(0);
    } catch {
      // silent — toast would steal focus from the dropdown
    } finally {
      setMarking(false);
    }
  };

  const isAdmin = user.role === 'admin';
  const hasContent = summary.length > 0 || inbox.length > 0;
  const hasUnreadInbox = isAdmin && inbox.some(r => !r.isRead);

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className={`absolute top-[calc(100%+8px)] z-50 w-[360px] max-w-[calc(100vw-32px)] bg-white border border-gray-200 rounded-2xl shadow-xl overflow-hidden ${isRTL ? 'left-0' : 'right-0'}`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <b className="text-sm font-semibold text-gray-900">{t('top_bar.notifications_title', 'Notifications')}</b>
          {isAdmin && hasUnreadInbox && (
            <button
              onClick={handleMarkAllRead}
              disabled={marking}
              className="text-xs font-semibold text-primary-700 hover:text-primary-800 disabled:opacity-50"
            >
              {marking ? <Loader2 className="w-3.5 h-3.5 animate-spin inline" /> : t('top_bar.mark_all_read', 'Mark all read')}
            </button>
          )}
        </div>

        <div className="max-h-[440px] overflow-y-auto">
          {/* Summary rows (count-driven, always at top) */}
          {summary.map((row, i) => {
            const Icon = row.icon;
            return (
              <button
                key={`summary-${i}`}
                onClick={() => handleNavigate(row.href)}
                className="w-full flex items-center gap-3 px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors text-left"
              >
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${row.tone}`}>
                  <Icon className="w-[18px] h-[18px]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-900 leading-tight">{row.label}</p>
                </div>
              </button>
            );
          })}

          {/* Admin inbox list */}
          {isAdmin && loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
            </div>
          )}
          {isAdmin && !loading && inbox.map(row => {
            const { icon: Icon, tone } = iconForType(row.notificationType);
            return (
              <button
                key={row.id}
                onClick={() => handleInboxClick(row)}
                className={`w-full flex items-start gap-3 px-4 py-3 border-b border-gray-100 last:border-b-0 hover:bg-gray-50 transition-colors text-left ${!row.isRead ? 'bg-primary-50/40' : ''}`}
              >
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${tone}`}>
                  <Icon className="w-[18px] h-[18px]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-900 font-medium leading-tight truncate">{row.title}</p>
                  <p className="text-xs text-gray-600 mt-0.5 line-clamp-2">{row.message}</p>
                  <p className="text-[11px] text-gray-400 mt-1">{timeAgo(row.createdAt, t as any)}</p>
                </div>
                {!row.isRead && <span className="w-2 h-2 rounded-full bg-primary-500 mt-1.5 flex-shrink-0" />}
              </button>
            );
          })}

          {/* Empty state */}
          {!hasContent && !loading && (
            <div className="text-center py-10 px-5">
              <div className="w-11 h-11 rounded-xl bg-gray-50 flex items-center justify-center text-gray-400 mx-auto mb-3">
                <Bell className="w-5 h-5" />
              </div>
              <p className="text-sm font-medium text-gray-700">{t('top_bar.no_notifications', 'No notifications')}</p>
              <p className="text-xs text-gray-400 mt-1">{t('top_bar.all_caught_up', "You're all caught up.")}</p>
            </div>
          )}
        </div>

        {viewAllHref && (
          <div className="px-4 py-3 border-t border-gray-100 text-center">
            <button
              onClick={() => handleNavigate(viewAllHref)}
              className="text-sm font-semibold text-primary-700 hover:text-primary-800"
            >
              {t('top_bar.view_all', 'View all notifications')}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
