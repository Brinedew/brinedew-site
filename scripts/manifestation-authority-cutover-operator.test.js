import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"

const scriptUrl = new URL("./Invoke-ManifestationAuthorityCutover.ps1", import.meta.url)
const shardScriptUrl = new URL("./Invoke-ManifestationAuthorityCutoverShards.ps1", import.meta.url)

async function source() {
  return readFile(scriptUrl, "utf8")
}

async function shardSource() {
  return readFile(shardScriptUrl, "utf8")
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
})
