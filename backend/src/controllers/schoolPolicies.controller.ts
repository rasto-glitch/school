// Per-school acknowledgement policies (Wave 2). Admin manages a registry
// of policies (code of conduct, child protection, handbook, ...). Each
// policy carries a version; bumping content creates a NEW version row, and
// the previous row stays active until the admin disables it. This way
// historical acknowledgements remain anchored to the exact text the
// employee signed.

import { Response } from 'express';
import { adminDb as supabase } from '../utils/db';
import type { AuthRequest } from '../middleware/auth';
import { toCC } from '../utils/transform';
import { safeDbErrorMessage, safeDbErrorStatus } from '../utils/dbErrors';
import { logAudit } from '../utils/audit';

interface PolicyInput {
  policyKey: string;
  label: string;
  body?: string | null;
  documentUrl?: string | null;
  isRequired?: boolean;
  isActive?: boolean;
}

function validate(input: unknown): { ok: true; v: PolicyInput } | { ok: false; error: string } {
  const i = input as Record<string, unknown> | null;
  if (!i || typeof i !== 'object') return { ok: false, error: 'Invalid policy' };
  const key = typeof i.policyKey === 'string' ? i.policyKey.trim().toLowerCase() : '';
  if (!/^[a-z][a-z0-9_]{1,60}$/.test(key)) return { ok: false, error: 'policyKey must be lowercase alphanumeric/underscore (max 60)' };
  const label = typeof i.label === 'string' ? i.label.trim() : '';
  if (!label) return { ok: false, error: 'Label is required' };
  if (label.length > 200) return { ok: false, error: 'Label too long' };
  const body = typeof i.body === 'string' ? i.body : null;
  if (body && body.length > 200_000) return { ok: false, error: 'Body too long' };
  const documentUrl = typeof i.documentUrl === 'string' ? i.documentUrl.trim() || null : null;
  if (documentUrl && documentUrl.length > 2000) return { ok: false, error: 'documentUrl too long' };
  return {
    ok: true,
    v: {
      policyKey: key, label,
      body, documentUrl,
      isRequired: i.isRequired === undefined ? true : !!i.isRequired,
      isActive:   i.isActive   === undefined ? true : !!i.isActive,
    },
  };
}

// ── GET /admin/school-policies ─────────────────────────────────────────────
export async function listPolicies(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const { data, error } = await supabase
    .from('school_policies')
    .select('id, policy_key, label, version, body, document_url, is_required, is_active, created_at, updated_at')
    .eq('school_id', schoolId)
    .order('policy_key', { ascending: true })
    .order('version', { ascending: false });
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json({ policies: toCC(data) });
}

// ── POST /admin/school-policies ────────────────────────────────────────────
// Creates a new policy (version=1) OR a new version of an existing policy
// when policyKey matches one already on file. Body/document changes bump
// the version; metadata-only edits (label/required/active) go through
// PATCH instead.

export async function createOrBumpPolicy(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const r = validate(req.body);
  if (!r.ok) { res.status(400).json({ error: r.error }); return; }

  // Find the highest version for this key (if any).
  const { data: existing } = await supabase
    .from('school_policies')
    .select('id, version, body, document_url')
    .eq('school_id', schoolId).eq('policy_key', r.v.policyKey)
    .order('version', { ascending: false }).limit(1);

  const top = existing?.[0];
  const newVersion = top ? top.version + 1 : 1;

  // If the body/url didn't actually change, return the existing top row —
  // accidental re-clicks don't pile up version rows.
  if (top && (top.body ?? null) === (r.v.body ?? null) && (top.document_url ?? null) === (r.v.documentUrl ?? null)) {
    res.json({ policy: toCC(top), reused: true });
    return;
  }

  const insertRow = {
    school_id: schoolId,
    policy_key: r.v.policyKey,
    label: r.v.label,
    version: newVersion,
    body: r.v.body,
    document_url: r.v.documentUrl,
    is_required: r.v.isRequired,
    is_active: r.v.isActive,
    created_by: userId,
  };

  // tenant-check-allow: insertRow.school_id sourced from req.user!.schoolId; INSERT has no .eq() shape.
  const { data, error } = await supabase
    .from('school_policies').insert(insertRow)
    .select('id, policy_key, label, version, body, document_url, is_required, is_active, created_at, updated_at')
    .single();
  if (error || !data) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  await logAudit({
    req, entityType: 'school_policy', entityId: data.id,
    action: 'create', after: { policy_key: data.policy_key, version: data.version, label: data.label },
    label: 'policy_create',
  });

  res.status(201).json({ policy: toCC(data) });
}

// ── PATCH /admin/school-policies/:id ───────────────────────────────────────
// Metadata-only: label, is_required, is_active. To change body/document_url,
// post a new version via createOrBumpPolicy.

export async function updatePolicyMeta(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const id = String(req.params.id);
  const i = (req.body ?? {}) as Record<string, unknown>;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (i.label !== undefined) {
    const l = String(i.label).trim();
    if (!l) { res.status(400).json({ error: 'Label cannot be empty' }); return; }
    if (l.length > 200) { res.status(400).json({ error: 'Label too long' }); return; }
    patch.label = l;
  }
  if (i.isRequired !== undefined) patch.is_required = !!i.isRequired;
  if (i.isActive   !== undefined) patch.is_active   = !!i.isActive;
  if (Object.keys(patch).length === 1) {
    res.status(400).json({ error: 'No changes provided' }); return;
  }

  const { data: before } = await supabase
    .from('school_policies').select('id, label, is_required, is_active')
    .eq('id', id).eq('school_id', schoolId).maybeSingle();
  if (!before) { res.status(404).json({ error: 'Policy not found' }); return; }

  const { data, error } = await supabase
    .from('school_policies').update(patch)
    .eq('id', id).eq('school_id', schoolId)
    .select('id, policy_key, label, version, body, document_url, is_required, is_active, created_at, updated_at')
    .single();
  if (error || !data) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  await logAudit({
    req, entityType: 'school_policy', entityId: id,
    action: 'update', before, after: patch, label: 'policy_update_meta',
  });

  res.json({ policy: toCC(data) });
}

// ── DELETE /admin/school-policies/:id ──────────────────────────────────────
// Hard delete only allowed when no acknowledgements reference this policy.
// Otherwise, mark it inactive via PATCH.
export async function deletePolicy(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  const id = String(req.params.id);

  const { count } = await supabase
    .from('employee_acknowledgements')
    .select('id', { count: 'exact', head: true })
    .eq('school_id', schoolId).eq('policy_id', id);
  if ((count ?? 0) > 0) {
    res.status(409).json({ error: 'Policy has acknowledgements — disable it instead of deleting' });
    return;
  }

  const { data: before } = await supabase
    .from('school_policies').select('id, policy_key, label, version')
    .eq('id', id).eq('school_id', schoolId).maybeSingle();
  if (!before) { res.status(404).json({ error: 'Policy not found' }); return; }

  const { error } = await supabase
    .from('school_policies').delete()
    .eq('id', id).eq('school_id', schoolId);
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  await logAudit({
    req, entityType: 'school_policy', entityId: id,
    action: 'delete', before, label: 'policy_delete',
  });

  res.json({ ok: true });
}
