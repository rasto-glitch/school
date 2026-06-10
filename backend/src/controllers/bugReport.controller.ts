import { Response } from 'express';
import { randomUUID } from 'crypto';
import { supabase } from '../config/supabase';
import { sanitizeFilename } from '../utils/upload';
import { safeAttachmentMime } from '../utils/storageMime';
import { logger } from '../utils/logger';
import type { AuthRequest } from '../middleware/auth';

// Bug reports submitted from the mobile app land here. We route them into
// the same operator_emails table the master-portal inbox reads from — that
// way the operator triages bugs alongside customer support messages, can
// reply (which goes to the user's email via Resend), archive, etc.
//
// The endpoint is authenticated so we know exactly who reported it. If the
// user has no email on file we return 400 with code 'no_email_on_profile'
// so the mobile UI can prompt them to set one before submitting.

const STORAGE_BUCKET = 'operator-mail';
const SUPPORT_INBOX = 'support@scholify.krd';
const MAX_DESCRIPTION = 4000;

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c),
  );

interface DeviceInfo {
  platform?: string;
  osVersion?: string;
  appVersion?: string;
  locale?: string;
  brand?: string;
  model?: string;
}

const parseDeviceInfo = (raw: unknown): DeviceInfo => {
  if (typeof raw !== 'string') return {};
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const o = parsed as Record<string, unknown>;
    return {
      platform: typeof o.platform === 'string' ? o.platform.slice(0, 32) : undefined,
      osVersion: typeof o.osVersion === 'string' ? o.osVersion.slice(0, 64) : undefined,
      appVersion: typeof o.appVersion === 'string' ? o.appVersion.slice(0, 32) : undefined,
      locale: typeof o.locale === 'string' ? o.locale.slice(0, 16) : undefined,
      brand: typeof o.brand === 'string' ? o.brand.slice(0, 64) : undefined,
      model: typeof o.model === 'string' ? o.model.slice(0, 64) : undefined,
    };
  } catch {
    return {};
  }
};

