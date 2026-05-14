# Backup & restore

Off-site, end-to-end encrypted Postgres backups to Backblaze B2.
Runs nightly via GitHub Actions. Total cost: typically under $2/month
for a small school's data volume.

**What this covers:**
- Daily encrypted snapshots of the Supabase Postgres database.
- 24-hour RPO (worst case data loss: one day).
- Cross-vendor isolation: your data lives in Supabase, your backups live
  in Backblaze, the encryption key lives on your laptop. No single
  provider failure (or account suspension) takes both out.

**What this does NOT cover (yet):**
- Supabase Storage objects (homework attachments, profile pictures).
  Add a second workflow when you can.
- Sub-day recovery granularity. Bump the cron to every 6 hours if you
  want 6-hour RPO at 4× the storage cost (still pennies).
- Point-in-time recovery to the second. That needs Supabase PITR.

---

## One-time setup

The whole thing is about 90 minutes if you've never used B2 or age before.
You only have to do this once.

### 1. Generate an `age` keypair (the encryption key)

`age` is a small file-encryption tool — modern alternative to GPG.

**On Windows (PowerShell):**

```powershell
# Install via winget — also available via scoop, chocolatey, or
# direct download from https://github.com/FiloSottile/age/releases
winget install FiloSottile.age

# Generate a keypair. The whole file is your private key; the last line
# is the public key.
mkdir "$env:USERPROFILE\.config\school-backups" -Force
age-keygen -o "$env:USERPROFILE\.config\school-backups\key.txt"
```

Open `key.txt` in a text editor. You'll see something like:

```
# created: 2026-05-14T10:00:00Z
# public key: age1qx....abc
AGE-SECRET-KEY-1FOOBARBAZ...
```

- **The whole file is the private key.** Treat it like a password. Anyone
  with this file can decrypt your backups.
- **The line starting with `age1...`** (the `# public key:` line) is the
  public key. This is what GitHub Actions uses to encrypt; it's safe to
  share.

**Back up the private key** to at least one place that is not your laptop:
print it on paper and put it in a safe, copy it to a USB stick stored at
home, store it in a password manager's secure note. Without this file
your backups are unreadable.

### 2. Create a Backblaze B2 account + bucket

1. Sign up at https://www.backblaze.com/cloud-storage. The first 10 GB
   of storage and 1 GB/day of downloads are free, so for a small school
   you may pay nothing at first.

2. Once logged in: **Buckets → Create a Bucket**.
   - Name: something unique, e.g. `school-system-backups-<your-handle>`
     (bucket names are globally unique across B2).
   - Files: **Private**.
   - Default Encryption: **Disable** (we encrypt with age ourselves —
     server-side encryption is unnecessary and just adds a key B2 holds).
   - Object Lock: leave **Disabled** for now. (You can enable it later
     for a stronger "no one, including me, can delete a backup early"
     guarantee.)

3. **Lifecycle Settings** on the bucket: set "Keep prior versions for
   N days" rules. A reasonable defaults stack:
   - Keep all backups for 30 days.
   - Optionally: keep one per month for 365 days. (B2's UI calls this
     "Keep only the last version of the file" — set it to 30, then add
     a longer-retention rule for monthly snapshots if you want.)

4. Find your bucket's **S3-compatible endpoint**. On the bucket overview
   page, look for "Endpoint" — it'll look like:
   `s3.us-west-002.backblazeb2.com`. Note this for step 4.

### 3. Create a Backblaze application key

1. **App Keys** → **Add a New Application Key**.
2. Name: `school-system-github-actions` (or similar).
3. Access: **Allow access to bucket** → your new bucket only.
4. Capabilities: leave the defaults (read + write).
5. File name prefix: leave blank.
6. **Create New Key.**

**Save the keyID and applicationKey immediately** — Backblaze only shows
the applicationKey once. If you lose it you'll need to regenerate.

### 4. Add the secrets to GitHub

Go to your repo → **Settings → Secrets and variables → Actions → New
repository secret**. Add five secrets:

| Secret name              | Value                                                |
|--------------------------|------------------------------------------------------|
| `SUPABASE_DB_URL`        | Full Postgres connection string for your project. See note below. |
| `BACKUP_AGE_PUBLIC_KEY`  | The `age1...` public key from step 1.                |
| `B2_APPLICATION_KEY_ID`  | The keyID from step 3.                               |
| `B2_APPLICATION_KEY`     | The applicationKey from step 3.                      |
| `B2_BUCKET`              | Your bucket name (e.g. `school-system-backups-...`). |
| `B2_ENDPOINT`            | `https://s3.us-west-002.backblazeb2.com` (replace region as appropriate; include the `https://`). |

**Where to find `SUPABASE_DB_URL`:** Supabase dashboard → Project Settings
→ Database → "Connection string" → **URI** tab → **Mode: Session, Direct
connection** (not the pooler — pg_dump doesn't work over the pooler in
transaction mode). The form is:

