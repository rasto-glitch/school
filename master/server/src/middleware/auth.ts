import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export function requireMasterAuth(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const token = auth.slice(7);
  try {
    jwt.verify(token, process.env.MASTER_SECRET!);
    next();
  } catch {
    res.status(401).json({ error: 'Session expired — please log in again' });
  }
}
