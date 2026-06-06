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
import { closeCurrentEnrollment, openEnrollmentForCurrentYear } from '../utils/studentEnrollments';
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
  destinationSchoolId?: string;       // required when destinationKind=scholify
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
  const destinationKind = body.destinationKind === 'scholify' ? 'scholify' : 'non_scholify';

  // For Scholify destinations we need a concrete recipient school_id from
  // the platform directory. Self-targeting is rejected up-front.
  let destinationSchoolId: string | null = null;
  if (destinationKind === 'scholify') {
    if (!body.destinationSchoolId) {
      res.status(400).json({ error: 'destinationSchoolId is required for Scholify destinations' }); return;
    }
    if (body.destinationSchoolId === schoolId) {
      res.status(400).json({ error: 'Source and destination cannot be the same school' }); return;
    }
    const { data: dest } = await supabase
      .from('schools').select('id, name, features').eq('id', body.destinationSchoolId).single();
    if (!dest) { res.status(404).json({ error: 'Destination school not found in the platform directory' }); return; }
    if (!((dest as any).features as Record<string, boolean> | null)?.archive) {
      res.status(409).json({ error: 'Destination school does not have the archive/transfer feature enabled' }); return;
    }
    destinationSchoolId = body.destinationSchoolId;
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
    .in('status', ['pending_consent', 'consented', 'bundle_generated', 'awaiting_destination', 'destination_imported', 'destination_rejected']);
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
      destination_school_id: destinationSchoolId,
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

  // Completion gating: non_scholify can complete straight from
  // bundle_generated; scholify must wait until destination has imported.
  const isScholify = t.destination_kind === 'scholify';
  if (isScholify) {
    if (t.status !== 'destination_imported') {
      res.status(409).json({
        error: `Scholify transfer requires destination acceptance before archiving (current status: ${t.status})`,
      });
      return;
    }
  } else {
    if (t.status !== 'bundle_generated') {
      res.status(409).json({ error: `Transfer cannot be completed from status: ${t.status}` });
      return;
    }
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

  // Migration 041 — reports become part of the archive snapshot. Same shape
  // as admin.controller#buildStudentArchiveSnapshot for consistency on read.
  const { data: reports } = await supabase
    .from('reports')
    .select('academic_year, subject, class_id, class_name_snapshot, teacher_id, teacher_name_snapshot, attendance_notes, behavior_notes, marks, teacher_notes, quiz_marks, exam_marks, report_date, shared_with_other_teachers, created_at')
    .eq('student_id', t.student_id).eq('school_id', schoolId)
    .order('academic_year', { ascending: true })
    .order('created_at', { ascending: true });

  const reportsSnapshot = (reports || []).map((r: any) => ({
    academicYear: r.academic_year,
    subject: r.subject,
    classId: r.class_id ?? null,
    className: r.class_name_snapshot ?? null,
    teacherId: r.teacher_id ?? null,
    teacherName: r.teacher_name_snapshot ?? null,
    attendanceNotes: r.attendance_notes ?? null,
    behaviorNotes: r.behavior_notes ?? null,
    marks: Array.isArray(r.marks) ? r.marks : [],
    teacherNotes: r.teacher_notes ?? null,
    quizMarks: r.quiz_marks,
    examMarks: r.exam_marks,
    reportDate: r.report_date,
    sharedWithOtherTeachers: Boolean(r.shared_with_other_teachers),
    createdAt: r.created_at,
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
    p_reports: reportsSnapshot,
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

// ─── PHASE B — Scholify↔Scholify ──────────────────────────────────────
//
// Source-side: directory of eligible destination schools, send-to-
// destination, recall. Destination-side: incoming inbox, view, accept
// (with import), reject. State machine evolution:
//   bundle_generated → awaiting_destination → destination_imported → completed
//                                          ↘ destination_rejected ↗
//                                                                (back to bundle_generated on recall)

// Directory of eligible Scholify destinations. Lists every school in the
// platform that:
//   1. Is not the caller's own school.
//   2. Is active.
//   3. Has the `archive` feature enabled (required to accept transfers).
// Output is intentionally minimal — name + abbreviation + slug + id —
// so a directory leak reveals nothing sensitive about other tenants.
export async function listTransferDestinations(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { data } = await supabase
    .from('schools')
    .select('id, name, abbreviation, slug, features')
    .eq('is_active', true)
    .neq('id', schoolId)
    .order('name');
  const eligible = (data || []).filter(
    s => ((s as any).features as Record<string, boolean> | null)?.archive === true,
  );
  res.json(eligible.map(s => ({
    id: (s as any).id,
    name: (s as any).name,
    abbreviation: (s as any).abbreviation,
    slug: (s as any).slug,
  })));
}

// Source sends a bundle to the named destination. Requires the bundle to
// already be generated. After this the destination admin sees it in
// their inbox.
export async function sendToDestination(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const id = String(req.params.id);
  const { data: transfer } = await supabase
    .from('student_transfers').select('*').eq('id', id).eq('school_id', schoolId).single();
  if (!transfer) { res.status(404).json({ error: 'Transfer not found' }); return; }
  const t = transfer as any;
  if (t.destination_kind !== 'scholify') {
    res.status(409).json({ error: 'Only Scholify destinations can be sent in-platform' }); return;
  }
  if (!t.destination_school_id) {
    res.status(409).json({ error: 'Transfer is missing a Scholify destination' }); return;
  }
  if (t.status !== 'bundle_generated' && t.status !== 'destination_rejected') {
    res.status(409).json({ error: `Cannot send from status: ${t.status}` }); return;
  }
  const { data, error } = await supabase.from('student_transfers').update({
    status: 'awaiting_destination',
    // Clear any rejection state when re-sending.
    destination_rejected_at: null,
    destination_rejected_reason: null,
  }).eq('id', id).eq('school_id', schoolId).select().single();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  await logAudit({
    req, entityType: 'student_transfer', entityId: id, action: 'update',
    after: { _meta: { kind: 'sent_to_destination', destination_school_id: t.destination_school_id } } as Record<string, unknown>,
    label: t.student_name_snapshot, reason: 'Sent to destination',
  });
  res.json(toCC(data));
}

// Source recalls a transfer that the destination hasn't yet imported. The
// row goes back to bundle_generated so the source can re-send, cancel,
// or change destination.
export async function recallTransfer(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const id = String(req.params.id);
  const { data: transfer } = await supabase
    .from('student_transfers').select('*').eq('id', id).eq('school_id', schoolId).single();
  if (!transfer) { res.status(404).json({ error: 'Transfer not found' }); return; }
  const t = transfer as any;
  if (t.status !== 'awaiting_destination' && t.status !== 'destination_rejected') {
    res.status(409).json({ error: `Cannot recall from status: ${t.status}` }); return;
  }
  const { data, error } = await supabase.from('student_transfers').update({
    status: 'bundle_generated',
    destination_viewed_at: null,
  }).eq('id', id).eq('school_id', schoolId).select().single();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  await logAudit({
    req, entityType: 'student_transfer', entityId: id, action: 'update',
    after: { _meta: { kind: 'recalled' } } as Record<string, unknown>,
    label: t.student_name_snapshot, reason: 'Recalled by source',
  });
  res.json(toCC(data));
}

// Destination's incoming list. Authorisation scopes by destination_school_id
// (NOT school_id) — this is the only cross-tenant read in the system.
export async function listIncomingTransfers(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const status = (req.query.status as string | undefined) || undefined;
  let query = supabase
    .from('student_transfers')
    .select('id, status, student_name_snapshot, destination_kind, destination_school_id, destination_school_name, school_id, consent_signed_at, bundle_generated_at, destination_viewed_at, destination_accepted_at, destination_rejected_at, destination_rejected_reason, destination_imported_student_id, created_at')
    .eq('destination_school_id', schoolId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  // Enrich with the source school name so the inbox shows where the
  // student is coming from.
  const sourceIds = Array.from(new Set((data || []).map((r: any) => r.school_id)));
  const sourceNames: Record<string, string> = {};
  if (sourceIds.length) {
    const { data: srcs } = await supabase
      .from('schools').select('id, name').in('id', sourceIds);
    for (const s of srcs || []) sourceNames[(s as any).id] = (s as any).name;
  }
  res.json((data || []).map((r: any) => ({
    ...(toCC(r) as Record<string, unknown>),
    sourceSchoolName: sourceNames[r.school_id] || null,
  })));
}

// Destination views one incoming transfer. First view stamps
// destination_viewed_at so the source's outgoing list reflects activity.
export async function getIncomingTransfer(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId, username, role } = req.user!;
  const id = String(req.params.id);
  const { data: transfer } = await supabase
    .from('student_transfers').select('*').eq('id', id).eq('destination_school_id', schoolId).single();
  if (!transfer) { res.status(404).json({ error: 'Incoming transfer not found' }); return; }
  const t = transfer as any;

  // Stamp first-view metadata once. Idempotent for re-opens.
  if (!t.destination_viewed_at && t.status === 'awaiting_destination') {
    await supabase.from('student_transfers').update({
      destination_viewed_at: new Date().toISOString(),
      destination_admin_id: userId,
      destination_admin_name: username,
      destination_admin_role: role,
    }).eq('id', id).eq('destination_school_id', schoolId);
    await logAudit({
      req, entityType: 'student_transfer', entityId: id, action: 'read',
      after: { _meta: { kind: 'destination_viewed' } } as Record<string, unknown>,
      label: t.student_name_snapshot, reason: 'Destination first view',
    });
  }

  // Enrich with source school + the bundle (academic record) so the
  // detail UI has everything it needs to render the preview.
  const { data: sourceSchool } = await supabase
    .from('schools').select('name, abbreviation').eq('id', t.school_id).single();
  const built = await buildTransferBundle(t.school_id, id);
  res.json({
    transfer: toCC(transfer),
    sourceSchool: sourceSchool ? toCC(sourceSchool) : null,
    bundle: built?.bundle ?? null,
  });
}

// Destination accepts the transfer. Creates a new student row in the
// destination's school_id namespace + an enrollment row for the current
// year at the chosen class. Past years from the bundle are NOT
// materialised as live enrollments — they're the "external transcript"
// (queryable from the transfer row via destination_imported_student_id).
interface AcceptBody {
  classId?: string;
  parentLink?: 'create_new' | 'none';   // phase B prep: keep it minimal
}

export async function acceptIncomingTransfer(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId, username, role } = req.user!;
  const id = String(req.params.id);
  const body = (req.body || {}) as AcceptBody;

  const { data: transfer } = await supabase
    .from('student_transfers').select('*').eq('id', id).eq('destination_school_id', schoolId).single();
  if (!transfer) { res.status(404).json({ error: 'Incoming transfer not found' }); return; }
  const t = transfer as any;
  if (t.status !== 'awaiting_destination') {
    res.status(409).json({ error: `Cannot accept from status: ${t.status}` }); return;
  }
  if (!body.classId) {
    res.status(400).json({ error: 'classId is required to place the student' }); return;
  }
  // Verify the class belongs to this destination.
  const { data: cls } = await supabase
    .from('classes').select('id, name, grade_level').eq('id', body.classId).eq('school_id', schoolId).single();
  if (!cls) { res.status(404).json({ error: 'Target class not found in this school' }); return; }

  // Pull the source student so we copy identifying info to the new row.
  // Source data lives in school_id = t.school_id (the SOURCE school), not
  // schoolId (the destination calling this endpoint). This is the ONE
  // legitimate cross-school read in the system: the source admin
  // explicitly authorised it by issuing the transfer and the parent
  // signed consent for the destination to receive the data. The
  // authorisation chain is: transfer row + signed consent + destination
  // pulled via .eq('destination_school_id', schoolId) at the top of this
  // handler. student_id is a UUID sourced from that already-scoped row.
  // tenant-check-allow: cross-school import — student_id sourced from a transfer row already scoped by destination_school_id; t.student_id is the source-school student authorised by signed parental consent.
  const { data: srcStudent } = await supabase
    .from('students').select('*, parents(full_name, phone_number)').eq('id', t.student_id).single();
  if (!srcStudent) { res.status(404).json({ error: 'Source student no longer exists' }); return; }

  // Optionally create a placeholder parent row at destination. We never
  // auto-create a parent user account — that's a follow-up step the
  // destination admin can take from the Students screen.
  let parentId: string | null = null;
  if (body.parentLink === 'create_new' && (srcStudent as any).parents?.full_name) {
    const { data: newParent } = await supabase.from('parents').insert({
      school_id: schoolId,
      full_name: (srcStudent as any).parents.full_name,
      phone_number: (srcStudent as any).parents.phone_number ?? null,
    }).select('id').single();
    parentId = (newParent as any)?.id ?? null;
  }

  // Materialise the new student in destination's namespace.
  const { data: newStudent, error: newErr } = await supabase.from('students').insert({
    school_id: schoolId,
    full_name: (srcStudent as any).full_name,
    date_of_birth: (srcStudent as any).date_of_birth ?? null,
    phone_number: (srcStudent as any).phone_number ?? null,
    emergency_contact: (srcStudent as any).emergency_contact ?? null,
    home_address: (srcStudent as any).home_address ?? null,
    class_id: body.classId,
    parent_id: parentId,
  }).select().single();
  if (newErr || !newStudent) { res.status(safeDbErrorStatus(newErr)).json({ error: safeDbErrorMessage(newErr) }); return; }

  // Open an enrollment row for the current year at the chosen class.
  await openEnrollmentForCurrentYear({
    schoolId, studentId: (newStudent as any).id, classId: body.classId,
  });

  // Flip the transfer to destination_imported. Source can now archive.
  const { data: updatedTransfer, error: updErr } = await supabase.from('student_transfers').update({
    status: 'destination_imported',
    destination_accepted_at: new Date().toISOString(),
    destination_imported_student_id: (newStudent as any).id,
    destination_admin_id: userId,
    destination_admin_name: username,
    destination_admin_role: role,
  }).eq('id', id).eq('destination_school_id', schoolId).select().single();
  if (updErr) { res.status(safeDbErrorStatus(updErr)).json({ error: safeDbErrorMessage(updErr) }); return; }

  await logAudit({
    req, entityType: 'student_transfer', entityId: id, action: 'update',
    after: { _meta: {
      kind: 'destination_imported',
      new_student_id: (newStudent as any).id,
      class_id: body.classId,
    } } as Record<string, unknown>,
    label: t.student_name_snapshot, reason: 'Destination imported student',
  });
  await logAudit({
    req, entityType: 'student', entityId: (newStudent as any).id, action: 'create',
    after: newStudent as Record<string, unknown>,
    label: (newStudent as any).full_name,
    reason: `Imported via transfer ${id}`,
  });

  res.json({
    ok: true,
    transfer: toCC(updatedTransfer),
    newStudentId: (newStudent as any).id,
  });
}

// Destination rejects with a reason. The source's outgoing list reflects
// the rejection; source admin can recall + cancel or change destination.
export async function rejectIncomingTransfer(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId, username, role } = req.user!;
  const id = String(req.params.id);
  const reason = ((req.body || {}) as { reason?: string }).reason?.trim() || '';
  if (!reason) { res.status(400).json({ error: 'reason is required' }); return; }

  const { data: transfer } = await supabase
    .from('student_transfers').select('*').eq('id', id).eq('destination_school_id', schoolId).single();
  if (!transfer) { res.status(404).json({ error: 'Incoming transfer not found' }); return; }
  const t = transfer as any;
  if (t.status !== 'awaiting_destination') {
    res.status(409).json({ error: `Cannot reject from status: ${t.status}` }); return;
  }
  const { data, error } = await supabase.from('student_transfers').update({
    status: 'destination_rejected',
    destination_rejected_at: new Date().toISOString(),
    destination_rejected_reason: reason,
    destination_admin_id: userId,
    destination_admin_name: username,
    destination_admin_role: role,
  }).eq('id', id).eq('destination_school_id', schoolId).select().single();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  await logAudit({
    req, entityType: 'student_transfer', entityId: id, action: 'update',
    after: { _meta: { kind: 'destination_rejected', reason } } as Record<string, unknown>,
    label: t.student_name_snapshot, reason: 'Destination rejected transfer',
  });
  res.json(toCC(data));
}
