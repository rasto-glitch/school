import { z } from 'zod';
import { nonEmptyStr, uuid } from './common';

// User / account / role write schemas (Phase 1c) — the privilege- and
// credential-bearing admin endpoints. Same philosophy as accounting:
// reject malformed/oversized/wrong-typed input and strip unknown keys
// (so a client can't smuggle e.g. `role`, `is_active`, `school_id`,
// `password_changed_at` into a profile update), while leaving the
// controller's existing semantic rules (username prefix, archive
// linking, school scoping) untouched.

const role = z.enum(['parent', 'teacher', 'admin', 'driver', 'supervisor', 'reception', 'accountant']);
const password = z.string().min(6, 'Password must be at least 6 characters').max(200);
const username = z.string().trim().min(1).max(100);
// Email is a CONTACT field here (families share it) — never identity.
// Optional and lenient; '' / null tolerated.
const contactEmail = z.string().trim().max(254).nullable().optional();
const contactStr = (max = 200) => z.string().trim().max(max).nullable().optional();
const optionalId = z.union([uuid, z.literal('')]).nullable().optional();

export const userIdParam = z.object({ userId: uuid });
export const idParam = z.object({ id: uuid });

export const createAccountSchema = z.object({
  firstName: nonEmptyStr(120),
  lastName: nonEmptyStr(120),
  email: contactEmail,
  phone: contactStr(40),
  username,
  password,
  role,
});

export const updateAccountSchema = z.object({
  firstName: nonEmptyStr(120).optional(),
  lastName: nonEmptyStr(120).optional(),
  email: contactEmail,
  phone: contactStr(40),
  username: username.optional(),
  isActive: z.boolean().optional(),
});

export const resetUserPasswordSchema = z.object({ newPassword: password });
export const reactivateUserSchema = z.object({ newPassword: password.optional() });

const vehicleType = z.enum(['bus', 'taxi']);

export const createTeacherSchema = z.object({
  fullName: nonEmptyStr(200),
  phoneNumber: contactStr(40),
  emergencyContact: contactStr(120),
  classIds: z.array(uuid).optional(),
  classId: optionalId,
  // username/password optional — the controller derives a username from
  // fullName and falls back to a default password when omitted.
  username: username.optional(),
  password: password.optional(),
  previousArchiveId: optionalId,
});
export const updateTeacherSchema = z.object({
  fullName: nonEmptyStr(200).optional(),
  phoneNumber: contactStr(40),
  emergencyContact: contactStr(120),
  classIds: z.array(uuid).optional(),
  remove: z.boolean().optional(),
});

export const createDriverSchema = z.object({
  fullName: nonEmptyStr(200),
  phoneNumber: contactStr(40),
  emergencyContact: contactStr(120),
  licenseNumber: contactStr(80),
  busNumber: contactStr(40),
  // Coerce: HTML number inputs deliver strings through the form layer.
  age: z.coerce.number().int().min(0).max(120).optional(),
  // username/password optional — same controller-side defaulting as teachers.
  username: username.optional(),
  password: password.optional(),
  studentIds: z.array(uuid).optional(),
  vehicleType: vehicleType.optional(),
  previousArchiveId: optionalId,
});
export const updateDriverSchema = z.object({
  fullName: nonEmptyStr(200).optional(),
  phoneNumber: contactStr(40),
  emergencyContact: contactStr(120),
  licenseNumber: contactStr(80),
  busNumber: contactStr(40),
  // Coerce: HTML number inputs deliver strings through the form layer.
  age: z.coerce.number().int().min(0).max(120).optional(),
  remove: z.boolean().optional(),
  studentIds: z.array(uuid).optional(),
  vehicleType: vehicleType.optional(),
});

export const updateParentSchema = z.object({
  residenceType: z.string().trim().max(40).nullable().optional(),
  blockNumber: z.string().trim().max(40).nullable().optional(),
});
