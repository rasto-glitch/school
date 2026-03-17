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
};

// ---- PARENT ----
export const parentApi = {
  getChildren: () => api.get('/parent/children'),
  getHomework: (params?: Record<string, string>) => api.get('/parent/homework', { params }),
  getGrades: (studentId?: string) => api.get('/parent/grades', { params: studentId ? { studentId } : {} }),
  getReports: (params?: Record<string, string>) => api.get('/parent/reports', { params }),
  getAnnouncements: () => api.get('/parent/announcements'),
  getBusLocation: (studentId?: string) => api.get('/parent/bus-location', { params: { studentId } }),
  getNotifications: () => api.get('/parent/notifications'),
  markRead: (id: string) => api.patch(`/parent/notifications/${id}/read`),
};

// ---- DRIVER ----
export const driverApi = {
  getStudents: (search?: string) => api.get('/driver/students', { params: { search } }),
  updateLocation: (data: object) => api.post('/driver/location', data),
  startDrive: (excludedStudentIds: string[]) => api.post('/driver/start', { excludedStudentIds }),
  stopDrive: () => api.post('/driver/stop'),
};
