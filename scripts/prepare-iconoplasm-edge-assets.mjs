import { createHash } from "node:crypto"
import { copyFile, cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { ICONOPLASM_SERVICE_DISCOVERY_LINKS } from "../workers/iconoplasm-service-discovery.js"

// ARCHITECTURE FENCE [IPD-007]: this bundle is the static half of the
// Iconoplasm failure boundary. Keep its security headers and platform-limit
// validation coupled to direct route ownership; do not replace it with a
// Worker-side cache that still consumes one invocation per file.
// ARCHITECTURE FENCE [IPD-003]: final activation derives complete gene sitemap
// membership from the verified immutable compact catalog, never a runtime scan.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const publicRoot = path.join(repoRoot, "public")
const targetRoot = path.join(repoRoot, "public-iconoplasm-edge")
const maxAssetFiles = 20_000
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

/static/iconoplasm/*
  Cache-Control: public, max-age=31536000, immutable

/static/*
  Cache-Control: public, max-age=86400

/*.css
  Cache-Control: public, max-age=31536000, immutable

/*.js
  Cache-Control: public, max-age=31536000, immutable
`

const iconoplasmRobots = `User-agent: GPTBot
Disallow: /

User-agent: ClaudeBot
Disallow: /

User-agent: *
Allow: /
Disallow: /api/

Sitemap: https://iconoplasm.brinedew.bio/sitemap.xml
`

const SYMBOL = /^[A-Z0-9][A-Z0-9._-]{0,63}$/

function publicationSymbols(publicationIndexes = []) {
  const symbols = new Set()
  for (const index of publicationIndexes) {
    if (index?.schema_version !== 2 || !Array.isArray(index.search_entries)) {
      throw new Error("Invalid immutable compact catalog index")
    }
    for (const entry of index.search_entries) {
      const symbol = String(entry?.[0] || "")
        .trim()
        .toUpperCase()
      if (!SYMBOL.test(symbol)) throw new Error("Invalid published gene symbol")
      if (symbols.has(symbol)) throw new Error(`Duplicate published gene symbol: ${symbol}`)
      symbols.add(symbol)
    }
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
</urlset>
`
}

const iconoplasmLlms = `# Iconoplasm

Iconoplasm maps human-gene biology onto memorable visual character cards called blots.

- [Published gene-card archive](https://iconoplasm.brinedew.bio/)
- [Sitemap](https://iconoplasm.brinedew.bio/sitemap.xml)
- Gene profile: https://iconoplasm.brinedew.bio/gene/{HGNC_SYMBOL}
- Canonical gene blot: https://iconoplasm.brinedew.bio/blot/{HGNC_SYMBOL}.webp
`

// Keep /portraits/* out of Static Assets redirects: those canonical URLs must
// reach the existing Bunny-backed Worker when a browser cannot reach the CDN.
const redirectsFile = `/genes / 301
/genes/* / 301
`

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
const GENE_PAGE_BOOT = `<style>html{background:oklch(96% 0.015 75)}html[data-theme="dark"]{background:oklch(16% 0.01 45)}body{visibility:hidden}html.icono-stub-failed body{visibility:visible}</style>
<script>(function(){try{var m=("; "+document.cookie).split("; brinedew_theme=")[1];var t=m?decodeURIComponent(m.split(";")[0]):localStorage.getItem("theme");if(t==="dark")document.documentElement.setAttribute("data-theme","dark")}catch(e){}fetch("/",{credentials:"same-origin"}).then(function(r){if(!r.ok)throw new Error(String(r.status));return r.text()}).then(function(html){document.open();document.write(html);document.close()}).catch(function(){document.documentElement.classList.add("icono-stub-failed")})})()</script>`

export function iconoplasmGenePageHtml({ symbol, fullName }) {
  const name = String(fullName || "").trim()
  const title = name
    ? `${symbol} — ${name} | Iconoplasm character profile`
    : `${symbol} | Iconoplasm character profile`
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

export function publishedGeneEntries(publicationIndexes = []) {
  const entries = new Map()
  for (const index of publicationIndexes) {
    if (index?.schema_version !== 2 || !Array.isArray(index.search_entries)) {
      throw new Error("Invalid immutable compact catalog index")
    }
    for (const entry of index.search_entries) {
      const symbol = String(entry?.[0] || "")
        .trim()
        .toUpperCase()
      if (!SYMBOL.test(symbol)) throw new Error("Invalid published gene symbol")
      if (!entries.has(symbol)) entries.set(symbol, String(entry?.[1] || "").trim())
    }
  }
  return [...entries].sort(([left], [right]) => left.localeCompare(right))
}

export async function writeIconoplasmGenePages({ outputRoot, publicationIndexes = [] }) {
  const genes = publishedGeneEntries(publicationIndexes)
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

// Reads the current immutable publication from Bunny (the one publisher's
// output; no Worker, no D1). Returns [] when the CDN is unreachable so a CDN
// hiccup cannot block an unrelated deploy; the build log says so.
export async function loadPublishedCatalogIndexes({ cdn = PUBLICATION_CDN, log = console } = {}) {
  try {
    const head = await fetchVerifiedJson(`${cdn}/api/public/v1/card-current`)
    const base = String(head?.current || "")
    const manifestHash = /^ccv2-([a-f0-9]{64})$/.exec(base)?.[1]
    if (!manifestHash) throw new Error("Publication head has no current manifest")
    const manifest = await fetchVerifiedJson(
      `${cdn}/published-cards/v2/immutable/manifests/${manifestHash}.json`,
      manifestHash,
    )
    const indexes = []
    for (const shard of manifest?.shards || []) {
      const key = String(shard?.catalog_index?.key || "")
      const hash = /\/([a-f0-9]{64})\.json$/.exec(key)?.[1]
      if (!hash) throw new Error("Manifest shard has no catalog index")
      indexes.push(await fetchVerifiedJson(`${cdn}/${key}`, hash))
    }
    return indexes
  } catch (error) {
    log.warn(`Iconoplasm gene pages skipped: published catalog unavailable (${error.message})`)
    return []
  }
}

export async function writeIconoplasmCompatibilityArtifacts({
  outputRoot = targetRoot,
  publicationIndexes = null,
  symbols = null,
} = {}) {
  const resolvedOutput = path.resolve(outputRoot)
  const publishedSymbols = symbols
    ? [...symbols].map((value) =>
        String(value || "")
          .trim()
          .toUpperCase(),
      )
    : publicationSymbols(publicationIndexes || [])
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
  await writeFile(path.join(resolvedOutput, "_redirects"), redirectsFile, "utf8")
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
// On iconoplasm.brinedew.bio their main-site links (About, posts, tutorial) and
// app-relative legal links resolved to paths this host does not serve, so the
// SPA fallback answered with the Iconoplasm homepage. Point each at its real
// owner, then refuse a build that still links to a local path nobody serves.
const MAIN_SITE_ORIGIN = "https://brinedew.bio"
const ICONOPLASM_LINK_REWRITES = Object.freeze([
  ["../../apps/iconoplasm/privacy", "/privacy"],
  ["../../apps/iconoplasm/license", "/license"],
  ["../../apps/iconoplasm/caretaker-terms", "/caretaker-terms"],
  ['href="/About.html"', `href="${MAIN_SITE_ORIGIN}/about"`],
  ['href="/posts/support-me"', `href="${MAIN_SITE_ORIGIN}/posts/support-me"`],
  ['href="/posts"', `href="${MAIN_SITE_ORIGIN}/posts"`],
  [
    'href="/wiki/Tutorial-How-to-generate-and-edit-blots-in-Iconoplasm"',
    `href="${MAIN_SITE_ORIGIN}/wiki/tutorial-how-to-generate-and-edit-blots-in-iconoplasm"`,
  ],
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
  publicationIndexes = [],
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
  for (const page of ["privacy", "license", "caretaker-terms"]) {
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
    publicationIndexes,
  })
  await writeIconoplasmGenePages({ outputRoot: resolvedOutput, publicationIndexes })
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
  for (const page of ["index", "privacy", "license", "caretaker-terms"]) {
    const html = await readFile(path.join(resolvedOutput, `${page}.html`), "utf8")
    const unserved = unservedIconoplasmLinks(html, bundleFiles)
    if (unserved.length) {
      throw new Error(
        `Iconoplasm ${page}.html links to paths this host does not serve: ${unserved.join(", ")}`,
      )
    }
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
    publicationIndexes: await loadPublishedCatalogIndexes(),
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
