import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import test from "node:test"

test("operator D1 admission sums every database and fails closed on exhausted or invalid telemetry", () => {
  const helper = fileURLToPath(
    new URL("./lib/CloudflareWorkerRequestBudget.ps1", import.meta.url),
  ).replaceAll("'", "''")
  const executable =
    process.platform === "win32" ? "C:\\Program Files\\PowerShell\\7\\pwsh.exe" : "pwsh"
  const command = `
    . '${helper}'
    $cases = @(
      '{"d1AnalyticsAdaptiveGroups":[{"dimensions":{"date":"2026-09-05"},"sum":{"rowsRead":2000000,"rowsWritten":10000}},{"dimensions":{"date":"2026-09-05"},"sum":{"rowsRead":1600000,"rowsWritten":10000}}]}',
      '{"d1AnalyticsAdaptiveGroups":[{"dimensions":{"date":"2026-09-05"},"sum":{"rowsRead":1,"rowsWritten":70000}}]}',
      '{}',
      '{"d1AnalyticsAdaptiveGroups":[{"dimensions":{"date":"2026-09-04"},"sum":{"rowsRead":1,"rowsWritten":1}}]}',
      '{"d1AnalyticsAdaptiveGroups":[{"dimensions":{"date":"2026-09-05"},"sum":{"rowsRead":null,"rowsWritten":1}}]}',
      '{"d1AnalyticsAdaptiveGroups":[{"dimensions":{"date":"2026-09-05"},"sum":{"rowsRead":10,"rowsWritten":1}}]}'
    )
    $outcomes = foreach ($case in $cases) {
      try { Assert-CloudflareD1AccountHeadroom -Account ($case | ConvertFrom-Json) -UtcDay '2026-09-05' | Out-Null; $true } catch { $false }
    }
    ConvertTo-Json -InputObject @($outcomes) -Compress
  `
  const result = spawnSync(executable, ["-NoProfile", "-NonInteractive", "-Command", command], {
    encoding: "utf8",
    timeout: 15000,
  })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), [false, false, false, false, false, true])
})
