// ClamAV scan worker for employee_documents (Wave 3).
//
// Polls Supabase for documents with scan_status='pending', downloads each
// file from the private `employee-documents` bucket, pipes it to `clamscan`,
// and updates the row to 'clean' or 'infected'. Infected rows trigger a
// notification to every admin of the owning school.
//
// Deployed as a standalone Railway service so the API stays Node-only and
// doesn't need ClamAV in its image. Communication is purely through the
// shared Supabase Postgres + Storage; no direct HTTP between the services.
//
// Env vars (all required):
//   SUPABASE_URL                  — same as the API
//   SUPABASE_SERVICE_ROLE_KEY          — service-role key (read storage + write DB)
//   CLAMSCAN_BIN                  — path to clamscan, default 'clamscan'
//   SCAN_POLL_INTERVAL_MS         — default 30000 (30s)
//   SCAN_BATCH_SIZE               — default 10 rows per poll
//   SCAN_FILE_MAX_BYTES           — default 10MB; rows bigger are marked infected (defense in depth)

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CLAMSCAN_BIN = process.env.CLAMSCAN_BIN || 'clamscan';
const POLL_MS = Number(process.env.SCAN_POLL_INTERVAL_MS || 30_000);
const BATCH = Number(process.env.SCAN_BATCH_SIZE || 10);
const MAX_BYTES = Number(process.env.SCAN_FILE_MAX_BYTES || 10 * 1024 * 1024);

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[clamav-worker] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

interface PendingDoc {
  id: string;
  school_id: string;
  storage_bucket: string;
  storage_path: string;
  filename: string;
  byte_size: number;
  category: string;
  owner_type: string;
  owner_id: string;
}

/**
 * Runs clamscan on the given path. Returns the verdict.
 *
 * Exit codes per clamscan(1):
 *   0 — clean
 *   1 — virus found
 *   2+ — error (file unreadable, definition load failure, etc.)
 *
 * We treat 2+ as "scan error" — the row stays 'pending' for the next pass.
 * If clamscan can't be spawned at all (missing binary), same treatment.
 */
