import { createHash } from "node:crypto"
import { copyFile, cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { ICONOPLASM_SERVICE_DISCOVERY_LINKS } from "../workers/iconoplasm-service-discovery.js"
import { iconoplasmGenePageTitle } from "../quartz/static/iconoplasm/page-title.js"

// ARCHITECTURE FENCE [IPD-007]: this bundle is the static half of the
// Iconoplasm failure boundary. Keep its security headers and platform-limit
// validation coupled to direct route ownership; do not replace it with a
// Worker-side cache that still consumes one invocation per file.
// ARCHITECTURE FENCE [IPD-003]: sitemap membership and the per-gene documents
// come from catalog/v3/index.json at build time, never a runtime scan. They are
// as fresh as the last deploy.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const publicRoot = path.join(repoRoot, "public")
const targetRoot = path.join(repoRoot, "public-iconoplasm-edge")
const maxAssetFiles = 20_000
// B-905: tests sit beside the browser modules under quartz/static and the Quartz
// Static emitter (quartz/plugins/emitters/static.ts) leaves them out. A test file
// in the bundle is one of its 20,000 files and public test code, so the build
// refuses it instead of shipping it.
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/
const maxAssetBytes = 25 * 1024 * 1024

const iconoplasmCsp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob: https://cdn.discordapp.com https://iconoplasmportraits.b-cdn.net",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://challenges.cloudflare.com https://static.cloudflareinsights.com",
  "connect-src 'self' data: https://brinedew.bio https://geneguessr.brinedew.bio https://iconoplasm.brinedew.bio https://iconoplasmportraits.b-cdn.net https://challenges.cloudflare.com https://cloudflareinsights.com",
  "frame-src 'self' https://brinedew.bio https://www.youtube.com https://www.youtube-nocookie.com https://challenges.cloudflare.com",
  "worker-src 'self' blob:",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join("; ")

const serviceDiscoveryHeaders = ICONOPLASM_SERVICE_DISCOVERY_LINKS.map(
  (link) => `  Link: ${link}`,
).join("\n")

const headersFile = `/*
  Content-Security-Policy: ${iconoplasmCsp}
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Resource-Policy: same-site
  Permissions-Policy: accelerometer=(), autoplay=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), browsing-topics=()
  Referrer-Policy: strict-origin-when-cross-origin
  Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
${serviceDiscoveryHeaders}

/
  Cache-Control: public, max-age=0, must-revalidate, no-transform

/privacy
  Cache-Control: public, max-age=0, must-revalidate, no-transform

/license
  Cache-Control: public, max-age=0, must-revalidate, no-transform

/caretaker-terms
  Cache-Control: public, max-age=0, must-revalidate, no-transform

/developers
  Cache-Control: public, max-age=0, must-revalidate, no-transform

/static/iconoplasm/*
  Cache-Control: public, max-age=31536000, immutable

/static/*
  Cache-Control: public, max-age=86400

/*.css
  Cache-Control: public, max-age=31536000, immutable

/*.js
  Cache-Control: public, max-age=31536000, immutable
`

const iconoplasmRobots = `# Model-training crawlers are blocked (also at the edge, see
# cloudflare/iconoplasm-crawler-policy.json). AI search crawlers and fetches
# made on a user's behalf (OAI-SearchBot, Claude-SearchBot, PerplexityBot,
# ChatGPT-User, Claude-User) are welcome. Card images are CC0; see /license.
User-agent: GPTBot
Disallow: /

User-agent: ClaudeBot
Disallow: /

User-agent: *
Allow: /
Disallow: /api/

Sitemap: https://iconoplasm.brinedew.bio/sitemap.xml
`

const SYMBOL = /^[A-Z0-9][A-Z0-9._-]{0,63}$/

// B-898: the build reads the one stable catalog object, catalog/v3/index.json
// (schema 3, one row per gene: [symbol, full_name, ...]). publishedGenes is that
// rows array. B-908: row[1] is the gene's HGNC name, the same string the stable
// gene object carries (workers/lib/iconoplasm-gene-name.js), so a document's
// title is the title its loaded card sets.
function publishedGeneRows(publishedGenes = []) {
  if (!Array.isArray(publishedGenes)) throw new Error("Invalid published catalog rows")
  return publishedGenes.map((row) => {
    if (!Array.isArray(row)) throw new Error("Invalid published catalog row")
    const symbol = String(row[0] || "")
      .trim()
      .toUpperCase()
    if (!SYMBOL.test(symbol)) throw new Error("Invalid published gene symbol")
    return [symbol, String(row[1] || "").trim()]
  })
}

function publicationSymbols(publishedGenes = []) {
  const symbols = new Set()
  for (const [symbol] of publishedGeneRows(publishedGenes)) {
    if (symbols.has(symbol)) throw new Error(`Duplicate published gene symbol: ${symbol}`)
    symbols.add(symbol)
  }
  return [...symbols].sort((left, right) => left.localeCompare(right))
}

function iconoplasmSitemap(symbols) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://iconoplasm.brinedew.bio/</loc></url>
${symbols
  .map(
    (symbol) =>
      `  <url><loc>https://iconoplasm.brinedew.bio/gene/${encodeURIComponent(symbol)}</loc></url>`,
  )
  .join("\n")}
  <url><loc>https://iconoplasm.brinedew.bio/privacy</loc></url>
  <url><loc>https://iconoplasm.brinedew.bio/license</loc></url>
  <url><loc>https://iconoplasm.brinedew.bio/developers</loc></url>
</urlset>
`
}

const iconoplasmLlms = `# Iconoplasm

Iconoplasm maps human-gene biology onto memorable visual character cards called blots.

- [Published gene-card archive](https://iconoplasm.brinedew.bio/)
- [Sitemap](https://iconoplasm.brinedew.bio/sitemap.xml)
- Gene profile: https://iconoplasm.brinedew.bio/gene/{HGNC_SYMBOL}
- Canonical gene blot: https://iconoplasm.brinedew.bio/blot/{HGNC_SYMBOL}.webp
- [For developers](https://iconoplasm.brinedew.bio/developers): resolving aliases and batches, and the OpenAPI document
`

// B-818: this host has one URL convention, clean lowercase paths (a gene page
// keeps its HGNC symbol's case). Each older shape that something once linked
// (a store listing, the Quartz nav, a page built for the main site) answers a
// 301 to where it lives now. The static asset layer answers these before the
// SPA fallback, so they cost no Worker request; matching is case-sensitive and
// keeps the query string (measured in workerd). The same table rewrites those
// links inside the Quartz pages below, so a page never links through a redirect.
const MAIN_SITE_ORIGIN = "https://brinedew.bio"
export const ICONOPLASM_MOVED_PATHS = Object.freeze([
  ["/About.html", `${MAIN_SITE_ORIGIN}/about`],
  // The footer these Quartz pages share with the main site links /about.
  ["/about", `${MAIN_SITE_ORIGIN}/about`],
  ["/Iconoplasm", "/"],
  ["/Iconoplasm.html", "/"],
  ["/apps/iconoplasm", "/"],
  ["/posts", `${MAIN_SITE_ORIGIN}/posts`],
  [
    "/wiki/Tutorial-How-to-generate-and-edit-blots-in-Iconoplasm",
    `${MAIN_SITE_ORIGIN}/wiki/tutorial-how-to-generate-and-edit-blots-in-iconoplasm`,
  ],
])
export const ICONOPLASM_MOVED_PREFIXES = Object.freeze([
  ["/apps/iconoplasm/", "/"],
  ["/posts/", `${MAIN_SITE_ORIGIN}/posts/`],
  ["/wiki/", `${MAIN_SITE_ORIGIN}/wiki/`],
])

// Static rules come before splats; the first matching line wins. Keep
// /portraits/* out of Static Assets redirects: those canonical URLs must reach
// the existing Bunny-backed Worker when a browser cannot reach the CDN.
export const ICONOPLASM_REDIRECTS = `${[
  "/genes / 301",
  ...ICONOPLASM_MOVED_PATHS.map(([from, to]) => `${from} ${to} 301`),
  "/genes/* / 301",
  ...ICONOPLASM_MOVED_PREFIXES.map(([from, to]) => `${from}* ${to}:splat 301`),
].join("\n")}\n`

// B-809: one small static document per published gene, so search engines,
// link unfurlers and scripts see that gene's own title, description,
// canonical URL, share image and licence without executing JavaScript. The
// page then boots the one shared SPA shell in place (same URL), so readers get
// the normal app and no Worker request is spent. The shell itself is ~340 KB
// (inline font bootstrap), so copying it per gene would be ~6.5 GB.
const ICONOPLASM_ORIGIN = "https://iconoplasm.brinedew.bio"
const PUBLICATION_CDN = "https://iconoplasmportraits.b-cdn.net"

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

// B-836: the per-gene document exists for crawlers and link unfurlers. A reader
// must never see its plain text: paint the site background at once (same theme
// rule as the shell: saved choice, else light on this host), keep the body
// hidden, and start the shell request from <head>. The crawler copy is shown
// only if the shell cannot be fetched.
// B-908: the shell carries the home page's <title>, so writing it over the stub
// would put "Iconoplasm | Gene character cards" in the tab for the ~300 ms the
// app takes to start, then a symbol-only title, before the card's own. The stub
// writes its own title into the shell it hands over to. The app keeps a title
// that is already this gene's (isIconoplasmGenePageTitle) and sets the loaded
// card's name once, so the tab shows one title from first paint to the card.
const GENE_PAGE_BOOT = `<style>html{background:oklch(96% 0.015 75)}html[data-theme="dark"]{background:oklch(16% 0.01 45)}body{visibility:hidden}html.icono-stub-failed body{visibility:visible}</style>
<script>(function(){try{var m=("; "+document.cookie).split("; brinedew_theme=")[1];var t=m?decodeURIComponent(m.split(";")[0]):localStorage.getItem("theme");if(t==="dark")document.documentElement.setAttribute("data-theme","dark")}catch(e){}fetch("/",{credentials:"same-origin"}).then(function(r){if(!r.ok)throw new Error(String(r.status));return r.text()}).then(function(html){var n=document.title,a=html.indexOf("<title>"),b=html.indexOf("</title>");if(a>-1&&b>a)html=html.slice(0,a+7)+n.replace(/&/g,"&amp;").replace(/</g,"&lt;")+html.slice(b);document.open();document.write(html);document.close()}).catch(function(){document.documentElement.classList.add("icono-stub-failed")})})()</script>`

export function iconoplasmGenePageHtml({ symbol, fullName }) {
  const name = String(fullName || "").trim()
  const title = iconoplasmGenePageTitle(symbol, name)
  const description = `${symbol}${name ? ` (${name})` : ""} drawn as an Iconoplasm gene character card: a memorable labelled portrait for the human gene, free to reuse under CC0.`
  const url = `${ICONOPLASM_ORIGIN}/gene/${encodeURIComponent(symbol)}`
  const image = `${ICONOPLASM_ORIGIN}/blot/${encodeURIComponent(symbol)}.webp`
  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    name: title,
    url,
    image,
    about: { "@type": "Gene", name: symbol, alternateName: name || undefined },
    license: "https://creativecommons.org/publicdomain/zero/1.0/",
    isPartOf: { "@type": "WebSite", name: "Iconoplasm", url: `${ICONOPLASM_ORIGIN}/` },
  }).replaceAll("<", "\\u003c")
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(url)}">
<link rel="license" href="https://creativecommons.org/publicdomain/zero/1.0/">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Iconoplasm">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(url)}">
<meta property="og:image" content="${escapeHtml(image)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:domain" content="iconoplasm.brinedew.bio">
<script type="application/ld+json">${jsonLd}</script>
${GENE_PAGE_BOOT}
</head>
<body>
<main>
<h1>${escapeHtml(symbol)}</h1>
<p>${escapeHtml(name || symbol)}</p>
<p><a href="/">Iconoplasm gene character cards</a></p>
</main>
</body>
</html>
`
}

export function publishedGeneEntries(publishedGenes = []) {
  const entries = new Map()
  for (const [symbol, fullName] of publishedGeneRows(publishedGenes)) {
    if (!entries.has(symbol)) entries.set(symbol, fullName)
  }
  return [...entries].sort(([left], [right]) => left.localeCompare(right))
}

export async function writeIconoplasmGenePages({ outputRoot, publishedGenes = [] }) {
  const genes = publishedGeneEntries(publishedGenes)
  if (!genes.length) return { genePages: 0 }
  const directory = path.join(outputRoot, "gene")
  await mkdir(directory, { recursive: true })
  for (const [symbol, fullName] of genes) {
    await writeFile(
      path.join(directory, `${symbol}.html`),
      iconoplasmGenePageHtml({ symbol, fullName }),
      "utf8",
    )
  }
  return { genePages: genes.length }
}

async function fetchVerifiedJson(url, expectedSha256 = "") {
  let lastError = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
      const text = await response.text()
      if (expectedSha256) {
        const digest = createHash("sha256").update(text).digest("hex")
        if (digest !== expectedSha256) throw new Error(`Hash mismatch for ${url}`)
      }
      return JSON.parse(text)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

// Reads the one stable catalog object from Bunny (the GitHub Actions
// publisher's output; no Worker, no D1): one fetch, no head, no manifest walk.
// Returns [] when the CDN is unreachable so a CDN hiccup cannot block an
// unrelated deploy; the build log says so.
export async function loadPublishedCatalogGenes({ cdn = PUBLICATION_CDN, log = console } = {}) {
  try {
    const catalog = await fetchVerifiedJson(`${cdn}/catalog/v3/index.json`)
    if (catalog?.schema !== 3 || !Array.isArray(catalog.genes))
      throw new Error("Stable catalog object has an unexpected shape")
    return catalog.genes
  } catch (error) {
    log.warn(`Iconoplasm gene pages skipped: published catalog unavailable (${error.message})`)
    return []
  }
}

export async function writeIconoplasmCompatibilityArtifacts({
  outputRoot = targetRoot,
  publishedGenes = null,
  symbols = null,
} = {}) {
  const resolvedOutput = path.resolve(outputRoot)
  const publishedSymbols = symbols
    ? [...symbols].map((value) =>
        String(value || "")
          .trim()
          .toUpperCase(),
      )
    : publicationSymbols(publishedGenes || [])
  if (
    publishedSymbols.some((symbol) => !SYMBOL.test(symbol)) ||
    new Set(publishedSymbols).size !== publishedSymbols.length
  ) {
    throw new Error("Invalid published gene symbol inventory")
  }
  publishedSymbols.sort((left, right) => left.localeCompare(right))
  await writeFile(
    path.join(resolvedOutput, "sitemap.xml"),
    iconoplasmSitemap(publishedSymbols),
    "utf8",
  )
  await writeFile(path.join(resolvedOutput, "_redirects"), ICONOPLASM_REDIRECTS, "utf8")
  return { geneCount: publishedSymbols.length }
}

async function ensureFile(filePath) {
  const info = await stat(filePath)
  if (!info.isFile()) throw new Error(`Expected a file: ${filePath}`)
}

async function inspectTree(directory, bundleRoot) {
  let fileCount = 0
  let totalBytes = 0
  let largest = { path: "", bytes: 0 }
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      const child = await inspectTree(fullPath, bundleRoot)
      fileCount += child.fileCount
      totalBytes += child.totalBytes
      files.push(...child.files)
      if (child.largest.bytes > largest.bytes) largest = child.largest
      continue
    }
    if (!entry.isFile()) continue
    const info = await stat(fullPath)
    fileCount += 1
    files.push(path.relative(bundleRoot, fullPath).replaceAll(path.sep, "/"))
    totalBytes += info.size
    if (info.size > largest.bytes) {
      largest = {
        path: path.relative(bundleRoot, fullPath).replaceAll(path.sep, "/"),
        bytes: info.size,
      }
    }
  }
  return { fileCount, totalBytes, largest, files }
}

// B-812: the Iconoplasm documents are Quartz pages emitted for the main site.
// On iconoplasm.brinedew.bio their main-site links (About, posts) and
// app-relative legal links resolved to paths this host does not serve, so the
// SPA fallback answered with the Iconoplasm homepage. Point each at its real
// owner (the moved-path table above, exact paths before prefixes), then refuse
// a build that still links to a local path nobody serves.
const ICONOPLASM_LINK_REWRITES = Object.freeze([
  ["../../apps/iconoplasm/privacy", "/privacy"],
  ["../../apps/iconoplasm/license", "/license"],
  ["../../apps/iconoplasm/developers", "/developers"],
  ["../../apps/iconoplasm/caretaker-terms", "/caretaker-terms"],
  ...ICONOPLASM_MOVED_PATHS.map(([from, to]) => [`href="${from}"`, `href="${to}"`]),
  ...ICONOPLASM_MOVED_PREFIXES.map(([from, to]) => [`href="${from}`, `href="${to}`]),
])

// Paths this host serves without a bundle file: SPA routes and Worker routes.
const ICONOPLASM_SERVED_PREFIXES = Object.freeze([
  "/gene/",
  "/clans",
  "/studio",
  "/admin",
  "/api/",
  "/blot/",
  "/portraits/",
  "/published-cards/",
  "/cdn-cgi/",
])

export function standaloneIconoplasmHtml(html) {
  let out = String(html)
  for (const [from, to] of ICONOPLASM_LINK_REWRITES) out = out.replaceAll(from, to)
  return out
}

export function unservedIconoplasmLinks(html, bundleFiles) {
  const files = new Set(bundleFiles)
  const unserved = new Set()
  for (const match of String(html).matchAll(/\bhref="(\/(?!\/)[^"#?]*)/g)) {
    const target = match[1]
    if (target === "/") continue
    if (ICONOPLASM_SERVED_PREFIXES.some((prefix) => target.startsWith(prefix))) continue
    const relative = target.replace(/^\//, "")
    if (files.has(relative) || files.has(`${relative}.html`) || files.has(`${relative}/index.html`))
      continue
    unserved.add(target)
  }
  return [...unserved].sort()
}

export async function prepareIconoplasmEdgeAssets({
  sourceRoot = publicRoot,
  outputRoot = targetRoot,
  publishedGenes = [],
} = {}) {
  const resolvedSource = path.resolve(sourceRoot)
  const resolvedOutput = path.resolve(outputRoot)
  if (
    path.dirname(resolvedOutput) !== path.dirname(resolvedSource) ||
    path.basename(resolvedOutput) !== "public-iconoplasm-edge"
  ) {
    throw new Error(`Refusing to replace unexpected asset directory: ${resolvedOutput}`)
  }

  await ensureFile(path.join(resolvedSource, "apps", "iconoplasm", "index.html"))
  await ensureFile(path.join(resolvedSource, "apps", "iconoplasm", "privacy.html"))
  await ensureFile(path.join(resolvedSource, "apps", "iconoplasm", "license.html"))
  await ensureFile(path.join(resolvedSource, "apps", "iconoplasm", "caretaker-terms.html"))
  await ensureFile(path.join(resolvedSource, "apps", "iconoplasm", "developers.html"))
  await ensureFile(path.join(resolvedSource, "favicon.ico"))

  await rm(resolvedOutput, { recursive: true, force: true })
  await mkdir(resolvedOutput, { recursive: true })

  await cp(path.join(resolvedSource, "static"), path.join(resolvedOutput, "static"), {
    recursive: true,
    force: true,
  })

  const rootEntries = await readdir(resolvedSource, { withFileTypes: true })
  for (const entry of rootEntries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile()) continue
    if (!/\.(?:css|js)$/i.test(entry.name) && entry.name !== "favicon.ico") continue
    await copyFile(path.join(resolvedSource, entry.name), path.join(resolvedOutput, entry.name))
  }

  const sourceHome = await readFile(
    path.join(resolvedSource, "apps", "iconoplasm", "index.html"),
    "utf8",
  )
  await writeFile(
    path.join(resolvedOutput, "index.html"),
    standaloneIconoplasmHtml(sourceHome),
    "utf8",
  )
  for (const page of ["privacy", "license", "caretaker-terms", "developers"]) {
    const source = await readFile(
      path.join(resolvedSource, "apps", "iconoplasm", `${page}.html`),
      "utf8",
    )
    await writeFile(
      path.join(resolvedOutput, `${page}.html`),
      standaloneIconoplasmHtml(source),
      "utf8",
    )
  }
  await writeFile(path.join(resolvedOutput, "_headers"), headersFile, "utf8")
  await writeFile(path.join(resolvedOutput, "robots.txt"), iconoplasmRobots, "utf8")
  await writeFile(path.join(resolvedOutput, "llms.txt"), iconoplasmLlms, "utf8")
  await writeIconoplasmCompatibilityArtifacts({
    outputRoot: resolvedOutput,
    publishedGenes,
  })
  await writeIconoplasmGenePages({ outputRoot: resolvedOutput, publishedGenes })
  const sourceSha = String(
    process.env.GITHUB_SHA || execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }),
  ).trim()
  if (!/^[a-f0-9]{40}$/.test(sourceSha)) throw new Error("Invalid build source SHA")
  await writeFile(
    path.join(resolvedOutput, "_build-manifest.json"),
    `${JSON.stringify({ schemaVersion: 1, kind: "iconoplasm_edge_build", sourceSha })}\n`,
    "utf8",
  )

  const report = await inspectTree(resolvedOutput, resolvedOutput)
  const bundleFiles = report.files || []
  for (const page of ["index", "privacy", "license", "caretaker-terms", "developers"]) {
    const html = await readFile(path.join(resolvedOutput, `${page}.html`), "utf8")
    const unserved = unservedIconoplasmLinks(html, bundleFiles)
    if (unserved.length) {
      throw new Error(
        `Iconoplasm ${page}.html links to paths this host does not serve: ${unserved.join(", ")}`,
      )
    }
  }
  const testFiles = bundleFiles.filter((file) => TEST_FILE.test(file)).sort()
  if (testFiles.length) {
    throw new Error(`Iconoplasm asset bundle contains test files: ${testFiles.join(", ")}`)
  }
  if (report.fileCount > maxAssetFiles) {
    throw new Error(
      `Iconoplasm asset bundle has ${report.fileCount} files; Cloudflare allows ${maxAssetFiles}`,
    )
  }
  if (report.largest.bytes > maxAssetBytes) {
    throw new Error(
      `Iconoplasm asset ${report.largest.path} is ${report.largest.bytes} bytes; Cloudflare allows ${maxAssetBytes}`,
    )
  }
  return report
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await prepareIconoplasmEdgeAssets({
    publishedGenes: await loadPublishedCatalogGenes(),
  })
  console.log(
    JSON.stringify({
      output: path.relative(repoRoot, targetRoot).replaceAll(path.sep, "/"),
      file_count: report.fileCount,
      total_bytes: report.totalBytes,
      largest_file: report.largest,
    }),
  )
}
import { execFileSync } from "node:child_process"
