import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { masterJwtSecret } from '../utils/masterAuth';

export function requireMasterAuth(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const token = auth.slice(7);
  try {
    // SECURITY (M-5): pin the algorithm; matches the backend's posture.
    jwt.verify(token, masterJwtSecret(), { algorithms: ['HS256'] });
    next();
  } catch {
    res.status(401).json({ error: 'Session expired — please log in again' });
  }
}
