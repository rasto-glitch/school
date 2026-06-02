import { useState } from 'react';
import { Bell, Menu, Settings as SettingsIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../store/authStore';
import { useNotificationStore } from '../../store/notificationStore';
import AccountSettingsModal from './AccountSettingsModal';
import NotificationsDropdown from './NotificationsDropdown';
import type { Role } from '../../types';

interface HeaderProps {
  title: string;
  subtitle?: string;
  onMenuClick: () => void;
}

const PROFILE_ROUTE: Partial<Record<Role, string>> = {
  admin: '/admin/profile',
  parent: '/parent/profile',
  teacher: '/teacher/profile',
  reception: '/reception/profile',
  accountant: '/accounting/profile',
  driver: '/driver/profile',
  supervisor: '/supervisor/profile',
};

// Roles that get the bell dropdown. Driver/accountant have no notification source.
const ROLES_WITH_BELL: Role[] = ['admin', 'parent', 'teacher', 'supervisor', 'reception'];

export default function Header({ title, subtitle, onMenuClick }: HeaderProps) {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const {
    unreadCount, pendingAppointmentCount, teacherUnreadCount, adminUnreadCount, adminResetRequestCount,
  } = useNotificationStore();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);

  const role = user?.role as Role | undefined;
  const profileRoute = role ? PROFILE_ROUTE[role] : undefined;
  const showBell = !!role && ROLES_WITH_BELL.includes(role);

  // Per-role pip count
  const bellCount = (() => {
    if (!showBell) return 0;
    if (role === 'admin') return adminUnreadCount + pendingAppointmentCount + adminResetRequestCount;
    if (role === 'parent') return unreadCount;
    if (role === 'teacher') return teacherUnreadCount;
    if (role === 'reception') return pendingAppointmentCount;
    return 0; // supervisor: no count source, dropdown still available
  })();

  return (
    <header className="bg-white border-b border-gray-200 px-4 sm:px-6 py-3 flex items-center justify-between sticky top-0 z-20">
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={onMenuClick}
          className="lg:hidden p-2 rounded-xl hover:bg-gray-100 transition-colors flex-shrink-0"
        >
          <Menu className="w-5 h-5 text-gray-600" />
        </button>
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-bold text-gray-900 truncate">{title}</h1>
          {subtitle && <p className="text-sm text-gray-500 mt-0.5 truncate">{subtitle}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {showBell && (
          <div className="relative">
            <button
              onClick={() => setBellOpen(o => !o)}
              className="relative w-[38px] h-[38px] rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900 hover:border-gray-300 transition-colors flex items-center justify-center"
              aria-label={t('top_bar.notifications_title', 'Notifications')}
            >
              <Bell className="w-[18px] h-[18px]" />
              {bellCount > 0 && (
                <span className="absolute top-[7px] right-[8px] w-[7px] h-[7px] bg-red-500 rounded-full ring-2 ring-white" />
              )}
            </button>
            <NotificationsDropdown open={bellOpen} onClose={() => setBellOpen(false)} />
          </div>
        )}
        <button
          onClick={() => setSettingsOpen(true)}
          className="w-[38px] h-[38px] rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900 hover:border-gray-300 transition-colors flex items-center justify-center"
          aria-label={t('account_settings.title', 'Account Settings')}
        >
          <SettingsIcon className="w-[18px] h-[18px]" />
        </button>
        <button
          onClick={() => profileRoute && navigate(profileRoute)}
          className="w-[38px] h-[38px] rounded-full bg-primary-100 hover:bg-primary-200 transition-colors flex items-center justify-center overflow-hidden"
          aria-label={t('nav.profile', 'Profile')}
        >
          {user?.profilePicture ? (
            <img src={user.profilePicture} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-sm font-bold text-primary-700">
              {user?.firstName?.[0]}{user?.lastName?.[0]}
            </span>
          )}
        </button>
      </div>
      <AccountSettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </header>
  );
}
