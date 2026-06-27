// Admin capability/clearance panel (Phase A). The Owner/HR surface for
// granting and revoking admin capabilities. This is where the old "HR
// Officers" promote/demote screen dissolves to — hr.read/hr.manage are now
// just two of the twelve capabilities.
//
// Visibility: Owner OR any hr.manage holder (see canViewClearancePanel).
// Grant scope: Owner grants anything (incl. the Owner bit + finance.read);
// an hr.manage holder may only toggle the HR∪Operations capabilities.
// Both rules are enforced server-side here — the UI merely disables what the
// viewer can't grant.

import { Response } from 'express';
import { adminDb as supabase } from '../utils/db';
import { safeDbErrorMessage, safeDbErrorStatus } from '../utils/dbErrors';
import { logAudit } from '../utils/audit';
import { notify } from '../utils/notify';
import type { AuthRequest } from '../middleware/auth';
import {
  CAPABILITIES,
  PRESETS,
  HR_GRANTABLE_CAPABILITIES,
  canGrantCapability,
  canGrantOwner,
  normalizeCapabilities,
  deriveHrOfficer,
  isPendingClearance,
  type Capability,
  type GranterContext,
} from '../constants/clearance';

const ALL_CAPS: Capability[] = [...CAPABILITIES];

function fullName(r: { first_name?: string | null; last_name?: string | null; username?: string }): string {
  return `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || r.username || '';
}

// GET /admin/clearance/admins — list every admin of the school with their
// clearance, plus the viewer's own grant scope so the UI can disable toggles.
export async function listClearance(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const viewer = req.clearance!; // attached by authorizeCapability-style guard

  const { data, error } = await supabase
    .from('users')
    .select('id, username, first_name, last_name, is_active, is_owner, admin_capabilities, is_hr_officer')
    .eq('school_id', schoolId).eq('role', 'admin')
    .order('first_name', { ascending: true });
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  const admins = (data ?? []).map(r => ({
    id: r.id,
    fullName: fullName(r),
    username: r.username,
    isActive: r.is_active,
    isOwner: r.is_owner === true,
    capabilities: Array.isArray(r.admin_capabilities) ? r.admin_capabilities : [],
    isHrOfficer: r.is_hr_officer === true, // legacy flag, shown until Phase B retires it
    pending: isPendingClearance(r),
  }));

  // What the viewer is allowed to toggle. Owner → everything (incl. owner
  // bit + finance.read); hr.manage holder → HR∪Operations only.
  const grantable: Capability[] = viewer.isOwner ? ALL_CAPS : HR_GRANTABLE_CAPABILITIES;

  res.json({
    admins,
    capabilities: ALL_CAPS,
    presets: PRESETS,
    viewer: {
      userId: req.user!.userId,
      isOwner: viewer.isOwner,
      grantableCapabilities: grantable,
      canGrantOwner: canGrantOwner(viewer),
    },
  });
}

// PUT /admin/clearance/admins/:userId — set a target admin's clearance.
// Body: { isOwner?: boolean, capabilities?: Capability[] }. Validates every
// change against the viewer's grant scope; rejects self-targeted changes and
// removal of the last Owner.
export async function updateClearance(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId: actorId, username: actorName } = req.user!;
  const viewer = req.clearance!;
  const targetId = String(req.params.userId);
  const body = req.body as { isOwner?: boolean; capabilities?: unknown };

  // No one edits their own clearance — prevents self-escalation AND
  // self-downgrade (which could orphan the panel or strip the last Owner).
  if (targetId === actorId) {
    res.status(400).json({ error: "You can't change your own clearance — ask another owner." });
    return;
  }

  const { data: target } = await supabase
    .from('users')
    .select('id, role, first_name, last_name, username, is_active, is_owner, admin_capabilities')
    .eq('id', targetId).eq('school_id', schoolId).maybeSingle();
  if (!target) { res.status(404).json({ error: 'User not found' }); return; }
  if (target.role !== 'admin') { res.status(400).json({ error: 'Only admin accounts have clearance.' }); return; }

  const currentIsOwner = target.is_owner === true;
  const currentCaps: Capability[] = Array.isArray(target.admin_capabilities)
    ? (target.admin_capabilities as string[]).filter(c => (ALL_CAPS as string[]).includes(c)) as Capability[]
    : [];

  // ── Resolve the requested Owner bit ──
  let finalIsOwner = currentIsOwner;
  if (typeof body.isOwner === 'boolean' && body.isOwner !== currentIsOwner) {
    if (!canGrantOwner(viewer)) {
      res.status(403).json({ error: 'Only an owner can change owner status.' });
      return;
    }
    finalIsOwner = body.isOwner;
  }

  // Last-owner guard: never let the school drop to zero owners.
  if (currentIsOwner && !finalIsOwner) {
    const { count } = await supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('school_id', schoolId).eq('role', 'admin').eq('is_owner', true);
    if ((count ?? 0) <= 1) {
      res.status(400).json({ error: 'This is the last owner — promote another owner first.' });
      return;
    }
  }

  // ── Resolve the requested capability set ──
  let finalCaps: Capability[];
  if (finalIsOwner) {
    // Owners hold everything; store the full set for display consistency.
    finalCaps = [...ALL_CAPS];
  } else if (body.capabilities !== undefined) {
    const requested = normalizeCapabilities(body.capabilities);
    // Validate scope on the symmetric difference: every capability being
    // ADDED or REMOVED must be one the viewer can grant. (A no-op cap the
    // viewer can't touch but isn't changing is left untouched.)
    const cur = new Set<string>(currentCaps);
    const req2 = new Set<string>(requested);
    const changed = [...new Set<string>([...currentCaps, ...requested])]
      .filter(c => cur.has(c) !== req2.has(c)) as Capability[];
    const ctx: GranterContext = viewer;
    const outOfScope = changed.find(c => !canGrantCapability(ctx, c));
    if (outOfScope) {
      res.status(403).json({ error: `You can't grant or revoke the "${outOfScope}" capability.` });
      return;
    }
    finalCaps = requested;
  } else {
    finalCaps = currentCaps; // owner→non-owner with no caps body shouldn't happen, but keep current
  }

  // Persist. is_hr_officer is kept in sync with the hr.* capabilities so the
  // legacy PII gate (utils/employeeDocs.ts) keeps working in Phase A — see
  // deriveHrOfficer.
  const { error: updErr } = await supabase
    .from('users')
    .update({
      is_owner: finalIsOwner,
      admin_capabilities: finalCaps,
      is_hr_officer: deriveHrOfficer(finalIsOwner, finalCaps),
    })
    .eq('id', targetId).eq('school_id', schoolId);
  if (updErr) { res.status(safeDbErrorStatus(updErr)).json({ error: safeDbErrorMessage(updErr) }); return; }

  // Audit — choose the most specific label.
  const ownerChanged = finalIsOwner !== currentIsOwner;
  const added = finalCaps.filter(c => !currentCaps.includes(c));
  const removed = currentCaps.filter(c => !finalCaps.includes(c));
  const label = ownerChanged
    ? 'owner.set'
    : removed.length > added.length ? 'clearance.revoke' : 'clearance.grant';
  await logAudit({
    req, entityType: 'admin_clearance', entityId: targetId, action: 'update',
    before: { is_owner: currentIsOwner, admin_capabilities: currentCaps },
    after: { is_owner: finalIsOwner, admin_capabilities: finalCaps },
    label,
  });

  // Tell the target their access changed (best-effort).
  const targetName = fullName(target);
  await notify({
    schoolId, userId: targetId,
    title: 'Your access was updated',
    message: `${actorName} updated your administrator access.`,
    type: 'clearance_updated',
    relatedId: targetId,
  }).catch(() => { /* notification failure must not fail the grant */ });

  res.json({
    ok: true,
    user: {
      id: targetId,
      fullName: targetName,
      isOwner: finalIsOwner,
      capabilities: finalCaps,
      pending: isPendingClearance({ is_owner: finalIsOwner, admin_capabilities: finalCaps }),
    },
  });
}
