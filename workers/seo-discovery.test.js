import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test, { afterEach } from "node:test"

import worker, {
  rewriteIconoplasmGeneDiscoveryMetadata,
} from "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"
import { resolvePostAuthAppUrl } from "./auth.js"

const originalFetch = globalThis.fetch
const rootRobotsSource = new URL("../content/robots.txt", import.meta.url)
const appsIndexSource = new URL("../content/apps/index.md", import.meta.url)
const geneguessrStaticAppSource = new URL("../quartz/static/geneguessr/app.js", import.meta.url)
const headComponentSource = new URL("../quartz/components/Head.tsx", import.meta.url)
const deployWorkflowSource = new URL("../.github/workflows/deploy-quartz.yml", import.meta.url)
const publicWorkerWranglerSource = new URL("../wrangler.toml", import.meta.url)

afterEach(() => {
  globalThis.fetch = originalFetch
})

function htmlResponse(body) {
  return new Response(body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
    },
  })
}

test("apex robots source stays standards-only", async () => {
  const text = await readFile(rootRobotsSource, "utf8")

  assert.match(text, /User-agent: \*/)
  assert.match(text, /Sitemap: https:\/\/brinedew\.bio\/sitemap\.xml/)
  assert.doesNotMatch(text, /\bsearch:\s*yes\b/)
  assert.doesNotMatch(text, /\bai-input:\s*yes\b/)
  assert.doesNotMatch(text, /\bai-train:\s*yes\b/)
  assert.doesNotMatch(text, /\bCrawl-delay\b/i)
})

test("www host is routed and permanently canonicalized to the apex host", async () => {
  const [workflow, wrangler] = await Promise.all([
    readFile(deployWorkflowSource, "utf8"),
    readFile(publicWorkerWranglerSource, "utf8"),
  ])

  assert.match(workflow, /"www\.brinedew\.bio\/\*"/)
  assert.match(wrangler, /pattern = "www\.brinedew\.bio\/\*"/)

  globalThis.fetch = async () => {
    throw new Error("www canonical redirect must not proxy duplicate static HTML")
  }

  const response = await worker.fetch(
    new Request("https://www.brinedew.bio/posts/example?utm_source=test"),
    {},
    {},
  )

  assert.equal(response.status, 301)
  assert.equal(
    response.headers.get("location"),
    "https://brinedew.bio/posts/example?utm_source=test",
  )
})

test("GeneGuessr canonical subdomain owns public app URLs", async () => {
  const [appsIndex, geneguessrStaticApp, headComponent] = await Promise.all([
    readFile(appsIndexSource, "utf8"),
    readFile(geneguessrStaticAppSource, "utf8"),
    readFile(headComponentSource, "utf8"),
  ])

  assert.match(appsIndex, /\]\(https:\/\/geneguessr\.brinedew\.bio\/\)/)
  assert.doesNotMatch(appsIndex, /\]\(\/apps\/geneguessr\/?\)/)
  assert.doesNotMatch(geneguessrStaticApp, /https:\/\/brinedew\.bio\/apps\/geneguessr\/(?!render)/)
  assert.match(headComponent, /host === "geneguessr\.brinedew\.bio" \? "\/privacy"/)
  assert.doesNotMatch(
    headComponent,
    /host === "geneguessr\.brinedew\.bio" \? "\/apps\/geneguessr\/privacy"/,
  )
  assert.equal(
    resolvePostAuthAppUrl(new URL("https://geneguessr.brinedew.bio/api/auth/callback"), ""),
    "https://geneguessr.brinedew.bio/",
  )
  // Apex auth stays on the apex blog site (not the older "redirect to geneguessr" default).
  // Each subdomain is its own app; users who log in from brinedew.bio land back on brinedew.bio.
  assert.equal(
    resolvePostAuthAppUrl(new URL("https://brinedew.bio/api/auth/callback"), ""),
    "https://brinedew.bio/",
  )

  globalThis.fetch = async () => {
    throw new Error("apex GeneGuessr app duplicates must redirect instead of proxying static HTML")
  }

  for (const [path, location] of [
    ["/apps/geneguessr", "https://geneguessr.brinedew.bio/?utm_source=chatgpt"],
    ["/apps/geneguessr/", "https://geneguessr.brinedew.bio/?utm_source=chatgpt"],
    ["/apps/geneguessr/index", "https://geneguessr.brinedew.bio/?utm_source=chatgpt"],
    ["/apps/geneguessr/index/", "https://geneguessr.brinedew.bio/?utm_source=chatgpt"],
    ["/apps/geneguessr/privacy", "https://geneguessr.brinedew.bio/privacy?utm_source=chatgpt"],
    ["/apps/geneguessr/privacy/", "https://geneguessr.brinedew.bio/privacy?utm_source=chatgpt"],
  ]) {
    const response = await worker.fetch(
      new Request(`https://brinedew.bio${path}?utm_source=chatgpt`),
      {},
      {},
    )

    assert.equal(response.status, 301, path)
    assert.equal(response.headers.get("location"), location, path)
  }
})

