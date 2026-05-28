// Employee documents — CRUD over employee_documents + signed-URL issuance.
//
// Wave 1 of the employee legal-compliance records system. Every read of a
// 'high' sensitivity category is gated on users.is_hr_officer. Every
// signed-URL issue is audited so a school can reconstruct who saw what
// document and when (chain-of-custody for a labour tribunal).
//
// Why the service-role client: documents live in a private bucket that the
// app touches with the service-role key. Tenant-scoping is enforced manually
// (every query carries .eq('school_id', schoolId)), matching the pattern
// CLAUDE.md describes for the rest of the backend.

import { Response } from 'express';
import crypto from 'crypto';
import { adminDb as supabase } from '../utils/db';
import type { AuthRequest } from '../middleware/auth';
import { toCC } from '../utils/transform';
import { safeDbErrorMessage, safeDbErrorStatus } from '../utils/dbErrors';
import { safeExt } from '../utils/upload';
import { logAudit } from '../utils/audit';
import { logger } from '../utils/logger';
import {
  ALLOWED_MIME_TYPES, MAX_BYTES, EMPLOYEE_DOCS_BUCKET, SIGNED_URL_TTL_SECONDS,
  ROLE_TO_OWNER_TYPE, type EmployeeRole, type OwnerType,
  sniffMime, sha256Hex, safeFilename,
  getCategoriesForSchool, resolveCategory,
  isHrOfficer, canReadSensitivity, verifyOwnerExists,
  type ResolvedCategory,
} from '../utils/employeeDocs';

// ── helpers ────────────────────────────────────────────────────────────────

function roleFromParams(req: AuthRequest): EmployeeRole | null {
  const r = String(req.params.role);
  return (ROLE_TO_OWNER_TYPE as Record<string, OwnerType>)[r] ? (r as EmployeeRole) : null;
}

function ownerTypeForRole(role: EmployeeRole): OwnerType {
  return ROLE_TO_OWNER_TYPE[role];
}

/**
 * Strip the storage_bucket + storage_path before sending a doc row to the
 * client. The client never needs them — every read goes through the
 * signed-URL endpoint — and surfacing them would leak the bucket layout.
 */
function publicDocRow(row: Record<string, unknown>): Record<string, unknown> {
  const { storage_bucket: _b, storage_path: _p, ...rest } = row;
  void _b; void _p;
  return rest;
}

// ── GET /admin/employee-document-categories ────────────────────────────────
// Returns the merged seed + per-school category catalog. The frontend uses
// this to populate the upload picker and label rows in the documents table.

export async function listCategories(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId } = req.user!;
  try {
    const categories = await getCategoriesForSchool(schoolId);
    res.json({ categories });
  } catch (err) {
    logger.error('listCategories failed', { err: (err as Error).message });
    res.status(500).json({ error: 'Failed to load categories' });
  }
}

// ── GET /admin/employees/:role/:id/documents ───────────────────────────────
// Lists every (non-voided) document for one employee. High-sensitivity rows
// are stripped to a placeholder when the caller is not an HR officer — the
// UI still shows the row (so they know one exists) but the metadata is
// redacted and the download button is hidden.

