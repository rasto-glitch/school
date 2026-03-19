import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../store/authStore';
import {
  Home, BookOpen, ClipboardList, Megaphone, BarChart2,
  MapPin, Bell, User, Users, GraduationCap, Bus,
  Calendar, Settings, UserCog, LogOut, ChevronLeft, ChevronRight,
  FileText, Star, Clock, X, ClipboardCheck
} from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import type { Role } from '../../types';

type NavItem = { to: string; icon: React.ElementType; label: string };

const navItems: Record<Role, NavItem[]> = {
  parent: [
    { to: '/parent/dashboard', icon: Home, label: 'Dashboard' },
    { to: '/parent/homework', icon: BookOpen, label: 'Homework' },
    { to: '/parent/assignments', icon: ClipboardList, label: 'Assignments' },
    { to: '/parent/announcements', icon: Megaphone, label: 'Announcements' },
    { to: '/parent/grades', icon: Star, label: 'Grades' },
    { to: '/parent/reports', icon: BarChart2, label: 'Reports' },
    { to: '/parent/bus', icon: MapPin, label: 'Track Bus' },
    { to: '/parent/appointments', icon: Calendar, label: 'Appointments' },
    { to: '/parent/notifications', icon: Bell, label: 'Notifications' },
    { to: '/parent/profile', icon: User, label: 'Profile' },
  ],
  teacher: [
    { to: '/teacher/dashboard', icon: Home, label: 'Dashboard' },
    { to: '/teacher/attendance', icon: ClipboardCheck, label: 'Attendance' },
    { to: '/teacher/homework', icon: BookOpen, label: 'Homework' },
    { to: '/teacher/assignments', icon: ClipboardList, label: 'Assignments' },
    { to: '/teacher/reports', icon: FileText, label: 'Reports' },
    { to: '/teacher/grades', icon: Star, label: 'Grades' },
    { to: '/teacher/weekly-summary', icon: Clock, label: 'Weekly Summary' },
    { to: '/teacher/students', icon: Users, label: 'Students' },
    { to: '/teacher/notifications', icon: Bell, label: 'Notifications' },
    { to: '/teacher/profile', icon: User, label: 'Profile' },
  ],
  admin: [
    { to: '/admin/dashboard', icon: Home, label: 'Dashboard' },
    { to: '/admin/students', icon: GraduationCap, label: 'Students' },
    { to: '/admin/classes', icon: BookOpen, label: 'Classes' },
    { to: '/admin/teachers', icon: Users, label: 'Teachers' },
    { to: '/admin/drivers', icon: Bus, label: 'Drivers' },
    { to: '/admin/student-brief', icon: BarChart2, label: 'Student Brief' },
    { to: '/admin/weekly-summary', icon: Clock, label: 'Weekly Summary' },
    { to: '/admin/appointments', icon: Calendar, label: 'Appointments' },
    { to: '/admin/announcements', icon: Megaphone, label: 'Announcements' },
    { to: '/admin/notifications', icon: Bell, label: 'Notifications' },
    { to: '/admin/accounts', icon: UserCog, label: 'Accounts' },
    { to: '/admin/settings', icon: Settings, label: 'Settings' },
    { to: '/admin/profile', icon: User, label: 'Profile' },
  ],
  driver: [
    { to: '/driver/dashboard', icon: Home, label: 'Dashboard' },
    { to: '/driver/drive', icon: MapPin, label: 'Start Drive' },
    { to: '/driver/students', icon: Users, label: 'Students' },
    { to: '/driver/profile', icon: User, label: 'Profile' },
  ],
  supervisor: [
    { to: '/supervisor/dashboard', icon: Home, label: 'Dashboard' },
    { to: '/supervisor/absent-today', icon: Users, label: 'Absent Today' },
    { to: '/supervisor/attendance', icon: ClipboardCheck, label: 'Attendance' },
    { to: '/supervisor/homework', icon: BookOpen, label: 'Homework' },
    { to: '/supervisor/assignments', icon: ClipboardList, label: 'Assignments' },
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
  const isRTL = ['ar', 'ku'].includes(i18n.language);
  const showLangSwitcher = user?.role === 'parent' || user?.role === 'driver';
  const items = user ? navItems[user.role] : [];

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
        {/* Desktop collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="ml-auto p-1 rounded-lg hover:bg-gray-100 transition-colors flex-shrink-0 hidden lg:flex"
        >
          {collapsed ? <ChevronRight className="w-4 h-4 text-gray-500" /> : <ChevronLeft className="w-4 h-4 text-gray-500" />}
        </button>
        {/* Mobile close button */}
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
        {items.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) => `
              flex items-center gap-3 px-4 py-2.5 mx-2 rounded-xl transition-colors duration-150
              ${isActive ? 'bg-primary-50 text-primary-700 font-semibold' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}
            `}
            title={collapsed ? label : undefined}
          >
            <Icon className="w-5 h-5 flex-shrink-0" />
            {!collapsed && <span className="text-sm">{t(`nav.${label.toLowerCase().replace(/ /g, '_')}`, label)}</span>}
          </NavLink>
        ))}
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
