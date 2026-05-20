import express from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

import authRouter from './routes/auth';
import schoolsRouter from './routes/schools';
import chatAuditRouter from './routes/chatAudit';
import emailsRouter from './routes/emails';
import { requireMasterAuth } from './middleware/auth';

// SECURITY (M-2): the entire portal is one shared password. A trivially
// short secret turns the 15-min lockout into a fig leaf — make the
// process refuse to boot below 32 chars (~192 bits when fully random).
const masterSecret = process.env.MASTER_SECRET;
if (!masterSecret || masterSecret.length < 32) {
  throw new Error(
    'MASTER_SECRET is missing or too short (need at least 32 characters). ' +
    'Set a long, random value in master/server/.env before starting the portal.',
  );
}

const app = express();

app.use(cors({ origin: ['http://127.0.0.1:5174', 'http://localhost:5174'] }));
app.use(express.json());

// API routes
app.use('/api/auth', authRouter);
app.use('/api/schools', requireMasterAuth, schoolsRouter);
app.use('/api/chat-audit', requireMasterAuth, chatAuditRouter);
app.use('/api/emails', requireMasterAuth, emailsRouter);

// Serve built client in production
const clientDist = path.join(__dirname, '../../client/dist');
app.use(express.static(clientDist));
app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

const PORT = parseInt(process.env.MASTER_PORT || '5002');

app.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Master Portal server running at http://127.0.0.1:${PORT}`);
  console.log('  Bound to 127.0.0.1 only — not reachable from the internet\n');
});
