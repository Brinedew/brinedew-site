$ErrorActionPreference = "Stop"

Write-Host "[deploy] Building Quartz site..."
python scripts/enrich-proteins.py
npm ci
node quartz/bootstrap-cli.mjs build -d content

Write-Host "[deploy] Publishing static site to Cloudflare Pages (brinedew-bio)..."
wrangler pages deploy public --project-name brinedew-bio --branch main

Write-Host "[deploy] Deploying primary Worker (geneguessr-api)..."
wrangler deploy

Write-Host "[deploy] Applying benchmark migrations (idempotent duplicate-column tolerated)..."
$migrationOutput = & wrangler d1 migrations apply geneguessr --remote --config workers/benchmark/wrangler.toml 2>&1
$migrationStatus = $LASTEXITCODE
$migrationText = ($migrationOutput | Out-String)
Write-Output $migrationText
if ($migrationStatus -ne 0 -and $migrationText -notmatch "(?i)duplicate column name: state") {
  throw "Benchmark migration failed with unexpected error."
}

Write-Host "[deploy] Deploying benchmark Worker..."
wrangler deploy --config workers/benchmark/wrangler.toml

Write-Host "[deploy] Running health check..."
$health = Invoke-RestMethod -Uri "https://geneguessr-bench.brinedew.bio/health" -Method GET
if (-not $health.ok) {
  throw "Benchmark health check failed."
}

Write-Host "[deploy] Completed successfully."
