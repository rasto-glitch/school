#requires -Version 5.1
<#
.SYNOPSIS
  Download a Supabase Storage bucket backup from Backblaze B2, decrypt it
  with age, optionally inspect the contents, and re-upload to Supabase
  Storage. Companion to restore.ps1 - that script handles the Postgres
  dumps; this script handles the bucket tarballs.

.DESCRIPTION
  Bundles the manual steps from BACKUP.md's "Restoring a Supabase Storage
  bucket" section into one command. Keep your age private key on this
  machine - it never goes near the master portal or any server.

  Typical drill (no upload, just verify):
    .\scripts\restore-storage.ps1 -Bucket homework-attachments -DryRun

  Typical recovery (re-upload to a separate bucket so the live one is
  safe; you swap buckets manually after verifying):
    .\scripts\restore-storage.ps1 -Bucket homework-attachments `
      -TargetBucket homework-attachments-restored

.PARAMETER Bucket
  The Supabase Storage bucket whose backup you want to restore. Must
  match the prefix used by backup-storage-daily.yml in B2:
  homework-attachments, employee-documents, operator-mail, chat-files.

.PARAMETER Source
  B2 key (relative to the bucket root) of the tarball to restore.
  Use "latest" for the newest nightly tarball for the chosen Bucket.
  Otherwise pass the full path, e.g.:
    "storage/homework-attachments/2026/05/14/homework-attachments-20260514T013000Z.tar.age"

.PARAMETER TargetBucket
  Supabase Storage bucket to re-upload the decrypted contents INTO.
  Defaults to the same name as Bucket. A separate target is the safe
  default for production - restore into a new bucket, eyeball the
  contents, then swap.

.PARAMETER AgeKeyFile
  Path to your age private key file (default: ~/.config/school-backups/key.txt).
  This file MUST stay off git and off the production servers.

.PARAMETER DryRun
  Download + decrypt + list the tarball contents only. Skips the
  re-upload to Supabase. Use this for the quarterly drill.

.PARAMETER Keep
  Do not delete the temporary working directory at the end. Use this
  when you want to inspect individual files (e.g. open a PDF to confirm
  it is intact). Without this flag the directory is wiped to avoid
  leaving plaintext school data on disk.

.EXAMPLE
  # Quarterly drill - verify the latest homework-attachments backup is
  # decryptable + lists the right files. No upload.
  .\scripts\restore-storage.ps1 -Bucket homework-attachments -DryRun

.EXAMPLE
  # Real recovery into a fresh bucket so the live one stays untouched.
  .\scripts\restore-storage.ps1 -Bucket employee-documents `
    -TargetBucket employee-documents-restored

.EXAMPLE
  # Recover from a specific older backup
  .\scripts\restore-storage.ps1 -Bucket chat-files `
    -Source "storage/chat-files/2026/05/14/chat-files-20260514T013000Z.tar.age" `
    -TargetBucket chat-files-restored
#>

param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('homework-attachments','employee-documents','operator-mail','chat-files')]
  [string]$Bucket,

  [Parameter(Mandatory = $false)]
  [string]$Source = 'latest',

  [Parameter(Mandatory = $false)]
  [string]$TargetBucket,

  [Parameter(Mandatory = $false)]
  [string]$AgeKeyFile = "$env:USERPROFILE\.config\school-backups\key.txt",

  [Parameter(Mandatory = $false)]
  [switch]$DryRun,

  [Parameter(Mandatory = $false)]
  [switch]$Keep
)

$ErrorActionPreference = 'Stop'

function Require-Cmd([string]$name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "Required command '$name' not found in PATH. Install it and re-run."
  }
}

Require-Cmd 'aws'   # S3 API - same binary talks to B2 (download) and Supabase (re-upload)
Require-Cmd 'age'   # decryption
Require-Cmd 'tar'   # bundled with Windows 10/11; otherwise install via winget

