import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { useEffect } from 'react';
import { useAuthStore } from './store/authStore';
import { useSocketStore } from './store/socketStore';
import ChatPage from './pages/chat/ChatPage';

// Auth
import LoginPage from './pages/auth/LoginPage';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';

// Parent
import ParentDashboard from './pages/parent/ParentDashboard';
import HomeworkPage from './pages/parent/HomeworkPage';
import HomeworkDetailPage from './pages/parent/HomeworkDetailPage';
import AssignmentsPage from './pages/parent/AssignmentsPage';
import AssignmentDetailPage from './pages/parent/AssignmentDetailPage';
import ParentAnnouncementsPage from './pages/parent/AnnouncementsPage';
import AnnouncementDetailPage from './pages/parent/AnnouncementDetailPage';
import ReportsPage from './pages/parent/ReportsPage';
import ReportDetailPage from './pages/parent/ReportDetailPage';
import BusTrackingPage from './pages/parent/BusTrackingPage';
import NotificationsPage from './pages/parent/NotificationsPage';
import ProfilePage from './pages/parent/ProfilePage';

// Teacher
import TeacherDashboard from './pages/teacher/TeacherDashboard';
import TeacherSchedulePage from './pages/teacher/TeacherSchedulePage';
import ParentSchedulePage from './pages/parent/SchedulePage';
import WriteHomeworkPage from './pages/teacher/WriteHomeworkPage';
import GradingPage from './pages/teacher/GradingPage';
import WeeklySummaryPage from './pages/teacher/WeeklySummaryPage';
import StudentsPage from './pages/teacher/StudentsPage';
import WriteReportPage from './pages/teacher/WriteReportPage';
import TeacherNotificationsPage from './pages/teacher/TeacherNotificationsPage';

// Admin
import AdminDashboard from './pages/admin/AdminDashboard';
import StudentsManagement from './pages/admin/StudentsManagement';
import ArchiveManagement from './pages/admin/ArchiveManagement';
import TeachersManagement from './pages/admin/TeachersManagement';
import AdminSchedulePage from './pages/admin/SchedulePage';
import DriversManagement from './pages/admin/DriversManagement';
import AppointmentsPage from './pages/admin/AppointmentsPage';
import AccountsPage from './pages/admin/AccountsPage';
import AuditLogPage from './pages/admin/AuditLogPage';
import ClassesPage from './pages/admin/ClassesPage';
import AdminNotificationsPage from './pages/admin/AdminNotificationsPage';
import StudentBriefPage from './pages/admin/StudentBriefPage';
import ParentProfilePage from './pages/admin/ParentProfilePage';
import AnnouncementsPage from './pages/admin/AnnouncementsPage';
import AdminStudentsListPage from './pages/admin/AdminStudentsListPage';
import AdminTeachersListPage from './pages/admin/AdminTeachersListPage';
import AdminDriversListPage from './pages/admin/AdminDriversListPage';
import AdminWeeklySummaryPage from './pages/admin/AdminWeeklySummaryPage';
import SettingsPage from './pages/admin/SettingsPage';
import AdminTuitionPage from './pages/admin/AdminTuitionPage';
import AdminTuitionStudentDetailPage from './pages/admin/AdminTuitionStudentDetailPage';
import ExpensesPage from './pages/admin/ExpensesPage';
import LedgerPage from './pages/admin/LedgerPage';
import ParentAppointmentsPage from './pages/parent/AppointmentsPage';
import ParentTuitionPage from './pages/parent/TuitionPage';
import WriteAssignmentsPage from './pages/teacher/WriteAssignmentsPage';

// Reception
import ReceptionDashboard from './pages/reception/ReceptionDashboard';
import ReceptionAppointmentsPage from './pages/reception/AppointmentsPage';

// Driver
import DriverDashboard from './pages/driver/DriverDashboard';
import StartDrivePage from './pages/driver/StartDrivePage';
import DriverStudentsPage from './pages/driver/DriverStudentsPage';

// Supervisor
import SupervisorDashboard from './pages/supervisor/SupervisorDashboard';
import AbsentTodayPage from './pages/supervisor/AbsentTodayPage';
import AttendanceOverviewPage from './pages/supervisor/AttendanceOverviewPage';
import SupervisorHomeworkPage from './pages/supervisor/SupervisorHomeworkPage';
import SupervisorAssignmentsPage from './pages/supervisor/SupervisorAssignmentsPage';
import SupervisorWeeklySummaryPage from './pages/supervisor/SupervisorWeeklySummaryPage';
import SupervisorStudentReportsPage from './pages/supervisor/SupervisorStudentReportsPage';
import SupervisorNotificationsPage from './pages/supervisor/SupervisorNotificationsPage';

