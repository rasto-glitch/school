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
  archive: boolean;
  tuition_fees: boolean;
}

// Premium-only feature keys. Excluded from non-premium plan defaults
// and visually flagged in the master portal.
export const PREMIUM_ONLY_FEATURES = ['tuition_fees'] as const;

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
  archive: true,
  tuition_fees: false,
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
  // Required to be true for the server to actually purge archived/graduated
  // students when the archive feature is turned off. Omitted otherwise.
  confirmPurge?: boolean;
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

export const exportSchoolArchivePdf = (id: string) =>
  api.get(`/schools/${id}/archive-export.pdf`, { responseType: 'blob' });

export const exportSchoolArchiveXlsx = (id: string) =>
  api.get(`/schools/${id}/archive-export.xlsx`, { responseType: 'blob' });

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

// ── Operator inbox ─────────────────────────────────────────────────────────

export type InboxKey = 'all' | 'support' | 'onboarding' | 'contact' | 'partner';
export type InboxStatus = 'all' | 'unread' | 'read' | 'archived';

export interface ThreadSummary {
  threadId: string;
  latestId: string;
  subject: string;
  preview: string;
  participant: { email: string; name: string | null };
  inbox: string;          // e.g. "support@scholify.krd"
  messageCount: number;
  latestAt: string;
  latestDirection: 'inbound' | 'outbound';
  unread: boolean;
  archived: boolean;
  replied: boolean;
}

export interface EmailRow {
  id: string;
  thread_id: string;
  message_id: string | null;
  in_reply_to: string | null;
  references_header: string | null;
  direction: 'inbound' | 'outbound';
  from_email: string;
  from_name: string | null;
  to_email: string;
  cc_emails: string[];
  subject: string | null;
  text_body: string | null;
  html_body: string | null;
  received_at: string;
  is_read: boolean;
  is_archived: boolean;
  replied_at: string | null;
  resend_id: string | null;
  attachments: {
    name: string | null;
    type: string | null;
    size: number | null;
    storageKey?: string | null;
  }[];
}

export interface InboxDescriptor {
  address: string;
  name: string;
}

export const listInboxes = () =>
  api.get<{ inboxes: InboxDescriptor[] }>('/emails/inboxes');

export const listThreads = (params: { inbox?: InboxKey; status?: InboxStatus; q?: string } = {}) =>
  api.get<{ threads: ThreadSummary[] }>('/emails', { params });

export const getEmail = (id: string) =>
  api.get<{ email: EmailRow; thread: EmailRow[] }>(`/emails/${id}`);

export const patchEmail = (id: string, patch: { isRead?: boolean; isArchived?: boolean }) =>
  api.patch(`/emails/${id}`, patch);

export const patchThread = (threadId: string, patch: { isRead?: boolean; isArchived?: boolean }) =>
  api.patch(`/emails/thread/${threadId}`, patch);

export const getAttachmentUrl = (emailId: string, idx: number) =>
  api.get<{ url: string; filename: string | null; type: string | null }>(
    `/emails/attachments/${emailId}/${idx}/url`,
  );

// Helper: build a multipart body. Resend caps total at 40 MB; we cap at 25 MB.
function buildFormData(fields: Record<string, string | string[] | undefined>, files: File[]): FormData {
  const fd = new FormData();
  for (const [key, val] of Object.entries(fields)) {
    if (val === undefined) continue;
    if (Array.isArray(val)) fd.append(key, val.join(','));
    else fd.append(key, val);
  }
  for (const f of files) fd.append('attachments', f, f.name);
  return fd;
}

export const replyToEmail = (
  id: string,
  body: {
    text: string;
    html?: string;
    subject?: string;
    cc?: string[];
    fromInbox?: string;
  },
  files: File[] = [],
) => {
  const fd = buildFormData(
    {
      text: body.text,
      html: body.html,
      subject: body.subject,
      cc: body.cc,
      fromInbox: body.fromInbox,
    },
    files,
  );
  return api.post<{ ok: boolean; id?: string; resendId?: string | null }>(
    `/emails/${id}/reply`,
    fd,
  );
};

export const composeEmail = (
  body: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html?: string;
    cc?: string[];
  },
  files: File[] = [],
) => {
  const fd = buildFormData(
    {
      from: body.from,
      to: body.to,
      subject: body.subject,
      text: body.text,
      html: body.html,
      cc: body.cc,
    },
    files,
  );
  return api.post<{ ok: boolean; id?: string; threadId?: string; resendId?: string | null }>(
    '/emails/compose',
    fd,
  );
};
