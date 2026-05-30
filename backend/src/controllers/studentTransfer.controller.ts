// Cross-school student transfer — source-side wizard endpoints
// (migration 032, phase A). Drives the consent-capture → bundle-export
// → archive-as-transferred flow that produces a JSON + PDF pack the
// parent walks to a non-Scholify destination.
//
// State machine (also enforced in the DB CHECK):
//
//   pending_consent  →  consented  →  bundle_generated  →  completed
//                                  ↘                   ↘
//                                                       cancelled (terminal)
//                                   (cancelled allowed before completed)
//
// Phase B will add a destination-side import path; for now everything
// here is source-side.

import { Response } from 'express';
import { adminDb as supabase } from '../utils/db';
import type { AuthRequest } from '../middleware/auth';
import { safeDbErrorMessage, safeDbErrorStatus } from '../utils/dbErrors';
import { toCC } from '../utils/transform';
import { logAudit } from '../utils/audit';
import { hasArchiveFeature } from '../utils/employeeArchive';
import { closeCurrentEnrollment } from '../utils/studentEnrollments';
import {
  buildTransferBundle,
  hashConsent,
  consentText,
  CONSENT_TEXT_VERSION,
} from '../utils/transferBundle';
import { streamTransferBundlePdf } from '../utils/transferBundlePdf';
import { pickLang } from '../utils/archivePdfShared';

// ─── List + read ──────────────────────────────────────────────────────

export async function listTransfers(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const status = (req.query.status as string | undefined) || undefined;
  let query = supabase
    .from('student_transfers')
    .select('*')
    .eq('school_id', schoolId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json((data || []).map(toCC));
}

export async function getTransfer(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const id = String(req.params.id);
  const { data, error } = await supabase
    .from('student_transfers').select('*').eq('id', id).eq('school_id', schoolId).single();
  if (error || !data) { res.status(404).json({ error: 'Transfer not found' }); return; }
  res.json(toCC(data));
}

// Returns the proposed consent text + the school + student names for the
// wizard's preview step. Read-only.
export async function getTransferConsentPreview(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const id = String(req.params.id);
  const { data: transfer } = await supabase
    .from('student_transfers')
    .select('id, student_id, student_name_snapshot, destination_school_name')
    .eq('id', id).eq('school_id', schoolId).single();
  if (!transfer) { res.status(404).json({ error: 'Transfer not found' }); return; }

  const { data: school } = await supabase.from('schools').select('name').eq('id', schoolId).single();
  const sourceName = school?.name || '';
  const destName = (transfer as any).destination_school_name || '';

  res.json({
    sourceSchoolName: sourceName,
    destinationSchoolName: destName,
    studentName: (transfer as any).student_name_snapshot,
    textVersion: CONSENT_TEXT_VERSION,
    text: consentText(sourceName, destName),
  });
}

// ─── Start ────────────────────────────────────────────────────────────

interface StartBody {
  studentId?: string;
  destinationKind?: 'non_scholify' | 'scholify';
  destinationSchoolName?: string;
  destinationCity?: string;
  destinationCountry?: string;
  destinationContact?: string;
}

export async function startTransfer(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId, username, role } = req.user!;
  const body = (req.body || {}) as StartBody;

  if (!body.studentId || typeof body.studentId !== 'string') {
    res.status(400).json({ error: 'studentId is required' }); return;
  }
  if (!body.destinationSchoolName || !body.destinationSchoolName.trim()) {
    res.status(400).json({ error: 'destinationSchoolName is required' }); return;
  }
  // Phase A only supports non_scholify; reject scholify so callers don't
  // think the Scholify↔Scholify path is wired.
  const destinationKind = body.destinationKind === 'scholify' ? 'scholify' : 'non_scholify';
  if (destinationKind === 'scholify') {
    res.status(400).json({
      error: 'Scholify↔Scholify transfers are not yet available. Phase B (master.elkurdi.co identity DB) is required.',
    });
    return;
  }

  const { data: student } = await supabase
    .from('students').select('id, full_name')
    .eq('id', body.studentId).eq('school_id', schoolId).single();
  if (!student) { res.status(404).json({ error: 'Student not found' }); return; }

  // Block a second pending transfer for the same student.
  const { data: existing } = await supabase
    .from('student_transfers')
    .select('id, status')
    .eq('school_id', schoolId)
    .eq('student_id', body.studentId)
    .in('status', ['pending_consent', 'consented', 'bundle_generated']);
  if (existing && existing.length > 0) {
    res.status(409).json({ error: 'A transfer is already in progress for this student. Cancel it before starting another.' });
    return;
  }

  const { data, error } = await supabase
    .from('student_transfers').insert({
      school_id: schoolId,
      student_id: body.studentId,
      student_name_snapshot: (student as any).full_name,
      destination_kind: destinationKind,
      destination_school_name: body.destinationSchoolName.trim(),
      destination_city: body.destinationCity?.trim() || null,
      destination_country: body.destinationCountry?.trim() || null,
      destination_contact: body.destinationContact?.trim() || null,
      status: 'pending_consent',
      initiated_by: userId,
      initiated_by_name: username,
      initiated_by_role: role,
    })
    .select().single();
  if (error || !data) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  await logAudit({
    req, entityType: 'student_transfer', entityId: (data as any).id, action: 'create',
    after: data as Record<string, unknown>,
    label: (student as any).full_name, reason: 'Transfer started',
  });
  res.status(201).json(toCC(data));
}

