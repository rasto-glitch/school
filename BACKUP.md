# Backup & restore

Off-site, end-to-end encrypted Postgres backups to Backblaze B2.
Runs nightly via GitHub Actions. Total cost: typically under $2/month
for a small school's data volume.

**What this covers:**
- Daily encrypted snapshots of the Supabase Postgres database
  (`backup-daily.yml`).
- Daily encrypted snapshots of Supabase Storage buckets — homework
  attachments, profile pictures, employee documents, archive backup
  JSONs, chat attachments (`backup-storage-daily.yml`).
- 24-hour RPO (worst case data loss: one day).
- Cross-vendor isolation: your data lives in Supabase, your backups live
  in Backblaze, the encryption key lives on your laptop. No single
  provider failure (or account suspension) takes both out.

**What this does NOT cover (yet):**
- Sub-day recovery granularity. Bump the cron to every 6 hours if you
  want 6-hour RPO at 4× the storage cost (still pennies).
- Point-in-time recovery to the second. That needs Supabase PITR.

## How the pieces fit together

```
+-------------+       nightly @ 01:00 UTC      +------------------+
| Supabase    | <----- pg_dump (over -------+  | GitHub Actions   |
| Postgres    |        Session pooler)      |  | (Ubuntu runner)  |
+-------------+                             +--+ - dumps DB       |
                                               | - encrypts (age) |
                                               | - uploads to B2  |
                                               +------------------+
                                                        |
                                                        v
                                            +-----------------------+
                                            | Backblaze B2 bucket   |
                                            |  postgres/<Y>/<M>/<D>/|
                                            |  postgres/latest.pg.age|
                                            +-----------------------+
                                                        |
                       when you need a restore...       |
                                                        v
+----------------------+        restore.ps1     +---------------+
| Your machine         | <-------- (downloads ---+ Decrypts with |
| - age private key    |          + decrypts +   | age private   |
| - aws-cli, age,      |          + restores)    | key on disk   |
|   pg_restore         |                         +---------------+
+----------------------+
```

**Secrets that make this work:**
- `BACKUP_AGE_PUBLIC_KEY` (GitHub Secret) — the recipient both workflows
  encrypt to. Safe to share.
- Private half of the age keypair (your laptop, plus offline backup) —
  the only thing that can decrypt anything. Lose it, all backups
  are unreadable noise.
- `SUPABASE_DB_URL` (GitHub Secret) — Session pooler URL for `pg_dump`,
  NOT Direct.
- `SUPABASE_S3_ACCESS_KEY_ID` + `SUPABASE_S3_SECRET_ACCESS_KEY` (GitHub
  Secrets) — separate credentials for the Storage S3 endpoint, generated
  in Supabase Dashboard → Storage → S3 Connection. NOT the project API
  keys.
- `SUPABASE_S3_ENDPOINT` + `SUPABASE_S3_REGION` (GitHub Secrets) — the
  S3-compatible URL Supabase gives you and the region of your project.
- `B2_APPLICATION_KEY_ID` + `B2_APPLICATION_KEY` (GitHub Secrets) —
  scoped to one bucket; rotate via Backblaze dashboard if leaked.

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

# Generate a keypair. Use the -o flag — NOT a > redirect. PowerShell's
# default output redirection writes UTF-16 with a BOM, which age cannot
# parse on read. Always use age-keygen -o ...
mkdir "$env:USERPROFILE\.config\school-backups" -Force
age-keygen -o "$env:USERPROFILE\.config\school-backups\key.txt"
```

The file will look like this (exactly three lines):

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

**Do not open `key.txt` in a text editor unless you're only reading it.**
A misclicked "Save" with another buffer's contents will overwrite the
real key with garbage and you'll only find out when the next restore
fails to decrypt. Every consumer of the file (`restore.ps1`, `age -d`)
reads it directly — you should never need to manually edit it.

**Back up the private key** to at least one place that is not your laptop:
print it on paper and put it in a safe, copy it to a USB stick stored at
home, store it in a password manager's secure note. Without this file
your backups are unreadable.

**Verify the file shape any time** with:

```powershell
$ln = 0
Get-Content "$env:USERPROFILE\.config\school-backups\key.txt" | ForEach-Object {
  $ln++
  if     ($_ -match '^AGE-SECRET-KEY-') { "Line ${ln}: AGE-SECRET-KEY (good)" }
  elseif ($_ -match '^# public key:')   { "Line ${ln}: # public key (good)" }
  else                                  { "Line ${ln}: UNEXPECTED" }
}
```

You should see exactly two lines marked `good`. Anything else means the
file is corrupted and decryption will fail.

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

### 4. Generate Supabase Storage S3 credentials

The storage backup workflow uses Supabase's S3-compatible Storage endpoint
to mirror buckets. **This is different from the project API keys.**

1. In the Supabase Dashboard, go to **Storage → S3 Connection** (sidebar
   under Configuration). On older dashboards it's at **Settings → Storage**.
2. Click **New access key** (or **Generate**).
3. Save the **Access key ID** and **Secret access key** immediately —
   Supabase only shows the secret once.
4. Note the **Endpoint URL** (looks like
   `https://<project-ref>.supabase.co/storage/v1/s3`) and the project
   region (e.g. `us-east-1`, `eu-central-1` — shown on the same page).

