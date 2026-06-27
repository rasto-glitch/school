import { z } from 'zod';
import { nonEmptyStr, uuid, hrFields } from './common';
import { strongPasswordSchema } from '../utils/passwordPolicy';

// User / account / role write schemas (Phase 1c) — the privilege- and
// credential-bearing admin endpoints. Same philosophy as accounting:
// reject malformed/oversized/wrong-typed input and strip unknown keys
// (so a client can't smuggle e.g. `role`, `is_active`, `school_id`,
// `password_changed_at` into a profile update), while leaving the
// controller's existing semantic rules (username prefix, archive
// linking, school scoping) untouched.

const role = z.enum(['parent', 'teacher', 'admin', 'driver', 'supervisor', 'reception', 'accountant']);
// Any password the admin types must satisfy the policy (utils/passwordPolicy.ts).
// Auto-generated defaults (Parent@123 / Teacher@123 / Driver@123 / restore-temp)
// are constructed in the controller and don't pass through this schema.
const password = strongPasswordSchema;
const username = z.string().trim().min(1).max(100);
// Email is a CONTACT field here (families share it) — never identity.
// Optional and lenient; '' / null tolerated.
const contactEmail = z.string().trim().max(254).nullable().optional();
const contactStr = (max = 200) => z.string().trim().max(max).nullable().optional();
const optionalId = z.union([uuid, z.literal('')]).nullable().optional();

export const userIdParam = z.object({ userId: uuid });
export const idParam = z.object({ id: uuid });

// Admin capability/clearance (Phase A). Capability keys are validated against
// the canonical list in constants/clearance.ts; the controller additionally
// enforces grant SCOPE (which the validator can't know — it depends on the
// granter). Loosely typed here as a bounded string array; unknown keys are
// dropped server-side by normalizeCapabilities().
const capabilityKey = z.string().trim().max(40);
const capabilities = z.array(capabilityKey).max(20);

export const createAccountSchema = z.object({
  // Account roles now use a single Full Name (split into first/last on save).
  // firstName/lastName kept optional for backward compatibility.
  fullName: nonEmptyStr(240).optional(),
  firstName: nonEmptyStr(120).optional(),
  lastName: nonEmptyStr(120).optional(),
  email: contactEmail,
  phone: contactStr(40),
  username,
  password,
  role,
  emergencyContact: contactStr(120),
  // Admin-only clearance grant at creation (ignored for other roles). Scope
  // is enforced in the controller against the granter's own clearance.
  isOwner: z.boolean().optional(),
  capabilities: capabilities.optional(),
  ...hrFields,
});

// Clearance panel: set a target admin's owner bit and/or capability set.
export const updateClearanceSchema = z.object({
  isOwner: z.boolean().optional(),
  capabilities: capabilities.optional(),
}).refine(b => b.isOwner !== undefined || b.capabilities !== undefined, {
  message: 'Provide isOwner and/or capabilities.',
});

export const updateAccountSchema = z.object({
  fullName: nonEmptyStr(240).optional(),
  firstName: nonEmptyStr(120).optional(),
  lastName: nonEmptyStr(120).optional(),
  email: contactEmail,
  phone: contactStr(40),
  username: username.optional(),
  isActive: z.boolean().optional(),
  emergencyContact: contactStr(120),
  ...hrFields,
});

// Employee professional-photo upload (migration 024). `id` is the
// profile-table id for teacher/driver/staff, the users id for the bare roles.
export const employeePhotoParams = z.object({
  role: z.enum(['teacher', 'driver', 'staff', 'supervisor', 'admin', 'reception', 'accountant']),
  id: uuid,
});

export const resetUserPasswordSchema = z.object({ newPassword: password });
export const reactivateUserSchema = z.object({ newPassword: password.optional() });

const vehicleType = z.enum(['bus', 'taxi']);

export const createTeacherSchema = z.object({
  fullName: nonEmptyStr(200),
  phoneNumber: contactStr(40),
  emergencyContact: contactStr(120),
  email: contactEmail,
  classIds: z.array(uuid).optional(),
  classId: optionalId,
  // username/password optional — the controller derives a username from
  // fullName and falls back to a default password when omitted.
  username: username.optional(),
  password: password.optional(),
  previousArchiveId: optionalId,
  ...hrFields,
});
export const updateTeacherSchema = z.object({
  fullName: nonEmptyStr(200).optional(),
  phoneNumber: contactStr(40),
  emergencyContact: contactStr(120),
  classIds: z.array(uuid).optional(),
  remove: z.boolean().optional(),
  ...hrFields,
});

export const createDriverSchema = z.object({
  fullName: nonEmptyStr(200),
  phoneNumber: contactStr(40),
  emergencyContact: contactStr(120),
  email: contactEmail,
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
  ...hrFields,
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
  ...hrFields,
});

export const updateParentSchema = z.object({
  residenceType: z.string().trim().max(40).nullable().optional(),
  blockNumber: z.string().trim().max(40).nullable().optional(),
});

// Employee document endpoints (migration 028). Reuses employeePhotoParams
// for :role/:id and idParam for :id. The multipart upload body is parsed
// by multer and re-validated inline in employeeDocs.controller.ts, so it
// has no zod schema here. PATCH and DELETE bodies do:
export const updateDocumentSchema = z.object({
  document_number: z.string().trim().max(120).nullable().optional(),
  issued_on: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]).optional(),
  expires_on: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]).optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export const voidDocumentSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
});