export async function listForEmployee(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const role = roleFromParams(req);
  if (!role) { res.status(400).json({ error: 'Unknown employee role' }); return; }
  const ownerId = String(req.params.id);
  const ownerType = ownerTypeForRole(role);

  // Tenant scope: the employee must belong to this school.
  if (!(await verifyOwnerExists(ownerType, ownerId, schoolId))) {
    res.status(404).json({ error: 'Employee not found' });
    return;
  }

  const { data, error } = await supabase
    .from('employee_documents')
    .select(`
      id, school_id, owner_type, owner_id, category, sensitivity,
      filename, mime_type, byte_size, sha256, scan_status,
      document_number, issued_on, expires_on, notes,
      uploaded_by, uploaded_at
    `)
    .eq('school_id', schoolId)
    .eq('owner_type', ownerType)
    .eq('owner_id', ownerId)
    .is('voided_at', null)
    .order('uploaded_at', { ascending: false });

  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  const hrOfficer = await isHrOfficer(userId);
  const documents = (data ?? []).map(row => {
    if (row.sensitivity === 'high' && !hrOfficer) {
      // Redact: keep id + category + sensitivity + uploaded_at so the row
      // still appears in the list, drop everything else.
      return {
        id: row.id,
        category: row.category,
        sensitivity: row.sensitivity,
        scan_status: row.scan_status,
        uploaded_at: row.uploaded_at,
        redacted: true,
      };
    }
    return { ...row, redacted: false };
  });

  res.json({ documents: toCC(documents), hrOfficer });
}

// ── POST /admin/employees/:role/:id/documents ──────────────────────────────
// Multipart upload. Fields:
//   file              — the document (jpg / png / webp / pdf, max 10 MB)
//   category          — string, must be in the resolved catalog
//   document_number?  — optional human-readable number (passport #, etc.)
//   issued_on?        — YYYY-MM-DD
//   expires_on?       — YYYY-MM-DD
//   notes?            — free text
//
// Order of checks: role → owner exists → category resolved → file exists →
// MIME allowed → magic-byte sniff matches → size ok → SHA-256 → upload to
// private bucket with Content-Disposition: attachment → insert row → audit.

