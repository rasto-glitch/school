import { adminDb as supabase } from './db';
import { logger } from './logger';

// Periodic purge of old login_attempts rows. The table is an append-only
// forensic log feeding the failed-login signal + IT security page; rows older
// than the retention window are inert. Same scheduling shape as tokenGc:
// a short post-boot delay, then daily. Best-effort — a failed sweep never
// throws to the scheduler.
//
// tenant-check-allow: purge is by absolute age across all schools, not scoped
// to one tenant (this is an operational cleanup, not a per-school read).

const RETENTION_DAYS = 90;

async function purge(): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  try {
    const { error, count } = await supabase
      .from('login_attempts')
      .delete({ count: 'exact' })
      .lt('attempted_at', cutoff);
    if (error) {
      logger.error('login_attempts purge failed', { err: error.message });
      return;
    }
    if ((count ?? 0) > 0) logger.info('login_attempts purge', { deleted: count });
  } catch (err) {
    logger.error('login_attempts purge threw', { err: (err as Error).message });
  }
}

export function startLoginAttemptGcSchedule(): void {
  setTimeout(() => { void purge(); }, 12 * 60_000);          // first purge ~12 min after boot
  setInterval(() => { void purge(); }, 24 * 60 * 60_000);    // then once a day
}
