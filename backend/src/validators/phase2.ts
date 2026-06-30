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
export const familyIdParam = z.object({ familyId: uuid });
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
  // Migration 041 + PR 2 — per-report opt-in for cross-subject handoff
  // visibility. Default false. School-level gate is checked at read time
  // (schools.features.teacher_report_handoff).
  sharedWithOtherTeachers: z.boolean().optional(),
});
// PR 2 — share toggle on an existing report. Only the report's author can
// flip it (enforced in the controller).
export const setReportShareSchema = z.object({
  shared: z.boolean(),
});
export const upsertGradeSchema = z.object({
  studentId: uuid,
  classId: uuid,
  subject: nonEmptyStr(160),
  gradingPeriod: z.string().max(60).optional(),
  marks: marksArr.optional(),
});
// Admin grade review: edit marks and/or the parent-visible note.
export const updateGradeSchema = z.object({
  marks: marksArr.optional(),
  adminNote: optText(2000),
});
// Admin grade review: release a batch of grades to parents.
export const releaseGradesSchema = z.object({
  ids: z.array(uuid).min(1).max(500),
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
    status: z.enum(['present', 'absent', 'late', 'excused']),
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
// Phase D — supervisor invites the parent of a student to a meeting.
export const createInviteSchema = z.object({
  studentId: uuid,
  inviteReason: optText(2000),
});
// Phase D — parent completes a supervisor invite into a real booking.
export const completeInviteSchema = z.object({
  reason: z.string().max(300).optional(),
  message: z.string().max(4000).optional(),
  requestedDate: z.string().max(40).optional(),
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
  status: attendanceStatus,
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
  // Phase D — reception assigns a specific admin when confirming a meeting.
  assignedAdminId: uuid.nullable().optional(),
});

// ── Driver ──────────────────────────────────────────────────────────────
export const updateLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  speed: z.number().nonnegative().max(1000).optional(),
  heading: z.number().min(0).max(360).optional(),
  isDriving: z.boolean().optional(),
  // Age of the GPS fix (ms) as measured on-device. Used to drop proximity
  // alerts off stale cached positions. Capped at 24h to reject garbage.
  fixAgeMs: z.number().nonnegative().max(86_400_000).optional(),
});
export const startDriveSchema = z.object({
  studentRides: z.array(z.object({
    studentId: uuid,
    rodeBus: z.boolean(),
    exclusionReason: z.enum(['school_absent', 'went_home_with_parents']).optional(),
    schoolAttendanceStatus: z.string().max(40).optional(),
  })).max(1000).optional(),
});

// ── Staff (employee) QR attendance (migration 063) ─────────────────────────
// Scan: the rotating kiosk token + the device's GPS fix. The controller re-
// validates the token signature/window, geofence and toggle.
export const staffAttendanceScanSchema = z.object({
  token: z.string().trim().min(1).max(512),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  // Reported GPS accuracy radius (m), optional — kept for future last-known fallback.
  accuracyMeters: z.number().nonnegative().max(100_000).optional(),
});

// "HH:MM" 24-hour clock.
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected time as HH:MM');
// Admin config: enable toggle, map pin + radius, school-wide schedule. Every
// field optional; the controller 400s if nothing was supplied.
// Premium: the feature is provisioned per school by the platform, so the admin
// only ever sends pin/schedule here — never an enable flag.
export const updateStaffAttendanceConfigSchema = z.object({
  geofence: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    radiusMeters: z.number().min(50).max(5000).optional(),
  }).optional(),
  schedule: z.object({
    startTime: hhmm,
    endTime: hhmm,
    lateGraceMinutes: z.number().int().min(0).max(180),
  }).optional(),
}).refine(
  d => d.geofence !== undefined || d.schedule !== undefined,
  { message: 'Nothing to update' },
);

// ── Staff attendance management (Phase 4 — admin `staff_attendance.manage`) ──
const leaveType = z.enum(['sick', 'vacation', 'personal', 'unpaid', 'official', 'other']);
// ISO-8601 instant (what new Date().toISOString() emits); accept an explicit
// offset too. `null` clears the timestamp in a correction.
const isoInstant = z.string().datetime({ offset: true });

// GET /staff-attendance/board?date=
export const staffAttendanceBoardQuery = z.object({ date: isoDate.optional() });

// GET /staff-attendance/leave?from=&to=  (both optional; controller defaults to current+future)
export const staffAttendanceLeaveQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
});