```
postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres
```

### 5. Test it

In the GitHub repo → **Actions** tab → **Daily backup** → **Run workflow**.
It should complete in 1–3 minutes. Then go check Backblaze: a new file
should appear at `postgres/<year>/<month>/<day>/dump-<timestamp>.pg.age`
and at `postgres/latest.pg.age`.

If anything fails, the workflow logs will show what's wrong — usually a
missing or misspelled secret.

After the first successful run, GitHub Actions will start sending you an
email if the workflow ever fails on its next nightly run. That's your
backup health monitor for free.

---

## Restoring a backup

When you actually need to restore — schools are down, you're stressed,
this is not the moment to figure out how. Practise once now, while the
sky is blue.

### Prerequisites

Install the following on the machine you'll restore from:

- `pg_restore` from the Postgres client tools (bundled with the Postgres
  installer, or `winget install PostgreSQL.PostgreSQL`).
- `age` (already installed in step 1).
- AWS CLI v2 (`winget install Amazon.AWSCLI`).

Set these environment variables in your shell (PowerShell):

```powershell
$env:AWS_ACCESS_KEY_ID = '<B2_APPLICATION_KEY_ID>'
$env:AWS_SECRET_ACCESS_KEY = '<B2_APPLICATION_KEY>'
$env:B2_BUCKET = '<your-bucket-name>'
$env:B2_ENDPOINT = 'https://s3.us-west-002.backblazeb2.com'
```

### Dry run — verify a backup is intact

This downloads + decrypts a backup without touching any database. Run it
once a month so you know your private key still works and B2 still has
your data:

```powershell
.\scripts\restore.ps1 -Source latest -DryRun
```

You should see the dump file path printed at the end. Open it in
pg_restore's listing mode if you want to peek at what's inside:

```powershell
pg_restore --list <path printed above>
```

You should see a long list of tables — schools, students, fee_payments,
etc. That confirms the dump is real and decryptable.

### Real restore — into a fresh database

**Never restore directly into production unless you're absolutely sure.**
The safer pattern: restore into a new Supabase project (or local
Postgres), verify the data, then either swap the connection strings or
copy out only the rows you need.

```powershell
# Option A: restore into a fresh Supabase project
.\scripts\restore.ps1 `
  -Target "postgresql://postgres:<new-password>@db.<new-projref>.supabase.co:5432/postgres" `
  -Source latest

# Option B: restore locally for inspection
.\scripts\restore.ps1 `
  -Target "postgresql://postgres:postgres@localhost:5432/restored" `
  -Source latest
```

If you need to restore from a specific older backup, pass the full B2
key:

```powershell
.\scripts\restore.ps1 `
  -Target "postgresql://postgres:postgres@localhost:5432/restored" `
  -Source "postgres/2026/05/14/dump-20260514T010000Z.pg.age"
```

---

## Restore drill — do this every quarter

Schedule a recurring calendar event. The drill:

1. Run `.\scripts\restore.ps1 -Source latest -DryRun`.
2. Inspect the listed contents with `pg_restore --list`.
3. Spin up a free-tier Supabase project (or local Postgres).
4. Restore into it.
5. Verify row counts on a few critical tables:
   ```sql
   SELECT count(*) FROM students;
   SELECT count(*) FROM fee_payments;
   SELECT count(*) FROM archived_students;
   SELECT count(*) FROM audit_logs;
   ```
   Compare against the production counts. They should match.
6. Pick a random student. Walk through their related rows (parent,
   class, grades, attendance, fee_payments). Verify relations resolve.
7. **Time the whole thing.** That's your real RTO.
8. Delete the practice Supabase project.
9. Write down anything that surprised you in this file.

A backup you've never restored is theatre. The drill is what makes the
"yes, we have backups" answer a real one.

---

## Cost expectation

For a small school (say 500 students, 18 months of data):
- Dump size: typically 50–500 MB encrypted.
- Daily for 30 days: 1.5–15 GB.
- B2 storage: $0.006/GB/month → **~$0.01–$0.10/month**.

Even at 50 schools and several years of retention, you're looking at
maybe $2–10/month. The biggest cost is your attention — set it up once,
verify it monthly, drill quarterly.

---

## Future enhancements (when funding shows up)

- **Add Supabase Storage to the backup.** Second workflow that mirrors
  the `homework-attachments` bucket to B2. Same encryption pattern.
- **Sub-day RPO.** Change the cron from `'0 1 * * *'` (daily) to
  `'0 */6 * * *'` (every 6 hours). Storage cost 4×, still trivial.
- **Supabase PITR.** Solves the sub-second-recovery case. ~$100/mo
  add-on. Best to add this when the first school is recording real
  money you couldn't easily reconstruct.
- **Backup integrity alerts.** Separate workflow that runs every few
  days, lists the last 7 days of backups in B2, alerts if any are
  missing or zero-byte. Five minutes of YAML.
