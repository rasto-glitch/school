// OTPIQ — Iraqi WhatsApp / SMS / Telegram verification platform.
// Thin typed HTTP client. We only use the WhatsApp channel; SMS
// fallback at the OTPIQ level is deliberately NOT used (we fall back
// to email via our own SMTP instead). See FEATURE.md "Phone OTP" for
// the rationale and the locked design decisions.
//
// Reference: https://otpiq.com/ + https://docs.otpiq.com/
//   POST {base}/sms        — send a verification code
//   GET  {base}/sms/{id}   — track delivery status of a previous send
//   GET  {base}/project    — project info + remaining credit
//
// Auth: Authorization: Bearer <OTPIQ_API_KEY>. In dev, use the dev key
// (sk_dev_…) so OTPIQ intercepts every send and routes to your
// configured development phone instead of the real recipient.
//
// We use Node's built-in fetch (Node 18+).

import { logger } from './logger';

const DEFAULT_TIMEOUT_MS = 15_000;

export interface OtpiqConfig {
  apiKey: string;
  baseUrl: string;          // e.g. https://api.otpiq.com/api
  provider: OtpiqProvider;  // default 'whatsapp'
  webhookUrl?: string;      // public URL OTPIQ posts delivery events to
  webhookSecret?: string;   // shared secret OTPIQ signs webhook bodies with
}

export type OtpiqProvider =
  | 'whatsapp'              // WhatsApp only (our default — email fallback handled app-side)
  | 'sms'                   // SMS only
  | 'telegram'              // Telegram only
  | 'whatsapp-sms'          // OTPIQ-managed WhatsApp → SMS fallback
  | 'telegram-sms'
  | 'whatsapp-telegram-sms'
  | 'auto';

export interface SendVerificationInput {
  // E.164 without the leading '+', e.g. '9647501234567'. OTPIQ does not
  // accept the '+' prefix in this field. The phone helper strips it
  // before we get here.
  phoneNumber: string;
  verificationCode: string;
  provider?: OtpiqProvider;
  // Per-request webhook config. Set if env has webhookUrl + secret.
  webhookUrl?: string;
  webhookSecret?: string;
}

export interface SendVerificationResult {
  smsId: string;            // 'sms-…' — correlation id for tracking + webhooks
  remainingCredit?: number;
  cost?: number;
  // OTPIQ returns more fields; we only surface what we use.
  raw: unknown;
}

export interface TrackStatusResult {
  smsId: string;
  status: OtpiqStatus;
  isFinalStatus: boolean;
  lastChannel?: string;
  channelFlow?: Array<{ channel: string; status: string }>;
  raw: unknown;
}

// Status values are not exhaustively documented; treat as open enum
// and let callers branch on the strings they care about. The two we
// react to in the orchestrator are 'delivered' and any of the
// failure-shaped strings ('failed' / 'expired' / 'undeliverable').
export type OtpiqStatus =
  | 'pending'
  | 'sent'
  | 'delivered'
  | 'failed'
  | 'expired'
  | 'undeliverable'
  | (string & {});

// Error class so callers can branch on category instead of regex'ing
// error messages. Mirrors the Laravel client's OtpiqApiException
// (isAuthError / isCreditError / isRateLimitError / etc.) which is the
// closest thing OTPIQ has to a written contract.
export class OtpiqError extends Error {
  status: number;            // HTTP status; 0 if the request never left
  category: OtpiqErrorCategory;
  raw: unknown;
  constructor(message: string, status: number, category: OtpiqErrorCategory, raw: unknown) {
    super(message);
    this.name = 'OtpiqError';
    this.status = status;
    this.category = category;
    this.raw = raw;
  }
  isAuthError(): boolean        { return this.category === 'auth'; }
  isCreditError(): boolean      { return this.category === 'credit'; }
  isRateLimitError(): boolean   { return this.category === 'rate_limit'; }
  isValidationError(): boolean  { return this.category === 'validation'; }
  isTransientError(): boolean   { return this.category === 'transient'; }
  isTrialModeError(): boolean   { return this.category === 'trial_mode'; }
}

export type OtpiqErrorCategory =
  | 'auth'                   // invalid api key
  | 'credit'                 // insufficient balance
  | 'rate_limit'             // OTPIQ throttled us
  | 'validation'             // bad field — e.g. malformed phone, bad provider
  | 'trial_mode'             // account in trial; recipient outside whitelist
  | 'transient'              // 5xx / network / timeout — retryable
  | 'unknown';

// Read config from env once at import. Throwing here would prevent the
// backend from booting without OTPIQ keys; instead, sendVerification
// throws OtpiqError('auth') at call time if config is missing — same
// posture as the existing mailer (missing key = skip, log, don't crash).
function readConfig(): OtpiqConfig | null {
  const apiKey = process.env.OTPIQ_API_KEY || '';
  const baseUrl = (process.env.OTPIQ_BASE_URL || 'https://api.otpiq.com/api').replace(/\/+$/, '');
  const provider = (process.env.OTPIQ_PROVIDER || 'whatsapp') as OtpiqProvider;
  const webhookUrl = process.env.OTPIQ_WEBHOOK_URL || undefined;
  const webhookSecret = process.env.OTPIQ_WEBHOOK_SECRET || undefined;
  if (!apiKey) return null;
  return { apiKey, baseUrl, provider, webhookUrl, webhookSecret };
}

