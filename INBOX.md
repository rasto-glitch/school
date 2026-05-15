# Operator inbox

The master portal includes an **Inbox** page that shows every email sent
to Scholify's own addresses (`support@`, `onboarding@`, `contact@`,
`partner@scholify.krd`) and lets you reply via Resend without leaving
the portal.

## Architecture

```
support@scholify.krd ─┐
onboarding@           │   Cloudflare         scholify-email-worker
contact@              ├─► Email Routing ─►   (Worker)
partner@              ─┘                     │
                                             ├─► message.forward("yourgmail@gmail.com")
                                             │
                                             └─► fetch POST /api/inbound/email
                                                       (Railway backend)
                                                                │
                                                                ▼
                                                       operator_emails table
                                                                ▲
                                                                │
                                              Master portal "Inbox" ◄─┘
                                              (local-only, polls every 30s)
                                                                │
                                              Reply → Resend (from: support@…)
                                                       ↓
                                              Inserts outbound row in same thread
```

Why local-only: the master portal is the only place this UI is exposed.
Customer mail is operator-sensitive, and the portal already binds to
`127.0.0.1` with a shared `MASTER_SECRET`. Don't move this page online.

## One-time setup

### 1. Resend — verify the sending domain

You already send `no-reply@scholify.krd` from the landing forms, so
`scholify.krd` is verified for sending. Replies from the inbox use the
same domain — no extra DNS records needed. Confirm in
**Resend dashboard → Domains → scholify.krd** that the status is
**Verified**.

### 2. Database migration

Apply `database/migrations/011_operator_emails.sql` to Supabase:

```sql
-- copy/paste the file contents into SQL Editor and Run
```

### 2a. Create the attachment storage bucket

The inbox stores attachment files (both inbound and outbound replies) in a
private Supabase Storage bucket called `operator-mail`. One-time setup:

1. Supabase dashboard → **Storage** → **New bucket**.
2. Name: `operator-mail`. Public: **No** (leave private). File size limit:
   leave default; we cap at 10 MB per file in code.
3. Click **Create bucket**.

That's it — the master server uses the service-role key to read/write
this bucket, and clients only see short-lived signed URLs for download.

### 3. Backend env var

Generate a long random secret (32+ chars). Then in Railway →
**backend** service → **Variables**:

```
INBOUND_EMAIL_SECRET=<your random secret>
```

Save. Railway will redeploy automatically.

### 4. Cloudflare Worker

```powershell
cd "e:\school project\cloudflare\email-worker"
npm install
npx wrangler login
```

Edit `wrangler.toml`:

- `INBOUND_URL` → your Railway URL, e.g.
  `https://scholify-backend-production.up.railway.app/api/inbound/email`
- `GMAIL_FORWARD` → the personal Gmail you currently use for
  scholify.krd mail.

Add the shared secret (must match the one you set on Railway):

```powershell
npx wrangler secret put INBOUND_EMAIL_SECRET
# paste the same long random secret
```

Deploy:

```powershell
npx wrangler deploy
```

### 5. Cloudflare Email Routing — point addresses at the Worker

In the Cloudflare dashboard → `scholify.krd` → **Email** →
**Email Routing** → **Routes**, for each address (`support@`,
`onboarding@`, `contact@`, `partner@`) edit/create a rule:

- **Matcher:** the address (e.g. `support@scholify.krd`)
- **Action:** _Send to a Worker_
- **Destination:** `scholify-email-worker`

The Worker itself forwards a copy to your Gmail, so you don't need a
separate Gmail-forwarding route on the same address — having both will
deliver the email to Gmail twice.

### 6. Master portal — env var

Add `RESEND_API_KEY` to `master/server/.env` (same value as the backend's).
Restart the master server:

```powershell
cd "e:\school project\master\server"
npm install            # picks up the new resend dependency
npm run dev
```

## Verifying

Send a test email to `support@scholify.krd` from any address. Within
~10 seconds you should see it:

1. In your Gmail.
2. In the master portal Inbox under the **Support** tab.

If only Gmail receives it, the webhook is failing. Run
`npx wrangler tail` from `cloudflare/email-worker/` to watch logs.

## Limits and known caveats

- **Attachments** are stored in the private `operator-mail` Supabase
  Storage bucket. Per-file cap is **10 MB**; per-send cap is **25 MB**
  total, max **10 files**. These limits are enforced in three places:
  the Cloudflare Worker (skips inbound attachments >10 MB and ships
  metadata only), `multer` on the master server (rejects oversized
  uploads), and the client (validates before submit). Attachments
  larger than the cap on inbound are shown as a dimmed chip in the UI
  with a tooltip pointing the operator to the Gmail mirror.
- **HTML rendering** in the thread reader is plain-text only. Most
  customer mail is plain anyway; if needed, switch the `<pre>` block
  in `InboxPage.tsx` to a sanitized HTML renderer (DOMPurify) later.
- **Threading** matches on `Message-ID` / `In-Reply-To` / `References`.
  Customers who reply to your reply without preserving those headers
  (rare — every modern MUA does) will start a new thread.
- **Polling** is every 30s. There is no realtime push; the operator
  workload doesn't justify Socket.io plumbing for this.
- **Operator audit trail.** Unlike chat audit, there is no access log
  on operator_emails. The portal is single-operator, so a log would
  only ever record yourself. Revisit if you ever delegate this.
