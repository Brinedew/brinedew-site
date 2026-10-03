import assert from "node:assert/strict"
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createRequire } from "node:module"
import test from "node:test"
import { parse as parseToml } from "toml"
import { prepareIconoplasmEdgeAssets } from "../scripts/prepare-iconoplasm-edge-assets.mjs"
import { prepareRetainedAssetsConfig } from "../scripts/prepare-iconoplasm-schema-transition-config.mjs"
import { proveAnonymousRouteTopology } from "../scripts/lib/iconoplasm-static-topology-proof.mjs"

const require = createRequire(import.meta.url)
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"))
const { Miniflare, convertV4MiniflareOptions } = wranglerRequire("miniflare")
const repoRoot = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/(.:)/, "$1"))

async function makeAssetFixture() {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "iconoplasm-assets-"))
  const sourceRoot = path.join(temporaryRoot, "public")
  const outputRoot = path.join(temporaryRoot, "public-iconoplasm-edge")
  await mkdir(path.join(sourceRoot, "apps", "iconoplasm"), { recursive: true })
  await mkdir(path.join(sourceRoot, "static"), { recursive: true })
  // What the Quartz Static emitter publishes: the modules without their tests
  // (B-905) and the one extension package the release metadata names (B-932).
  // The bundle build refuses a test file and an unreferenced package.
  const staticRoot = path.join(repoRoot, "quartz", "static", "iconoplasm")
  const release = JSON.parse(
    await readFile(path.join(staticRoot, "extension-release.json"), "utf8"),
  )
  const packageName = path.basename(release.chromeDeveloperPackageUrl)
  await cp(staticRoot, path.join(sourceRoot, "static", "iconoplasm"), {
    recursive: true,
    filter: (source) =>
      !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(source) &&
      !(
        path.basename(path.dirname(source)) === "downloads" && path.basename(source) !== packageName
      ),
  })
  const shell = `<!doctype html><script type="module" src="/static/iconoplasm/app.js"></script>`
  for (const page of ["index", "privacy", "license", "caretaker-terms", "developers"])
    await writeFile(path.join(sourceRoot, "apps", "iconoplasm", `${page}.html`), shell)
  await writeFile(path.join(sourceRoot, "favicon.ico"), "fixture")
  const summary = await prepareIconoplasmEdgeAssets({
    sourceRoot,
    outputRoot,
    publishedGenes: [["TP53", "tumor protein p53", "", "", 0]],
  })
  assert.ok(summary.fileCount > 10, "the prepared bundle contains the actual Iconoplasm modules")
  return { temporaryRoot, outputRoot }
}

test(
  "real workerd routes the mutable blot and first-party portrait fallback through the Worker",
  { timeout: 30_000 },
  async () => {
    const { temporaryRoot, outputRoot } = await makeAssetFixture()

    let runtime
    try {
      const config = parseToml(
        await readFile(
          path.join(
            repoRoot,
            "wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml",
          ),
          "utf8",
        ),
      )
      runtime = new Miniflare(
        convertV4MiniflareOptions({
          name: "iconoplasm-routing-test",
          modules: true,
          script: `export default {fetch(){return new Response("stateful-worker",{status:599})}}`,
          compatibilityDate: "2026-08-01",
          assets: {
            directory: outputRoot,
            run_worker_first: config.assets.run_worker_first,
            routerConfig: { has_user_worker: true },
            assetConfig: { not_found_handling: config.assets.not_found_handling },
          },
        }),
      )

      for (const pathname of [
        "/",
        "/search?q=TP53",
        "/genes",
        "/gene/TP53",
        "/portrait/TP53.webp",
        "/sitemap.xml",
        "/robots.txt",
        "/llms.txt",
      ]) {
        const response = await runtime.dispatchFetch(`https://iconoplasm.test${pathname}`)
        assert.notEqual(response.status, 599, `${pathname} invoked the stateful Worker`)
      }
      const apiResponse = await runtime.dispatchFetch("https://iconoplasm.test/api/auth/me")
      assert.equal(apiResponse.status, 599, await apiResponse.text())
      for (const method of ["GET", "HEAD"]) {
        const blotResponse = await runtime.dispatchFetch("https://iconoplasm.test/blot/TP53.webp", {
          method,
          redirect: "manual",
        })
        assert.equal(blotResponse.status, 599, "the exact-card blot handler owns the mutable alias")
        const portraitResponse = await runtime.dispatchFetch(
          "https://iconoplasm.test/portraits/v1/aa/" + "a".repeat(64) + "/full.webp",
          { method, redirect: "manual" },
        )
        assert.equal(
          portraitResponse.status,
          599,
          "the first-party portrait route owns the fallback",
        )
      }
    } finally {
      await runtime?.dispose()
      await rm(temporaryRoot, { recursive: true, force: true })
    }
  },
)