// ─── Capture consent ──────────────────────────────────────────────────

interface ConsentBody {
  parentName?: string;
  witnessName?: string;
  witnessRole?: string;
}

export async function captureConsent(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const id = String(req.params.id);
  const body = (req.body || {}) as ConsentBody;
  if (!body.parentName || !body.parentName.trim()) {
    res.status(400).json({ error: 'parentName is required' }); return;
  }
  if (!body.witnessName || !body.witnessName.trim()) {
    res.status(400).json({ error: 'witnessName is required' }); return;
  }

  const { data: transfer } = await supabase
    .from('student_transfers').select('*').eq('id', id).eq('school_id', schoolId).single();
  if (!transfer) { res.status(404).json({ error: 'Transfer not found' }); return; }
  if ((transfer as any).status !== 'pending_consent') {
    res.status(409).json({ error: 'Consent has already been captured or the transfer is no longer pending.' });
    return;
  }

  const signedAt = new Date().toISOString();
  const consentHash = hashConsent({
    transferId: (transfer as any).id,
    studentId: (transfer as any).student_id,
    studentName: (transfer as any).student_name_snapshot,
    parentName: body.parentName.trim(),
    textVersion: CONSENT_TEXT_VERSION,
    destinationSchoolName: (transfer as any).destination_school_name,
    signedAt,
    witnessName: body.witnessName.trim(),
    witnessRole: (body.witnessRole || '').trim(),
  });

  const { data, error } = await supabase
    .from('student_transfers')
    .update({
      consent_parent_name: body.parentName.trim(),
      consent_text_version: CONSENT_TEXT_VERSION,
      consent_signed_at: signedAt,
      consent_witness_name: body.witnessName.trim(),
      consent_witness_role: body.witnessRole?.trim() || null,
      consent_hash: consentHash,
      status: 'consented',
    })
    .eq('id', id).eq('school_id', schoolId).select().single();
  if (error || !data) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  await logAudit({
    req, entityType: 'student_transfer', entityId: id, action: 'update',
    after: { _meta: { kind: 'consent_captured', consent_hash: consentHash } } as Record<string, unknown>,
    label: (transfer as any).student_name_snapshot, reason: 'Consent captured',
  });
  res.json(toCC(data));
}

// ─── Build bundle (JSON download) ─────────────────────────────────────

