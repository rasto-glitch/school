import axios from 'axios';
import { useAuthStore } from '../store/authStore';

export const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://school-production-3ccc.up.railway.app/api';

const api = axios.create({
  baseURL: API_URL,
  timeout: 15000,
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Single-flight refresh: concurrent 401s share one rotation so we don't
// rotate N times and trip the server's reuse-detector. Returns the new
// access token, or null if the session is truly dead.
let refreshInFlight: Promise<string | null> | null = null;

export async function rotateSession(): Promise<string | null> {
  const rt = useAuthStore.getState().refreshToken;
  if (!rt) return null;
  if (!refreshInFlight) {
    refreshInFlight = axios
      .post(`${API_URL}/auth/refresh`, { refreshToken: rt })
      .then((res) => {
        const { token, refreshToken } = res.data as { token: string; refreshToken: string };
        useAuthStore.getState().setTokens(token, refreshToken);
        return token as string | null;
      })
      .catch(() => null)
      .finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const cfg = error.config;
    const url: string = cfg?.url || '';
    const isAuthFlow =
      url.includes('/auth/login') || url.includes('/auth/refresh') || url.includes('/auth/logout');

    if (error.response?.status === 401 && !isAuthFlow && cfg && !cfg._retry) {
      // Only act if the failing request used the *current* session's token.
      // A 401 against a stale token (an in-flight request from a previous
      // session resolving after a fresh login) must not disturb the new one.
      const usedAuth = cfg.headers?.Authorization as string | undefined;
      const usedToken = usedAuth?.startsWith('Bearer ') ? usedAuth.slice(7) : undefined;
      const currentToken = useAuthStore.getState().token;
      if (usedToken && currentToken && usedToken === currentToken) {
        cfg._retry = true;
        const newToken = await rotateSession();
        if (newToken) {
          cfg.headers = cfg.headers || {};
          cfg.headers.Authorization = `Bearer ${newToken}`;
          return api(cfg); // replay with the rotated token
        }
        useAuthStore.getState().logout();
      }
    }
    return Promise.reject(error);
  }
);

export default api;

// Multipart uploads can't go through the axios instance (React Native needs
// the raw FormData/fetch path), so they'd otherwise miss the 401 interceptor
// and swallow the server's error body. This helper restores both: it parses
// the JSON error (exposing `err.code`) and logs out on a 401 that used the
// current session token, exactly like the axios response interceptor.
async function multipartRequest<T>(
  path: string,
  form: FormData,
  method: 'POST' | 'PATCH' = 'POST',
  _retried = false,
): Promise<T> {
  const token = useAuthStore.getState().token;
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });
  if (!res.ok) {
    // Mirror the axios interceptor: on a 401 against the current session
    // token, try ONE silent rotation and replay before giving up.
    if (res.status === 401 && token && useAuthStore.getState().token === token && !_retried) {
      const newToken = await rotateSession();
      if (newToken) return multipartRequest<T>(path, form, method, true);
      useAuthStore.getState().logout();
    }
    let payload: { error?: string } = {};
    try { payload = await res.json(); } catch { /* non-JSON error body */ }
    const err = new Error(payload.error || 'upload_failed') as Error & { code?: string };
    err.code = payload.error;
    throw err;
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

// ---- AUTH ----
export const authApi = {
  getSchools: () => api.get('/schools'),
  login: (username: string, password: string) =>
    api.post('/auth/login', { username, password }),
  logout: (refreshToken: string) => api.post('/auth/logout', { refreshToken }),
  logoutAll: () => api.post('/auth/logout-all'),
  registerDeviceToken: (token: string, language: string) =>
    api.post('/auth/device-token', { token, language }),
  removeDeviceToken: (token: string) =>
    api.delete('/auth/device-token', { data: { token } }),
  updateDeviceLanguage: (language: string) =>
    api.put('/auth/device-language', { language }),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post('/auth/change-password', { currentPassword, newPassword }),
  forgotPassword: (username: string) =>
    api.post('/auth/forgot-password', { username }),
  forgotPasswordEmail: (username: string) =>
    api.post('/auth/forgot-password-email', { username }),
  uploadProfilePicture: (uri: string, name: string, mimeType: string): Promise<{ profilePicture: string }> => {
    const form = new FormData();
    form.append('avatar', { uri, name, type: mimeType } as any);
    return multipartRequest<{ profilePicture: string }>('/auth/profile-picture', form, 'PATCH');
  },
  updateMyEmail: (email: string) =>
    api.patch<{ email: string }>('/auth/me/email', { email }),
  getMe: () =>
    api.get<{ id: string; username: string; role: string; firstName: string; lastName: string; profilePicture: string | null; email: string | null }>('/auth/me'),
};

// ---- BUG REPORT ----
export const bugReportApi = {
  submit: async (
    description: string,
    deviceInfo: Record<string, string | undefined>,
    attachment: { uri: string; name: string; type: string } | null,
  ): Promise<void> => {
    const form = new FormData();
    form.append('description', description);
    form.append('deviceInfo', JSON.stringify(deviceInfo));
    if (attachment) {
      form.append('attachment', {
        uri: attachment.uri,
        name: attachment.name,
        type: attachment.type,
      } as any);
    }
    await multipartRequest<void>('/bug-report', form);
  },
};

// ---- PARENT ----
export const parentApi = {
  getChildren: () => api.get('/parent/children'),
  getArchivedChildren: () => api.get('/parent/archived-children'),
  getArchivedChild: (id: string) => api.get(`/parent/archived-children/${id}`),
  getHomework: (params?: Record<string, string>) => api.get('/parent/homework', { params }),
  getAssignments: (params?: Record<string, string>) => api.get('/parent/assignments', { params }),
  getGrades: (studentId?: string) => api.get('/parent/grades', { params: studentId ? { studentId } : {} }),
  getReports: (params?: Record<string, string>) => api.get('/parent/reports', { params }),
  getAnnouncements: () => api.get('/parent/announcements'),
  getBusLocation: (studentId?: string) => api.get('/parent/bus-location', { params: { studentId } }),
  getNotifications: () => api.get('/parent/notifications'),
  markRead: (id: string) => api.patch(`/parent/notifications/${id}/read`),
  getPickupLocation: () => api.get('/parent/pickup-location'),
  updatePickupLocation: (latitude: number, longitude: number, residenceType?: string, blockNumber?: string) => api.put('/parent/pickup-location', { latitude, longitude, residenceType, blockNumber }),
  getAppointments: () => api.get('/parent/appointments'),
  createAppointment: (data: { reason: string; message?: string; requestedDate?: string; studentIds?: string[] }) => api.post('/parent/appointments', data),
  markAllRead: () => api.patch('/parent/notifications/read-all'),
  getUnreadCount: () => api.get('/parent/notifications/unread-count'),
  getContentUnreadCounts: () => api.get('/parent/notifications/content-counts'),
  markTypeRead: (type: string) => api.patch(`/parent/notifications/read-type/${type}`),
  getDriverInfo: (studentId?: string) => api.get('/parent/driver-info', { params: studentId ? { studentId } : {} }),
  getHomeworkById: (id: string) => api.get(`/parent/homework/${id}`),
  getAssignmentById: (id: string) => api.get(`/parent/assignments/${id}`),
  getAnnouncementById: (id: string) => api.get(`/parent/announcements/${id}`),
  getReportById: (id: string) => api.get(`/parent/reports/${id}`),
  getLinkPreview: (url: string) => api.get('/link-preview', { params: { url } }),
  getSchedule: (studentId: string) => api.get('/parent/schedule', { params: { studentId } }),
};

// ---- FEES (parent) ----
export const feesApi = {
  getParentFees: () => api.get('/parent/fees'),
  // Auth-protected PDF endpoints; download via the helper in utils/download.ts.
  paymentReceiptPath: (paymentId: string) => `/accounting/payments/${paymentId}/receipt.pdf`,
  studentFeeStatementPath: (studentFeeId: string) => `/accounting/student-fees/${studentFeeId}/summary.pdf`,
};

// ---- ANNOUNCEMENTS (shared) ----
export const announcementApi = {
  toggleLike: (id: string) => api.post(`/announcements/${id}/like`),
  getComments: (id: string) => api.get(`/announcements/${id}/comments`),
  createComment: (id: string, body: string, parentId?: string) =>
    api.post(`/announcements/${id}/comments`, parentId ? { body, parentId } : { body }),
  deleteComment: (commentId: string) => api.delete(`/announcements/comments/${commentId}`),
  toggleCommentLike: (commentId: string) => api.post(`/announcements/comments/${commentId}/like`),
  getById: (id: string) => api.get(`/announcements/${id}`),
};

// ---- SUPERVISOR ----
export const supervisorApi = {
  getClasses: () => api.get('/supervisor/classes'),
  getStudentsByClass: (classId: string) => api.get(`/supervisor/classes/${classId}/students`),
  getAllStudents: () => api.get('/supervisor/students'),
  getSalary: () => api.get('/supervisor/salary'),
  getAbsentToday: () => api.get('/supervisor/absent-today'),
  getAttendance: (classId: string, date: string) => api.get('/supervisor/attendance', { params: { classId, date } }),
  getAttendanceSummary: (date?: string) => api.get('/supervisor/attendance-summary', { params: date ? { date } : {} }),
  createAttendance: (studentId: string, classId: string, date: string, status: string, notes?: string) =>
    api.post('/supervisor/attendance', { studentId, classId, date, status, notes }),
  updateAttendance: (id: string, status: string, notes?: string) => api.patch(`/supervisor/attendance/${id}`, { status, notes }),
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
  getHomeworkById: (id: string) => api.get(`/supervisor/homework/${id}`),
  getAssignmentById: (id: string) => api.get(`/supervisor/assignments/${id}`),
  getAnnouncements: () => api.get('/supervisor/announcements'),
  getAnnouncementById: (id: string) => api.get(`/supervisor/announcements/${id}`),
  getNotifications: () => api.get('/supervisor/notifications'),
  getUnreadCount: () => api.get('/supervisor/notifications/unread-count'),
  markNotificationRead: (id: string) => api.patch(`/supervisor/notifications/${id}/read`),
  markAllRead: () => api.patch('/supervisor/notifications/read-all'),
};

// ---- TEACHER ----
export const teacherApi = {
  getProfileData: () => api.get('/teacher/profile-data'),
  getClasses: () => api.get('/teacher/classes'),
  getStudents: (params?: Record<string, string>) => api.get('/teacher/students', { params }),
  getSettings: () => api.get('/teacher/settings'),
  getAttendance: (classId: string, date: string) => api.get('/teacher/attendance', { params: { classId, date } }),
  markAttendance: (data: { classId: string; date: string; records: { studentId: string; status: string; notes?: string }[] }) =>
    api.post('/teacher/attendance', data),
  getHomework: (params?: Record<string, string>) => api.get('/teacher/homework', { params }),
  createHomework: async (data: { classId: string; title: string; description?: string; dueDate?: string; subject?: string; file?: { uri: string; name: string; mimeType: string } }) => {
    const { file, ...rest } = data;
    if (file) {
      const form = new FormData();
      form.append('attachment', { uri: file.uri, name: file.name, type: file.mimeType } as any);
      Object.entries(rest).forEach(([k, v]) => v !== undefined && form.append(k, String(v)));
      return { data: await multipartRequest('/teacher/homework', form) };
    }
    return api.post('/teacher/homework', rest);
  },
  deleteHomework: (id: string) => api.delete(`/teacher/homework/${id}`),
  getAssignments: (params?: Record<string, string>) => api.get('/teacher/assignments', { params }),
  createAssignment: async (data: { classId: string; studentId?: string; title: string; description?: string; dueDate?: string; subject?: string; file?: { uri: string; name: string; mimeType: string } }) => {
    const { file, ...rest } = data;
    if (file) {
      const form = new FormData();
      form.append('attachment', { uri: file.uri, name: file.name, type: file.mimeType } as any);
      Object.entries(rest).forEach(([k, v]) => v !== undefined && form.append(k, String(v)));
      return { data: await multipartRequest('/teacher/assignments', form) };
    }
    return api.post('/teacher/assignments', rest);
  },
  deleteAssignment: (id: string) => api.delete(`/teacher/assignments/${id}`),
  createReport: (data: object) => api.post('/teacher/reports', data),
  getGrades: (studentId: string) => api.get('/teacher/grades', { params: { studentId } }),
  upsertGrade: (data: object) => api.post('/teacher/grades', data),
  getMarkTypes: (appliesTo?: 'report' | 'grade') => api.get('/teacher/mark-types', { params: appliesTo ? { for: appliesTo } : {} }),
  getTerms: () => api.get('/teacher/terms'),
  getStudentBrief: (id: string) => api.get(`/teacher/students/${id}/brief`),
  getActivePeriod: () => api.get('/supervisor/weekly-period'),
  getWeeklySummary: (params?: Record<string, string>) => api.get('/teacher/weekly-summary', { params }),
  upsertWeeklySummary: (data: object) => api.post('/teacher/weekly-summary', data),
  getNotifications: () => api.get('/teacher/notifications'),
  markNotificationRead: (id: string) => api.patch(`/teacher/notifications/${id}/read`),
  getUnreadCount: () => api.get('/teacher/notifications/unread-count'),
  markAllRead: () => api.patch('/teacher/notifications/read-all'),
  getAnnouncements: () => api.get('/teacher/announcements'),
  getSchedule: () => api.get('/teacher/schedule'),
  getSalary: () => api.get('/teacher/salary'),
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
  uploadAttachment: (file: { uri: string; name: string; mimeType: string }): Promise<{ url: string; name: string; size: number; type: 'image' | 'file' }> => {
    const form = new FormData();
    form.append('file', { uri: file.uri, name: file.name, type: file.mimeType } as any);
    return multipartRequest<{ url: string; name: string; size: number; type: 'image' | 'file' }>('/chat/upload', form);
  },
};

// ---- ACADEMIC / LEARN ----
export const academicApi = {
  getPosts: (classId?: string) => api.get('/academic/posts', { params: classId ? { classId } : {} }),
  getPost: (id: string) => api.get(`/academic/posts/${id}`),
  toggleLike: (postId: string) => api.post(`/academic/posts/${postId}/like`),
  toggleSave: (postId: string) => api.post(`/academic/posts/${postId}/save`),
  getSavedPosts: () => api.get('/academic/saved'),
  getComments: (postId: string) => api.get(`/academic/posts/${postId}/comments`),
  createComment: (postId: string, body: string, parentId?: string) =>
    api.post(`/academic/posts/${postId}/comments`, parentId ? { body, parentId } : { body }),
  deleteComment: (commentId: string) => api.delete(`/academic/comments/${commentId}`),
  toggleCommentLike: (commentId: string) => api.post(`/academic/comments/${commentId}/like`),
  createPost: (data: {
    title: string;
    classId?: string;
    contentType: 'richtext' | 'plaintext' | 'file';
    content?: string;
    body?: string;
    subject?: string;
    imageUrl?: string;
    isPublished?: boolean;
  }) => api.post('/academic/posts', data),
  deletePost: (id: string) => api.delete(`/academic/posts/${id}`),
  uploadPostFile: (file: { uri: string; name: string; mimeType: string }) => {
    const fd = new FormData();
    fd.append('file', { uri: file.uri, name: file.name, type: file.mimeType } as any);
    return api.post('/academic/posts/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  getEbooks: () => api.get('/academic/ebooks'),
  getEbookProgress: (params?: { ebookId?: string; studentId?: string }) =>
    api.get('/academic/ebook-progress', { params }),
  upsertEbookProgress: (data: { ebookId: string; studentId: string; currentPage: number; totalPages?: number }) =>
    api.post('/academic/ebook-progress', data),
};

// ---- DRIVER ----
export const driverApi = {
  getProfile: () => api.get('/driver/me'),
  getStudents: (search?: string) => api.get('/driver/students', { params: { search } }),
  getTodayAttendance: () => api.get('/driver/today-attendance'),
  updateLocation: (data: object) => api.post('/driver/location', data),
  startDrive: (studentRides: { studentId: string; rodeBus: boolean; exclusionReason?: string; schoolAttendanceStatus?: string }[]) =>
    api.post('/driver/start', { studentRides }),
  stopDrive: () => api.post('/driver/stop'),
};