const buildBodies = (
  user: { firstName: string; lastName: string; role: string; email: string; username: string },
  school: { name: string; abbreviation: string },
  device: DeviceInfo,
  description: string,
): { text: string; html: string } => {
  const fullName = `${user.firstName} ${user.lastName}`.trim();
  const lines: { label: string; value: string }[] = [
    { label: 'Reporter',    value: `${fullName} (${user.username})` },
    { label: 'Email',       value: user.email },
    { label: 'Role',        value: user.role },
    { label: 'School',      value: `${school.name} (${school.abbreviation})` },
    { label: 'Platform',    value: [device.platform, device.osVersion].filter(Boolean).join(' ') || '-' },
    { label: 'Device',      value: [device.brand, device.model].filter(Boolean).join(' ') || '-' },
    { label: 'App version', value: device.appVersion || '-' },
    { label: 'Locale',      value: device.locale || '-' },
  ];

  const text = [
    'Bug report',
    '==========',
    '',
    ...lines.map(l => `${l.label}: ${l.value}`),
    '',
    'Description',
    '-----------',
    description,
  ].join('\n');

  const rows = lines
    .map(l => `<tr><td style="padding:6px 12px;color:#64748b;font-size:13px;white-space:nowrap">${escapeHtml(l.label)}</td><td style="padding:6px 12px;color:#0f172a;font-size:14px">${escapeHtml(l.value)}</td></tr>`)
    .join('');

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,Inter,sans-serif;background:#f8fafc;padding:24px">
      <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden">
        <div style="background:#DC2626;padding:20px 24px;color:#fff">
          <div style="font-size:12px;opacity:.8;letter-spacing:.06em;text-transform:uppercase">Scholify</div>
          <div style="font-size:20px;font-weight:800;margin-top:4px">Bug report</div>
        </div>
        <table style="width:100%;border-collapse:collapse">${rows}</table>
        <div style="padding:16px 24px;border-top:1px solid #e2e8f0">
          <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Description</div>
          <div style="font-size:14px;color:#0f172a;white-space:pre-wrap;line-height:1.55">${escapeHtml(description)}</div>
        </div>
      </div>
    </div>
  `;

  return { text, html };
};

export async function submitBugReport(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user?.userId;
  const schoolId = req.user?.schoolId;
  if (!userId || !schoolId) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const description = typeof req.body?.description === 'string'
    ? req.body.description.trim().slice(0, MAX_DESCRIPTION)
    : '';
  if (!description) {
    res.status(400).json({ error: 'description is required' });
    return;
  }

  const device = parseDeviceInfo(req.body?.deviceInfo);

  const [{ data: user }, { data: school }] = await Promise.all([
    supabase.from('users')
      .select('first_name, last_name, role, email, username')
      .eq('id', userId)
      .single(),
    supabase.from('schools')
      .select('name, abbreviation')
      .eq('id', schoolId)
      .single(),
  ]);

  if (!user || !school) {
    res.status(404).json({ error: 'user or school not found' });
    return;
  }

  const userEmail = typeof (user as { email?: string | null }).email === 'string'
    ? (user as { email: string }).email.trim()
    : '';
  if (!userEmail) {
    // Front-end checks for this exact code to surface a "set your email"
    // prompt with a button to open the email-edit modal.
    res.status(400).json({ error: 'no_email_on_profile' });
    return;
  }

  const u = user as { first_name: string; last_name: string; role: string; username: string };
  const s = school as { name: string; abbreviation: string };

  const { text, html } = buildBodies(
    {
      firstName: u.first_name,
      lastName: u.last_name,
      role: u.role,
      email: userEmail,
      username: u.username,
    },
    { name: s.name, abbreviation: s.abbreviation },
    device,
    description,
  );

  // Pre-allocate the row id so we can place the attachment under it before
  // inserting. If the upload fails we still record the row with metadata.
  const emailId = randomUUID();

  const fullName = `${u.first_name} ${u.last_name}`.trim();
  const subjectSnippet = description.replace(/\s+/g, ' ').slice(0, 60).trim();
  const subject = `[BUG] ${subjectSnippet || 'Bug report'}`;

  let attachmentRecord: {
    name: string;
    type: string;
    size: number;
    storageKey: string | null;
  } | null = null;

  if (req.file) {
    const f = req.file;
    const safe = sanitizeFilename(f.originalname || 'attachment', 'attachment');
    const key = `inbound/${emailId}/0-${safe}`;
    // Bug-report attachments arrive on the operator-mail bucket — the same
    // bucket the master operator opens in their inbox. Sanitize the stored
    // Content-Type so a malicious uploader can never land text/html or
    // image/svg+xml on a bucket where the operator may open it (pentest H-2).
    const storedMime = safeAttachmentMime(f.mimetype);
    try {
      const { error: upErr } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(key, f.buffer, {
          contentType: storedMime,
          upsert: false,
        });
      if (upErr) {
        logger.error('Bug report attachment upload failed', { error: upErr, key });
        attachmentRecord = {
          name: f.originalname || safe,
          type: storedMime,
          size: f.size,
          storageKey: null,
        };
      } else {
        attachmentRecord = {
          name: f.originalname || safe,
          type: storedMime,
          size: f.size,
          storageKey: key,
        };
      }
    } catch (err) {
      logger.error('Bug report attachment upload threw', { err });
      attachmentRecord = {
        name: f.originalname || safe,
        type: storedMime,
        size: f.size,
        storageKey: null,
      };
    }
  }

  const row = {
    id: emailId,
    message_id: `<bug-${emailId}@scholify.krd>`,
    in_reply_to: null,
    references_header: null,
    direction: 'inbound' as const,
    from_email: userEmail.toLowerCase(),
    from_name: `${fullName} (${u.role})`,
    to_email: SUPPORT_INBOX,
    cc_emails: [],
    subject,
    text_body: text,
    html_body: html,
    thread_id: emailId,
    received_at: new Date().toISOString(),
    is_read: false,
    is_archived: false,
    attachments: attachmentRecord ? [attachmentRecord] : [],
    raw_size: text.length + html.length,
  };

  // tenant-check-allow: operator_emails is operator-level (no school_id by design)
  const { error: insErr } = await supabase
    .from('operator_emails')
    .insert(row);

  if (insErr) {
    logger.error('Bug report insert failed', { error: insErr });
    res.status(500).json({ error: 'Failed to submit bug report' });
    return;
  }

  res.json({ ok: true });
}
