import { Response } from 'express';
import type { AuthRequest } from '../middleware/auth';
import { adminDb as supabase } from '../utils/db';
import { safeDbErrorMessage, safeDbErrorStatus } from '../utils/dbErrors';
import { logAudit } from '../utils/audit';
import { encryptPii, decryptPii } from '../utils/employeePiiCrypto';

// Student health / clinic records (migration 067). Clinic-internal; gated by
// the `health.manage` capability and school-scoped on every query. Sensitive
// free-text (conditions, meds, dietary notes, visit complaint/assessment/
// treatment) is field-level encrypted via employeePiiCrypto so only
// health.manage holders ever see the plaintext. Structured tags (blood type,
// allergy tags, immunizations, emergency contacts) stay queryable.

// Confirm the student belongs to this school. Returns full_name or null.
async function studentName(schoolId: string, studentId: string): Promise<string | null> {
  const { data } = await supabase
    .from('students').select('full_name')
    .eq('id', studentId).eq('school_id', schoolId).maybeSingle();
  return (data?.full_name as string | undefined) ?? null;
}

// ── GET /admin/health/students/:id/profile ──────────────────────────────────
export async function getProfile(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const studentId = req.params.id as string;
  const name = await studentName(schoolId, studentId);
  if (!name) { res.status(404).json({ error: 'Student not found.' }); return; }

  const { data, error } = await supabase
    .from('student_health_profiles').select('*')
    .eq('school_id', schoolId).eq('student_id', studentId).maybeSingle();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  if (!data) {
    res.json({
      studentId, studentName: name, exists: false,
      bloodType: null, allergyTags: [], immunizations: [], emergencyContacts: [],
      physicianName: '', physicianPhone: '',
      chronicConditions: '', medications: '', dietaryNotes: '', notes: '',
      updatedAt: null,
    });
    return;
  }

  let dec: { chronicConditions: string; medications: string; dietaryNotes: string; notes: string };
  try {
    dec = {
      chronicConditions: decryptPii(data.chronic_conditions_ct as string | null, schoolId) ?? '',
      medications: decryptPii(data.medications_ct as string | null, schoolId) ?? '',
      dietaryNotes: decryptPii(data.dietary_notes_ct as string | null, schoolId) ?? '',
      notes: decryptPii(data.notes_ct as string | null, schoolId) ?? '',
    };
  } catch { res.status(500).json({ error: 'Could not decrypt the health record.' }); return; }

  res.json({
    studentId, studentName: name, exists: true,
    bloodType: (data.blood_type as string | null) ?? null,
    allergyTags: (data.allergy_tags as string[] | null) ?? [],
    immunizations: data.immunizations ?? [],
    emergencyContacts: data.emergency_contacts ?? [],
    physicianName: (data.physician_name as string | null) ?? '',
    physicianPhone: (data.physician_phone as string | null) ?? '',
    ...dec,
    updatedAt: data.updated_at ?? null,
  });
}

interface ProfileBody {
  bloodType?: string | null;
  allergyTags?: string[];
  immunizations?: unknown;
  emergencyContacts?: unknown;
  physicianName?: string | null;
  physicianPhone?: string | null;
  chronicConditions?: string | null;
  medications?: string | null;
  dietaryNotes?: string | null;
  notes?: string | null;
}