// Parent Grades
import GradesPage from './pages/parent/GradesPage';

// Teacher Attendance
import AttendancePage from './pages/teacher/AttendancePage';

function SocketProvider({ children }: { children: React.ReactNode }) {
  const { token, isAuthenticated } = useAuthStore();
  const { connect, disconnect } = useSocketStore();

  useEffect(() => {
    if (isAuthenticated() && token) {
      connect(token);
    } else {
      disconnect();
    }
    return () => { disconnect(); };
  }, [token]);

  return <>{children}</>;
}

const ROLE_REDIRECTS: Record<string, string> = {
  parent: '/parent/dashboard',
  teacher: '/teacher/dashboard',
  admin: '/admin/dashboard',
  driver: '/driver/dashboard',
  supervisor: '/supervisor/dashboard',
  reception: '/reception/dashboard',
  accountant: '/accounting',
};

function ProtectedRoute({ children, allowedRoles }: { children: React.ReactNode; allowedRoles?: string[] }) {
  const { isAuthenticated, user } = useAuthStore();
  if (!isAuthenticated()) return <Navigate to="/login" replace />;
  if (allowedRoles && user && !allowedRoles.includes(user.role)) {
    return <Navigate to={ROLE_REDIRECTS[user.role] || '/login'} replace />;
  }
  return <>{children}</>;
}

