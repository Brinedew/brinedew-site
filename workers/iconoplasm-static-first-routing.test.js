import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import test from "node:test"

import toml from "toml"

const repoRoot = new URL("../", import.meta.url)
const publicConfig = toml.parse(readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8"))
const statefulConfig = toml.parse(
  readFileSync(
    new URL(
      "../wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml",
      import.meta.url,
    ),
    "utf8",
  ),
)

// ARCHITECTURE FENCE [IPD-007]
test("Iconoplasm route has exactly one owner and that owner is asset-first", () => {
  const publicPatterns = publicConfig.routes.map((route) => route.pattern)
  const statefulPatterns = statefulConfig.routes.map((route) => route.pattern)

  assert.equal(publicPatterns.includes("iconoplasm.brinedew.bio/*"), false)
  assert.deepEqual(statefulPatterns, ["iconoplasm.brinedew.bio/*"])
  assert.equal(statefulConfig.assets.directory, "./public-iconoplasm-edge")
  assert.equal(statefulConfig.assets.not_found_handling, "none")
  assert.ok(statefulConfig.assets.run_worker_first.includes("/api/*"))
  assert.ok(statefulConfig.assets.run_worker_first.includes("/gene/*"))
})

test("the deterministic asset bundle is complete, secure, and within Free-plan limits", () => {
  execFileSync(process.execPath, ["scripts/prepare-iconoplasm-edge-assets.mjs"], {
    cwd: repoRoot,
    stdio: "pipe",
    timeout: 30_000,
  })

  const target = new URL("../public-iconoplasm-edge/", import.meta.url)
  const home = readFileSync(new URL("index.html", target), "utf8")
  const privacy = readFileSync(new URL("privacy.html", target), "utf8")
  const headers = readFileSync(new URL("_headers", target), "utf8")

  assert.match(home, /id="iconoplasm-root"/)
  assert.match(home, /href="\/privacy"/)
  assert.match(privacy, /Privacy Policy/)
  assert.match(headers, /Content-Security-Policy:/)
  assert.match(headers, /X-Frame-Options: DENY/)
  assert.match(headers, /\/static\/iconoplasm\/\*/)
  assert.ok(statSync(new URL("static/iconoplasm/styles.css", target)).isFile())
})

test("production workflow assigns Iconoplasm only to the stateful route owner", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/deploy-quartz.yml", import.meta.url),
    "utf8",
  )
  const publicAssignment = workflow.match(
    /the-only-allowed-public-edge-worker-that-must-not-touch-state[\s\S]*?(?=\n\s{6}- name:)/,
  )?.[0]
  const statefulAssignment = workflow.match(
    /Reassign Iconoplasm route to the stateful worker[\s\S]*?(?=\n\s{6}- name:)/,
  )?.[0]

  assert.ok(publicAssignment)
  assert.doesNotMatch(publicAssignment, /iconoplasm\.brinedew\.bio/)
  assert.match(statefulAssignment, /geneguessr-api/)
  assert.match(statefulAssignment, /iconoplasm\.brinedew\.bio\/\*/)
})
