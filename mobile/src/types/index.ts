export type Role = 'parent' | 'teacher' | 'admin' | 'driver' | 'supervisor' | 'reception' | 'accountant';

export interface AcademicPost {
  id: string;
  title: string;
  subject?: string;
  body?: string;
  content?: string;
  content_type: 'richtext' | 'plaintext' | 'file';
  attachment_url?: string;
  attachment_name?: string;
  image_url?: string;
  is_published: boolean;
  created_at: string;
  updated_at: string;
  class_id?: string | null;
  teacher_id?: string | null;
  author_user_id?: string | null;
  author_role?: 'teacher' | 'supervisor';
  author_name?: string;
  author_subject?: string | null;
  author_avatar?: string | null;
  likes_count?: number;
  saves_count?: number;
  comments_count?: number;
  liked_by_me?: boolean;
  saved_by_me?: boolean;
  classes?: { name: string } | null;
  teachers?: { full_name: string; subject?: string; user_id?: string } | null;
}

export interface PostComment {
  id: string;
  post_id: string;
  user_id: string;
  parent_id?: string | null;
  body: string;
  created_at: string;
  likes_count?: number;
  liked_by_me?: boolean;
  author_subject?: string | null;
  users?: { first_name: string; last_name: string; role: string; profile_picture?: string };
}

export interface Ebook {
  id: string;
  title: string;
  subject?: string;
  author?: string;
  cover_url?: string;
  file_url: string;
  description?: string;
  class_id?: string;
  created_at: string;
  classes?: { name: string };
}

export interface EbookProgress {
  id: string;
  ebook_id: string;
  student_id: string;
  current_page: number;
  total_pages?: number;
  percent: number;
  updated_at: string;
  students?: { full_name: string };
}

export interface School {
  id: string;
  name: string;
  slug: string;
  logoUrl?: string;
  primaryColor: string;
  secondaryColor: string;
  features?: Record<string, boolean>;
  timezone?: string;
}

export interface AuthUser {
  id: string;
  username: string;
  role: Role;
  firstName: string;
  lastName: string;
  profilePicture?: string;
  email?: string | null;
}

export interface Student {
  id: string;
  fullName: string;
  profilePicture?: string;
  classId?: string;
  classes?: { name: string };
  parentId?: string;
  driverId?: string;
  homeAddress?: string;
  homeLatitude?: number;
  homeLongitude?: number;
  emergencyContact?: string;
  phoneNumber?: string;
  isGraduated?: boolean;
  parents?: { fullName: string; phoneNumber: string; userId?: string };
  drivers?: { fullName: string; phoneNumber?: string; licenseNumber?: string; buses?: { busNumber: string } };
}

export interface Homework {
  id: string;
  title: string;
  description?: string;
  attachmentUrl?: string;
  dueDate?: string;
  subject?: string;
  createdAt: string;
  classId: string;
  classes?: { name: string };
}

export interface GradeMark { name: string; value: number }

export interface Grade {
  id: string;
  subject: string;
  marks?: GradeMark[];
  dailyGrade?: number;
  quizGrade?: number;
  monthlyExamGrade?: number;
  termExamGrade?: number;
  gradingPeriod?: string;
  academicYear?: string;
  // release gate
  isReleased?: boolean;
  releasedAt?: string | null;
  // admin-only note; parents see it on release only when non-empty
  adminNote?: string | null;
  createdAt: string;
}

export interface Report {
  id: string;
  subject: string;
  attendanceNotes?: string;
  behaviorNotes?: string;
  quizMarks?: number;
  examMarks?: number;
  marks?: GradeMark[];
  teacherNotes?: string;
  reportDate?: string;
  createdAt: string;
  students?: { fullName: string };
  teachers?: { fullName: string };
}

export interface Announcement {
  id: string;
  title: string;
  content: string;
  targetAudience: string;
  imageUrl?: string;
  attachmentUrl?: string;
  linkUrl?: string;
  createdAt: string;
  // Announcement objects are camelCased by the backend's toCC(); comments are
  // not (see AnnouncementComment below). Keep these in sync with the API shape.
  likesCount?: number;
  commentsCount?: number;
  likedByMe?: boolean;
  users?: {
    id?: string;
    firstName?: string;
    lastName?: string;
    role?: string;
    profilePicture?: string;
  };
}

