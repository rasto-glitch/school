import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import { loadArchiveSnapshot, streamPdf, buildXlsx } from '../utils/archiveExport';
import { loadEmployeeArchiveSnapshot, streamPdf as streamEmployeePdf, buildXlsx as buildEmployeeXlsx } from '../utils/employeeArchiveExport';

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

function safeFilename(s: string): string {
  return s.replace(/[^a-z0-9-_]+/gi, '_');
}

// GET /api/schools — list all schools with counts
router.get('/', async (_req: Request, res: Response) => {
  const { data: schools, error } = await supabase
    .from('schools')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) { res.status(500).json({ error: error.message }); return; }

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

  if (schoolErr) { res.status(400).json({ error: schoolErr.message }); return; }

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
    res.status(400).json({ error: userErr.message });
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

  if (error) { res.status(400).json({ error: error.message }); return; }

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

  if (error) { res.status(400).json({ error: error.message }); return; }
  res.json(data);
});

// PATCH /api/schools/:id/admin-password — reset admin account(s) password
router.patch('/:id/admin-password', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { password } = req.body;

  if (!password || password.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters.' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const { error } = await supabase
    .from('users')
    .update({ password_hash: passwordHash, password_changed_at: new Date().toISOString() })
    .eq('school_id', id)
    .eq('role', 'admin');

  if (error) { res.status(400).json({ error: error.message }); return; }
  res.json({ message: 'Admin password updated.' });
});

// DELETE /api/schools/:id — permanently delete (cascades via FK).
// Routed through delete_school_cascade(): the append-only triggers on
// audit_logs / archived_* would otherwise block the schools-FK cascade.
// The SECURITY DEFINER function sets the tx-local purge GUC so the
// cascade deletes are allowed.
router.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { error } = await supabase.rpc('delete_school_cascade', { p_school_id: id });
  if (error) { res.status(400).json({ error: error.message }); return; }
  res.json({ message: 'School deleted' });
});

export default router;
