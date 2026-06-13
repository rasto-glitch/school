# scholify-email-worker

Cloudflare Email Worker that handles inbound mail for `scholify.krd`.
Every incoming message to `support@`, `onboarding@`, `contact@`, and
`partner@` is parsed with [`postal-mime`](https://www.npmjs.com/package/postal-mime)
and POSTed to the backend at `INBOUND_URL` so it appears in the master
portal's Inbox page.

## One-time setup

```powershell
cd "e:\school project\cloudflare\email-worker"
npm install
npx wrangler login   # opens browser, link your Cloudflare account
```

Edit `wrangler.toml`:

- `INBOUND_URL` → your Railway URL, e.g. `https://scholify-backend-production.up.railway.app/api/inbound/email`

Set the shared secret (must match `INBOUND_EMAIL_SECRET` in Railway):

```powershell
npx wrangler secret put INBOUND_EMAIL_SECRET
# paste a long random string when prompted
```

Deploy:

```powershell
npx wrangler deploy
```

## Wire up the addresses

In the Cloudflare dashboard → your domain → Email → Email Routing →
**Custom addresses**, for each address (`support@`, `onboarding@`,
`contact@`, `partner@`) create a rule:

- **Matcher:** the address
- **Action:** _Send to a Worker_
- **Worker:** `scholify-email-worker`

Once active, sending a test email to e.g. `support@scholify.krd` should
appear under the **Support** tab of the master-portal Inbox page within
a few seconds.

## Tail logs

```powershell
npx wrangler tail
```

Useful when the webhook isn't firing — `wrangler tail` prints every
`console.log`/`console.error` from the worker in real time.

## Failure model

- A webhook failure is logged but does NOT bounce the sender.
- A malformed/oversized message is dropped.

The worker always returns success so Cloudflare never replies to the
sender with an SMTP error.

## Historical note

Earlier versions of this worker also forwarded every inbound message
to a personal Gmail address (via `env.GMAIL_FORWARD`). That mirror was
removed because parent correspondence about minors should not be sent
into a personal Google Workspace account. The Supabase-backed operator
inbox is now the only destination.
