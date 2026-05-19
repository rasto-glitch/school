import { z } from 'zod';

// Phase 2.1 — multipart (multer) routes.
//
// IMPORTANT: multipart/form-data text fields ALWAYS arrive as strings, and
// the file itself is on req.file (handled by multer, not here). So every
// field is modeled as a bounded string and the schema is `.passthrough()`:
//  - no coercion/retyping that could reject a legitimately-stringified value
//  - no key stripping that could drop a multer field the controller reads
// The win here is presence/length bounds (reject absurd or oversized text),
// not the mass-assignment defense — far less of a vector on file-upload
// form posts, where controllers read explicit named fields and never
// spread the body. `validate()` must be wired AFTER the multer middleware.

const s = (max: number) => z.string().max(max).optional();

export const createAnnouncementSchema = z.object({
  title: s(300),
  content: s(20_000),
  targetAudience: s(100),
  linkUrl: s(2000),
  imageUrl: s(2000),
}).passthrough();

export const createHomeworkSchema = z.object({
  classId: s(64),
  title: s(300),
  description: s(20_000),
  dueDate: s(40),
  subject: s(160),
}).passthrough();

export const createAssignmentSchema = z.object({
  classId: s(64),
  studentId: s(64),
  title: s(300),
  description: s(20_000),
  dueDate: s(40),
  subject: s(160),
}).passthrough();

export const uploadEbookSchema = z.object({
  title: s(300),
  subject: s(160),
  author: s(200),
  description: s(20_000),
  classId: s(64),
}).passthrough();

export const bugReportSchema = z.object({
  description: s(20_000),
}).passthrough();
