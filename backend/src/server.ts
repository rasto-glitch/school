import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import { Server as SocketServer } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { createRouter } from './routes/index';
import { setIo } from './utils/notify';
import { startBackupVerifySchedule } from './utils/backupVerify';
import { logger } from './utils/logger';
import { reportError } from './utils/alerting';
import { supabase } from './config/supabase';

dotenv.config();

// Fail fast on a missing/weak signing secret. Every JWT in the system is
// only as strong as this value; `config/supabase.ts` already throws on its
// own missing vars, but JWT_SECRET was only ever asserted with `!` — an
// unset or trivially short secret would let the server boot and mint
// forgeable tokens. 32 chars ≈ 192 bits of entropy at minimum.
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 32) {
  throw new Error(
    'JWT_SECRET is missing or too short (need at least 32 characters). ' +
    'Set a long, random value in the environment before starting the server.',
  );
}

// A stray rejected promise or uncaught throw must be logged, not silently
// swallowed (or worse, crash the process with no trace). We log and, for a
// truly uncaught exception, exit so the platform restarts a clean process.
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason });
  void reportError('Unhandled promise rejection', reason);
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception — exiting for a clean restart', { err });
  // Best-effort: give the alert email a brief window to flush before the
  // process exits for a clean restart. Bounded so we never hang a crash.
  reportError('uncaughtException', err).finally(() => process.exit(1));
  setTimeout(() => process.exit(1), 2000).unref();
});

const app = express();
app.set('trust proxy', 1); // Trust Railway's reverse proxy for accurate IP in rate limiting
const httpServer = http.createServer(app);

// Socket.io setup
// Each *_URL env var may hold a comma-separated list (e.g. apex + www)
const splitOrigins = (v: string | undefined, fallback: string) =>
  (v || fallback).split(',').map(s => s.trim()).filter(Boolean);

const allowedOrigins = [
  ...splitOrigins(process.env.FRONTEND_URL, 'http://localhost:5173'),
  ...splitOrigins(process.env.ACADEMIC_URL, 'http://localhost:5174'),
  ...splitOrigins(process.env.LANDING_URL, 'http://localhost:5175'),
];

const io = new SocketServer(httpServer, {
  cors: {
    // Allow the web frontend + React Native (which sends no Origin header)
    // SECURITY (I-5): refuse silently rather than throwing — a thrown
    // error here would propagate up as a 500 and trip our error-alert
    // pipeline on every routine origin probe.
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) cb(null, true);
      else cb(null, false);
    },
    methods: ['GET', 'POST'],
  },
});

// Middleware
app.use(helmet());
app.use(cors({
  // SECURITY (I-5): same silent-reject as above. Without an
  // Access-Control-Allow-Origin header, the browser blocks the response
  // from JS — that's the security boundary. Throwing 500 here just
  // spammed reportError() on every disallowed origin.
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) cb(null, true);
    else cb(null, false);
  },
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting

// Strict limiter for login — 10 attempts per 15 minutes per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please wait 15 minutes before trying again.' },
});
app.use('/api/auth/login', loginLimiter);

// Strict limiter for forgot-password — 5 requests per 15 minutes per IP
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password reset requests. Please wait 15 minutes before trying again.' },
});
app.use('/api/auth/forgot-password', forgotPasswordLimiter);
app.use('/api/auth/forgot-password-email', forgotPasswordLimiter);

// Public token-redemption endpoints (the token IS the auth, but we still
// don't want unbounded guessing). 30 requests/min/IP is plenty for a real
// user clicking a link, way too slow for brute force on 32-byte tokens.
const tokenRedeemLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});
app.use('/api/auth/reset-with-token', tokenRedeemLimiter);
app.use('/api/auth/confirm-email', tokenRedeemLimiter);

