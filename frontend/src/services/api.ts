import axios from 'axios';
import { useAuthStore } from '../store/authStore';
import type { Paginated, Notification, Announcement, StaffSalaryPayment } from '../types';

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

// On a 401 we try ONCE to silently rotate the access token using the
// refresh token, then replay the original request. Concurrent 401s share a
// single in-flight refresh (single-flight) so we don't rotate N times and
// trip the reuse-detector. If refresh fails, the session is truly dead:
// revoke server-side, clear local state, bounce to /login.
let refreshInFlight: Promise<string | null> | null = null;

async function rotate(): Promise<string | null> {
  const rt = useAuthStore.getState().refreshToken;
  if (!rt) return null;
  try {
    const res = await axios.post(`${api.defaults.baseURL}/auth/refresh`, { refreshToken: rt });
    const { token, refreshToken } = res.data as { token: string; refreshToken: string };
    useAuthStore.getState().setTokens(token, refreshToken);
    return token;
  } catch {
    return null;
  }
}

function hardLogout(): void {
  useAuthStore.getState().logout(); // also revokes the family server-side
  if (!window.location.pathname.startsWith('/login')) window.location.href = '/login';
}

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const cfg = error.config;
    const url: string = cfg?.url || '';
    const isAuthFlow = url.includes('/auth/login') || url.includes('/auth/refresh') || url.includes('/auth/logout');

    if (error.response?.status === 401 && !isAuthFlow && cfg && !cfg._retry) {
      cfg._retry = true;
      if (!refreshInFlight) refreshInFlight = rotate().finally(() => { refreshInFlight = null; });
      const newToken = await refreshInFlight;
      if (newToken) {
        cfg.headers = cfg.headers || {};
        cfg.headers.Authorization = `Bearer ${newToken}`;
        return api(cfg); // replay with the rotated token
      }
      hardLogout();
    }
    return Promise.reject(error);
  }
);

export default api;

// Drains a keyset-paginated endpoint into one array by following
// `nextCursor`. Used for bounded audit lists (voided plans/payments/
// expenses/staff) whose screens still want the full set: the backend
// query is now bounded per request, but the UI keeps its existing
// counts/grouping. The cap is a safety valve, not an expected limit.
export async function drainPages<T>(
  fetcher: (cursor?: string) => Promise<{ data: { data: T[]; nextCursor: string | null } }>,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 1000; i++) {
    const r = await fetcher(cursor);
    out.push(...r.data.data);
    if (!r.data.nextCursor) break;
    cursor = r.data.nextCursor;
  }
  return out;
}

