import { useEffect } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../store/authStore';
import { useNotificationStore } from '../../store/notificationStore';
import { useSocketStore } from '../../store/socketStore';
import { parentApi, adminApi, teacherApi, chatApi, receptionApi } from '../../services/api';
import {
  Home, BookOpen, ClipboardList, Megaphone, BarChart2,
  MapPin, Bell, User, Users, GraduationCap, Bus,
  Calendar, Settings, UserCog, LogOut, ChevronLeft, ChevronRight, ChevronDown,
  FileText, Star, Clock, X, ClipboardCheck, MessageSquare, Archive,
  CreditCard, Wallet, History, Receipt, BookOpenCheck,
  AlertCircle, FileBarChart, BarChart3, CalendarClock, ArrowLeftRight, Scale,
  ShieldCheck, UserPlus,
  // Send,                            // re-add when transfers UI is restored — see FEATURE.md
} from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import type { Role } from '../../types';

type NavItem = { to: string; icon: React.ElementType; label: string; feature?: string; end?: boolean };

// Admin nav supports nested, collapsible groups. Other roles stay flat.
// Single-open accordion: the group(s) on the active leaf's path expand; siblings collapse.
type LeafNode = {
  kind: 'leaf';
  path: string;                       // pathname
  params?: Record<string, string>;    // search params required for "active" match (and used when building the href)
  icon: React.ElementType;
  labelKey: string;
  labelFallback: string;
  feature?: string;
  // When the URL has none of the param keys set, the leaf flagged isDefault wins.
  isDefault?: boolean;
  end?: boolean;
};
type GroupNode = {
  kind: 'group';
  key: string;
  icon: React.ElementType;
  labelKey: string;
  labelFallback: string;
  feature?: string;
  children: AdminNavNode[];
};
type AdminNavNode = LeafNode | GroupNode;

const ROLE_LEAVES = (top: 'add' | 'active' | 'archived'): LeafNode[] => [
  { kind: 'leaf', path: '/admin/employees', params: { top, sub: 'teacher' }, icon: GraduationCap, labelKey: 'nav.role_teachers', labelFallback: 'Teachers', ...(top === 'active' ? { isDefault: true } : {}) },
  { kind: 'leaf', path: '/admin/employees', params: { top, sub: 'supervisor' }, icon: ShieldCheck, labelKey: 'nav.role_supervisors', labelFallback: 'Supervisors' },
  { kind: 'leaf', path: '/admin/employees', params: { top, sub: 'admin' }, icon: UserCog, labelKey: 'nav.role_administration', labelFallback: 'Administration' },
  { kind: 'leaf', path: '/admin/employees', params: { top, sub: 'reception' }, icon: Bell, labelKey: 'nav.role_reception', labelFallback: 'Reception' },
  { kind: 'leaf', path: '/admin/employees', params: { top, sub: 'accountant' }, icon: Wallet, labelKey: 'nav.role_accountant', labelFallback: 'Accountant', feature: 'tuition_fees' },
  { kind: 'leaf', path: '/admin/employees', params: { top, sub: 'staff' }, icon: Users, labelKey: 'nav.role_staff', labelFallback: 'Staff', feature: 'tuition_fees' },
];

