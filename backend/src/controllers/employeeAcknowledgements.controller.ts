// Employee acknowledgements (Wave 2). Records that an employee has signed
// off on a school_policies row at a specific version. policy_key and
// policy_version denormalize the policy snapshot so an audit later can
// resolve "what did they sign?" even if the policy row is later modified.
//
// Optional signed_document_id links to a scan of the signature page in
// employee_documents.

import { Response } from 'express';
import { adminDb as supabase } from '../utils/db';
import type { AuthRequest } from '../middleware/auth';
import { toCC } from '../utils/transform';
import { safeDbErrorMessage, safeDbErrorStatus } from '../utils/dbErrors';
import { logAudit } from '../utils/audit';
import {
  ROLE_TO_OWNER_TYPE, type EmployeeRole, type OwnerType, verifyOwnerExists,
} from '../utils/employeeDocs';

function roleFromParams(req: AuthRequest): EmployeeRole | null {
  const r = String(req.params.role);
  return (ROLE_TO_OWNER_TYPE as Record<string, OwnerType>)[r] ? (r as EmployeeRole) : null;
}

// ── GET /admin/employees/:role/:id/acknowledgements ────────────────────────
// Returns one row per (policy_key, latest acknowledged version) joined with
// the active policy row so the UI can render Required / Done / Stale.

export async function listForEmployee(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const role = roleFromParams(req);
  if (!role) { res.status(400).json({ error: 'Unknown employee role' }); return; }
  const ownerId = String(req.params.id);
  const ownerType = ROLE_TO_OWNER_TYPE[role];

  if (!(await verifyOwnerExists(ownerType, ownerId, schoolId))) {
    res.status(404).json({ error: 'Employee not found' });
    return;
  }

  // Pull every required+active policy and the employee's latest ack per key.
  const [policiesRes, acksRes] = await Promise.all([
    supabase.from('school_policies')
      .select('id, policy_key, label, version, is_required, is_active, document_url')
      .eq('school_id', schoolId).eq('is_active', true)
      .order('policy_key', { ascending: true }).order('version', { ascending: false }),
    supabase.from('employee_acknowledgements')
      .select('id, policy_id, policy_key, policy_version, acknowledged_at, signed_document_id')
      .eq('school_id', schoolId).eq('owner_type', ownerType).eq('owner_id', ownerId)
      .order('acknowledged_at', { ascending: false }),
  ]);
  if (policiesRes.error) { res.status(safeDbErrorStatus(policiesRes.error)).json({ error: safeDbErrorMessage(policiesRes.error) }); return; }
  if (acksRes.error) { res.status(safeDbErrorStatus(acksRes.error)).json({ error: safeDbErrorMessage(acksRes.error) }); return; }

  // Active policies are deduped to the highest version per key (the query
  // already orders DESC so the first occurrence wins).
  const activeByKey = new Map<string, { id: string; label: string; version: number; isRequired: boolean; documentUrl: string | null }>();
  for (const p of (policiesRes.data ?? [])) {
    if (activeByKey.has(p.policy_key)) continue;
    activeByKey.set(p.policy_key, {
      id: p.id, label: p.label, version: p.version,
      isRequired: p.is_required, documentUrl: p.document_url,
    });
  }
  // Latest ack per key.
  const latestAckByKey = new Map<string, { id: string; policyVersion: number; acknowledgedAt: string; signedDocumentId: string | null }>();
  for (const a of (acksRes.data ?? [])) {
    if (latestAckByKey.has(a.policy_key)) continue;
    latestAckByKey.set(a.policy_key, {
      id: a.id, policyVersion: a.policy_version,
      acknowledgedAt: a.acknowledged_at, signedDocumentId: a.signed_document_id,
    });
  }

  // Build the status list — every active policy + any historical acks
  // for keys whose policy has been disabled (so they don't disappear).
  const items: {
    policyKey: string; label: string;
    activePolicyId: string | null; activeVersion: number | null; documentUrl: string | null;
    isRequired: boolean;
    status: 'unsigned' | 'signed' | 'stale';
    ack: { id: string; policyVersion: number; acknowledgedAt: string; signedDocumentId: string | null } | null;
  }[] = [];

  const seenKeys = new Set<string>();
  for (const [key, p] of activeByKey) {
    const ack = latestAckByKey.get(key) ?? null;
    const status = !ack ? 'unsigned' : ack.policyVersion < p.version ? 'stale' : 'signed';
    items.push({
      policyKey: key, label: p.label,
      activePolicyId: p.id, activeVersion: p.version, documentUrl: p.documentUrl,
      isRequired: p.isRequired,
      status, ack,
    });
    seenKeys.add(key);
  }
  for (const [key, ack] of latestAckByKey) {
    if (seenKeys.has(key)) continue;
    items.push({
      policyKey: key, label: key,
      activePolicyId: null, activeVersion: null, documentUrl: null,
      isRequired: false,
      status: 'signed', ack,
    });
  }

  res.json({ items });
}