These credentials are scoped to your Storage buckets only; they can't
read or write database rows. Treat them like the postgres URL — anyone
with them can read every file in every bucket.

### 5. Add the secrets to GitHub

Go to your repo → **Settings → Secrets and variables → Actions → New
repository secret**. Add nine secrets:

| Secret name                       | Value                                                |
|-----------------------------------|------------------------------------------------------|
| `SUPABASE_DB_URL`                 | Full Postgres connection string for your project. See note below. |
| `SUPABASE_S3_ACCESS_KEY_ID`       | Access key ID from step 4.                          |
| `SUPABASE_S3_SECRET_ACCESS_KEY`   | Secret access key from step 4.                      |
| `SUPABASE_S3_ENDPOINT`            | The full S3 URL from step 4 (include `https://`).   |
| `SUPABASE_S3_REGION`              | Your project region (e.g. `us-east-1`).             |
| `BACKUP_AGE_PUBLIC_KEY`           | The `age1...` public key from step 1.               |
| `B2_APPLICATION_KEY_ID`           | The keyID from step 3.                              |
| `B2_APPLICATION_KEY`              | The applicationKey from step 3.                     |
| `B2_BUCKET`                       | Your bucket name (e.g. `school-system-backups-...`).|
| `B2_ENDPOINT`                     | `https://s3.us-west-002.backblazeb2.com` (replace region as appropriate; include the `https://`). |

**Where to find `SUPABASE_DB_URL`:** click the green **Connect** button in
the Supabase dashboard. The panel has tabs for different connection types
— pick **Session pooler** (NOT Direct, NOT Transaction pooler):

- **Direct connection** uses IPv6 by default. GitHub Actions runners are
  IPv4-only. This URL will look right but every workflow run will fail
  with "Network is unreachable". Avoid unless you've paid for the IPv4
  add-on.
- **Transaction pooler** (port 6543) doesn't support `pg_dump`.
- **Session pooler** (port 5432, IPv4 by default) is the right one — works
  with `pg_dump` AND reachable from GitHub.

The Session pooler URL looks like:

```
postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

Note the dot in `postgres.<project-ref>` — that's the distinguishing
mark of the pooler URL. Direct connections use just `postgres` as the
username.

**Test the URL before pasting it into GitHub Secrets** so a typo doesn't
cause a 3-minute workflow round-trip:

```powershell
psql "<paste full URL here>" -c "SELECT 1"
```

If you get back `1`, the URL is good. If it errors, fix the URL first
(usually a forgotten password replacement or wrong region).

### 6. Test it

In the GitHub repo → **Actions** tab, run each workflow once by hand:

1. **Daily backup → Run workflow.** Should complete in 1–3 minutes.
   Check Backblaze: a new file appears at
   `postgres/<year>/<month>/<day>/dump-<timestamp>.pg.age` and at
   `postgres/latest.pg.age`.
2. **Daily storage backup → Run workflow.** Takes longer (1–10 min
   depending on how much is in your buckets). Check Backblaze:
   `storage/<bucket>/<year>/<month>/<day>/<bucket>-<timestamp>.tar.age`
   for each non-empty bucket, plus a `latest.tar.age` per bucket.

If anything fails, the workflow logs show what's wrong — usually a
missing or misspelled secret.

After the first successful run, GitHub Actions will start sending you an
email if either workflow ever fails on its next nightly run. That's
your backup health monitor for free.

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

### Browsing what's in B2

The workflow uploads to two paths every night:

- `postgres/YYYY/MM/DD/dump-YYYYMMDDTHHMMSSZ.pg.age` — the dated copy,
  one per run, age-encrypted Postgres custom-format dump.
- `postgres/latest.pg.age` — a pointer that always equals the most
  recent dated copy. `restore.ps1 -Source latest` grabs this one.

List what's there:

```powershell
# Everything at the top level
aws --endpoint-url $env:B2_ENDPOINT s3 ls s3://$env:B2_BUCKET/postgres/

