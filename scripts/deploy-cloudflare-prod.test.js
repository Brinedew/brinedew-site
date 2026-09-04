import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

test("production dispatch depends on verified remote commit, not local branch or dirty files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deploy-dispatch-test-"))
  const driver = join(directory, "driver.ps1")
  const helper = fileURLToPath(new URL("./deploy-cloudflare-prod.ps1", import.meta.url))
  await writeFile(
    driver,
    String.raw`
param($Helper, $Scenario)
$ErrorActionPreference = 'Stop'
# No external git/gh fallback is possible in this test.
$env:PATH = ''
$global:deployCalls = [Collections.Generic.List[string]]::new()
$global:deployScenario = $Scenario
function global:git {
  $command = $args -join ' '
  $global:deployCalls.Add("git $command")
  $global:LASTEXITCODE = 0
  switch ($command) {
    'rev-parse --abbrev-ref HEAD' { if ($global:deployScenario -eq 'detached') { 'HEAD' } else { 'main' }; return }
    'status --porcelain' { if ($global:deployScenario -eq 'dirty') { ' M unrelated.txt' }; return }
    'fetch origin main --quiet' { if ($global:deployScenario -eq 'fetch-fails') { $global:LASTEXITCODE = 1 }; return }
    'rev-parse --verify HEAD' { if ($global:deployScenario -eq 'head-fails') { $global:LASTEXITCODE = 1; return }; 'a' * 40; return }
    'rev-parse --verify origin/main' { if ($global:deployScenario -eq 'origin-fails') { $global:LASTEXITCODE = 1; return }; if ($global:deployScenario -eq 'mismatch') { 'b' * 40 } else { 'a' * 40 }; return }
    default { throw "Unexpected git command: $command" }
  }
}
function global:gh {
  $command = $args -join ' '
  $global:deployCalls.Add("gh $command")
  $global:LASTEXITCODE = 0
  if ($command -eq 'workflow run .github/workflows/deploy-quartz.yml --ref main') { return }
  if ($args[0] -eq 'run' -and $args[1] -eq 'list') {
    ,@{ databaseId = 123; createdAt = [DateTimeOffset]::UtcNow.ToString('o'); url = 'https://example.invalid/run'; status = 'completed'; conclusion = 'success'; headSha = ('a' * 40); event = 'workflow_dispatch' } | ConvertTo-Json -Compress
    return
  }
  if ($command -eq 'run watch 123 --exit-status') { return }
  throw "Unexpected gh command: $command"
}
$failure = $null
try { & $Helper } catch { $failure = $_.Exception.Message }
[pscustomobject]@{ failure = $failure; calls = @($global:deployCalls) } | ConvertTo-Json -Compress
`,
    "utf8",
  )
  try {
    for (const scenario of [
      "clean",
      "dirty",
      "detached",
      "mismatch",
      "fetch-fails",
      "head-fails",
      "origin-fails",
    ]) {
      const result = spawnSync(
        process.platform === "win32" ? "C:\\Program Files\\PowerShell\\7\\pwsh.exe" : "pwsh",
        ["-NoProfile", "-NonInteractive", "-File", driver, helper, scenario],
        { encoding: "utf8", timeout: 10000, maxBuffer: 128000 },
      )
      assert.equal(result.status, 0, result.stderr)
      const evidence = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1))
      const dispatched = evidence.calls.some((call) => call.startsWith("gh workflow run"))
      const allowed = ["clean", "dirty", "detached"].includes(scenario)
      assert.equal(dispatched, allowed, JSON.stringify({ scenario, evidence }))
      assert.equal(evidence.failure === null, allowed, JSON.stringify({ scenario, evidence }))
      if (allowed) assert.ok(evidence.calls.includes("gh run watch 123 --exit-status"))
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
