#!/usr/bin/env node
/*
 * HD-15 — storage orphan sweep.
 *
 * Walks the Supabase Storage buckets whose ownership is fully tracked in
 * the database (chat-files, employee-documents) and reports any object
 * whose key is NOT referenced from the canonical owning table.
 *
 * Coverage scope (deliberate, narrow):
 *
 *   chat-files          → owners in chat_attachments.storage_path
 *   employee-documents  → owners in employee_documents.storage_path
 *
 * homework-attachments and operator-mail are out of scope: they're
 * referenced from many tables (academic_posts, announcements, users,
 * schools, ebooks, operator_emails, archive_backups, ...) with mixed
 * publicUrl / storage-path mixing, so a clean inventory is harder than
 * a one-page script. Add them in a phase-2 pass once we have a single
 * source of truth for each.
 *
 * Modes (CLI arg):
 *
 *   report  (default) — print orphans, exit 0. Safe to run anywhere.
 *   delete            — remove every orphan older than --grace-days
 *                       (default 7). NEVER deletes anything younger
 *                       than the grace window so in-flight uploads
 *                       always survive at least one sweep.
 *
 * Env vars required:
 *
 *   SUPABASE_URL              — https://<project>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY — the secret service role key
 *
 * Usage:
 *
 *   node scripts/storage-orphan-sweep.cjs                  # report only
 *   node scripts/storage-orphan-sweep.cjs --mode=report
 *   node scripts/storage-orphan-sweep.cjs --mode=delete --grace-days=7
 *   node scripts/storage-orphan-sweep.cjs --bucket=chat-files
 */

const { createClient } = require('@supabase/supabase-js');

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), 'true'];
  })
);
const MODE = args.mode || 'report';
const GRACE_DAYS = Number.parseInt(args['grace-days'] || '7', 10);
const ONLY_BUCKET = args.bucket || null;

if (!['report', 'delete'].includes(MODE)) {
  console.error(`Unknown --mode=${MODE}; expected report | delete`);
  process.exit(2);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.');
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Each owner is: { bucket, table, pathColumn, label }.
const OWNERS = [
  { bucket: 'chat-files',         table: 'chat_attachments',  pathColumn: 'storage_path', label: 'chat attachments' },
  { bucket: 'employee-documents', table: 'employee_documents', pathColumn: 'storage_path', label: 'employee documents' },
].filter(o => !ONLY_BUCKET || o.bucket === ONLY_BUCKET);

// Supabase Storage's list() is per-prefix and paginated. We walk
// recursively so deeply-nested per-school keys are included.
async function listAll(bucket, prefix = '') {
  const out = [];
  let offset = 0;
  const limit = 1000;
  for (;;) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, {
      limit, offset, sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const entry of data) {
      const full = prefix ? `${prefix}/${entry.name}` : entry.name;
      // A "folder" entry has no id and no metadata. Recurse into it.
      if (!entry.id) {
        const child = await listAll(bucket, full);
        out.push(...child);
      } else {
        out.push({
          key: full,
          size: entry.metadata?.size ?? 0,
          createdAt: entry.created_at ?? null,
        });
      }
    }
    if (data.length < limit) break;
    offset += limit;
  }
  return out;
}

async function loadOwnedKeys(table, pathColumn) {
  const owned = new Set();
  let from = 0;
  const pageSize = 1000;
  for (;;) {
    const { data, error } = await supabase
      .from(table).select(pathColumn).range(from, from + pageSize - 1);
    if (error) throw new Error(`select ${table}.${pathColumn}: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      const v = row[pathColumn];
      if (typeof v === 'string' && v) owned.add(v);
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return owned;
}

function ageDays(iso) {
  if (!iso) return Infinity;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Infinity;
  return (Date.now() - t) / 86_400_000;
}

async function sweepOne(owner) {
  process.stdout.write(`\n== ${owner.bucket} (${owner.label}) ==\n`);
  const [objects, owned] = await Promise.all([
    listAll(owner.bucket),
    loadOwnedKeys(owner.table, owner.pathColumn),
  ]);
  const orphans = objects.filter(o => !owned.has(o.key));
  const ripe    = orphans.filter(o => ageDays(o.createdAt) >= GRACE_DAYS);
  const young   = orphans.length - ripe.length;
  const totalBytes = orphans.reduce((s, o) => s + o.size, 0);
  const ripeBytes  = ripe.reduce((s, o) => s + o.size, 0);

  process.stdout.write(
    `  total objects:     ${objects.length}\n` +
    `  owned by ${owner.table}: ${owned.size}\n` +
    `  orphans (any age): ${orphans.length} (${(totalBytes / 1024 / 1024).toFixed(2)} MiB)\n` +
    `  orphans ≥${GRACE_DAYS}d:    ${ripe.length} (${(ripeBytes / 1024 / 1024).toFixed(2)} MiB)\n` +
    `  orphans <${GRACE_DAYS}d:    ${young} (held — within grace window)\n`,
  );

  for (const o of ripe.slice(0, 10)) {
    process.stdout.write(`  · ${o.key} (${o.size} B, ${o.createdAt})\n`);
  }
  if (ripe.length > 10) process.stdout.write(`  · …and ${ripe.length - 10} more\n`);

  if (MODE !== 'delete' || ripe.length === 0) return { deleted: 0, freed: 0 };

  // Delete in chunks; Supabase Storage remove() takes an array.
  let deleted = 0, freed = 0;
  const CHUNK = 100;
  for (let i = 0; i < ripe.length; i += CHUNK) {
    const batch = ripe.slice(i, i + CHUNK);
    const { error } = await supabase.storage.from(owner.bucket).remove(batch.map(o => o.key));
    if (error) {
      process.stdout.write(`  ! delete batch failed: ${error.message}\n`);
      continue;
    }
    deleted += batch.length;
    freed += batch.reduce((s, o) => s + o.size, 0);
  }
  process.stdout.write(`  deleted: ${deleted} object(s) (${(freed / 1024 / 1024).toFixed(2)} MiB)\n`);
  return { deleted, freed };
}

(async () => {
  process.stdout.write(`storage-orphan-sweep mode=${MODE} grace-days=${GRACE_DAYS}\n`);
  let totalDeleted = 0, totalFreed = 0;
  for (const owner of OWNERS) {
    try {
      const r = await sweepOne(owner);
      totalDeleted += r.deleted; totalFreed += r.freed;
    } catch (e) {
      process.stderr.write(`! ${owner.bucket}: ${e.message}\n`);
      process.exitCode = 1;
    }
  }
  if (MODE === 'delete') {
    process.stdout.write(`\nTOTAL deleted: ${totalDeleted} (${(totalFreed / 1024 / 1024).toFixed(2)} MiB)\n`);
  }
})();
