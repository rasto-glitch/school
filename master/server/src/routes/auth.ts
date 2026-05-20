import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { masterJwtSecret, secretMatches } from '../utils/masterAuth';

const router = Router();

// SECURITY (M-2): brute-force defense for the single shared MASTER_SECRET.
// The portal binds 127.0.0.1 so this only matters against local-loopback
// attackers (compromised editor extension, malicious dependency, RDP) —
// but 5/15min keeps that path to roughly 480 attempts/day, which against
// any 32+ char secret is computationally pointless.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait 15 minutes.' },
});

router.post('/login', loginLimiter, (req: Request, res: Response) => {
  const { secret } = req.body;
  if (!secret || typeof secret !== 'string' || !secretMatches(secret)) {
    res.status(401).json({ error: 'Invalid secret' });
    return;
  }
  const token = jwt.sign({ master: true }, masterJwtSecret(), {
    expiresIn: '8h',
  } as jwt.SignOptions);
  res.json({ token });
});

export default router;
