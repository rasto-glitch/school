import { createClient, SupabaseClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import { supabase as serviceRoleClient } from '../config/supabase';
import { logger } from './logger';
import type { AuthPayload } from '../middleware/auth';

// ───────────────────────────────────────────────────────────────────────
// RLS plumbing — Phase 1 (inert).
//
// Two clients. Pick the right one per call site:
//
//   adminDb     — the existing service-role client, BYPASSRLS. Use ONLY
//                 for legitimately cross-tenant paths (auth/login, public
//                 forms, /inbound/email, master portal, the 53 grand-
//                 fathered queries inventoried in Phase 0, cron jobs).
//
//   tenantDb(c) — per-request client. Carries a short-lived JWT signed
//                 with SUPABASE_JWT_SECRET, role='authenticated' (no
//                 BYPASSRLS) and a `school_id` claim. Once Phase-4
//                 policies are enabled, queries through this client are
//                 *physically* limited to the caller's school.
//
// Phase 1 contract: nothing changes today. Controllers all still use the
// existing `supabase` import (= adminDb). If the new envs aren't set, or
// before any RLS policies exist, `tenantDb()` is operationally equivalent
// to `adminDb` — no behavior change, just plumbing in place to flip later.
// ───────────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL!;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const PG_JWT_SECRET = process.env.SUPABASE_JWT_SECRET;

export const adminDb: SupabaseClient = serviceRoleClient;

// Boot-time guidance. We do NOT throw — Phase 1 is inert by design and
// the app must keep booting without these set. The warn surfaces in
// Railway logs as a single line so the operator knows what's missing
// before Phase 4 turns enforcement on.
const tenantReady = !!(ANON_KEY && PG_JWT_SECRET);
if (!tenantReady) {
  logger.warn(
    'RLS tenant client not fully configured (SUPABASE_ANON_KEY / SUPABASE_JWT_SECRET missing); tenantDb() will fall back to adminDb for now.',
  );
}

const TENANT_TOKEN_TTL_SECONDS = 60;

/**
 * Per-request, RLS-bound DB client. Until Phase-4 policies are enabled
 * (or until the two envs are set), this returns adminDb so the app keeps
 * working unchanged.
 */
export function tenantDb(
  claims: Pick<AuthPayload, 'userId' | 'schoolId' | 'role'>,
): SupabaseClient {
  if (!tenantReady) return adminDb;
  const token = jwt.sign(
    {
      // PostgREST switches to this Postgres role — must NOT be a role
      // with BYPASSRLS or the policies are inert again.
      role: 'authenticated',
      aud: 'authenticated',
      iss: 'scholify-backend',
      sub: claims.userId,
      // Custom claims read by policies via
      //   current_setting('request.jwt.claims', true)::jsonb ->> 'school_id'
      school_id: claims.schoolId,
      user_id: claims.userId,
      app_role: claims.role,
    },
    PG_JWT_SECRET as string,
    { algorithm: 'HS256', expiresIn: TENANT_TOKEN_TTL_SECONDS },
  );
  return createClient(SUPABASE_URL, ANON_KEY as string, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}