// Refresh-token rotation. A legit client refreshes ~once per access-token
// lifetime (~15 min); 120 / 15 min / IP is generous for NAT'd schools yet
// caps abuse. (Brute-forcing a 256-bit opaque token is infeasible anyway.)
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many session refreshes. Please log in again.' },
});
app.use('/api/auth/refresh', refreshLimiter);

// Strict limiter for landing-page submissions — 5 per 15 minutes per IP
const publicFormLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many submissions. Please try again later.' },
});
app.use('/api/public/', publicFormLimiter);

// Loose limiter for the public schools list — 60 requests per minute per IP
const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});
app.use('/api/schools', publicLimiter);

// General backstop for all other API routes — 200 requests per minute per IP
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});
app.use('/api/', apiLimiter);

// Routes
app.use('/api', createRouter(io));

// Health check
// Health check — shallow liveness PLUS a cheap, bounded DB-connectivity
// probe so an external uptime monitor / Railway healthcheck can detect a
// dead database, not just a live process. The query is a single-row id
// read with a 3s ceiling; on failure we return 503 (degraded) rather than
// throwing, and we never leak the underlying error to the caller.
app.get('/health', async (_req, res) => {
  let db: 'ok' | 'down' = 'ok';
  try {
    const probe = supabase
      // tenant-check-allow: liveness probe, not a tenant-scoped data read
      .from('schools').select('id').limit(1);
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('db_probe_timeout')), 3000));
    const { error } = (await Promise.race([probe, timeout])) as { error: unknown };
    if (error) db = 'down';
  } catch {
    db = 'down';
  }
  res
    .status(db === 'ok' ? 200 : 503)
    .json({ status: db === 'ok' ? 'ok' : 'degraded', db, timestamp: new Date().toISOString() });
});

// Global error handler — catches any unhandled errors from route handlers
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled error', { err, path: req.path, method: req.method });
  void reportError('Unhandled HTTP error', err, { path: req.path, method: req.method });
  res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
});

// Authenticate socket connections via JWT — stores schoolId/userId in socket.data
io.use((socket, next) => {
  const token = socket.handshake.auth?.token as string | undefined;
  if (!token) return next(new Error('Authentication required'));
  try {
    // SECURITY (M-5): explicit algorithm pin — see middleware/auth.ts.
    const payload = jwt.verify(token, process.env.JWT_SECRET!, { algorithms: ['HS256'] }) as any;
    socket.data.schoolId = payload.schoolId;
    socket.data.userId = payload.userId;
    socket.data.role = payload.role;
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

// Socket.io connection handling
io.on('connection', (socket) => {
  const { schoolId, userId } = socket.data as { schoolId: string; userId: string };

  // Auto-join personal notification room (scoped by school)
  socket.join(`school:${schoolId}:user:${userId}`);

  // Admins and reception join a school-wide room for real-time appointment alerts
  if (socket.data.role === 'admin' || socket.data.role === 'reception') {
    socket.join(`school:${schoolId}:admins`);
  }

  // Parent joins a room to watch a specific driver (scoped by school, UUID-validated to prevent room spam)
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  socket.on('watchDriver', (driverId: string) => {
    if (typeof driverId !== 'string' || !UUID_RE.test(driverId)) return;
    socket.join(`school:${schoolId}:driver:${driverId}`);
  });

  // Forward typing indicator to the other participant's room
  socket.on('chat:typing', (data: { conversationId: string; recipientId: string; isTyping: boolean }) => {
    if (
      typeof data?.conversationId !== 'string' || !UUID_RE.test(data.conversationId) ||
      typeof data?.recipientId !== 'string' || !UUID_RE.test(data.recipientId)
    ) return;
    io.to(`school:${schoolId}:user:${data.recipientId}`).emit('chat:typing', {
      conversationId: data.conversationId,
      senderId: userId,
      isTyping: !!data.isTyping,
    });
  });

  socket.on('disconnect', () => {});
});

// Register io instance with notification helper
setIo(io);

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
  startBackupVerifySchedule();
});

export { io };
