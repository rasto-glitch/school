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
  academic_portal: boolean;
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
  academic_portal: true,
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

// ── Chat audit ──────────────────────────────────────────────────────────────

export interface AuditUser {
  firstName: string;
  lastName: string;
  role: string;
}

export interface AuditConversation {
  id: string;
  parent: AuditUser | null;
  staff: AuditUser | null;
  staffRole: string;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  createdAt: string;
  messageCount: number;
}

export interface AuditEdit {
  previousContent: string | null;
  editedAt: string;
}

export interface AuditMessage {
  id: string;
  sender: AuditUser | null;
  senderId: string;
  content: string | null;
  type: 'text' | 'image' | 'file';
  attachmentUrl: string | null;
  attachmentName: string | null;
  attachmentSize: number | null;
  isDeleted: boolean;
  editedAt: string | null;
  deletedContent: string | null;
  deletedAttachmentUrl: string | null;
  deletedAttachmentName: string | null;
  createdAt: string;
  edits: AuditEdit[];
}

export interface AccessLogEntry {
  id: string;
  school_id: string;
  conversation_id: string | null;
  action: 'view' | 'export';
  reason: string;
  accessed_at: string;
}

export const getAuditConversations = (schoolId: string) =>
  api.get<AuditConversation[]>(`/chat-audit/schools/${schoolId}/conversations`);

export const getAuditMessages = (conversationId: string, reason: string) =>
  api.get<{ messages: AuditMessage[] }>(
    `/chat-audit/conversations/${conversationId}/messages`,
    { params: { reason } },
  );

export const exportAuditConversation = (conversationId: string, reason: string) =>
  api.get(`/chat-audit/conversations/${conversationId}/export`, {
    params: { reason },
    responseType: 'blob',
  });

export const getAccessLog = (schoolId?: string) =>
  api.get<AccessLogEntry[]>('/chat-audit/access-log', {
    params: schoolId ? { schoolId } : undefined,
  });
