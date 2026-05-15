import { Request, Response } from 'express';
import { Resend } from 'resend';
import { logger } from '../utils/logger';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const TO_EMAIL = process.env.LANDING_INBOX || 'onboarding@scholify.krd';
const CONTACT_TO_EMAIL = process.env.CONTACT_INBOX || 'contact@scholify.krd';
const PARTNER_TO_EMAIL = process.env.PARTNER_INBOX || 'partner@scholify.krd';
const FROM_EMAIL = process.env.LANDING_FROM || 'Scholify <no-reply@scholify.krd>';

const str = (v: unknown, max = 500) =>
  typeof v === 'string' ? v.trim().slice(0, max) : '';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c),
  );

const htmlRow = (label: string, value: string) =>
  value
    ? `<tr><td style="padding:6px 12px;color:#64748b;font-size:13px;vertical-align:top;white-space:nowrap">${esc(label)}</td><td style="padding:6px 12px;color:#0f172a;font-size:14px">${esc(value).replace(/\n/g, '<br/>')}</td></tr>`
    : '';

const wrapHtml = (title: string, rows: string) => `
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

// Plain-text rendering for the master-inbox text body and any client that
// strips HTML. Without this, postal-mime collapses the table cells in the
// HTML version into one wall of concatenated text (Name<value>Email<value>…).
const wrapText = (title: string, fields: { label: string; value: string }[]) => {
  const rows = fields
    .filter(f => f.value)
    .map(f => `${f.label}: ${f.value}`)
    .join('\n');
  return `${title}\n${'='.repeat(title.length)}\n\n${rows}\n`;
};

type Field = { label: string; value: string };
const buildBodies = (title: string, fields: Field[]) => ({
  html: wrapHtml(title, fields.map(f => htmlRow(f.label, f.value)).join('')),
  text: wrapText(title, fields),
});

interface SendArgs {
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  to?: string;
}

const send = async ({ subject, html, text, replyTo, to = TO_EMAIL }: SendArgs) => {
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
    text,
  });
  if (error) {
    // Resend errors typically expose .name and .message. Log both so the
    // operator can tell apart "domain not verified", "rate limit", "invalid
    // recipient" etc. when triaging failed sends.
    logger.error('Resend send failed', {
      from: FROM_EMAIL,
      to,
      subject,
      errorName: (error as { name?: string }).name,
      errorMessage: (error as { message?: string }).message,
      error,
    });
    const err = new Error('send_failed') as Error & { resendMessage?: string };
    err.resendMessage = (error as { message?: string }).message;
    throw err;
  }
};

// 5xx response for the public landing forms. The underlying Resend reason
// ("domain not verified", "rate limit exceeded", ...) is always logged for
// the operator, but only echoed to the (unauthenticated) caller outside
// production — in prod it would leak mail-infra state to anyone.
const sendError = (res: Response, err: unknown) => {
  const e = err as { resendMessage?: string };
  const detail =
    process.env.NODE_ENV !== 'production' && e?.resendMessage
      ? ` (${e.resendMessage})`
      : '';
  res.status(500).json({ error: `Could not send. Please try again later.${detail}` });
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

  const { html, text } = buildBodies('New demo request', [
    { label: 'School',   value: schoolName },
    { label: 'Contact',  value: contactName },
    { label: 'Role',     value: role },
    { label: 'Email',    value: email },
    { label: 'Phone',    value: phone },
    { label: 'Students', value: students },
    { label: 'Message',  value: message },
  ]);

  try {
    await send({
      subject: `Demo request - ${schoolName}`,
      html,
      text,
      replyTo: email,
    });
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
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

  const { html, text } = buildBodies('New contact message', [
    { label: 'Name',    value: name },
    { label: 'Email',   value: email },
    { label: 'Subject', value: subject },
    { label: 'Message', value: message },
  ]);

  try {
    await send({
      subject: `Contact form - ${subject || name}`,
      html,
      text,
      replyTo: email,
      to: CONTACT_TO_EMAIL,
    });
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
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

  const { html, text } = buildBodies('New partner application', [
    { label: 'Company', value: companyName },
    { label: 'Contact', value: contactName },
    { label: 'Email',   value: email },
    { label: 'Phone',   value: phone },
    { label: 'Country', value: country },
    { label: 'About',   value: about },
  ]);

  try {
    await send({
      subject: `Partner application - ${companyName}`,
      html,
      text,
      replyTo: email,
      to: PARTNER_TO_EMAIL,
    });
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
};
