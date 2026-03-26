import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

const router = Router();

router.post('/login', (req: Request, res: Response) => {
  const { secret } = req.body;
  if (!secret || secret !== process.env.MASTER_SECRET) {
    res.status(401).json({ error: 'Invalid secret' });
    return;
  }
  const token = jwt.sign({ master: true }, process.env.MASTER_SECRET!, {
    expiresIn: '8h',
  } as jwt.SignOptions);
  res.json({ token });
});

export default router;
