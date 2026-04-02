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

dotenv.config();

const app = express();
app.set('trust proxy', 1); // Trust Railway's reverse proxy for accurate IP in rate limiting
const httpServer = http.createServer(app);

// Socket.io setup
const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:5173',
  process.env.ACADEMIC_URL || 'http://localhost:5174',
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
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err);
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
});

export { io };
