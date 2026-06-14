import { Response } from 'express';
import bcrypt from 'bcryptjs';
import { adminDb as supabase } from '../utils/db';
import { logger } from '../utils/logger';
import { sendMail } from '../utils/mailer';
import { logAudit } from '../utils/audit';
import type { AuthRequest } from '../middleware/auth';
import {
  listFactors, armFactor, disarmFactor, setPreferredFactor, canRemoveFactor,
  sendFactorSetupCode, verifyLoginSecondFactor, getArmedLoginFactors,
  type LoginFactorMethod,
} from '../utils/loginFactors';

// Login-factor management (Phase 2). Any authenticated user may arm phone or
// email OTP as a sign-in second factor (locked decision: all roles). TOTP
// arming stays on the existing /auth/mfa/setup + /auth/mfa/confirm flow; these
// endpoints cover phone/email plus the cross-factor "preferred" choice.
//
// Auth bars (locked design):
//   * enable  = current password + a confirmation code to that channel
//               (proves receipt; closes the admin-set-email-never-verified hole)
//   * disable = current password + a code to that channel (proves possession,
//               so a cookie-only session hijacker can't weaken MFA)
//   * email may never be the SOLE factor (enforced on enable AND on any
//     removal that would orphan it)

type ManageableFactor = 'phone' | 'email';

// Re-auth: confirm the session owner's current password.
async function passwordOk(userId: string, currentPassword: string): Promise<boolean> {
  // tenant-check-allow: users row keyed by id = the authenticated caller
  const { data } = await supabase.from('users').select('password_hash').eq('id', userId).single();
  const hash = (data as { password_hash?: string } | null)?.password_hash || '';
  return hash ? await bcrypt.compare(currentPassword, hash) : false;
}

async function schoolNameFor(schoolId: string): Promise<string | null> {
  // tenant-check-allow: schools row keyed by the authenticated caller's schoolId
  const { data } = await supabase.from('schools').select('name').eq('id', schoolId).maybeSingle();
  return (data as { name?: string } | null)?.name ?? null;
}

// GET /auth/mfa/factors
export async function listLoginFactors(req: AuthRequest, res: Response): Promise<void> {
  res.json({ factors: await listFactors(req.user!.userId) });
}

// POST /auth/mfa/factors/:factor/send-code — confirmation OTP to the channel
// (used by both the enable and disable flows).
export async function sendFactorCode(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const schoolId = req.user!.schoolId;
  const factor = (req.params as { factor: string }).factor as ManageableFactor;

  const r = await sendFactorSetupCode({ schoolId, userId, method: factor, schoolName: await schoolNameFor(schoolId) });
  if (!r.ok) {
    if (r.reason === 'unavailable') {
      res.status(400).json({
        error: factor === 'phone'
          ? 'Verify your phone number first, then turn on sign-in codes.'
          : 'Add an email to your account first.',
      });
      return;
    }
    res.status(502).json({ error: "We couldn't send a code. Please try again." });
    return;
  }
  res.json({ ok: true, channel: r.channel });
}

// POST /auth/mfa/factors/:factor/enable  { currentPassword, code }
export async function enableFactor(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const schoolId = req.user!.schoolId;
  const factor = (req.params as { factor: string }).factor as ManageableFactor;
  const { currentPassword, code } = req.body as { currentPassword: string; code: string };

  if (!(await passwordOk(userId, currentPassword))) {
    res.status(401).json({ error: 'Current password is incorrect.' });
    return;
  }

  // Email may never be the only factor — require a strong partner first.
  if (factor === 'email') {
    const armed = (await getArmedLoginFactors(userId)).methods;
    if (!armed.includes('phone') && !armed.includes('totp')) {
      res.status(400).json({ error: 'Add phone or an authenticator app first — email can’t be your only sign-in code.' });
      return;
    }
  }

  // Prove control of the channel via the code we sent.
  const v = await verifyLoginSecondFactor({ userId, schoolId, method: factor, code: code.trim() });
  if (!v.ok) {
    res.status(401).json({ error: factorCodeError(v.reason) });
    return;
  }

  await armFactor(schoolId, userId, factor);
  void sendFactorAlert(userId, factor, 'armed');
  void logAudit({ req, entityType: 'user_mfa', entityId: userId, action: 'create', label: `login_factor_armed_${factor}` });
  res.json({ ok: true, factors: await listFactors(userId) });
}