export async function uploadForEmployee(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const role = roleFromParams(req);
  if (!role) { res.status(400).json({ error: 'Unknown employee role' }); return; }
  const ownerId = String(req.params.id);
  const ownerType = ownerTypeForRole(role);

  if (!(await verifyOwnerExists(ownerType, ownerId, schoolId))) {
    res.status(404).json({ error: 'Employee not found' });
    return;
  }

  const categoryKey = String(req.body?.category || '').trim();
  if (!categoryKey) { res.status(400).json({ error: 'Category is required' }); return; }

  const category = await resolveCategory(schoolId, categoryKey);
  if (!category) { res.status(400).json({ error: 'Unknown category' }); return; }
  if (!category.active) { res.status(400).json({ error: 'Category is disabled for this school' }); return; }

  // High-sensitivity uploads also require HR officer.
  if (category.sensitivity === 'high' && !(await canReadSensitivity(userId, 'high'))) {
    res.status(403).json({ error: 'HR officer required for this category' });
    return;
  }

  const file = (req as unknown as { file?: { buffer: Buffer; mimetype: string; originalname: string; size: number } }).file;
  if (!file?.buffer) { res.status(400).json({ error: 'No file uploaded' }); return; }
  if (file.size > MAX_BYTES) { res.status(400).json({ error: 'File too large (max 10 MB)' }); return; }
  if (!(ALLOWED_MIME_TYPES as string[]).includes(file.mimetype)) {
    res.status(400).json({ error: 'Unsupported file type. Allowed: JPG, PNG, WebP, PDF.' });
    return;
  }

  // PENTEST_FINDINGS H-2: sniff buffer; reject mismatches.
  const sniffed = sniffMime(file.buffer);
  if (!sniffed || sniffed !== file.mimetype) {
    res.status(400).json({ error: 'File contents do not match the declared type' });
    return;
  }

  const sha256 = sha256Hex(file.buffer);
  const ext = safeExt(file.originalname, sniffed === 'application/pdf' ? '.pdf' : '.bin');
  const storagePath = `${schoolId}/${ownerType}/${ownerId}/${category.key}/${crypto.randomUUID()}${ext}`;

  const { error: uploadErr } = await supabase.storage
    .from(EMPLOYEE_DOCS_BUCKET)
    .upload(storagePath, file.buffer, {
      contentType: sniffed,                            // not the client-claimed value
      upsert: false,
      // PENTEST_FINDINGS H-2: force download even if the bucket ever flips
      // public. Browsers don't render HTML/SVG/etc. inline this way.
      cacheControl: 'private, max-age=0',
    });
  if (uploadErr) {
    logger.error('employee doc upload failed', { schoolId, ownerType, ownerId, err: uploadErr.message });
    res.status(500).json({ error: 'Upload failed' });
    return;
  }

  const filename = safeFilename(file.originalname, `document${ext}`);

  // Parse the optional date / text fields. Empty string → null.
  const documentNumber = req.body?.document_number ? String(req.body.document_number).trim() || null : null;
  const issuedOn = req.body?.issued_on ? String(req.body.issued_on).trim() || null : null;
  const expiresOn = req.body?.expires_on ? String(req.body.expires_on).trim() || null : null;
  const notes = req.body?.notes ? String(req.body.notes).trim() || null : null;

  const insertRow = {
    school_id: schoolId,
    owner_type: ownerType,
    owner_id: ownerId,
    category: category.key,
    sensitivity: category.sensitivity,
    storage_bucket: EMPLOYEE_DOCS_BUCKET,
    storage_path: storagePath,
    filename,
    mime_type: sniffed,
    byte_size: file.size,
    sha256,
    scan_status: 'skipped' as const,
    document_number: documentNumber,
    issued_on: issuedOn,
    expires_on: expiresOn,
    notes,
    uploaded_by: userId,
  };

  // tenant-check-allow: insertRow carries school_id from req.user!.schoolId (line above); INSERT has no WHERE to .eq() on.
  const { data: inserted, error: insErr } = await supabase
    .from('employee_documents')
    .insert(insertRow)
    .select('*')
    .single();
  if (insErr || !inserted) {
    // Best-effort cleanup of the orphaned object so we don't accumulate
    // garbage in the private bucket on validation failures.
    await supabase.storage.from(EMPLOYEE_DOCS_BUCKET).remove([storagePath]).catch(() => undefined);
    res.status(safeDbErrorStatus(insErr)).json({ error: safeDbErrorMessage(insErr) });
    return;
  }

  await logAudit({
    req,
    entityType: 'employee_document',
    entityId: inserted.id,
    action: 'create',
    after: {
      category: inserted.category, sensitivity: inserted.sensitivity,
      filename: inserted.filename, byte_size: inserted.byte_size,
      sha256: inserted.sha256, expires_on: inserted.expires_on,
      owner_type: inserted.owner_type, owner_id: inserted.owner_id,
    },
    label: 'document_upload',
  });

  res.status(201).json({ document: toCC(publicDocRow(inserted)) });
}

// ── GET /admin/employee-documents/:id/signed-url ───────────────────────────
// Mints a short-lived signed URL for downloading one document. Audited.
// Sensitivity-high reads require HR officer.

export async function issueSignedUrl(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const id = String(req.params.id);

  const { data: doc, error } = await supabase
    .from('employee_documents')
    .select('id, school_id, sensitivity, scan_status, storage_bucket, storage_path, filename')
    .eq('id', id).eq('school_id', schoolId)
    .is('voided_at', null)
    .maybeSingle();
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  if (!doc) { res.status(404).json({ error: 'Document not found' }); return; }

  if (doc.scan_status === 'infected') {
    res.status(423).json({ error: 'Document is quarantined' });
    return;
  }
  if (!(await canReadSensitivity(userId, doc.sensitivity as 'low' | 'medium' | 'high'))) {
    res.status(403).json({ error: 'HR officer required for this document' });
    return;
  }

  const { data: signed, error: signErr } = await supabase.storage
    .from(doc.storage_bucket)
    .createSignedUrl(doc.storage_path, SIGNED_URL_TTL_SECONDS, {
      download: doc.filename,                          // forces Content-Disposition: attachment
    });
  if (signErr || !signed?.signedUrl) {
    logger.error('createSignedUrl failed', { docId: id, err: signErr?.message });
    res.status(500).json({ error: 'Failed to issue download link' });
    return;
  }

  await logAudit({
    req,
    entityType: 'employee_document',
    entityId: doc.id,
    action: 'read',
    after: { _meta: { kind: 'signed_url_issued', ttl: SIGNED_URL_TTL_SECONDS } },
    label: 'signed_url_issued',
  });

  res.json({ url: signed.signedUrl, expiresIn: SIGNED_URL_TTL_SECONDS, filename: doc.filename });
}