# B2 env vars are always required (download).
$b2Vars = @('B2_APPLICATION_KEY_ID','B2_APPLICATION_KEY','B2_BUCKET','B2_ENDPOINT')
foreach ($name in $b2Vars) {
  if (-not [Environment]::GetEnvironmentVariable($name)) {
    throw "Missing environment variable $name. See BACKUP.md."
  }
}

# Supabase env vars are only required for the upload step.
if (-not $DryRun) {
  $supabaseVars = @('SUPABASE_S3_ACCESS_KEY_ID','SUPABASE_S3_SECRET_ACCESS_KEY','SUPABASE_S3_ENDPOINT','SUPABASE_S3_REGION')
  foreach ($name in $supabaseVars) {
    if (-not [Environment]::GetEnvironmentVariable($name)) {
      throw "Missing environment variable $name (needed for upload). Use -DryRun to skip the upload step, or see BACKUP.md."
    }
  }
}

if (-not (Test-Path $AgeKeyFile)) {
  throw "age private key file not found at $AgeKeyFile. Use -AgeKeyFile to override."
}

if (-not $TargetBucket) { $TargetBucket = $Bucket }

# Resolve the source key. "latest" is the convenience pointer the upload
# workflow writes under each bucket's prefix.
$sourceKey = if ($Source -eq 'latest') {
  "storage/$Bucket/latest.tar.age"
} else {
  $Source
}

$work       = Join-Path $env:TEMP "school-storage-restore-$([Guid]::NewGuid().ToString('N').Substring(0,8))"
$encrypted  = Join-Path $work 'archive.tar.age'
$tarball    = Join-Path $work 'archive.tar'
$extractDir = Join-Path $work 'extracted'
New-Item -ItemType Directory -Path $work       -Force | Out-Null
New-Item -ItemType Directory -Path $extractDir -Force | Out-Null

# Helper: run aws s3 against either B2 or Supabase by swapping env vars
# for the duration of the call. AWS CLI doesn't honour --profile when env
# vars are set, so per-call overrides are the simplest reliable pattern.
# Caller passes the endpoint URL + which credential pair to use.
function Invoke-AwsS3 {
  param(
    [Parameter(Mandatory)] [ValidateSet('B2','Supabase')] [string]$Provider,
    [Parameter(Mandatory, ValueFromRemainingArguments)] [string[]]$Args
  )
  $prevKeyId  = $env:AWS_ACCESS_KEY_ID
  $prevSecret = $env:AWS_SECRET_ACCESS_KEY
  $prevRegion = $env:AWS_DEFAULT_REGION
  try {
    if ($Provider -eq 'B2') {
      $env:AWS_ACCESS_KEY_ID     = $env:B2_APPLICATION_KEY_ID
      $env:AWS_SECRET_ACCESS_KEY = $env:B2_APPLICATION_KEY
      $env:AWS_DEFAULT_REGION    = $null
      $endpoint = $env:B2_ENDPOINT
    } else {
      $env:AWS_ACCESS_KEY_ID     = $env:SUPABASE_S3_ACCESS_KEY_ID
      $env:AWS_SECRET_ACCESS_KEY = $env:SUPABASE_S3_SECRET_ACCESS_KEY
      $env:AWS_DEFAULT_REGION    = $env:SUPABASE_S3_REGION
      $endpoint = $env:SUPABASE_S3_ENDPOINT
    }
    & aws --endpoint-url $endpoint s3 @Args
  } finally {
    $env:AWS_ACCESS_KEY_ID     = $prevKeyId
    $env:AWS_SECRET_ACCESS_KEY = $prevSecret
    $env:AWS_DEFAULT_REGION    = $prevRegion
  }
}

