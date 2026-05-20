// Map Postgres / Supabase / PostgREST error shapes to a user-safe message.
// The verbose `error.message` from supabase-js typically contains schema
// detail like `'insert or update on table "attendance" violates foreign
// key constraint "attendance_student_id_fkey"'`. Echoing that back to the
// client lets an attacker enumerate table and constraint names by
// triggering different failures. This helper strips the schema detail
// while preserving the categorical info the UI needs (uniqueness,
// missing FK, NOT NULL, permission, validation).
//
// The original error stays in the server logs via the caller's
// `logger.error` — only the *response body* is sanitized.

export interface DbErrorLike {
  code?: string | null;
  message?: string | null;
  details?: string | null;
}

export function safeDbErrorMessage(err: DbErrorLike | null | undefined): string {
  if (!err) return 'Invalid request';
  const code = (err.code || '').trim();

  // Postgres SQLSTATE codes:
  //   23505 = unique_violation
  //   23503 = foreign_key_violation
  //   23502 = not_null_violation
  //   23514 = check_violation
  //   22P02 = invalid_text_representation (bad UUID, etc.)
  //   42501 = insufficient_privilege (RLS blocked)
  //   42P01 = undefined_table
  //   42703 = undefined_column
  switch (code) {
    case '23505': return 'A record with that value already exists';
    case '23503': return 'Referenced record not found';
    case '23502': return 'A required field is missing';
    case '23514': return 'Value does not satisfy a database constraint';
    case '22P02': return 'Invalid value format';
    case '42501': return 'Permission denied';
  }

  // PostgREST surfaces some non-SQLSTATE codes (e.g. PGRST116 = no rows
  // returned from `.single()`). Treat those as "not found" without
  // detail.
  if (code.startsWith('PGRST')) return 'Not found';

  // Default: a generic message. Never echo the verbose `message` field.
  return 'Invalid request';
}

// Status helper — same code → same HTTP status. Callers can override.
export function safeDbErrorStatus(err: DbErrorLike | null | undefined): number {
  const code = (err?.code || '').trim();
  if (code === '23505' || code === '23503' || code === '23502' || code === '23514' || code === '22P02') return 400;
  if (code === '42501') return 403;
  return 500;
}
