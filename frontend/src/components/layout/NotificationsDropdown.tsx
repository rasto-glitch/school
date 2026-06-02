import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bell, Calendar, KeyRound, MessageSquare } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { useNotificationStore } from '../../store/notificationStore';

interface NotificationsDropdownProps {
  open: boolean;
  onClose: () => void;
}

type Row = { icon: React.ElementType; tone: string; label: string; count: number; href: string };

export default function NotificationsDropdown({ open, onClose }: NotificationsDropdownProps) {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const {
    unreadCount,
    pendingAppointmentCount,
    teacherUnreadCount,
    adminResetRequestCount,
  } = useNotificationStore();
  const isRTL = ['ar', 'ku'].includes(i18n.language);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !user) return null;

  const rows: Row[] = [];
  const empty = { adminGoTo: '', viewAllHref: '' as string | '' };

  if (user.role === 'admin') {
    if (pendingAppointmentCount > 0) {
      rows.push({
        icon: Calendar, tone: 'bg-blue-50 text-blue-600',
        label: t('top_bar.notif_appointments', '{{count}} appointment requests', { count: pendingAppointmentCount }),
        count: pendingAppointmentCount, href: '/admin/appointments',
      });
    }
    if (adminResetRequestCount > 0) {
      rows.push({
        icon: KeyRound, tone: 'bg-amber-50 text-amber-600',
        label: t('top_bar.notif_reset_requests', '{{count}} password reset requests', { count: adminResetRequestCount }),
        count: adminResetRequestCount, href: '/admin/accounts',
      });
    }
    empty.viewAllHref = '/admin/notifications';
  } else if (user.role === 'parent') {
    if (unreadCount > 0) {
      rows.push({
        icon: MessageSquare, tone: 'bg-primary-50 text-primary-600',
        label: t('top_bar.notif_unread', '{{count}} new notifications', { count: unreadCount }),
        count: unreadCount, href: '/parent/notifications',
      });
    }
    empty.viewAllHref = '/parent/notifications';
  } else if (user.role === 'teacher') {
    if (teacherUnreadCount > 0) {
      rows.push({
        icon: MessageSquare, tone: 'bg-primary-50 text-primary-600',
        label: t('top_bar.notif_unread', '{{count}} new notifications', { count: teacherUnreadCount }),
        count: teacherUnreadCount, href: '/teacher/notifications',
      });
    }
    empty.viewAllHref = '/teacher/notifications';
  } else if (user.role === 'supervisor') {
    empty.viewAllHref = '/supervisor/notifications';
  } else if (user.role === 'reception') {
    if (pendingAppointmentCount > 0) {
      rows.push({
        icon: Calendar, tone: 'bg-blue-50 text-blue-600',
        label: t('top_bar.notif_appointments', '{{count}} appointment requests', { count: pendingAppointmentCount }),
        count: pendingAppointmentCount, href: '/reception/appointments',
      });
    }
  }

  const onRowClick = (href: string) => {
    onClose();
    navigate(href);
  };

  return (
    <>
      {/* click-catcher scrim */}
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        ref={panelRef}
        className={`absolute top-[calc(100%+8px)] z-50 w-[340px] max-w-[calc(100vw-32px)] bg-white border border-gray-200 rounded-2xl shadow-xl overflow-hidden ${isRTL ? 'left-0' : 'right-0'}`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <b className="text-sm font-semibold text-gray-900">{t('top_bar.notifications_title', 'Notifications')}</b>
        </div>
        <div className="max-h-[400px] overflow-y-auto">
          {rows.length === 0 ? (
            <div className="text-center py-10 px-5">
              <div className="w-11 h-11 rounded-xl bg-gray-50 flex items-center justify-center text-gray-400 mx-auto mb-3">
                <Bell className="w-5 h-5" />
              </div>
              <p className="text-sm font-medium text-gray-700">{t('top_bar.no_notifications', 'No notifications')}</p>
              <p className="text-xs text-gray-400 mt-1">{t('top_bar.all_caught_up', "You're all caught up.")}</p>
            </div>
          ) : (
            rows.map((row, i) => {
              const Icon = row.icon;
              return (
                <button
                  key={i}
                  onClick={() => onRowClick(row.href)}
                  className="w-full flex items-center gap-3 px-4 py-3 border-b border-gray-100 last:border-b-0 hover:bg-gray-50 transition-colors text-left"
                >
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${row.tone}`}>
                    <Icon className="w-[18px] h-[18px]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900 leading-tight">{row.label}</p>
                  </div>
                </button>
              );
            })
          )}
        </div>
        {empty.viewAllHref && (
          <div className="px-4 py-3 border-t border-gray-100 text-center">
            <button
              onClick={() => onRowClick(empty.viewAllHref)}
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
