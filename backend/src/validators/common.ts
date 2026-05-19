import { z } from 'zod';

// Shared zod primitives. Keep validation INTENTIONALLY lenient where a
// controller is already lenient — the goal of Phase 1 is to reject clearly
// malformed / hostile input and strip unknown keys (mass-assignment), NOT
// to change behavior for inputs the handlers already accept.

/** Trimmed, non-empty string with an upper bound (DoS guard on length). */
export const nonEmptyStr = (max = 500) =>
  z.string().trim().min(1).max(max);

/** Optional trimmed string; '' and undefined both become undefined. */
export const optionalStr = (max = 500) =>
  z.string().trim().max(max).optional().or(z.literal('').transform(() => undefined));

/**
 * UUID — used for :id route params and id-bearing bodies.
 *
 * Deliberately a LENIENT shape check (8-4-4-4-12 hex), NOT zod's strict
 * `.uuid()`. zod v4's `.uuid()` enforces RFC4122 version/variant bits;
 * rejecting a structurally-valid id just because it isn't a v4 UUID would
 * turn into spurious 400s on money/admin routes. This still blocks path
 * traversal, SQL fragments, and other garbage — which is the actual goal.
 */
export const uuid = z.string().regex(
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
  'Invalid id',
);

/** Money amount: finite, non-negative, sane upper bound. */
export const amount = z.number().finite().nonnegative().max(1_000_000_000);

/** Positive money amount (payments must be > 0). */
export const positiveAmount = z.number().finite().positive().max(1_000_000_000);

/** ISO date `YYYY-MM-DD` (matches how the controllers store/compare dates). */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected date as YYYY-MM-DD');

/** Currency code — 1–8 chars, matches the existing `currency` handling. */
export const currency = z.string().trim().min(1).max(8);

/** Email — mirrors the regex the auth controller already enforces. */
export const email = z.string().trim().toLowerCase()
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email address').max(254);

/** Keyset pagination cursor (opaque base64url) — optional everywhere. */
export const cursor = z.string().max(512).optional();
