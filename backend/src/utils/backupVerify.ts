import { createHash } from 'crypto';
import { supabase } from '../config/supabase';

// Phase E-b nightly sweep. The master portal creates retained backups but
// is local-only and not always running, so the always-on backend owns the
// scheduled re-verification: download each stored backup, re-hash it,
// parse it, count-check it, and stamp archive_backups.verify_status.
// Best-effort — never throws to the caller.

interface BackupRow {
  id: string;
  storage_bucket: string;
  storage_path: string;
  sha256: string | null;
  student_count: number | null;
  employee_count: number | null;
}

async function verifyOne(b: BackupRow): Promise<void> {
  let status: 'verified' | 'failed' | 'missing';
  let detail = '';
  try {
    const dl = await supabase.storage.from(b.storage_bucket).download(b.storage_path);
    if (dl.error || !dl.data) {
      status = 'missing';
      detail = `download failed: ${dl.error?.message ?? 'no data'}`;
    } else {
      const buf = Buffer.from(await dl.data.arrayBuffer());
      const sha = createHash('sha256').update(buf).digest('hex');
      if (b.sha256 && sha !== b.sha256) {
        status = 'failed';
        detail = 'sha256 mismatch — file altered or corrupted';
      } else {
        const parsed = JSON.parse(buf.toString('utf8'));
        const sN = Array.isArray(parsed.archivedStudents) ? parsed.archivedStudents.length : -1;
        const eN = Array.isArray(parsed.archivedEmployees) ? parsed.archivedEmployees.length : -1;
        if ((b.student_count ?? sN) !== sN || (b.employee_count ?? eN) !== eN) {
          status = 'failed';
          detail = `count mismatch (students ${sN}/${b.student_count}, employees ${eN}/${b.employee_count})`;
        } else {
          status = 'verified';
          detail = `sha256 ok, parsed, ${sN} students + ${eN} employees`;
        }
      }
    }
  } catch (e) {
    status = 'failed';
    detail = `verify threw: ${(e as Error).message}`;
  }
  await supabase.from('archive_backups')
    .update({ verify_status: status, verified_at: new Date().toISOString(), verify_detail: detail })
    .eq('id', b.id);
  if (status !== 'verified') {
    console.error(`[backup-verify] ${b.id} ${b.storage_path}: ${status} — ${detail}`);
  }
}

// Verify backups never verified, or last verified > 7 days ago. Capped so
// a large backlog can't stall the loop; the next nightly run continues.
export async function verifyPendingArchiveBackups(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - 7 * 86400_000).toISOString();
    const { data, error } = await supabase
      .from('archive_backups')
      .select('id, storage_bucket, storage_path, sha256, student_count, employee_count, verify_status, verified_at')
      .or(`verify_status.neq.verified,verified_at.lt.${cutoff}`)
      .order('created_at', { ascending: true })
      .limit(50);
    if (error) { console.error(`[backup-verify] list failed: ${error.message}`); return; }
    for (const b of (data ?? []) as BackupRow[]) await verifyOne(b);
    if ((data ?? []).length) console.log(`[backup-verify] checked ${(data ?? []).length} backup(s)`);
  } catch (e) {
    console.error(`[backup-verify] sweep threw: ${(e as Error).message}`);
  }
}

// Single-instance (Railway) daily timer. 10 min after boot, then every 24h.
export function startBackupVerifySchedule(): void {
  setTimeout(() => { void verifyPendingArchiveBackups(); }, 10 * 60_000);
  setInterval(() => { void verifyPendingArchiveBackups(); }, 24 * 60 * 60_000);
}
