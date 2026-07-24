import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const ROOT = new URL("../", import.meta.url)

function read(path) {
  return readFileSync(new URL(path, ROOT), "utf8")
}

test("Iconoplasm Cloudflare ops uses one iconoplasm-admin secret source", () => {
  const workflowPaths = [
    ".github/workflows/deploy-quartz.yml",
    // deploy-pages-staging.yml was removed when the staging CI tier was retired.
    ".github/workflows/deploy-preview.yaml",
    ".github/workflows/deploy-benchmark.yml",
    ".github/workflows/refresh-iconoplasm-observability-snapshot.yml",
    ".github/workflows/rotate-iconoplasm-admin-token.yml",
  ]
  for (const workflowPath of workflowPaths) {
    const source = read(workflowPath)
    assert.match(
      source,
      /secrets\.CLOUDFLARE_ICONOPLASM_ADMIN_TOKEN/,
      `${workflowPath} should source Cloudflare auth from iconoplasm-admin`,
    )
    assert.doesNotMatch(
      source,
      /secrets\.CLOUDFLARE_API_TOKEN/,
      `${workflowPath} must not read the old generic Cloudflare token secret`,
    )
  }
})

test("observability snapshot does not recover from Wrangler OAuth", () => {
  const source = read("scripts/generate-iconoplasm-observability-snapshot.mjs")
  assert.match(source, /account-owned iconoplasm-admin token/)
  assert.doesNotMatch(source, /readWranglerOAuthTokenFromCli|readWranglerAccountId/)
  assert.doesNotMatch(source, /wrangler auth token|wrangler whoami/i)
})

test("observability snapshot workflow publishes hourly without becoming a production deploy loop", () => {
  const source = read(".github/workflows/refresh-iconoplasm-observability-snapshot.yml")
  assert.match(source, /workflow_dispatch:/)
  assert.match(source, /cron:\s*["']17 \* \* \* \*["']/)
  assert.match(source, /iconoplasm:observability-snapshot:v1/)
  assert.match(source, /check-iconoplasm-cloudflare-budget-headroom\.mjs/)
  assert.doesNotMatch(source, /wrangler deploy/)
})

test("production Iconoplasm maintenance is not an hourly free-plan cron", () => {
  const source = read("wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml")
  const runtime = read(
    "workers/the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js",
  )
  assert.doesNotMatch(
    source,
    /crons\s*=\s*\[[^\]]*["']17 \* \* \* \*["']/s,
    "hourly maintenance cron can burn Cloudflare free-plan budget before humans wake up",
  )
  assert.doesNotMatch(
    runtime,
    /["']17 \* \* \* \*["']/,
    "runtime must not retain a homemade handler for a cron that configuration cannot fire",
  )
})

test("configured production maintenance crons also drain stranded vote projections", () => {
  const source = read(
    "workers/the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js",
  )
  assert.match(source, /ICONOPLASM_SCHEDULED_MAINTENANCE_CRONS/)
  assert.match(source, /"55 23 \* \* \*"/)
  assert.match(source, /"3 0 \* \* \*"/)
  assert.match(source, /process-vote-projection-refresh/)
})

test("frequent gallery-refresh cron is gallery-only, never the heavy maintenance", () => {
  const runtime = read(
    "workers/the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js",
  )
  const wrangler = read("wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml")
  // The */15 tick exists and is routed to the cheap gallery-only path...
  assert.match(wrangler, /crons\s*=\s*\[[^\]]*["']\*\/15 \* \* \* \*["']/s)
  assert.match(runtime, /cronExpr === "\*\/15 \* \* \* \*"/)
  assert.match(runtime, /runScheduledIconoplasmGalleryRefresh/)
  assert.match(runtime, /publishSharedGeneDiscoverySymbols/)
  // ...and must NOT be in the heavy maintenance set (vote projection + canon repair),
  // or the frequent tick would burn free-plan budget every 15 minutes.
  const maintenanceSet = /ICONOPLASM_SCHEDULED_MAINTENANCE_CRONS = new Set\(\[([^\]]*)\]\)/s.exec(
    runtime,
  )
  assert.ok(maintenanceSet, "maintenance cron set must be present")
  assert.doesNotMatch(maintenanceSet[1], /\*\/15/)
  // The gallery-only tick must not invoke the heavy maintenance routine.
  assert.doesNotMatch(
    runtime,
    /cronExpr === "\*\/15 \* \* \* \*"\)\s*\{[\s\S]*?runScheduledIconoplasmMaintenance/,
  )
})

test("credential docs retire cache and Wrangler fallback paths", () => {
  const deployDocs = read("docs/ICONOPLASM_DEPLOY_CREDENTIALS.md")
  const operationsDocs = read("docs/ICONOPLASM_OPERATIONS.md")
  assert.match(deployDocs, /account-owned token named `iconoplasm-admin`/)
  assert.match(deployDocs, /cloudflare_auth_cache\.json` is retired/)
  assert.match(operationsDocs, /do not use Wrangler OAuth or `cloudflare_auth_cache\.json`/)
})
