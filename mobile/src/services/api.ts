import axios from 'axios';
import { useAuthStore } from '../store/authStore';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:5000/api';

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
      useAuthStore.getState().logout();
    }
    return Promise.reject(error);
  }
);

export default api;

// ---- AUTH ----
export const authApi = {
  getSchools: () => api.get('/schools'),
  login: (username: string, password: string, schoolSlug: string) =>
    api.post('/auth/login', { username, password, schoolSlug }),
  registerDeviceToken: (token: string, language: string) =>
    api.post('/auth/device-token', { token, language }),
  updateDeviceLanguage: (language: string) =>
    api.put('/auth/device-language', { language }),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post('/auth/change-password', { currentPassword, newPassword }),
  forgotPassword: (username: string, schoolSlug: string) =>
    api.post('/auth/forgot-password', { username, schoolSlug }),
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