const adminNav: AdminNavNode[] = [
  { kind: 'leaf', path: '/admin/dashboard', icon: Home, labelKey: 'nav.dashboard', labelFallback: 'Dashboard' },
  {
    kind: 'group', key: 'students', icon: GraduationCap,
    labelKey: 'nav.students', labelFallback: 'Students',
    children: [
      { kind: 'leaf', path: '/admin/students', params: { tab: 'active' }, isDefault: true, icon: Users, labelKey: 'nav.students_active', labelFallback: 'Active Students' },
      { kind: 'leaf', path: '/admin/students', params: { tab: 'new' }, icon: UserPlus, labelKey: 'nav.students_new', labelFallback: 'New Students' },
      {
        kind: 'group', key: 'students.archived', icon: Archive,
        labelKey: 'nav.archived', labelFallback: 'Archived',
        feature: 'archive',
        children: [
          { kind: 'leaf', path: '/admin/students', params: { tab: 'archived', sub: 'archived' }, isDefault: true, icon: Archive, labelKey: 'nav.archived', labelFallback: 'Archived' },
          { kind: 'leaf', path: '/admin/students', params: { tab: 'archived', sub: 'graduated' }, icon: GraduationCap, labelKey: 'nav.graduated', labelFallback: 'Graduated' },
        ],
      },
    ],
  },
  {
    kind: 'group', key: 'classes', icon: BookOpen,
    labelKey: 'nav.classes', labelFallback: 'Classes',
    children: [
      { kind: 'leaf', path: '/admin/classes', params: { tab: 'classes' }, isDefault: true, icon: BookOpen, labelKey: 'nav.classes', labelFallback: 'Classes' },
      { kind: 'leaf', path: '/admin/classes', params: { tab: 'subjects' }, icon: BookOpenCheck, labelKey: 'nav.subjects', labelFallback: 'Subjects' },
    ],
  },
  { kind: 'leaf', path: '/admin/schedule', icon: Calendar, labelKey: 'nav.schedule', labelFallback: 'Schedule' },
  { kind: 'leaf', path: '/admin/grade-review', icon: Star, labelKey: 'nav.grade_review', labelFallback: 'Grade Review', feature: 'grades' },
  { kind: 'leaf', path: '/admin/announcements', icon: Megaphone, labelKey: 'nav.announcements', labelFallback: 'Announcements', feature: 'announcements' },
  {
    kind: 'group', key: 'employees', icon: Users,
    labelKey: 'nav.employees', labelFallback: 'Employees',
    children: [
      { kind: 'group', key: 'employees.add', icon: UserPlus, labelKey: 'nav.employees_add', labelFallback: 'Add New Employee', children: ROLE_LEAVES('add') },
      { kind: 'group', key: 'employees.active', icon: Users, labelKey: 'nav.employees_active', labelFallback: 'Active Employees', children: ROLE_LEAVES('active') },
      { kind: 'group', key: 'employees.archived', icon: Archive, labelKey: 'nav.employees_archived', labelFallback: 'Archived', children: ROLE_LEAVES('archived') },
    ],
  },
  { kind: 'leaf', path: '/admin/drivers', icon: Bus, labelKey: 'nav.drivers', labelFallback: 'Drivers', feature: 'bus_tracking' },
  {
    kind: 'group', key: 'hr', icon: ClipboardCheck,
    labelKey: 'nav.hr', labelFallback: 'HR',
    children: [
      { kind: 'leaf', path: '/admin/school-policies', icon: ClipboardCheck, labelKey: 'nav.policies', labelFallback: 'Policies' },
      { kind: 'leaf', path: '/admin/hr-officers', icon: ShieldCheck, labelKey: 'nav.hr_officers', labelFallback: 'HR Officers' },
    ],
  },
  { kind: 'leaf', path: '/admin/accounts', icon: UserCog, labelKey: 'nav.accounts', labelFallback: 'Accounts' },
  { kind: 'leaf', path: '/admin/audit-log', icon: History, labelKey: 'nav.audit_log', labelFallback: 'Audit Log' },
  { kind: 'leaf', path: '/admin/notifications', icon: Bell, labelKey: 'nav.notifications', labelFallback: 'Notifications' },
  { kind: 'leaf', path: '/admin/settings', icon: Settings, labelKey: 'nav.settings', labelFallback: 'Settings' },
  { kind: 'leaf', path: '/admin/profile', icon: User, labelKey: 'nav.profile', labelFallback: 'Profile' },
];

function filterAdminTree(node: AdminNavNode, isEnabled: (f?: string) => boolean): AdminNavNode | null {
  if (node.kind === 'leaf') return isEnabled(node.feature) ? node : null;
  if (!isEnabled(node.feature)) return null;
  const kids = node.children
    .map(c => filterAdminTree(c, isEnabled))
    .filter((n): n is AdminNavNode => !!n);
  return kids.length ? { ...node, children: kids } : null;
}

function leafHref(leaf: LeafNode): string {
  const q = leaf.params ? new URLSearchParams(leaf.params).toString() : '';
  return q ? `${leaf.path}?${q}` : leaf.path;
}

function firstLeafOf(node: AdminNavNode): LeafNode | null {
  if (node.kind === 'leaf') return node;
  for (const c of node.children) {
    const f = firstLeafOf(c);
    if (f) return f;
  }
  return null;
}