# A specific day
aws --endpoint-url $env:B2_ENDPOINT s3 ls s3://$env:B2_BUCKET/postgres/2026/05/14/
```

`PRE 2026/` in the output is AWS CLI's way of saying "this is a folder
(prefix)". File entries show their size in bytes — anything around 50KB
or larger is a healthy backup for a small school's data; truly tiny
files (under 1KB) usually mean the dump errored partway and only the
PDF header made it.

### Dry run — verify a backup is intact

This downloads + decrypts a backup without touching any database. Run it
once a month so you know your private key still works and B2 still has
your data:

```powershell
.\scripts\restore.ps1 -Source latest -DryRun
```

Success looks like:

```
==> Downloaded 574698 bytes.
==> Decrypted to C:\Users\...\Temp\school-restore-xxxxxxxx\dump.pg
==> Dry run - skipping pg_restore.
==> Decryption succeeded. Re-run with -Keep to preserve the .pg file for inspection.
==> Cleaned up working directory.
```

The default cleans up the decrypted file immediately — the dump is
plaintext data and shouldn't linger on disk. For a routine health check
this is enough; if it ran without errors, the file decrypted cleanly.

### Inspecting the dump contents

When you want to actually look inside (e.g. before a real restore, or
when curious), pass `-Keep` so the temp directory survives:

```powershell
.\scripts\restore.ps1 -Source latest -DryRun -Keep
```

The script prints the working directory path at the end:

```
==> Working directory kept at: C:\Users\...\Temp\school-restore-xxxxxxxx
```

Inside that directory you'll find `dump.pg` — a Postgres custom-format
binary archive. Not directly readable as text. List its contents with
`pg_restore`:

```powershell
pg_restore --list "C:\Users\...\Temp\school-restore-xxxxxxxx\dump.pg"
```

You'll see a table of contents — every schema, table, sequence, function,
index, FK constraint. Looks like:

```
1; 3079 16389 EXTENSION - uuid-ossp
123; 1259 16554 TABLE public schools postgres
124; 1259 16567 TABLE public students postgres
125; 1259 16580 TABLE public fee_payments postgres
...
```

If your real tables show up in that listing — schools, students,
fee_payments, archived_students, etc. — the dump is valid and complete.
That's the deepest verification short of a full restore.

**When you're done inspecting, delete the working directory** (it
contains a plaintext copy of your database):

```powershell
Remove-Item -Recurse -Force "C:\Users\...\Temp\school-restore-xxxxxxxx"
```

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

### Restoring a Supabase Storage bucket

Storage backups live under `storage/<bucket>/...` and are tarballs
encrypted with the same age key. To restore one:

```powershell
# 1. Download the encrypted tarball from B2.
aws --endpoint-url $env:B2_ENDPOINT s3 cp `
  "s3://$env:B2_BUCKET/storage/homework-attachments/latest.tar.age" `
  homework-attachments.tar.age

# 2. Decrypt with your age private key.
age --decrypt `
  --identity "$env:USERPROFILE\.config\school-backups\key.txt" `
  --output homework-attachments.tar `
  homework-attachments.tar.age

# 3. List what's inside to confirm.
tar -tf homework-attachments.tar | head -20

# 4. Extract into a working directory.
mkdir restored-buckets
tar -xf homework-attachments.tar -C restored-buckets

# 5. Re-upload to Supabase Storage. Use the same Supabase S3 credentials
#    as the backup workflow uses (NOT the postgres URL).
$env:AWS_ACCESS_KEY_ID = '<SUPABASE_S3_ACCESS_KEY_ID>'
$env:AWS_SECRET_ACCESS_KEY = '<SUPABASE_S3_SECRET_ACCESS_KEY>'
$env:AWS_DEFAULT_REGION = '<SUPABASE_S3_REGION>'
aws --endpoint-url '<SUPABASE_S3_ENDPOINT>' s3 sync `
  restored-buckets/homework-attachments/ `
  s3://homework-attachments/
```

For a real recovery (not a drill), restore into a brand-new bucket
first, inspect it, then swap the buckets. **Never overwrite the live
bucket** with a restored copy until you've verified the contents — a
restore that's missing files is silently worse than the bucket you
have today.

