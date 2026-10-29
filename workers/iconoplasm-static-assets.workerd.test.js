import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createRequire } from "node:module"
import test from "node:test"
import { parse as parseToml } from "toml"
import { prepareIconoplasmEdgeAssets } from "../scripts/prepare-iconoplasm-edge-assets.mjs"
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
  await mkdir(path.join(sourceRoot, "apps", "iconoplasm", "docs"), { recursive: true })
  for (const page of [
    "index",
    "privacy",
    "license",
    "caretaker-terms",
    "developers",
    "docs/index",
    "docs/request-a-new-portrait",
  ])
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

// The Worker's own pages. Exact paths only: nothing else under /admin, /blocklist or
// /artist-styles has a handler, so a scanner's guess must not cost a Worker request.
const WORKER_OWNED_PAGES = [
  "/admin",
  "/admin/iconoplasm",
  "/admin/iconoplasm/",
  "/blocklist",
  "/blocklist/",
  "/artist-styles",
  "/artist-styles/",
  "/health",
]
const SCANNER_GUESSES = [
  "/admin/login",
  "/admin/.env",
  "/admin.php",
  "/administrator",
  "/blocklist-x",
  "/blocklist/x",
  "/artist-stylesx",
  "/artist-styles/x",
]

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
      for (const pathname of WORKER_OWNED_PAGES)
        assert.equal(
          (
            await runtime.dispatchFetch(`https://iconoplasm.test${pathname}`, {
              redirect: "manual",
            })
          ).status,
          599,
          `${pathname} is a Worker page`,
        )
      for (const pathname of SCANNER_GUESSES) {
        const response = await runtime.dispatchFetch(`https://iconoplasm.test${pathname}`)
        assert.equal(response.status, 404, `${pathname} is the asset layer's 404, not the Worker`)
      }
      for (const method of ["GET", "HEAD"]) {
        const blotResponse = await runtime.dispatchFetch("https://iconoplasm.test/blot/TP53.webp", {
          method,
          redirect: "manual",
        })
        assert.equal(blotResponse.status, 599, "the exact blot handler owns the mutable alias")
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

// ARCHITECTURE FENCE [IPD-003]
// The crawler documents are static files built from catalog/v3/index.json; the
// Worker owns none of them.
// Ways this can fail:
//  1. The stateful Worker runtime still imports something that no longer
//     exists, so the Worker fails to load and every /api route goes down with it.
//  2. robots.txt -> sitemap.xml no longer lists every catalog gene and the
//     /genes letter pages, or lists a URL this host does not serve
//     (/sitemaps/...), so a crawler either misses genes or keeps fetching dead URLs.
//  3. /genes or /genes/<letter> (B-1098: where agents and readers look for the
//     whole list) answers anything but a static page linking every gene, or an
//     old /genes/<range> address answers 200 under a URL nobody publishes.
//  4. A request for /genes, /genes/<letter>, /genes/<range>, /robots.txt,
//     /sitemap.xml, /sitemaps/* or /llms.txt reaches the Worker. That spends a
//     metered request per crawler fetch and answers with whatever the Worker
//     does for unknown paths.
//  5. The served robots.txt, sitemap.xml or llms.txt differ from the built files.
//  6. A retired range-sitemap URL still answers 200 with XML, so a crawler
//     keeps polling a shard nobody maintains.
// The receipt lands in artifacts/b-898-discovery-static/ for the PR.
test("crawler documents are static files the Worker never sees", { timeout: 60_000 }, async () => {
  // 1
  const runtimeModule =
    await import("./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js")
  assert.equal(typeof runtimeModule.default?.fetch, "function", "the runtime must export fetch")

  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "iconoplasm-crawler-"))
  const sourceRoot = path.join(temporaryRoot, "public")
  const outputRoot = path.join(temporaryRoot, "public-iconoplasm-edge")
  await mkdir(path.join(sourceRoot, "apps", "iconoplasm"), { recursive: true })
  await mkdir(path.join(sourceRoot, "static"), { recursive: true })
  for (const page of ["index", "privacy", "license", "caretaker-terms", "developers"])
    await writeFile(path.join(sourceRoot, "apps", "iconoplasm", `${page}.html`), "<!doctype html>")
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
  assert.doesNotMatch(staticSitemap, /\/sitemaps\//)
  for (const pathname of ["/genes", "/genes/T", "/genes/A", "/genes/Z"])
    assert.ok(
      staticSitemap.includes(`<loc>https://iconoplasm.brinedew.bio${pathname}</loc>`),
      `sitemap.xml must list ${pathname}`,
    )
  const robots = await readFile(path.join(outputRoot, "robots.txt"), "utf8")
  assert.match(robots, /^Sitemap: https:\/\/iconoplasm\.brinedew\.bio\/sitemap\.xml$/m)
  assert.match(robots, /User-agent: GPTBot\nDisallow: \//)
  assert.match(robots, /User-agent: ClaudeBot\nDisallow: \//)

  const assets = parseToml(
    await readFile(
      path.join(
        repoRoot,
        "wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml",
      ),
      "utf8",
    ),
  ).assets
  const receipt = { generated_at: new Date().toISOString(), catalog_rows: 3, dispatches: [] }
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      name: "iconoplasm-crawler-documents",
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
      "/genes/T",
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
        pathname,
        status: response.status,
        location: response.headers.get("location"),
        content_type: contentType,
        worker_invoked: response.status === 599,
      })
      // 4
      assert.notEqual(response.status, 599, `${pathname} invoked the Worker`)
      // 3
      if (pathname === "/genes") {
        assert.equal(response.status, 200, pathname)
        assert.match(contentType, /html/)
        assert.match(body, /href="\/genes\/T"/)
        assert.match(body, /href="\/caretakers"/)
      }
      if (pathname === "/genes/T") {
        assert.equal(response.status, 200, pathname)
        assert.match(body, /href="\/gene\/TP53"/)
        assert.doesNotMatch(body, /\/gene\/A1BG/)
      }
      if (pathname === "/genes/TO-TR") assert.equal(response.status, 404, pathname)
      // 2 and 5
      if (pathname === "/sitemap.xml") assert.equal(body, staticSitemap)
      if (pathname === "/llms.txt") assert.equal(body, staticLlms)
      if (pathname === "/robots.txt") assert.equal(body, robots)
      // 6
      if (pathname.startsWith("/sitemaps/"))
        assert.doesNotMatch(contentType, /xml/, `${pathname} answered XML`)
    }
  } finally {
    await runtime.dispose()
    await rm(temporaryRoot, { recursive: true, force: true })
  }

  const receiptDirectory = path.join(repoRoot, "artifacts", "b-898-discovery-static")
  await mkdir(receiptDirectory, { recursive: true })
  await writeFile(
    path.join(receiptDirectory, "crawler-documents-receipt.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
  )
})

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
//  5. A redirect is answered by the Worker, spending a metered request.
//  6. The query string is dropped, so a store or campaign link loses its tag.
test(
  "old URL shapes answer a static 301 to the one clean convention",
  { timeout: 60_000 },
  async () => {
    const { temporaryRoot, outputRoot } = await makeAssetFixture()
    const assets = parseToml(
      await readFile(
        path.join(
          repoRoot,
          "wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml",
        ),
        "utf8",
      ),
    ).assets
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
        "/docs/request-a-new-portrait",
      ],
      ["/docs/tutorial", "/docs/request-a-new-portrait"],
      ["/wiki/cellular-senescence", "https://brinedew.bio/wiki/cellular-senescence"],
      ["/posts", "https://brinedew.bio/posts"],
      ["/posts/support-me", "https://brinedew.bio/posts/support-me"],
    ]
    const served = [
      "/",
      "/privacy",
      "/license",
      "/caretaker-terms",
      "/developers",
      "/docs",
      "/docs/request-a-new-portrait",
      "/gene/TP53",
    ]
    const receipt = { generated_at: new Date().toISOString(), dispatches: [] }
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        name: "iconoplasm-moved-paths",
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
        receipt.dispatches.push({ pathname, status: response.status, location })
        // 1, 2, 5 and 6
        assert.equal(response.status, 301, pathname)
        assert.equal(location, target, pathname)
        // 3: a same-host target is a page, not another redirect
        if (target.startsWith("/")) {
          const landed = await runtime.dispatchFetch(`https://iconoplasm.test${target}`, {
            redirect: "manual",
          })
          await landed.text()
          assert.equal(landed.status, 200, target)
        }
      }
      // 4
      for (const pathname of served) {
        const response = await runtime.dispatchFetch(`https://iconoplasm.test${pathname}`, {
          redirect: "manual",
        })
        await response.text()
        assert.equal(response.status, 200, pathname)
      }
      for (const pathname of ["/api/auth/me", "/blot/TP53.webp"]) {
        const response = await runtime.dispatchFetch(`https://iconoplasm.test${pathname}`, {
          redirect: "manual",
        })
        await response.text()
        assert.equal(response.status, 599, `${pathname} stays Worker-owned`)
      }
    } finally {
      await runtime.dispose()
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

// The edge ignores query strings, so a script's address must carry its hash in
// the name (scripts/lib/iconoplasm-hashed-modules.mjs). Ways this can fail:
//  1. A versioned name answers bytes whose hash is not the name's.
//  2. A module imports another by a name that the bundle does not serve, or by
//     the unversioned name (a second copy of that module's state).
//  3. An unversioned script, a vendor file or a font is cached as immutable,
//     so a returning reader keeps an old copy for a year.
//  4. Two rules both set Cache-Control and the response carries both values
//     (measured live on 2026-10-29: three values on every module).
//  5. A page still loads a script by its unversioned name.
test(
  "scripts load under their hashes, and only those names are immutable",
  { timeout: 60_000 },
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
          name: "iconoplasm-versioned-modules-test",
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
      const get = (pathname) => runtime.dispatchFetch(`https://iconoplasm.test${pathname}`)
      const IMMUTABLE = "public, max-age=31536000, immutable"
      const home = await (await get("/")).text()
      const entry = home.match(/\/static\/iconoplasm\/app\.([0-9a-f]{16})\.js/)
      assert.ok(entry, "the home page loads app.js by its versioned name")
      assert.doesNotMatch(home, /static\/iconoplasm\/app\.js/, "no unversioned app.js left")

      // Walk the whole graph the entry reaches, as a browser would.
      const seen = new Set()
      const queue = [entry[0]]
      while (queue.length) {
        const pathname = queue.shift()
        if (seen.has(pathname)) continue
        seen.add(pathname)
        const response = await get(pathname)
        assert.equal(response.status, 200, `${pathname} is served`)
        assert.equal(response.headers.get("cache-control"), IMMUTABLE, pathname)
        const bytes = Buffer.from(await response.arrayBuffer())
        const hash = pathname.match(/\.([0-9a-f]{16})\.(?:js|css)$/)[1]
        assert.equal(
          createHash("sha256").update(bytes).digest("hex").slice(0, 16),
          hash,
          `${pathname} answers the bytes its name names`,
        )
        for (const match of bytes
          .toString("utf8")
          .matchAll(/["'`]((?:\.{1,2}\/)[^"'`\s?#$]*\.(?:js|css))(\?v=[^"'`]*)?["'`]/g)) {
          const target = new URL(match[1], `https://iconoplasm.test${pathname}`).pathname
          if (target.includes("/vendor/") || !target.startsWith("/static/iconoplasm/")) continue
          if (/\.[0-9a-f]{16}\.(?:js|css)$/.test(target)) {
            queue.push(target)
            continue
          }
          // A bundled library's own strings (X6's "./worker.js") name no file here.
          await assert.rejects(
            stat(path.join(outputRoot, target)),
            `${pathname} imports the unversioned ${target}`,
          )
        }
      }
      assert.ok(seen.size > 20, `the entry reaches the app's modules (${seen.size})`)
      assert.ok(
        [...seen].some((pathname) => pathname.includes("/caretaker-manifestations.")),
        "the caretaker panel is part of the graph",
      )

      const unversioned = await get("/static/iconoplasm/app.js")
      assert.equal(unversioned.status, 200)
      assert.equal(unversioned.headers.get("cache-control"), "public, max-age=0, must-revalidate")
      assert.equal(
        await unversioned.text(),
        await (await get(entry[0])).text(),
        "the unversioned copy imports the same versioned graph",
      )
      for (const [pathname, expected] of [
        ["/static/iconoplasm/styles.css", "public, max-age=0, must-revalidate"],
        ["/static/iconoplasm/vendor/shoelace/cdn/shoelace-autoloader.js", "public, max-age=86400"],
        ["/static/iconoplasm/fonts/IBMPlexMono-Regular.woff2", "public, max-age=86400"],
      ]) {
        const response = await get(pathname)
        assert.equal(response.status, 200, pathname)
        assert.equal(response.headers.get("cache-control"), expected, pathname)
      }
    } finally {
      await runtime?.dispose()
      await rm(temporaryRoot, { recursive: true, force: true })
    }
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