// ── PUT /admin/health/students/:id/profile ──────────────────────────────────
export async function upsertProfile(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const studentId = req.params.id as string;
  const name = await studentName(schoolId, studentId);
  if (!name) { res.status(404).json({ error: 'Student not found.' }); return; }
  const b = req.body as ProfileBody;

  const row = {
    school_id: schoolId,
    student_id: studentId,
    blood_type: b.bloodType || null,
    allergy_tags: Array.isArray(b.allergyTags) ? b.allergyTags : [],
    immunizations: b.immunizations ?? [],
    emergency_contacts: b.emergencyContacts ?? [],
    physician_name: b.physicianName?.trim() || null,
    physician_phone: b.physicianPhone?.trim() || null,
    chronic_conditions_ct: encryptPii(b.chronicConditions, schoolId),
    medications_ct: encryptPii(b.medications, schoolId),
    dietary_notes_ct: encryptPii(b.dietaryNotes, schoolId),
    notes_ct: encryptPii(b.notes, schoolId),
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from('student_health_profiles')
    .upsert(row, { onConflict: 'school_id,student_id' });
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  await logAudit({
    req, entityType: 'student_health', entityId: studentId, action: 'update',
    before: null, after: { kind: 'profile' }, label: `Health profile · ${name}`,
  });
  res.json({ ok: true });
}

// Decrypt one visit row to the API shape.
function decVisit(v: Record<string, unknown>, schoolId: string) {
  return {
    id: v.id as string,
    studentId: v.student_id as string,
    visitedAt: v.visited_at as string,
    category: v.category as string,
    temperatureC: v.temperature_c as number | null,
    complaint: decryptPii(v.complaint_ct as string | null, schoolId) ?? '',
    assessment: decryptPii(v.assessment_ct as string | null, schoolId) ?? '',
    treatment: decryptPii(v.treatment_ct as string | null, schoolId) ?? '',
    outcome: v.outcome as string,
    parentNotified: v.parent_notified === true,
    parentNotifiedAt: (v.parent_notified_at as string | null) ?? null,
    createdAt: v.created_at as string,
    updatedAt: v.updated_at as string,
  };
}

// ── GET /admin/health/students/:id/visits ───────────────────────────────────
export async function listVisits(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const studentId = req.params.id as string;
  const name = await studentName(schoolId, studentId);
  if (!name) { res.status(404).json({ error: 'Student not found.' }); return; }

  const { data, error } = await supabase
    .from('student_health_visits').select('*')
    .eq('school_id', schoolId).eq('student_id', studentId)
    .order('visited_at', { ascending: false });
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  let visits;
  try { visits = (data ?? []).map(v => decVisit(v as Record<string, unknown>, schoolId)); }
  catch { res.status(500).json({ error: 'Could not decrypt the visit log.' }); return; }
  res.json({ studentId, studentName: name, visits });
}

interface VisitBody {
  visitedAt?: string;
  category: string;
  temperatureC?: number | null;
  complaint?: string | null;
  assessment?: string | null;
  treatment?: string | null;
  outcome: string;
  parentNotified?: boolean;
}

// ── POST /admin/health/students/:id/visits ──────────────────────────────────
export async function createVisit(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const studentId = req.params.id as string;
  const name = await studentName(schoolId, studentId);
  if (!name) { res.status(404).json({ error: 'Student not found.' }); return; }
  const b = req.body as VisitBody;
  const now = new Date().toISOString();

  const row = {
    school_id: schoolId,
    student_id: studentId,
    visited_at: b.visitedAt || now,
    category: b.category,
    temperature_c: b.temperatureC ?? null,
    complaint_ct: encryptPii(b.complaint, schoolId),
    assessment_ct: encryptPii(b.assessment, schoolId),
    treatment_ct: encryptPii(b.treatment, schoolId),
    outcome: b.outcome,
    parent_notified: b.parentNotified === true,
    parent_notified_at: b.parentNotified === true ? now : null,
    recorded_by: userId,
  };
  const { data, error } = await supabase
    .from('student_health_visits').insert(row).select('id').single();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  await logAudit({
    req, entityType: 'student_health', entityId: studentId, action: 'create',
    before: null, after: { kind: 'visit', visitId: data?.id, category: b.category, outcome: b.outcome },
    label: `Nurse visit · ${name}`,
  });
  res.status(201).json({ id: data?.id });
}

// ── PUT /admin/health/visits/:id ────────────────────────────────────────────
export async function updateVisit(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const visitId = req.params.id as string;
  const b = req.body as VisitBody;

  const { data: existing, error: exErr } = await supabase
    .from('student_health_visits')
    .select('id, student_id, parent_notified_at')
    .eq('id', visitId).eq('school_id', schoolId).maybeSingle();
  if (exErr) { res.status(safeDbErrorStatus(exErr)).json({ error: safeDbErrorMessage(exErr) }); return; }
  if (!existing) { res.status(404).json({ error: 'Visit not found.' }); return; }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    category: b.category,
    temperature_c: b.temperatureC ?? null,
    complaint_ct: encryptPii(b.complaint, schoolId),
    assessment_ct: encryptPii(b.assessment, schoolId),
    treatment_ct: encryptPii(b.treatment, schoolId),
    outcome: b.outcome,
    parent_notified: b.parentNotified === true,
    // Keep the original notified timestamp if it was already set; stamp now on
    // first notify; clear when un-notified.
    parent_notified_at: b.parentNotified === true
      ? ((existing.parent_notified_at as string | null) ?? now)
      : null,
    updated_at: now,
  };
  if (b.visitedAt) patch.visited_at = b.visitedAt;

  const { error } = await supabase
    .from('student_health_visits').update(patch)
    .eq('id', visitId).eq('school_id', schoolId);
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  await logAudit({
    req, entityType: 'student_health', entityId: existing.student_id as string, action: 'update',
    before: null, after: { kind: 'visit', visitId, category: b.category, outcome: b.outcome },
    label: 'Nurse visit',
  });
  res.json({ ok: true });
}

// ── DELETE /admin/health/visits/:id ─────────────────────────────────────────
export async function deleteVisit(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const visitId = req.params.id as string;

  const { data: existing, error: exErr } = await supabase
    .from('student_health_visits').select('id, student_id')
    .eq('id', visitId).eq('school_id', schoolId).maybeSingle();
  if (exErr) { res.status(safeDbErrorStatus(exErr)).json({ error: safeDbErrorMessage(exErr) }); return; }
  if (!existing) { res.status(404).json({ error: 'Visit not found.' }); return; }

  const { error } = await supabase
    .from('student_health_visits').delete()
    .eq('id', visitId).eq('school_id', schoolId);
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  await logAudit({
    req, entityType: 'student_health', entityId: existing.student_id as string, action: 'delete',
    before: { kind: 'visit', visitId }, after: null, label: 'Nurse visit removed',
  });
  res.json({ ok: true });
}