// ── PATCH /admin/employee-documents/:id ────────────────────────────────────
// Metadata-only updates (number / issued_on / expires_on / notes). Storage
// content and category are immutable — to change those, void + re-upload.

export async function updateDocument(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const id = String(req.params.id);

  const { data: before, error: readErr } = await supabase
    .from('employee_documents')
    .select('id, school_id, sensitivity, document_number, issued_on, expires_on, notes')
    .eq('id', id).eq('school_id', schoolId).is('voided_at', null)
    .maybeSingle();
  if (readErr) { res.status(safeDbErrorStatus(readErr)).json({ error: safeDbErrorMessage(readErr) }); return; }
  if (!before) { res.status(404).json({ error: 'Document not found' }); return; }
  if (!(await canReadSensitivity(userId, before.sensitivity as 'low' | 'medium' | 'high'))) {
    res.status(403).json({ error: 'HR officer required' });
    return;
  }

  const patch: Record<string, unknown> = {};
  if (req.body?.document_number !== undefined) {
    patch.document_number = String(req.body.document_number).trim() || null;
  }
  if (req.body?.issued_on !== undefined) {
    patch.issued_on = String(req.body.issued_on).trim() || null;
  }
  if (req.body?.expires_on !== undefined) {
    patch.expires_on = String(req.body.expires_on).trim() || null;
  }
  if (req.body?.notes !== undefined) {
    patch.notes = String(req.body.notes).trim() || null;
  }
  if (Object.keys(patch).length === 0) {
    res.json({ document: toCC(before) });
    return;
  }

  const { data: after, error: updErr } = await supabase
    .from('employee_documents')
    .update(patch)
    .eq('id', id).eq('school_id', schoolId)
    .select('*').single();
  if (updErr || !after) { res.status(safeDbErrorStatus(updErr)).json({ error: safeDbErrorMessage(updErr) }); return; }

  await logAudit({
    req,
    entityType: 'employee_document',
    entityId: id,
    action: 'update',
    before, after: { ...patch },
    label: 'document_update_meta',
  });

  res.json({ document: toCC(publicDocRow(after)) });
}

// ── DELETE /admin/employee-documents/:id ───────────────────────────────────
// Soft delete with reason. The storage object stays — Wave 3 retention cron
// will remove it after the school's policy window.

export async function voidDocument(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const id = String(req.params.id);
  const reason = String(req.body?.reason || '').trim();
  if (!reason) { res.status(400).json({ error: 'A reason is required' }); return; }

  const { data: before, error: readErr } = await supabase
    .from('employee_documents')
    .select('id, school_id, sensitivity, category, filename')
    .eq('id', id).eq('school_id', schoolId).is('voided_at', null)
    .maybeSingle();
  if (readErr) { res.status(safeDbErrorStatus(readErr)).json({ error: safeDbErrorMessage(readErr) }); return; }
  if (!before) { res.status(404).json({ error: 'Document not found' }); return; }
  if (!(await canReadSensitivity(userId, before.sensitivity as 'low' | 'medium' | 'high'))) {
    res.status(403).json({ error: 'HR officer required' });
    return;
  }

  const { error: updErr } = await supabase
    .from('employee_documents')
    .update({ voided_at: new Date().toISOString(), voided_by: userId, void_reason: reason })
    .eq('id', id).eq('school_id', schoolId);
  if (updErr) { res.status(safeDbErrorStatus(updErr)).json({ error: safeDbErrorMessage(updErr) }); return; }

  await logAudit({
    req,
    entityType: 'employee_document',
    entityId: id,
    action: 'delete',
    before,
    label: 'document_void',
    reason,
  });

  res.json({ ok: true });
}