// B-980: an address with no document answers a real 404, never the shell as a
// 200 that a crawler can index. Ways this can fail:
//  1. /gene/<unpublished> or another unknown path answers 200 with the home page's
//     "index,follow" robots meta and canonical "/" (measured live on 2026-10-03:
//     /gene/NOTAREALGENE1 answered exactly that).
//  2. The 404 reaches the stateful Worker, a metered request per probe.
//  3. A browser opening an alias or lowercase gene link (/gene/tp53) no longer
//     gets the app: the 404 page must boot the shell in place, as a gene document does.
//  4. A published gene's document, the home page or an in-app route (/clans,
//     /studio) turns into a 404 or gains noindex.
// Asked both ways a crawler and a browser ask (no Fetch metadata, then a navigation).
test(
  "an address with no document answers a real 404 that still boots the app",
  { timeout: 30_000 },
  async () => {
    const { temporaryRoot, outputRoot } = await makeAssetFixture()
    let runtime
    try {
      const config = parseToml(
        await readFile(
          path.join(
            repoRoot,
            "wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml",
          ),
          "utf8",
        ),
      )
      runtime = new Miniflare(
        convertV4MiniflareOptions({
          name: "iconoplasm-not-found-test",
          modules: true,
          script: `export default {fetch(){return new Response("stateful-worker",{status:599})}}`,
          compatibilityDate: "2026-08-01",
          assets: {
            directory: outputRoot,
            run_worker_first: config.assets.run_worker_first,
            routerConfig: { has_user_worker: true },
            assetConfig: { not_found_handling: config.assets.not_found_handling },
          },
        }),
      )
      const noindex = /<meta name="robots" content="noindex,follow">/
      const boots = /fetch\("\/",\{credentials:"same-origin"\}\)/
      const asked = [
        {},
        { "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document", Accept: "text/html" },
      ]
      for (const headers of asked) {
        const label = Object.keys(headers).length ? "navigation" : "crawler"
        for (const pathname of [
          "/gene/NOTAREALGENE1",
          "/gene/tp53",
          "/gene/",
          "/gene",
          "/search",
          "/no/such/page",
        ]) {
          const response = await runtime.dispatchFetch(`https://iconoplasm.test${pathname}`, {
            headers,
          })
          const html = await response.text()
          // 404 is not 599, so this also proves the Worker was not invoked.
          assert.equal(response.status, 404, `${label} ${pathname}`)
          assert.match(html, noindex, `${label} ${pathname}`)
          assert.doesNotMatch(html, /rel="canonical"/, `${label} ${pathname}`)
          assert.match(html, boots, `${label} ${pathname} must still boot the app`)
        }
        const gene = await runtime.dispatchFetch("https://iconoplasm.test/gene/TP53", { headers })
        const geneHtml = await gene.text()
        assert.equal(gene.status, 200, label)
        assert.match(geneHtml, /<link rel="canonical" href="[^"]*\/gene\/TP53">/, label)
        assert.doesNotMatch(geneHtml, /noindex/, label)
        for (const pathname of ["/clans", "/studio"]) {
          const route = await runtime.dispatchFetch(`https://iconoplasm.test${pathname}`, {
            headers,
          })
          assert.equal(route.status, 200, `${label} ${pathname}`)
          assert.match(await route.text(), boots, `${label} ${pathname} boots the app`)
        }
        const home = await runtime.dispatchFetch("https://iconoplasm.test/", { headers })
        assert.equal(home.status, 200, label)
        assert.doesNotMatch(await home.text(), /noindex/, `${label} the home page stays indexable`)
      }
    } finally {
      await runtime?.dispose()
      await rm(temporaryRoot, { recursive: true, force: true })
    }
  },
)

