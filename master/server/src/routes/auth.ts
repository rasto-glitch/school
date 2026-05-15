import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { masterJwtSecret, secretMatches } from '../utils/masterAuth';

const router = Router();

router.post('/login', (req: Request, res: Response) => {
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
