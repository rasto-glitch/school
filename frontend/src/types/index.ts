export type Role = 'parent' | 'teacher' | 'admin' | 'driver' | 'supervisor' | 'reception' | 'accountant';

export interface School {
  id: string;
  name: string;
  slug: string;
  abbreviation?: string;
  logoUrl?: string;
  primaryColor: string;
  secondaryColor: string;
  features?: Record<string, boolean>;
}

export interface AuthUser {
  id: string;
  username: string;
  role: Role;
  firstName: string;
  lastName: string;
  profilePicture?: string;
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
  drivers?: { fullName: string; phoneNumber?: string; licenseNumber?: string; vehicleType?: 'bus' | 'taxi'; buses?: { busNumber: string } };
}

export interface Teacher {
  id: string;
  fullName: string;
  phoneNumber?: string;
  subject?: string;
  emergencyContact?: string;
  profilePicture?: string;
  teacherClasses?: { classId: string; classes: { name: string } }[];
}

export interface Driver {
  id: string;
  fullName: string;
  phoneNumber?: string;
  emergencyContact?: string;
  licenseNumber?: string;
  vehicleType?: 'bus' | 'taxi';
  busId?: string;
  buses?: { busNumber: string; plateNumber?: string };
  age?: number;
  profilePicture?: string;
}

export interface Class {
  id: string;
  name: string;
  gradeLevel?: string;
  academicYear?: string;
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

export interface Assignment {
  id: string;
  title: string;
  description?: string;
  grade?: number;
  submissionStatus: 'pending' | 'submitted' | 'graded';
  dueDate?: string;
  subject?: string;
  attachmentUrl?: string;
  createdAt: string;
  students?: { fullName: string };
  classes?: { name: string };
}

export interface Mark {
  name: string;
  value: number;
}

export interface MarkType {
  id: string;
  name: string;
  appliesTo: 'report' | 'grade' | 'both';
  orderIndex: number;
}

export interface Term {
  id: string;
  name: string;
  orderIndex: number;
}

export interface Grade {
  id: string;
  subject: string;
  marks: Mark[];
  gradingPeriod?: string;
  academicYear?: string;
  createdAt: string;
  // legacy fields — present on old records
  dailyGrade?: number;
  quizGrade?: number;
  monthlyExamGrade?: number;
  termExamGrade?: number;
}

export interface Report {
  id: string;
  subject: string;
  attendanceNotes?: string;
  behaviorNotes?: string;
  marks?: Mark[];
  teacherNotes?: string;
  reportDate?: string;
  createdAt: string;
  students?: { fullName: string };
  teachers?: { fullName: string };
  // legacy fields — present on old records
  quizMarks?: number;
  examMarks?: number;
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
  likes_count?: number;
  comments_count?: number;
  liked_by_me?: boolean;
  users?: {
    id?: string;
    first_name?: string;
    last_name?: string;
    role?: string;
    profile_picture?: string;
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

export interface Appointment {
  id: string;
  parentId: string;
  reason?: string;
  message?: string;
  requestedDate?: string;
  responseMessage?: string;
  scheduledDate?: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  parents?: { fullName: string; phoneNumber: string };
}

export interface Attendance {
  id: string;
  studentId: string;
  classId: string;
  teacherId?: string;
  date: string;
  status: 'present' | 'absent' | 'late';
  notes?: string;
  createdAt: string;
  students?: { id: string; fullName: string; profilePicture?: string; classes?: { name: string }; parents?: { fullName: string; phoneNumber: string } };
  teachers?: { fullName: string };
}

export interface WeeklySummary {
  id: string;
  subject: string;
  unit?: string;
  lesson?: string;
  pages?: string;
  homeworkReminder?: string;
  weekStartDate?: string;
}

// ── Tuition fees ──────────────────────────────────────────────────────────

export type FeeStatus = 'paid_up' | 'current' | 'due_soon' | 'overdue';
export type FeeAppliesTo = 'all' | 'classes' | 'manual';

export interface FeeInstallment {
  id: string;
  sequence: number;
  amount: number;
  dueDate: string;
}

export interface FeePlan {
  id: string;
  name: string;
  totalAmount: number;
  currency: string;
  appliesTo: FeeAppliesTo;
  academicYear: string | null;
  isActive: boolean;
  createdAt: string;
  installments: FeeInstallment[];
  classIds: string[];
}

export interface FeePayment {
  id: string;
  amount: number;
  paidOn: string;
  method: string | null;
  reference: string | null;
  notes: string | null;
  recordedBy?: string | null;
  createdAt?: string;
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

export interface FamilyFeeGroup {
  parentId: string;
  parentName: string;
  parentUserId: string | null;
  students: StudentFeeRow[];
  totalDue: number;
  totalPaid: number;
  totalBalance: number;
  currency: string;
}

export interface SiblingDiscountTier { minSiblings: number; value: number }
export interface SiblingDiscountConfig {
  enabled: boolean;
  type: 'percent' | 'fixed';
  tiers: SiblingDiscountTier[];
}
export interface TuitionConfig {
  currency: string;
  siblingDiscount: SiblingDiscountConfig;
}

// ── Staff salaries ────────────────────────────────────────────────────────

export interface StaffSalaryPayment {
  id: string;
  amount: number;
  currency: string;
  paidOn: string;
  periodLabel: string | null;
  notes: string | null;
  insuranceAmount: number;
  insurancePercentage: number | null;
  recordedBy?: string | null;
  createdAt?: string;
}

export interface StaffMember {
  id: string;
  schoolId: string;
  userId: string | null;
  fullName: string;
  position: string | null;
  salaryAmount: number;
  currency: string;
  nextPaymentDate: string | null;
  isActive: boolean;
  userIsActive: boolean | null;
  effectiveActive: boolean;
  archiveReason: string | null;
  createdAt: string;
  lastPayment: { amount: number; currency: string; paidOn: string; periodLabel: string | null; insuranceAmount: number } | null;
  insurancePercentage: number | null;
  insurancePaidOut: boolean;
  insurancePaidOutAt: string | null;
  insurancePaidOutAmount: number | null;
  insurancePaidOutCurrency: string | null;
  insurancePaidOutNotes: string | null;
  insuranceHeldTotal: number;
  insuranceHeldByCurrency: { currency: string; amount: number }[];
}

export interface StaffSetupTeacher {
  teacherId: string;
  userId: string;
  fullName: string;
  subject: string | null;
  alreadyLinked: boolean;
}