test(
  "real workerd preparation topology is exactly the retained pre-cutover route contract",
  { timeout: 30_000 },
  async () => {
    const { temporaryRoot, outputRoot } = await makeAssetFixture()
    let runtime
    try {
      const canonical = await readFile(
        path.join(
          repoRoot,
          "wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml",
        ),
        "utf8",
      )
      const config = parseToml(prepareRetainedAssetsConfig(canonical))
      const retained = config.unsafe.metadata.assets.config
      assert.equal(config.unsafe.metadata.keep_assets, true)
      runtime = new Miniflare(
        convertV4MiniflareOptions({
          name: "iconoplasm-preparation-preview-test",
          modules: true,
          script: `export default {fetch(){return new Response("stateful-worker",{status:599})}}`,
          compatibilityDate: "2026-08-01",
          assets: {
            directory: outputRoot,
            run_worker_first: retained.run_worker_first,
            routerConfig: { has_user_worker: true },
            assetConfig: { not_found_handling: retained.not_found_handling },
          },
        }),
      )

      for (const pathname of ["/", "/genes", "/robots.txt"])
        assert.notEqual(
          (await runtime.dispatchFetch(`https://iconoplasm.test${pathname}`)).status,
          599,
          pathname,
        )
      for (const method of ["GET", "HEAD"]) {
        const blotResponse = await runtime.dispatchFetch("https://iconoplasm.test/blot/TP53.webp", {
          method,
          redirect: "manual",
        })
        assert.equal(blotResponse.status, 599, "the exact-card blot handler owns the mutable alias")
      }
      for (const pathname of ["/search?q=TP53", "/api/auth/me"])
        assert.equal(
          (await runtime.dispatchFetch(`https://iconoplasm.test${pathname}`)).status,
          599,
          pathname,
        )
      // The retained bytes hold the per-gene documents, so a containment deploy
      // serves a gene page from the asset layer at no Worker request.
      const genePage = await runtime.dispatchFetch("https://iconoplasm.test/gene/TP53")
      assert.equal(genePage.status, 200)
      assert.match(await genePage.text(), /<link rel="canonical" href="[^"]*\/gene\/TP53">/)
    } finally {
      await runtime?.dispose()
      await rm(temporaryRoot, { recursive: true, force: true })
    }
  },
)