export const otpiqConfigured = (): boolean => readConfig() !== null;

async function call<T>(opts: {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  timeoutMs?: number;
}): Promise<T> {
  const cfg = readConfig();
  if (!cfg) {
    throw new OtpiqError('OTPIQ_API_KEY is not set', 0, 'auth', null);
  }
  const url = `${cfg.baseUrl}${opts.path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method,
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const msg = (err as Error).message || 'network_error';
    throw new OtpiqError(`OTPIQ network error: ${msg}`, 0, 'transient', null);
  }
  clearTimeout(timer);

  // Try to parse body even for non-2xx so we can pull error details.
  let payload: unknown = null;
  const text = await res.text();
  if (text) {
    try { payload = JSON.parse(text); }
    catch { payload = text; }
  }

  if (!res.ok) {
    throw classifyError(res.status, payload);
  }
  return payload as T;
}

function classifyError(status: number, payload: unknown): OtpiqError {
  const body = (payload && typeof payload === 'object') ? payload as Record<string, unknown> : {};
  const message =
    (typeof body.message === 'string' && body.message) ||
    (typeof body.error === 'string' && body.error) ||
    `OTPIQ HTTP ${status}`;
  const errCode = typeof body.code === 'string' ? body.code : '';

  // Documented error shapes from the Laravel client + OTPIQ docs.
  if (status === 401 || status === 403) return new OtpiqError(message, status, 'auth', payload);
  if (status === 402 || /insufficient|credit|balance/i.test(message)) {
    return new OtpiqError(message, status, 'credit', payload);
  }
  if (status === 429 || /rate.?limit|too many/i.test(message)) {
    return new OtpiqError(message, status, 'rate_limit', payload);
  }
  if (status === 400 || status === 422 || /invalid|validation|format/i.test(message)) {
    return new OtpiqError(message, status, 'validation', payload);
  }
  if (errCode === 'trial_mode' || /trial/i.test(message)) {
    return new OtpiqError(message, status, 'trial_mode', payload);
  }
  if (status >= 500) return new OtpiqError(message, status, 'transient', payload);
  return new OtpiqError(message, status, 'unknown', payload);
}

// ── public surface ─────────────────────────────────────────────────────────

export async function sendVerification(input: SendVerificationInput): Promise<SendVerificationResult> {
  const cfg = readConfig();
  if (!cfg) {
    throw new OtpiqError('OTPIQ_API_KEY is not set', 0, 'auth', null);
  }

  // Request body shape per OTPIQ docs + Laravel client. The Laravel
  // client wraps a deliveryReport block when a webhook secret exists;
  // we mirror that so OTPIQ pings our webhook on every status change.
  const body: Record<string, unknown> = {
    phoneNumber: input.phoneNumber,
    smsType: 'verification',
    verificationCode: input.verificationCode,
    provider: input.provider ?? cfg.provider,
  };

  const webhookUrl = input.webhookUrl ?? cfg.webhookUrl;
  const webhookSecret = input.webhookSecret ?? cfg.webhookSecret;
  if (webhookUrl && webhookSecret) {
    body.deliveryReport = {
      webhookUrl,
      webhookSecret,
      deliveryReportType: 'all',
    };
  }

  logger.info('OTPIQ send', {
    phoneNumber: maskPhone(input.phoneNumber),
    provider: body.provider,
    webhook: !!webhookUrl,
  });

  const raw = await call<Record<string, unknown>>({ method: 'POST', path: '/sms', body });
  const smsId = (raw.smsId as string) || (raw.id as string) || '';
  if (!smsId) {
    throw new OtpiqError('OTPIQ response missing smsId', 200, 'unknown', raw);
  }
  return {
    smsId,
    remainingCredit: numeric(raw.remainingCredit),
    cost: numeric(raw.cost),
    raw,
  };
}

export async function trackSms(smsId: string): Promise<TrackStatusResult> {
  const raw = await call<Record<string, unknown>>({
    method: 'GET',
    path: `/sms/${encodeURIComponent(smsId)}`,
  });
  return {
    smsId: (raw.smsId as string) || smsId,
    status: (raw.status as OtpiqStatus) || 'pending',
    isFinalStatus: !!raw.isFinalStatus,
    lastChannel: (raw.lastChannel as string) || undefined,
    channelFlow: Array.isArray(raw.channelFlow) ? raw.channelFlow as TrackStatusResult['channelFlow'] : undefined,
    raw,
  };
}

export async function getProjectInfo(): Promise<{ name?: string; credit?: number; raw: unknown }> {
  const raw = await call<Record<string, unknown>>({ method: 'GET', path: '/project' });
  return {
    name: typeof raw.name === 'string' ? raw.name : undefined,
    credit: numeric(raw.credit ?? raw.remainingCredit),
    raw,
  };
}

// ── helpers ────────────────────────────────────────────────────────────────

function numeric(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

// Mask all but the last 4 digits for logs — never log a full phone.
function maskPhone(p: string): string {
  if (!p) return '';
  const last4 = p.slice(-4);
  return `${'•'.repeat(Math.max(0, p.length - 4))}${last4}`;
}
