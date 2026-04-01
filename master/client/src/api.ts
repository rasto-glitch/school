import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('master_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('master_token');
      window.location.reload();
    }
    return Promise.reject(err);
  }
);

export interface SchoolFeatures {
  homework: boolean;
  assignments: boolean;
  announcements: boolean;
  grades: boolean;
  reports: boolean;
  bus_tracking: boolean;
  appointments: boolean;
  attendance: boolean;
  weekly_summary: boolean;
  chat: boolean;
}

export const DEFAULT_FEATURES: SchoolFeatures = {
  homework: true,
  assignments: true,
  announcements: true,
  grades: true,
  reports: true,
  bus_tracking: true,
  appointments: true,
  attendance: true,
  weekly_summary: true,
  chat: true,
};

export interface School {
  id: string;
  name: string;
  slug: string;
  abbreviation: string;
  logo_url: string | null;
  primary_color: string;
  secondary_color: string;
  domain: string | null;
  subscription_plan: string;
  is_active: boolean;
  features: SchoolFeatures;
  created_at: string;
  studentCount: number;
  adminCount: number;
  userCount: number;
}

export interface CreateSchoolPayload {
  name: string;
  slug: string;
  abbreviation: string;
  primaryColor: string;
  secondaryColor: string;
  domain?: string;
  subscriptionPlan: string;
  features: SchoolFeatures;
  adminFirstName: string;
  adminLastName: string;
  adminUsername: string;
  adminPassword: string;
  adminEmail?: string;
}

export interface UpdateSchoolPayload {
  name: string;
  slug: string;
  abbreviation: string;
  primaryColor: string;
  secondaryColor: string;
  domain?: string;
  subscriptionPlan: string;
  features: SchoolFeatures;
}

export const authLogin = (secret: string) =>
  api.post<{ token: string }>('/auth/login', { secret });

export const getSchools = () => api.get<School[]>('/schools');

export const createSchool = (data: CreateSchoolPayload) =>
  api.post<School>('/schools', data);

export const updateSchool = (id: string, data: UpdateSchoolPayload) =>
  api.put<School>(`/schools/${id}`, data);

export const toggleSchoolStatus = (id: string, isActive: boolean) =>
  api.patch<School>(`/schools/${id}/status`, { isActive });

export const deleteSchool = (id: string) =>
  api.delete(`/schools/${id}`);

export const resetAdminPassword = (id: string, password: string) =>
  api.patch(`/schools/${id}/admin-password`, { password });
