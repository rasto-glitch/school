import { adminDb as supabase } from './db';
import { logger } from './logger';

// Best-effort recorder for a FAILED credential check. Called from
// auth.controller.login() at the two credential-failure points (unknown
// username, wrong password) AFTER the school has been resolved (so school_id is
// always present). This NEVER blocks login: it is fired without await and any
// error is swallowed. Powers the failed-login dashboard signal + IT security
// page; rows are auto-purged after ~90 days (loginAttemptGc.ts).
//
// matchedUserId is null when the username matched no account. matchedRole
// freezes the targeted account's role so the "failed logins on an admin
// account" signal survives a later role change or account deletion.
export async function recordLoginAttempt(args: {
  schoolId: string;
  username: string;
  matchedUserId?: string | null;
  matchedRole?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  try {
    const { error } = await supabase.from('login_attempts').insert({
      school_id: args.schoolId,
      username: (args.username || '').slice(0, 200),
      matched_user_id: args.matchedUserId ?? null,
      matched_role: args.matchedRole ?? null,
      ip: args.ip ?? null,
      user_agent: (args.userAgent || '').slice(0, 300) || null,
    });
    if (error) logger.warn('login attempt record failed', { err: error.message });
  } catch (err) {
    // Security logging is never allowed to break the login path.
    logger.warn('login attempt record threw', { err: (err as Error).message });
  }
}