test("Iconoplasm exposes host-scoped robots, sitemap, and llms files without gene pages", async () => {
  const robots = await worker.fetch(
    new Request("https://iconoplasm.brinedew.bio/robots.txt"),
    {},
    {},
  )
  const robotsText = await robots.text()

  assert.equal(robots.status, 200)
  assert.match(robots.headers.get("content-type") || "", /text\/plain/)
  assert.match(robotsText, /Sitemap: https:\/\/iconoplasm\.brinedew\.bio\/sitemap\.xml/)
  assert.doesNotMatch(robotsText, /\bsearch:\s*yes\b/)
  assert.doesNotMatch(robotsText, /\bCrawl-delay\b/i)

  const sitemap = await worker.fetch(
    new Request("https://iconoplasm.brinedew.bio/sitemap.xml"),
    {},
    {},
  )
  const sitemapText = await sitemap.text()

  assert.equal(sitemap.status, 200)
  assert.match(sitemap.headers.get("content-type") || "", /application\/xml/)
  assert.match(sitemapText, /<loc>https:\/\/iconoplasm\.brinedew\.bio\/<\/loc>/)
  assert.match(sitemapText, /<loc>https:\/\/iconoplasm\.brinedew\.bio\/privacy<\/loc>/)
  assert.doesNotMatch(sitemapText, /brinedew\.bio\/posts\//)
  assert.doesNotMatch(sitemapText, /\/gene\/TP53/)

  const llms = await worker.fetch(new Request("https://iconoplasm.brinedew.bio/llms.txt"), {}, {})
  const llmsText = await llms.text()

  assert.equal(llms.status, 200)
  assert.match(llms.headers.get("content-type") || "", /text\/plain/)
  assert.match(llmsText, /^# Iconoplasm/m)
  assert.match(llmsText, /https:\/\/iconoplasm\.brinedew\.bio\/privacy/)
  assert.doesNotMatch(llmsText, /\/gene\//)
})

test("subdomain privacy pages use the short canonical privacy URL", async () => {
  globalThis.fetch = async (url) => {
    const requestUrl = new URL(String(url))
    assert.equal(requestUrl.pathname, "/apps/iconoplasm/privacy")
    return htmlResponse(`<!doctype html>
<html>
  <head>
    <title>Privacy Policy - Iconoplasm</title>
    <link rel="canonical" href="https://iconoplasm.brinedew.bio/privacy">
    <meta property="og:url" content="https://iconoplasm.brinedew.bio/privacy">
    <meta name="twitter:url" content="https://iconoplasm.brinedew.bio/privacy">
  </head>
  <body>privacy</body>
</html>`)
  }

  const response = await worker.fetch(
    new Request("https://iconoplasm.brinedew.bio/privacy"),
    {},
    {},
  )
  const html = await response.text()

  assert.equal(response.status, 200)
  assert.match(html, /https:\/\/iconoplasm\.brinedew\.bio\/privacy/)

  const legacy = await worker.fetch(
    new Request("https://iconoplasm.brinedew.bio/apps/iconoplasm/privacy"),
    {},
    {},
  )
  assert.equal(legacy.status, 301)
  assert.equal(legacy.headers.get("location"), "https://iconoplasm.brinedew.bio/privacy")
})

test("GeneGuessr exposes short privacy canonical and host sitemap", async () => {
  globalThis.fetch = async (url) => {
    const requestUrl = new URL(String(url))
    assert.equal(requestUrl.pathname, "/apps/geneguessr/privacy")
    return htmlResponse(`<!doctype html>
<html>
  <head>
    <title>Privacy Policy - GeneGuessr</title>
    <link rel="canonical" href="https://geneguessr.brinedew.bio/privacy">
    <meta property="og:url" content="https://geneguessr.brinedew.bio/privacy">
    <meta name="twitter:url" content="https://geneguessr.brinedew.bio/privacy">
  </head>
  <body>privacy</body>
</html>`)
  }

  const sitemap = await worker.fetch(
    new Request("https://geneguessr.brinedew.bio/sitemap.xml"),
    {},
    {},
  )
  const sitemapText = await sitemap.text()

  assert.match(sitemapText, /<loc>https:\/\/geneguessr\.brinedew\.bio\/privacy<\/loc>/)
  assert.doesNotMatch(sitemapText, /\/apps\/geneguessr\/privacy/)

  const response = await worker.fetch(
    new Request("https://geneguessr.brinedew.bio/privacy"),
    {},
    {},
  )
  const html = await response.text()

  assert.equal(response.status, 200)
  assert.match(html, /https:\/\/geneguessr\.brinedew\.bio\/privacy/)

  const legacy = await worker.fetch(
    new Request("https://geneguessr.brinedew.bio/apps/geneguessr/privacy"),
    {},
    {},
  )
  assert.equal(legacy.status, 301)
  assert.equal(legacy.headers.get("location"), "https://geneguessr.brinedew.bio/privacy")
})

// ARCHITECTURE FENCE [IPD-002]
test("Iconoplasm gene shells are noindex until they have standalone explanatory content", async () => {
  const html = rewriteIconoplasmGeneDiscoveryMetadata(
    `<!doctype html>
<html>
  <head>
    <title>Iconoplasm - Mnemonics for genes</title>
    <meta name="description" content="Browse gene personas">
    <meta name="robots" content="index,follow">
    <link rel="canonical" href="https://iconoplasm.brinedew.bio/">
    <meta property="og:url" content="https://iconoplasm.brinedew.bio/">
    <meta name="twitter:url" content="https://iconoplasm.brinedew.bio/">
    <script type="application/ld+json">{"@type":"SoftwareApplication"}</script>
  </head>
  <body></body>
</html>`,
    "/gene/TP53",
  )

  assert.match(html, /<title>TP53 - Iconoplasm gene card<\/title>/)
  assert.match(html, /<meta name="robots" content="noindex,follow,noarchive">/)
  assert.match(
    html,
    /<link rel="canonical" href="https:\/\/iconoplasm\.brinedew\.bio\/gene\/TP53">/,
  )
  assert.doesNotMatch(html, /SoftwareApplication/)

  globalThis.fetch = async (url) => {
    const requestUrl = new URL(String(url))
    assert.equal(requestUrl.pathname, "/apps/iconoplasm/index")
    return htmlResponse(`<!doctype html>
<html>
  <head>
    <title>Iconoplasm - Mnemonics for genes</title>
    <meta name="robots" content="index,follow">
  </head>
  <body><div id="iconoplasm-root"></div></body>
</html>`)
  }

  const response = await worker.fetch(
    new Request("https://iconoplasm.brinedew.bio/gene/TP53"),
    {},
    { waitUntil() {} },
  )
  const responseHtml = await response.text()

  assert.equal(response.headers.get("x-robots-tag"), "noindex, follow, noarchive")
  assert.match(responseHtml, /<meta name="robots" content="noindex,follow,noarchive">/)
})
