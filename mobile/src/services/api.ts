import axios from 'axios';
import { useAuthStore } from '../store/authStore';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://school-production-3ccc.up.railway.app/api';

const api = axios.create({
  baseURL: API_URL,
  timeout: 15000,
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (error) => {
    const isLoginRequest = error.config?.url?.includes('/auth/login');
    if (error.response?.status === 401 && !isLoginRequest) {
      // Only logout if the failing request used the *current* session's token.
      // A 401 against a stale token (e.g. an in-flight request from a previous
      // session that resolved after a fresh login) must not bounce the new
      // session back to the login screen.
      const usedAuth = error.config?.headers?.Authorization as string | undefined;
      const usedToken = usedAuth?.startsWith('Bearer ') ? usedAuth.slice(7) : undefined;
      const currentToken = useAuthStore.getState().token;
      if (usedToken && currentToken && usedToken === currentToken) {
        useAuthStore.getState().logout();
      }
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
  uploadProfilePicture: async (uri: string, name: string, mimeType: string): Promise<{ profilePicture: string }> => {
    const token = useAuthStore.getState().token;
    const form = new FormData();
    form.append('avatar', { uri, name, type: mimeType } as any);
    const res = await fetch(`${API_URL}/auth/profile-picture`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!res.ok) throw new Error('Upload failed');
    return res.json();
  },
};

// ---- PARENT ----
export const parentApi = {
  getChildren: () => api.get('/parent/children'),
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
};

// ---- SUPERVISOR ----
export const supervisorApi = {
  getClasses: () => api.get('/supervisor/classes'),
  getStudentsByClass: (classId: string) => api.get(`/supervisor/classes/${classId}/students`),
  getAllStudents: () => api.get('/supervisor/students'),
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
    const token = useAuthStore.getState().token;
    const { file, ...rest } = data;
    if (file) {
      const form = new FormData();
      form.append('attachment', { uri: file.uri, name: file.name, type: file.mimeType } as any);
      Object.entries(rest).forEach(([k, v]) => v !== undefined && form.append(k, String(v)));
      const res = await fetch(`${API_URL}/teacher/homework`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!res.ok) throw new Error('Upload failed');
      return { data: await res.json() };
    }
    return api.post('/teacher/homework', rest);
  },
  deleteHomework: (id: string) => api.delete(`/teacher/homework/${id}`),
  getAssignments: (params?: Record<string, string>) => api.get('/teacher/assignments', { params }),
  createAssignment: async (data: { classId: string; studentId?: string; title: string; description?: string; dueDate?: string; subject?: string; file?: { uri: string; name: string; mimeType: string } }) => {
    const token = useAuthStore.getState().token;
    const { file, ...rest } = data;
    if (file) {
      const form = new FormData();
      form.append('attachment', { uri: file.uri, name: file.name, type: file.mimeType } as any);
      Object.entries(rest).forEach(([k, v]) => v !== undefined && form.append(k, String(v)));
      const res = await fetch(`${API_URL}/teacher/assignments`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!res.ok) throw new Error('Upload failed');
      return { data: await res.json() };
    }
    return api.post('/teacher/assignments', rest);
  },
  deleteAssignment: (id: string) => api.delete(`/teacher/assignments/${id}`),
  createReport: (data: object) => api.post('/teacher/reports', data),
  getGrades: (studentId: string) => api.get('/teacher/grades', { params: { studentId } }),
  upsertGrade: (data: object) => api.post('/teacher/grades', data),
  getMarkTypes: (appliesTo?: 'report' | 'grade') => api.get('/teacher/mark-types', { params: appliesTo ? { for: appliesTo } : {} }),
  getActivePeriod: () => api.get('/supervisor/weekly-period'),
  getWeeklySummary: (params?: Record<string, string>) => api.get('/teacher/weekly-summary', { params }),
  upsertWeeklySummary: (data: object) => api.post('/teacher/weekly-summary', data),
  getNotifications: () => api.get('/teacher/notifications'),
  markNotificationRead: (id: string) => api.patch(`/teacher/notifications/${id}/read`),
  getUnreadCount: () => api.get('/teacher/notifications/unread-count'),
  markAllRead: () => api.patch('/teacher/notifications/read-all'),
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
  uploadAttachment: async (file: { uri: string; name: string; mimeType: string }): Promise<{ url: string; name: string; size: number; type: 'image' | 'file' }> => {
    const token = useAuthStore.getState().token;
    const form = new FormData();
    form.append('file', { uri: file.uri, name: file.name, type: file.mimeType } as any);
    const res = await fetch(`${API_URL}/chat/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!res.ok) throw new Error('Upload failed');
    return res.json();
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
  createComment: (postId: string, body: string) => api.post(`/academic/posts/${postId}/comments`, { body }),
  deleteComment: (commentId: string) => api.delete(`/academic/comments/${commentId}`),
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
