import { adminDb as supabase } from './db';
import { logger } from './logger';

// Periodic sweep of expired auth tokens. The application code already
// treats an expired token as dead (verify-paths short-circuit on
// expires_at), so these rows are inert — keeping them around is purely
// a storage / index-bloat / forensics cost. We delete with a 7-day
// grace AFTER expiry so a support engineer can still reconstruct why
// a recent "this link doesn't work" complaint failed.
//
// Tables swept (same shape: token_hash + expires_at + used_at):
//   - email_change_tokens      (10-min OTPs)
//   - account_recovery_tokens  (7-day anchor recovery links)
//   - password_reset_tokens    (1-hour reset links)
//   - trusted_devices          (30-day MFA bypass tokens — Phase 3)
//
// All best-effort: errors are logged but never thrown to the scheduler
// (a failed sweep should never crash the process).

const GRACE_DAYS = 7;

async function sweepTable(table: string): Promise<void> {
  const cutoff = new Date(Date.now() - GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  try {
    // tenant-check-allow: all three tables are user-keyed (no school_id by design);
    // we sweep by absolute expiry, not by tenant.
    const { error, count } = await supabase
      .from(table)
      .delete({ count: 'exact' })
      .lt('expires_at', cutoff);
    if (error) {
      logger.error('token GC sweep failed', { table, err: error.message });
      return;
    }
    if ((count ?? 0) > 0) {
      logger.info('token GC sweep', { table, deleted: count });
    }
  } catch (err) {
    logger.error('token GC sweep threw', { table, err: (err as Error).message });
  }
}

async function sweepAll(): Promise<void> {
  await sweepTable('email_change_tokens');
  await sweepTable('account_recovery_tokens');
  await sweepTable('password_reset_tokens');
  await sweepTable('trusted_devices');
}

// Same pattern as startBackupVerifySchedule: a short delay before the
// first run (give the process time to warm up + avoid a thundering herd
// across boot), then a fixed daily interval. Not aligned to a specific
// wall-clock hour because Railway containers restart unpredictably and
// pretending to schedule at 03:00 UTC is just theatre when the next
// boot is at 14:32 UTC. Daily-ish is what matters.
export function startTokenGcSchedule(): void {
  setTimeout(() => { void sweepAll(); }, 10 * 60_000);          // first sweep 10 min after boot
  setInterval(() => { void sweepAll(); }, 24 * 60 * 60_000);    // then once a day
}
