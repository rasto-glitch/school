// Termination workflow (Wave 2). The locked design is a guided flow:
// final review → termination letter upload → archive. This controller
// covers the middle step: records the action with the linked letter
// document and returns a `nextStep` payload telling the frontend which
// DELETE endpoint to call to perform the archive.
//
// Why split the action and the archive: the existing DELETE handlers
// (admin.controller's deleteTeacher / deleteDriver / deleteAccount,
// staff.controller's deleteStaff) carry years of role-specific snapshot
// logic — orphaning authored content, snapshotting transport rosters,
// special-casing the last-admin guard. Re-implementing that here would
// duplicate hundreds of lines. Keeping the archive call on the existing
// endpoint preserves correctness; the frontend orchestrates the two-step
// flow as a single user gesture.

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

// Map :role → the DELETE endpoint the frontend should hit next.
// teacher → /admin/teachers/:id   (admin.deleteTeacher)
// driver  → /admin/drivers/:id    (admin.deleteDriver)
// staff   → /admin/staff/:id      (staff.deleteStaff)
// the four account roles → /admin/accounts/:userId  (admin.deleteAccount;
//   that handler resolves the role-specific path internally).
function nextArchiveEndpoint(role: EmployeeRole, ownerId: string, userId: string | null): { path: string; method: 'DELETE' } {
  switch (role) {
    case 'teacher': return { path: `/api/admin/teachers/${ownerId}`,  method: 'DELETE' };
    case 'driver':  return { path: `/api/admin/drivers/${ownerId}`,   method: 'DELETE' };
    case 'staff':   return { path: `/api/admin/staff/${ownerId}`,     method: 'DELETE' };
    case 'supervisor': case 'admin': case 'reception': case 'accountant':
      // Bare account roles archive through the users-id endpoint.
      return { path: `/api/admin/accounts/${userId ?? ownerId}`, method: 'DELETE' };
  }
}

// ── POST /admin/employees/:role/:id/terminate ──────────────────────────────
// Body: { documentId, summary, occurredOn?, departureDate? }
// Validates the termination letter, logs the employee_actions row
// (kind='termination'), and returns the next step for the client to
// perform (the DELETE call). Frontend should issue both as a single user
// gesture — either succeeds together or the user retries.

export async function terminate(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId: actorId, username: actorName, role: actorRole } = req.user!;
  const role = roleFromParams(req);
  if (!role) { res.status(400).json({ error: 'Unknown employee role' }); return; }
  const ownerId = String(req.params.id);
  const ownerType = ROLE_TO_OWNER_TYPE[role];

  if (!(await verifyOwnerExists(ownerType, ownerId, schoolId))) {
    res.status(404).json({ error: 'Employee not found' });
    return;
  }

  const documentId = String(req.body?.documentId ?? '').trim();
  const summary = String(req.body?.summary ?? '').trim();
  const occurredOn = String(req.body?.occurredOn ?? new Date().toISOString().slice(0, 10));
  const departureDate = String(req.body?.departureDate ?? occurredOn);

  if (!documentId) { res.status(400).json({ error: 'documentId (termination letter) is required' }); return; }
  if (!summary) { res.status(400).json({ error: 'summary is required' }); return; }
  if (summary.length > 5000) { res.status(400).json({ error: 'summary too long' }); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredOn)) { res.status(400).json({ error: 'occurredOn must be YYYY-MM-DD' }); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(departureDate)) { res.status(400).json({ error: 'departureDate must be YYYY-MM-DD' }); return; }

  // Verify the termination letter exists, belongs to this employee, and is
  // not voided / infected.
  const { data: doc } = await supabase
    .from('employee_documents')
    .select('id, owner_type, owner_id, category, scan_status')
    .eq('id', documentId).eq('school_id', schoolId)
    .is('voided_at', null).maybeSingle();
  if (!doc) { res.status(400).json({ error: 'Termination letter document not found' }); return; }
  if (doc.scan_status === 'infected') { res.status(400).json({ error: 'Termination letter is quarantined' }); return; }
  if (doc.owner_type !== ownerType || doc.owner_id !== ownerId) {
    res.status(400).json({ error: 'Termination letter does not belong to this employee' });
    return;
  }

  // Append-only insert into employee_actions.
  const insertRow = {
    school_id: schoolId,
    owner_type: ownerType, owner_id: ownerId,
    kind: 'termination', occurred_on: occurredOn, summary,
    rating: null as number | null,
    document_id: documentId,
    created_by: actorId, created_by_name: actorName, created_by_role: actorRole,
  };

  // tenant-check-allow: insertRow.school_id sourced from req.user!.schoolId; INSERT has no .eq() shape.
  const { data: action, error } = await supabase
    .from('employee_actions').insert(insertRow)
    .select('id, kind, occurred_on, summary, document_id, created_at')
    .single();
  if (error || !action) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  await logAudit({
    req, entityType: 'employee_action', entityId: action.id,
    action: 'create',
    after: { kind: 'termination', occurred_on: occurredOn, owner_type: ownerType, owner_id: ownerId, document_id: documentId },
    label: 'termination_initiated',
  });

  // Resolve the next DELETE endpoint. For bare account roles the
  // archive endpoint takes the users id; fetch it.
  let userIdForArchive: string | null = null;
  if (['supervisor','admin','reception','accountant'].includes(role)) {
    userIdForArchive = ownerId; // owner_type='users' so ownerId IS the users id
  } else if (role === 'teacher' || role === 'driver' || role === 'staff') {
    // The frontend will DELETE the profile-table id endpoint — the bare role
    // path doesn't apply.
    userIdForArchive = null;
  }

  const next = nextArchiveEndpoint(role, ownerId, userIdForArchive);

  res.status(201).json({
    action: toCC(action),
    nextStep: {
      method: next.method,
      path: next.path,
      body: { reason: 'terminated', departureDate },
    },
    message: 'Termination recorded. Call the nextStep endpoint to complete the archive.',
  });
}
