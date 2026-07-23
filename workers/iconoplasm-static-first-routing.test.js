import assert from "node:assert/strict"
import { readFileSync, statSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import toml from "toml"

import { prepareIconoplasmEdgeAssets } from "../scripts/prepare-iconoplasm-edge-assets.mjs"

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

test("the deterministic asset bundle is complete, secure, and within Free-plan limits", async (t) => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "iconoplasm-static-assets-"))
  const source = path.join(fixtureRoot, "public")
  const target = path.join(fixtureRoot, "public-iconoplasm-edge")
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }))

  await mkdir(path.join(source, "apps", "iconoplasm"), { recursive: true })
  await mkdir(path.join(source, "static", "iconoplasm"), { recursive: true })
  await writeFile(
    path.join(source, "apps", "iconoplasm", "index.html"),
    '<main id="iconoplasm-root"><a href="../../apps/iconoplasm/privacy">Privacy</a></main>',
  )
  await writeFile(
    path.join(source, "apps", "iconoplasm", "privacy.html"),
    "<main>Privacy Policy</main>",
  )
  await writeFile(path.join(source, "static", "iconoplasm", "styles.css"), "body{}")
  await writeFile(path.join(source, "runtime.js"), "export {}")
  await writeFile(path.join(source, "component.css"), "body{}")
  await writeFile(path.join(source, "favicon.ico"), "fixture")

  const report = await prepareIconoplasmEdgeAssets({
    sourceRoot: source,
    outputRoot: target,
  })
  const home = readFileSync(path.join(target, "index.html"), "utf8")
  const privacy = readFileSync(path.join(target, "privacy.html"), "utf8")
  const headers = readFileSync(path.join(target, "_headers"), "utf8")

  assert.equal(report.fileCount, 7)
  assert.match(home, /id="iconoplasm-root"/)
  assert.match(home, /href="\/privacy"/)
  assert.match(privacy, /Privacy Policy/)
  assert.match(headers, /Content-Security-Policy:/)
  assert.match(headers, /X-Frame-Options: DENY/)
  assert.match(headers, /\/static\/iconoplasm\/\*/)
  assert.ok(statSync(path.join(target, "static", "iconoplasm", "styles.css")).isFile())
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

test("production hands off the existing route before Wrangler reconciles stateful triggers", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/deploy-quartz.yml", import.meta.url),
    "utf8",
  )
  const handoffIndex = workflow.indexOf("Hand off Iconoplasm route to the prepared stateful worker")
  const statefulDeployIndex = workflow.indexOf(
    "Deploy the only allowed internal stateful worker (production)",
  )

  assert.ok(handoffIndex > 0)
  assert.ok(statefulDeployIndex > handoffIndex)
})
