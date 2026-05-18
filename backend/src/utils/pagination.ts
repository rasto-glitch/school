// Shared keyset (cursor) pagination helpers.
//
// Why keyset and not OFFSET: these lists are reverse-chronological feeds
// that grow without bound. OFFSET degrades at depth and skips/dupes rows
// when new items arrive mid-scroll. A composite (created_at, id) cursor is
// O(1) at any depth and stable under concurrent inserts. The `id` tiebreak
// is essential — `created_at` alone collides (multiple rows can share a
// millisecond), which would silently skip or duplicate notifications.

export interface CursorParams {
  limit: number;
  cursor: { createdAt: string; id: string } | null;
}

export interface Paginated<T> {
  data: T[];
  limit: number;
  nextCursor: string | null;
}

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

export function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`, 'utf8').toString('base64url');
}

export function decodeCursor(raw: unknown): { createdAt: string; id: string } | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    const sep = decoded.lastIndexOf('|');
    if (sep <= 0) return null;
    const createdAt = decoded.slice(0, sep);
    const id = decoded.slice(sep + 1);
    if (!createdAt || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

// Parses `?limit` and `?cursor` from a query object. Invalid input is
// clamped/ignored rather than rejected — a bad cursor just starts from the
// top, which is the safe, non-breaking behavior for a feed.
export function parseCursorParams(query: Record<string, unknown>): CursorParams {
  const rawLimit = parseInt(String(query.limit ?? ''), 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(MAX_LIMIT, Math.max(1, rawLimit))
    : DEFAULT_LIMIT;
  return { limit, cursor: decodeCursor(query.cursor) };
}

// Builds the response envelope from one over-fetched page. Call the query
// with `.limit(limit + 1)`: if the extra row came back there's another
// page, and its predecessor's (created_at,id) is the next cursor.
export function buildPage<T extends { createdAt?: string; created_at?: string; id: string }>(
  rows: T[],
  limit: number,
): Paginated<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  let nextCursor: string | null = null;
  if (hasMore && data.length > 0) {
    const last = data[data.length - 1];
    const ts = (last.createdAt ?? last.created_at) as string;
    nextCursor = encodeCursor(ts, last.id);
  }
  return { data, limit, nextCursor };
}

// Same as buildPage but the cursor's primary sort value is extracted by a
// caller-supplied function instead of assuming a `created_at` field. Use
// this for financial feeds that order by a *business* date (expense_date,
// paid_on, applied_on, voided_at) rather than insertion time. The query
// must `ORDER BY <thatColumn> DESC, id DESC` and over-fetch `limit + 1`.
export function buildPageWith<T extends { id: string }>(
  rows: T[],
  limit: number,
  sortValue: (row: T) => string,
): Paginated<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  let nextCursor: string | null = null;
  if (hasMore && data.length > 0) {
    const last = data[data.length - 1];
    nextCursor = encodeCursor(sortValue(last), last.id);
  }
  return { data, limit, nextCursor };
}

// PostgREST `.or()` predicate for "row strictly after the cursor" under a
// `<col> DESC, id DESC` ordering. The id tiebreak is essential: business
// dates collide constantly (many payments share a day), and date-only
// keyset silently skips or duplicates rows across page boundaries — a
// financial-correctness bug, not just a UX one.
export function keysetAfter(
  col: string,
  cursor: { createdAt: string; id: string },
): string {
  const v = cursor.createdAt;
  return `${col}.lt.${v},and(${col}.eq.${v},id.lt.${cursor.id})`;
}