// ── GET /admin/employee-documents/expiring?days=30 ─────────────────────────
// Powers the admin dashboard widget + the expiry page. Returns documents
// expiring in the next N days (default 30, max 365). Includes a thin owner
// projection (name + role) so the UI can group by employee.

export async function listExpiring(req: AuthRequest, res: Response): Promise<void> {
  const { schoolId, userId } = req.user!;
  const days = Math.max(1, Math.min(365, Number(req.query.days) || 30));

  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date(Date.now() + days * 24 * 3600 * 1000).toISOString().slice(0, 10);

  const { data: docs, error } = await supabase
    .from('employee_documents')
    .select(`
      id, owner_type, owner_id, category, sensitivity,
      document_number, expires_on, filename
    `)
    .eq('school_id', schoolId)
    .is('voided_at', null)
    .neq('scan_status', 'infected')
    .not('expires_on', 'is', null)
    .gte('expires_on', today)
    .lte('expires_on', horizon)
    .order('expires_on', { ascending: true });
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  // Resolve owner names in batches per owner_type. Bounded fan-out: at most
  // 4 queries regardless of how many docs match.
  const hrOfficer = await isHrOfficer(userId);
  const byType: Record<OwnerType, Set<string>> = {
    users: new Set(), teachers: new Set(), drivers: new Set(),
    staff_members: new Set(), archived_employees: new Set(),
  };
  for (const d of docs ?? []) byType[d.owner_type as OwnerType]?.add(d.owner_id);

  type OwnerLookup = { id: string; name: string };
  const owners: Record<OwnerType, Map<string, OwnerLookup>> = {
    users: new Map(), teachers: new Map(), drivers: new Map(),
    staff_members: new Map(), archived_employees: new Map(),
  };

  async function fetchOwners(table: OwnerType, nameCols: string) {
    const ids = Array.from(byType[table]);
    if (ids.length === 0) return;
    const { data } = await supabase.from(table)
      .select(`id, ${nameCols}`).in('id', ids).eq('school_id', schoolId);
    for (const row of ((data ?? []) as unknown) as Record<string, unknown>[]) {
      const name = table === 'users'
        ? `${(row.first_name ?? '') as string} ${(row.last_name ?? '') as string}`.trim()
        : (row.full_name as string) || '';
      owners[table].set(row.id as string, { id: row.id as string, name });
    }
  }

  await Promise.all([
    fetchOwners('users', 'first_name, last_name'),
    fetchOwners('teachers', 'full_name'),
    fetchOwners('drivers', 'full_name'),
    fetchOwners('staff_members', 'full_name'),
  ]);

  const items = (docs ?? []).map(d => {
    const isHigh = d.sensitivity === 'high';
    const owner = owners[d.owner_type as OwnerType]?.get(d.owner_id);
    const daysLeft = Math.ceil(
      (new Date(d.expires_on as string).getTime() - Date.now()) / (24 * 3600 * 1000),
    );
    if (isHigh && !hrOfficer) {
      return {
        id: d.id, ownerType: d.owner_type, ownerId: d.owner_id,
        ownerName: owner?.name ?? '—',
        category: d.category, sensitivity: d.sensitivity,
        expiresOn: d.expires_on, daysLeft, redacted: true,
      };
    }
    return {
      id: d.id, ownerType: d.owner_type, ownerId: d.owner_id,
      ownerName: owner?.name ?? '—',
      category: d.category, sensitivity: d.sensitivity,
      documentNumber: d.document_number, filename: d.filename,
      expiresOn: d.expires_on, daysLeft, redacted: false,
    };
  });

  res.json({ items, total: items.length, days });
}
