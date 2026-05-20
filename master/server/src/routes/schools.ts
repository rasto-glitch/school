import { safeDbErrorMessage, safeDbErrorStatus } from '../utils/dbErrors';
import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import bcrypt from 'bcryptjs';
import { loadArchiveSnapshot, streamPdf, buildXlsx } from '../utils/archiveExport';
import { loadEmployeeArchiveSnapshot, streamPdf as streamEmployeePdf, buildXlsx as buildEmployeeXlsx } from '../utils/employeeArchiveExport';
import { isStrongPassword, PASSWORD_POLICY_MESSAGE } from '../utils/passwordPolicy';

const router = Router();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Provider-side backup is retained even after the archive is purged
// (policy: a cancelling school AND we must keep a backup). Lives in the
// operator-only storage bucket; indexed by the archive_backups table.
const BACKUP_BUCKET = 'operator-mail';

// Build + persist a full JSON backup of a school's archive, then record
// it in archive_backups. Returns the stored object's metadata. Throws on
// failure so the caller can refuse to purge without a saved backup.
async function buildAndStoreBackup(
  schoolId: string,
  kind: 'pre_purge' | 'manual',
  reason: string,
  createdByName: string,
): Promise<{ path: string; bytes: number; students: number; employees: number }> {
  const [{ data: school }, { data: students }, { data: employees }] = await Promise.all([
    supabase.from('schools').select('name').eq('id', schoolId).single(),
    supabase.from('archived_students').select('*').eq('school_id', schoolId),
    supabase.from('archived_employees').select('*').eq('school_id', schoolId),
  ]);

  const payload = Buffer.from(JSON.stringify({
    schemaVersion: 1,
    kind: 'full_archive_backup',
    schoolId,
    schoolName: (school as { name?: string } | null)?.name ?? 'School',
    generatedAt: new Date().toISOString(),
    reason,
    counts: { students: (students ?? []).length, employees: (employees ?? []).length },
    archivedStudents: students ?? [],
    archivedEmployees: employees ?? [],
  }, null, 2), 'utf8');

  const sha256 = createHash('sha256').update(payload).digest('hex');
  const path = `archive-backups/${schoolId}/${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const up = await supabase.storage.from(BACKUP_BUCKET).upload(path, payload, {
    contentType: 'application/json',
    upsert: false,
  });
  if (up.error) throw new Error(`backup upload failed: ${up.error.message}`);

  const ins = await supabase.from('archive_backups').insert({
    school_id: schoolId,
    kind,
    storage_bucket: BACKUP_BUCKET,
    storage_path: path,
    byte_size: payload.byteLength,
    student_count: (students ?? []).length,
    employee_count: (employees ?? []).length,
    reason,
    created_by_name: createdByName,
    sha256,
  });
  if (ins.error) throw new Error(`backup record failed: ${ins.error.message}`);

  return { path, bytes: payload.byteLength, students: (students ?? []).length, employees: (employees ?? []).length };
}

// Triggered when an operator turns the archive feature OFF. Policy: the
// data does not survive, but a backup must — for both the school and us.
// So we ALWAYS take + retain a provider-side backup first, then purge via
// the SECURITY DEFINER RPC (the append-only triggers block plain deletes).
// Irreversible (except from the retained backup).
async function purgeArchive(schoolId: string): Promise<void> {
  await buildAndStoreBackup(schoolId, 'pre_purge', 'Archive feature disabled', 'operator');
  const { error } = await supabase.rpc('purge_school_archive', { p_school_id: schoolId });
  if (error) throw new Error(`purge failed: ${error.message}`);
}

// Re-download a stored backup, re-hash it, parse it, and check the row
// counts match what we recorded. Updates verify_status/verified_at on the
// archive_backups row. Same logic runs from the backend nightly sweep.
async function verifyBackupRow(b: {
  id: string; storage_bucket: string; storage_path: string;
  sha256: string | null; student_count: number | null; employee_count: number | null;
}): Promise<{ status: 'verified' | 'failed' | 'missing'; detail: string }> {
  let status: 'verified' | 'failed' | 'missing';
  let detail = '';
  try {
    const dl = await supabase.storage.from(b.storage_bucket).download(b.storage_path);
    if (dl.error || !dl.data) {
      status = 'missing'; detail = `download failed: ${dl.error?.message ?? 'no data'}`;
    } else {
      const buf = Buffer.from(await dl.data.arrayBuffer());
      const sha = createHash('sha256').update(buf).digest('hex');
      if (b.sha256 && sha !== b.sha256) {
        status = 'failed'; detail = 'sha256 mismatch — file altered or corrupted';
      } else {
        const parsed = JSON.parse(buf.toString('utf8'));
        const sN = Array.isArray(parsed.archivedStudents) ? parsed.archivedStudents.length : -1;
        const eN = Array.isArray(parsed.archivedEmployees) ? parsed.archivedEmployees.length : -1;
        if ((b.student_count ?? sN) !== sN || (b.employee_count ?? eN) !== eN) {
          status = 'failed'; detail = `count mismatch (students ${sN}/${b.student_count}, employees ${eN}/${b.employee_count})`;
        } else {
          status = 'verified';
          detail = `sha256 ok, parsed, ${sN} students + ${eN} employees`;
        }
      }
    }
  } catch (e) {
    status = 'failed'; detail = `verify threw: ${(e as Error).message}`;
  }
  await supabase.from('archive_backups')
    .update({ verify_status: status, verified_at: new Date().toISOString(), verify_detail: detail })
    .eq('id', b.id);
  return { status, detail };
}

function safeFilename(s: string): string {
  return s.replace(/[^a-z0-9-_]+/gi, '_');
}

// GET /api/schools/:id/admins — list admin accounts of one school. Used
// by the EditSchoolModal's password-reset UI to target a specific admin
// (rather than every admin at once — see L-4).
router.get('/:id/admins', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { data, error } = await supabase
    .from('users')
    .select('id, username, first_name, last_name, is_active')
    .eq('school_id', id)
    .eq('role', 'admin')
    .order('username');
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json(data ?? []);
});

// GET /api/schools — list all schools with counts
router.get('/', async (_req: Request, res: Response) => {
  const { data: schools, error } = await supabase
    .from('schools')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }

  const schoolsWithCounts = await Promise.all((schools || []).map(async (school) => {
    const [{ count: studentCount }, { count: adminCount }, { count: userCount }] = await Promise.all([
      supabase.from('students').select('*', { count: 'exact', head: true }).eq('school_id', school.id),
      supabase.from('users').select('*', { count: 'exact', head: true }).eq('school_id', school.id).eq('role', 'admin'),
      supabase.from('users').select('*', { count: 'exact', head: true }).eq('school_id', school.id),
    ]);
    return {
      ...school,
      studentCount: studentCount ?? 0,
      adminCount: adminCount ?? 0,
      userCount: userCount ?? 0,
    };
  }));

  res.json(schoolsWithCounts);
});

// POST /api/schools — create school + seed admin account
router.post('/', async (req: Request, res: Response) => {
  const {
    name, slug, abbreviation, primaryColor, secondaryColor, domain, subscriptionPlan, features,
    adminFirstName, adminLastName, adminUsername, adminPassword, adminEmail,
  } = req.body;

  if (!name || !slug || !abbreviation || !adminFirstName || !adminLastName || !adminUsername || !adminPassword) {
    res.status(400).json({ error: 'name, slug, abbreviation, adminFirstName, adminLastName, adminUsername, adminPassword are required' });
    return;
  }

  // Strong-password policy — mirrors backend/src/utils/passwordPolicy.ts.
  // Auto-generated defaults used elsewhere (Parent@123 / Teacher@123 /
  // Driver@123) all satisfy this; an operator setting the school's first
  // admin password must too.
  if (!isStrongPassword(adminPassword)) {
    res.status(400).json({ error: PASSWORD_POLICY_MESSAGE });
    return;
  }

  const abbrev = abbreviation.toLowerCase();
  const finalAdminUsername = adminUsername.startsWith(`${abbrev}_`) ? adminUsername : `${abbrev}_${adminUsername}`;

  const { data: school, error: schoolErr } = await supabase
    .from('schools')
    .insert({
      name,
      slug,
      abbreviation: abbreviation.toUpperCase(),
      primary_color: primaryColor || '#4F46E5',
      secondary_color: secondaryColor || '#06B6D4',
      domain: domain || null,
      subscription_plan: subscriptionPlan || 'basic',
      ...(features && { features }),
      is_active: true,
    })
    .select()
    .single();

  if (schoolErr) { res.status(400).json({ error: safeDbErrorMessage(schoolErr) }); return; }

  const passwordHash = await bcrypt.hash(adminPassword, 10);
  const { error: userErr } = await supabase.from('users').insert({
    school_id: school.id,
    email: adminEmail || null,
    username: finalAdminUsername,
    password_hash: passwordHash,
    role: 'admin',
    first_name: adminFirstName,
    last_name: adminLastName,
    is_active: true,
  });

  if (userErr) {
    await supabase.from('schools').delete().eq('id', school.id);
    res.status(400).json({ error: safeDbErrorMessage(userErr) });
    return;
  }

  res.status(201).json(school);
});

// PUT /api/schools/:id — edit school details. If the archive feature flips
// from ON to OFF, every historical student record for this school is purged.
router.put('/:id', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { name, slug, abbreviation, primaryColor, secondaryColor, domain, subscriptionPlan, features, confirmPurge } = req.body;

  let archiveWasOn = false;
  if (features) {
    const { data: prev } = await supabase
      .from('schools').select('features').eq('id', id).single();
    archiveWasOn = (prev?.features as Record<string, boolean> | null)?.archive === true;
  }

  const { data, error } = await supabase
    .from('schools')
    .update({
      name,
      slug,
      ...(abbreviation && { abbreviation: abbreviation.toUpperCase() }),
      primary_color: primaryColor,
      secondary_color: secondaryColor,
      domain: domain || null,
      subscription_plan: subscriptionPlan,
      ...(features && { features }),
    })
    .eq('id', id)
    .select()
    .single();

  if (error) { res.status(400).json({ error: safeDbErrorMessage(error) }); return; }

  // Cleanup AFTER the update succeeds so we never wipe data and then fail.
  // The purge is irreversible (drops archived_students + graduated students),
  // so it only runs when the operator explicitly confirmed it. Without the
  // flag we keep the data and signal the UI to ask for confirmation; the
  // archive feature is still off, the rows are just retained until confirmed.
  if (features && archiveWasOn && features.archive !== true) {
    if (confirmPurge === true) {
      try {
        await purgeArchive(id);
      } catch (e) {
        // Backup failed ⇒ purge never ran ⇒ data is intact. Refuse rather
        // than wipe without a retained copy.
        res.status(500).json({ error: `Archive purge aborted — backup failed, archive kept: ${(e as Error).message}` });
        return;
      }
    } else {
      res.json({ ...data, pendingPurge: true });
      return;
    }
  }

  res.json(data);
});

// GET /api/schools/:id/archive-export.pdf — operator-triggered backup before
// turning archive off. Streams a PDF of every historical student record.
router.get('/:id/archive-export.pdf', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  try {
    const snapshot = await loadArchiveSnapshot(supabase, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="archive-${safeFilename(snapshot.schoolName)}-${new Date().toISOString().split('T')[0]}.pdf"`);
    streamPdf(snapshot, res);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Failed to build PDF' });
  }
});

