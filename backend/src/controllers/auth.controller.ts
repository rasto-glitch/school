import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Resend } from 'resend';
import { supabase } from '../config/supabase';
import { toCC } from '../utils/transform';
import { emitToAdmins } from '../utils/notify';
import { logger } from '../utils/logger';
import type { AuthRequest } from '../middleware/auth';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM_EMAIL = process.env.LANDING_FROM || 'Scholify <no-reply@scholify.krd>';
// Public landing host where /reset-password and /confirm-email live.
// First value is treated as canonical; the rest are accepted at runtime
// (kept consistent with server.ts's allowedOrigins parsing).
const LANDING_URL = (process.env.LANDING_URL || 'http://localhost:5175').split(',')[0].trim();

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;          // 1 hour
const EMAIL_CHANGE_TTL_MS = 24 * 60 * 60 * 1000;    // 24 hours

const hashToken = (raw: string): string =>
  crypto.createHash('sha256').update(raw).digest('hex');

const generateToken = (): string =>
  crypto.randomBytes(32).toString('hex');

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c),
  );

const sendMail = async (to: string, subject: string, html: string, text: string): Promise<void> => {
  if (!resend) {
    logger.warn('Resend not configured; skipping send', { subject, to });
    return;
  }
  const { error } = await resend.emails.send({
    from: FROM_EMAIL, to, subject, html, text,
  });
  if (error) {
    logger.error('Resend send failed', { subject, to, errorMessage: error.message, errorName: error.name });
    throw new Error(error.message || 'send_failed');
  }
};

