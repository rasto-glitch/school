import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { supabase } from '../config/supabase';

export interface AuthPayload {
  userId: string;
  schoolId: string;
  role: 'parent' | 'teacher' | 'admin' | 'driver';
  username: string;
  featuresVersion?: number;
}

export interface AuthRequest extends Request {
  user?: AuthPayload;
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
    .select('is_active, password_changed_at, schools(is_active, features_version)')
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

  const school = user.schools as unknown as { is_active: boolean; features_version: number } | null;

  if (!school?.is_active) {
    res.status(401).json({ error: 'School is deactivated' });
    return;
  }

  if (school.features_version > (decoded.featuresVersion ?? 1)) {
    res.status(401).json({ error: 'School settings updated. Please log in again.' });
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
