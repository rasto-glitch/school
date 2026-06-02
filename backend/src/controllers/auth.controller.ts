import { safeDbErrorMessage, safeDbErrorStatus } from '../utils/dbErrors';
import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
// Auth flows are intentionally elevated: login/refresh look up users
// pre-tenant, and password/email/device-token operations are server-
// orchestrated. adminDb keeps service-role semantics here (Phase 0
// elevated-path inventory).
import { adminDb as supabase } from '../utils/db';
import { safeExt } from '../utils/upload';
import { toCC } from '../utils/transform';
import { emitToAdmins, getIo, notify } from '../utils/notify';
import { logger } from '../utils/logger';
import { sendMail } from '../utils/mailer';
import { isStrongPassword, PASSWORD_POLICY_MESSAGE } from '../utils/passwordPolicy';
import { logAudit } from '../utils/audit';
import { isMfaActive, verifyMfaCodeForUser } from './mfa.controller';
import type { AuthRequest } from '../middleware/auth';
// Public landing host where /reset-password and /confirm-email live.
// First value is treated as canonical; the rest are accepted at runtime
// (kept consistent with server.ts's allowedOrigins parsing).
const LANDING_URL = (process.env.LANDING_URL || 'http://localhost:5175').split(',')[0].trim();
// Portal host where the account recovery page lives. Same trim convention.
const PORTAL_URL = (process.env.FRONTEND_URL || 'http://localhost:5173').split(',')[0].trim();

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;          // 1 hour
const EMAIL_CHANGE_TTL_MS = 10 * 60 * 1000;         // 10 minutes — 6-digit OTP
const EMAIL_CHANGE_MAX_ATTEMPTS = 5;                // burn the token after this many wrong codes
const ACCOUNT_RECOVERY_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7-day anchor window
// MFA ticket — a short-lived signed JWT proving the user passed the
// password step. The MFA-verify endpoint exchanges it (+ a TOTP / recovery
// code) for real tokens. Kept short so a leaked ticket isn't a usable
// half-credential for long.
const MFA_TICKET_TTL = '5m';

// Access token is deliberately short-lived: a leaked one dies fast. The
// 7-day user-visible session is preserved by the rotating refresh token.
const ACCESS_TOKEN_TTL = process.env.JWT_ACCESS_EXPIRE || '15m';
const REFRESH_TOKEN_TTL_MS =
  (parseInt(process.env.REFRESH_TOKEN_DAYS || '7', 10) || 7) * 24 * 60 * 60 * 1000;

interface TokenUser { id: string; role: string; username: string; }

function signAccessToken(user: TokenUser, schoolId: string, featuresVersion: number): string {
  return jwt.sign(
    { userId: user.id, schoolId, role: user.role, username: user.username, featuresVersion },
    process.env.JWT_SECRET!,
    { expiresIn: ACCESS_TOKEN_TTL } as jwt.SignOptions,
  );
}

// Issues a fresh access token + a new refresh token row. Pass `familyId`
// to keep a rotation chain together; omit it to start a new session.
async function issueTokenPair(
  user: TokenUser,
  schoolId: string,
  featuresVersion: number,
  req: Request,
  familyId?: string,
): Promise<{ token: string; refreshToken: string }> {
  const token = signAccessToken(user, schoolId, featuresVersion);
  const raw = generateToken();
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS).toISOString();
  // SECURITY (H-3): `trust proxy: 1` is set in server.ts, so req.ip is
  // already the real client IP from Railway's reverse proxy. Reading
  // X-Forwarded-For directly took the LEFTMOST value, which is
  // client-controlled — an attacker could spoof their IP into our
  // forensics tables. Use req.ip everywhere.
  const ip = req.ip || null;
  const userAgent = ((req.headers['user-agent'] as string) || '').slice(0, 300) || null;
  // tenant-check-allow: refresh_tokens is user-keyed (token_hash uniquely identifies the row); school_id is stored for cascade + scoping
  await supabase.from('refresh_tokens').insert({
    school_id: schoolId,
    user_id: user.id,
    token_hash: hashToken(raw),
    family_id: familyId || crypto.randomUUID(),
    expires_at: expiresAt,
    ip,
    user_agent: userAgent,
  });
  return { token, refreshToken: raw };
}

// Coarse, dependency-free device label from a User-Agent. Intentionally
// not granular (no version numbers) so it stays stable across browser /
// app updates — enough for a user to judge "that wasn't me".
function describeDevice(ua: string): string {
  if (!ua) return 'an unrecognized device';
  const s = ua.toLowerCase();
  let os = 'an unknown system';
  if (s.includes('iphone') || s.includes('ipad') || /\bios\b/.test(s)) os = 'iOS';
  else if (s.includes('android')) os = 'Android';
  else if (s.includes('windows')) os = 'Windows';
  else if (s.includes('mac os') || s.includes('macintosh')) os = 'macOS';
  else if (s.includes('linux')) os = 'Linux';
  let app = 'a browser';
  if (s.includes('scholify') || s.includes('expo') || s.includes('okhttp') || s.includes('cfnetwork')) app = 'the Scholify app';
  else if (s.includes('edg/')) app = 'Edge';
  else if (s.includes('chrome/')) app = 'Chrome';
  else if (s.includes('firefox/')) app = 'Firefox';
  else if (s.includes('safari/')) app = 'Safari';
  return `${app} on ${os}`;
}