// GET /staff-attendance/export?from=&to=  (both required — bounded range)
export const staffAttendanceExportQuery = z.object({
  from: isoDate,
  to: isoDate,
}).refine(d => d.to >= d.from, { message: 'to must be on or after from' });

// PATCH /staff-attendance/:id — manual correction. `note` is mandatory (audit
// trail); at least one actual change must accompany it.
export const staffAttendanceCorrectionSchema = z.object({
  checkInAt: z.union([isoInstant, z.null()]).optional(),
  checkOutAt: z.union([isoInstant, z.null()]).optional(),
  status: z.enum(['open', 'closed', 'auto_closed']).optional(),
  isLate: z.boolean().optional(),
  resolveFlag: z.boolean().optional(),
  note: nonEmptyStr(1000),
}).refine(
  d => d.checkInAt !== undefined || d.checkOutAt !== undefined
    || d.status !== undefined || d.isLate !== undefined || d.resolveFlag !== undefined,
  { message: 'No correction fields supplied' },
);

// POST /staff-attendance/leave
export const staffAttendanceLeaveCreateSchema = z.object({
  userId: uuid,
  startDate: isoDate,
  endDate: isoDate,
  leaveType,
  note: optText(1000),
}).refine(d => d.endDate >= d.startDate, { message: 'End date must be on or after the start date' });

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
  // Phase 2 enforcement toggle. When true, eligible roles must enroll
  // in MFA at next login. The setter has to be an admin (route layer).
  mfaRequired: z.boolean().optional(),
}).passthrough();
export const yearTransitionSchema = z.object({
  newAcademicYear: nonEmptyStr(20),
  studentIdsToGraduate: z.array(uuid).max(20000).optional(),
  classAssignments: z.array(z.object({ studentId: uuid, classId: uuid })).max(20000).optional(),
});
export const createMarkTypeSchema = z.object({
  name: nonEmptyStr(120),
  appliesTo: z.enum(['report', 'grade', 'both']),
  maxValue: z.union([z.number(), z.string().max(12), z.null()]).optional(),
});
export const updateMarkTypeSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  appliesTo: z.enum(['report', 'grade', 'both']).optional(),
  maxValue: z.union([z.number(), z.string().max(12), z.null()]).optional(),
});
// GPA grading config: mode + the full band set (replace-all).
export const updateGradingConfigSchema = z.object({
  mode: z.enum(['scale', 'gpa', 'both']).optional(),
  bands: z.array(z.object({
    minPercent: z.number().min(0).max(100),
    letter: nonEmptyStr(8),
    gradePoint: z.number().min(0).max(10),
  })).max(40).optional(),
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

// SECURITY (H-1): attachmentUrl is rendered as <a href={...}> in the chat
// UI. Allowing a free-form string lets a chat-eligible user drop
// `javascript:...` or `https://attacker.example/phish.html` onto another
// user's message bubble. We restrict to https URLs whose host ends in
// `.supabase.co` AND whose path is under one of the storage buckets the
// chat-upload endpoint actually writes to. This shape is what
// /chat/upload returns:
//   https://<project>.supabase.co/storage/v1/object/public/chat-files/<key>
// Both web and mobile render the same field, so a server-side check is
// the right enforcement point.
const supabaseAttachmentUrl = z.string()
  .max(2000)
  .refine(
    (u) => {
      let parsed: URL;
      try { parsed = new URL(u); } catch { return false; }
      if (parsed.protocol !== 'https:') return false;
      if (!/\.supabase\.co$/i.test(parsed.hostname)) return false;
      // Allow chat-files (primary) and homework-attachments (used for
      // some shared upload UIs and avatar-derived links).
      if (!/^\/storage\/v1\/object\/(public|sign)\/(chat-files|homework-attachments)\//.test(parsed.pathname)) return false;
      return true;
    },
    { message: 'attachmentUrl must be a Supabase storage URL from the chat-upload endpoint' },
  );

export const sendMessageSchema = z.object({
  content: z.string().max(8000).optional(),
  type: z.string().max(20).optional(),
  attachmentUrl: supabaseAttachmentUrl.nullable().optional(),
  attachmentName: z.string().max(255).nullable().optional(),
  attachmentSize: z.number().int().nonnegative().nullable().optional(),
});
export const editMessageSchema = z.object({ content: nonEmptyStr(8000) });
// Phase D (chat extension) — a supervisor invites the chat's parent to a meeting.
export const sendChatInviteSchema = z.object({ reason: optText(2000) });