// ARCHITECTURE FENCE [IPD-003]
// The crawler documents are static files built from catalog/v3/index.json; the
// Worker owns none of them, in production or during a containment deploy.
// Ways this can fail:
//  1. A stateful Worker entry (the runtime or the containment quarantine shell)
//     still imports something that no longer exists, so the Worker fails to
//     load and every /api route goes down with it.
//  2. robots.txt -> sitemap.xml no longer lists every catalog gene, or lists a
//     URL this host does not serve (/genes, /sitemaps/...), so a crawler either
//     misses genes or keeps fetching dead URLs.
//  3. An old /genes or /genes/<range> link (a search result, a backlink) lands
//     on a 404 or the bare app shell instead of a 301 to the Archive.
//  4. A request for /genes*, /robots.txt, /sitemap.xml or /llms.txt reaches the
//     Worker (or /sitemaps/* does, in production). That spends a metered
//     request per crawler fetch and answers with whatever the Worker does for
//     unknown paths. During containment every unknown path reaches the
//     quarantine shell by design; there a retired range sitemap must not read
//     D1, KV or storage.
//  5. During a containment deploy, robots.txt, sitemap.xml or llms.txt differ
//     from what production serves, so a crawler that visits mid-maintenance
//     indexes a sitemap or obeys a policy that disappears when the window closes.
//  6. A retired range-sitemap URL still answers 200 with XML, so a crawler
//     keeps polling a shard nobody maintains.
// The receipt lands in artifacts/b-898-discovery-static/ for the PR.
test(
  "crawler documents are static in production and in the containment deploy",
  { timeout: 60_000 },
  async () => {
    // 1
    for (const entry of [
      "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js",
      "./b742-quarantine-gene-shell-inside-the-only-allowed-stateful-worker-do-not-duplicate.js",
    ]) {
      const module = await import(entry)
      assert.equal(typeof module.default?.fetch, "function", `${entry} must export a fetch handler`)
    }

    const temporaryRoot = await mkdtemp(path.join(tmpdir(), "iconoplasm-crawler-"))
    const sourceRoot = path.join(temporaryRoot, "public")
    const outputRoot = path.join(temporaryRoot, "public-iconoplasm-edge")
    await mkdir(path.join(sourceRoot, "apps", "iconoplasm"), { recursive: true })
    await mkdir(path.join(sourceRoot, "static"), { recursive: true })
    for (const page of ["index", "privacy", "license", "caretaker-terms", "developers"])
      await writeFile(
        path.join(sourceRoot, "apps", "iconoplasm", `${page}.html`),
        "<!doctype html>",
      )
    await writeFile(path.join(sourceRoot, "favicon.ico"), "fixture")
    const catalogRows = [
      ["TP53", "tumor protein p53", "", "", 0],
      ["A1BG", "alpha-1-B glycoprotein", "", "", 0],
      ["ZNF25", "zinc finger protein 25", "", "", 0],
    ]
    await prepareIconoplasmEdgeAssets({ sourceRoot, outputRoot, publishedGenes: catalogRows })

    // 2
    const staticSitemap = await readFile(path.join(outputRoot, "sitemap.xml"), "utf8")
    const staticLlms = await readFile(path.join(outputRoot, "llms.txt"), "utf8")
    for (const [symbol] of catalogRows)
      assert.ok(
        staticSitemap.includes(`<loc>https://iconoplasm.brinedew.bio/gene/${symbol}</loc>`),
        `sitemap.xml must list ${symbol}`,
      )
    assert.doesNotMatch(staticSitemap, /\/sitemaps\/|\/genes\b/)
    const robots = await readFile(path.join(outputRoot, "robots.txt"), "utf8")
    assert.match(robots, /^Sitemap: https:\/\/iconoplasm\.brinedew\.bio\/sitemap\.xml$/m)
    assert.match(robots, /User-agent: GPTBot\nDisallow: \//)
    assert.match(robots, /User-agent: ClaudeBot\nDisallow: \//)

    const canonicalToml = await readFile(
      path.join(
        repoRoot,
        "wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml",
      ),
      "utf8",
    )
    const canonicalAssets = parseToml(canonicalToml).assets
    const containmentAssets = parseToml(prepareRetainedAssetsConfig(canonicalToml)).unsafe.metadata
      .assets.config
    const receipt = { generated_at: new Date().toISOString(), catalog_rows: 3, dispatches: [] }
    try {
      for (const [topology, assets] of [
        ["production", canonicalAssets],
        ["containment", containmentAssets],
      ]) {
        const runtime = new Miniflare(
          convertV4MiniflareOptions({
            name: `iconoplasm-crawler-documents-${topology}`,
            modules: true,
            script: `export default {fetch(){return new Response("stateful-worker",{status:599})}}`,
            compatibilityDate: "2026-08-01",
            assets: {
              directory: outputRoot,
              run_worker_first: assets.run_worker_first,
              routerConfig: { has_user_worker: true },
              assetConfig: { not_found_handling: assets.not_found_handling },
            },
          }),
        )
        try {
          for (const pathname of [
            "/genes",
            "/genes/",
            "/genes/TO-TR",
            "/sitemap.xml",
            "/sitemaps/pages.xml",
            "/sitemaps/genes/TO-TR.xml",
            "/llms.txt",
            "/robots.txt",
          ]) {
            const response = await runtime.dispatchFetch(`https://iconoplasm.test${pathname}`, {
              redirect: "manual",
            })
            const body = await response.text()
            const contentType = response.headers.get("content-type") || ""
            receipt.dispatches.push({
              topology,
              pathname,
              status: response.status,
              location: response.headers.get("location"),
              content_type: contentType,
              worker_invoked: response.status === 599,
            })
            // 4
            if (topology === "production" || !pathname.startsWith("/sitemaps/"))
              assert.notEqual(response.status, 599, `${topology} ${pathname} invoked the Worker`)
            // 3
            if (pathname.startsWith("/genes")) {
              assert.equal(response.status, 301, `${topology} ${pathname}`)
              assert.equal(
                new URL(response.headers.get("location"), "https://x.test").pathname,
                "/",
              )
            }
            // 2 and 5
            if (pathname === "/sitemap.xml") assert.equal(body, staticSitemap, topology)
            if (pathname === "/llms.txt") assert.equal(body, staticLlms, topology)
            if (pathname === "/robots.txt") assert.equal(body, robots, topology)
            // 6
            if (pathname.startsWith("/sitemaps/"))
              assert.doesNotMatch(contentType, /xml/, `${topology} ${pathname} answered XML`)
          }
        } finally {
          await runtime.dispose()
        }
      }
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true })
    }

    // 4 and 6 for the containment deploy: its not_found_handling is "none", so
    // every unknown path (the retired range sitemaps included) reaches the
    // quarantine shell. There they must read no D1, KV or storage binding and
    // must not answer XML.
    const { default: quarantineShell } =
      await import("./b742-quarantine-gene-shell-inside-the-only-allowed-stateful-worker-do-not-duplicate.js")
    const touchedBindings = new Set()
    const env = new Proxy(
      { ICONOPLASM_SCHEMA_TRANSITION: "1", ICONOPLASM_SCHEMA_TRANSITION_MODE: "reader-recovery" },
      {
        get(target, key) {
          if (typeof key === "string" && /DB$|^KV$|PORTRAITS|STORAGE_PASSWORD/.test(key))
            touchedBindings.add(key)
          return target[key]
        },
      },
    )
    const upstream = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (input) => {
      upstream.push(String(input?.url || input))
      return new Response("Not Found", { status: 404, headers: { "Content-Type": "text/html" } })
    }
    try {
      for (const pathname of ["/sitemaps/pages.xml", "/sitemaps/genes/TO-TR.xml"]) {
        const response = await quarantineShell.fetch(
          new Request(`https://iconoplasm.brinedew.bio${pathname}`),
          env,
          { waitUntil() {} },
        )
        const contentType = response.headers.get("content-type") || ""
        await response.body?.cancel()
        receipt.dispatches.push({
          topology: "containment-worker",
          pathname,
          status: response.status,
          content_type: contentType,
        })
        assert.equal(response.status, 404, pathname)
        assert.doesNotMatch(contentType, /xml/, pathname)
      }
    } finally {
      globalThis.fetch = originalFetch
    }
    assert.deepEqual([...touchedBindings], [])
    receipt.containment_worker_upstream = upstream

    const receiptDirectory = path.join(repoRoot, "artifacts", "b-898-discovery-static")
    await mkdir(receiptDirectory, { recursive: true })
    await writeFile(
      path.join(receiptDirectory, "crawler-documents-receipt.json"),
      `${JSON.stringify(receipt, null, 2)}\n`,
    )
  },
)

