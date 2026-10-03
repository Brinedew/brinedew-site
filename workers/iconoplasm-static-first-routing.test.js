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
  // B-980: a path with no document is a real 404 (the 404 page boots the app in a
  // browser), so a crawler never indexes the shell under an unpublished address.
  assert.equal(statefulConfig.assets.not_found_handling, "404-page")
  assert.ok(statefulConfig.assets.run_worker_first.includes("/api/*"))
  assert.ok(statefulConfig.assets.run_worker_first.includes("/blot/*"))
  assert.equal(statefulConfig.assets.run_worker_first.includes("/gene/*"), false)
  assert.ok(statefulConfig.assets.run_worker_first.includes("/portraits/*"))
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
    publishedGenes: [
      ["RB1", "RB transcriptional corepressor 1", "", "", 0],
      ["TP53", "tumor protein p53", "", "", 0],
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
  // Readers fetch the published JSON straight from Bunny. Without this origin in connect-src the
  // browser blocks every CDN read, each page falls back to the Worker, and the offload is lost.
  assert.match(headers, /connect-src[^\n]*https:\/\/iconoplasmportraits\.b-cdn\.net/)
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

// B-905: the bundle is capped at 20,000 files and the gene documents take
// 19,023 of them. A test file under public/static is a file of that cap and
// public test code, so the build refuses one instead of shipping it.
// Failure modes, written before the guard:
// 1. a *.test.* or *.spec.* file anywhere in the bundle builds anyway;
// 2. a real asset whose name only contains "test" (latest.js, contest.css) is
//    refused.
test("the bundle build refuses a test file and keeps assets that only look like one", async (t) => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "iconoplasm-no-tests-"))
  const source = path.join(fixtureRoot, "public")
  const target = path.join(fixtureRoot, "public-iconoplasm-edge")
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }))
  await mkdir(path.join(source, "apps", "iconoplasm"), { recursive: true })
  for (const page of ["index", "privacy", "license", "caretaker-terms", "developers"])
    await writeFile(path.join(source, "apps", "iconoplasm", `${page}.html`), "<main></main>")
  await mkdir(path.join(source, "static", "iconoplasm"), { recursive: true })
  await mkdir(path.join(source, "static", "shared"), { recursive: true })
  await writeFile(path.join(source, "favicon.ico"), "fixture")
  await writeFile(path.join(source, "static", "iconoplasm", "latest.js"), "export {}")
  await writeFile(path.join(source, "static", "iconoplasm", "contest.css"), "body{}")
  const build = () =>
    prepareIconoplasmEdgeAssets({
      sourceRoot: source,
      outputRoot: target,
      publishedGenes: [["TP53", "tumor protein p53", "", "", 0]],
    })

  const clean = await build()
  assert.ok(statSync(path.join(target, "static", "iconoplasm", "latest.js")).isFile())
  assert.ok(statSync(path.join(target, "static", "iconoplasm", "contest.css")).isFile())
  assert.equal(
    clean.files.filter((file) => /\.(?:test|spec)\./.test(file)).length,
    0,
    "a clean bundle has no test files",
  )

  await writeFile(path.join(source, "static", "iconoplasm", "app.test.js"), "export {}")
  await writeFile(path.join(source, "static", "shared", "sidebar.spec.ts"), "export {}")
  await assert.rejects(
    build(),
    /test files.*static\/iconoplasm\/app\.test\.js.*static\/shared\/sidebar\.spec\.ts/,
  )
})

// B-932: the site offers one manual-install extension package, the one
// extension-release.json names. Every other zip under static/iconoplasm/downloads
// is a file of the 20,000-file cap and about 3.5 MB nobody downloads.
// Failure modes, written before the guard:
// 1. an unreferenced zip (an old version, or the predecessor after the next
//    release) builds into the bundle anyway;
// 2. the referenced zip is missing and the build ships a live download button
//    with nothing behind it;
// 3. the guard matches by prefix, so v0.5.9 passes for v0.5.90, or it flags a
//    zip that is not an extension package.
test("the bundle build holds exactly the extension package the release metadata names", async (t) => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "iconoplasm-one-package-"))
  const source = path.join(fixtureRoot, "public")
  const target = path.join(fixtureRoot, "public-iconoplasm-edge")
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }))
  await mkdir(path.join(source, "apps", "iconoplasm"), { recursive: true })
  for (const page of ["index", "privacy", "license", "caretaker-terms", "developers"])
    await writeFile(path.join(source, "apps", "iconoplasm", `${page}.html`), "<main></main>")
  const downloads = path.join(source, "static", "iconoplasm", "downloads")
  await mkdir(downloads, { recursive: true })
  await mkdir(path.join(source, "static", "iconoplasm", "vendor"), { recursive: true })
  await writeFile(path.join(source, "favicon.ico"), "fixture")
  await writeFile(
    path.join(source, "static", "iconoplasm", "extension-release.json"),
    JSON.stringify({
      version: "0.5.9",
      chromeDeveloperPackageUrl: "/static/iconoplasm/downloads/iconoplasm-extension-v0.5.9.zip",
    }),
  )
  await writeFile(path.join(source, "static", "iconoplasm", "vendor", "library.zip"), "not ours")
  const build = () =>
    prepareIconoplasmEdgeAssets({
      sourceRoot: source,
      outputRoot: target,
      publishedGenes: [["TP53", "tumor protein p53", "", "", 0]],
    })

  await assert.rejects(build(), /iconoplasm-extension-v0\.5\.9\.zip/, "named but missing")

  await writeFile(path.join(downloads, "iconoplasm-extension-v0.5.9.zip"), "current")
  const clean = await build()
  assert.deepEqual(
    clean.files.filter((file) => file.endsWith(".zip")).sort(),
    [
      "static/iconoplasm/downloads/iconoplasm-extension-v0.5.9.zip",
      "static/iconoplasm/vendor/library.zip",
    ],
    "the named package and an unrelated zip outside downloads/ are both kept",
  )

  await writeFile(path.join(downloads, "iconoplasm-extension-v0.5.90.zip"), "prefix lookalike")
  await writeFile(path.join(downloads, "iconoplasm-extension-v0.5.8.zip"), "predecessor")
  await assert.rejects(
    build(),
    /unreferenced.*downloads\/iconoplasm-extension-v0\.5\.8\.zip.*downloads\/iconoplasm-extension-v0\.5\.90\.zip/,
  )
})