router.get('/:id/archive-export.xlsx', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  try {
    const snapshot = await loadArchiveSnapshot(supabase, id);
    const buf = buildXlsx(snapshot);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="archive-${safeFilename(snapshot.schoolName)}-${new Date().toISOString().split('T')[0]}.xlsx"`);
    res.send(buf);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Failed to build Excel' });
  }
});

// Employee archive backup — same pre-disable purpose as the student export
// above (the archive feature is shared by both).
router.get('/:id/employee-archive-export.pdf', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  try {
    const snapshot = await loadEmployeeArchiveSnapshot(supabase, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="employee-archive-${safeFilename(snapshot.schoolName)}-${new Date().toISOString().split('T')[0]}.pdf"`);
    streamEmployeePdf(snapshot, res);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Failed to build PDF' });
  }
});

router.get('/:id/employee-archive-export.xlsx', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  try {
    const snapshot = await loadEmployeeArchiveSnapshot(supabase, id);
    const buf = buildEmployeeXlsx(snapshot);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="employee-archive-${safeFilename(snapshot.schoolName)}-${new Date().toISOString().split('T')[0]}.xlsx"`);
    res.send(buf);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Failed to build Excel' });
  }
});

// PATCH /api/schools/:id/status — activate or deactivate
router.patch('/:id/status', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { isActive } = req.body;

  const { data, error } = await supabase
    .from('schools')
    .update({ is_active: isActive })
    .eq('id', id)
    .select()
    .single();

  if (error) { res.status(400).json({ error: safeDbErrorMessage(error) }); return; }
  res.json(data);
});

// PATCH /api/schools/:id/admin-password — reset ONE admin account's password.
// SECURITY (L-4): previously this update used .eq('role', 'admin') alone,
// which set every admin of the school to the SAME password. Multiple
// admins now shared one credential. Take a target userId from the body
// and scope the update to that single user.
router.patch('/:id/admin-password', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { password, userId } = req.body as { password?: unknown; userId?: unknown };

  if (!isStrongPassword(password)) {
    res.status(400).json({ error: PASSWORD_POLICY_MESSAGE });
    return;
  }
  if (typeof userId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    res.status(400).json({ error: 'userId is required and must be a UUID.' });
    return;
  }

  // Verify the target user is actually an admin of this school before
  // resetting — refuses to silently no-op on a wrong school + userId
  // combination, and prevents accidentally touching a non-admin via
  // a hand-crafted body.
  const { data: target } = await supabase
    .from('users').select('id, role').eq('id', userId).eq('school_id', id).maybeSingle();
  if (!target || (target as { role: string }).role !== 'admin') {
    res.status(404).json({ error: 'Admin account not found in this school.' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const { error } = await supabase
    .from('users')
    .update({ password_hash: passwordHash, password_changed_at: new Date().toISOString() })
    .eq('id', userId)
    .eq('school_id', id);

  if (error) { res.status(400).json({ error: safeDbErrorMessage(error) }); return; }
  res.json({ message: 'Admin password updated.' });
});

// GET /api/schools/:id/backups — retained backups + verification state.
router.get('/:id/backups', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { data, error } = await supabase
    .from('archive_backups')
    .select('id, kind, storage_path, byte_size, student_count, employee_count, reason, created_by_name, sha256, verified_at, verify_status, verify_detail, created_at')
    .eq('school_id', id)
    .order('created_at', { ascending: false });
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json(data ?? []);
});

// POST /api/schools/:id/backups/:backupId/verify — re-download, re-hash,
// parse, count-check a single retained backup.
router.post('/:id/backups/:backupId/verify', async (req: Request, res: Response) => {
  const { id, backupId } = req.params as { id: string; backupId: string };
  const { data: b, error } = await supabase
    .from('archive_backups')
    .select('id, storage_bucket, storage_path, sha256, student_count, employee_count')
    .eq('id', backupId).eq('school_id', id).single();
  if (error || !b) { res.status(404).json({ error: 'Backup not found' }); return; }
  const r = await verifyBackupRow(b as any);
  res.json(r);
});

// GET /api/schools/:id/integrity — provider-side tamper check. Recomputes
// every snapshot hash + the audit chain for the school (Phase E-a).
router.get('/:id/integrity', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { data, error } = await supabase.rpc('verify_school_integrity', { p_school_id: id });
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  const issues = (data ?? []) as { kind: string; table_name: string; row_id: string; detail: string }[];
  const tampered = issues.filter(i => i.kind !== 'unhashed');
  res.json({
    ok: tampered.length === 0,
    checkedAt: new Date().toISOString(),
    tamperedCount: tampered.length,
    unhashedCount: issues.length - tampered.length,
    issues,
  });
});

// DELETE /api/schools/:id — permanently delete (cascades via FK).
// Routed through delete_school_cascade(): the append-only triggers on
// audit_logs / archived_* would otherwise block the schools-FK cascade.
// The SECURITY DEFINER function sets the tx-local purge GUC so the
// cascade deletes are allowed.
router.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { error } = await supabase.rpc('delete_school_cascade', { p_school_id: id });
  if (error) { res.status(400).json({ error: safeDbErrorMessage(error) }); return; }
  res.json({ message: 'School deleted' });
});

export default router;