// POST /auth/mfa/factors/:factor/disable  { currentPassword, code }
export async function disableFactor(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const schoolId = req.user!.schoolId;
  const factor = (req.params as { factor: string }).factor as ManageableFactor;
  const { currentPassword, code } = req.body as { currentPassword: string; code: string };

  if (!(await passwordOk(userId, currentPassword))) {
    res.status(401).json({ error: 'Current password is incorrect.' });
    return;
  }

  // Don't strand email as the sole factor.
  if (!(await canRemoveFactor(userId, factor))) {
    res.status(400).json({ error: 'Turn off email sign-in codes first — email can’t be left as your only factor.' });
    return;
  }

  // Possession proof: a code to the channel being turned off.
  const v = await verifyLoginSecondFactor({ userId, schoolId, method: factor, code: code.trim() });
  if (!v.ok) {
    res.status(401).json({ error: factorCodeError(v.reason) });
    return;
  }

  await disarmFactor(userId, factor);
  void sendFactorAlert(userId, factor, 'disarmed');
  void logAudit({ req, entityType: 'user_mfa', entityId: userId, action: 'delete', label: `login_factor_disarmed_${factor}` });
  res.json({ ok: true, factors: await listFactors(userId) });
}

// POST /auth/mfa/factors/:factor/preferred
export async function setPreferred(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const schoolId = req.user!.schoolId;
  const factor = (req.params as { factor: string }).factor as LoginFactorMethod;

  const armed = (await getArmedLoginFactors(userId)).methods;
  if (!armed.includes(factor)) {
    res.status(400).json({ error: 'That method is not turned on, so it can’t be your default.' });
    return;
  }
  await setPreferredFactor(schoolId, userId, factor);
  res.json({ ok: true, factors: await listFactors(userId) });
}

// ── helpers ──────────────────────────────────────────────────────────────────

function factorCodeError(reason: string): string {
  switch (reason) {
    case 'expired':     return 'That code expired. Request a new one.';
    case 'too_many':    return 'Too many incorrect attempts. Request a new code.';
    case 'no_code':     return 'Request a code first, then enter it here.';
    case 'unavailable': return 'That method is not available on your account.';
    default:            return 'That code is incorrect.';
  }
}

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));

// Security alert to the email on file when a sign-in factor is armed/disarmed
// — same threat model as the MFA state-change alert. Best-effort; never blocks.
async function sendFactorAlert(userId: string, factor: ManageableFactor, event: 'armed' | 'disarmed'): Promise<void> {
  try {
    // tenant-check-allow: users row keyed by id = the authenticated caller
    const { data } = await supabase.from('users').select('email, first_name').eq('id', userId).single();
    const row = data as { email?: string | null; first_name?: string } | null;
    const email = row?.email;
    if (!email) return;
    const label = factor === 'phone' ? 'Phone (WhatsApp/SMS)' : 'Email';
    const onOff = event === 'armed' ? 'turned on' : 'turned off';
    const subject = `Sign-in codes ${onOff} for your Scholify account`;
    const lines = [
      `Hi ${row?.first_name || 'there'},`,
      '',
      `${label} codes were just ${onOff} as a sign-in method on your Scholify account.`,
      '',
      "If this wasn't you, change your password immediately — that signs out every device — and review your security settings.",
    ];
    const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,Inter,sans-serif;background:#f8fafc;padding:24px"><div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:24px;color:#0f172a">${lines.map(l => l ? `<p style="margin:0 0 12px;font-size:14px;line-height:1.55">${escapeHtml(l)}</p>` : '').join('')}</div></div>`;
    await sendMail(email, subject, html, lines.join('\n'));
  } catch (err) {
    logger.error('login-factor alert send failed', { err, userId, factor, event });
  }
}
