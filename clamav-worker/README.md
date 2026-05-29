# clamav-worker

A standalone polling worker that scans entries in `employee_documents` whose
`scan_status = 'pending'`. Verdicts: `clean`, `infected`, or left as
`pending` on a transient error so the next poll retries.

## What it does

1. Polls Supabase every `SCAN_POLL_INTERVAL_MS` milliseconds.
2. Picks up `SCAN_BATCH_SIZE` rows with `scan_status = 'pending'` and
   `voided_at IS NULL`.
3. Downloads each file from the private `employee-documents` bucket to a
   temp file.
4. Runs `clamscan` against it.
5. Updates the row's `scan_status`. On `infected`, inserts a notification
   for every active admin of the owning school (`notification_type =
   'employee_doc_infected'`).

The signed-URL endpoint in the API already refuses to issue URLs for
`infected` rows, so the moment the worker flips the status, the file is
quarantined from downloads.

## Env vars

| name                       | required | default      | notes                                              |
|----------------------------|----------|--------------|----------------------------------------------------|
| `SUPABASE_URL`             | yes      | —            | Same as the API service.                           |
| `SUPABASE_SERVICE_ROLE_KEY`     | yes      | —            | Service-role key; reads storage + writes DB.       |
| `CLAMSCAN_BIN`             | no       | `clamscan`   | Path to clamscan. Override in dev/Mac as needed.   |
| `SCAN_POLL_INTERVAL_MS`    | no       | `30000`      | 30s default.                                       |
| `SCAN_BATCH_SIZE`          | no       | `10`         | Rows pulled per poll.                              |
| `SCAN_FILE_MAX_BYTES`      | no       | `10485760`   | Defense in depth: oversize rows auto-quarantined.  |

## Local development

```bash
# Mac: brew install clamav (and set CLAMSCAN_BIN if needed).
# Linux: apt-get install clamav.
freshclam   # one-time, downloads the virus DB
cp .env.example .env  # fill in SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
npm install
npm run dev
```

## Production (Railway)

1. **Create a new Railway service**, separate from the API. Point it at this
   directory (`clamav-worker/`) as the build root.
2. **Set the env vars** above. Use the same `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY` as the API.
3. **Deploy from the Dockerfile**, not from Nixpacks — the Dockerfile
   installs ClamAV and freshclam, which Nixpacks doesn't.
4. **Enable scan mode on the API**: set `EMPLOYEE_DOC_SCAN_ENABLED=true` in
   the API's env. New uploads will then be queued with
   `scan_status='pending'` instead of `'skipped'`. (Existing rows stay
   `'skipped'` — they're not retroactively scanned. If you want them
   scanned, run an UPDATE: `UPDATE employee_documents SET scan_status =
   'pending' WHERE scan_status = 'skipped' AND voided_at IS NULL;`.)

Freshclam's definitions live on disk per container instance; on a fresh
Railway deploy the first scans can lag while definitions download. The
worker reports `scan error` for those rows and re-queues them; the next
poll picks them back up.

## Failure modes

| symptom                                   | what the worker does                    | what you should do                              |
|-------------------------------------------|-----------------------------------------|--------------------------------------------------|
| `clamscan` not on PATH                    | Logs error; rows stay `pending`         | Verify the Dockerfile builds; check Railway logs |
| Supabase reachable, scan errors           | Logs error; rows stay `pending`         | Inspect — usually fixes itself after freshclam   |
| One row failing repeatedly                | Logs per-row error; moves on            | Inspect that row's storage_path / size           |
| Worker crash                              | Railway restarts it                     | Check logs for the crash reason                  |

The worker is intentionally permissive: it never marks a row `clean` on
a scan error. The only path to `clean` is a clamscan exit code 0.
