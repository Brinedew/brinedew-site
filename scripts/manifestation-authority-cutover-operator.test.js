import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const scriptUrl = new URL("./Invoke-ManifestationAuthorityCutover.ps1", import.meta.url)
const shardScriptUrl = new URL("./Invoke-ManifestationAuthorityCutoverShards.ps1", import.meta.url)
const requestBudgetUrl = new URL("./lib/CloudflareWorkerRequestBudget.ps1", import.meta.url)

async function source() {
  return readFile(scriptUrl, "utf8")
}

async function shardSource() {
  return readFile(shardScriptUrl, "utf8")
}

async function requestBudgetSource() {
  return readFile(requestBudgetUrl, "utf8")
}

test("cutover operator uses only the dedicated User-scope cutover credential", async () => {
  const text = await source()
  assert.match(text, /GetEnvironmentVariable\('ICONOPLASM_AUTHORITY_CUTOVER_TOKEN', 'User'\)/)
  assert.doesNotMatch(
    text,
    /ADMIN_(?:TOKEN|PASSWORD)|ICONOPLASM_AUTHORITY_(?:SERVICE|REPLICA|GENERATION|MAINTENANCE|BACKUP)_TOKEN/,
  )
  assert.doesNotMatch(text, /Write-(?:Output|Host|Information)[^\n]*cutoverToken/i)
})

