import { Resend } from 'resend';
import { logger } from './logger';

// Shared transactional mailer. Extracted from auth.controller so both the
// auth flows and the ops alerter use ONE transport/config (no drift).
// Resend is optional: with no RESEND_API_KEY the app still runs and mail
// is logged-and-skipped rather than throwing.

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
export const FROM_EMAIL = process.env.LANDING_FROM || 'Scholify <no-reply@scholify.krd>';

export const mailerConfigured = (): boolean => resend !== null;

export const sendMail = async (to: string, subject: string, html: string, text: string): Promise<void> => {
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