export async function downloadBundleJson(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const id = String(req.params.id);

  const { data: transfer } = await supabase
    .from('student_transfers').select('*').eq('id', id).eq('school_id', schoolId).single();
  if (!transfer) { res.status(404).json({ error: 'Transfer not found' }); return; }
  const t = transfer as any;
  if (t.status !== 'consented' && t.status !== 'bundle_generated') {
    res.status(409).json({ error: `Bundle can only be generated after consent is captured (current status: ${t.status}).` });
    return;
  }

  const built = await buildTransferBundle(schoolId, id);
  if (!built) { res.status(404).json({ error: 'Transfer student is no longer available' }); return; }

  // Persist signature + hash + generated_at on the first generation so the
  // archive flow has them to attach. Regenerations after that update the
  // timestamp but keep the same signature (because the input is the same).
  if (t.status === 'consented') {
    await supabase.from('student_transfers').update({
      bundle_signature: built.signed.integrity.signature,
      bundle_sha256: built.signed.integrity.sha256,
      bundle_generated_at: built.signed.integrity.signedAt,
      status: 'bundle_generated',
    }).eq('id', id).eq('school_id', schoolId);
    await logAudit({
      req, entityType: 'student_transfer', entityId: id, action: 'update',
      after: { _meta: {
        kind: 'bundle_generated',
        sha256: built.signed.integrity.sha256,
        key_id: built.signed.integrity.keyId,
      } } as Record<string, unknown>,
      label: t.student_name_snapshot, reason: 'Bundle generated',
    });
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="transfer-${id}.json"`);
  res.send(built.canonical
    ? Buffer.from(JSON.stringify(built.signed, null, 2), 'utf8')
    : Buffer.from(JSON.stringify(built.signed), 'utf8'));
}

// ─── Build bundle (PDF download) ──────────────────────────────────────

export async function downloadBundlePdf(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const id = String(req.params.id);
  const lang = pickLang(req.query.lang);

  const { data: transfer } = await supabase
    .from('student_transfers').select('*').eq('id', id).eq('school_id', schoolId).single();
  if (!transfer) { res.status(404).json({ error: 'Transfer not found' }); return; }
  const t = transfer as any;
  if (t.status !== 'consented' && t.status !== 'bundle_generated' && t.status !== 'completed') {
    res.status(409).json({ error: `PDF can only be generated after consent is captured (current status: ${t.status}).` });
    return;
  }

  const built = await buildTransferBundle(schoolId, id);
  if (!built) { res.status(404).json({ error: 'Transfer student is no longer available' }); return; }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="transfer-${id}.pdf"`);
  await streamTransferBundlePdf(built.signed, lang, res);
}

// ─── Complete (archive student as transferred) ────────────────────────

