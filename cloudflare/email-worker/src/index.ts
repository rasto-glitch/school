/// <reference types="@cloudflare/workers-types" />
//
// scholify-email-worker
//
// Triggered by Cloudflare Email Routing on every inbound message to a
// configured address (support@, onboarding@, contact@, partner@). It:
//
//   1. Mirrors the email to your personal Gmail (so the existing
//      forwarding behaviour is preserved).
//   2. Parses the MIME with postal-mime and POSTs a structured JSON
//      payload to the backend's /api/inbound/email webhook so it shows
//      up in the master-portal inbox.
//
// Failure modes are isolated: a parse error or backend hiccup never blocks
// the Gmail forward, and a forward failure never blocks the webhook. The
// worker always finishes successfully so Cloudflare doesn't bounce the
// sender's email.

import PostalMime from 'postal-mime';

interface Env {
  INBOUND_URL: string;
  INBOUND_EMAIL_SECRET: string; // wrangler secret put INBOUND_EMAIL_SECRET
}

interface ParsedAttachment {
  filename?: string;
  mimeType?: string;
  content?: ArrayBuffer | Uint8Array;
}

// Per-attachment cap. Larger files arrive as metadata-only; the operator
// can still retrieve them from the Gmail mirror. Keeps Worker memory and
// the JSON payload to the backend bounded.
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENTS = 10;

function bytesOf(content: ParsedAttachment['content']): Uint8Array | null {
  if (!content) return null;
  if (content instanceof Uint8Array) return content;
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  return null;
}

function toBase64(bytes: Uint8Array): string {
  // Chunked to avoid huge intermediate string-from-charcodes calls.
  const CHUNK = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
  }
  return btoa(parts.join(''));
}

interface ParsedEmail {
  messageId?: string;
  inReplyTo?: string;
  references?: string | string[];
  from?: { address?: string; name?: string };
  to?: { address?: string; name?: string }[];
  cc?: { address?: string; name?: string }[];
  subject?: string;
  text?: string;
  html?: string;
  attachments?: ParsedAttachment[];
}

// Read the raw RFC 822 message into a single Uint8Array. Cloudflare gives
// us a ReadableStream; postal-mime accepts a buffer directly.
async function readRaw(message: ForwardableEmailMessage): Promise<Uint8Array> {
  const reader = message.raw.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  // Hard cap at 10 MB so a malformed/huge message can't OOM the worker.
  // Cloudflare Email Routing already enforces ~25 MB; this is a safety net.
  const MAX = 10 * 1024 * 1024;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > MAX) throw new Error('message too large');
      chunks.push(value);
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

function flattenRefs(refs: ParsedEmail['references']): string | undefined {
  if (!refs) return undefined;
  if (Array.isArray(refs)) return refs.join(' ');
  return refs;
}

export default {
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    // Backend webhook is the only destination. The previous personal-Gmail
    // mirror (env.GMAIL_FORWARD → rasto.elkurdi@gmail.com) was removed
    // because parent correspondence about minors should not be mirrored
    // into a personal Google Workspace account; the backend stores
    // inbound mail in Supabase and surfaces it via the operator inbox.
    //
    // We must finish reading the raw body BEFORE the worker exits, but
    // we don't want to block returning either — wrap the rest in
    // waitUntil so Cloudflare keeps the worker alive.
    const work = (async () => {
      let raw: Uint8Array;
      try {
        raw = await readRaw(message);
      } catch (err) {
        console.error('read raw failed', err);
        return;
      }

      let parsed: ParsedEmail;
      try {
        parsed = (await PostalMime.parse(raw)) as ParsedEmail;
      } catch (err) {
        console.error('parse failed', err);
        return;
      }

      const payload = {
        messageId: parsed.messageId,
        inReplyTo: parsed.inReplyTo,
        references: flattenRefs(parsed.references),
        from: parsed.from,
        to: parsed.to,
        cc: parsed.cc,
        subject: parsed.subject,
        text: parsed.text,
        html: parsed.html,
        attachments: (parsed.attachments || []).slice(0, MAX_ATTACHMENTS).map(a => {
          const bytes = bytesOf(a.content);
          const size = bytes?.byteLength;
          return {
            filename: a.filename,
            mimeType: a.mimeType,
            size,
            // Ship the file body only when small enough; backend will
            // store it in Supabase. Oversized files become metadata-only.
            contentBase64:
              bytes && typeof size === 'number' && size > 0 && size <= MAX_ATTACHMENT_BYTES
                ? toBase64(bytes)
                : undefined,
          };
        }),
        rawSize: raw.byteLength,
      };

      try {
        const resp = await fetch(env.INBOUND_URL, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-inbound-secret': env.INBOUND_EMAIL_SECRET,
          },
          body: JSON.stringify(payload),
        });
        if (!resp.ok) {
          const body = await resp.text().catch(() => '');
          console.error('webhook non-2xx', resp.status, body.slice(0, 500));
        }
      } catch (err) {
        console.error('webhook fetch failed', err);
      }
    })();

    ctx.waitUntil(work);
  },
};