export interface AnnouncementComment {
  id: string;
  announcement_id: string;
  user_id: string;
  parent_id: string | null;
  body: string;
  created_at: string;
  likes_count?: number;
  liked_by_me?: boolean;
  author_subject?: string | null;
  users?: {
    first_name?: string;
    last_name?: string;
    role?: string;
    profile_picture?: string;
  };
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  isRead: boolean;
  notificationType: string;
  relatedId?: string;
  createdAt: string;
}

// Keyset-paginated list envelope. `nextCursor` is null when exhausted;
// pass it back as `?cursor=` for the next page.
export interface Paginated<T> {
  data: T[];
  limit: number;
  nextCursor: string | null;
}

export interface ChatUser {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  role: string;
  subject?: string;
  profilePicture?: string;
}

export interface Conversation {
  id: string;
  otherUser: ChatUser | null;
  lastMessageAt: string;
  lastMessagePreview: string | null;
  lastMessageSenderId: string | null;
  lastMessageType: string;
  hasUnread: boolean;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  conversationId?: string;
  senderId: string;
  content?: string;
  type: 'text' | 'image' | 'file';
  attachmentUrl?: string;
  attachmentName?: string;
  attachmentSize?: number;
  isDeleted: boolean;
  editedAt?: string;
  createdAt: string;
}

export interface BusLocation {
  id: string;
  driverId: string;
  latitude: number;
  longitude: number;
  speed?: number;
  heading?: number;
  isDriving: boolean;
  recordedAt: string;
  drivers?: { fullName: string; phoneNumber?: string; licenseNumber?: string; buses?: { busNumber: string } };
}

// ── Tuition fees ────────────────────────────────────────────────────────
export type FeeStatus = 'paid_up' | 'current' | 'due_soon' | 'overdue';

export interface FeeInstallment {
  id: string;
  sequence: number;
  amount: number;
  dueDate: string;
}

export interface FeePayment {
  id: string;
  amount: number;
  paidOn: string;
  method: string | null;
  reference: string | null;
  notes: string | null;
  createdAt?: string;
  // HD-7 — refund + voided markers (parent screen renders these)
  isRefund?: boolean;
  refundOfPaymentId?: string | null;
  voidedAt?: string | null;
  voidReason?: string | null;
}

export interface StudentFeeRow {
  id: string;
  schoolId: string;
  studentId: string;
  studentName: string;
  className: string | null;
  parentId: string | null;
  parentName: string | null;
  parentUserId: string | null;
  planId: string;
  planName: string;
  academicYear: string | null;
  currency: string;
  totalAmount: number;
  adjustment: number;
  siblingDiscount: number;
  paid: number;
  balance: number;
  status: FeeStatus;
  installments: FeeInstallment[];
  lockedFeatures: string[];
}

export interface ParentFeeRow extends StudentFeeRow {
  payments: FeePayment[];
}

// Unified employee archive (teacher / driver / supervisor / staff).
// Kept in sync with frontend/src/types/index.ts (duplicated, no shared pkg).
// No mobile UI consumes this yet — present so the shapes don't drift.
export type ArchivedEmployeeRole = 'teacher' | 'driver' | 'supervisor' | 'staff' | 'admin';
export type ArchivedEmployeeReason =
  | 'resigned' | 'terminated' | 'contract_ended' | 'retired' | 'transferred' | 'other';

export interface ArchivedEmployeeListItem {
  id: string;
  role: ArchivedEmployeeRole;
  fullName: string;
  phoneNumber: string | null;
  email: string | null;
  position: string | null;
  subject: string | null;
  hireDate: string | null;
  departureDate: string | null;
  reason: ArchivedEmployeeReason | string;
  createdAt: string;
}

export interface ArchivedEmployee extends ArchivedEmployeeListItem {
  originalEmployeeId: string | null;
  dateOfBirth: string | null;
  age: number | null;
  emergencyContact: string | null;
  profilePicture: string | null;
  account: Record<string, unknown>;
  teaching: any;
  transport: any;
  employment: any;
  paymentHistory: {
    amount: number; currency: string; paidOn: string;
    periodLabel: string | null; notes: string | null;
    insuranceAmount: number; insurancePercentage: number | null;
  }[];
  archivedBy: string | null;
  archivedByName: string | null;
  archivedByRole: string | null;
  snapshotVersion: number | null;
}