async function clamscan(filePath: string): Promise<'clean' | 'infected' | 'error'> {
  return new Promise(resolve => {
    let resolved = false;
    const finish = (v: 'clean' | 'infected' | 'error') => { if (!resolved) { resolved = true; resolve(v); } };

    const child = spawn(CLAMSCAN_BIN, ['--no-summary', '--infected', filePath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', buf => { stderr += String(buf); });
    child.on('error', err => {
      console.error(`[clamav-worker] spawn failed: ${err.message}`);
      finish('error');
    });
    child.on('exit', (code, sig) => {
      if (sig) { console.error(`[clamav-worker] killed by signal ${sig}`); finish('error'); return; }
      if (code === 0) finish('clean');
      else if (code === 1) finish('infected');
      else { console.error(`[clamav-worker] clamscan exit ${code}: ${stderr.trim()}`); finish('error'); }
    });
  });
}

/** Downloads a Supabase Storage object into a temp file. Returns the local path. */
async function downloadToTemp(bucket: string, storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage.from(bucket).download(storagePath);
  if (error || !data) throw new Error(`download ${bucket}/${storagePath}: ${error?.message || 'no data'}`);
  const buf = Buffer.from(await data.arrayBuffer());
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clamav-'));
  // Random filename — the human-facing one is untrusted.
  const tmp = path.join(tmpDir, crypto.randomBytes(8).toString('hex'));
  await fs.writeFile(tmp, buf);
  return tmp;
}

/** Sends an in-app notification to every active admin of a school. */
async function notifyAdmins(schoolId: string, docId: string, doc: PendingDoc): Promise<void> {
  const { data: admins } = await supabase
    .from('users').select('id')
    .eq('school_id', schoolId).eq('role', 'admin').eq('is_active', true);
  if (!admins || admins.length === 0) return;

  const title = 'Quarantined: employee document flagged by virus scan';
  const message =
    `An employee document (${doc.category}, ${doc.filename}) was flagged as potentially infected ` +
    `and is now blocked from download. Investigate at /admin/employees/.../documents and remove it ` +
    `if you can't verify it's safe.`;

  const rows = admins.map(a => ({
    school_id: schoolId,
    user_id: a.id,
    title,
    message,
    notification_type: 'employee_doc_infected',
    related_id: docId,
  }));
  await supabase.from('notifications').insert(rows);
}

async function processOne(doc: PendingDoc): Promise<void> {
  if (doc.byte_size > MAX_BYTES) {
    // Defense in depth: a row bigger than the cap shouldn't exist (upload
    // controller enforces 10MB) but if it does, refuse to scan and flag.
    console.warn(`[clamav-worker] ${doc.id} oversize (${doc.byte_size}) — marking infected`);
    await supabase.from('employee_documents')
      .update({ scan_status: 'infected' })
      .eq('id', doc.id).eq('school_id', doc.school_id);
    await notifyAdmins(doc.school_id, doc.id, doc);
    return;
  }

  let tmpPath: string | null = null;
  try {
    tmpPath = await downloadToTemp(doc.storage_bucket, doc.storage_path);
    const verdict = await clamscan(tmpPath);

    if (verdict === 'error') {
      // Leave as 'pending'; next pass will retry. Avoids permanent
      // quarantine if the scanner had a transient failure.
      console.warn(`[clamav-worker] ${doc.id} scan error — will retry`);
      return;
    }

    const { error } = await supabase.from('employee_documents')
      .update({ scan_status: verdict })
      .eq('id', doc.id).eq('school_id', doc.school_id);
    if (error) throw new Error(`update ${doc.id}: ${error.message}`);

    console.log(`[clamav-worker] ${doc.id} → ${verdict} (${doc.filename})`);
    if (verdict === 'infected') await notifyAdmins(doc.school_id, doc.id, doc);
  } catch (err) {
    console.error(`[clamav-worker] ${doc.id} failed: ${(err as Error).message}`);
  } finally {
    if (tmpPath) {
      try { await fs.unlink(tmpPath); await fs.rmdir(path.dirname(tmpPath)); }
      catch { /* best-effort cleanup */ }
    }
  }
}

async function pollOnce(): Promise<number> {
  const { data, error } = await supabase
    .from('employee_documents')
    .select('id, school_id, storage_bucket, storage_path, filename, byte_size, category, owner_type, owner_id')
    .eq('scan_status', 'pending')
    .is('voided_at', null)
    .order('uploaded_at', { ascending: true })
    .limit(BATCH);
  if (error) { console.error(`[clamav-worker] poll failed: ${error.message}`); return 0; }
  if (!data || data.length === 0) return 0;

  console.log(`[clamav-worker] picked up ${data.length} pending row(s)`);
  for (const doc of data as PendingDoc[]) {
    await processOne(doc);
  }
  return data.length;
}

let stopping = false;
function shutdown(reason: string): void {
  if (stopping) return;
  stopping = true;
  console.log(`[clamav-worker] shutting down: ${reason}`);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

async function main(): Promise<void> {
  console.log(`[clamav-worker] starting. poll=${POLL_MS}ms batch=${BATCH} max=${MAX_BYTES}B clamscan=${CLAMSCAN_BIN}`);

  // Pre-flight: verify clamscan is on PATH. Don't exit on failure — Railway
  // may take a moment to make the freshclam cache ready; the worker just
  // keeps polling and clamscan() will return 'error' until it's ready.
  try {
    const child = spawn(CLAMSCAN_BIN, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', b => { out += String(b); });
    await new Promise<void>(r => child.on('exit', () => r()));
    if (out) console.log(`[clamav-worker] ${out.trim().split('\n')[0]}`);
  } catch {
    console.warn('[clamav-worker] clamscan --version probe failed; will retry on first poll');
  }

  while (!stopping) {
    try {
      const n = await pollOnce();
      if (n < BATCH && !stopping) await new Promise(r => setTimeout(r, POLL_MS));
    } catch (err) {
      console.error(`[clamav-worker] poll loop crashed: ${(err as Error).message}`);
      if (!stopping) await new Promise(r => setTimeout(r, POLL_MS));
    }
  }
  console.log('[clamav-worker] bye.');
}

main();