// B-818: iconoplasm.brinedew.bio has one URL convention, clean lowercase paths.
// Every older shape that something once linked answers a 301 to where it lives
// now. Ways this can fail:
//  1. An old shape answers 200 with the SPA homepage instead of a 301: the store
//     listings' privacy link (/apps/iconoplasm/privacy) shows a reviewer the
//     archive, and crawlers index another copy of "/".
//  2. /About.html is deleted or 404s instead of redirecting; an older extension
//     build or shared link that still points at it breaks. The same for /about, the
//     path the footer shared with the main site links to.
//  3. A redirect lands on a URL that redirects again or loops with the asset
//     layer's own .html handling.
//  4. A redirect captures a page this host serves (/privacy, /gene/TP53) or a
//     path the Worker owns (/api, /blot), changing what readers get there.
//  5. A redirect is answered by the Worker, spending a metered request, or
//     disappears in the containment deploy.
//  6. The query string is dropped, so a store or campaign link loses its tag.
test(
  "old URL shapes answer a static 301 to the one clean convention",
  { timeout: 60_000 },
  async () => {
    const { temporaryRoot, outputRoot } = await makeAssetFixture()
    const canonicalToml = await readFile(
      path.join(
        repoRoot,
        "wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml",
      ),
      "utf8",
    )
    const moved = [
      ["/About.html", "https://brinedew.bio/about"],
      // B-906: the footer shared with the main site links /about.
      ["/about", "https://brinedew.bio/about"],
      ["/apps/iconoplasm", "/"],
      ["/apps/iconoplasm/", "/"],
      ["/apps/iconoplasm/privacy", "/privacy"],
      [
        "/apps/iconoplasm/privacy?utm_source=chrome-web-store",
        "/privacy?utm_source=chrome-web-store",
      ],
      ["/apps/iconoplasm/license", "/license"],
      ["/apps/iconoplasm/caretaker-terms", "/caretaker-terms"],
      ["/apps/iconoplasm/developers", "/developers"],
      ["/apps/iconoplasm/clans", "/clans"],
      ["/Iconoplasm", "/"],
      ["/Iconoplasm.html", "/"],
      [
        "/wiki/Tutorial-How-to-generate-and-edit-blots-in-Iconoplasm",
        "https://brinedew.bio/wiki/tutorial-how-to-generate-and-edit-blots-in-iconoplasm",
      ],
      ["/wiki/cellular-senescence", "https://brinedew.bio/wiki/cellular-senescence"],
      ["/posts", "https://brinedew.bio/posts"],
      ["/posts/support-me", "https://brinedew.bio/posts/support-me"],
    ]
    const served = ["/", "/privacy", "/license", "/caretaker-terms", "/developers", "/gene/TP53"]
    const receipt = { generated_at: new Date().toISOString(), dispatches: [] }
    try {
      for (const [topology, assets] of [
        ["production", parseToml(canonicalToml).assets],
        [
          "containment",
          parseToml(prepareRetainedAssetsConfig(canonicalToml)).unsafe.metadata.assets.config,
        ],
      ]) {
        const runtime = new Miniflare(
          convertV4MiniflareOptions({
            name: `iconoplasm-moved-paths-${topology}`,
            modules: true,
            script: `export default {fetch(){return new Response("stateful-worker",{status:599})}}`,
            compatibilityDate: "2026-08-01",
            assets: {
              directory: outputRoot,
              run_worker_first: assets.run_worker_first,
              routerConfig: { has_user_worker: true },
              assetConfig: { not_found_handling: assets.not_found_handling },
            },
          }),
        )
        try {
          for (const [pathname, target] of moved) {
            const response = await runtime.dispatchFetch(`https://iconoplasm.test${pathname}`, {
              redirect: "manual",
            })
            await response.text()
            const location = response.headers.get("location")
            receipt.dispatches.push({ topology, pathname, status: response.status, location })
            // 1, 2, 5 and 6
            assert.equal(response.status, 301, `${topology} ${pathname}`)
            assert.equal(location, target, `${topology} ${pathname}`)
            // 3: a same-host target is a page, not another redirect
            if (target.startsWith("/")) {
              const landed = await runtime.dispatchFetch(`https://iconoplasm.test${target}`, {
                redirect: "manual",
              })
              await landed.text()
              assert.ok(landed.status < 300 || landed.status > 399, `${topology} ${target}`)
              if (topology === "production") assert.equal(landed.status, 200, target)
            }
          }
          // 4
          for (const pathname of served) {
            const response = await runtime.dispatchFetch(`https://iconoplasm.test${pathname}`, {
              redirect: "manual",
            })
            await response.text()
            assert.equal(response.status, 200, `${topology} ${pathname}`)
          }
          for (const pathname of ["/api/auth/me", "/blot/TP53.webp"]) {
            const response = await runtime.dispatchFetch(`https://iconoplasm.test${pathname}`, {
              redirect: "manual",
            })
            await response.text()
            assert.equal(response.status, 599, `${topology} ${pathname} stays Worker-owned`)
          }
        } finally {
          await runtime.dispose()
        }
      }
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true })
    }
    const receiptDirectory = path.join(repoRoot, "artifacts", "b818")
    await mkdir(receiptDirectory, { recursive: true })
    await writeFile(
      path.join(receiptDirectory, "moved-paths-receipt.json"),
      `${JSON.stringify(receipt, null, 2)}\n`,
    )
  },
)

test(
  "the exact production build and Wrangler config sample anonymous route ownership",
  { timeout: 120_000 },
  async () => {
    const proof = await proveAnonymousRouteTopology()
    assert.equal(proof.kind, "exact_build_topology_proof")
    assert.equal(proof.assetRoot, "public-iconoplasm-edge")
    assert.equal(
      proof.wranglerConfig,
      "wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml",
    )
    assert.ok(proof.physicalDispatches > 0)
    assert.equal(proof.logicalDispatches, undefined)
    assert.ok(proof.routeClasses.some((route) => route.startsWith("/portraits/v1/")))
    assert.equal(proof.statefulWorkerRouteEvents, 3)
    assert.equal(proof.unexpectedStatefulWorkerRouteEvents, 0)
    assert.equal(proof.verified, true)
  },
)

test("the topology proof rejects an asset build from another commit", async () => {
  await assert.rejects(
    proveAnonymousRouteTopology({ expectedCommit: "f".repeat(40) }),
    /STALE_PRODUCTION_STATIC_BUILD/,
  )
})