// ── POST /admin/employees/:role/:id/acknowledgements ───────────────────────
// Records an acknowledgement of one policy (by policyId). Captures the
// caller's IP + UA + an optional signed_document_id (file in
// employee_documents).

export async function createForEmployee(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const role = roleFromParams(req);
  if (!role) { res.status(400).json({ error: 'Unknown employee role' }); return; }
  const ownerId = String(req.params.id);
  const ownerType = ROLE_TO_OWNER_TYPE[role];

  if (!(await verifyOwnerExists(ownerType, ownerId, schoolId))) {
    res.status(404).json({ error: 'Employee not found' });
    return;
  }

  const policyId = String(req.body?.policyId ?? '').trim();
  const signedDocumentId = req.body?.signedDocumentId ? String(req.body.signedDocumentId).trim() : null;
  if (!policyId) { res.status(400).json({ error: 'policyId is required' }); return; }

  const { data: policy, error: polErr } = await supabase
    .from('school_policies').select('id, policy_key, version, is_active')
    .eq('id', policyId).eq('school_id', schoolId).maybeSingle();
  if (polErr) { res.status(safeDbErrorStatus(polErr)).json({ error: safeDbErrorMessage(polErr) }); return; }
  if (!policy) { res.status(404).json({ error: 'Policy not found' }); return; }
  if (!policy.is_active) { res.status(400).json({ error: 'Policy is not active' }); return; }

  // Verify the signed document belongs to this school + employee.
  if (signedDocumentId) {
    const { data: doc } = await supabase
      .from('employee_documents')
      .select('id, owner_type, owner_id')
      .eq('id', signedDocumentId).eq('school_id', schoolId)
      .is('voided_at', null).maybeSingle();
    if (!doc) { res.status(400).json({ error: 'Signed document not found' }); return; }
    if (doc.owner_type !== ownerType || doc.owner_id !== ownerId) {
      res.status(400).json({ error: 'Signed document does not belong to this employee' });
      return;
    }
  }

  // Best-effort client IP from the proxy chain. PENTEST_FINDINGS H-3:
  // X-Forwarded-For is attacker-controllable, so this is for audit-record
  // value only, not for security decisions.
  const xff = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  const ip = xff || req.ip || null;
  const ua = String(req.headers['user-agent'] ?? '').slice(0, 500) || null;

  const insertRow = {
    school_id: schoolId,
    owner_type: ownerType, owner_id: ownerId,
    policy_id: policyId, policy_key: policy.policy_key, policy_version: policy.version,
    ip_address: ip, user_agent: ua,
    signed_document_id: signedDocumentId,
    recorded_by: userId,
  };

  // tenant-check-allow: insertRow.school_id sourced from req.user!.schoolId; INSERT has no .eq() shape.
  const { data, error } = await supabase
    .from('employee_acknowledgements').insert(insertRow)
    .select('id, policy_id, policy_key, policy_version, acknowledged_at, signed_document_id')
    .single();
  if (error || !data) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  await logAudit({
    req, entityType: 'employee_acknowledgement', entityId: data.id,
    action: 'create',
    after: {
      policy_key: data.policy_key, policy_version: data.policy_version,
      owner_type: ownerType, owner_id: ownerId,
    },
    label: 'acknowledgement_create',
  });

  res.status(201).json({ acknowledgement: toCC(data) });
}
