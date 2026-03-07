$ErrorActionPreference = "Stop"

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "[deploy] Missing required command: $Name"
  }
}

Require-Command "git"
Require-Command "gh"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

# This script intentionally does not call `wrangler pages deploy` or `wrangler deploy`
# directly anymore. Production deploys must go through the single GitHub Actions path so
# local machine auth, local config drift, and partial deploys cannot create split-brain.
$branch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne "main") {
  throw "[deploy] Production workflow dispatch is only supported from main. Current branch: $branch"
}

$status = git status --porcelain
if ($LASTEXITCODE -ne 0) {
  throw "[deploy] Could not read git status."
}
if ($status) {
  throw "[deploy] Working tree is dirty. Commit or stash changes before deploying."
}

# Deploy the exact commit that is already on origin/main. This keeps the release source
# explicit and avoids the old failure mode where a local-only state or a failed push and
# a production deploy could drift apart.
git fetch origin main --quiet
if ($LASTEXITCODE -ne 0) {
  throw "[deploy] Failed to fetch origin/main."
}

$headSha = (git rev-parse HEAD).Trim()
$originSha = (git rev-parse origin/main).Trim()
if ($headSha -ne $originSha) {
  throw "[deploy] HEAD is not origin/main. Push main first so the deploy source is explicit."
}

Write-Host "[deploy] Canonical production deploy path: GitHub Actions only."
Write-Host "[deploy] Dispatching Deploy Production (Cloudflare Pages + Worker) for origin/main..."

$dispatchTime = Get-Date
gh workflow run ".github/workflows/deploy-quartz.yml" --ref main
if ($LASTEXITCODE -ne 0) {
  throw "[deploy] Failed to dispatch production workflow."
}

# `gh workflow run` does not return the new run id, so resolve it by looking for the
# newest workflow_dispatch run for the exact pushed SHA after this dispatch time.
$deadline = (Get-Date).AddMinutes(2)
$run = $null
while ((Get-Date) -lt $deadline -and -not $run) {
  $runsJson = gh run list --workflow ".github/workflows/deploy-quartz.yml" --limit 10 --json databaseId,createdAt,url,status,conclusion,headSha,event
  if ($LASTEXITCODE -ne 0) {
    throw "[deploy] Failed to list workflow runs."
  }

  $runs = $runsJson | ConvertFrom-Json
  $run = $runs |
    Where-Object {
      $_.event -eq "workflow_dispatch" -and
      $_.headSha -eq $originSha -and
      [DateTime]::Parse($_.createdAt) -ge $dispatchTime.AddSeconds(-10)
    } |
    Sort-Object createdAt -Descending |
    Select-Object -First 1

  if (-not $run) {
    Start-Sleep -Seconds 3
  }
}

if (-not $run) {
  throw "[deploy] Could not find the dispatched production workflow run."
}

Write-Host "[deploy] Watching workflow run $($run.databaseId): $($run.url)"
gh run watch $run.databaseId --exit-status
if ($LASTEXITCODE -ne 0) {
  throw "[deploy] Production workflow failed."
}

Write-Host "[deploy] Production workflow succeeded."