export async function completeTransfer(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId, username, role } = req.user!;
  const id = String(req.params.id);

  if (!(await hasArchiveFeature(schoolId))) {
    res.status(403).json({ error: 'Archive feature is required for transfers' }); return;
  }

  const { data: transfer } = await supabase
    .from('student_transfers').select('*').eq('id', id).eq('school_id', schoolId).single();
  if (!transfer) { res.status(404).json({ error: 'Transfer not found' }); return; }
  const t = transfer as any;
  if (t.status !== 'bundle_generated') {
    res.status(409).json({ error: `Transfer cannot be completed from status: ${t.status}` });
    return;
  }
  if (!t.student_id) {
    res.status(409).json({ error: 'Source student no longer exists' });
    return;
  }

  // Build a final-time snapshot we'll pass to archive_student_atomic. This
  // mirrors what admin.archiveStudent does; we recompute it here so the
  // archive carries the transfer's signature/hash in audit context.
  const { data: student } = await supabase
    .from('students')
    .select('*, parents(full_name, phone_number)')
    .eq('id', t.student_id).eq('school_id', schoolId).single();
  if (!student) { res.status(404).json({ error: 'Source student no longer exists' }); return; }

  // Close current enrollment as 'transferred' before snapshot so the
  // enrollment_history row reflects the terminal state.
  await closeCurrentEnrollment({
    schoolId, studentId: t.student_id, status: 'transferred',
    endedOn: new Date().toISOString().slice(0, 10),
  });

  // Load the freshly-closed enrollment history into a snapshot.
  const { data: enrollmentRows } = await supabase
    .from('student_enrollments')
    .select('academic_year, class_id, class_name_snapshot, grade_level, status, started_on, ended_on')
    .eq('student_id', t.student_id).eq('school_id', schoolId)
    .order('academic_year');
  const enrollmentHistory = (enrollmentRows || []).map((e: any) => ({
    academicYear: String(e.academic_year),
    gradeLevel: e.grade_level ? String(e.grade_level) : '(unknown)',
    classId: e.class_id ?? null,
    className: e.class_name_snapshot ?? null,
    status: e.status ? String(e.status) : 'enrolled',
    startedOn: e.started_on ?? null,
    endedOn: e.ended_on ?? null,
  }));

  // Pull released grades (for the archive's grades JSONB).
  const { data: grades } = await supabase
    .from('grades')
    .select('academic_year, grading_period, subject, marks, daily_grade, quiz_grade, monthly_exam_grade, term_exam_grade, class_id, classes(name)')
    .eq('student_id', t.student_id).eq('school_id', schoolId)
    .order('academic_year');

  const gradesSnapshot = (grades || []).map((g: any) => ({
    academicYear: g.academic_year,
    gradingPeriod: g.grading_period,
    subject: g.subject,
    classId: g.class_id ?? null,
    className: g.classes?.name ?? null,
    marks: Array.isArray(g.marks) ? g.marks : [],
    dailyGrade: g.daily_grade,
    quizGrade: g.quiz_grade,
    monthlyExamGrade: g.monthly_exam_grade,
    termExamGrade: g.term_exam_grade,
  }));

  // Archive atomically (insert + delete student). Pass transfer_id at
  // INSERT (migration 033) so the link is set before the append-only
  // trigger applies — UPDATEing it post-insert would be blocked.
  const departureDate = new Date().toISOString().slice(0, 10);
  const { data: archiveId, error: rpcErr } = await supabase.rpc('archive_student_atomic', {
    p_school_id: schoolId,
    p_student_id: t.student_id,
    p_full_name: (student as any).full_name,
    p_date_of_birth: (student as any).date_of_birth ?? null,
    p_enrollment_date: (student as any).created_at ? String((student as any).created_at).split('T')[0] : null,
    p_departure_date: departureDate,
    p_reason: 'transferred',
    p_parent_full_name: (student as any).parents?.full_name ?? null,
    p_parent_phone: (student as any).parents?.phone_number ?? null,
    p_classes_attended: [],
    p_enrollment_history: enrollmentHistory,
    p_grades: gradesSnapshot,
    p_payment_history: [],
    p_archived_by: userId,
    p_archived_by_name: username,
    p_archived_by_role: role,
    p_original_parent_id: (student as any).parent_id ?? null,
    p_transfer_id: id,
  });
  if (rpcErr) { res.status(safeDbErrorStatus(rpcErr)).json({ error: safeDbErrorMessage(rpcErr) }); return; }
  const archiveUuid = (archiveId as unknown as string) || null;

  // Mark the transfer completed.
  await supabase.from('student_transfers').update({
    status: 'completed',
    completed_at: new Date().toISOString(),
    student_id: null,         // live row is gone; null this out to avoid stale FK semantics
  }).eq('id', id).eq('school_id', schoolId);

  await logAudit({
    req, entityType: 'student_transfer', entityId: id, action: 'update',
    after: { _meta: {
      kind: 'transfer_completed',
      archived_student_id: archiveUuid,
      sha256: t.bundle_sha256,
    } } as Record<string, unknown>,
    label: t.student_name_snapshot, reason: 'Transfer completed (student archived)',
  });
  await logAudit({
    req, entityType: 'student', entityId: t.student_id, action: 'delete',
    before: student as Record<string, unknown>, label: (student as any).full_name,
    reason: `Archived via transfer to ${t.destination_school_name}`,
  });

  res.json({ ok: true, archivedStudentId: archiveUuid, transferId: id });
}

// ─── Cancel ───────────────────────────────────────────────────────────

export async function cancelTransfer(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const id = String(req.params.id);
  const reason = ((req.body || {}) as { reason?: string }).reason?.trim() || null;

  const { data: transfer } = await supabase
    .from('student_transfers').select('*').eq('id', id).eq('school_id', schoolId).single();
  if (!transfer) { res.status(404).json({ error: 'Transfer not found' }); return; }
  const t = transfer as any;
  if (t.status === 'completed' || t.status === 'cancelled') {
    res.status(409).json({ error: `Transfer is ${t.status}; cannot cancel` }); return;
  }

  const { data, error } = await supabase.from('student_transfers').update({
    status: 'cancelled',
    cancelled_reason: reason,
  }).eq('id', id).eq('school_id', schoolId).select().single();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  await logAudit({
    req, entityType: 'student_transfer', entityId: id, action: 'update',
    after: { _meta: { kind: 'transfer_cancelled', reason } } as Record<string, unknown>,
    label: t.student_name_snapshot, reason: 'Transfer cancelled',
  });
  res.json(toCC(data));
}

