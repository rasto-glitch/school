// Map Postgres / Supabase / PostgREST error shapes to a user-safe message.
// Mirrors backend/src/utils/dbErrors.ts. The master portal is local-only
// but the loopback-attacker model (compromised editor extension, malicious
// dependency, RDP-from-coworker) means we still don't want to echo raw
// schema detail into responses.

export interface DbErrorLike {
  code?: string | null;
  message?: string | null;
  details?: string | null;
}

export function safeDbErrorMessage(err: DbErrorLike | null | undefined): string {
  if (!err) return 'Invalid request';
  const code = (err.code || '').trim();
  switch (code) {
    case '23505': return 'A record with that value already exists';
    case '23503': return 'Referenced record not found';
    case '23502': return 'A required field is missing';
    case '23514': return 'Value does not satisfy a database constraint';
    case '22P02': return 'Invalid value format';
    case '42501': return 'Permission denied';
  }
  if (code.startsWith('PGRST')) return 'Not found';
  return 'Invalid request';
}

export function safeDbErrorStatus(err: DbErrorLike | null | undefined): number {
  const code = (err?.code || '').trim();
  if (code === '23505' || code === '23503' || code === '23502' || code === '23514' || code === '22P02') return 400;
  if (code === '42501') return 403;
  return 500;
}
