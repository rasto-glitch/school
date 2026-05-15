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
  forgotPasswordEmail: (username: string) =>
    api.post('/auth/forgot-password-email', { username }),
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
  getNotifications: () => api.get('/supervisor/notifications'),
  getUnreadCount: () => api.get('/supervisor/notifications/unread-count'),
  markNotificationRead: (id: string) => api.patch(`/supervisor/notifications/${id}/read`),
  markAllRead: () => api.patch('/supervisor/notifications/read-all'),
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
  getGraduatedStudents: (search?: string) => api.get('/admin/students/graduated', { params: search ? { search } : {} }),
  archiveStudent: (id: string, data: { reason: string; departureDate: string }) => api.post(`/admin/students/${id}/archive`, data),
  getArchivedStudents: (search?: string) => api.get('/admin/archived-students', { params: search ? { search } : {} }),
  getArchivedStudent: (id: string) => api.get(`/admin/archived-students/${id}`),
  searchArchivedStudents: (name: string, dob?: string) =>
    api.get('/admin/archived-students/search', { params: { name, ...(dob ? { dob } : {}) } }),
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
  getCurriculum: () => api.get('/admin/curriculum'),
  addCurriculumRow: (data: { classId: string; subjectId: string; teacherId: string }) => api.post('/admin/curriculum', data),
  deleteCurriculumRow: (id: string) => api.delete(`/admin/curriculum/${id}`),
  createAccount: (data: object) => api.post('/admin/accounts', data),
  getAccounts: () => api.get('/admin/accounts'),
  updateAccount: (userId: string, data: object) => api.put(`/admin/accounts/${userId}`, data),
  deleteAccount: (userId: string) => api.delete(`/admin/accounts/${userId}`),
  exportCredentialsPdf: (params: { role: 'parent' | 'teacher' | 'driver'; classId?: string; parentId?: string }) =>
    api.get('/admin/accounts/credentials.pdf', { params, responseType: 'blob' }),
  getResetRequests: () => api.get('/admin/reset-requests'),
  resetUserPassword: (userId: string, newPassword: string) =>
    api.post(`/admin/users/${userId}/reset-password`, { newPassword }),
  searchInactiveUsers: (name: string, role: 'teacher' | 'driver' | 'parent' | 'supervisor' | 'reception' | 'accountant') =>
    api.get('/admin/users/inactive/search', { params: { name, role } }),
  reactivateUser: (userId: string, newPassword?: string) =>
    api.post(`/admin/users/${userId}/reactivate`, newPassword ? { newPassword } : {}),
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
  createMarkType: (data: { name: string; appliesTo: 'report' | 'grade' | 'both' }) => api.post('/admin/mark-types', data),
  deleteMarkType: (id: string) => api.delete(`/admin/mark-types/${id}`),
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
  listVoidedPlans: () => api.get('/accounting/plans/voided'),
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
  listVoidedPayments: () => api.get('/accounting/payments/voided'),
  // Late fees
  listLateFees: (studentFeeId?: string) => api.get('/accounting/late-fees', { params: studentFeeId ? { studentFeeId } : {} }),
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
  listArchive: (search?: string) => api.get<ArchiveListItem[]>('/accounting/archive', { params: { search } }),
  getArchiveDetail: (kind: 'archived' | 'graduated', id: string) =>
    api.get<ArchiveDetail>(`/accounting/archive/${kind}/${id}`),
  downloadArchivePdf: (kind: 'archived' | 'graduated', id: string) =>
    api.get(`/accounting/archive/${kind}/${id}/export.pdf`, { responseType: 'blob' }),
  downloadArchiveXlsx: (kind: 'archived' | 'graduated', id: string) =>
    api.get(`/accounting/archive/${kind}/${id}/export.xlsx`, { responseType: 'blob' }),
};

// ---- STAFF SALARIES (premium, gated by tuition_fees) ----
export const staffApi = {
  getSetup: () => api.get<{ teachers: { teacherId: string; userId: string; fullName: string; subject: string | null; alreadyLinked: boolean }[] }>('/accounting/staff/setup'),
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
  listVoided: () => api.get('/accounting/staff/voided'),
  listPayments: (id: string) => api.get(`/accounting/staff/${id}/payments`),
  recordPayment: (id: string, data: { amount: number; currency?: string; paidOn: string; periodLabel?: string | null; notes?: string | null; insuranceAmount?: number | null; insurancePercentage?: number | null; taxAmount?: number; taxLabel?: string | null; paymentAccountId?: string | null }) =>
    api.post(`/accounting/staff/${id}/payments`, data),
  deletePayment: (paymentId: string, reason?: string) => api.delete(`/accounting/staff-payments/${paymentId}`, { data: { reason } }),
  unvoidPayment: (paymentId: string) => api.post(`/accounting/staff-payments/${paymentId}/unvoid`),
  listVoidedPayments: () => api.get('/accounting/staff-payments/voided'),
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

  // Expenses
  list: (params?: { startDate?: string; endDate?: string; categoryId?: string; kind?: 'recurring' | 'one_time' | 'all' }) =>
    api.get<ExpenseRow[]>('/accounting/expenses', { params }),
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
  listVoided: () => api.get<(ExpenseRow & { voidedByName: string | null })[]>('/accounting/expenses/voided'),
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
  }) =>
    api.get<{
      rows: LedgerRow[];
      totals: LedgerCurrencyTotal[];
      categories: LedgerCategoryTotal[];
      defaultCurrency: string;
    }>('/accounting/ledger', { params }),
  downloadPdf: (params?: { startDate?: string; endDate?: string; sources?: string; currency?: string }) =>
    api.get('/accounting/ledger/export.pdf', { params, responseType: 'blob' }),
  downloadXlsx: (params?: { startDate?: string; endDate?: string; sources?: string; currency?: string }) =>
    api.get('/accounting/ledger/export.xlsx', { params, responseType: 'blob' }),
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
  uploadAttachment: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post('/chat/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
};