export async function getSchools(_req: Request, res: Response): Promise<void> {
  const { data, error } = await supabase
    .from('schools')
    .select('id, name, slug, logo_url, primary_color')
    .eq('is_active', true)
    .order('name');
  if (error) { res.status(500).json({ error: error.message }); return; }
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

  // Find school by abbreviation
  const { data: school, error: schoolErr } = await supabase
    .from('schools')
    .select('id, name, slug, logo_url, primary_color, secondary_color, features, features_version')
    .ilike('abbreviation', abbreviation)
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

  const payload = {
    userId: user.id,
    schoolId: school.id,
    role: user.role,
    username: user.username,
    featuresVersion: school.features_version ?? 1,
  };

  const token = jwt.sign(payload, process.env.JWT_SECRET!, {
    expiresIn: process.env.JWT_EXPIRE || '7d',
  } as jwt.SignOptions);

  res.json({
    token,
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
    },
  });
}

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  const { username } = req.body;
  if (!username) {
    res.status(400).json({ error: 'username is required' });
    return;
  }

  const underscoreIdx = username.indexOf('_');
  if (underscoreIdx === -1) { res.json({ message: 'If this username exists, a reset request has been submitted to your school administrator.' }); return; }
  const abbreviation = username.substring(0, underscoreIdx).toLowerCase();

  const { data: school } = await supabase
    .from('schools').select('id').ilike('abbreviation', abbreviation).eq('is_active', true).single();
  if (!school) { res.json({ message: 'If this username exists, a reset request has been submitted to your school administrator.' }); return; }

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

  res.json({ message: 'If this username exists, a reset request has been submitted to your school administrator.' });
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

  const ext = file.originalname.includes('.') ? '.' + file.originalname.split('.').pop() : '.jpg';
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
export async function getMe(req: Request, res: Response): Promise<void> {
  const userId = (req as any).user?.userId;
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
export async function updateMyEmail(req: Request, res: Response): Promise<void> {
  const userId = (req as any).user?.userId;
  const { email } = req.body as { email?: string };

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
    .select('email, first_name')
    .eq('id', userId)
    .single();
  const currentEmail: string | null = (userRow as { email?: string | null })?.email || null;

  // No current email → first-time set, apply immediately.
  if (!currentEmail) {
    const { error } = await supabase
      .from('users')
      .update({ email: cleaned })
      .eq('id', userId);
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ email: cleaned, pending: false });
    return;
  }

  if (cleaned === currentEmail.toLowerCase()) {
    res.json({ email: currentEmail, pending: false });
    return;
  }

  // Change confirmation. Invalidate any pending tokens for this user so
  // the most-recent request wins.
  await supabase
    .from('email_change_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('used_at', null);

  const raw = generateToken();
  const expiresAt = new Date(Date.now() + EMAIL_CHANGE_TTL_MS).toISOString();
  const { error: insErr } = await supabase
    .from('email_change_tokens')
    .insert({
      user_id: userId,
      new_email: cleaned,
      token_hash: hashToken(raw),
      expires_at: expiresAt,
    });
  if (insErr) {
    res.status(500).json({ error: insErr.message });
    return;
  }

  const firstName = (userRow as { first_name?: string })?.first_name || '';
  const link = `${LANDING_URL}/confirm-email?token=${raw}`;
  const subject = 'Confirm your new Scholify email';
  const text = [
    `Hi ${firstName || 'there'},`,
    '',
    'Click the link below to confirm this email address for your Scholify account:',
    '',
    link,
    '',
    'If you did not request this change, you can ignore this email.',
    'This link expires in 24 hours.',
  ].join('\n');
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,Inter,sans-serif;background:#f8fafc;padding:24px">
      <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden">
        <div style="background:#6366F1;padding:20px 24px;color:#fff">
          <div style="font-size:12px;opacity:.8;letter-spacing:.06em;text-transform:uppercase">Scholify</div>
          <div style="font-size:20px;font-weight:800;margin-top:4px">Confirm your new email</div>
        </div>
        <div style="padding:24px;color:#0f172a">
          <p style="margin:0 0 12px;font-size:14px">Hi ${escapeHtml(firstName) || 'there'},</p>
          <p style="margin:0 0 16px;font-size:14px;line-height:1.55">Click the button below to confirm this email address for your Scholify account.</p>
          <p style="margin:0 0 16px">
            <a href="${link}" style="display:inline-block;background:#6366F1;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:600">Confirm email</a>
          </p>
          <p style="margin:0 0 8px;font-size:12px;color:#64748b">If the button doesn't work, paste this URL into your browser:</p>
          <p style="margin:0;font-size:12px;color:#64748b;word-break:break-all">${escapeHtml(link)}</p>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">
          <p style="margin:0;font-size:12px;color:#64748b">Didn't request this change? You can safely ignore this email. The link expires in 24 hours.</p>
        </div>
      </div>
    </div>`;

  try {
    await sendMail(cleaned, subject, html, text);
  } catch (err) {
    const e = err as Error;
    res.status(502).json({ error: e.message });
    return;
  }

  res.json({ pending: true, sentTo: cleaned });
}

// Confirms an email change. Public endpoint — the token IS the auth.
export async function confirmEmail(req: Request, res: Response): Promise<void> {
  const { token } = req.body as { token?: string };
  if (!token || typeof token !== 'string') {
    res.status(400).json({ error: 'token is required' });
    return;
  }
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

  const { error: upErr } = await supabase
    .from('users')
    .update({ email: r.new_email })
    .eq('id', r.user_id);
  if (upErr) {
    res.status(500).json({ error: upErr.message });
    return;
  }
  await supabase
    .from('email_change_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('id', r.id);

  res.json({ email: r.new_email });
}

// Self-service password reset by email. Always returns 200 so callers
// can't enumerate which usernames exist or which have email addresses.
// Rate-limited at the route layer.
export async function forgotPasswordEmail(req: Request, res: Response): Promise<void> {
  const okMessage = { message: 'If an account matches and has an email on file, a reset link has been sent.' };

  const { username } = req.body as { username?: string };
  if (!username || typeof username !== 'string') {
    res.json(okMessage);
    return;
  }

  const underscoreIdx = username.indexOf('_');
  if (underscoreIdx === -1) { res.json(okMessage); return; }
  const abbreviation = username.substring(0, underscoreIdx).toLowerCase();

  const { data: school } = await supabase
    .from('schools').select('id').ilike('abbreviation', abbreviation).eq('is_active', true).single();
  if (!school) { res.json(okMessage); return; }

  const { data: user } = await supabase
    .from('users')
    .select('id, email, first_name, is_active')
    .eq('school_id', (school as { id: string }).id)
    .eq('username', username)
    .single();

  // No user, inactive user, or no email → silently succeed.
  const u = user as { id: string; email: string | null; first_name: string; is_active: boolean } | null;
  if (!u || !u.is_active || !u.email) {
    res.json(okMessage);
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
  await supabase
    .from('password_reset_tokens')
    .insert({
      user_id: u.id,
      token_hash: hashToken(raw),
      expires_at: expiresAt,
      requested_ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || null,
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

  try {
    await sendMail(u.email, subject, html, text);
  } catch (err) {
    // We log but still tell the caller success — telling them the send
    // failed would reveal that an email is on file.
    logger.error('Reset email send failed', { err });
  }

  res.json(okMessage);
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
  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
    res.status(400).json({ error: 'New password must be at least 6 characters.' });
    return;
  }

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

  const { error: upErr } = await supabase
    .from('users')
    .update({ password_hash: passwordHash, password_changed_at: new Date().toISOString() })
    .eq('id', r.user_id);
  if (upErr) { res.status(500).json({ error: upErr.message }); return; }

  await supabase
    .from('password_reset_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('id', r.id);

  res.json({ ok: true });
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  const { currentPassword, newPassword } = req.body;
  const userId = (req as any).user?.userId;

  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: 'currentPassword and newPassword required' });
    return;
  }

  if (newPassword.length < 6) {
    res.status(400).json({ error: 'New password must be at least 6 characters' });
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