try {
  # ── 1. Download from B2 ───────────────────────────────────────────────
  Write-Host "==> Downloading s3://$env:B2_BUCKET/$sourceKey from B2 ..."
  Invoke-AwsS3 B2 cp "s3://$env:B2_BUCKET/$sourceKey" $encrypted
  if ($LASTEXITCODE -ne 0) { throw "B2 download failed (exit $LASTEXITCODE)" }
  $bytes = (Get-Item $encrypted).Length
  Write-Host "==> Downloaded $bytes bytes."

  # ── 2. Decrypt ────────────────────────────────────────────────────────
  Write-Host "==> Decrypting with age ..."
  & age --decrypt --identity $AgeKeyFile --output $tarball $encrypted
  if ($LASTEXITCODE -ne 0) { throw "age decryption failed (exit $LASTEXITCODE)" }
  Write-Host "==> Decrypted to $tarball."

  # ── 3. List contents ──────────────────────────────────────────────────
  Write-Host "==> Tarball contents (first 30 entries):"
  $entries = & tar -tf $tarball
  if ($LASTEXITCODE -ne 0) { throw "tar listing failed (exit $LASTEXITCODE)" }
  $entries | Select-Object -First 30 | ForEach-Object { Write-Host "    $_" }
  $total = ($entries | Measure-Object).Count
  Write-Host "    ... ($total total entries)"

  if ($DryRun) {
    Write-Host ''
    Write-Host "==> Dry run - skipping upload."
    if ($Keep) {
      Write-Host "==> Extracting to $extractDir for inspection ..."
      & tar -xf $tarball -C $extractDir
      Write-Host "==> Working directory kept at: $work"
      Write-Host "    Extracted contents: $extractDir"
      Write-Host "    Delete it manually when done:"
      Write-Host "      Remove-Item -Recurse -Force `"$work`""
    } else {
      Write-Host "==> Decryption + listing succeeded. Re-run with -Keep to extract for inspection."
    }
    return
  }

  # ── 4. Extract ────────────────────────────────────────────────────────
  Write-Host "==> Extracting to $extractDir ..."
  & tar -xf $tarball -C $extractDir
  if ($LASTEXITCODE -ne 0) { throw "tar extract failed (exit $LASTEXITCODE)" }

  # The tarball was built with `tar -C /tmp/storage-buckets <bucket>` so
  # the top-level directory inside it is the bucket name. Locate it
  # rather than assume - lets a hand-built tarball restore too.
  $srcBucketDir = Join-Path $extractDir $Bucket
  if (-not (Test-Path $srcBucketDir)) {
    $tops = Get-ChildItem $extractDir -Directory
    if ($tops.Count -ne 1) {
      throw "Could not locate bucket directory inside tarball. Expected '$Bucket' at the top level."
    }
    $srcBucketDir = $tops[0].FullName
    Write-Host "==> Note: tarball top-level is '$($tops[0].Name)', not '$Bucket'. Using it anyway."
  }

  # ── 5. Confirm before upload ──────────────────────────────────────────
  $fileCount = (Get-ChildItem $srcBucketDir -Recurse -File | Measure-Object).Count
  Write-Host ''
  Write-Host "==> About to upload $fileCount files to:"
  Write-Host "    s3://$TargetBucket/   (via Supabase S3 endpoint)"
  if ($Bucket -eq $TargetBucket) {
    Write-Warning "Target bucket equals source bucket - existing files at the same paths will be OVERWRITTEN."
  }
  Write-Host "    Press Ctrl+C to abort, or wait 5 seconds to continue ..."
  Start-Sleep -Seconds 5

  # ── 6. Upload to Supabase Storage ─────────────────────────────────────
  Write-Host "==> Syncing $srcBucketDir/ -> s3://$TargetBucket/ via Supabase ..."
  Invoke-AwsS3 Supabase sync $srcBucketDir "s3://$TargetBucket/"
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "aws s3 sync exited with $LASTEXITCODE - some files may not have uploaded. Re-run and watch the output."
  } else {
    Write-Host "==> Upload complete: $fileCount files in s3://$TargetBucket/"
  }
} finally {
  if (Test-Path $work) {
    if ($Keep) {
      Write-Host "==> Working directory kept at: $work"
      Write-Host "    Contains decrypted plaintext - delete it when you are done:"
      Write-Host "      Remove-Item -Recurse -Force `"$work`""
    } else {
      Remove-Item -Recurse -Force $work
      Write-Host "==> Cleaned up working directory."
    }
  }
}