function collectSamePathLeaves(nodes: AdminNavNode[], path: string): LeafNode[] {
  const out: LeafNode[] = [];
  const walk = (ns: AdminNavNode[]) => {
    for (const n of ns) {
      if (n.kind === 'leaf') { if (n.path === path) out.push(n); }
      else walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

// A leaf "agrees" with the URL if, for every param the leaf names, the URL
// either has that exact value or is missing the key entirely. A param the URL
// sets to a different value is a disagreement and disqualifies the leaf.
function leafAgrees(leaf: LeafNode, search: URLSearchParams): boolean {
  if (!leaf.params) return true;
  for (const [k, v] of Object.entries(leaf.params)) {
    const urlV = search.get(k);
    if (urlV !== null && urlV !== v) return false;
  }
  return true;
}

function matchedParamCount(leaf: LeafNode, search: URLSearchParams): number {
  if (!leaf.params) return 0;
  let n = 0;
  for (const [k, v] of Object.entries(leaf.params)) {
    if (search.get(k) === v) n += 1;
  }
  return n;
}

function isLeafActive(leaf: LeafNode, pathname: string, search: URLSearchParams, siblings: LeafNode[]): boolean {
  if (pathname !== leaf.path) return false;
  if (!leafAgrees(leaf, search)) return false;

  const total = Object.keys(leaf.params ?? {}).length;
  if (total === 0) return true;
  const matched = matchedParamCount(leaf, search);
  if (matched === total) return true;

  // Partial match — only an isDefault leaf can claim the URL, and among
  // multiple isDefault candidates we want the most specific that still agrees.
  // Tiebreak: prefer the leaf with fewer total params (it is the "more general"
  // default for this URL). So bare /admin/students prefers Active Students
  // (1 param) over Students > Archived > Archived (2 params).
  if (!leaf.isDefault) return false;
  const defaults = siblings.filter(l => l.isDefault && leafAgrees(l, search));
  if (defaults.length === 0) return false;
  let best = defaults[0];
  for (const c of defaults) {
    const cm = matchedParamCount(c, search);
    const cp = Object.keys(c.params ?? {}).length;
    const bm = matchedParamCount(best, search);
    const bp = Object.keys(best.params ?? {}).length;
    if (cm > bm || (cm === bm && cp < bp)) best = c;
  }
  return best === leaf;
}

function activeGroupChain(nodes: AdminNavNode[], pathname: string, search: URLSearchParams, root: AdminNavNode[]): string[] {
  let result: string[] = [];
  const walk = (ns: AdminNavNode[], path: string[]): boolean => {
    for (const n of ns) {
      if (n.kind === 'leaf') {
        if (isLeafActive(n, pathname, search, collectSamePathLeaves(root, n.path))) {
          result = path;
          return true;
        }
      } else {
        if (walk(n.children, [...path, n.key])) return true;
      }
    }
    return false;
  };
  walk(nodes, []);
  return result;
}

const INDENT_LTR = ['', 'ml-3', 'ml-6', 'ml-9'];
const INDENT_RTL = ['', 'mr-3', 'mr-6', 'mr-9'];

const navItems: Partial<Record<Role, NavItem[]>> = {
  parent: [
    { to: '/parent/dashboard', icon: Home, label: 'Dashboard' },
    { to: '/parent/homework', icon: BookOpen, label: 'Homework', feature: 'homework' },
    { to: '/parent/assignments', icon: ClipboardList, label: 'Assignments', feature: 'assignments' },
    { to: '/parent/announcements', icon: Megaphone, label: 'Announcements', feature: 'announcements' },
    { to: '/parent/grades', icon: Star, label: 'Grades', feature: 'grades' },
    { to: '/parent/reports', icon: BarChart2, label: 'Reports', feature: 'reports' },
    { to: '/parent/attendance', icon: ClipboardCheck, label: 'Attendance', feature: 'archive' },
    { to: '/parent/archive', icon: Archive, label: 'Past Records', feature: 'archive' },
    { to: '/parent/bus', icon: MapPin, label: 'Track Bus', feature: 'bus_tracking' },
    { to: '/parent/appointments', icon: Calendar, label: 'Appointments', feature: 'appointments' },
    { to: '/parent/tuition', icon: CreditCard, label: 'Tuition', feature: 'tuition_fees' },
    { to: '/parent/schedule', icon: Clock, label: 'Schedule' },
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
    { to: '/teacher/schedule', icon: Calendar, label: 'Schedule' },
    { to: '/chat', icon: MessageSquare, label: 'Chat', feature: 'chat' },
    { to: '/teacher/notifications', icon: Bell, label: 'Notifications' },
    { to: '/teacher/profile', icon: User, label: 'Profile' },
  ],
  // Admin nav is the nested `adminNav` tree above. Transfers UI is shelved (see FEATURE.md).
  reception: [
    { to: '/reception/dashboard', icon: Home, label: 'Dashboard' },
    { to: '/reception/appointments', icon: Calendar, label: 'Appointments', feature: 'appointments' },
    { to: '/accounting', icon: CreditCard, label: 'Tuition', feature: 'tuition_fees', end: true },
    { to: '/reception/profile', icon: User, label: 'Profile' },
  ],
  accountant: [
    { to: '/accounting/dashboard', icon: Home, label: 'Dashboard', feature: 'tuition_fees' },
    { to: '/accounting', icon: CreditCard, label: 'Tuition', feature: 'tuition_fees', end: true },
    { to: '/accounting/staff', icon: Wallet, label: 'Staff Salaries', feature: 'tuition_fees' },
    { to: '/accounting/expenses', icon: Receipt, label: 'Expenses', feature: 'tuition_fees' },
    { to: '/accounting/ledger', icon: BookOpenCheck, label: 'Ledger', feature: 'tuition_fees' },
    { to: '/accounting/general-ledger', icon: Scale, label: 'General Ledger', feature: 'tuition_fees' },
    { to: '/accounting/reports/ar-aging', icon: AlertCircle, label: 'AR aging', feature: 'tuition_fees' },
    { to: '/accounting/reports/profit-loss', icon: FileBarChart, label: 'P & L', feature: 'tuition_fees' },
    { to: '/accounting/reports/cash-flow', icon: BarChart3, label: 'Cash flow', feature: 'tuition_fees' },
    { to: '/accounting/reports/tax', icon: Receipt, label: 'Tax report', feature: 'tuition_fees' },
    { to: '/accounting/periods', icon: CalendarClock, label: 'Periods', feature: 'tuition_fees' },
    { to: '/accounting/payment-accounts', icon: Wallet, label: 'Payment accts', feature: 'tuition_fees' },
    { to: '/accounting/fx-rates', icon: ArrowLeftRight, label: 'FX rates', feature: 'tuition_fees' },
    { to: '/accounting/profile', icon: User, label: 'Profile' },
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
    { to: '/supervisor/notifications', icon: Bell, label: 'Notifications' },
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
    adminResetRequestCount, setAdminResetRequestCount, incrementAdminResetRequestCount,
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
      adminApi.getResetRequests().then(r => setAdminResetRequestCount(r.data?.length ?? 0)).catch(() => {});
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
    };

    const onResetRequest = () => {
      if (user.role === 'admin' && window.location.pathname !== '/admin/accounts') {
        incrementAdminResetRequestCount();
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
    socket.on('password_reset_request', onResetRequest);
    socket.on('chat:message', onChatMessage);

    return () => {
      socket.off('new_appointment', onAppointment);
      socket.off('notification', onNotification);
      socket.off('password_reset_request', onResetRequest);
      socket.off('chat:message', onChatMessage);
    };
  }, [socket, user]);

  // Auto-clear badges on navigation
  useEffect(() => {
    if (location.pathname === '/teacher/notifications' && teacherUnreadCount > 0) setTeacherUnreadCount(0);
    if (location.pathname === '/admin/accounts' && adminResetRequestCount > 0) setAdminResetRequestCount(0);
    if ((location.pathname === '/admin/appointments' || location.pathname === '/reception/appointments') && pendingAppointmentCount > 0) setPendingAppointmentCount(0);
    if (location.pathname === '/chat' && chatUnreadCount > 0) setChatUnreadCount(0);
  }, [location.pathname]);

  const isRTL = ['ar', 'ku'].includes(i18n.language);
  const showLangSwitcher = user?.role === 'parent' || user?.role === 'driver' || user?.role === 'accountant' || user?.role === 'admin' || user?.role === 'teacher' || user?.role === 'supervisor';
  // Premium-only features default to OFF when the key is missing — so a school
  // without a premium plan never sees the tab even if their features JSONB
  // pre-dates the feature flag being added.
  const PREMIUM_FEATURES = ['tuition_fees', 'archive'];
  const isFeatureEnabled = (feature?: string) => {
    if (!feature) return true;
    if (PREMIUM_FEATURES.includes(feature)) return school?.features?.[feature] === true;
    return school?.features?.[feature] !== false;
  };
  const isAdmin = user?.role === 'admin';
  const items = user && !isAdmin ? (navItems[user.role] ?? []).filter(item => isFeatureEnabled(item.feature)) : [];

  // Admin: filter the tree by features, then compute which group keys are on the active leaf's path.
  const adminItems: AdminNavNode[] = isAdmin
    ? adminNav
        .map(n => filterAdminTree(n, isFeatureEnabled))
        .filter((n): n is AdminNavNode => !!n)
    : [];
  const adminSearchParams = new URLSearchParams(location.search);
  const activeGroupKeys = new Set(
    isAdmin ? activeGroupChain(adminItems, location.pathname, adminSearchParams, adminItems) : [],
  );
  const chevronCollapsedRotate = isRTL ? 'rotate-90' : '-rotate-90';

  const renderAdminNode = (node: AdminNavNode, depth: number): React.ReactNode => {
    const indentClass = (isRTL ? INDENT_RTL : INDENT_LTR)[Math.min(depth, 3)];

    if (node.kind === 'leaf') {
      const Icon = node.icon;
      const href = leafHref(node);
      const samePath = collectSamePathLeaves(adminItems, node.path);
      const active = isLeafActive(node, location.pathname, adminSearchParams, samePath);
      const showResetBadge = node.path === '/admin/accounts' && adminResetRequestCount > 0;
      const label = t(node.labelKey, node.labelFallback);
      return (
        <NavLink
          key={`leaf:${href}`}
          to={href}
          end={node.end}
          onClick={() => {
            setMobileOpen(false);
            if (showResetBadge) setAdminResetRequestCount(0);
          }}
          className={`
            flex items-center gap-3 px-3 py-2 mx-2 rounded-xl transition-colors duration-150 ${indentClass}
            ${active ? 'bg-primary-50 text-primary-700 font-semibold' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}
          `}
          title={collapsed ? label : undefined}
        >
          <div className="relative flex-shrink-0">
            <Icon className="w-5 h-5" />
            {showResetBadge && collapsed && (
              <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full" />
            )}
          </div>
          {!collapsed && <span className="text-sm flex-1 truncate">{label}</span>}
          {!collapsed && showResetBadge && (
            <span className="bg-red-500 text-white text-xs font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
              {adminResetRequestCount > 99 ? '99+' : adminResetRequestCount}
            </span>
          )}
        </NavLink>
      );
    }

    // group
    const GroupIcon = node.icon;
    const expanded = activeGroupKeys.has(node.key);
    const first = firstLeafOf(node);
    const label = t(node.labelKey, node.labelFallback);
    return (
      <div key={`group:${node.key}`}>
        {first && (
          <Link
            to={leafHref(first)}
            onClick={() => setMobileOpen(false)}
            className={`
              flex items-center gap-3 px-3 py-2 mx-2 rounded-xl transition-colors duration-150 ${indentClass}
              ${expanded ? 'text-gray-900 font-semibold' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}
            `}
            title={collapsed ? label : undefined}
          >
            <GroupIcon className="w-5 h-5 flex-shrink-0" />
            {!collapsed && <span className="text-sm flex-1 truncate">{label}</span>}
            {!collapsed && (
              <ChevronDown
                className={`w-4 h-4 transition-transform ${expanded ? 'rotate-0' : chevronCollapsedRotate}`}
              />
            )}
          </Link>
        )}
        {expanded && !collapsed && (
          <div className="mt-0.5 space-y-0.5">
            {node.children.map(c => renderAdminNode(c, depth + 1))}
          </div>
        )}
      </div>
    );
  };

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
        {isAdmin && adminItems.map(node => renderAdminNode(node, 0))}
        {!isAdmin && items.map(({ to, icon: Icon, label, end }) => {
          const showNotifBadge = to === '/parent/notifications' && user?.role === 'parent' && unreadCount > 0;
          const showTeacherNotifBadge = to === '/teacher/notifications' && user?.role === 'teacher' && teacherUnreadCount > 0;
          const showApptBadge = (
            (to === '/admin/appointments' && user?.role === 'admin') ||
            (to === '/reception/appointments' && user?.role === 'reception')
          ) && pendingAppointmentCount > 0;
          const showAdminResetBadge = to === '/admin/accounts' && user?.role === 'admin' && adminResetRequestCount > 0;
          const showChatBadge = to === '/chat' && chatUnreadCount > 0;
          const showBadge = showNotifBadge || showTeacherNotifBadge || showApptBadge || showAdminResetBadge || showChatBadge;
          const badgeCount = showNotifBadge ? unreadCount
            : showTeacherNotifBadge ? teacherUnreadCount
            : showApptBadge ? pendingAppointmentCount
            : showChatBadge ? chatUnreadCount
            : adminResetRequestCount;
          return (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={() => {
                setMobileOpen(false);
                if (showApptBadge) setPendingAppointmentCount(0);
                if (showTeacherNotifBadge) setTeacherUnreadCount(0);
                if (showAdminResetBadge) setAdminResetRequestCount(0);
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
