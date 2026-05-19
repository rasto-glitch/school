import crypto from 'crypto';
import { logger } from './logger';
import { sendMail, mailerConfigured } from './mailer';

// Ops alerting — turns "logged but nobody knows" into an email.
//
// Design constraints, in priority order:
//  1. NEVER throw / never block. A failing alerter must not crash the
//     request handler or the process. Everything is wrapped; failures
//     degrade to a winston log line.
//  2. Storm-proof. One bad deploy can throw thousands of identical errors.
//     We fingerprint by (name + first stack frame + path) and:
//       - send at most ONE email per fingerprint per DEDUP_WINDOW_MS,
//         then a single follow-up with the suppressed count;
//       - cap the GLOBAL email rate (MAX_ALERTS_PER_WINDOW) so a burst of
//         *distinct* errors still can't flood the inbox.
//  3. No new dependency, no third party — error context (which can carry
//     student PII / minors' data) never leaves our infrastructure.
//
// State is in-memory: a process restart resets dedup (acceptable — at
// worst one extra alert after a restart, which you want to know about).

const DEDUP_WINDOW_MS = 10 * 60 * 1000;   // 1 alert per identical error / 10 min
const RATE_WINDOW_MS = 60 * 60 * 1000;    // global budget window
const MAX_ALERTS_PER_WINDOW = 20;         // distinct-error email cap / hour

interface DedupEntry { firstAt: number; lastSentAt: number; suppressed: number }
const dedup = new Map<string, DedupEntry>();
let windowStart = Date.now();
let sentThisWindow = 0;

function fingerprint(kind: string, err: unknown, ctx?: string): string {
  const e = err as Error | undefined;
  const firstFrame = (e?.stack?.split('\n')[1] ?? e?.message ?? String(err)).trim();
  return crypto.createHash('sha256')
    .update(`${kind}|${e?.name ?? ''}|${firstFrame}|${ctx ?? ''}`)
    .digest('hex')
    .slice(0, 16);
}

function describe(err: unknown): { message: string; stack: string } {
  if (err instanceof Error) {
    return { message: `${err.name}: ${err.message}`, stack: err.stack ?? '(no stack)' };
  }
  try { return { message: String(err), stack: JSON.stringify(err) }; }
  catch { return { message: 'Non-serializable error', stack: '(unavailable)' }; }
}

const esc = (s: string): string =>
  s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] || c));

/**
 * Fire-and-forget ops alert. Safe to call from anywhere, including process
 * crash handlers. Resolves quickly; the email send is awaited internally
 * but every failure path is swallowed (logged via winston only).
 *
 * @param kind  short category, e.g. "Unhandled HTTP error", "uncaughtException"
 * @param err   the error/throwable
 * @param meta  optional context (request path/method, etc.)
 */
export async function reportError(
  kind: string,
  err: unknown,
  meta?: Record<string, unknown>,
): Promise<void> {
  try {
    const ctx = meta?.path ? `${meta.method ?? ''} ${meta.path}` : undefined;
    const fp = fingerprint(kind, err, ctx);
    const now = Date.now();

    // ── dedup: same error seen recently → just count it ──
    const seen = dedup.get(fp);
    if (seen && now - seen.lastSentAt < DEDUP_WINDOW_MS) {
      seen.suppressed += 1;
      return;
    }

    // ── global rate budget ──
    if (now - windowStart > RATE_WINDOW_MS) { windowStart = now; sentThisWindow = 0; }
    if (sentThisWindow >= MAX_ALERTS_PER_WINDOW) {
      logger.warn('Ops alert suppressed — hourly alert budget exhausted', { kind, fp });
      return;
    }

    const recipient = process.env.ALERT_EMAIL?.trim();
    const suppressedNote = seen && seen.suppressed > 0
      ? `\n\n(${seen.suppressed} identical occurrence(s) were suppressed in the last ${Math.round(DEDUP_WINDOW_MS / 60000)} min.)`
      : '';
    dedup.set(fp, { firstAt: seen?.firstAt ?? now, lastSentAt: now, suppressed: 0 });

    const { message, stack } = describe(err);
    const env = process.env.NODE_ENV ?? 'unknown';
    const when = new Date(now).toISOString();
    const metaLines = meta
      ? Object.entries(meta).map(([k, v]) => `${k}: ${String(v)}`).join('\n')
      : '';

    // Always log — this is the fallback when mail isn't configured/fails.
    logger.error(`[ALERT] ${kind}`, { message, fingerprint: fp, meta });

    if (!recipient || !mailerConfigured()) return; // logged above; nothing to send
    sentThisWindow += 1;

    const subject = `[Scholify ${env}] ${kind}: ${message.slice(0, 120)}`;
    const text =
      `Kind: ${kind}\nEnv: ${env}\nTime: ${when}\nFingerprint: ${fp}\n` +
      `${metaLines ? metaLines + '\n' : ''}\n${message}\n\n${stack}${suppressedNote}`;
    const html =
      `<h2>${esc(kind)}</h2>` +
      `<p><b>Env:</b> ${esc(env)} &nbsp; <b>Time:</b> ${esc(when)} &nbsp; <b>FP:</b> ${esc(fp)}</p>` +
      (metaLines ? `<pre>${esc(metaLines)}</pre>` : '') +
      `<p><b>${esc(message)}</b></p><pre>${esc(stack)}</pre>` +
      (suppressedNote ? `<p><i>${esc(suppressedNote.trim())}</i></p>` : '');

    await sendMail(recipient, subject, html, text);
  } catch (alertErr) {
    // The alerter itself must never escalate. Log and move on.
    try { logger.error('Ops alerter failed', { alertErr }); } catch { /* noop */ }
  }
}