test("cutover operator stays inside the service route and pins destructive confirmations", async () => {
  const text = await source()
  assert.match(text, /\/api\/iconoplasm\/authority\/cutover\/runs\//)
  assert.doesNotMatch(text, /\/api\/iconoplasm\/admin\//)
  assert.match(text, /activate_verified_authority/)
  assert.match(text, /retire_verified_legacy_plaintext/)
  assert.match(text, /BeginRetirement/)
  assert.match(text, /retirement\.status -ne 'running'.*backup\.status -ne 'retention_pending'/s)
})

test("cutover operator is resumable and bounds request, run, retry, and progress behavior", async () => {
  const text = await source()
  assert.match(text, /cutover-state-\$authorityHost\.json/)
  assert.match(text, /HttpClient\]\:\:new/)
  assert.match(text, /RequestTimeoutSeconds/)
  assert.match(text, /\[ValidateRange\(30, 300\)\]/)
  assert.match(text, /\[int\] \$RequestTimeoutSeconds = 240/)
  assert.match(text, /OverallTimeoutMinutes/)
  assert.match(text, /MaximumStalledIterations/)
  assert.match(text, /iteration % 50/)
  assert.match(text, /Write-Information \(\$progress \| ConvertTo-Json -Compress\)/)
  assert.match(text, /X-Iconoplasm-Cutover-Action', 'materialize'/)
  assert.doesNotMatch(text, /Write-Output \(\$progress \| ConvertTo-Json -Compress\)/)
  assert.match(
    text,
    /'verified', 'retention_pending', 'held', 'deleting', 'delete_failed', 'deleted'/,
  )
  assert.match(text, /FileShare\]::None/)
  assert.match(text, /archive_and_replace_cutover_identity/)
  assert.match(text, /\.reset-\$archiveTimestamp\.json/)
  assert.match(text, /NewGuid\(\)\.ToString\('N'\).*\.tmp/)
  assert.match(text, /Move-Item -LiteralPath \$temporaryPath -Destination \$Path -Force/)
  assert.match(text, /\[ValidateRange\(1, 2500\)\]/)
  assert.match(text, /\[int\] \$DailyWorkerRequestBudget = 2500/)
  assert.match(text, /Reserve-CloudflareWorkerRequests[\s\S]*\$client\.SendAsync/)
  assert.match(
    text,
    /Assert-CloudflareWorkerRequestHeadroom[\s\S]*Reserve-CloudflareWorkerRequests/,
  )
  assert.match(text, /workerRequestsSinceTelemetryCheck -ge 100/)
  assert.doesNotMatch(text, /WorkerRequestBudgetStatePath/)
})

test("sharded operator accepts omitted and singleton shard selections without scalar unwrapping", async () => {
  const text = await shardSource()
  assert.match(text, /\[ValidateSet\('materialize', 'backup'\)\]/)
  assert.match(text, /\[string\] \$Action = 'materialize'/)
  assert.match(text, /@\(\$ShardIndexes \| Where-Object \{ \$null -ne \$_ \}\)/)
  assert.match(text, /\$resolvedShardIndexes = @\(/)
  assert.match(text, /0\.\.\(\$ShardCount - 1\)/)
  assert.match(text, /\$ShardIndexes \| Sort-Object -Unique/)
  assert.match(text, /\[ValidateSet\(2, 4, 8, 16, 32, 64, 128, 256\)\]/)
  assert.match(text, /\[ValidateRange\(1, 25\)\]/)
  assert.match(text, /\[int\] \$PageLimit = 10/)
  assert.match(text, /\[ValidateRange\(1, 32\)\]/)
  assert.match(text, /\[int\] \$MaxConcurrentRequests = 16/)
  assert.match(text, /offset \+= \$MaxConcurrentRequests/)
  assert.match(text, /measured 32-lane production tail reached 188 seconds/)
  assert.match(text, /\[ValidateRange\(30, 300\)\]/)
  assert.match(text, /\[int\] \$RequestTimeoutSeconds = 240/)
  assert.match(text, /\$failedWithoutProgress -ge 12/)
  assert.match(text, /Cutover status failed after 5 attempts/)
  assert.match(text, /408, 429, 500, 502, 503, 504/)
  assert.match(text, /failure_kinds\s+= @\(\$failures \| Sort-Object -Unique\)/)
  assert.match(text, /\[Math\]::Min\(30, \[Math\]::Pow/)
  assert.match(text, /X-Iconoplasm-Cutover-Shard/)
  assert.match(text, /X-Iconoplasm-Cutover-Action', \$Action/)
  assert.match(text, /backup\.verified_entries.*backup\.expected_entries/s)
  assert.match(text, /\[int\] \$DailyWorkerRequestBudget = 2500/)
  assert.match(text, /Reserve-CloudflareWorkerRequests[\s\S]*\$client\.GetAsync/)
  assert.match(text, /Reserve-CloudflareWorkerRequests[\s\S]*-Count \$batch\.Count/)
  assert.match(
    text,
    /Assert-CloudflareWorkerRequestHeadroom[\s\S]*Reserve-CloudflareWorkerRequests/,
  )
  assert.match(text, /workerRequestsSinceTelemetryCheck -ge 100/)
  assert.doesNotMatch(text, /WorkerRequestBudgetStatePath/)
})

test("shared request ledger is user-wide, atomic, crash-conservative, and fail-closed", async () => {
  const text = await requestBudgetSource()
  assert.match(text, /LocalApplicationData/)
  assert.match(text, /operator-worker-request-budget\.json/)
  assert.match(text, /CloudflareWorkerRequestBudgetMaximum = 2500/)
  assert.match(text, /FileShare\]::None/)
  assert.match(text, /requests_reserved = \$nextReserved/)
  assert.match(text, /reserved \+ \$Count -gt \$effectiveDailyLimit/)
  assert.match(text, /No request was sent/)
  assert.match(text, /remaining Free-plan allowance is reserved for the live site/i)
  assert.doesNotMatch(text, /\[switch\]\s+\$(?:Reset|Override|Force)/i)
  assert.match(text, /Math\]::Min\(\$DailyLimit, \[int\] \$saved\.daily_limit\)/)
  assert.match(text, /workersInvocationsAdaptive/)
  assert.match(text, /CloudflareWorkerRequestTelemetryCeiling = 75000/)
  assert.match(text, /GetEnvironmentVariable\('CLOUDFLARE_API_TOKEN', 'User'\)/)
  assert.match(text, /GetEnvironmentVariable\('CLOUDFLARE_ACCOUNT_ID', 'User'\)/)
  assert.match(text, /requests -ge \$SafeAccountRequestCeiling/)
  assert.match(text, /No Worker request was sent/)
})

test("request ledger blocks before overflow and resets only on a new UTC day", async () => {
  const directory = await mkdtemp(join(tmpdir(), "iconoplasm-request-budget-"))
  const ledgerPath = join(directory, "ledger.json")
  const helperPath = fileURLToPath(requestBudgetUrl)
  const quote = (value) => `'${value.replaceAll("'", "''")}'`
  const command = [
    `. ${quote(helperPath)}`,
    `$first = Reserve-CloudflareWorkerRequests -Count 2 -DailyLimit 3 -StatePath ${quote(ledgerPath)} -Operation 'first'`,
    `$second = Reserve-CloudflareWorkerRequests -Count 1 -DailyLimit 3 -StatePath ${quote(ledgerPath)} -Operation 'second'`,
    `$blocked = $false`,
    `try { Reserve-CloudflareWorkerRequests -Count 1 -DailyLimit 2500 -StatePath ${quote(ledgerPath)} -Operation 'overflow' | Out-Null } catch { $blocked = $_.Exception.Message -match 'No request was sent' }`,
    `$saved = Get-Content -LiteralPath ${quote(ledgerPath)} -Raw | ConvertFrom-Json`,
    `[pscustomobject]@{ first = $first.requests_reserved; second = $second.requests_reserved; blocked = $blocked; saved = $saved.requests_reserved } | ConvertTo-Json -Compress`,
  ].join("; ")

  try {
    const result = spawnSync(
      "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
      ["-NoProfile", "-NonInteractive", "-Command", command],
      { encoding: "utf8", timeout: 15_000 },
    )
    assert.equal(result.status, 0, result.stderr)
    const payload = JSON.parse(result.stdout.trim())
    assert.deepEqual(payload, { first: 2, second: 3, blocked: true, saved: 3 })

    const previousDay = JSON.parse(await readFile(ledgerPath, "utf8"))
    previousDay.utc_day = "2000-01-01"
    await writeFile(ledgerPath, JSON.stringify(previousDay), "utf8")
    const rollover = spawnSync(
      "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `. ${quote(helperPath)}; Reserve-CloudflareWorkerRequests -Count 1 -DailyLimit 3 -StatePath ${quote(ledgerPath)} -Operation 'rollover' | ConvertTo-Json -Compress`,
      ],
      { encoding: "utf8", timeout: 15_000 },
    )
    assert.equal(rollover.status, 0, rollover.stderr)
    assert.equal(JSON.parse(rollover.stdout).requests_reserved, 1)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("request ledger serializes concurrent reservations without losing counts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "iconoplasm-request-budget-concurrent-"))
  const ledgerPath = join(directory, "ledger.json")
  const helperPath = fileURLToPath(requestBudgetUrl)
  const quote = (value) => `'${value.replaceAll("'", "''")}'`
  const command = [
    `$helperPath = ${quote(helperPath)}`,
    `$ledgerPath = ${quote(ledgerPath)}`,
    `1..24 | ForEach-Object -Parallel { . $using:helperPath; Reserve-CloudflareWorkerRequests -Count 1 -DailyLimit 24 -StatePath $using:ledgerPath -Operation "parallel-$_" | Out-Null } -ThrottleLimit 8`,
    `(Get-Content -LiteralPath $ledgerPath -Raw | ConvertFrom-Json).requests_reserved`,
  ].join("; ")

  try {
    const result = spawnSync(
      "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
      ["-NoProfile", "-NonInteractive", "-Command", command],
      { encoding: "utf8", timeout: 20_000 },
    )
    assert.equal(result.status, 0, result.stderr)
    assert.equal(Number(result.stdout.trim()), 24)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