function RootRedirect() {
  const { isAuthenticated, user } = useAuthStore();
  if (isAuthenticated()) return <Navigate to={ROLE_REDIRECTS[user?.role || ''] || '/login'} replace />;
  return <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastContainer position="top-right" autoClose={4000} />
      <SocketProvider>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/select-school" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />

        {/* Parent Portal */}
        <Route path="/parent/dashboard" element={<ProtectedRoute allowedRoles={['parent']}><ParentDashboard /></ProtectedRoute>} />
        <Route path="/parent/homework" element={<ProtectedRoute allowedRoles={['parent']}><HomeworkPage /></ProtectedRoute>} />
        <Route path="/parent/homework/:id" element={<ProtectedRoute allowedRoles={['parent']}><HomeworkDetailPage /></ProtectedRoute>} />
        <Route path="/parent/assignments" element={<ProtectedRoute allowedRoles={['parent']}><AssignmentsPage /></ProtectedRoute>} />
        <Route path="/parent/assignments/:id" element={<ProtectedRoute allowedRoles={['parent']}><AssignmentDetailPage /></ProtectedRoute>} />
        <Route path="/parent/announcements" element={<ProtectedRoute allowedRoles={['parent']}><ParentAnnouncementsPage /></ProtectedRoute>} />
        <Route path="/parent/announcements/:id" element={<ProtectedRoute allowedRoles={['parent']}><AnnouncementDetailPage /></ProtectedRoute>} />
        <Route path="/parent/reports" element={<ProtectedRoute allowedRoles={['parent']}><ReportsPage /></ProtectedRoute>} />
        <Route path="/parent/reports/:id" element={<ProtectedRoute allowedRoles={['parent']}><ReportDetailPage /></ProtectedRoute>} />
        <Route path="/parent/bus" element={<ProtectedRoute allowedRoles={['parent']}><BusTrackingPage /></ProtectedRoute>} />
        <Route path="/parent/notifications" element={<ProtectedRoute allowedRoles={['parent']}><NotificationsPage /></ProtectedRoute>} />
        <Route path="/parent/appointments" element={<ProtectedRoute allowedRoles={['parent']}><ParentAppointmentsPage /></ProtectedRoute>} />
        <Route path="/parent/tuition" element={<ProtectedRoute allowedRoles={['parent']}><ParentTuitionPage /></ProtectedRoute>} />
        <Route path="/parent/grades" element={<ProtectedRoute allowedRoles={['parent']}><GradesPage /></ProtectedRoute>} />
        <Route path="/parent/schedule" element={<ProtectedRoute allowedRoles={['parent']}><ParentSchedulePage /></ProtectedRoute>} />
        <Route path="/parent/profile" element={<ProtectedRoute allowedRoles={['parent']}><ProfilePage /></ProtectedRoute>} />

        {/* Teacher Portal */}
        <Route path="/teacher/dashboard" element={<ProtectedRoute allowedRoles={['teacher']}><TeacherDashboard /></ProtectedRoute>} />
        <Route path="/teacher/attendance" element={<ProtectedRoute allowedRoles={['teacher']}><AttendancePage /></ProtectedRoute>} />
        <Route path="/teacher/homework" element={<ProtectedRoute allowedRoles={['teacher']}><WriteHomeworkPage /></ProtectedRoute>} />
        <Route path="/teacher/assignments" element={<ProtectedRoute allowedRoles={['teacher']}><WriteAssignmentsPage /></ProtectedRoute>} />
        <Route path="/teacher/reports" element={<ProtectedRoute allowedRoles={['teacher']}><WriteReportPage /></ProtectedRoute>} />
        <Route path="/teacher/grades" element={<ProtectedRoute allowedRoles={['teacher']}><GradingPage /></ProtectedRoute>} />
        <Route path="/teacher/weekly-summary" element={<ProtectedRoute allowedRoles={['teacher']}><WeeklySummaryPage /></ProtectedRoute>} />
        <Route path="/teacher/students" element={<ProtectedRoute allowedRoles={['teacher']}><StudentsPage /></ProtectedRoute>} />
        <Route path="/teacher/schedule" element={<ProtectedRoute allowedRoles={['teacher']}><TeacherSchedulePage /></ProtectedRoute>} />
        <Route path="/teacher/notifications" element={<ProtectedRoute allowedRoles={['teacher']}><TeacherNotificationsPage /></ProtectedRoute>} />
        <Route path="/teacher/profile" element={<ProtectedRoute allowedRoles={['teacher']}><ProfilePage /></ProtectedRoute>} />

        {/* Admin Portal */}
        <Route path="/admin/dashboard" element={<ProtectedRoute allowedRoles={['admin']}><AdminDashboard /></ProtectedRoute>} />
        <Route path="/admin/list/students" element={<ProtectedRoute allowedRoles={['admin']}><AdminStudentsListPage /></ProtectedRoute>} />
        <Route path="/admin/list/teachers" element={<ProtectedRoute allowedRoles={['admin']}><AdminTeachersListPage /></ProtectedRoute>} />
        <Route path="/admin/list/drivers" element={<ProtectedRoute allowedRoles={['admin']}><AdminDriversListPage /></ProtectedRoute>} />
        <Route path="/admin/students" element={<ProtectedRoute allowedRoles={['admin']}><StudentsManagement /></ProtectedRoute>} />
        <Route path="/admin/archive" element={<ProtectedRoute allowedRoles={['admin']}><ArchiveManagement /></ProtectedRoute>} />
        <Route path="/admin/classes" element={<ProtectedRoute allowedRoles={['admin']}><ClassesPage /></ProtectedRoute>} />
        <Route path="/admin/teachers" element={<ProtectedRoute allowedRoles={['admin']}><TeachersManagement /></ProtectedRoute>} />
        <Route path="/admin/schedule" element={<ProtectedRoute allowedRoles={['admin']}><AdminSchedulePage /></ProtectedRoute>} />
        <Route path="/admin/drivers" element={<ProtectedRoute allowedRoles={['admin']}><DriversManagement /></ProtectedRoute>} />
        <Route path="/admin/student-brief" element={<ProtectedRoute allowedRoles={['admin']}><StudentBriefPage /></ProtectedRoute>} />
        <Route path="/admin/weekly-summary" element={<ProtectedRoute allowedRoles={['admin']}><AdminWeeklySummaryPage /></ProtectedRoute>} />
        <Route path="/admin/appointments" element={<ProtectedRoute allowedRoles={['admin']}><AppointmentsPage /></ProtectedRoute>} />
        <Route path="/admin/notifications" element={<ProtectedRoute allowedRoles={['admin']}><AdminNotificationsPage /></ProtectedRoute>} />
        <Route path="/admin/announcements" element={<ProtectedRoute allowedRoles={['admin']}><AnnouncementsPage /></ProtectedRoute>} />
        <Route path="/admin/accounts" element={<ProtectedRoute allowedRoles={['admin']}><AccountsPage /></ProtectedRoute>} />
        <Route path="/admin/audit-log" element={<ProtectedRoute allowedRoles={['admin']}><AuditLogPage /></ProtectedRoute>} />
        <Route path="/admin/settings" element={<ProtectedRoute allowedRoles={['admin']}><SettingsPage /></ProtectedRoute>} />
        <Route path="/admin/parents/:id" element={<ProtectedRoute allowedRoles={['admin']}><ParentProfilePage /></ProtectedRoute>} />
        <Route path="/admin/profile" element={<ProtectedRoute allowedRoles={['admin']}><ProfilePage /></ProtectedRoute>} />

        {/* Supervisor Portal */}
        <Route path="/supervisor/dashboard" element={<ProtectedRoute allowedRoles={['supervisor']}><SupervisorDashboard /></ProtectedRoute>} />
        <Route path="/supervisor/absent-today" element={<ProtectedRoute allowedRoles={['supervisor']}><AbsentTodayPage /></ProtectedRoute>} />
        <Route path="/supervisor/attendance" element={<ProtectedRoute allowedRoles={['supervisor']}><AttendanceOverviewPage /></ProtectedRoute>} />
        <Route path="/supervisor/homework" element={<ProtectedRoute allowedRoles={['supervisor']}><SupervisorHomeworkPage /></ProtectedRoute>} />
        <Route path="/supervisor/assignments" element={<ProtectedRoute allowedRoles={['supervisor']}><SupervisorAssignmentsPage /></ProtectedRoute>} />
        <Route path="/supervisor/weekly-summary" element={<ProtectedRoute allowedRoles={['supervisor']}><SupervisorWeeklySummaryPage /></ProtectedRoute>} />
        <Route path="/supervisor/student-reports" element={<ProtectedRoute allowedRoles={['supervisor']}><SupervisorStudentReportsPage /></ProtectedRoute>} />
        <Route path="/supervisor/notifications" element={<ProtectedRoute allowedRoles={['supervisor']}><SupervisorNotificationsPage /></ProtectedRoute>} />
        <Route path="/supervisor/profile" element={<ProtectedRoute allowedRoles={['supervisor']}><ProfilePage /></ProtectedRoute>} />

        {/* Reception Portal */}
        <Route path="/reception/dashboard" element={<ProtectedRoute allowedRoles={['reception']}><ReceptionDashboard /></ProtectedRoute>} />
        <Route path="/reception/appointments" element={<ProtectedRoute allowedRoles={['reception']}><ReceptionAppointmentsPage /></ProtectedRoute>} />
        <Route path="/reception/profile" element={<ProtectedRoute allowedRoles={['reception']}><ProfilePage /></ProtectedRoute>} />

        {/* Accounting Portal — premium tuition module. Shared by admin, accountant, reception (read-only via backend). */}
        <Route path="/accounting" element={<ProtectedRoute allowedRoles={['admin', 'accountant', 'reception']}><AdminTuitionPage /></ProtectedRoute>} />
        <Route path="/accounting/staff" element={<ProtectedRoute allowedRoles={['admin', 'accountant']}><AdminTuitionPage /></ProtectedRoute>} />
        <Route path="/accounting/expenses" element={<ProtectedRoute allowedRoles={['admin', 'accountant']}><ExpensesPage /></ProtectedRoute>} />
        <Route path="/accounting/ledger" element={<ProtectedRoute allowedRoles={['admin', 'accountant']}><LedgerPage /></ProtectedRoute>} />
        <Route path="/accounting/student/:id" element={<ProtectedRoute allowedRoles={['admin', 'accountant', 'reception']}><AdminTuitionStudentDetailPage /></ProtectedRoute>} />
        <Route path="/accounting/profile" element={<ProtectedRoute allowedRoles={['accountant']}><ProfilePage /></ProtectedRoute>} />

        {/* Driver Portal */}
        <Route path="/driver/dashboard" element={<ProtectedRoute allowedRoles={['driver']}><DriverDashboard /></ProtectedRoute>} />
        <Route path="/driver/drive" element={<ProtectedRoute allowedRoles={['driver']}><StartDrivePage /></ProtectedRoute>} />
        <Route path="/driver/students" element={<ProtectedRoute allowedRoles={['driver']}><DriverStudentsPage /></ProtectedRoute>} />
        <Route path="/driver/profile" element={<ProtectedRoute allowedRoles={['driver']}><ProfilePage /></ProtectedRoute>} />

        {/* Chat */}
        <Route path="/chat" element={<ProtectedRoute allowedRoles={['parent', 'teacher', 'supervisor']}><ChatPage /></ProtectedRoute>} />

        <Route path="*" element={<RootRedirect />} />
      </Routes>
      </SocketProvider>
    </BrowserRouter>
  );
}
