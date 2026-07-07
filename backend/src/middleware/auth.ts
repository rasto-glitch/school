import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../config/supabase';
import { adminDb, tenantDb } from '../utils/db';
import { logger } from '../utils/logger';
import type { Capability } from '../constants/clearance';
import { isCapability } from '../constants/clearance';

export interface AuthPayload {
  userId: string;
  schoolId: string;
  role: 'parent' | 'teacher' | 'admin' | 'driver' | 'supervisor' | 'reception' | 'accountant' | 'staff';
  username: string;
  featuresVersion?: number;
}

// Per-request admin clearance, loaded fresh from the DB (NOT from the JWT) so
// a grant/revoke takes effect on the very next request without a re-login —
// same philosophy as isHrOfficer. Attached by authorizeCapability().
export interface Clearance {
  isOwner: boolean;
  capabilities: Capability[];
}

export interface AuthRequest extends Request {
  user?: AuthPayload;
  // RLS Phase 1: an authenticated-role, school-scoped Supabase client
  // attached on every successful authenticate(). Controllers will migrate
  // from the shared service-role `supabase` import to `req.db` in Phase 3;
  // until then this property is set but unused.
  db?: SupabaseClient;
  // Admin capability clearance (Phase A). Populated by authorizeCapability()
  // when a route gates on a capability; controllers can also load it on
  // demand via loadClearance().
  clearance?: Clearance;
  // The school's feature flags, attached by authenticate() (already fetched
  // there for the features_version check) so requireFeature() costs no
  // extra query.
  schoolFeatures?: Record<string, boolean> | null;
}

// Endpoints a user with must_change_password=true may still reach — the
// ones needed to actually change the password or sign out. Everything else
// is blocked until they pick a real password (see the gate in authenticate).
// Matched by suffix so it's independent of the router's mount prefix.
const PASSWORD_CHANGE_EXEMPT_SUFFIXES = [
  '/auth/first-time-change-password',
  '/auth/change-password',
  '/auth/logout',
  '/auth/logout-all',
  '/auth/me',
];
function isPasswordChangeExempt(path: string): boolean {
  return PASSWORD_CHANGE_EXEMPT_SUFFIXES.some((s) => path === s || path.endsWith(s));
}

export async function authenticate(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }

  const token = authHeader.split(' ')[1];
  let decoded: AuthPayload & { iat?: number };
  try {
    // SECURITY (M-5): pin the algorithm to HS256. jsonwebtoken v9 refuses
    // alg=none by default, but pinning here defeats any future regression
    // and any algorithm-confusion attack (e.g. RS256 with a string key).
    decoded = jwt.verify(token, process.env.JWT_SECRET!, { algorithms: ['HS256'] }) as AuthPayload & { iat?: number };
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  const { data: user } = await supabase
    .from('users')
    .select('is_active, password_changed_at, must_change_password, schools(is_active, features_version, features)')
    .eq('id', decoded.userId)
    .single();

  // SECURITY (M-6): collapse every post-token-validation failure to the
  // same generic message + 401 so a holder of a stolen / old token can't
  // probe distinct account states (active vs deactivated vs school
  // deactivated vs password rotated vs features-version stale). The
  // detailed reason still lands in server logs for operator triage.
  const FORCE_RELOGIN = 'Session invalid. Please log in again.';

  if (!user || !user.is_active) {
    logger.info('authenticate rejected', { reason: !user ? 'no_user' : 'inactive_user', userId: decoded.userId });
    res.status(401).json({ error: FORCE_RELOGIN });
    return;
  }

  const school = user.schools as unknown as { is_active: boolean; features_version: number; features: Record<string, boolean> | null } | null;

  if (!school?.is_active) {
    logger.info('authenticate rejected', { reason: 'school_inactive', userId: decoded.userId });
    res.status(401).json({ error: FORCE_RELOGIN });
    return;
  }

  if (school.features_version > (decoded.featuresVersion ?? 1)) {
    logger.info('authenticate rejected', { reason: 'features_version_stale', userId: decoded.userId });
    res.status(401).json({ error: FORCE_RELOGIN });
    return;
  }

  // Accountant role is gated by the premium tuition_fees feature.
  // If the school drops below premium, existing accountant accounts can't authenticate.
  // Distinct 403 because this is a billing/feature state, not a stolen-token
  // enumeration vector.
  if (decoded.role === 'accountant' && school.features?.tuition_fees !== true) {
    res.status(403).json({ error: 'Accounting module is not enabled for this school.' });
    return;
  }

  if (user.password_changed_at && decoded.iat) {
    const changedAt = new Date(user.password_changed_at).getTime();
    if (changedAt > decoded.iat * 1000) {
      logger.info('authenticate rejected', { reason: 'password_changed', userId: decoded.userId });
      res.status(401).json({ error: FORCE_RELOGIN });
      return;
    }
  }

  // SECURITY: accounts created with a shipped default password
  // (Parent@123 / Teacher@123 / …) carry must_change_password=true. The web
  // and mobile clients already force the change screen, but that gate is
  // UI-only — a non-UI client (raw HTTP, e.g. the okhttp logins observed
  // against the demo account) could sign in with the public default and
  // operate the account without ever changing it. Enforce it server-side:
  // block every endpoint except the ones needed to change the password or
  // sign out. Distinct 403 + code so a client can route to the change screen
  // (this isn't an enumeration vector — the caller already holds a valid
  // token for their own account, unlike the generic-401 cases above).
  if (
    (user as { must_change_password?: boolean }).must_change_password &&
    !isPasswordChangeExempt(req.path)
  ) {
    logger.info('authenticate blocked: password change required', { userId: decoded.userId, path: req.path });
    res.status(403).json({
      error: 'You must set a new password before continuing.',
      code: 'PASSWORD_CHANGE_REQUIRED',
    });
    return;
  }

  req.user = decoded;
  req.schoolFeatures = school.features ?? null;
  // Attach a per-request, RLS-bound client. Phase 1 is inert (no policies
  // enforced yet, or envs not set → falls back to adminDb). Controllers
  // start using req.db in Phase 3.
  req.db = tenantDb(decoded);
  next();
}

