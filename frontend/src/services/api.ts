import axios from 'axios';
import { useAuthStore } from '../store/authStore';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api',
  timeout: 15000,
});

// Attach JWT token to every request
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Handle 401 - auto logout (but not on the login request itself)
api.interceptors.response.use(
  (res) => res,
  (error) => {
    const isLoginRequest = error.config?.url?.includes('/auth/login');
    if (error.response?.status === 401 && !isLoginRequest) {
      useAuthStore.getState().logout();
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;

// ---- AUTH ----
export const authApi = {
  getSchools: () => api.get('/schools'),
  login: (username: string, password: string) =>
    api.post('/auth/login', { username, password }),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post('/auth/change-password', { currentPassword, newPassword }),
  forgotPassword: (username: string) =>
    api.post('/auth/forgot-password', { username }),
  uploadProfilePicture: (file: File) => {
    const fd = new FormData();
    fd.append('avatar', file);
    return api.patch('/auth/profile-picture', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
};

// ---- SUPERVISOR ----
export const supervisorApi = {
  getClasses: () => api.get('/supervisor/classes'),
  getStudentsByClass: (classId: string) => api.get(`/supervisor/classes/${classId}/students`),
  getAbsentToday: () => api.get('/supervisor/absent-today'),
  getAttendanceByClass: (classId: string, date: string) =>
    api.get('/supervisor/attendance', { params: { classId, date } }),
  getAttendanceSummary: (date?: string) =>
    api.get('/supervisor/attendance-summary', { params: date ? { date } : {} }),
  updateAttendanceRecord: (id: string, status: string, notes?: string) =>
    api.patch(`/supervisor/attendance/${id}`, { status, notes }),
  getHomework: () => api.get('/supervisor/homework'),
  deleteHomework: (id: string) => api.delete(`/supervisor/homework/${id}`),
  getAssignments: () => api.get('/supervisor/assignments'),
  deleteAssignment: (id: string) => api.delete(`/supervisor/assignments/${id}`),
  getWeeklySummaries: (params?: Record<string, string>) => api.get('/supervisor/weekly-summaries', { params }),
  getWeeklySummaryStatus: (weekStartDate: string) => api.get('/supervisor/weekly-summary-status', { params: { weekStartDate } }),
  getActivePeriod: () => api.get('/supervisor/weekly-period'),
  openPeriod: (weekStartDate: string, weekEndDate: string) => api.post('/supervisor/weekly-period', { weekStartDate, weekEndDate }),
  closePeriod: () => api.delete('/supervisor/weekly-period'),
  getSubjects: () => api.get('/supervisor/subjects'),
  getStudentBrief: (id: string) => api.get(`/supervisor/student-brief/${id}`),
  getAllStudents: (params?: Record<string, string>) => api.get('/supervisor/students', { params }),
};

// ---- PARENT ----
export const parentApi = {
  getChildren: () => api.get('/parent/children'),
  getHomework: (params?: Record<string, string>) => api.get('/parent/homework', { params }),
  getAssignments: (params?: Record<string, string>) => api.get('/parent/assignments', { params }),
  getAnnouncements: () => api.get('/parent/announcements'),
  getReports: (params?: Record<string, string>) => api.get('/parent/reports', { params }),
  getGrades: (studentId?: string) => api.get('/parent/grades', { params: studentId ? { studentId } : {} }),
  getBusLocation: (studentId?: string) => api.get('/parent/bus-location', { params: { studentId } }),
  getNotifications: () => api.get('/parent/notifications'),
  markRead: (id: string) => api.patch(`/parent/notifications/${id}/read`),
  createAppointment: (data: object) => api.post('/parent/appointments', data),
  getAppointments: () => api.get('/parent/appointments'),
  getHomeworkById: (id: string) => api.get(`/parent/homework/${id}`),
  getAssignmentById: (id: string) => api.get(`/parent/assignments/${id}`),
  getAnnouncementById: (id: string) => api.get(`/parent/announcements/${id}`),
  getReportById: (id: string) => api.get(`/parent/reports/${id}`),
  getLinkPreview: (url: string) => api.get('/link-preview', { params: { url } }),
  getUnreadCount: () => api.get('/parent/notifications/unread-count'),
  markTypeRead: (type: string) => api.patch(`/parent/notifications/read-type/${type}`),
};

// ---- TEACHER ----
export const teacherApi = {
  getAttendance: (classId: string, date: string) =>
    api.get('/teacher/attendance', { params: { classId, date } }),
  markAttendance: (data: object) => api.post('/teacher/attendance', data),
  getHomework: (params?: Record<string, string>) => api.get('/teacher/homework', { params }),
  createHomework: (data: FormData | object) =>
    api.post('/teacher/homework', data,
      data instanceof FormData ? { headers: { 'Content-Type': 'multipart/form-data' } } : {}),
  deleteHomework: (id: string) => api.delete(`/teacher/homework/${id}`),
  getAssignments: (params?: Record<string, string>) => api.get('/teacher/assignments', { params }),
  createAssignment: (data: FormData | object) =>
    api.post('/teacher/assignments', data,
      data instanceof FormData ? { headers: { 'Content-Type': 'multipart/form-data' } } : {}),
  deleteAssignment: (id: string) => api.delete(`/teacher/assignments/${id}`),
  createReport: (data: object) => api.post('/teacher/reports', data),
  getGrades: (studentId: string) => api.get('/teacher/grades', { params: { studentId } }),
  upsertGrade: (data: object) => api.post('/teacher/grades', data),
  getMarkTypes: (appliesTo?: 'report' | 'grade') => api.get('/teacher/mark-types', { params: appliesTo ? { for: appliesTo } : {} }),
  getActivePeriod: () => api.get('/supervisor/weekly-period'),
  getWeeklySummary: (params?: Record<string, string>) => api.get('/teacher/weekly-summary', { params }),
  upsertWeeklySummary: (data: object) => api.post('/teacher/weekly-summary', data),
  getStudents: (params?: Record<string, string>) => api.get('/teacher/students', { params }),
  getClasses: () => api.get('/teacher/classes'),
  getSettings: () => api.get('/teacher/settings'),
  getSchedule: () => api.get('/teacher/schedule'),
  getNotifications: () => api.get('/teacher/notifications'),
  markNotificationRead: (id: string) => api.patch(`/teacher/notifications/${id}/read`),
  getUnreadCount: () => api.get('/teacher/notifications/unread-count'),
  markAllRead: () => api.patch('/teacher/notifications/read-all'),
};

// ---- ADMIN ----
export const adminApi = {
  getStudents: (params?: Record<string, string>) => api.get('/admin/students', { params }),
  createStudent: (data: object) => api.post('/admin/students', data),
  updateStudent: (id: string, data: object) => api.put(`/admin/students/${id}`, data),
  deleteStudent: (id: string) => api.delete(`/admin/students/${id}`),
  assignStudent: (data: object) => api.post('/admin/students/assign', data),
  uploadSchedule: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post('/admin/schedule', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  bulkUploadStudents: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post('/admin/students/bulk-upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  getStudentBrief: (id: string) => api.get(`/admin/students/${id}/brief`),
  getGraduatedStudents: (search?: string) => api.get('/admin/students/graduated', { params: search ? { search } : {} }),
  archiveStudent: (id: string, data: { reason: string; departureDate: string }) => api.post(`/admin/students/${id}/archive`, data),
  getArchivedStudents: (search?: string) => api.get('/admin/archived-students', { params: search ? { search } : {} }),
  getArchivedStudent: (id: string) => api.get(`/admin/archived-students/${id}`),
  exportArchivePdf: () => api.get('/admin/archive/export.pdf', { responseType: 'blob' }),
  exportArchiveXlsx: () => api.get('/admin/archive/export.xlsx', { responseType: 'blob' }),
  getParents: () => api.get('/admin/parents'),
  getParentProfile: (id: string) => api.get(`/admin/parents/${id}/profile`),
  updateParent: (id: string, data: object) => api.patch(`/admin/parents/${id}`, data),
  deleteParent: (id: string) => api.delete(`/admin/parents/${id}`),
  getClasses: () => api.get('/admin/classes'),
  createClass: (data: object) => api.post('/admin/classes', data),
  updateClass: (id: string, data: object) => api.put(`/admin/classes/${id}`, data),
  deleteClass: (id: string) => api.delete(`/admin/classes/${id}`),
  getWeeklySummaries: (params?: Record<string, string>) => api.get('/admin/weekly-summaries', { params }),
  getWeeklySummaryStatus: (weekStartDate: string) => api.get('/admin/weekly-summary-status', { params: { weekStartDate } }),
  getTeachers: () => api.get('/admin/teachers'),
  createTeacher: (data: object) => api.post('/admin/teachers', data),
  updateTeacher: (id: string, data: object) => api.put(`/admin/teachers/${id}`, data),
  deleteTeacher: (id: string) => api.delete(`/admin/teachers/${id}`),
  getDrivers: () => api.get('/admin/drivers'),
  createDriver: (data: object) => api.post('/admin/drivers', data),
  updateDriver: (id: string, data: object) => api.put(`/admin/drivers/${id}`, data),
  deleteDriver: (id: string) => api.delete(`/admin/drivers/${id}`),
  getSubjects: () => api.get('/admin/subjects'),
  createSubject: (data: object) => api.post('/admin/subjects', data),
  updateSubject: (id: string, data: object) => api.put(`/admin/subjects/${id}`, data),
  deleteSubject: (id: string) => api.delete(`/admin/subjects/${id}`),
  createAccount: (data: object) => api.post('/admin/accounts', data),
  getAccounts: () => api.get('/admin/accounts'),
  updateAccount: (userId: string, data: object) => api.put(`/admin/accounts/${userId}`, data),
  deleteAccount: (userId: string) => api.delete(`/admin/accounts/${userId}`),
  getResetRequests: () => api.get('/admin/reset-requests'),
  resetUserPassword: (userId: string, newPassword: string) =>
    api.post(`/admin/users/${userId}/reset-password`, { newPassword }),
  getPendingAppointmentCount: () => api.get('/admin/appointments/pending-count'),
  getAppointments: () => api.get('/admin/appointments'),
  respondToAppointment: (id: string, data: object) => api.put(`/admin/appointments/${id}`, data),
  sendNotification: (data: object) => api.post('/admin/notifications', data),
  getUnreadNotificationCount: () => api.get('/admin/notifications/unread-count'),
  markAllNotificationsRead: () => api.patch('/admin/notifications/read-all'),
  getAnnouncements: () => api.get('/admin/announcements'),
  createAnnouncement: (data: FormData | object) =>
    api.post('/admin/announcements', data,
      data instanceof FormData ? { headers: { 'Content-Type': 'multipart/form-data' } } : {}),
  deleteAnnouncement: (id: string) => api.delete(`/admin/announcements/${id}`),
  getSettings: () => api.get('/admin/settings'),
  updateSettings: (data: object) => api.put('/admin/settings', data),
  yearTransition: (data: { newAcademicYear: string; studentIdsToGraduate: string[]; classAssignments: { studentId: string; classId: string }[] }) =>
    api.post('/admin/year-transition', data),
  getMarkTypes: (appliesTo?: 'report' | 'grade') => api.get('/admin/mark-types', { params: appliesTo ? { for: appliesTo } : {} }),
  createMarkType: (data: { name: string; appliesTo: 'report' | 'grade' | 'both' }) => api.post('/admin/mark-types', data),
  deleteMarkType: (id: string) => api.delete(`/admin/mark-types/${id}`),
};

// ---- DRIVER ----
export const driverApi = {
  getStudents: (search?: string) => api.get('/driver/students', { params: { search } }),
  updateLocation: (data: object) => api.post('/driver/location', data),
  startDrive: (excludedStudentIds: string[]) => api.post('/driver/start', { excludedStudentIds }),
  stopDrive: () => api.post('/driver/stop'),
};

// ---- RECEPTION ----
export const receptionApi = {
  getPendingAppointmentCount: () => api.get('/reception/appointments/pending-count'),
  getAppointments: () => api.get('/reception/appointments'),
  respondToAppointment: (id: string, data: object) => api.put(`/reception/appointments/${id}`, data),
};

// ---- CHAT ----
export const chatApi = {
  getContacts: () => api.get('/chat/contacts'),
  getConversations: () => api.get('/chat/conversations'),
  getOrCreateConversation: (otherUserId: string) => api.post('/chat/conversations', { otherUserId }),
  getMessages: (conversationId: string, before?: string) =>
    api.get(`/chat/conversations/${conversationId}/messages`, { params: before ? { before } : {} }),
  sendMessage: (conversationId: string, data: { content?: string; type?: string; attachmentUrl?: string; attachmentName?: string; attachmentSize?: number }) =>
    api.post(`/chat/conversations/${conversationId}/messages`, data),
  editMessage: (msgId: string, content: string) => api.patch(`/chat/messages/${msgId}`, { content }),
  deleteMessage: (msgId: string) => api.delete(`/chat/messages/${msgId}`),
  markRead: (conversationId: string) => api.post(`/chat/conversations/${conversationId}/read`),
  getUnreadCount: () => api.get('/chat/unread-count'),
  uploadAttachment: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post('/chat/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
};