// True when this login looks like a NEW device/location for the user:
// no refresh-token row in the last 30 days with the same user-agent OR
// the same IP. Runs BEFORE this login's own refresh row is inserted, so
// it never matches itself. Fails CLOSED (returns false = no alert) on any
// error so a DB hiccup can never spam the whole user base.
async function isNewSignIn(userId: string, ua: string, ip: string | null): Promise<boolean> {
  try {
    if (!ua) return false; // unfingerprintable client → stay quiet
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    // tenant-check-allow: refresh_tokens is user-keyed (filtered by user_id)
    const { data: uaHit, error: e1 } = await supabase
      .from('refresh_tokens')
      .select('id')
      .eq('user_id', userId)
      .eq('user_agent', ua)
      .gte('created_at', since)
      .limit(1);
    if (e1) return false;
    if (uaHit && uaHit.length > 0) return false;
    if (ip) {
      // tenant-check-allow: refresh_tokens is user-keyed (filtered by user_id)
      const { data: ipHit, error: e2 } = await supabase
        .from('refresh_tokens')
        .select('id')
        .eq('user_id', userId)
        .eq('ip', ip)
        .gte('created_at', since)
        .limit(1);
      if (e2) return false;
      if (ipHit && ipHit.length > 0) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// Fire-and-forget: in-app notification + mobile push (via notify()) and a
// best-effort email. Never throws into the caller.
async function notifyNewSignIn(opts: {
  schoolId: string; userId: string; email: string | null;
  firstName: string; ua: string; ip: string | null;
}): Promise<void> {
  const device = describeDevice(opts.ua);
  const when = new Date().toUTCString();
  const ipPart = opts.ip ? ` (IP ${opts.ip})` : '';
  const title = 'New sign-in to your account';
  const message =
    `Your account was just signed in on ${device}${ipPart} at ${when}. ` +
    `If this wasn't you, change your password immediately — that signs out every device.`;

  await notify({ schoolId: opts.schoolId, userId: opts.userId, title, message, type: 'system' })
    .catch((err) => logger.error('New sign-in notify failed', { err }));

  if (opts.email) {
    const safeName = escapeHtml(opts.firstName) || 'there';
    const text = [
      `Hi ${opts.firstName || 'there'},`,
      '',
      `Your Scholify account was just signed in on ${device}${ipPart} at ${when}.`,
      '',
      'If this was you, no action is needed.',
      "If this wasn't you, change your password immediately — it signs out every device, including whoever signed in.",
    ].join('\n');
    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,Inter,sans-serif;background:#f8fafc;padding:24px">
        <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden">
          <div style="background:#6366F1;padding:20px 24px;color:#fff">
            <div style="font-size:12px;opacity:.8;letter-spacing:.06em;text-transform:uppercase">Scholify</div>
            <div style="font-size:20px;font-weight:800;margin-top:4px">New sign-in to your account</div>
          </div>
          <div style="padding:24px;color:#0f172a">
            <p style="margin:0 0 12px;font-size:14px">Hi ${safeName},</p>
            <p style="margin:0 0 16px;font-size:14px;line-height:1.55">Your Scholify account was just signed in on <strong>${escapeHtml(device)}</strong>${opts.ip ? ` (IP ${escapeHtml(opts.ip)})` : ''} at <strong>${escapeHtml(when)}</strong>.</p>
            <p style="margin:0 0 16px;font-size:14px;line-height:1.55">If this was you, no action is needed. If this wasn't you, change your password immediately — it signs out every device, including whoever signed in.</p>
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">
            <p style="margin:0;font-size:12px;color:#64748b">You're receiving this because the sign-in came from a device or network we hadn't seen on your account recently.</p>
          </div>
        </div>
      </div>`;
    try {
      await sendMail(opts.email, 'New sign-in to your Scholify account', html, text);
    } catch (err) {
      logger.error('New sign-in email failed', { err });
    }
  }
}

const hashToken = (raw: string): string =>
  crypto.createHash('sha256').update(raw).digest('hex');

const generateToken = (): string =>
  crypto.randomBytes(32).toString('hex');

// 6-digit zero-padded OTP. crypto.randomInt is uniform across the range.
const generateOtpCode = (): string =>
  crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c),
  );


export async function getSchools(_req: Request, res: Response): Promise<void> {
  const { data, error } = await supabase
    .from('schools')
    .select('id, name, slug, logo_url, primary_color')
    .eq('is_active', true)
    .order('name');
  if (error) { res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) }); return; }
  res.json(toCC(data || []));
}

export async function login(req: Request, res: Response): Promise<void> {
  const { username, password, portal } = req.body;

  if (!username || !password) {
    res.status(400).json({ error: 'username and password are required' });
    return;
  }

  // Parse school abbreviation from username prefix (e.g. "fisk_karzanahmed" → "fisk")
  const underscoreIdx = username.indexOf('_');
  if (underscoreIdx === -1) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }
  const abbreviation = username.substring(0, underscoreIdx).toLowerCase();

  // Find school by abbreviation.
  // SECURITY (M-1): escape LIKE wildcards (% and _) so an attacker can't
  // submit username=%_foo and have the SQL pattern match every school.
  const safeAbbrev = abbreviation.replace(/[\\%_]/g, '\\$&');
  const { data: school, error: schoolErr } = await supabase
    .from('schools')
    .select('id, name, slug, logo_url, primary_color, secondary_color, features, features_version, timezone')
    .ilike('abbreviation', safeAbbrev)
    .eq('is_active', true)
    .single();

  if (schoolErr || !school) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  // Check if academic portal is enabled for this school (only when logging in via academic portal)
  if (portal === 'academic' && school.features?.academic_portal === false) {
    res.status(403).json({ error: 'Academic portal is not enabled for this school. Please contact your administrator.' });
    return;
  }

  // Find user
  const { data: user, error: userErr } = await supabase
    .from('users')
    .select('id, username, password_hash, role, first_name, last_name, profile_picture, email, is_active')
    .eq('school_id', school.id)
    .eq('username', username)
    .single();

  if (userErr || !user || !user.is_active) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  // Capture device/IP and decide if this is a new sign-in BEFORE issuing
  // this login's refresh row (so the check can't match itself).
  // SECURITY (H-3): req.ip is trustworthy under `trust proxy: 1`; the
  // X-Forwarded-For leftmost is attacker-controlled.
  const signInUa = ((req.headers['user-agent'] as string) || '').slice(0, 300);
  const signInIp = req.ip || null;
  const newSignIn = await isNewSignIn(user.id, signInUa, signInIp);

  // MFA gate: if this user has TOTP enabled, password alone isn't
  // enough. We mint a short-lived "ticket" that proves they passed the
  // password step, and the verify-mfa endpoint exchanges it (+ a code)
  // for real tokens. The ticket is a separate JWT type so it can't be
  // mistaken for an access token.
  const mfaActive = await isMfaActive(user.id);
  if (mfaActive) {
    const mfaTicket = jwt.sign(
      { userId: user.id, schoolId: school.id, type: 'mfa_ticket' },
      process.env.JWT_SECRET!,
      { expiresIn: MFA_TICKET_TTL } as jwt.SignOptions,
    );
    res.json({ mfaRequired: true, mfaTicket });
    return;
  }

  const featuresVersion = school.features_version ?? 1;
  const { token, refreshToken } = await issueTokenPair(
    { id: user.id, role: user.role, username: user.username },
    school.id,
    featuresVersion,
    req,
  );

  res.json({
    token,
    refreshToken,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      firstName: user.first_name,
      lastName: user.last_name,
      profilePicture: user.profile_picture,
      email: user.email || null,
    },
    school: {
      id: school.id,
      name: school.name,
      slug: school.slug,
      logoUrl: school.logo_url,
      primaryColor: school.primary_color,
      secondaryColor: school.secondary_color,
      features: school.features ?? {},
      timezone: school.timezone || 'Asia/Baghdad',
    },
  });

  // Fire-and-forget: alert the user when the sign-in is from a device or
  // network we haven't seen for them in the last 30 days. Never blocks or
  // fails the login response.
  if (newSignIn) {
    void notifyNewSignIn({
      schoolId: school.id,
      userId: user.id,
      email: user.email || null,
      firstName: user.first_name || '',
      ua: signInUa,
      ip: signInIp,
    });
  }
}

// Step 2 of MFA-required login: exchange a short-lived MFA ticket plus
// either a 6-digit TOTP code or a recovery code for a real session.
// Public — the ticket itself is the auth proving the user passed the
// password step. Rate-limited at the route layer.
export async function verifyMfaLogin(req: Request, res: Response): Promise<void> {
  const { mfaTicket, code } = req.body as { mfaTicket?: string; code?: string };
  if (!mfaTicket || typeof mfaTicket !== 'string') {
    res.status(400).json({ error: 'mfaTicket is required' });
    return;
  }
  if (!code || typeof code !== 'string' || !code.trim()) {
    res.status(400).json({ error: 'code is required' });
    return;
  }
  let payload: { userId: string; schoolId: string; type: string };
  try {
    payload = jwt.verify(mfaTicket, process.env.JWT_SECRET!, { algorithms: ['HS256'] }) as any;
  } catch {
    res.status(401).json({ error: 'Your verification session has expired. Please sign in again.' });
    return;
  }
  if (payload.type !== 'mfa_ticket' || !payload.userId || !payload.schoolId) {
    res.status(401).json({ error: 'Invalid verification session.' });
    return;
  }

  // Re-validate the user — between the password step and this call,
  // the account could have been deactivated.
  const { data: user } = await supabase
    .from('users')
    .select('id, username, role, first_name, last_name, profile_picture, email, is_active')
    .eq('id', payload.userId)
    .single();
  if (!user || !(user as { is_active: boolean }).is_active) {
    res.status(401).json({ error: 'Account is not active.' });
    return;
  }
  const { data: school } = await supabase
    .from('schools')
    .select('id, name, slug, logo_url, primary_color, secondary_color, features, features_version, timezone, is_active')
    .eq('id', payload.schoolId)
    .single();
  if (!school || !(school as { is_active: boolean }).is_active) {
    res.status(401).json({ error: 'School is not active.' });
    return;
  }

  const result = await verifyMfaCodeForUser(payload.userId, code.trim());
  if (result === 'no_mfa') {
    // Ticket says MFA, DB says no. Edge case: someone admin-disabled
    // MFA between login and this call. Tell the user to start over.
    res.status(401).json({ error: 'Two-factor verification is no longer required. Please sign in again.' });
    return;
  }
  if (result === 'wrong') {
    res.status(401).json({ error: 'Wrong code.' });
    return;
  }

  // Capture sign-in fingerprint BEFORE issuing the refresh row for this
  // session (same idea as login()).
  const signInUa = ((req.headers['user-agent'] as string) || '').slice(0, 300);
  const signInIp = req.ip || null;
  const newSignIn = await isNewSignIn(payload.userId, signInUa, signInIp);

  const u = user as { id: string; username: string; role: string; first_name: string; last_name: string; profile_picture: string | null; email: string | null };
  const s = school as { id: string; name: string; slug: string; logo_url: string | null; primary_color: string | null; secondary_color: string | null; features: Record<string, unknown> | null; features_version: number | null; timezone: string | null };
  const featuresVersion = s.features_version ?? 1;
  const { token, refreshToken } = await issueTokenPair(
    { id: u.id, role: u.role, username: u.username },
    s.id,
    featuresVersion,
    req,
  );

  res.json({
    token,
    refreshToken,
    user: {
      id: u.id,
      username: u.username,
      role: u.role,
      firstName: u.first_name,
      lastName: u.last_name,
      profilePicture: u.profile_picture,
      email: u.email || null,
    },
    school: {
      id: s.id,
      name: s.name,
      slug: s.slug,
      logoUrl: s.logo_url,
      primaryColor: s.primary_color,
      secondaryColor: s.secondary_color,
      features: s.features ?? {},
      timezone: s.timezone || 'Asia/Baghdad',
    },
  });

  if (newSignIn) {
    void notifyNewSignIn({
      schoolId: s.id,
      userId: u.id,
      email: u.email || null,
      firstName: u.first_name || '',
      ua: signInUa,
      ip: signInIp,
    });
  }
}

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  const { username } = req.body;
  if (!username) {
    res.status(400).json({ error: 'username is required' });
    return;
  }

  // Anti-enumeration: same body, same minimum wall-clock time on every path.
  const okMsg = { message: 'If this username exists, a reset request has been submitted to your school administrator.' };
  const start = Date.now();
  const FORGOT_MIN_MS = 600;
  const finishOk = async (): Promise<void> => {
    const wait = FORGOT_MIN_MS - (Date.now() - start);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    res.json(okMsg);
  };

  const underscoreIdx = username.indexOf('_');
  if (underscoreIdx === -1) { await finishOk(); return; }
  const abbreviation = username.substring(0, underscoreIdx).toLowerCase();
  // SECURITY (M-1): escape LIKE wildcards.
  const safeAbbrev = abbreviation.replace(/[\\%_]/g, '\\$&');

  const { data: school } = await supabase
    .from('schools').select('id').ilike('abbreviation', safeAbbrev).eq('is_active', true).single();
  if (!school) { await finishOk(); return; }

  const { data: user } = await supabase
    .from('users').select('id, first_name, last_name')
    .eq('school_id', school.id).eq('username', username).single();

  // Always return success to avoid username enumeration
  if (user) {
    // Remove any existing pending requests before inserting a fresh one (prevents duplicates)
    await supabase.from('password_reset_requests')
      .delete()
      .eq('user_id', user.id)
      .eq('school_id', school.id)
      .eq('status', 'pending');

    await supabase.from('password_reset_requests').insert({
      school_id: school.id,
      user_id: user.id,
      username,
      full_name: `${user.first_name} ${user.last_name}`.trim(),
      status: 'pending',
    });
    emitToAdmins(school.id, 'password_reset_request', { userId: user.id, username });
  }

  await finishOk();
}

export async function registerDeviceToken(req: AuthRequest, res: Response): Promise<void> {
  const { userId, schoolId } = req.user!;
  const { token, language = 'en' } = req.body;
  if (!token) { res.status(400).json({ error: 'token is required' }); return; }

  // Enforce one device → one user: any prior rows for this token under a
  // different account are stale and must be cleared so the previous user
  // stops receiving pushes on this device.
  await supabase.from('device_tokens').delete().eq('token', token).neq('user_id', userId);

  await supabase.from('device_tokens')
    .upsert({ user_id: userId, school_id: schoolId, token, language }, { onConflict: 'user_id,token' });

  res.json({ message: 'Device token registered' });
}

export async function updateDeviceLanguage(req: AuthRequest, res: Response): Promise<void> {
  const { userId } = req.user!;
  const { language } = req.body;
  if (!language) { res.status(400).json({ error: 'language is required' }); return; }

  await supabase.from('device_tokens').update({ language }).eq('user_id', userId);
  res.json({ message: 'Language updated' });
}

export async function uploadProfilePicture(req: AuthRequest, res: Response): Promise<void> {
  const { userId, schoolId } = req.user!;
  const file = (req as any).file;
  if (!file) { res.status(400).json({ error: 'No file uploaded' }); return; }

  const ext = safeExt(file.originalname, '.jpg');
  const storagePath = `avatars/${schoolId}/${userId}${ext}`;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'homework-attachments';

  const { data: uploadData, error: uploadErr } = await supabase.storage
    .from(bucket)
    .upload(storagePath, file.buffer, { contentType: file.mimetype, upsert: true });

  if (uploadErr || !uploadData) {
    res.status(500).json({ error: 'Upload failed' }); return;
  }

  const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(uploadData.path);
  const profilePicture = urlData.publicUrl;

  await supabase.from('users').update({ profile_picture: profilePicture }).eq('id', userId);

  res.json({ profilePicture });
}

export async function removeDeviceToken(req: AuthRequest, res: Response): Promise<void> {
  const { userId } = req.user!;
  const { token } = req.body;
  if (!token) { res.status(400).json({ error: 'token is required' }); return; }

  await supabase.from('device_tokens').delete().eq('user_id', userId).eq('token', token);
  res.json({ message: 'Device token removed' });
}

// Returns the authenticated user's current profile. Mobile Settings calls
// this on mount so the Email row reflects DB state even when the cached
// token predates the email-in-login change.
export async function getMe(req: AuthRequest, res: Response): Promise<void> {
  // Route is wrapped with authenticate, so req.user is always set. Keep
  // the runtime guard as belt-and-suspenders in case a future routing
  // change drops the middleware.
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const { data: user, error } = await supabase
    .from('users')
    .select('id, username, role, first_name, last_name, profile_picture, email')
    .eq('id', userId)
    .single();
  if (error || !user) {
    res.status(404).json({ error: 'user not found' });
    return;
  }
  res.json({
    id: user.id,
    username: user.username,
    role: user.role,
    firstName: user.first_name,
    lastName: user.last_name,
    profilePicture: user.profile_picture,
    email: user.email || null,
  });
}

// Email change is a two-step flow. Step 1: user submits the new address,
// we send a confirmation link to that NEW address, and the user's current
// email stays put. Step 2: the user clicks the link, which calls
// confirmEmail() and applies the swap. This prevents typos from leaving
// the account unreachable and prevents claim-by-typing-someone-else's-email.
//
// EXCEPTION: if the user currently has no email at all, we skip the
// confirmation step. There's no second address to send to, and refusing
// the set would strand mobile users who can't submit bug reports. The
// trade-off is accepted because admin-mediated reset still works.
export async function updateMyEmail(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user?.userId;
  const schoolId = req.user?.schoolId;
  const { email, currentPassword } = req.body as { email?: string; currentPassword?: string };

  const cleaned = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!cleaned) {
    res.status(400).json({ error: 'email is required' });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) {
    res.status(400).json({ error: 'Invalid email address' });
    return;
  }
  if (cleaned.length > 254) {
    res.status(400).json({ error: 'Email is too long' });
    return;
  }

  const { data: userRow } = await supabase
    .from('users')
    .select('email, first_name, password_hash, schools(name)')
    .eq('id', userId)
    .single();
  const currentEmail: string | null = (userRow as { email?: string | null })?.email || null;
  const passwordHash = (userRow as { password_hash?: string } | null)?.password_hash || '';
  const schoolName =
    (userRow as { schools?: { name?: string } | null } | null)?.schools?.name || '';

  // Re-auth before email change. Done BEFORE the email-already-in-use
  // lookup so a session-only attacker can't enumerate which emails are
  // registered at the school. The same generic error is returned on bad
  // password whether the email exists or not.
  if (!currentPassword || typeof currentPassword !== 'string' || !passwordHash) {
    res.status(401).json({ error: 'Current password is required.' });
    return;
  }
  const passwordOk = await bcrypt.compare(currentPassword, passwordHash);
  if (!passwordOk) {
    res.status(401).json({ error: 'Current password is incorrect.' });
    return;
  }

  // Same-as-current short-circuit FIRST so the uniqueness check below
  // doesn't false-positive on the user's own row.
  if (currentEmail && cleaned === currentEmail.toLowerCase()) {
    res.json({ email: currentEmail, pending: false });
    return;
  }

  // Within-school uniqueness guard. Prevents two users at the same school
  // from sharing an email — important so security alerts / recovery links
  // can be unambiguously attributed to one account. Cross-school
  // collisions are still allowed (separate tenants, separate inboxes).
  // tenant-check-allow: scoped to the caller's school
  const { data: clash } = await supabase
    .from('users')
    .select('id')
    .eq('school_id', schoolId)
    .ilike('email', cleaned)
    .neq('id', userId)
    .limit(1)
    .maybeSingle();
  if (clash) {
    res.status(409).json({ error: 'Another account at your school already uses this email.' });
    return;
  }

  // No current email → first-time set, apply immediately.
  if (!currentEmail) {
    const { error } = await supabase
      .from('users')
      .update({ email: cleaned })
      .eq('id', userId);
    if (error) {
      res.status(safeDbErrorStatus(error)).json({ error: safeDbErrorMessage(error) });
      return;
    }
    res.json({ email: cleaned, pending: false });
    void logAudit({
      req,
      entityType: 'user_account',
      entityId: userId!,
      action: 'update',
      before: { email: null },
      after: { email: cleaned },
      label: 'email_set_initial',
    });
    return;
  }

  // Change confirmation. Invalidate any pending tokens for this user so
  // the most-recent request wins.
  await supabase
    .from('email_change_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('used_at', null);

  const code = generateOtpCode();
  const expiresAt = new Date(Date.now() + EMAIL_CHANGE_TTL_MS).toISOString();
  // tenant-check-allow: email_change_tokens is user-keyed (no school_id by design)
  const { error: insErr } = await supabase
    .from('email_change_tokens')
    .insert({
      user_id: userId,
      new_email: cleaned,
      token_hash: hashToken(code),
      expires_at: expiresAt,
      attempts: 0,
    });
  if (insErr) {
    res.status(safeDbErrorStatus(insErr)).json({ error: safeDbErrorMessage(insErr) });
    return;
  }

  const firstName = (userRow as { first_name?: string })?.first_name || '';
  // School name in the subject + chip line disambiguates which Scholify
  // account this is for — users who hold accounts at multiple schools
  // (e.g. a parent with kids in two) otherwise can't tell the codes apart.
  const subject = schoolName
    ? `Your Scholify verification code for ${schoolName}`
    : 'Your Scholify verification code';
  const chip = schoolName ? `Scholify · ${escapeHtml(schoolName)}` : 'Scholify';
  const accountLine = schoolName
    ? `Enter this code in Scholify to confirm this email address for your ${escapeHtml(schoolName)} account.`
    : 'Enter this code in Scholify to confirm this email address for your account.';
  const text = [
    `Hi ${firstName || 'there'},`,
    '',
    `Your verification code is: ${code}`,
    '',
    schoolName
      ? `Enter it in Scholify to finish confirming this email address for your ${schoolName} account.`
      : 'Enter it in Scholify to finish confirming this email address.',
    'This code expires in 10 minutes.',
    '',
    'If you did not request this change, you can ignore this email.',
  ].join('\n');
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,Inter,sans-serif;background:#f8fafc;padding:24px">
      <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden">
        <div style="background:#6366F1;padding:20px 24px;color:#fff">
          <div style="font-size:12px;opacity:.8;letter-spacing:.06em;text-transform:uppercase">${chip}</div>
          <div style="font-size:20px;font-weight:800;margin-top:4px">Confirm your new email</div>
        </div>
        <div style="padding:24px;color:#0f172a">
          <p style="margin:0 0 12px;font-size:14px">Hi ${escapeHtml(firstName) || 'there'},</p>
          <p style="margin:0 0 16px;font-size:14px;line-height:1.55">${accountLine}</p>
          <div style="margin:0 0 16px;padding:18px 24px;background:#f1f5f9;border-radius:12px;text-align:center">
            <div style="font-family:'JetBrains Mono',ui-monospace,monospace;font-size:32px;font-weight:700;letter-spacing:.18em;color:#0f172a">${code}</div>
          </div>
          <p style="margin:0;font-size:12px;color:#64748b">This code expires in 10 minutes. If you didn't request this change, you can ignore this email.</p>
        </div>
      </div>
    </div>`;

  try {
    await sendMail(cleaned, subject, html, text);
  } catch (err) {
    // SECURITY: don't echo mailer error detail (SMTP rejection reason,
    // domain auth state, etc.) to the caller. Operator triages via logs.
    logger.error('email-change confirmation send failed', { err, target: cleaned });
    res.status(502).json({ error: 'Could not send verification code. Please try again later.' });
    return;
  }

  res.json({ pending: true, sentTo: cleaned });
}

// Confirms an email change. Public endpoint — the token IS the auth.
// Kept for backwards compatibility; the live flow is the OTP path
// (verifyEmailCode). If no email is currently being sent to /confirm-email
// this is unreachable and can be removed later.
export async function confirmEmail(req: Request, res: Response): Promise<void> {
  const { token } = req.body as { token?: string };
  if (!token || typeof token !== 'string') {
    res.status(400).json({ error: 'token is required' });
    return;
  }
  // tenant-check-allow: email_change_tokens is user-keyed (no school_id by design)
  const { data: row } = await supabase
    .from('email_change_tokens')
    .select('id, user_id, new_email, expires_at, used_at')
    .eq('token_hash', hashToken(token))
    .single();

  if (!row) {
    res.status(400).json({ error: 'Invalid or expired link.' });
    return;
  }
  const r = row as { id: string; user_id: string; new_email: string; expires_at: string; used_at: string | null };
  if (r.used_at) {
    res.status(400).json({ error: 'This link has already been used.' });
    return;
  }
  if (new Date(r.expires_at) <= new Date()) {
    res.status(400).json({ error: 'This link has expired.' });
    return;
  }

  const swap = await applyEmailSwapAndAnchor(r.user_id, r.new_email);
  if (!swap.ok) {
    res.status(swap.status).json({ error: swap.error });
    return;
  }
  // tenant-check-allow: email_change_tokens is user-keyed (no school_id by design)
  await supabase
    .from('email_change_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('id', r.id);

  res.json({ email: r.new_email });
  // confirmEmail is public (token IS the auth), so we have no req.user
  // context to feed logAudit with. The OTP path verifyEmailCode below
  // does the audit write. If this legacy route ever sees real traffic,
  // an inline insert similar to recoverAccount's would be needed here.
}

// OTP path: authenticated user submits the 6-digit code we sent to the
// new address. We hash and look up the most recent active change token for
// this user, compare, enforce the per-token attempt cap, and on success
// apply the email swap + recovery anchor.
export async function verifyEmailCode(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  const { code } = req.body as { code?: string };
  if (!code || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
    res.status(400).json({ error: 'A 6-digit code is required.' });
    return;
  }
  // tenant-check-allow: email_change_tokens is user-keyed (no school_id by design)
  const { data: row } = await supabase
    .from('email_change_tokens')
    .select('id, user_id, new_email, expires_at, used_at, attempts, token_hash')
    .eq('user_id', userId)
    .is('used_at', null)
    .order('expires_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!row) {
    res.status(400).json({ error: 'No pending email change. Request a new code.' });
    return;
  }
  const r = row as { id: string; user_id: string; new_email: string; expires_at: string; used_at: string | null; attempts: number; token_hash: string };
  if (new Date(r.expires_at) <= new Date()) {
    res.status(400).json({ error: 'This code has expired. Request a new one.' });
    return;
  }

  if (hashToken(code) !== r.token_hash) {
    const nextAttempts = r.attempts + 1;
    const exhausted = nextAttempts >= EMAIL_CHANGE_MAX_ATTEMPTS;
    // tenant-check-allow: id sourced from row above
    await supabase.from('email_change_tokens')
      .update(exhausted ? { attempts: nextAttempts, used_at: new Date().toISOString() } : { attempts: nextAttempts })
      .eq('id', r.id);
    if (exhausted) {
      res.status(400).json({ error: 'Too many wrong attempts. Request a new code.' });
      return;
    }
    res.status(400).json({ error: 'Wrong code.', attemptsRemaining: EMAIL_CHANGE_MAX_ATTEMPTS - nextAttempts });
    return;
  }

  const swap = await applyEmailSwapAndAnchor(r.user_id, r.new_email);
  if (!swap.ok) {
    res.status(swap.status).json({ error: swap.error });
    return;
  }
  // tenant-check-allow: id sourced from row above
  await supabase.from('email_change_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('id', r.id);

  res.json({ email: r.new_email });
  void logAudit({
    req,
    entityType: 'user_account',
    entityId: r.user_id,
    action: 'update',
    before: { email: swap.previousEmail },
    after: { email: r.new_email },
    label: 'email_change',
    reason: 'otp_verified',
  });
}

// Applies the email swap on users + manages the 7-day recovery anchor and
// alert. First successful change in a window pins anchor_email to whatever
// was there before; chained changes inside the window keep that anchor,
// rotate the token hash + expiry, and re-send the alert to the same
// anchor address. This means a chain A -> B -> C -> ... still recovers to
// A regardless of how many hops the attacker tries.
async function applyEmailSwapAndAnchor(
  userId: string,
  newEmail: string,
): Promise<{ ok: true; previousEmail: string | null } | { ok: false; status: number; error: string }> {
  // 1. Fetch the previous email + first name + school name for the alert body
  const { data: userRow } = await supabase
    .from('users')
    .select('email, first_name, schools(name)')
    .eq('id', userId)
    .single();
  const previousEmail = (userRow as { email?: string | null })?.email || null;
  const firstName = (userRow as { first_name?: string })?.first_name || '';
  const schoolName =
    (userRow as { schools?: { name?: string } | null } | null)?.schools?.name || '';

  // 2. Apply the swap
  const { error: upErr } = await supabase
    .from('users')
    .update({ email: newEmail })
    .eq('id', userId);
  if (upErr) {
    return { ok: false, status: safeDbErrorStatus(upErr), error: safeDbErrorMessage(upErr) };
  }

  // 3. If there's no previous email, there's no inbox to send the alert
  //    to. Skip the anchor (the user has no "true" address to revert to).
  if (!previousEmail) return { ok: true, previousEmail: null };

  // 4. Find an active anchor (unused, unexpired) for this user
  // tenant-check-allow: account_recovery_tokens is user-keyed (no school_id by design)
  const { data: existing } = await supabase
    .from('account_recovery_tokens')
    .select('id, anchor_email')
    .eq('user_id', userId)
    .is('used_at', null)
    .gte('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const raw = generateToken();
  const expiresAt = new Date(Date.now() + ACCOUNT_RECOVERY_TTL_MS).toISOString();
  let anchorEmail: string;

  if (existing) {
    // Chain change: keep the original anchor, rotate token + extend expiry
    anchorEmail = (existing as { anchor_email: string }).anchor_email;
    // tenant-check-allow: id sourced from row above
    await supabase.from('account_recovery_tokens')
      .update({
        latest_email: newEmail,
        token_hash: hashToken(raw),
        expires_at: expiresAt,
      })
      .eq('id', (existing as { id: string }).id);
  } else {
    // First change in this window: pin the anchor
    anchorEmail = previousEmail;
    // tenant-check-allow: account_recovery_tokens is user-keyed (no school_id by design)
    await supabase.from('account_recovery_tokens').insert({
      user_id: userId,
      anchor_email: anchorEmail,
      latest_email: newEmail,
      token_hash: hashToken(raw),
      expires_at: expiresAt,
    });
  }

  // 5. Send the alert to the anchor address. Best-effort: if the mailer
  //    fails we don't reverse the swap (the user can still recover via
  //    admin reset), but we log it loudly so operators can investigate.
  try {
    const recoveryLink = `${PORTAL_URL}/recover-account?token=${raw}`;
    const schoolSuffix = schoolName ? ` (${schoolName})` : '';
    const subject = existing
      ? `Your Scholify email was changed again${schoolSuffix}`
      : `Your Scholify email was changed${schoolSuffix}`;
    const chip = schoolName
      ? `Scholify · ${escapeHtml(schoolName)} · Security alert`
      : 'Scholify · Security alert';
    const text = [
      `Hi ${firstName || 'there'},`,
      '',
      existing
        ? `Your Scholify account email${schoolName ? ` at ${schoolName}` : ''} was changed again — the latest address on file is now ${newEmail}.`
        : `Your Scholify account email${schoolName ? ` at ${schoolName}` : ''} was just changed to ${newEmail}.`,
      '',
      'If this was you, no action is needed.',
      '',
      "If this wasn't you, click the link below to revert your email and reset your password:",
      recoveryLink,
      '',
      'This link expires in 7 days.',
    ].join('\n');
    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,Inter,sans-serif;background:#f8fafc;padding:24px">
        <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden">
          <div style="background:#b91c1c;padding:20px 24px;color:#fff">
            <div style="font-size:12px;opacity:.8;letter-spacing:.06em;text-transform:uppercase">${chip}</div>
            <div style="font-size:20px;font-weight:800;margin-top:4px">${escapeHtml(subject)}</div>
          </div>
          <div style="padding:24px;color:#0f172a">
            <p style="margin:0 0 12px;font-size:14px">Hi ${escapeHtml(firstName) || 'there'},</p>
            <p style="margin:0 0 16px;font-size:14px;line-height:1.55">
              ${existing
                ? `Your Scholify account email was changed again — the latest address on file is now <strong>${escapeHtml(newEmail)}</strong>.`
                : `Your Scholify account email was just changed to <strong>${escapeHtml(newEmail)}</strong>.`}
            </p>
            <p style="margin:0 0 16px;font-size:14px;line-height:1.55">If this was you, no action is needed.</p>
            <p style="margin:0 0 8px;font-size:14px;line-height:1.55"><strong>If this wasn't you</strong>, click below to revert your email to <strong>${escapeHtml(anchorEmail)}</strong> and reset your password. This also signs out every device using your account.</p>
            <p style="margin:0 0 16px">
              <a href="${recoveryLink}" style="display:inline-block;background:#b91c1c;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:600">Reset password &amp; undo</a>
            </p>
            <p style="margin:0 0 8px;font-size:12px;color:#64748b">If the button doesn't work, paste this URL into your browser:</p>
            <p style="margin:0;font-size:12px;color:#64748b;word-break:break-all">${escapeHtml(recoveryLink)}</p>
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">
            <p style="margin:0;font-size:12px;color:#64748b">This recovery link expires in 7 days.</p>
          </div>
        </div>
      </div>`;
    await sendMail(anchorEmail, subject, html, text);
  } catch (err) {
    logger.error('email-change recovery alert send failed', { err, userId, anchorEmail });
  }
  return { ok: true, previousEmail };
}

// Public — the recovery link in the security alert email lands here.
// Token is the auth. Reverts email to the anchor, sets a new password, and
// invalidates every refresh token so the attacker is kicked out.
export async function recoverAccount(req: Request, res: Response): Promise<void> {
  const { token, newPassword } = req.body as { token?: string; newPassword?: string };
  if (!token || typeof token !== 'string') {
    res.status(400).json({ error: 'token is required' });
    return;
  }
  if (!newPassword || typeof newPassword !== 'string' || !isStrongPassword(newPassword)) {
    res.status(400).json({ error: PASSWORD_POLICY_MESSAGE });
    return;
  }

  // tenant-check-allow: account_recovery_tokens is user-keyed (no school_id by design)
  const { data: row } = await supabase
    .from('account_recovery_tokens')
    .select('id, user_id, anchor_email, expires_at, used_at')
    .eq('token_hash', hashToken(token))
    .single();
  if (!row) {
    res.status(400).json({ error: 'Invalid or expired link.' });
    return;
  }
  const r = row as { id: string; user_id: string; anchor_email: string; expires_at: string; used_at: string | null };
  if (r.used_at) {
    res.status(400).json({ error: 'This link has already been used.' });
    return;
  }
  if (new Date(r.expires_at) <= new Date()) {
    res.status(400).json({ error: 'This link has expired.' });
    return;
  }

  // We need the user's school_id to push a real-time force-logout to
  // their socket room. Revoking the refresh token alone only kicks them
  // out when their (up-to-15-min) access token expires — too slow for a
  // potentially compromised session. The socket signal makes it instant.
  // username + role are pulled too so the audit log below can record
  // who-was-recovered; previousEmail captures the attacker-set address
  // we're about to overwrite.
  // tenant-check-allow: user_id sourced from token row above
  const { data: userRow } = await supabase
    .from('users')
    .select('school_id, username, role, email')
    .eq('id', r.user_id)
    .single();
  const u = userRow as { school_id?: string; username?: string; role?: string; email?: string | null } | null;
  const schoolId = u?.school_id;
  const previousEmail = u?.email || null;

  const passwordHash = await bcrypt.hash(newPassword, 12);
  // tenant-check-allow: user_id sourced from token row above
  const { error: upErr } = await supabase
    .from('users')
    .update({ email: r.anchor_email, password_hash: passwordHash })
    .eq('id', r.user_id);
  if (upErr) {
    res.status(safeDbErrorStatus(upErr)).json({ error: safeDbErrorMessage(upErr) });
    return;
  }
  // tenant-check-allow: account_recovery_tokens is user-keyed
  await supabase.from('account_recovery_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('id', r.id);
  // tenant-check-allow: refresh_tokens is user-keyed; sign out all sessions
  await supabase.from('refresh_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', r.user_id)
    .is('revoked_at', null);
  // Also burn any in-flight email change tokens so the attacker can't
  // resume a confirmation that's mid-flight.
  // tenant-check-allow: email_change_tokens is user-keyed
  await supabase.from('email_change_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('user_id', r.user_id)
    .is('used_at', null);

  // Real-time kick: any connected client (web or mobile) listening on this
  // user's room clears its local auth state immediately. Sockets joined
  // their room at handshake using the auth token; even though that token
  // is still cryptographically valid for up to 15 minutes, the client
  // honoring this event drops it.
  if (schoolId) {
    getIo()?.to(`school:${schoolId}:user:${r.user_id}`).emit('force_logout', { reason: 'account_recovered' });
  }

  // Audit log — this is one of the most security-sensitive operations in
  // the system, so a tamper-evident trail of WHO recovered, WHEN, and
  // WHAT changed must exist for any later dispute. Inlined (not via
  // logAudit) because the route is unauthenticated; the token IS the
  // auth and we synthesize the actor from the user row we just fetched.
  // Best-effort — never let an audit-write failure roll back the
  // recovery the user has already been told succeeded.
  if (schoolId) {
    try {
      // tenant-check-allow: school_id sourced from the user row above
      const { error: auditErr } = await supabase.from('audit_logs').insert({
        school_id: schoolId,
        entity_type: 'user_account',
        entity_id: r.user_id,
        action: 'update',
        changes: {
          email: { old: previousEmail, new: r.anchor_email },
          password_reset: true,
          sessions_revoked: true,
        },
        actor_id: r.user_id,
        actor_username: u?.username ?? null,
        actor_role: u?.role ?? null,
        label: 'account_recovery',
        reason: 'recovery_link_used',
      });
      if (auditErr) logger.error('audit insert for recoverAccount failed', { err: auditErr });
    } catch (err) {
      logger.error('audit insert for recoverAccount threw', { err });
    }
  }

  res.json({ email: r.anchor_email });
}

// Self-service password reset by email. Always returns 200 so callers
// can't enumerate which usernames exist or which have email addresses.
// Rate-limited at the route layer.
export async function forgotPasswordEmail(req: Request, res: Response): Promise<void> {
  const okMessage = { message: 'If an account matches and has an email on file, a reset link has been sent.' };

  // Anti-enumeration: every outcome returns the same body AND takes at least
  // the same wall-clock time, so an attacker can't distinguish "no such user"
  // from "user, link sent" by timing. The email itself is sent fire-and-forget
  // so its variable latency never leaks into the response.
  const start = Date.now();
  const FORGOT_MIN_MS = 600;
  const finishOk = async (): Promise<void> => {
    const wait = FORGOT_MIN_MS - (Date.now() - start);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    res.json(okMessage);
  };

  const { username } = req.body as { username?: string };
  if (!username || typeof username !== 'string') {
    await finishOk();
    return;
  }

  const underscoreIdx = username.indexOf('_');
  if (underscoreIdx === -1) { await finishOk(); return; }
  const abbreviation = username.substring(0, underscoreIdx).toLowerCase();
  // SECURITY (M-1): escape LIKE wildcards.
  const safeAbbrev = abbreviation.replace(/[\\%_]/g, '\\$&');

  const { data: school } = await supabase
    .from('schools').select('id').ilike('abbreviation', safeAbbrev).eq('is_active', true).single();
  if (!school) { await finishOk(); return; }

  const { data: user } = await supabase
    .from('users')
    .select('id, email, first_name, is_active')
    .eq('school_id', (school as { id: string }).id)
    .eq('username', username)
    .single();

  // No user, inactive user, or no email → silently succeed.
  const u = user as { id: string; email: string | null; first_name: string; is_active: boolean } | null;
  if (!u || !u.is_active || !u.email) {
    await finishOk();
    return;
  }

  // Burn any outstanding tokens for this user; one live link at a time.
  await supabase
    .from('password_reset_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('user_id', u.id)
    .is('used_at', null);

  const raw = generateToken();
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();
  // tenant-check-allow: password_reset_tokens is user-keyed (no school_id by design)
  await supabase
    .from('password_reset_tokens')
    .insert({
      user_id: u.id,
      token_hash: hashToken(raw),
      expires_at: expiresAt,
      requested_ip: req.ip || null,
    });

  const link = `${LANDING_URL}/reset-password?token=${raw}`;
  const firstName = u.first_name || '';
  const subject = 'Reset your Scholify password';
  const text = [
    `Hi ${firstName || 'there'},`,
    '',
    'A password reset was requested for your Scholify account. Click the link below to choose a new password:',
    '',
    link,
    '',
    'If you did not request this, you can ignore this email.',
    'This link expires in 1 hour.',
  ].join('\n');
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,Inter,sans-serif;background:#f8fafc;padding:24px">
      <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden">
        <div style="background:#6366F1;padding:20px 24px;color:#fff">
          <div style="font-size:12px;opacity:.8;letter-spacing:.06em;text-transform:uppercase">Scholify</div>
          <div style="font-size:20px;font-weight:800;margin-top:4px">Reset your password</div>
        </div>
        <div style="padding:24px;color:#0f172a">
          <p style="margin:0 0 12px;font-size:14px">Hi ${escapeHtml(firstName) || 'there'},</p>
          <p style="margin:0 0 16px;font-size:14px;line-height:1.55">Click the button below to choose a new password for your Scholify account.</p>
          <p style="margin:0 0 16px">
            <a href="${link}" style="display:inline-block;background:#6366F1;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:600">Reset password</a>
          </p>
          <p style="margin:0 0 8px;font-size:12px;color:#64748b">If the button doesn't work, paste this URL into your browser:</p>
          <p style="margin:0;font-size:12px;color:#64748b;word-break:break-all">${escapeHtml(link)}</p>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">
          <p style="margin:0;font-size:12px;color:#64748b">Didn't request this? You can safely ignore this email. The link expires in 1 hour.</p>
        </div>
      </div>
    </div>`;

  // Fire-and-forget: do not await, so the response time does not depend on
  // mail-provider latency (which would otherwise be an enumeration oracle).
  sendMail(u.email, subject, html, text).catch((err) => {
    logger.error('Reset email send failed', { err });
  });

  await finishOk();
}

// Public endpoint — verifies the token, swaps the password hash, marks the
// row used. Stamps password_changed_at so any stale JWTs for this user
// trip the auth middleware's freshness check.
export async function resetWithToken(req: Request, res: Response): Promise<void> {
  const { token, newPassword } = req.body as { token?: string; newPassword?: string };
  if (!token || typeof token !== 'string') {
    res.status(400).json({ error: 'token is required' });
    return;
  }
  if (!isStrongPassword(newPassword)) {
    res.status(400).json({ error: PASSWORD_POLICY_MESSAGE });
    return;
  }

  // tenant-check-allow: password_reset_tokens is user-keyed (no school_id by design)
  const { data: row } = await supabase
    .from('password_reset_tokens')
    .select('id, user_id, expires_at, used_at')
    .eq('token_hash', hashToken(token))
    .single();
  if (!row) { res.status(400).json({ error: 'Invalid or expired link.' }); return; }
  const r = row as { id: string; user_id: string; expires_at: string; used_at: string | null };
  if (r.used_at) { res.status(400).json({ error: 'This link has already been used.' }); return; }
  if (new Date(r.expires_at) <= new Date()) {
    res.status(400).json({ error: 'This link has expired.' });
    return;
  }

  const rounds = parseInt(process.env.BCRYPT_ROUNDS || '10');
  const passwordHash = await bcrypt.hash(newPassword, rounds);

  // tenant-check-allow: user_id sourced from token row above (token uniquely identifies the user)
  const { error: upErr } = await supabase
    .from('users')
    .update({ password_hash: passwordHash, password_changed_at: new Date().toISOString() })
    .eq('id', r.user_id);
  if (upErr) { res.status(safeDbErrorStatus(upErr)).json({ error: safeDbErrorMessage(upErr) }); return; }

  // tenant-check-allow: password_reset_tokens is user-keyed (no school_id by design)
  await supabase
    .from('password_reset_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('id', r.id);

  res.json({ ok: true });
}

export async function changePassword(req: AuthRequest, res: Response): Promise<void> {
  const { currentPassword, newPassword } = req.body;
  const userId = req.user?.userId;

  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: 'currentPassword and newPassword required' });
    return;
  }

  if (!isStrongPassword(newPassword)) {
    res.status(400).json({ error: PASSWORD_POLICY_MESSAGE });
    return;
  }

  const { data: user } = await supabase
    .from('users')
    .select('password_hash')
    .eq('id', userId)
    .single();

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) {
    res.status(401).json({ error: 'Current password is incorrect' });
    return;
  }

  const rounds = parseInt(process.env.BCRYPT_ROUNDS || '10');
  const newHash = await bcrypt.hash(newPassword, rounds);

  await supabase.from('users').update({ password_hash: newHash, password_changed_at: new Date().toISOString() }).eq('id', userId);

  res.json({ message: 'Password changed successfully' });
}

// Public — exchanges a valid refresh token for a new access token AND a
// new refresh token (rotation). The presented token is burned. Presenting
// an already-burned/revoked token is treated as theft: the entire rotation
// family is revoked so the attacker AND the victim are logged out (the
// victim re-logs in cleanly; the attacker is locked out). Rate-limited at
// the route layer.
export async function refreshToken(req: Request, res: Response): Promise<void> {
  const { refreshToken: raw } = req.body as { refreshToken?: string };
  if (!raw || typeof raw !== 'string') {
    res.status(400).json({ error: 'refreshToken is required' });
    return;
  }

  // tenant-check-allow: refresh_tokens is user-keyed (token_hash uniquely identifies the row)
  const { data: row } = await supabase
    .from('refresh_tokens')
    .select('id, school_id, user_id, family_id, expires_at, rotated_at, revoked_at, created_at')
    .eq('token_hash', hashToken(raw))
    .single();

  if (!row) {
    res.status(401).json({ error: 'Invalid session. Please log in again.' });
    return;
  }
  const r = row as {
    id: string; school_id: string; user_id: string; family_id: string;
    expires_at: string; rotated_at: string | null; revoked_at: string | null; created_at: string;
  };

  const revokeFamily = async (): Promise<void> => {
    // tenant-check-allow: refresh_tokens is user-keyed; burning the whole rotation family on reuse/expiry
    await supabase
      .from('refresh_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('family_id', r.family_id)
      .is('revoked_at', null);
  };

  // Replay/theft: a token already rotated or explicitly revoked is being
  // presented again → assume compromise, burn the family.
  if (r.revoked_at || r.rotated_at) {
    await revokeFamily();
    res.status(401).json({ error: 'Session expired. Please log in again.' });
    return;
  }
  if (new Date(r.expires_at) <= new Date()) {
    await revokeFamily();
    res.status(401).json({ error: 'Session expired. Please log in again.' });
    return;
  }

  // Re-validate the account exactly like authenticate() does, so a refresh
  // can never resurrect a deactivated user or a stale-password session.
  // tenant-check-allow: user_id sourced from the refresh_tokens row above (token uniquely identifies the user)
  const { data: user } = await supabase
    .from('users')
    .select('id, role, username, is_active, password_changed_at, schools(is_active, features_version, features)')
    .eq('id', r.user_id)
    .single();

  if (!user || !user.is_active) {
    await revokeFamily();
    res.status(401).json({ error: 'Account is not active.' });
    return;
  }
  const school = user.schools as unknown as
    { is_active: boolean; features_version: number; features: Record<string, boolean> | null } | null;
  if (!school?.is_active) {
    await revokeFamily();
    res.status(401).json({ error: 'School is not active.' });
    return;
  }
  if (user.role === 'accountant' && school.features?.tuition_fees !== true) {
    res.status(403).json({ error: 'Accounting module is not enabled for this school.' });
    return;
  }
  // Password changed after this refresh token was minted → stale session.
  if (
    user.password_changed_at &&
    new Date(user.password_changed_at).getTime() > new Date(r.created_at).getTime()
  ) {
    await revokeFamily();
    res.status(401).json({ error: 'Session invalidated. Please log in again.' });
    return;
  }

  // Rotate: burn the presented token, mint a successor in the same family.
  // tenant-check-allow: refresh_tokens is user-keyed (row id resolved from the token_hash lookup above)
  await supabase
    .from('refresh_tokens')
    .update({ rotated_at: new Date().toISOString(), revoked_at: new Date().toISOString() })
    .eq('id', r.id);

  const featuresVersion = school.features_version ?? 1;
  const { token, refreshToken: newRaw } = await issueTokenPair(
    { id: user.id, role: user.role, username: user.username },
    r.school_id,
    featuresVersion,
    req,
    r.family_id,
  );
  res.json({ token, refreshToken: newRaw });
}

// Public — revokes the rotation family the given refresh token belongs to
// (i.e. logs out that one device/session). Idempotent and silent: it never
// reveals whether the token existed.
export async function logout(req: Request, res: Response): Promise<void> {
  const { refreshToken: raw } = req.body as { refreshToken?: string };
  if (raw && typeof raw === 'string') {
    // tenant-check-allow: refresh_tokens is user-keyed (token_hash uniquely identifies the row)
    const { data: row } = await supabase
      .from('refresh_tokens')
      .select('family_id')
      .eq('token_hash', hashToken(raw))
      .single();
    if (row) {
      // tenant-check-allow: refresh_tokens is user-keyed; logout kills the whole rotation family
      await supabase
        .from('refresh_tokens')
        .update({ revoked_at: new Date().toISOString() })
        .eq('family_id', (row as { family_id: string }).family_id)
        .is('revoked_at', null);
    }
  }
  res.json({ ok: true });
}

// Authenticated — "log out everywhere": revoke every live refresh token
// for the calling user. School-scoped, so it is tenant-safe by construction.
export async function logoutAll(req: AuthRequest, res: Response): Promise<void> {
  const { userId, schoolId } = req.user!;
  await supabase
    .from('refresh_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('school_id', schoolId)
    .is('revoked_at', null);
  res.json({ ok: true });
}
