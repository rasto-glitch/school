import { Request, Response } from 'express';
import { Resend } from 'resend';
import { logger } from '../utils/logger';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const TO_EMAIL = process.env.LANDING_INBOX || 'onboarding@scholify.krd';
const CONTACT_TO_EMAIL = process.env.CONTACT_INBOX || 'contact@scholify.krd';
const FROM_EMAIL = process.env.LANDING_FROM || 'Scholify <no-reply@scholify.krd>';

const str = (v: unknown, max = 500) =>
  typeof v === 'string' ? v.trim().slice(0, max) : '';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c),
  );

const row = (label: string, value: string) =>
  value
    ? `<tr><td style="padding:6px 12px;color:#64748b;font-size:13px;vertical-align:top;white-space:nowrap">${esc(label)}</td><td style="padding:6px 12px;color:#0f172a;font-size:14px">${esc(value).replace(/\n/g, '<br/>')}</td></tr>`
    : '';

const wrapper = (title: string, rows: string) => `
  <div style="font-family:-apple-system,BlinkMacSystemFont,Inter,sans-serif;background:#f8fafc;padding:24px">
    <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden">
      <div style="background:#6366F1;padding:20px 24px;color:#fff">
        <div style="font-size:12px;opacity:.8;letter-spacing:.06em;text-transform:uppercase">Scholify</div>
        <div style="font-size:20px;font-weight:800;margin-top:4px">${esc(title)}</div>
      </div>
      <table style="width:100%;border-collapse:collapse">${rows}</table>
    </div>
  </div>
`;

const send = async (subject: string, html: string, replyTo?: string, to: string = TO_EMAIL) => {
  if (!resend) {
    logger.warn('Resend API key missing; skipping send', { subject });
    return;
  }
  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to,
    replyTo,
    subject,
    html,
  });
  if (error) {
    logger.error('Resend send failed', { error, subject });
    throw new Error('send_failed');
  }
};

export const demoRequest = async (req: Request, res: Response) => {
  // Honeypot — bots fill hidden fields; real users don't
  if (str(req.body?.website)) return res.status(200).json({ ok: true });

  const schoolName  = str(req.body?.schoolName, 200);
  const contactName = str(req.body?.contactName, 200);
  const email       = str(req.body?.email, 200);
  const role        = str(req.body?.role, 200);
  const phone       = str(req.body?.phone, 50);
  const students    = str(req.body?.students, 20);
  const message     = str(req.body?.message, 2000);

  if (!schoolName || !contactName || !email) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email.' });
  }

  const rows = [
    row('School', schoolName),
    row('Contact', contactName),
    row('Role', role),
    row('Email', email),
    row('Phone', phone),
    row('Students', students),
    row('Message', message),
  ].join('');

  try {
    await send(`Demo request — ${schoolName}`, wrapper('New demo request', rows), email);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Could not send. Please try again later.' });
  }
};

export const contactRequest = async (req: Request, res: Response) => {
  if (str(req.body?.website)) return res.status(200).json({ ok: true });

  const name    = str(req.body?.name, 200);
  const email   = str(req.body?.email, 200);
  const subject = str(req.body?.subject, 200);
  const message = str(req.body?.message, 4000);

  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email.' });
  }

  const rows = [
    row('Name', name),
    row('Email', email),
    row('Subject', subject),
    row('Message', message),
  ].join('');

  try {
    await send(
      `Contact form — ${subject || name}`,
      wrapper('New contact message', rows),
      email,
      CONTACT_TO_EMAIL,
    );
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Could not send. Please try again later.' });
  }
};

export const partnerApplication = async (req: Request, res: Response) => {
  if (str(req.body?.website)) return res.status(200).json({ ok: true });

  const companyName = str(req.body?.companyName, 200);
  const contactName = str(req.body?.contactName, 200);
  const email       = str(req.body?.email, 200);
  const phone       = str(req.body?.phone, 50);
  const country     = str(req.body?.country, 100);
  const about       = str(req.body?.about, 2000);

  if (!companyName || !contactName || !email) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email.' });
  }

  const rows = [
    row('Company', companyName),
    row('Contact', contactName),
    row('Email', email),
    row('Phone', phone),
    row('Country', country),
    row('About', about),
  ].join('');

  try {
    await send(`Partner application — ${companyName}`, wrapper('New partner application', rows), email);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Could not send. Please try again later.' });
  }
};
