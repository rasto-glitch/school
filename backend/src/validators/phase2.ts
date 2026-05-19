import { z } from 'zod';
import { nonEmptyStr, uuid, isoDate } from './common';

// Phase 2 — every remaining write surface (teaching, attendance, students/
// classes/curriculum, scheduling, notifications, academic content, chat).
//
// Same philosophy as Phase 1: enforce TYPE / SHAPE / BOUNDS and strip
// unknown keys (mass-assignment defense). Fields whose exact requiredness
// is owned by the controller are left OPTIONAL here — the controller still
// 400s on missing required values, so the schema can't loosen behavior,
// only tighten it. Required is used only for ids/dates where a wrong type
// is actively dangerous.

const optText = (max = 4000) => z.string().max(max).nullable().optional();
const contact = (max = 120) => z.string().trim().max(max).nullable().optional();
// id-ish field that also tolerates '' / null (controllers normalize).
const optId = z.union([uuid, z.literal('')]).nullable().optional();
const looseDate = z.string().max(40).nullable().optional();

// marks JSONB is [{ name, value }] — value is a grade (number) or a
// numeric/letter string. Stay lenient on value, bounded on the array.
const marksArr = z.array(z.object({
  name: nonEmptyStr(160),
  value: z.union([z.number(), z.string().max(50)]).nullable().optional(),
})).max(80);

// ── shared param schemas ────────────────────────────────────────────────
export const idParam = z.object({ id: uuid });
export const commentIdParam = z.object({ commentId: uuid });
export const msgIdParam = z.object({ msgId: uuid });
export const typeParam = z.object({ type: z.string().min(1).max(60) });

// ── Teacher ─────────────────────────────────────────────────────────────
export const createReportSchema = z.object({
  studentId: uuid,
  subject: nonEmptyStr(160),
  attendanceNotes: optText(),
  behaviorNotes: optText(),
  teacherNotes: optText(),
  marks: marksArr.optional(),
});
export const upsertGradeSchema = z.object({
  studentId: uuid,
  classId: uuid,
  subject: nonEmptyStr(160),
  gradingPeriod: z.string().max(60).optional(),
  marks: marksArr.optional(),
});
export const upsertWeeklySummarySchema = z.object({
  classId: uuid,
  subject: nonEmptyStr(160),
  unit: optText(2000),
  lesson: optText(2000),
  pages: optText(500),
  homeworkReminder: optText(2000),
});
export const markAttendanceSchema = z.object({
  classId: uuid,
  date: isoDate,
  records: z.array(z.object({
    studentId: uuid,
    status: z.enum(['present', 'absent', 'late']),
    notes: optText(1000),
  })).min(1).max(1000),
});

// ── Parent ──────────────────────────────────────────────────────────────
export const createAppointmentSchema = z.object({
  reason: z.string().max(300).optional(),
  message: z.string().max(4000).optional(),
  requestedDate: z.string().max(40).optional(),
  studentIds: z.array(uuid).max(50).optional(),
});
export const updatePickupLocationSchema = z.object({
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  residenceType: z.string().max(40).nullable().optional(),
  blockNumber: z.string().max(40).nullable().optional(),
});

// ── Supervisor ──────────────────────────────────────────────────────────
const attendanceStatus = z.enum(['present', 'absent', 'late', 'excused']);
export const createAttendanceRecordSchema = z.object({
  studentId: uuid,
  classId: uuid,
  date: isoDate,
  status: attendanceStatus,
  notes: optText(1000),
});
export const updateAttendanceRecordSchema = z.object({
  status: attendanceStatus.optional(),
  notes: optText(1000),
});
export const openPeriodSchema = z.object({
  weekStartDate: isoDate,
  weekEndDate: isoDate,
});

// ── Reception / admin appointment response ─────────────────────────────
export const respondToAppointmentSchema = z.object({
  responseMessage: z.string().max(4000).optional(),
  scheduledDate: z.string().max(40).nullable().optional(),
  status: nonEmptyStr(40),
});

// ── Driver ──────────────────────────────────────────────────────────────
export const updateLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  speed: z.number().nonnegative().max(1000).optional(),
  heading: z.number().min(0).max(360).optional(),
  isDriving: z.boolean().optional(),
});
export const startDriveSchema = z.object({
  studentRides: z.array(z.object({
    studentId: uuid,
    rodeBus: z.boolean(),
    exclusionReason: z.enum(['school_absent', 'went_home_with_parents']).optional(),
    schoolAttendanceStatus: z.string().max(40).optional(),
  })).max(1000).optional(),
});

