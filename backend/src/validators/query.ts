import { z } from 'zod';

// Phase 3 — read-side query-string validation.
//
// Note on effect: in Express 5 `req.query` is a read-only getter, so
// `validate()` does NOT rewrite it (controllers already coerce query
// strings themselves). The sole purpose of a query schema is therefore
// to REJECT malformed/abusive input before it reaches a controller —
// principally unbounded free-text (`search`/`q`, a ReDoS/DoS vector) and
// non-numeric `limit`/`page`. Unknown filter keys are intentionally
// allowed through (`.passthrough()`): enumerating every per-endpoint
// filter would be churn for no security gain, and a too-strict query
// schema would 400 legitimate requests.
//
// GET `/:id` params are deliberately NOT validated: those ids flow into
// parameterized, tenant-scoped `.eq('id', id)` queries (no injection
// surface; a bad id just yields an empty/404 result), so a shape guard
// there would be pure churn.

const optStr = (max: number) => z.string().max(max).optional();
// digit-string with a length cap so `limit`/`page` can't be absurd.
const digitStr = z.string().regex(/^\d{1,9}$/, 'must be a number').optional();

export const listQuery = z.object({
  cursor: optStr(512),
  limit: digitStr,
  page: digitStr,
  // free text — the main thing worth bounding
  search: optStr(200),
  q: optStr(200),
  // common filters across feeds / reports / accounting
  startDate: optStr(40),
  endDate: optStr(40),
  asOf: optStr(40),
  type: optStr(40),
  kind: optStr(40),
  status: optStr(40),
  sources: optStr(160),
  currency: optStr(12),
  categoryId: optStr(64),
  studentFeeId: optStr(64),
  classId: optStr(64),
  mine: optStr(8),
}).passthrough();
