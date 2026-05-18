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
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception — exiting for a clean restart', { err });
  process.exit(1);
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
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) cb(null, true);
      else cb(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST'],
  },
});

// Middleware
app.use(helmet());
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) cb(null, true);
    else cb(new Error('Not allowed by CORS'));
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
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Global error handler — catches any unhandled errors from route handlers
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled error', { err, path: req.path, method: req.method });
  res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
});

// Authenticate socket connections via JWT — stores schoolId/userId in socket.data
io.use((socket, next) => {
  const token = socket.handshake.auth?.token as string | undefined;
  if (!token) return next(new Error('Authentication required'));
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as any;
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
