import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import toml from "toml"

import { prepareIconoplasmEdgeAssets } from "../scripts/prepare-iconoplasm-edge-assets.mjs"
import { CURRENT_CARETAKER_TERMS } from "./iconoplasm/caretaker/caretaker-terms-registry.js"

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

// Every terms version a migration seeded, plus the current one in the
// checked-in registry (B-864), must have a served plain-text copy whose
// SHA-256 matches, and the public page must show the registry's version. One
// generic check instead of one hand-written test per version (B-860).
test("every caretaker terms version has a hash-matching public copy", () => {
  const migrationsDir = new URL("../migrations-iconoplasm-authoring/", import.meta.url)
  const staticDir = new URL("../quartz/static/iconoplasm/", import.meta.url)
  const copies = new Map(
    readdirSync(staticDir)
      .filter((name) => /^caretaker-terms-.*\.txt$/.test(name))
      .map((name) => {
        const bytes = readFileSync(new URL(name, staticDir))
        const version = /^Version: (\S+)$/m.exec(bytes.toString("utf8"))?.[1]
        return [version, { name, sha: createHash("sha256").update(bytes).digest("hex") }]
      }),
  )
  const seeded = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .flatMap((name) => {
      const sql = readFileSync(new URL(name, migrationsDir), "utf8")
      const row = /VALUES \(\s*'(terms_[^']+)',\s*'([0-9a-f]{64})'/.exec(sql)
      return row ? [{ version: row[1], sha: row[2] }] : []
    })
  assert.ok(seeded.length >= 5)
  const newest = {
    version: CURRENT_CARETAKER_TERMS.terms_version_id,
    sha: CURRENT_CARETAKER_TERMS.terms_sha256,
  }
  for (const { version, sha } of [...seeded, newest]) {
    assert.equal(copies.get(version)?.sha, sha, `${version} plain-text copy hash`)
  }
  const page = readFileSync(
    new URL("../content/apps/iconoplasm/caretaker-terms.md", import.meta.url),
    "utf8",
  )
  assert.match(page, new RegExp(`\`${newest.version}\``))
  assert.ok(page.includes(copies.get(newest.version).name))
})

// ARCHITECTURE FENCE [IPD-007]
test("Iconoplasm route has exactly one owner and that owner is asset-first", () => {
  const publicPatterns = publicConfig.routes.map((route) => route.pattern)
  const statefulPatterns = statefulConfig.routes.map((route) => route.pattern)

  assert.equal(publicPatterns.includes("iconoplasm.brinedew.bio/*"), false)
  assert.deepEqual(statefulPatterns, ["iconoplasm.brinedew.bio/*"])
  assert.equal(statefulConfig.assets.directory, "./public-iconoplasm-edge")
  assert.equal(statefulConfig.assets.not_found_handling, "single-page-application")
  assert.ok(statefulConfig.assets.run_worker_first.includes("/api/*"))
  assert.ok(statefulConfig.assets.run_worker_first.includes("/blot/*"))
  assert.equal(statefulConfig.assets.run_worker_first.includes("/gene/*"), false)
  assert.ok(statefulConfig.assets.run_worker_first.includes("/portraits/*"))
  // B-807: extension origin fallback for immutable publication objects must reach
  // the Worker; the SPA fallback would answer these JSON URLs with the HTML shell.
  assert.ok(statefulConfig.assets.run_worker_first.includes("/published-cards/v2/immutable/*"))
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
    '<main id="iconoplasm-root"><a href="../../apps/iconoplasm/privacy">Privacy</a><a href="../../apps/iconoplasm/license">License</a></main>',
  )
  await writeFile(
    path.join(source, "apps", "iconoplasm", "privacy.html"),
    "<main>Privacy Policy</main>",
  )
  await writeFile(
    path.join(source, "apps", "iconoplasm", "license.html"),
    "<main>Image License</main>",
  )
  await writeFile(
    path.join(source, "apps", "iconoplasm", "caretaker-terms.html"),
    "<main>Caretaker Terms</main>",
  )
  await writeFile(
    path.join(source, "apps", "iconoplasm", "developers.html"),
    "<main>For developers</main>",
  )
  await writeFile(path.join(source, "static", "iconoplasm", "styles.css"), "body{}")
  await writeFile(path.join(source, "runtime.js"), "export {}")
  await writeFile(path.join(source, "component.css"), "body{}")
  await writeFile(path.join(source, "favicon.ico"), "fixture")

  const report = await prepareIconoplasmEdgeAssets({
    sourceRoot: source,
    outputRoot: target,
    publicationIndexes: [
      {
        schema_version: 2,
        search_entries: [
          ["RB1", "RB transcriptional corepressor 1", 0, 0],
          ["TP53", "tumor protein p53", 0, 1],
        ],
      },
    ],
  })
  const home = readFileSync(path.join(target, "index.html"), "utf8")
  const privacy = readFileSync(path.join(target, "privacy.html"), "utf8")
  const license = readFileSync(path.join(target, "license.html"), "utf8")
  const caretakerTerms = readFileSync(path.join(target, "caretaker-terms.html"), "utf8")
  const headers = readFileSync(path.join(target, "_headers"), "utf8")
  const sitemap = readFileSync(path.join(target, "sitemap.xml"), "utf8")
  const redirects = readFileSync(path.join(target, "_redirects"), "utf8")

  assert.ok(report.fileCount < 25)
  assert.match(home, /id="iconoplasm-root"/)
  assert.match(home, /href="\/privacy"/)
  assert.match(home, /href="\/license"/)
  assert.match(privacy, /Privacy Policy/)
  assert.match(license, /Image License/)
  assert.match(caretakerTerms, /Caretaker Terms/)
  assert.match(headers, /\/license/)
  assert.match(headers, /\/caretaker-terms/)
  assert.match(headers, /Content-Security-Policy:/)
  assert.match(headers, /X-Frame-Options: DENY/)
  assert.match(headers, /openapi\.json>; rel="service-desc"; type="application\/json"/)
  assert.match(headers, /metadata>; rel="service-meta"; type="application\/json"/)
  assert.match(headers, /llms\.txt>; rel="describedby"; type="text\/plain"/)
  assert.match(headers, /\/static\/iconoplasm\/\*/)
  assert.match(sitemap, /https:\/\/iconoplasm\.brinedew\.bio\/gene\/RB1/)
  assert.match(sitemap, /https:\/\/iconoplasm\.brinedew\.bio\/gene\/TP53/)
  assert.doesNotMatch(redirects, /^\/blot\//m)
  assert.doesNotMatch(redirects, /^\/portraits\//m)
  // B-809: each published gene gets exactly one small static document that
  // names it (title/canonical) and boots the single SPA shell. The build
  // itself refuses a bundle above Cloudflare's 20,000-file Free cap.
  const geneFiles = readdirSync(path.join(target, "gene")).sort()
  assert.deepEqual(geneFiles, ["RB1.html", "TP53.html"])
  for (const file of geneFiles) {
    const html = readFileSync(path.join(target, "gene", file), "utf8")
    const symbol = file.replace(/\.html$/, "")
    assert.ok(Buffer.byteLength(html) < 4096, `${file} must stay tiny, not a shell copy`)
    assert.ok(
      html.includes(`rel="canonical" href="https://iconoplasm.brinedew.bio/gene/${symbol}"`),
      `${file} must carry its own canonical URL`,
    )
    assert.doesNotMatch(html, /id="iconoplasm-root"/)
  }
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
    "Publish, verify, and activate immutable public reads",
  )

  assert.ok(handoffIndex > 0)
  assert.ok(statefulDeployIndex > handoffIndex)
})
