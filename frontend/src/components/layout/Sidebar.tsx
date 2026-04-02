import { useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../store/authStore';
import { useNotificationStore } from '../../store/notificationStore';
import { useSocketStore } from '../../store/socketStore';
import { parentApi, adminApi, teacherApi, chatApi, receptionApi } from '../../services/api';
import {
  Home, BookOpen, ClipboardList, Megaphone, BarChart2,
  MapPin, Bell, User, Users, GraduationCap, Bus,
  Calendar, Settings, UserCog, LogOut, ChevronLeft, ChevronRight,
  FileText, Star, Clock, X, ClipboardCheck, MessageSquare
} from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import type { Role } from '../../types';

type NavItem = { to: string; icon: React.ElementType; label: string; feature?: string };

const navItems: Record<Role, NavItem[]> = {
  parent: [
    { to: '/parent/dashboard', icon: Home, label: 'Dashboard' },
    { to: '/parent/homework', icon: BookOpen, label: 'Homework', feature: 'homework' },
    { to: '/parent/assignments', icon: ClipboardList, label: 'Assignments', feature: 'assignments' },
    { to: '/parent/announcements', icon: Megaphone, label: 'Announcements', feature: 'announcements' },
    { to: '/parent/grades', icon: Star, label: 'Grades', feature: 'grades' },
    { to: '/parent/reports', icon: BarChart2, label: 'Reports', feature: 'reports' },
    { to: '/parent/bus', icon: MapPin, label: 'Track Bus', feature: 'bus_tracking' },
    { to: '/parent/appointments', icon: Calendar, label: 'Appointments', feature: 'appointments' },
    { to: '/chat', icon: MessageSquare, label: 'Chat' },
    { to: '/parent/notifications', icon: Bell, label: 'Notifications' },
    { to: '/parent/profile', icon: User, label: 'Profile' },
  ],
  teacher: [
    { to: '/teacher/dashboard', icon: Home, label: 'Dashboard' },
    { to: '/teacher/attendance', icon: ClipboardCheck, label: 'Attendance', feature: 'attendance' },
    { to: '/teacher/homework', icon: BookOpen, label: 'Homework', feature: 'homework' },
    { to: '/teacher/assignments', icon: ClipboardList, label: 'Assignments', feature: 'assignments' },
    { to: '/teacher/reports', icon: FileText, label: 'Reports', feature: 'reports' },
    { to: '/teacher/grades', icon: Star, label: 'Grades', feature: 'grades' },
    { to: '/teacher/weekly-summary', icon: Clock, label: 'Weekly Summary', feature: 'weekly_summary' },
    { to: '/teacher/students', icon: Users, label: 'Students' },
    { to: '/chat', icon: MessageSquare, label: 'Chat', feature: 'chat' },
    { to: '/teacher/notifications', icon: Bell, label: 'Notifications' },
    { to: '/teacher/profile', icon: User, label: 'Profile' },
  ],
  admin: [
    { to: '/admin/dashboard', icon: Home, label: 'Dashboard' },
    { to: '/admin/students', icon: GraduationCap, label: 'Students' },
    { to: '/admin/classes', icon: BookOpen, label: 'Classes' },
    { to: '/admin/teachers', icon: Users, label: 'Teachers' },
    { to: '/admin/drivers', icon: Bus, label: 'Drivers', feature: 'bus_tracking' },
    { to: '/admin/announcements', icon: Megaphone, label: 'Announcements', feature: 'announcements' },
    { to: '/admin/notifications', icon: Bell, label: 'Notifications' },
    { to: '/admin/accounts', icon: UserCog, label: 'Accounts' },
    { to: '/admin/settings', icon: Settings, label: 'Settings' },
    { to: '/admin/profile', icon: User, label: 'Profile' },
  ],
  reception: [
    { to: '/reception/dashboard', icon: Home, label: 'Dashboard' },
    { to: '/reception/appointments', icon: Calendar, label: 'Appointments', feature: 'appointments' },
    { to: '/reception/profile', icon: User, label: 'Profile' },
  ],
  driver: [
    { to: '/driver/dashboard', icon: Home, label: 'Dashboard' },
    { to: '/driver/drive', icon: MapPin, label: 'Start Drive' },
    { to: '/driver/students', icon: Users, label: 'Students' },
    { to: '/driver/profile', icon: User, label: 'Profile' },
  ],
  supervisor: [
    { to: '/supervisor/dashboard', icon: Home, label: 'Dashboard' },
    { to: '/supervisor/absent-today', icon: Users, label: 'Absent Today', feature: 'attendance' },
    { to: '/supervisor/attendance', icon: ClipboardCheck, label: 'Attendance', feature: 'attendance' },
    { to: '/supervisor/homework', icon: BookOpen, label: 'Homework', feature: 'homework' },
    { to: '/supervisor/assignments', icon: ClipboardList, label: 'Assignments', feature: 'assignments' },
    { to: '/supervisor/weekly-summary', icon: Clock, label: 'Weekly Summary', feature: 'weekly_summary' },
    { to: '/supervisor/student-reports', icon: FileText, label: 'Student Reports', feature: 'reports' },
    { to: '/chat', icon: MessageSquare, label: 'Chat', feature: 'chat' },
    { to: '/supervisor/profile', icon: User, label: 'Profile' },
  ],
};

interface SidebarProps {
  collapsed: boolean;
  setCollapsed: Dispatch<SetStateAction<boolean>>;
  mobileOpen: boolean;
  setMobileOpen: Dispatch<SetStateAction<boolean>>;
}

export default function Sidebar({ collapsed, setCollapsed, mobileOpen, setMobileOpen }: SidebarProps) {
  const { user, school, logout } = useAuthStore();
  const { t, i18n } = useTranslation();
  const {
    unreadCount, setUnreadCount,
    pendingAppointmentCount, setPendingAppointmentCount, incrementPendingAppointmentCount,
    teacherUnreadCount, setTeacherUnreadCount, incrementTeacherUnreadCount,
    adminNotificationCount, setAdminNotificationCount, incrementAdminNotificationCount,
    chatUnreadCount, setChatUnreadCount, incrementChatUnreadCount,
  } = useNotificationStore();
  const { socket } = useSocketStore();
  const location = useLocation();

  // Load initial notification counts
  useEffect(() => {
    if (user?.role === 'parent') {
      parentApi.getUnreadCount().then(r => setUnreadCount(r.data?.count ?? 0)).catch(() => {});
    }
    if (user?.role === 'teacher') {
      teacherApi.getUnreadCount().then(r => setTeacherUnreadCount(r.data?.count ?? 0)).catch(() => {});
    }
    if (user?.role === 'admin') {
      adminApi.getUnreadNotificationCount().then(r => setAdminNotificationCount(r.data?.count ?? 0)).catch(() => {});
    }
    const chatRoles = ['parent', 'teacher', 'supervisor'];
    if (user?.role && chatRoles.includes(user.role)) {
      chatApi.getUnreadCount().then(r => setChatUnreadCount(r.data?.count ?? 0)).catch(() => {});
    }
  }, [user?.role]);

  // Appointment count init for admin and reception
  useEffect(() => {
    if (!user) return;

    if (user.role === 'admin') {
      adminApi.getPendingAppointmentCount()
        .then(r => setPendingAppointmentCount(r.data?.count ?? 0))
        .catch(() => {});
    }
    if (user.role === 'reception') {
      receptionApi.getPendingAppointmentCount()
        .then(r => setPendingAppointmentCount(r.data?.count ?? 0))
        .catch(() => {});
    }
  }, [user?.role]);

  // Socket listeners — use the shared socket from SocketProvider
  useEffect(() => {
    if (!socket || !user) return;

    const onAppointment = () => {
      const apptPath = user.role === 'reception' ? '/reception/appointments' : '/admin/appointments';
      if (window.location.pathname !== apptPath) {
        incrementPendingAppointmentCount();
      }
    };

    const onNotification = () => {
      if (user.role === 'teacher' && window.location.pathname !== '/teacher/notifications') {
        incrementTeacherUnreadCount();
      }
      if (user.role === 'admin' && window.location.pathname !== '/admin/notifications') {
        incrementAdminNotificationCount();
      }
    };

    const onChatMessage = (data: any) => {
      if (window.location.pathname !== '/chat') {
        // Only increment if message is from other person
        if (data.senderId !== user.id) {
          incrementChatUnreadCount();
        }
      }
    };

    socket.on('new_appointment', onAppointment);
    socket.on('notification', onNotification);
    socket.on('chat:message', onChatMessage);

    return () => {
      socket.off('new_appointment', onAppointment);
      socket.off('notification', onNotification);
      socket.off('chat:message', onChatMessage);
    };
  }, [socket, user]);

  // Auto-clear badges on navigation
  useEffect(() => {
    if (location.pathname === '/teacher/notifications' && teacherUnreadCount > 0) setTeacherUnreadCount(0);
    if (location.pathname === '/admin/notifications' && adminNotificationCount > 0) setAdminNotificationCount(0);
    if ((location.pathname === '/admin/appointments' || location.pathname === '/reception/appointments') && pendingAppointmentCount > 0) setPendingAppointmentCount(0);
    if (location.pathname === '/chat' && chatUnreadCount > 0) setChatUnreadCount(0);
  }, [location.pathname]);

  const isRTL = ['ar', 'ku'].includes(i18n.language);
  const showLangSwitcher = user?.role === 'parent' || user?.role === 'driver';
  const isFeatureEnabled = (feature?: string) => !feature || school?.features?.[feature] !== false;
  const items = user ? navItems[user.role].filter(item => isFeatureEnabled(item.feature)) : [];

  return (
    <aside className={`
      fixed top-0 h-screen bg-white z-30 flex flex-col transition-all duration-300
      ${isRTL ? 'right-0 border-l border-gray-200' : 'left-0 border-r border-gray-200'}
      ${mobileOpen ? 'translate-x-0' : isRTL ? 'translate-x-full lg:translate-x-0' : '-translate-x-full lg:translate-x-0'}
      w-64 ${collapsed ? 'lg:w-16' : 'lg:w-64'}
    `}>
      {/* Logo */}
      <div className="flex items-center gap-3 p-4 border-b border-gray-100">
        {school?.logoUrl ? (
          <img src={school.logoUrl} alt={school.name} className="w-8 h-8 rounded-lg object-cover flex-shrink-0" />
        ) : (
          <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center flex-shrink-0">
            <GraduationCap className="w-5 h-5 text-white" />
          </div>
        )}
        {!collapsed && (
          <span className="font-bold text-gray-900 text-sm truncate">{school?.name || 'School'}</span>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="ml-auto p-1 rounded-lg hover:bg-gray-100 transition-colors flex-shrink-0 hidden lg:flex"
        >
          {collapsed ? <ChevronRight className="w-4 h-4 text-gray-500" /> : <ChevronLeft className="w-4 h-4 text-gray-500" />}
        </button>
        <button
          onClick={() => setMobileOpen(false)}
          className="ml-auto p-1 rounded-lg hover:bg-gray-100 transition-colors flex-shrink-0 lg:hidden"
        >
          <X className="w-4 h-4 text-gray-500" />
        </button>
      </div>

      {/* Role badge */}
      {!collapsed && user && (
        <div className="px-4 py-2">
          <span className="text-xs font-medium text-primary-600 bg-primary-50 px-2 py-1 rounded-lg capitalize">
            {user.role} Portal
          </span>
        </div>
      )}

      {/* Nav links */}
      <nav className="flex-1 overflow-y-auto py-2">
        {items.map(({ to, icon: Icon, label }) => {
          const showNotifBadge = to === '/parent/notifications' && user?.role === 'parent' && unreadCount > 0;
          const showTeacherNotifBadge = to === '/teacher/notifications' && user?.role === 'teacher' && teacherUnreadCount > 0;
          const showApptBadge = (
            (to === '/admin/appointments' && user?.role === 'admin') ||
            (to === '/reception/appointments' && user?.role === 'reception')
          ) && pendingAppointmentCount > 0;
          const showAdminNotifBadge = to === '/admin/notifications' && user?.role === 'admin' && adminNotificationCount > 0;
          const showChatBadge = to === '/chat' && chatUnreadCount > 0;
          const showBadge = showNotifBadge || showTeacherNotifBadge || showApptBadge || showAdminNotifBadge || showChatBadge;
          const badgeCount = showNotifBadge ? unreadCount
            : showTeacherNotifBadge ? teacherUnreadCount
            : showApptBadge ? pendingAppointmentCount
            : showChatBadge ? chatUnreadCount
            : adminNotificationCount;
          return (
            <NavLink
              key={to}
              to={to}
              onClick={() => {
                setMobileOpen(false);
                if (showApptBadge) setPendingAppointmentCount(0);
                if (showTeacherNotifBadge) setTeacherUnreadCount(0);
                if (showAdminNotifBadge) setAdminNotificationCount(0);
                if (showChatBadge) setChatUnreadCount(0);
              }}
              className={({ isActive }) => `
                flex items-center gap-3 px-4 py-2.5 mx-2 rounded-xl transition-colors duration-150
                ${isActive ? 'bg-primary-50 text-primary-700 font-semibold' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}
              `}
              title={collapsed ? label : undefined}
            >
              <div className="relative flex-shrink-0">
                <Icon className="w-5 h-5" />
                {showBadge && collapsed && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full" />
                )}
              </div>
              {!collapsed && <span className="text-sm">{t(`nav.${label.toLowerCase().replace(/ /g, '_')}`, label)}</span>}
              {!collapsed && showBadge && (
                <span className="ml-auto bg-red-500 text-white text-xs font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                  {badgeCount > 99 ? '99+' : badgeCount}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* User + Logout */}
      <div className="border-t border-gray-100 p-4">
        {!collapsed && user && (
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0">
              {user.profilePicture ? (
                <img src={user.profilePicture} alt="" className="w-8 h-8 rounded-full object-cover" />
              ) : (
                <span className="text-sm font-bold text-primary-700">
                  {user.firstName?.[0]}{user.lastName?.[0]}
                </span>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">{user.firstName} {user.lastName}</p>
              <p className="text-xs text-gray-500 truncate">{user.username}</p>
            </div>
          </div>
        )}
        {showLangSwitcher && !collapsed && (
          <div className="mb-2">
            <select
              value={i18n.language}
              onChange={e => i18n.changeLanguage(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 bg-gray-50 text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-400 cursor-pointer"
            >
              <option value="en">🌐 English</option>
              <option value="ar">🌐 عربي</option>
              <option value="ku">🌐 کوردی</option>
            </select>
          </div>
        )}
        {showLangSwitcher && collapsed && (
          <select
            value={i18n.language}
            onChange={e => i18n.changeLanguage(e.target.value)}
            className="w-full text-xs border border-gray-200 rounded-xl p-1 mb-2 bg-gray-50 text-gray-700 focus:outline-none cursor-pointer"
            title="Language"
          >
            <option value="en">EN</option>
            <option value="ar">ع</option>
            <option value="ku">ک</option>
          </select>
        )}
        <button
          onClick={logout}
          className="flex items-center gap-3 text-red-500 hover:bg-red-50 rounded-xl transition-colors duration-150 w-full p-2"
          title={collapsed ? t('nav.logout') : undefined}
        >
          <LogOut className="w-5 h-5 flex-shrink-0" />
          {!collapsed && <span className="text-sm font-medium">{t('nav.logout')}</span>}
        </button>
      </div>
    </aside>
  );
}
