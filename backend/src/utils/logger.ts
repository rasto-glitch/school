import { createLogger, format, transports } from 'winston';

// Structured JSON logger → stdout (Railway captures stdout as the log
// stream; no file transport/rotation needed).
//
// SECURITY: a redaction format runs on every record so neither current nor
// future code can leak sensitive data through log metadata:
//   - any key whose name looks secret (password/token/secret/authorization/
//     apikey/cookie/jwt/credential/…) has its value replaced with [REDACTED];
//   - any string that contains an email address is partial-masked
//     (j***@e***.com) wherever it appears — top-level message, a `to`
//     field, or inside an error message/stack — so contact PII (this is a
//     system handling minors' families) never lands in persistent logs.
// The transform is depth/array/cycle-bounded and wrapped so a malformed
// payload can never break logging itself.

const SENSITIVE_KEY = /pass(word|wd)?|token|secret|authorization|api[_-]?key|cookie|jwt|credential|private[_-]?key/i;

// Keep first char of local part + first char of domain + the TLD/suffix.
// "no-reply@scholify.krd" → "n***@s***.krd"
const maskEmails = (s: string): string =>
  s.replace(
    /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9-])[A-Za-z0-9-]*(\.[A-Za-z0-9.-]+)/g,
    (_m, a: string, b: string, tld: string) => `${a}***@${b}***${tld}`,
  );

const MAX_DEPTH = 6;
const MAX_ARRAY = 100;

function sanitize(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return maskEmails(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[Truncated]';
  if (seen.has(value as object)) return '[Circular]';
  seen.add(value as object);
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((v) => sanitize(v, depth + 1, seen));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) ? '[REDACTED]' : sanitize(v, depth + 1, seen);
  }
  return out;
}

// Custom format: mutate only the top-level `info` props (winston hands us a
// fresh `info` per record); nested caller objects are never mutated because
// `sanitize` returns rebuilt copies. Errors in here are swallowed so a bad
// log payload degrades to a raw line instead of crashing the logger.
const redact = format((info) => {
  try {
    for (const key of Object.keys(info)) {
      if (key === 'level' || key === 'timestamp') continue;
      if (key === 'message') {
        if (typeof info.message === 'string') info.message = maskEmails(info.message);
        continue;
      }
      if (SENSITIVE_KEY.test(key)) {
        (info as Record<string, unknown>)[key] = '[REDACTED]';
        continue;
      }
      (info as Record<string, unknown>)[key] = sanitize(
        (info as Record<string, unknown>)[key],
        0,
        new WeakSet(),
      );
    }
  } catch {
    /* never let redaction break logging */
  }
  return info;
});

export const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }), // flattens Error → message + stack (then masked below)
    redact(),
    format.json(),
  ),
  transports: [new transports.Console()],
});