// ---- AUTH ----
export const authApi = {
  getSchools: () => api.get('/schools'),
  login: (username: string, password: string) =>
    api.post('/auth/login', { username, password }),
  logout: (refreshToken: string) => api.post('/auth/logout', { refreshToken }),
  logoutAll: () => api.post('/auth/logout-all'),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post('/auth/change-password', { currentPassword, newPassword }),
  forgotPassword: (username: string) =>
    api.post('/auth/forgot-password', { username }),
  forgotPasswordEmail: (username: string) =>
    api.post('/auth/forgot-password-email', { username }),
  uploadProfilePicture: (file: File) => {
    const fd = new FormData();
    fd.append('avatar', file);
    return api.patch('/auth/profile-picture', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
};

// ---- ME (self-service employee records, Wave 2.5) ----
export const meApi = {
  getEmployeeProfile: () => api.get('/me/employee-profile'),
  putExtended: (data: Record<string, unknown>) => api.put('/me/extended', data),
  createEmergencyContact: (data: Record<string, unknown>) => api.post('/me/emergency-contacts', data),
  updateEmergencyContact: (id: string, data: Record<string, unknown>) => api.patch(`/me/emergency-contacts/${id}`, data),
  deleteEmergencyContact: (id: string) => api.delete(`/me/emergency-contacts/${id}`),
  // Wave 3: self-service acknowledgements.
  listAcknowledgements: () => api.get('/me/acknowledgements'),
  signAcknowledgement: (policyId: string) => api.post('/me/acknowledgements', { policyId }),
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
  getNotifications: (cursor?: string | null) =>
    api.get<Paginated<Notification>>('/supervisor/notifications', { params: cursor ? { cursor } : {} }),
  getUnreadCount: () => api.get('/supervisor/notifications/unread-count'),
  markNotificationRead: (id: string) => api.patch(`/supervisor/notifications/${id}/read`),
  markAllRead: () => api.patch('/supervisor/notifications/read-all'),
};

// ---- PARENT ----
export const parentApi = {
  getChildren: () => api.get('/parent/children'),
  getArchivedChildren: () => api.get('/parent/archived-children'),
  getArchivedChild: (id: string) => api.get(`/parent/archived-children/${id}`),
  getHomework: (params?: Record<string, string>) => api.get('/parent/homework', { params }),
  getAssignments: (params?: Record<string, string>) => api.get('/parent/assignments', { params }),
  getAnnouncements: (cursor?: string | null) =>
    api.get<Paginated<Announcement>>('/parent/announcements', { params: cursor ? { cursor } : {} }),
  getReports: (params?: Record<string, string>) => api.get('/parent/reports', { params }),
  getGrades: (studentId?: string) => api.get('/parent/grades', { params: studentId ? { studentId } : {} }),
  getGradeConfig: () => api.get('/grade-config'),
  getBusLocation: (studentId?: string) => api.get('/parent/bus-location', { params: { studentId } }),
  getNotifications: (cursor?: string | null) =>
    api.get<Paginated<Notification>>('/parent/notifications', { params: cursor ? { cursor } : {} }),
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
  getSchedule: (studentId: string) => api.get('/parent/schedule', { params: { studentId } }),
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
  getTerms: () => api.get('/teacher/terms'),
  getActivePeriod: () => api.get('/supervisor/weekly-period'),
  getWeeklySummary: (params?: Record<string, string>) => api.get('/teacher/weekly-summary', { params }),
  upsertWeeklySummary: (data: object) => api.post('/teacher/weekly-summary', data),
  getStudents: (params?: Record<string, string>) => api.get('/teacher/students', { params }),
  getStudentBrief: (id: string) => api.get(`/teacher/students/${id}/brief`),
  getClasses: () => api.get('/teacher/classes'),
  getSettings: () => api.get('/teacher/settings'),
  getSchedule: () => api.get('/teacher/schedule'),
  getNotifications: (cursor?: string | null) =>
    api.get<Paginated<Notification>>('/teacher/notifications', { params: cursor ? { cursor } : {} }),
  markNotificationRead: (id: string) => api.patch(`/teacher/notifications/${id}/read`),
  getUnreadCount: () => api.get('/teacher/notifications/unread-count'),
  markAllRead: () => api.patch('/teacher/notifications/read-all'),
};

// ---- ADMIN ----
export const adminApi = {
  getStudents: (params?: Record<string, string>) => api.get('/admin/students', { params }),
  // Bulk lookup: pages through /admin/students (using the returned `total`)
  // and returns EVERY matching row. For assignment/dropdown screens that
  // need the full set — never silently truncates at >1000 students.
  getAllStudents: async (params?: Record<string, string>) => {
    const limit = 500;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const all: any[] = [];
    for (let page = 1; page <= 200; page++) {
      const r = await api.get('/admin/students', {
        params: { ...(params || {}), page: String(page), limit: String(limit) },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const batch: any[] = r.data?.students ?? [];
      all.push(...batch);
      const total: number = r.data?.total ?? all.length;
      if (batch.length === 0 || all.length >= total) break;
    }
    return { data: { students: all, total: all.length } };
  },
  createStudent: (data: object) => api.post('/admin/students', data),
  updateStudent: (id: string, data: object) => api.put(`/admin/students/${id}`, data),
  deleteStudent: (id: string) => api.delete(`/admin/students/${id}`),
  assignStudent: (data: object) => api.post('/admin/students/assign', data),
  getSchedule: () => api.get('/admin/schedule'),
  updateScheduleConfig: (data: { periodsPerDay?: number; scheduleDays?: string[] }) =>
    api.put('/admin/schedule/config', data),
  setScheduleCell: (data: { teacherId: string; dayOfWeek: number; periodIndex: number; classId: string | null }) =>
    api.put('/admin/schedule/cell', data),
  bulkUploadStudents: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post('/admin/students/bulk-upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  getStudentBrief: (id: string) => api.get(`/admin/students/${id}/brief`),
  // Grade review & release gate
  getPendingGrades: () => api.get('/admin/grades/pending'),
  getGradeReviewOverview: (term?: string) => api.get('/admin/grades/overview', { params: term ? { term } : {} }),
  updateGrade: (id: string, data: { marks?: { name: string; value: number | string }[]; adminNote?: string | null }) =>
    api.put(`/admin/grades/${id}`, data),
  releaseGrades: (ids: string[]) => api.post('/admin/grades/release', { ids }),
  getGraduatedStudents: (search?: string) => api.get('/admin/students/graduated', { params: search ? { search } : {} }),
  archiveStudent: (id: string, data: { reason: string; departureDate: string }) => api.post(`/admin/students/${id}/archive`, data),
  getArchivedStudents: (params?: { search?: string; reason?: string }) =>
    api.get('/admin/archived-students', { params: params ?? {} }),
  getArchivedStudent: (id: string) => api.get(`/admin/archived-students/${id}`),
  exportArchivedStudentRecord: (id: string) => api.get(`/admin/archived-students/${id}/export.json`, { responseType: 'blob' }),
  exportArchivedStudentPdf: (id: string, lang: string) =>
    api.get(`/admin/archived-students/${id}/export.pdf`, { responseType: 'blob', params: { lang } }),
  restoreArchivedStudent: (id: string) => api.post(`/admin/archived-students/${id}/restore`),
  searchArchivedStudents: (name: string, dob?: string) =>
    api.get('/admin/archived-students/search', { params: { name, ...(dob ? { dob } : {}) } }),
  exportArchivePdf: () => api.get('/admin/archive/export.pdf', { responseType: 'blob' }),
  exportArchiveXlsx: () => api.get('/admin/archive/export.xlsx', { responseType: 'blob' }),
  getArchivedEmployees: (params?: { role?: string; search?: string; reason?: string }) =>
    api.get('/admin/archived-employees', { params: params ?? {} }),
  getArchivedEmployee: (id: string) => api.get(`/admin/archived-employees/${id}`),
  exportArchivedEmployeeRecord: (id: string) => api.get(`/admin/archived-employees/${id}/export.json`, { responseType: 'blob' }),
  exportArchivedEmployeePdf: (id: string, lang: string) =>
    api.get(`/admin/archived-employees/${id}/export.pdf`, { responseType: 'blob', params: { lang } }),
  getArchivedEmployeeProfile: (id: string) =>
    api.get(`/admin/archived-employees/${id}/profile`),
  restoreArchivedEmployee: (id: string) => api.post(`/admin/archived-employees/${id}/restore`),
  searchArchivedEmployees: (name: string, role?: string) =>
    api.get('/admin/archived-employees/search', { params: { name, ...(role ? { role } : {}) } }),
  exportEmployeeArchivePdf: () => api.get('/admin/employee-archive/export.pdf', { responseType: 'blob' }),
  exportEmployeeArchiveXlsx: () => api.get('/admin/employee-archive/export.xlsx', { responseType: 'blob' }),
  exportFullArchiveBackup: () => api.get('/admin/archive/full-backup.json', { responseType: 'blob' }),
  verifyArchiveIntegrity: () => api.get('/admin/integrity/verify'),
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
  deleteTeacher: (id: string, body?: { reason?: string; departureDate?: string }) =>
    api.delete(`/admin/teachers/${id}`, { data: body ?? {} }),
  getDrivers: () => api.get('/admin/drivers'),
  createDriver: (data: object) => api.post('/admin/drivers', data),
  updateDriver: (id: string, data: object) => api.put(`/admin/drivers/${id}`, data),
  deleteDriver: (id: string, body?: { reason?: string; departureDate?: string }) =>
    api.delete(`/admin/drivers/${id}`, { data: body ?? {} }),
  getSubjects: () => api.get('/admin/subjects'),
  createSubject: (data: object) => api.post('/admin/subjects', data),
  updateSubject: (id: string, data: object) => api.put(`/admin/subjects/${id}`, data),
  deleteSubject: (id: string) => api.delete(`/admin/subjects/${id}`),
  getCurriculum: () => api.get('/admin/curriculum'),
  addCurriculumRow: (data: { classId: string; subjectId: string; teacherId: string }) => api.post('/admin/curriculum', data),
  deleteCurriculumRow: (id: string) => api.delete(`/admin/curriculum/${id}`),
  createAccount: (data: object) => api.post('/admin/accounts', data),
  getAccounts: () => api.get('/admin/accounts'),
  updateAccount: (userId: string, data: object) => api.put(`/admin/accounts/${userId}`, data),
  // Admin-uploaded professional photo for an employee record. `role` picks the
  // table; `id` is the profile-table id (teacher/driver/staff) or users id.
  uploadEmployeePhoto: (role: string, id: string, file: File) => {
    const fd = new FormData();
    fd.append('photo', file);
    return api.post(`/admin/employees/${role}/${id}/photo`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  // ── Employee profile + documents (Wave 1, migration 028) ─────────────
  getEmployeeProfile: (role: string, id: string) =>
    api.get(`/admin/employees/${role}/${id}`),
  exportEmployeeProfileJson: (role: string, id: string) =>
    api.get(`/admin/employees/${role}/${id}/export.json`, { responseType: 'blob' }),
  exportEmployeeProfilePdf: (role: string, id: string) =>
    api.get(`/admin/employees/${role}/${id}/export.pdf`, { responseType: 'blob' }),
  getEmployeeDocumentCategories: () => api.get('/admin/employee-document-categories'),
  listEmployeeDocuments: (role: string, id: string) =>
    api.get(`/admin/employees/${role}/${id}/documents`),
  uploadEmployeeDocument: (
    role: string,
    id: string,
    file: File,
    meta: { category: string; document_number?: string; issued_on?: string; expires_on?: string; notes?: string },
  ) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('category', meta.category);
    if (meta.document_number) fd.append('document_number', meta.document_number);
    if (meta.issued_on) fd.append('issued_on', meta.issued_on);
    if (meta.expires_on) fd.append('expires_on', meta.expires_on);
    if (meta.notes) fd.append('notes', meta.notes);
    return api.post(`/admin/employees/${role}/${id}/documents`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  getEmployeeDocumentSignedUrl: (id: string) => api.get(`/admin/employee-documents/${id}/signed-url`),
  updateEmployeeDocument: (id: string, data: { document_number?: string | null; issued_on?: string | null; expires_on?: string | null; notes?: string | null }) =>
    api.patch(`/admin/employee-documents/${id}`, data),
  voidEmployeeDocument: (id: string, reason: string) =>
    api.delete(`/admin/employee-documents/${id}`, { data: { reason } }),
  listExpiringEmployeeDocuments: (days = 30) =>
    api.get('/admin/employee-documents/expiring', { params: { days } }),

  // ── Wave 2: extended profile + emergency contacts + policies + acks +
  // actions + termination + HR officer (migration 029) ──────────────────
  getEmployeeExtended: (role: string, id: string) =>
    api.get(`/admin/employees/${role}/${id}/extended`),
  upsertEmployeeExtended: (role: string, id: string, data: Record<string, unknown>) =>
    api.put(`/admin/employees/${role}/${id}/extended`, data),
  redactEmployeeExtended: (role: string, id: string, reason: string) =>
    api.post(`/admin/employees/${role}/${id}/extended/redact`, { reason }),

  listEmergencyContacts: (role: string, id: string) =>
    api.get(`/admin/employees/${role}/${id}/emergency-contacts`),
  createEmergencyContact: (role: string, id: string, data: Record<string, unknown>) =>
    api.post(`/admin/employees/${role}/${id}/emergency-contacts`, data),
  updateEmergencyContact: (id: string, data: Record<string, unknown>) =>
    api.patch(`/admin/emergency-contacts/${id}`, data),
  deleteEmergencyContact: (id: string) =>
    api.delete(`/admin/emergency-contacts/${id}`),

  listSchoolPolicies: () => api.get('/admin/school-policies'),
  upsertSchoolPolicy: (data: Record<string, unknown>) => api.post('/admin/school-policies', data),
  updateSchoolPolicyMeta: (id: string, data: Record<string, unknown>) =>
    api.patch(`/admin/school-policies/${id}`, data),
  deleteSchoolPolicy: (id: string) => api.delete(`/admin/school-policies/${id}`),

  listEmployeeAcknowledgements: (role: string, id: string) =>
    api.get(`/admin/employees/${role}/${id}/acknowledgements`),
  createEmployeeAcknowledgement: (role: string, id: string, data: { policyId: string; signedDocumentId?: string }) =>
    api.post(`/admin/employees/${role}/${id}/acknowledgements`, data),

  listEmployeeActions: (role: string, id: string) =>
    api.get(`/admin/employees/${role}/${id}/actions`),
  createEmployeeAction: (role: string, id: string, data: Record<string, unknown>) =>
    api.post(`/admin/employees/${role}/${id}/actions`, data),
  terminateEmployee: (role: string, id: string, data: { documentId: string; summary: string; occurredOn?: string; departureDate?: string }) =>
    api.post(`/admin/employees/${role}/${id}/terminate`, data),

  listHrOfficers: () => api.get('/admin/hr-officers'),
  promoteHrOfficer: (userId: string) => api.post(`/admin/users/${userId}/promote-hr-officer`),
  demoteHrOfficer: (userId: string)  => api.post(`/admin/users/${userId}/demote-hr-officer`),
  deleteAccount: (userId: string, body?: { reason?: string; departureDate?: string }) =>
    api.delete(`/admin/accounts/${userId}`, { data: body ?? {} }),
  exportCredentialsPdf: (params: { role: 'parent' | 'teacher' | 'driver'; classId?: string; parentId?: string }) =>
    api.get('/admin/accounts/credentials.pdf', { params, responseType: 'blob' }),
  getResetRequests: () => api.get('/admin/reset-requests'),
  resetUserPassword: (userId: string, newPassword: string) =>
    api.post(`/admin/users/${userId}/reset-password`, { newPassword }),
  searchInactiveUsers: (name: string, role: 'teacher' | 'driver' | 'parent' | 'supervisor' | 'reception' | 'accountant' | 'admin') =>
    api.get('/admin/users/inactive/search', { params: { name, role } }),
  reactivateUser: (userId: string, newPassword?: string) =>
    api.post(`/admin/users/${userId}/reactivate`, newPassword ? { newPassword } : {}),
  // Staff HR (Employees → Staff sub-tab). Identity + archive only; salary
  // is set by the accountant in the Accounting portal. Reuses the staff
  // controller via admin-authorized routes.
  getStaff: (status?: 'active' | 'archived' | 'all') =>
    api.get('/admin/staff', { params: status ? { status } : {} }),
  createStaff: (data: { fullName: string; position?: string | null; salaryAmount: number; currency: string; previousArchiveId?: string | null } & Record<string, unknown>) =>
    api.post('/admin/staff', data),
  updateStaff: (id: string, data: { fullName?: string; position?: string | null } & Record<string, unknown>) =>
    api.put(`/admin/staff/${id}`, data),
  archiveStaff: (id: string, body?: { reason?: string; departureDate?: string }) =>
    api.delete(`/admin/staff/${id}`, { data: body ?? {} }),
  getPendingAppointmentCount: () => api.get('/admin/appointments/pending-count'),
  getAppointments: () => api.get('/admin/appointments'),
  respondToAppointment: (id: string, data: object) => api.put(`/admin/appointments/${id}`, data),
  sendNotification: (data: object) => api.post('/admin/notifications', data),
  getUnreadNotificationCount: () => api.get('/admin/notifications/unread-count'),
  markAllNotificationsRead: () => api.patch('/admin/notifications/read-all'),
  getAnnouncements: (cursor?: string | null) =>
    api.get<Paginated<Announcement>>('/admin/announcements', { params: cursor ? { cursor } : {} }),
  createAnnouncement: (data: FormData | object) =>
    api.post('/admin/announcements', data,
      data instanceof FormData ? { headers: { 'Content-Type': 'multipart/form-data' } } : {}),
  uploadAnnouncementImage: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post('/admin/announcements/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  deleteAnnouncement: (id: string) => api.delete(`/admin/announcements/${id}`),
  getSettings: () => api.get('/admin/settings'),
  updateSettings: (data: object) => api.put('/admin/settings', data),
  yearTransition: (data: { newAcademicYear: string; studentIdsToGraduate: string[]; classAssignments: { studentId: string; classId: string }[] }) =>
    api.post('/admin/year-transition', data),
  getMarkTypes: (appliesTo?: 'report' | 'grade') => api.get('/admin/mark-types', { params: appliesTo ? { for: appliesTo } : {} }),
  createMarkType: (data: { name: string; appliesTo: 'report' | 'grade' | 'both'; maxValue?: number | null }) => api.post('/admin/mark-types', data),
  updateMarkType: (id: string, data: { name?: string; appliesTo?: 'report' | 'grade' | 'both'; maxValue?: number | null }) => api.put(`/admin/mark-types/${id}`, data),
  deleteMarkType: (id: string) => api.delete(`/admin/mark-types/${id}`),
  // GPA grading config
  getGradeConfig: () => api.get('/grade-config'),
  updateGradingConfig: (data: { mode?: 'scale' | 'gpa' | 'both'; bands?: { minPercent: number; letter: string; gradePoint: number }[] }) => api.put('/admin/grading-config', data),
  getTerms: () => api.get('/admin/terms'),
  createTerm: (data: { name: string }) => api.post('/admin/terms', data),
  deleteTerm: (id: string) => api.delete(`/admin/terms/${id}`),
  uploadSchoolLogo: (file: File) => {
    const fd = new FormData();
    fd.append('logo', file);
    return api.patch('/admin/school-logo', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  getAuditLogs: (params: {
    entityType?: string;
    entityId?: string;
    actorId?: string;
    action?: string;
    search?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  } = {}) => api.get('/admin/audit-logs', { params }),
};

// ---- ACCOUNTING (premium tuition module) ----
export const feesApi = {
  // Plans-tab bootstrap: classes + school's current academic year
  getSetup: () => api.get<{ classes: { id: string; name: string; gradeLevel?: string }[]; currentAcademicYear: string | null }>('/accounting/setup'),
  // Plans
  listPlans: () => api.get('/accounting/plans'),
  createPlan: (data: object) => api.post('/accounting/plans', data),
  updatePlan: (id: string, data: object) => api.put(`/accounting/plans/${id}`, data),
  deletePlan: (id: string, reason?: string) => api.delete(`/accounting/plans/${id}`, { data: { reason } }),
  unvoidPlan: (id: string) => api.post(`/accounting/plans/${id}/unvoid`),
  // Keyset-paginated; drain with drainPages() for the full audit list.
  listVoidedPlans: (cursor?: string) =>
    api.get<{ data: any[]; limit: number; nextCursor: string | null }>('/accounting/plans/voided', { params: cursor ? { cursor } : {} }),
  assignPlan: (id: string, data?: { studentIds?: string[] }) => api.post(`/accounting/plans/${id}/assign`, data ?? {}),
  // Students / families
  listStudentFees: () => api.get('/accounting/students'),
  // Deduplicated rollup — one row per student with all plan kinds folded in.
  listStudentRollup: () => api.get('/accounting/students-rollup'),
  listFamilies: () => api.get('/accounting/families'),
  getStudentFee: (id: string) => api.get(`/accounting/student-fees/${id}`),
  // Per-student detail — every plan with its installments + payments for the tabbed detail page.
  getStudentDetail: (studentId: string) => api.get(`/accounting/students/${studentId}/detail`),
  updateStudentFee: (id: string, data: { adjustment?: number; notes?: string | null; totalAmount?: number }) =>
    api.patch(`/accounting/student-fees/${id}`, data),
  recordPayment: (studentFeeId: string, data: { amount: number; paidOn: string; method?: string; reference?: string; notes?: string; allocations?: { installmentId: string; amount: number }[]; unallocatedNote?: string; currency?: string; taxAmount?: number; taxLabel?: string; paymentAccountId?: string | null }) =>
    api.post(`/accounting/student-fees/${studentFeeId}/payments`, data),
  refundPayment: (paymentId: string, data: { amount: number; refundedOn: string; method?: string; reference?: string; notes?: string; paymentAccountId?: string | null }) =>
    api.post(`/accounting/payments/${paymentId}/refund`, data),
  deletePayment: (paymentId: string, reason?: string) => api.delete(`/accounting/payments/${paymentId}`, { data: { reason } }),
  unvoidPayment: (paymentId: string) => api.post(`/accounting/payments/${paymentId}/unvoid`),
  listVoidedPayments: (cursor?: string) =>
    api.get<{ data: any[]; limit: number; nextCursor: string | null }>('/accounting/payments/voided', { params: cursor ? { cursor } : {} }),
  // Late fees
  // Keyset-paginated envelope { data, limit, nextCursor }. Pass cursor to page.
  listLateFees: (studentFeeId?: string, cursor?: string) =>
    api.get('/accounting/late-fees', { params: { ...(studentFeeId ? { studentFeeId } : {}), ...(cursor ? { cursor } : {}) } }),
  voidLateFee: (id: string, reason?: string) => api.delete(`/accounting/late-fees/${id}`, { data: { reason } }),
  applyLateFeesNow: () => api.post('/accounting/late-fees/apply-now'),
  // Config
  getConfig: () => api.get('/accounting/config'),
  updateConfig: (data: object) => api.put('/accounting/config', data),
  // Broadcast
  notifyDue: (data: { title?: string; message?: string; statusFilter?: string[] }) =>
    api.post('/accounting/notify-due', data),
  // Locks
  setLock: (studentId: string, data: { feature: string; reason?: string }) =>
    api.post(`/accounting/students/${studentId}/locks`, data),
  removeLock: (studentId: string, feature: string) =>
    api.delete(`/accounting/students/${studentId}/locks/${feature}`),
  // Receipts (open in new tab; auth via interceptor on the API client)
  paymentReceiptUrl: (paymentId: string) => `${api.defaults.baseURL}/accounting/payments/${paymentId}/receipt.pdf`,
  studentFeeSummaryUrl: (studentFeeId: string) => `${api.defaults.baseURL}/accounting/student-fees/${studentFeeId}/summary.pdf`,
  downloadPaymentReceipt: (paymentId: string) =>
    api.get(`/accounting/payments/${paymentId}/receipt.pdf`, { responseType: 'blob' }),
  downloadStudentFeeSummary: (studentFeeId: string) =>
    api.get(`/accounting/student-fees/${studentFeeId}/summary.pdf`, { responseType: 'blob' }),
  // Parent
  getParentFees: () => api.get('/parent/fees'),
  // Archive — payment history for archived + graduated students
  // Keyset-paginated envelope; drain with drainPages() for the full set
  // (the archive screen filters/searches client-side over everything).
  listArchive: (search?: string, cursor?: string) =>
    api.get<{ data: ArchiveListItem[]; limit: number; nextCursor: string | null }>(
      '/accounting/archive',
      { params: { ...(search ? { search } : {}), ...(cursor ? { cursor } : {}) } },
    ),
  getArchiveDetail: (kind: 'archived' | 'graduated', id: string) =>
    api.get<ArchiveDetail>(`/accounting/archive/${kind}/${id}`),
  downloadArchivePdf: (kind: 'archived' | 'graduated', id: string) =>
    api.get(`/accounting/archive/${kind}/${id}/export.pdf`, { responseType: 'blob' }),
  downloadArchiveXlsx: (kind: 'archived' | 'graduated', id: string) =>
    api.get(`/accounting/archive/${kind}/${id}/export.xlsx`, { responseType: 'blob' }),
};

// ---- STAFF SALARIES (premium, gated by tuition_fees) ----
export const staffApi = {
  getSetup: () => api.get<{
    teachers: { teacherId: string; userId: string; fullName: string; subject: string | null; alreadyLinked: boolean }[];
    supervisors: { userId: string; fullName: string; alreadyLinked: boolean }[];
    admins: { userId: string; fullName: string; alreadyLinked: boolean }[];
  }>('/accounting/staff/setup'),
  list: (status?: 'active' | 'archived' | 'all') => api.get('/accounting/staff', { params: status ? { status } : {} }),
  create: (data: {
    userId?: string | null;
    fullName: string;
    position?: string | null;
    salaryAmount: number;
    currency: string;
    nextPaymentDate?: string | null;
    isActive?: boolean;
    insurancePercentage?: number | null;
    previousArchiveId?: string | null;
  }) => api.post('/accounting/staff', data),
  update: (id: string, data: Partial<{
    userId: string | null;
    fullName: string;
    position: string | null;
    salaryAmount: number;
    currency: string;
    nextPaymentDate: string | null;
    isActive: boolean;
    insurancePercentage: number | null;
  }>) => api.put(`/accounting/staff/${id}`, data),
  remove: (id: string, reason?: string) => api.delete(`/accounting/staff/${id}`, { data: { reason } }),
  unvoid: (id: string) => api.post(`/accounting/staff/${id}/unvoid`),
  listVoided: (cursor?: string) =>
    api.get<{ data: any[]; limit: number; nextCursor: string | null }>('/accounting/staff/voided', { params: cursor ? { cursor } : {} }),
  // Keyset-paginated rows; `totals` (per-currency gross/insurance/net) and
  // `count` are whole-set — the history modal summary uses them, not the page.
  listPayments: (id: string, cursor?: string) =>
    api.get<{
      data: StaffSalaryPayment[];
      limit: number;
      nextCursor: string | null;
      totals: { currency: string; gross: number; insurance: number; net: number; count: number }[];
      count: number;
    }>(`/accounting/staff/${id}/payments`, { params: cursor ? { cursor } : {} }),
  recordPayment: (id: string, data: { amount: number; currency?: string; paidOn: string; periodLabel?: string | null; notes?: string | null; insuranceAmount?: number | null; insurancePercentage?: number | null; taxAmount?: number; taxLabel?: string | null; paymentAccountId?: string | null }) =>
    api.post(`/accounting/staff/${id}/payments`, data),
  deletePayment: (paymentId: string, reason?: string) => api.delete(`/accounting/staff-payments/${paymentId}`, { data: { reason } }),
  unvoidPayment: (paymentId: string) => api.post(`/accounting/staff-payments/${paymentId}/unvoid`),
  listVoidedPayments: (cursor?: string) =>
    api.get<{ data: any[]; limit: number; nextCursor: string | null }>('/accounting/staff-payments/voided', { params: cursor ? { cursor } : {} }),
  notifyDue: (id: string) => api.post(`/accounting/staff/${id}/notify-due`),
  notifyAllDue: (data?: { title?: string; message?: string; dueWithinDays?: number }) =>
    api.post('/accounting/staff/notify-due-all', data ?? {}),
  bulkSetNextPayment: (data: { nextPaymentDate: string | null; staffIds?: string[] }) =>
    api.post<{ updated: number }>('/accounting/staff/bulk-next-payment', data),
  downloadSalaryPdf: (id: string) => api.get(`/accounting/staff/${id}/export.pdf`, { responseType: 'blob' }),
  downloadSalaryXlsx: (id: string) => api.get(`/accounting/staff/${id}/export.xlsx`, { responseType: 'blob' }),
  payInsurance: (id: string, data: { paidOn?: string; amount?: number; currency?: string; notes?: string | null }) =>
    api.post(`/accounting/staff/${id}/insurance/pay`, data),
  reverseInsurancePayout: (id: string) => api.post(`/accounting/staff/${id}/insurance/reverse`),
};

// ---- EXPENSES + LEDGER (premium accounting) ----
export interface ExpenseCategory {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseTemplate {
  id: string;
  categoryId: string | null;
  name: string;
  amount: number;
  currency: string;
  cadence: 'monthly' | 'quarterly' | 'yearly';
  nextDueDate: string | null;
  vendor: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  category?: { id: string; name: string } | null;
}

export interface ExpenseRow {
  id: string;
  categoryId: string | null;
  templateId: string | null;
  name: string;
  amount: number;
  currency: string;
  expenseDate: string;
  vendor: string | null;
  paymentMethod: string | null;
  notes: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  createdAt: string;
  category?: { id: string; name: string } | null;
  template?: { id: string; name: string; cadence: string } | null;
}

export const expensesApi = {
  // Categories
  listCategories: () => api.get<ExpenseCategory[]>('/accounting/expense-categories'),
  createCategory: (data: { name: string }) => api.post<ExpenseCategory>('/accounting/expense-categories', data),
  updateCategory: (id: string, data: { name?: string; isActive?: boolean }) =>
    api.patch<ExpenseCategory>(`/accounting/expense-categories/${id}`, data),
  deleteCategory: (id: string) => api.delete(`/accounting/expense-categories/${id}`),

  // Recurring templates
  listTemplates: () => api.get<ExpenseTemplate[]>('/accounting/expense-templates'),
  createTemplate: (data: {
    name: string;
    amount: number;
    currency?: string;
    cadence: 'monthly' | 'quarterly' | 'yearly';
    nextDueDate?: string | null;
    categoryId?: string | null;
    vendor?: string | null;
    notes?: string | null;
  }) => api.post<ExpenseTemplate>('/accounting/expense-templates', data),
  updateTemplate: (id: string, data: Partial<{
    name: string;
    amount: number;
    currency: string;
    cadence: 'monthly' | 'quarterly' | 'yearly';
    nextDueDate: string | null;
    categoryId: string | null;
    vendor: string | null;
    notes: string | null;
    isActive: boolean;
  }>) => api.patch<ExpenseTemplate>(`/accounting/expense-templates/${id}`, data),
  deleteTemplate: (id: string) => api.delete(`/accounting/expense-templates/${id}`),
  recordTemplate: (id: string, data?: { expenseDate?: string; amount?: number; notes?: string | null; paymentMethod?: string | null; taxAmount?: number; taxLabel?: string | null; paymentAccountId?: string | null }) =>
    api.post<{ expense: ExpenseRow; nextDueDate: string }>(`/accounting/expense-templates/${id}/record`, data ?? {}),

  // Expenses — keyset-paginated rows; `totals`/`count` are whole-set
  // (computed by the backend over the full filtered set, never the page).
  list: (params?: { startDate?: string; endDate?: string; categoryId?: string; kind?: 'recurring' | 'one_time' | 'all'; cursor?: string }) =>
    api.get<{
      data: ExpenseRow[];
      limit: number;
      nextCursor: string | null;
      totals: { currency: string; total: number }[];
      count: number;
    }>('/accounting/expenses', { params }),
  create: (data: {
    name: string;
    amount: number;
    currency?: string;
    expenseDate: string;
    categoryId?: string | null;
    vendor?: string | null;
    paymentMethod?: string | null;
    notes?: string | null;
    taxAmount?: number;
    taxLabel?: string | null;
    paymentAccountId?: string | null;
  }) => api.post<ExpenseRow>('/accounting/expenses', data),
  update: (id: string, data: Partial<{
    name: string;
    amount: number;
    currency: string;
    expenseDate: string;
    categoryId: string | null;
    vendor: string | null;
    paymentMethod: string | null;
    notes: string | null;
    taxAmount: number;
    taxLabel: string | null;
    paymentAccountId: string | null;
  }>) => api.patch<ExpenseRow>(`/accounting/expenses/${id}`, data),
  void: (id: string, reason?: string) => api.delete(`/accounting/expenses/${id}`, { data: { reason } }),
  unvoid: (id: string) => api.post(`/accounting/expenses/${id}/unvoid`),
  listVoided: (cursor?: string) =>
    api.get<{ data: (ExpenseRow & { voidedByName: string | null })[]; limit: number; nextCursor: string | null }>('/accounting/expenses/voided', { params: cursor ? { cursor } : {} }),
};

// ---- LEDGER (aggregate read) ----
export interface LedgerRow {
  id: string;
  date: string;
  type: 'income' | 'expense';
  source: 'fee_payment' | 'staff_salary_payment' | 'expense';
  category: string;
  description: string;
  amount: number;
  currency: string;
  reference: string | null;
}

export interface LedgerCurrencyTotal {
  currency: string;
  income: number;
  expense: number;
  net: number;
  count: number;
}

export interface LedgerCategoryTotal {
  category: string;
  type: 'income' | 'expense';
  amount: number;
  currency: string;
}

// Reports + admin-level accounting (periods, payment accounts, FX rates).
// Returns are intentionally loose (any) because each page narrows them.
export interface AccountingPeriod {
  id: string;
  periodStart: string;
  periodEnd: string;
  closedAt: string;
  closedBy: string | null;
  closedByName: string | null;
  reopenedAt: string | null;
  reopenedBy: string | null;
  reopenedByName: string | null;
  reopenReason: string | null;
  notes: string | null;
  isClosed: boolean;
}

export interface PaymentAccount {
  id: string;
  name: string;
  kind: 'cash' | 'bank' | 'wallet' | 'other';
  currency: string;
  openingBalance: number;
  isActive: boolean;
  notes: string | null;
  balance?: number;
}

export interface FxRate {
  id: string;
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  effectiveFrom: string;
}

export const accountingApi = {
  // Periods
  listPeriods: () => api.get<AccountingPeriod[]>('/accounting/periods'),
  closePeriod: (data: { periodStart: string; periodEnd: string; notes?: string }) => api.post<AccountingPeriod>('/accounting/periods', data),
  reopenPeriod: (id: string, reason: string) => api.post(`/accounting/periods/${id}/reopen`, { reason }),
  // Payment accounts
  listPaymentAccounts: () => api.get<PaymentAccount[]>('/accounting/payment-accounts'),
  createPaymentAccount: (data: Omit<PaymentAccount, 'id' | 'isActive' | 'balance'> & { notes?: string | null }) => api.post('/accounting/payment-accounts', data),
  updatePaymentAccount: (id: string, data: Partial<Omit<PaymentAccount, 'id' | 'balance'>>) => api.patch(`/accounting/payment-accounts/${id}`, data),
  deletePaymentAccount: (id: string) => api.delete(`/accounting/payment-accounts/${id}`),
  // FX rates
  listFxRates: () => api.get<FxRate[]>('/accounting/fx-rates'),
  setFxRate: (data: { fromCurrency: string; toCurrency: string; rate: number; effectiveFrom?: string }) => api.post('/accounting/fx-rates', data),
  deleteFxRate: (id: string) => api.delete(`/accounting/fx-rates/${id}`),
  // Reports
  getDashboard: () => api.get('/accounting/reports/dashboard'),
  getArAging: () => api.get('/accounting/reports/ar-aging'),
  getProfitLoss: (params: { startDate: string; endDate: string; compare?: '1' }) =>
    api.get('/accounting/reports/profit-loss', { params }),
  getCashFlow: (weeks?: number) => api.get('/accounting/reports/cash-flow', { params: weeks ? { weeks } : {} }),
  getTaxReport: (params: { startDate: string; endDate: string }) =>
    api.get('/accounting/reports/tax', { params }),
  rollupCurrencies: (data: { amounts: { amount: number; currency: string }[]; toCurrency?: string; asOf?: string }) =>
    api.post('/accounting/reports/rollup', data),
};

export const ledgerApi = {
  get: (params?: {
    startDate?: string;
    endDate?: string;
    sources?: string;
    currency?: string;
    type?: 'income' | 'expense';
    cursor?: string;
  }) =>
    api.get<{
      rows: LedgerRow[];
      totals: LedgerCurrencyTotal[];
      categories: LedgerCategoryTotal[];
      defaultCurrency: string;
      // Row-list pagination cursor. totals/categories are always whole-set.
      nextCursor: string | null;
    }>('/accounting/ledger', { params }),
  downloadPdf: (params?: { startDate?: string; endDate?: string; sources?: string; currency?: string }) =>
    api.get('/accounting/ledger/export.pdf', { params, responseType: 'blob' }),
  downloadXlsx: (params?: { startDate?: string; endDate?: string; sources?: string; currency?: string }) =>
    api.get('/accounting/ledger/export.xlsx', { params, responseType: 'blob' }),
};

// ---- GENERAL LEDGER (double-entry) ----
export interface GlAccount {
  id: string;
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
  subtype: string | null;
  currency: string | null;
  isSystem: boolean;
  isActive: boolean;
  paymentAccountId: string | null;
  expenseCategoryId: string | null;
}

export interface TrialBalanceAccount {
  accountId: string;
  code: string;
  name: string;
  type: string;
  debit: number;
  credit: number;
}
export interface TrialBalanceCurrency {
  currency: string;
  accounts: TrialBalanceAccount[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
}

export interface JournalLine {
  accountId: string;
  code: string;
  name: string;
  debit: number;
  credit: number;
  currency: string;
  description: string | null;
}
export interface JournalEntry {
  id: string;
  entryNo: number;
  entryDate: string;
  currency: string;
  memo: string | null;
  source: string;
  sourceId: string | null;
  isReversal: boolean;
  lines: JournalLine[];
}

export interface PLAccount { code: string; name: string; amount: number; }
export interface IncomeStatementCurrency {
  currency: string;
  income: PLAccount[];
  expense: PLAccount[];
  totalIncome: number;
  totalExpense: number;
  netIncome: number;
}

export interface BSAccount { code: string; name: string; amount: number; }
export interface BalanceSheetCurrency {
  currency: string;
  assets: BSAccount[];
  liabilities: BSAccount[];
  equity: BSAccount[];
  currentEarnings: number;
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  balanced: boolean;
}

export interface AccountLedgerRow {
  entryId: string;
  entryNo: number;
  date: string;
  memo: string | null;
  source: string;
  debit: number;
  credit: number;
  balance: number;
}
export interface AccountLedgerCurrency {
  currency: string;
  opening: number;
  rows: AccountLedgerRow[];
  closing: number;
}
export interface AccountLedger {
  account: { id: string; code: string; name: string; type: string };
  debitNormal: boolean;
  startDate: string | null;
  endDate: string | null;
  currencies: AccountLedgerCurrency[];
}

export const glApi = {
  accounts: () => api.get<GlAccount[]>('/accounting/gl/accounts'),
  trialBalance: (params?: { asOf?: string }) =>
    api.get<{ asOf: string | null; currencies: TrialBalanceCurrency[] }>('/accounting/gl/trial-balance', { params }),
  journal: (params?: { limit?: number }) =>
    api.get<JournalEntry[]>('/accounting/gl/journal', { params }),
  incomeStatement: (params?: { startDate?: string; endDate?: string }) =>
    api.get<{ startDate: string | null; endDate: string | null; currencies: IncomeStatementCurrency[] }>('/accounting/gl/income-statement', { params }),
  balanceSheet: (params?: { asOf?: string }) =>
    api.get<{ asOf: string | null; currencies: BalanceSheetCurrency[] }>('/accounting/gl/balance-sheet', { params }),
  accountLedger: (id: string, params?: { startDate?: string; endDate?: string }) =>
    api.get<AccountLedger>(`/accounting/gl/account/${id}`, { params }),
  // Phase 4 — management + entry
  createAccount: (body: { code: string; name: string; type: GlAccount['type']; subtype?: string | null }) =>
    api.post<GlAccount>('/accounting/gl/accounts', body),
  updateAccount: (id: string, body: { name?: string; subtype?: string | null; isActive?: boolean }) =>
    api.patch<GlAccount>(`/accounting/gl/accounts/${id}`, body),
  deleteAccount: (id: string) => api.delete(`/accounting/gl/accounts/${id}`),
  createJournalEntry: (body: {
    entryDate: string; currency: string; memo?: string | null;
    lines: { accountId: string; debit?: number; credit?: number; description?: string | null }[];
  }) => api.post<{ id: string }>('/accounting/gl/journal', body),
  postOpeningBalances: (body: {
    asOf?: string; currency: string; memo?: string | null;
    balances: { accountId: string; amount: number }[];
  }) => api.post<{ id: string }>('/accounting/gl/opening-balances', body),
  // Exports
  trialBalancePdf: (params?: { asOf?: string }) => api.get('/accounting/gl/trial-balance/export.pdf', { params, responseType: 'blob' }),
  trialBalanceXlsx: (params?: { asOf?: string }) => api.get('/accounting/gl/trial-balance/export.xlsx', { params, responseType: 'blob' }),
  incomeStatementPdf: (params?: { startDate?: string; endDate?: string }) => api.get('/accounting/gl/income-statement/export.pdf', { params, responseType: 'blob' }),
  incomeStatementXlsx: (params?: { startDate?: string; endDate?: string }) => api.get('/accounting/gl/income-statement/export.xlsx', { params, responseType: 'blob' }),
  balanceSheetPdf: (params?: { asOf?: string }) => api.get('/accounting/gl/balance-sheet/export.pdf', { params, responseType: 'blob' }),
  balanceSheetXlsx: (params?: { asOf?: string }) => api.get('/accounting/gl/balance-sheet/export.xlsx', { params, responseType: 'blob' }),
  journalXlsx: () => api.get('/accounting/gl/journal/export.xlsx', { responseType: 'blob' }),
};

export interface ArchiveListItem {
  kind: 'archived' | 'graduated';
  id: string;
  fullName: string;
  className: string | null;
  parentName: string | null;
  parentPhone: string | null;
  date: string | null;
  reason: string | null;
  totalDue: number;
  totalPaid: number;
  balance: number;
  currency: string;
}

export interface ArchivePlanDetail {
  planName: string;
  academicYear: string | null;
  currency: string;
  totalAmount: number;
  adjustment: number;
  payments: { amount: number; paidOn: string; method: string | null; reference: string | null; notes: string | null }[];
}

export interface ArchiveDetail {
  schoolName: string;
  schoolLogoUrl: string | null;
  studentName: string;
  status: 'archived' | 'graduated';
  parentName: string | null;
  parentPhone: string | null;
  className: string | null;
  departureDate: string | null;
  reason: string | null;
  plans: ArchivePlanDetail[];
}

// ---- ANNOUNCEMENTS (shared social) ----
export const announcementApi = {
  toggleLike: (id: string) => api.post(`/announcements/${id}/like`),
  getComments: (id: string) => api.get(`/announcements/${id}/comments`),
  createComment: (id: string, body: string, parentId?: string) =>
    api.post(`/announcements/${id}/comments`, parentId ? { body, parentId } : { body }),
  deleteComment: (commentId: string) => api.delete(`/announcements/comments/${commentId}`),
  toggleCommentLike: (commentId: string) => api.post(`/announcements/comments/${commentId}/like`),
  getById: (id: string) => api.get(`/announcements/${id}`),
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
  getChatWindow: () => api.get('/chat/window'),
  uploadAttachment: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post('/chat/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
};