For older snapshots, pass a dated path instead of `latest.tar.age`:

```powershell
aws --endpoint-url $env:B2_ENDPOINT s3 cp `
  "s3://$env:B2_BUCKET/storage/homework-attachments/2026/05/14/homework-attachments-20260514T013000Z.tar.age" `
  homework-attachments.tar.age
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

## Troubleshooting — issues we've actually hit

Real failure modes from the initial setup, with what they look like and
how to fix.

### `pg_dump: server version mismatch`

```
pg_dump: error: aborting because of server version mismatch
pg_dump: detail: server version: 17.6; pg_dump version: 16.13
```

Supabase upgraded their managed Postgres major version. The workflow's
client major must be at least as new as the server. Edit
`.github/workflows/backup-daily.yml`, find the `postgresql-client-NN`
line, bump `NN` to match the server major Supabase reports. Same with
the `/usr/lib/postgresql/NN/bin/pg_dump` path further down.

### `Network is unreachable` against the database

```
pg_dump: error: connection to server at "db.xxxxx.supabase.co"
  (2a05:d014:...), port 5432 failed: Network is unreachable
```

The IPv6 address in the error tells you everything — you copied the
**Direct connection** URL from Supabase, which is IPv6-only on Free tier.
GitHub Actions runners are IPv4-only. Switch the `SUPABASE_DB_URL` secret
to the **Session pooler** URL (see step 4 above). Distinguishing marks:
the username is `postgres.<projref>` (with a dot), the host contains
`pooler.supabase.com`, port is `5432`.

### `pg_dump: error: connection to server on socket ...`

```
pg_dump: error: connection to server on socket "/var/run/postgresql/..."
  failed: No such file or directory
```

`pg_dump` got an empty or malformed URL and fell back to trying a local
socket. The `SUPABASE_DB_URL` secret is either empty, doesn't start with
`postgresql://`, or still has `[YOUR-PASSWORD]` as a placeholder. Fix
the secret value and re-run.

### `age: error: ... unknown identity type`

```
age: error: reading "...key.txt": failed to read ...: error at line N:
  unknown identity type
```

The `key.txt` file is malformed — either the wrong content was saved to
it (a common one: overwriting the real key with documentation or chat
output when "Save"-ing in an editor that had another buffer in front),
or PowerShell's `>` redirect added a UTF-16 BOM that age can't parse.

Diagnose with the verifier from step 1 above. If the file isn't exactly
two `good` lines, restore it from your offline backup (USB stick, paper
copy, password manager). If no offline copy exists, regenerate with
`age-keygen -o ...`, update `BACKUP_AGE_PUBLIC_KEY` in GitHub Secrets,
re-run the workflow — but any backups encrypted with the OLD public key
are now unreadable, so the dated copies in B2 prior to this point are
dead weight.

### `date: invalid date '20260514T...'` in the workflow

GNU `date` doesn't accept the compact ISO 8601 format. If you change
the timestamp format anywhere in the workflow, do not try to re-parse
it with `date -d`. Slice the fixed-width string directly with bash
parameter expansion: `${STAMP:0:4}/${STAMP:4:2}/${STAMP:6:2}`.

### Script output gets garbled after the dry-run message

If you ever edit `restore.ps1` and add em-dashes, smart quotes, or other
non-ASCII characters in messages or comments, PowerShell 5.1 (Windows
default) reads the file as Windows-1252, mangles the multi-byte UTF-8
sequences, and produces confusing output. **Keep the script pure ASCII**
— stick to plain `-` for dashes, plain `"` for quotes. Any text editor
showing non-ASCII characters in the file is a smell.

### Workflow stays failing even after I fixed the secret

Workflow definitions are pulled from the branch's HEAD at trigger time.
If you re-ran a previous failed run via the "Re-run jobs" button, it
uses the same workflow YAML it had originally — but secrets are
re-evaluated. Use `gh workflow run "Daily backup"` to trigger a fresh
run from current main, which is safer.

---

## Future enhancements (when funding shows up)

- **Sub-day RPO.** Change the cron from `'0 1 * * *'` (daily) to
  `'0 */6 * * *'` (every 6 hours). Storage cost 4×, still trivial.
- **Supabase PITR.** Solves the sub-second-recovery case. ~$100/mo
  add-on. Best to add this when the first school is recording real
  money you couldn't easily reconstruct.
- **Backup integrity alerts.** Separate workflow that runs every few
  days, lists the last 7 days of backups in B2, alerts if any are
  missing or zero-byte. Five minutes of YAML.