// ── Admin: students / classes / subjects / curriculum ──────────────────
const studentBase = {
  fullName: nonEmptyStr(200),
  parentId: optId,
  classId: optId,
  driverId: optId,
  homeAddress: optText(1000),
  emergencyContact: contact(160),
  phoneNumber: contact(40),
  dateOfBirth: looseDate,
  residenceType: z.string().max(40).nullable().optional(),
  blockNumber: z.string().max(40).nullable().optional(),
  previousArchiveId: optId,
  parentEmail: z.string().max(254).nullable().optional(),
};
export const createStudentSchema = z.object(studentBase);
export const updateStudentSchema = z.object(studentBase).partial();
export const assignStudentSchema = z.object({
  studentId: uuid,
  newClassId: optId,
  graduated: z.boolean().optional(),
});
export const archiveStudentSchema = z.object({
  reason: z.string().max(1000).optional(),
  departureDate: z.string().max(40).optional(),
});

const classBase = {
  name: nonEmptyStr(160),
  gradeLevel: z.union([z.string().max(40), z.number()]).nullable().optional(),
  academicYear: z.string().max(20).optional(),
  nextClassId: optId,
};
export const createClassSchema = z.object(classBase);
export const updateClassSchema = z.object(classBase).partial();

export const createSubjectSchema = z.object({ name: nonEmptyStr(160) });
export const updateSubjectSchema = z.object({ name: nonEmptyStr(160) });

export const addCurriculumRowSchema = z.object({
  classId: uuid,
  subjectId: uuid,
  teacherId: uuid,
});

// ── Admin: notifications / schedule / settings / year / mark types ─────
export const sendNotificationSchema = z.object({
  userIds: z.array(uuid).max(5000).optional(),
  title: z.string().max(200).optional(),
  message: z.string().max(4000).optional(),
  type: z.string().max(60).optional(),
  targetRole: z.string().max(40).optional(),
});
export const updateScheduleConfigSchema = z.object({
  periodsPerDay: z.number().int().min(1).max(20).optional(),
  scheduleDays: z.array(z.string().max(20)).max(7).optional(),
});
export const setScheduleCellSchema = z.object({
  teacherId: optId,
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  periodIndex: z.number().int().min(0).max(50).optional(),
  classId: optId,
});
// Settings carry free-form JSON (chatRestrictions etc.) — validate the
// known keys but DON'T strip the rest.
export const updateSettingsSchema = z.object({
  currentAcademicYear: z.string().max(20).optional(),
  timezone: z.string().max(64).optional(),
  chatRestrictions: z.any().optional(),
}).passthrough();
export const yearTransitionSchema = z.object({
  newAcademicYear: nonEmptyStr(20),
  studentIdsToGraduate: z.array(uuid).max(20000).optional(),
  classAssignments: z.array(z.object({ studentId: uuid, classId: uuid })).max(20000).optional(),
});
export const createMarkTypeSchema = z.object({
  name: nonEmptyStr(120),
  appliesTo: z.enum(['report', 'grade', 'both']),
});
export const createTermSchema = z.object({ name: nonEmptyStr(120) });

// ── Announcement comments (admin + academic share the shape) ───────────
export const createCommentSchema = z.object({
  body: nonEmptyStr(8000),
  parentId: optId,
});

// ── Academic content ───────────────────────────────────────────────────
const postBase = {
  title: z.string().max(300).optional(),
  subject: z.string().max(160).optional(),
  classId: optId,
  content: z.string().max(500_000).optional(),
  body: z.string().max(500_000).optional(),
  contentType: z.enum(['richtext', 'plaintext', 'file']).optional(),
  isPublished: z.boolean().optional(),
  imageUrl: z.string().max(2000).nullable().optional(),
};
export const createPostSchema = z.object(postBase);
export const updatePostSchema = z.object(postBase).partial();
export const upsertEbookProgressSchema = z.object({
  ebookId: uuid,
  studentId: optId,
  currentPage: z.number().int().min(0).max(1_000_000).optional(),
  totalPages: z.number().int().min(0).max(1_000_000).optional(),
});

// ── Chat ────────────────────────────────────────────────────────────────
export const getOrCreateConversationSchema = z.object({ otherUserId: uuid });
export const sendMessageSchema = z.object({
  content: z.string().max(8000).optional(),
  type: z.string().max(20).optional(),
  attachmentUrl: z.string().max(2000).nullable().optional(),
  attachmentName: z.string().max(255).nullable().optional(),
  attachmentSize: z.number().int().nonnegative().nullable().optional(),
});
export const editMessageSchema = z.object({ content: nonEmptyStr(8000) });
