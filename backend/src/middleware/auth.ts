import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../config/supabase';
import { tenantDb } from '../utils/db';

export interface AuthPayload {
  userId: string;
  schoolId: string;
  role: 'parent' | 'teacher' | 'admin' | 'driver' | 'supervisor' | 'reception' | 'accountant';
  username: string;
  featuresVersion?: number;
}

export interface AuthRequest extends Request {
  user?: AuthPayload;
  // RLS Phase 1: an authenticated-role, school-scoped Supabase client
  // attached on every successful authenticate(). Controllers will migrate
  // from the shared service-role `supabase` import to `req.db` in Phase 3;
  // until then this property is set but unused.
  db?: SupabaseClient;
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
    decoded = jwt.verify(token, process.env.JWT_SECRET!) as AuthPayload & { iat?: number };
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  const { data: user } = await supabase
    .from('users')
    .select('is_active, password_changed_at, schools(is_active, features_version, features)')
    .eq('id', decoded.userId)
    .single();

  if (!user) {
    res.status(401).json({ error: 'Account not found' });
    return;
  }

  if (!user.is_active) {
    res.status(401).json({ error: 'Account is deactivated' });
    return;
  }

  const school = user.schools as unknown as { is_active: boolean; features_version: number; features: Record<string, boolean> | null } | null;

  if (!school?.is_active) {
    res.status(401).json({ error: 'School is deactivated' });
    return;
  }

  if (school.features_version > (decoded.featuresVersion ?? 1)) {
    res.status(401).json({ error: 'School settings updated. Please log in again.' });
    return;
  }

  // Accountant role is gated by the premium tuition_fees feature.
  // If the school drops below premium, existing accountant accounts can't authenticate.
  if (decoded.role === 'accountant' && school.features?.tuition_fees !== true) {
    res.status(403).json({ error: 'Accounting module is not enabled for this school.' });
    return;
  }

  if (user.password_changed_at && decoded.iat) {
    const changedAt = new Date(user.password_changed_at).getTime();
    if (changedAt > decoded.iat * 1000) {
      res.status(401).json({ error: 'Session invalidated. Please log in again.' });
      return;
    }
  }

  req.user = decoded;
  // Attach a per-request, RLS-bound client. Phase 1 is inert (no policies
  // enforced yet, or envs not set → falls back to adminDb). Controllers
  // start using req.db in Phase 3.
  req.db = tenantDb(decoded);
  next();
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
