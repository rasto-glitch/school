#requires -Version 5.1
<#
.SYNOPSIS
  Download a Postgres backup from Backblaze B2, decrypt it with age,
  and restore into a target database.

.DESCRIPTION
  Designed for the emergency case - your primary Supabase database is in
  a bad state and you need to recover. See BACKUP.md for context.

.PARAMETER Target
  Connection string for the database to restore INTO.
  Examples:
    "postgresql://postgres:<password>@db.<projref>.supabase.co:5432/postgres"
    "postgresql://postgres:postgres@localhost:5432/restored"

.PARAMETER Source
  B2 key of the dump file to restore. Use "latest" for the most recent
  nightly dump. Otherwise: "postgres/2026/05/14/dump-20260514T010000Z.pg.age"

.PARAMETER AgeKeyFile
  Path to your age private key file (default: ~/.config/school-backups/key.txt).
  This file MUST stay off git and off the production servers.

.PARAMETER DryRun
  Download + decrypt only; do not run pg_restore. Useful for verifying
  a backup is restorable without touching the target DB.

.EXAMPLE
  # Restore the latest backup into a fresh local Postgres instance
  .\scripts\restore.ps1 -Target "postgresql://postgres:postgres@localhost:5432/restored" -Source latest

.EXAMPLE
  # Verify a specific backup is readable, without restoring
  .\scripts\restore.ps1 -Source "postgres/2026/05/14/dump-20260514T010000Z.pg.age" -DryRun
#>

param(
  [Parameter(Mandatory = $false)]
  [string]$Target,

  [Parameter(Mandatory = $false)]
  [string]$Source = 'latest',

  [Parameter(Mandatory = $false)]
  [string]$AgeKeyFile = "$env:USERPROFILE\.config\school-backups\key.txt",

  [Parameter(Mandatory = $false)]
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

function Require-Cmd([string]$name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "Required command '$name' not found in PATH. Install it and re-run."
  }
}

Require-Cmd 'aws'   # AWS CLI v2 - talks to B2's S3-compatible API
Require-Cmd 'age'   # age CLI for decryption
if (-not $DryRun) {
  Require-Cmd 'pg_restore'
  if (-not $Target) { throw 'Target is required unless -DryRun is set.' }
}

# Required environment variables (load from a local .env or set directly).
$required = @(
  @{ Name = 'B2_APPLICATION_KEY_ID';     EnvName = 'AWS_ACCESS_KEY_ID' }
  @{ Name = 'B2_APPLICATION_KEY';        EnvName = 'AWS_SECRET_ACCESS_KEY' }
  @{ Name = 'B2_BUCKET';                 EnvName = 'B2_BUCKET' }
  @{ Name = 'B2_ENDPOINT';               EnvName = 'B2_ENDPOINT' }
)
foreach ($v in $required) {
  $val = [Environment]::GetEnvironmentVariable($v.EnvName)
  if (-not $val) {
    throw "Missing environment variable $($v.EnvName). See BACKUP.md."
  }
}

if (-not (Test-Path $AgeKeyFile)) {
  throw "age private key file not found at $AgeKeyFile. Use -AgeKeyFile to override."
}

# Resolve the source key. "latest" is the convenience pointer we maintain
# in the upload workflow; otherwise the caller passed an explicit path.
$sourceKey = if ($Source -eq 'latest') { 'postgres/latest.pg.age' } else { $Source }
$bucket    = $env:B2_BUCKET
$endpoint  = $env:B2_ENDPOINT

$work = Join-Path $env:TEMP "school-restore-$([Guid]::NewGuid().ToString('N').Substring(0,8))"
New-Item -ItemType Directory -Path $work -Force | Out-Null
$encrypted = Join-Path $work 'dump.pg.age'
$decrypted = Join-Path $work 'dump.pg'

try {
  Write-Host "==> Downloading s3://$bucket/$sourceKey from B2 ..."
  & aws --endpoint-url $endpoint s3 cp "s3://$bucket/$sourceKey" $encrypted
  if ($LASTEXITCODE -ne 0) { throw "B2 download failed (exit $LASTEXITCODE)" }

  $bytes = (Get-Item $encrypted).Length
  Write-Host "==> Downloaded $bytes bytes."

  Write-Host "==> Decrypting with age ..."
  & age --decrypt --identity $AgeKeyFile --output $decrypted $encrypted
  if ($LASTEXITCODE -ne 0) { throw "age decryption failed (exit $LASTEXITCODE)" }
  Write-Host "==> Decrypted to $decrypted."

  if ($DryRun) {
    Write-Host "==> Dry run - skipping pg_restore."
    Write-Host "==> Inspect the file at: $decrypted"
    return
  }

  Write-Host ''
  Write-Host "==> About to restore into: $Target"
  Write-Host "    This will REPLACE matching schemas/tables in the target."
  Write-Host "    Press Ctrl+C to abort, or wait 5 seconds to continue ..."
  Start-Sleep -Seconds 5

  Write-Host "==> Running pg_restore ..."
  & pg_restore `
      --dbname $Target `
      --no-owner `
      --no-acl `
      --clean `
      --if-exists `
      --verbose `
      $decrypted
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "pg_restore exited with $LASTEXITCODE - some objects may have failed to restore. Check the verbose output above."
  } else {
    Write-Host "==> Restore complete."
  }
} finally {
  if (Test-Path $work) {
    Remove-Item -Recurse -Force $work
    Write-Host "==> Cleaned up working directory."
  }
}