// ── Feature flags (master-portal provisioned) ───────────────────────────────
// Opt-in gate: the flag must be exactly true in schools.features — a missing
// key means not enabled, so a school whose JSONB pre-dates the flag never
// gets it silently. `hr` additionally requires `archive` (employee records
// sit on the archive retention tier); the master portal enforces that
// dependency at write time, this re-check covers hand-edited rows.
export function requireFeature(flag: string) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const f = req.schoolFeatures;
    const on = f?.[flag] === true && (flag !== 'hr' || f?.archive === true);
    if (!on) {
      res.status(403).json({ error: 'This feature is not enabled for your school.', code: 'FEATURE_DISABLED', feature: flag });
      return;
    }
    next();
  };
}

export function authorize(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Forbidden: insufficient permissions' });
      return;
    }
    next();
  };
}

// ── Admin capability clearance (Phase A) ────────────────────────────────────
// Loads an admin's clearance (is_owner + admin_capabilities) from the DB. An
// Owner is treated as holding every capability implicitly, so capability
// checks reduce to a single `isOwner || capabilities.includes(cap)`. Reads
// fresh on each call (not cached, not from the JWT) so grants take effect
// immediately — mirrors isHrOfficer().
export async function loadClearance(userId: string): Promise<Clearance> {
  const { data } = await adminDb
    .from('users')
    .select('is_owner, admin_capabilities')
    .eq('id', userId)
    .maybeSingle();
  const isOwner = data?.is_owner === true;
  const capabilities = Array.isArray(data?.admin_capabilities)
    ? (data!.admin_capabilities as string[]).filter(isCapability)
    : [];
  return { isOwner, capabilities };
}

export function clearanceHas(c: Clearance, cap: Capability): boolean {
  return c.isOwner || c.capabilities.includes(cap);
}

// Route guard: require the admin role AND a specific capability. Attaches
// req.clearance for the controller. An Owner passes every capability.
export function authorizeCapability(cap: Capability) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user || req.user.role !== 'admin') {
      res.status(403).json({ error: 'Forbidden: insufficient permissions' });
      return;
    }
    const clearance = await loadClearance(req.user.userId);
    if (!clearanceHas(clearance, cap)) {
      res.status(403).json({ error: 'Forbidden: insufficient permissions' });
      return;
    }
    req.clearance = clearance;
    next();
  };
}

// Like authorizeCapability but passes if the admin holds ANY of the listed
// capabilities (or is an Owner). Used for reads that legitimately serve more
// than one role — e.g. the account roster is read both operationally
// (staff.manage, employee list) and by IT (accounts.manage, Accounts page).
export function authorizeAnyCapability(...caps: Capability[]) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user || req.user.role !== 'admin') {
      res.status(403).json({ error: 'Forbidden: insufficient permissions' });
      return;
    }
    const clearance = await loadClearance(req.user.userId);
    if (!(clearance.isOwner || caps.some(c => clearance.capabilities.includes(c)))) {
      res.status(403).json({ error: 'Forbidden: insufficient permissions' });
      return;
    }
    req.clearance = clearance;
    next();
  };
}
