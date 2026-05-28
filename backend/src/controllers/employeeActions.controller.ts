// Employee actions log (Wave 2). Append-only timeline of HR events:
// reviews, warnings, commendations, role/contract changes, and the
// terminal termination event. The DB trigger blocks UPDATE/DELETE — once
// logged, the row is the legal record. Wrongful-termination claims hinge
// on this trail.

import { Response } from 'express';
import { adminDb as supabase } from '../utils/db';
import type { AuthRequest } from '../middleware/auth';
import { toCC } from '../utils/transform';
import { safeDbErrorMessage, safeDbErrorStatus } from '../utils/dbErrors';
import { logAudit } from '../utils/audit';
import {
  ROLE_TO_OWNER_TYPE, type EmployeeRole, type OwnerType, verifyOwnerExists,
} from '../utils/employeeDocs';

const KINDS = ['review','warning','commendation','role_change','contract_change','termination'] as const;
type Kind = typeof KINDS[number];

function roleFromParams(req: AuthRequest): EmployeeRole | null {
  const r = String(req.params.role);
  return (ROLE_TO_OWNER_TYPE as Record<string, OwnerType>)[r] ? (r as EmployeeRole) : null;
}

interface ActionInput {
  kind: Kind;
  occurredOn: string;            // YYYY-MM-DD
  summary: string;
  rating?: number | null;        // 1..5, reviews only
  documentId?: string | null;    // optional employee_documents id
}

function validate(input: unknown): { ok: true; v: ActionInput } | { ok: false; error: string } {
  const i = input as Record<string, unknown> | null;
  if (!i || typeof i !== 'object') return { ok: false, error: 'Invalid action' };
  const kind = typeof i.kind === 'string' ? i.kind.trim() : '';
  if (!(KINDS as readonly string[]).includes(kind)) return { ok: false, error: 'Invalid kind' };
  const occurredOn = typeof i.occurredOn === 'string' ? i.occurredOn.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredOn)) return { ok: false, error: 'occurredOn must be YYYY-MM-DD' };
  const summary = typeof i.summary === 'string' ? i.summary.trim() : '';
  if (!summary) return { ok: false, error: 'Summary is required' };
  if (summary.length > 5000) return { ok: false, error: 'Summary too long' };
  let rating: number | null = null;
  if (i.rating !== undefined && i.rating !== null && i.rating !== '') {
    const r = Number(i.rating);
    if (!Number.isFinite(r) || r < 1 || r > 5 || !Number.isInteger(r)) {
      return { ok: false, error: 'rating must be 1..5' };
    }
    rating = r;
  }
  if (rating !== null && kind !== 'review') {
    return { ok: false, error: 'rating only applies to reviews' };
  }
  const documentId = typeof i.documentId === 'string' && i.documentId ? i.documentId : null;
  return { ok: true, v: { kind: kind as Kind, occurredOn, summary, rating, documentId } };
}

// ── GET /admin/employees/:role/:id/actions ─────────────────────────────────
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

  const { data, error } = await supabase
    .from('employee_actions')
    .select('id, kind, occurred_on, summary, rating, document_id, created_by, created_by_name, created_by_role, created_at')
    .eq('school_id', schoolId).eq('owner_type', ownerType).eq('owner_id', ownerId)
    .order('occurred_on', { ascending: false }).order('created_at', { ascending: false });
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  res.json({ actions: toCC(data) });
}

// ── POST /admin/employees/:role/:id/actions ────────────────────────────────
// Append-only insert. The DB trigger blocks UPDATE/DELETE.
//
// The termination kind goes through the dedicated termination workflow at
// employeeTermination.controller — calling this endpoint with kind=
// 'termination' is rejected so the archive flow can't be bypassed.

export async function createForEmployee(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId, username, role: actorRole } = req.user!;
  const role = roleFromParams(req);
  if (!role) { res.status(400).json({ error: 'Unknown employee role' }); return; }
  const ownerId = String(req.params.id);
  const ownerType = ROLE_TO_OWNER_TYPE[role];

  if (!(await verifyOwnerExists(ownerType, ownerId, schoolId))) {
    res.status(404).json({ error: 'Employee not found' });
    return;
  }

  const r = validate(req.body);
  if (!r.ok) { res.status(400).json({ error: r.error }); return; }
  if (r.v.kind === 'termination') {
    res.status(400).json({ error: 'Use the termination workflow endpoint to terminate an employee' });
    return;
  }

  if (r.v.documentId) {
    const { data: doc } = await supabase
      .from('employee_documents')
      .select('id, owner_type, owner_id').eq('id', r.v.documentId).eq('school_id', schoolId)
      .is('voided_at', null).maybeSingle();
    if (!doc) { res.status(400).json({ error: 'Linked document not found' }); return; }
    if (doc.owner_type !== ownerType || doc.owner_id !== ownerId) {
      res.status(400).json({ error: 'Linked document does not belong to this employee' });
      return;
    }
  }

  const insertRow = {
    school_id: schoolId,
    owner_type: ownerType, owner_id: ownerId,
    kind: r.v.kind, occurred_on: r.v.occurredOn, summary: r.v.summary,
    rating: r.v.rating, document_id: r.v.documentId,
    created_by: userId, created_by_name: username, created_by_role: actorRole,
  };

  // tenant-check-allow: insertRow.school_id sourced from req.user!.schoolId; INSERT has no .eq() shape.
  const { data, error } = await supabase
    .from('employee_actions').insert(insertRow)
    .select('id, kind, occurred_on, summary, rating, document_id, created_by_name, created_by_role, created_at')
    .single();
  if (error || !data) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  await logAudit({
    req, entityType: 'employee_action', entityId: data.id,
    action: 'create',
    after: { kind: data.kind, occurred_on: data.occurred_on, owner_type: ownerType, owner_id: ownerId },
    label: 'action_create',
  });

  res.status(201).json({ action: toCC(data) });
}
