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
  timezone?: string;
}

export interface AuthUser {
  id: string;
  username: string;
  role: Role;
  firstName: string;
  lastName: string;
  email?: string | null;
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
  subject?: string; // comma-joined display cache of `subjects`
  subjects?: { id: string; name: string; classes?: { id: string; name: string }[] }[];
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
  maxValue?: number | null;
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
  // release gate
  isReleased?: boolean;
  releasedAt?: string | null;
  // admin-only note; parents see it on release only when non-empty
  adminNote?: string | null;
  // legacy fields — present on old records
  dailyGrade?: number;
  quizGrade?: number;
  monthlyExamGrade?: number;
  termExamGrade?: number;
}

// ---- Admin Grade Review drill-down (classes → students → pending grades) ----
export interface GradeReviewPending {
  id: string;
  subject: string;
  gradingPeriod?: string;
  marks: Mark[];
  adminNote?: string | null;
  createdAt: string;
  teacherName?: string | null;
}
export interface GradeReviewStudent {
  studentId: string;
  fullName: string;
  gradedSubjects: number;
  totalSubjects: number;
  pendingCount: number;
  pending: GradeReviewPending[];
}
export interface GradeReviewClass {
  classId: string;
  className: string;
  subjects: string[];
  totalSubjects: number;
  totalStudents: number;
  studentsComplete: number;
  students: GradeReviewStudent[];
}
export interface GradeReviewOverview {
  terms: string[];
  selectedTerm: string;
  classes: GradeReviewClass[];
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
  // migration 041
  academicYear?: string;
  classId?: string | null;
  classNameSnapshot?: string | null;
  teacherId?: string | null;
  teacherNameSnapshot?: string | null;
  sharedWithOtherTeachers?: boolean;
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

// Keyset-paginated list envelope. `nextCursor` is null when the list is
// exhausted; pass it back as `?cursor=` to fetch the next page.
export interface Paginated<T> {
  data: T[];
  limit: number;
  nextCursor: string | null;
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
export type FeePlanKind = 'tuition' | 'transport' | 'lunch' | 'uniform' | 'exam' | 'registration' | 'other';

export interface FeeInstallment {
  id: string;
  sequence: number;
  amount: number;
  /**
   * Amount after the student's adjustment + sibling discount have been
   * proportionally applied. Equal to `amount` when there are no adjustments.
   * Use this for any per-student installment display (modal, grid, etc.).
   */
  effectiveAmount: number;
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
  kind?: FeePlanKind;
  lateFeeEnabled?: boolean;
  lateFeeType?: 'fixed' | 'percent' | null;
  lateFeeAmount?: number;
  lateFeeGraceDays?: number;
}

export interface FeePaymentAllocation {
  installmentId: string;
  sequence: number | null;
  dueDate: string | null;
  amount: number;
}

export interface FeePayment {
  id: string;
  amount: number;
  paidOn: string;
  method: string | null;
  reference: string | null;
  notes: string | null;
  recordedBy?: string | null;
  recorderName?: string | null;
  allocations?: FeePaymentAllocation[];
  unallocatedAmount?: number;
  unallocatedNote?: string | null;
  createdAt?: string;
  // Accounting upgrade fields
  currency?: string | null;
  taxAmount?: number;
  taxLabel?: string | null;
  paymentAccountId?: string | null;
  receiptYear?: number | null;
  receiptNumber?: number | null;
  isRefund?: boolean;
  refundOfPaymentId?: string | null;
  // HD-7 — voided payment markers (parent + admin UI render strike-through).
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
  lateFees?: number;
  paid: number;
  balance: number;
  status: FeeStatus;
  installments: FeeInstallment[];
  lockedFeatures: string[];
  kind?: FeePlanKind;
}

// Used by the deduplicated Students list — one row per student summarizing
// every plan they have. Render the per-currency totals; pick a single status
// pill using the worst-of rule on the server.
export interface StudentRollupRow {
  studentId: string;
  studentName: string;
  className: string | null;
  parentId: string | null;
  parentName: string | null;
  parentUserId: string | null;
  plans: StudentRollupPlan[];
  totalsByCurrency: { currency: string; due: number; paid: number; balance: number }[];
  worstStatus: FeeStatus;
  kinds: FeePlanKind[];
  lockedFeatures: string[];
}
export interface StudentRollupPlan {
  studentFeeId: string;
  planId: string;
  planName: string;
  kind: FeePlanKind;
  academicYear: string | null;
  currency: string;
  totalAmount: number;
  adjustment: number;
  siblingDiscount: number;
  lateFees: number;
  paid: number;
  balance: number;
  status: FeeStatus;
}

// Used by the per-student detail page — every plan with its installments and
// payments attached. The page renders one tab per plan.
export interface StudentDetail {
  studentId: string;
  studentName: string;
  className: string | null;
  parentId: string | null;
  parentName: string | null;
  parentUserId: string | null;
  lockedFeatures: string[];
  plans: StudentDetailPlan[];
}
export interface StudentDetailPlan extends StudentRollupPlan {
  installments: FeeInstallment[];
  payments: FeePayment[];
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

export interface StaffSetupSupervisor {
  userId: string;
  fullName: string;
  alreadyLinked: boolean;
}

export interface StaffSetupAdmin {
  userId: string;
  fullName: string;
  alreadyLinked: boolean;
}

// Unified employee archive (teacher / driver / supervisor / staff).
// Mirrors the archived_employees table after toCC() camelCasing.
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
  // teacher: { curriculum: {classId, className, subjects[]}[], contentSummary: {...} }
  teaching: any;
  // driver: { busNumber, plateNumber, vehicleType, licenseNumber, studentsTransported[], rideRecordStats }
  transport: any;
  // staff: { salaryAmount, currency, position, nextPaymentDate, insurance* }
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
