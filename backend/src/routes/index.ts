import { Router, Request, Response } from 'express';
import multer from 'multer';
import { login, changePassword, getSchools, forgotPassword, registerDeviceToken, removeDeviceToken, updateDeviceLanguage } from '../controllers/auth.controller';
import * as admin from '../controllers/admin.controller';
import * as teacher from '../controllers/teacher.controller';
import * as parent from '../controllers/parent.controller';
import * as driver from '../controllers/driver.controller';
import * as supervisor from '../controllers/supervisor.controller';
import * as academic from '../controllers/academic.controller';
import * as chat from '../controllers/chat.controller';
import { authenticate, authorize } from '../middleware/auth';
import type { AuthRequest } from '../middleware/auth';
import { Server as SocketServer } from 'socket.io';

// Multer — memory storage so files never touch the filesystem
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

export function createRouter(io: SocketServer) {
  const router = Router();

  // ---- PUBLIC ----
  router.get('/schools', getSchools);
  router.post('/auth/forgot-password', (req, res) => forgotPassword(req, res));

  // ---- AUTH ----
  router.post('/auth/login', login);
  router.post('/auth/change-password', authenticate, (req, res) => changePassword(req, res));
  router.post('/auth/device-token', authenticate, (req, res) => registerDeviceToken(req as AuthRequest, res));
  router.delete('/auth/device-token', authenticate, (req, res) => removeDeviceToken(req as AuthRequest, res));
  router.put('/auth/device-language', authenticate, (req, res) => updateDeviceLanguage(req as AuthRequest, res));

  // ---- ADMIN ----
  router.get('/admin/students', authenticate, authorize('admin'), (req, res) => admin.getStudents(req as AuthRequest, res));
  router.post('/admin/students', authenticate, authorize('admin'), (req, res) => admin.createStudent(req as AuthRequest, res));
  router.post('/admin/students/assign', authenticate, authorize('admin'), (req, res) => admin.assignStudent(req as AuthRequest, res));
  router.post('/admin/students/bulk-upload', authenticate, authorize('admin'), upload.single('file'), (req, res) => admin.bulkUploadStudents(req as AuthRequest, res));
  router.put('/admin/students/:id', authenticate, authorize('admin'), (req, res) => admin.updateStudent(req as AuthRequest, res));
  router.delete('/admin/students/:id', authenticate, authorize('admin'), (req, res) => admin.deleteStudent(req as AuthRequest, res));
  router.get('/admin/students/graduated', authenticate, authorize('admin'), (req, res) => admin.getGraduatedStudents(req as AuthRequest, res));
  router.get('/admin/students/:id/brief', authenticate, authorize('admin'), (req, res) => admin.getStudentBrief(req as AuthRequest, res));
  router.post('/admin/students/:id/archive', authenticate, authorize('admin'), (req, res) => admin.archiveStudent(req as AuthRequest, res));
  router.get('/admin/archived-students', authenticate, authorize('admin'), (req, res) => admin.getArchivedStudents(req as AuthRequest, res));
  router.get('/admin/archived-students/:id', authenticate, authorize('admin'), (req, res) => admin.getArchivedStudent(req as AuthRequest, res));

  router.get('/admin/parents', authenticate, authorize('admin'), (req, res) => admin.getParents(req as AuthRequest, res));
  router.get('/admin/parents/:id/profile', authenticate, authorize('admin'), (req, res) => admin.getParentProfile(req as AuthRequest, res));
  router.patch('/admin/parents/:id', authenticate, authorize('admin'), (req, res) => admin.updateParent(req as AuthRequest, res));
  router.delete('/admin/parents/:id', authenticate, authorize('admin'), (req, res) => admin.deleteParent(req as AuthRequest, res));

  router.get('/admin/classes', authenticate, authorize('admin', 'teacher'), (req, res) => admin.getClasses(req as AuthRequest, res));
  router.post('/admin/classes', authenticate, authorize('admin'), (req, res) => admin.createClass(req as AuthRequest, res));
  router.put('/admin/classes/:id', authenticate, authorize('admin'), (req, res) => admin.updateClass(req as AuthRequest, res));
  router.delete('/admin/classes/:id', authenticate, authorize('admin'), (req, res) => admin.deleteClass(req as AuthRequest, res));
  router.get('/admin/weekly-summaries', authenticate, authorize('admin'), (req, res) => admin.getWeeklySummaries(req as AuthRequest, res));
  router.get('/admin/weekly-summary-status', authenticate, authorize('admin'), (req, res) => admin.getWeeklySummaryStatus(req as AuthRequest, res));

  router.get('/admin/teachers', authenticate, authorize('admin'), (req, res) => admin.getTeachers(req as AuthRequest, res));
  router.post('/admin/teachers', authenticate, authorize('admin'), (req, res) => admin.createTeacher(req as AuthRequest, res));
  router.put('/admin/teachers/:id', authenticate, authorize('admin'), (req, res) => admin.updateTeacher(req as AuthRequest, res));
  router.delete('/admin/teachers/:id', authenticate, authorize('admin'), (req, res) => admin.deleteTeacher(req as AuthRequest, res));

  router.get('/admin/drivers', authenticate, authorize('admin'), (req, res) => admin.getDrivers(req as AuthRequest, res));
  router.post('/admin/drivers', authenticate, authorize('admin'), (req, res) => admin.createDriver(req as AuthRequest, res));
  router.put('/admin/drivers/:id', authenticate, authorize('admin'), (req, res) => admin.updateDriver(req as AuthRequest, res));
  router.delete('/admin/drivers/:id', authenticate, authorize('admin'), (req, res) => admin.deleteDriver(req as AuthRequest, res));

  router.get('/admin/subjects', authenticate, authorize('admin', 'teacher'), (req, res) => admin.getSubjects(req as AuthRequest, res));
  router.post('/admin/subjects', authenticate, authorize('admin'), (req, res) => admin.createSubject(req as AuthRequest, res));
  router.put('/admin/subjects/:id', authenticate, authorize('admin'), (req, res) => admin.updateSubject(req as AuthRequest, res));
  router.delete('/admin/subjects/:id', authenticate, authorize('admin'), (req, res) => admin.deleteSubject(req as AuthRequest, res));

  router.post('/admin/accounts', authenticate, authorize('admin'), (req, res) => admin.createAccount(req as AuthRequest, res));
  router.get('/admin/accounts', authenticate, authorize('admin'), (req, res) => admin.getAccounts(req as AuthRequest, res));
  router.put('/admin/accounts/:userId', authenticate, authorize('admin'), (req, res) => admin.updateAccount(req as AuthRequest, res));
  router.delete('/admin/accounts/:userId', authenticate, authorize('admin'), (req, res) => admin.deleteAccount(req as AuthRequest, res));
  router.get('/admin/reset-requests', authenticate, authorize('admin'), (req, res) => admin.getResetRequests(req as AuthRequest, res));
  router.post('/admin/users/:userId/reset-password', authenticate, authorize('admin'), (req, res) => admin.resetUserPassword(req as AuthRequest, res));

  router.get('/admin/appointments/pending-count', authenticate, authorize('admin'), (req, res) => admin.getPendingAppointmentCount(req as AuthRequest, res));
  router.get('/admin/appointments', authenticate, authorize('admin'), (req, res) => admin.getAppointments(req as AuthRequest, res));
  router.put('/admin/appointments/:id', authenticate, authorize('admin'), (req, res) => admin.respondToAppointment(req as AuthRequest, res));

  router.post('/admin/notifications', authenticate, authorize('admin'), (req, res) => admin.sendNotification(req as AuthRequest, res));
  router.get('/admin/notifications/unread-count', authenticate, authorize('admin'), (req, res) => parent.getUnreadCount(req as AuthRequest, res));
  router.patch('/admin/notifications/read-all', authenticate, authorize('admin'), (req, res) => parent.markAllNotificationsRead(req as AuthRequest, res));
  router.post('/admin/schedule', authenticate, authorize('admin'), upload.single('file'), (req, res) => admin.uploadSchedule(req as AuthRequest, res));

  router.get('/admin/announcements', authenticate, authorize('admin', 'teacher', 'parent', 'supervisor'), (req, res) => admin.getAnnouncements(req as AuthRequest, res));
  router.get('/link-preview', authenticate, (req, res) => admin.getLinkPreview(req as AuthRequest, res));
  router.post('/admin/announcements', authenticate, authorize('admin'), upload.single('attachment'), (req, res) => admin.createAnnouncement(req as AuthRequest, res));
  router.delete('/admin/announcements/:id', authenticate, authorize('admin'), (req, res) => admin.deleteAnnouncement(req as AuthRequest, res));

  router.get('/admin/settings', authenticate, authorize('admin'), (req, res) => admin.getSettings(req as AuthRequest, res));
  router.put('/admin/settings', authenticate, authorize('admin'), (req, res) => admin.updateSettings(req as AuthRequest, res));
  router.post('/admin/year-transition', authenticate, authorize('admin'), (req, res) => admin.yearTransition(req as AuthRequest, res));
  router.get('/teacher/settings', authenticate, authorize('teacher'), (req, res) => admin.getSettings(req as AuthRequest, res));

  // ---- TEACHER ----
  router.get('/teacher/profile-data', authenticate, authorize('teacher'), (req, res) => teacher.getProfileData(req as AuthRequest, res));
  router.get('/teacher/homework', authenticate, authorize('teacher'), (req, res) => teacher.getHomework(req as AuthRequest, res));
  // Multer handles multipart/form-data for file uploads
  router.post('/teacher/homework', authenticate, authorize('teacher'), upload.single('attachment'), (req, res) => teacher.createHomework(req as AuthRequest, res));
  router.delete('/teacher/homework/:id', authenticate, authorize('teacher'), (req, res) => teacher.deleteHomework(req as AuthRequest, res));
  router.get('/teacher/assignments', authenticate, authorize('teacher'), (req, res) => teacher.getAssignments(req as AuthRequest, res));
  router.post('/teacher/assignments', authenticate, authorize('teacher'), upload.single('attachment'), (req, res) => teacher.createAssignment(req as AuthRequest, res));
  router.delete('/teacher/assignments/:id', authenticate, authorize('teacher'), (req, res) => teacher.deleteAssignment(req as AuthRequest, res));
  router.post('/teacher/reports', authenticate, authorize('teacher'), (req, res) => teacher.createReport(req as AuthRequest, res));
  router.get('/teacher/grades', authenticate, authorize('teacher'), (req, res) => teacher.getGrades(req as AuthRequest, res));
  router.post('/teacher/grades', authenticate, authorize('teacher'), (req, res) => teacher.upsertGrade(req as AuthRequest, res));
  router.get('/teacher/weekly-summary', authenticate, authorize('teacher'), (req, res) => teacher.getWeeklySummary(req as AuthRequest, res));
  router.post('/teacher/weekly-summary', authenticate, authorize('teacher'), (req, res) => teacher.upsertWeeklySummary(req as AuthRequest, res));
  router.get('/teacher/students', authenticate, authorize('teacher'), (req, res) => teacher.getMyStudents(req as AuthRequest, res));
  router.get('/teacher/classes', authenticate, authorize('teacher'), (req, res) => teacher.getMyClasses(req as AuthRequest, res));
  router.get('/teacher/notifications', authenticate, authorize('teacher'), (req, res) => parent.getNotifications(req as AuthRequest, res));
  router.get('/teacher/notifications/unread-count', authenticate, authorize('teacher'), (req, res) => parent.getUnreadCount(req as AuthRequest, res));
  router.patch('/teacher/notifications/read-all', authenticate, authorize('teacher'), (req, res) => parent.markAllNotificationsRead(req as AuthRequest, res));
  router.patch('/teacher/notifications/:id/read', authenticate, authorize('teacher'), (req, res) => parent.markNotificationRead(req as AuthRequest, res));
  router.get('/teacher/announcements', authenticate, authorize('teacher'), (req, res) => admin.getAnnouncements(req as AuthRequest, res));
  router.get('/teacher/subjects', authenticate, authorize('admin', 'teacher'), (req, res) => admin.getSubjects(req as AuthRequest, res));
  router.get('/teacher/attendance', authenticate, authorize('teacher'), (req, res) => teacher.getAttendance(req as AuthRequest, res));
  router.post('/teacher/attendance', authenticate, authorize('teacher'), (req, res) => teacher.markAttendance(req as AuthRequest, res));
  router.get('/teacher/schedule', authenticate, authorize('teacher'), (req, res) => admin.getSchedule(req as AuthRequest, res));

  // ---- PARENT ----
  router.get('/parent/children', authenticate, authorize('parent'), (req, res) => parent.getChildren(req as AuthRequest, res));
  router.get('/parent/homework', authenticate, authorize('parent'), (req, res) => parent.getHomework(req as AuthRequest, res));
  router.get('/parent/homework/:id', authenticate, authorize('parent'), (req, res) => parent.getHomeworkById(req as AuthRequest, res));
  router.get('/parent/assignments', authenticate, authorize('parent'), (req, res) => parent.getAssignments(req as AuthRequest, res));
  router.get('/parent/assignments/:id', authenticate, authorize('parent'), (req, res) => parent.getAssignmentById(req as AuthRequest, res));
  router.get('/parent/announcements', authenticate, authorize('parent'), (req, res) => parent.getAnnouncements(req as AuthRequest, res));
  router.get('/parent/announcements/:id', authenticate, authorize('parent'), (req, res) => parent.getAnnouncementById(req as AuthRequest, res));
  router.get('/parent/reports', authenticate, authorize('parent'), (req, res) => parent.getReport(req as AuthRequest, res));
  router.get('/parent/reports/:id', authenticate, authorize('parent'), (req, res) => parent.getReportById(req as AuthRequest, res));
  router.get('/parent/grades', authenticate, authorize('parent'), (req, res) => parent.getGrades(req as AuthRequest, res));
  router.get('/parent/bus-location', authenticate, authorize('parent'), (req, res) => parent.getBusLocation(req as AuthRequest, res));
  router.get('/parent/driver-info', authenticate, authorize('parent'), (req, res) => parent.getDriverInfo(req as AuthRequest, res));
  router.get('/parent/notifications', authenticate, authorize('parent'), (req, res) => parent.getNotifications(req as AuthRequest, res));
  router.get('/parent/notifications/unread-count', authenticate, authorize('parent'), (req, res) => parent.getUnreadCount(req as AuthRequest, res));
  router.get('/parent/notifications/content-counts', authenticate, authorize('parent'), (req, res) => parent.getContentUnreadCounts(req as AuthRequest, res));
  router.patch('/parent/notifications/read-all', authenticate, authorize('parent'), (req, res) => parent.markAllNotificationsRead(req as AuthRequest, res));
  router.patch('/parent/notifications/read-type/:type', authenticate, authorize('parent'), (req, res) => parent.markTypeRead(req as AuthRequest, res));
  router.patch('/parent/notifications/:id/read', authenticate, authorize('parent'), (req, res) => parent.markNotificationRead(req as AuthRequest, res));
  router.get('/parent/appointments', authenticate, authorize('parent'), (req, res) => parent.getAppointments(req as AuthRequest, res));
  router.post('/parent/appointments', authenticate, authorize('parent'), (req, res) => parent.createAppointment(req as AuthRequest, res));
  router.put('/parent/pickup-location', authenticate, authorize('parent'), (req, res) => parent.updatePickupLocation(req as AuthRequest, res));
  router.get('/parent/pickup-location', authenticate, authorize('parent'), (req, res) => parent.getPickupLocation(req as AuthRequest, res));

  // ---- SUPERVISOR ----
  router.get('/supervisor/classes', authenticate, authorize('supervisor'), (req, res) => supervisor.getClasses(req as AuthRequest, res));
  router.get('/supervisor/classes/:classId/students', authenticate, authorize('supervisor'), (req, res) => supervisor.getStudentsByClass(req as AuthRequest, res));
  router.get('/supervisor/absent-today', authenticate, authorize('supervisor'), (req, res) => supervisor.getAbsentToday(req as AuthRequest, res));
  router.get('/supervisor/attendance', authenticate, authorize('supervisor'), (req, res) => supervisor.getAttendanceByClass(req as AuthRequest, res));
  router.get('/supervisor/attendance-summary', authenticate, authorize('supervisor'), (req, res) => supervisor.getAttendanceSummary(req as AuthRequest, res));
  router.get('/supervisor/students', authenticate, authorize('supervisor'), (req, res) => supervisor.getAllStudents(req as AuthRequest, res));
  router.post('/supervisor/attendance', authenticate, authorize('supervisor'), (req, res) => supervisor.createAttendanceRecord(req as AuthRequest, res));
  router.patch('/supervisor/attendance/:id', authenticate, authorize('supervisor'), (req, res) => supervisor.updateAttendanceRecord(req as AuthRequest, res));
  router.get('/supervisor/bus-rides', authenticate, authorize('supervisor', 'admin'), (req, res) => supervisor.getBusRideRecords(req as AuthRequest, res));
  router.get('/supervisor/homework', authenticate, authorize('supervisor'), (req, res) => supervisor.getHomework(req as AuthRequest, res));
  router.delete('/supervisor/homework/:id', authenticate, authorize('supervisor'), (req, res) => supervisor.deleteHomework(req as AuthRequest, res));
  router.get('/supervisor/assignments', authenticate, authorize('supervisor'), (req, res) => supervisor.getAssignments(req as AuthRequest, res));
  router.delete('/supervisor/assignments/:id', authenticate, authorize('supervisor'), (req, res) => supervisor.deleteAssignment(req as AuthRequest, res));
  router.get('/supervisor/weekly-summaries', authenticate, authorize('supervisor'), (req, res) => admin.getWeeklySummaries(req as AuthRequest, res));
  router.get('/supervisor/weekly-summary-status', authenticate, authorize('supervisor'), (req, res) => admin.getWeeklySummaryStatus(req as AuthRequest, res));
  router.get('/supervisor/weekly-period', authenticate, authorize('supervisor', 'teacher', 'admin'), (req, res) => supervisor.getActivePeriod(req as AuthRequest, res));
  router.post('/supervisor/weekly-period', authenticate, authorize('supervisor'), (req, res) => supervisor.openPeriod(req as AuthRequest, res));
  router.delete('/supervisor/weekly-period', authenticate, authorize('supervisor'), (req, res) => supervisor.closePeriod(req as AuthRequest, res));
  router.get('/supervisor/subjects', authenticate, authorize('supervisor'), (req, res) => admin.getSubjects(req as AuthRequest, res));
  router.get('/supervisor/student-brief/:id', authenticate, authorize('supervisor'), (req, res) => admin.getStudentBrief(req as AuthRequest, res));

  // ---- DRIVER ----
  router.get('/driver/me', authenticate, authorize('driver'), (req, res) => driver.getMyProfile(req as AuthRequest, res));
  router.get('/driver/students', authenticate, authorize('driver'), (req, res) => driver.getMyStudents(req as AuthRequest, res));
  router.get('/driver/today-attendance', authenticate, authorize('driver'), (req, res) => driver.getTodayAttendance(req as AuthRequest, res));
  router.post('/driver/location', authenticate, authorize('driver'), (req: Request, res: Response) => driver.updateLocation(req as AuthRequest, res, io));
  router.post('/driver/start', authenticate, authorize('driver'), (req, res) => driver.startDrive(req as AuthRequest, res));
  router.post('/driver/stop', authenticate, authorize('driver'), (req: Request, res: Response) => driver.stopDrive(req as AuthRequest, res, io));

  // ---- SHARED NOTIFICATIONS (all roles) ----
  router.get('/notifications', authenticate, (req, res) => parent.getNotifications(req as AuthRequest, res));
  router.patch('/notifications/:id/read', authenticate, (req, res) => parent.markNotificationRead(req as AuthRequest, res));

  // ---- ACADEMIC PORTAL ----
  const academicRoles = ['parent', 'teacher', 'admin', 'supervisor'] as const;
  router.get('/academic/posts', authenticate, authorize(...academicRoles), (req, res) => academic.getPosts(req as AuthRequest, res));
  router.get('/academic/posts/:id', authenticate, authorize(...academicRoles), (req, res) => academic.getPost(req as AuthRequest, res));
  router.post('/academic/posts', authenticate, authorize('teacher'), (req, res) => academic.createPost(req as AuthRequest, res));
  router.put('/academic/posts/:id', authenticate, authorize('teacher'), (req, res) => academic.updatePost(req as AuthRequest, res));
  router.delete('/academic/posts/:id', authenticate, authorize('teacher', 'admin'), (req, res) => academic.deletePost(req as AuthRequest, res));
  router.post('/academic/posts/upload', authenticate, authorize('teacher'), upload.single('file'), (req, res) => academic.uploadPostFile(req as AuthRequest, res));
  router.get('/academic/classes', authenticate, authorize(...academicRoles), (req, res) => academic.getClasses(req as AuthRequest, res));

  router.get('/academic/ebooks', authenticate, authorize(...academicRoles), (req, res) => academic.getEbooks(req as AuthRequest, res));
  router.post('/academic/ebooks', authenticate, authorize('teacher', 'admin'), upload.single('file'), (req, res) => academic.uploadEbook(req as AuthRequest, res));
  router.delete('/academic/ebooks/:id', authenticate, authorize('teacher', 'admin'), (req, res) => academic.deleteEbook(req as AuthRequest, res));

  // ---- CHAT ----
  const chatRoles = ['parent', 'teacher', 'supervisor'] as const;
  router.get('/chat/contacts', authenticate, authorize(...chatRoles), (req, res) => chat.getContacts(req as AuthRequest, res));
  router.get('/chat/conversations', authenticate, authorize(...chatRoles), (req, res) => chat.getConversations(req as AuthRequest, res));
  router.post('/chat/conversations', authenticate, authorize(...chatRoles), (req, res) => chat.getOrCreateConversation(req as AuthRequest, res));
  router.get('/chat/conversations/:id/messages', authenticate, authorize(...chatRoles), (req, res) => chat.getMessages(req as AuthRequest, res));
  router.post('/chat/conversations/:id/messages', authenticate, authorize(...chatRoles), (req, res) => chat.sendMessage(req as AuthRequest, res));
  router.post('/chat/conversations/:id/read', authenticate, authorize(...chatRoles), (req, res) => chat.markRead(req as AuthRequest, res));
  router.patch('/chat/messages/:msgId', authenticate, authorize(...chatRoles), (req, res) => chat.editMessage(req as AuthRequest, res));
  router.delete('/chat/messages/:msgId', authenticate, authorize(...chatRoles), (req, res) => chat.deleteMessage(req as AuthRequest, res));
  router.get('/chat/unread-count', authenticate, authorize(...chatRoles), (req, res) => chat.getUnreadCount(req as AuthRequest, res));
  router.post('/chat/upload', authenticate, authorize(...chatRoles), upload.single('file'), (req, res) => chat.uploadAttachment(req as AuthRequest, res));

  return router;
}
