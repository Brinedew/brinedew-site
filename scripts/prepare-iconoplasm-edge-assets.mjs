import { createHash } from "node:crypto"
import { copyFile, cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { ICONOPLASM_SERVICE_DISCOVERY_LINKS } from "../workers/iconoplasm-service-discovery.js"
import {
  iconoplasmGenePageTitle,
  iconoplasmPageTitle,
} from "../quartz/static/iconoplasm/page-title.js"

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
// B-932: the site offers one manual-install extension package, the one
// extension-release.json names. The Quartz Static emitter publishes only that
// package; the bundle build refuses one that is missing and any other that arrives.
const EXTENSION_DOWNLOADS = "static/iconoplasm/downloads/"
const EXTENSION_RELEASE = "static/iconoplasm/extension-release.json"
const maxAssetBytes = 25 * 1024 * 1024

const iconoplasmCsp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  // B-1164: the docs' screenshots stay in the vault's Attachments and load from brinedew.bio.
  "img-src 'self' data: blob: https://brinedew.bio https://cdn.discordapp.com https://img.brinedew.bio https://iconoplasmportraits.b-cdn.net",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://challenges.cloudflare.com https://static.cloudflareinsights.com",
  // B-1095: the gene page reads the Discord invite's live member counts
  // straight from Discord (CORS allows this origin), so readers cost us nothing.
  "connect-src 'self' data: https://brinedew.bio https://geneguessr.brinedew.bio https://iconoplasm.brinedew.bio https://img.brinedew.bio https://iconoplasmportraits.b-cdn.net https://challenges.cloudflare.com https://cloudflareinsights.com https://discord.com",
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

/docs
  Cache-Control: public, max-age=0, must-revalidate, no-transform

/docs/*
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
# ChatGPT-User, Claude-User) are welcome. Portraits and blots are CC0; see /license.
# Every blot is also on GitHub: https://github.com/Brinedew/iconoplasm-blots
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
// title is the title the app sets once the gene object has loaded.
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

function iconoplasmSitemap(symbols, docs = []) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://iconoplasm.brinedew.bio/</loc></url>
  <url><loc>https://iconoplasm.brinedew.bio/genes</loc></url>
${geneIndexLetters(symbols)
  .map((letter) => `  <url><loc>https://iconoplasm.brinedew.bio/genes/${letter}</loc></url>`)
  .join("\n")}
${symbols
  .map(
    (symbol) =>
      `  <url><loc>https://iconoplasm.brinedew.bio/gene/${encodeURIComponent(symbol)}</loc></url>`,
  )
  .join("\n")}
  <url><loc>https://iconoplasm.brinedew.bio/privacy</loc></url>
  <url><loc>https://iconoplasm.brinedew.bio/license</loc></url>
  <url><loc>https://iconoplasm.brinedew.bio/developers</loc></url>
${docs.map((doc) => `  <url><loc>https://iconoplasm.brinedew.bio/${doc}</loc></url>`).join("\n")}
</urlset>
`
}

const iconoplasmLlms = `# Iconoplasm

Iconoplasm maps human-gene biology onto memorable character portraits. A gene's blot is its portrait with the gene's name and symbol painted into the image: the picture to reuse.

- [Gene archive](https://iconoplasm.brinedew.bio/)
- [Sitemap](https://iconoplasm.brinedew.bio/sitemap.xml)
- [Every gene, A to Z](https://iconoplasm.brinedew.bio/genes): one plain list per first letter, /genes/{LETTER}
- Caretakers and their genes (JSON): https://iconoplasm.brinedew.bio/api/public/v1/caretakers
- Gene profile: https://iconoplasm.brinedew.bio/gene/{HGNC_SYMBOL}
- A gene's current blot: https://iconoplasm.brinedew.bio/blot/{HGNC_SYMBOL}.webp
- [For developers](https://iconoplasm.brinedew.bio/developers): resolving aliases and batches, and the OpenAPI document
- [Docs](https://iconoplasm.brinedew.bio/docs): tutorial, fixing a bad portrait, your own image key, FAQ, caretaker's handbook, license, patch notes

## Blots in figures

- Download the blots and embed them in the figure. Don't link a shared figure to /blot/ addresses: every view of one runs on our server.
- If you can't download files at all (a sandbox with no network), link the GitHub addresses below instead of /blot/ ones.
- [Every blot on GitHub](https://github.com/Brinedew/iconoplasm-blots), CC0, for code that can't reach this site (Claude.ai's sandbox reaches only GitHub and package registries): https://raw.githubusercontent.com/Brinedew/iconoplasm-blots/main/blot/{FIRST_LETTER}/{HGNC_SYMBOL}.webp, symbol in upper case. If only github.com is reachable: git clone --depth 1 --filter=blob:none --no-checkout https://github.com/Brinedew/iconoplasm-blots.git, then git checkout main -- blot/N/NOTCH1.webp
`

// B-818: this host has one URL convention, clean lowercase paths (a gene page
// keeps its HGNC symbol's case). Each older shape that something once linked
// (a store listing, the Quartz nav, a page built for the main site) answers a
// 301 to where it lives now. The static asset layer answers these before any
// 404, so they cost no Worker request; matching is case-sensitive and
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
  ["/wiki/Tutorial-How-to-generate-and-edit-blots-in-Iconoplasm", "/docs/request-a-new-portrait"],
  // B-1164: docs pages renamed after their titles (the old ones named the
  // wrong job: "Tutorial" taught one task, "Fix a bad portrait" covers editing,
  // voting and copying).
  ["/docs/tutorial", "/docs/request-a-new-portrait"],
  ["/docs/fix-a-bad-portrait", "/docs/edit-and-vote-on-portraits"],
  ["/docs/get-an-image-api-key", "/docs/get-an-api-key"],
  ["/docs/write-your-genes-story", "/docs/worldbuilding"],
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
  ...ICONOPLASM_MOVED_PATHS.map(([from, to]) => `${from} ${to} 301`),
  ...ICONOPLASM_MOVED_PREFIXES.map(([from, to]) => `${from}* ${to}:splat 301`),
].join("\n")}\n`

// B-809: one small static document per published gene, so search engines,
// link unfurlers and scripts see that gene's own title, description,
// canonical URL, share image and licence without executing JavaScript. The
// page then boots the one shared SPA shell in place (same URL), so readers get
// the normal app and no Worker request is spent. The shell itself is ~340 KB
// (inline font bootstrap), so copying it per gene would be ~6.5 GB.
const ICONOPLASM_ORIGIN = "https://iconoplasm.brinedew.bio"
// The public copy of every blot at blot/{FIRST LETTER}/{SYMBOL}.webp, kept by
// the Brinedew/iconoplasm-blots repository's own hourly sync (B-1130).
const BLOT_MIRROR_RAW = "https://raw.githubusercontent.com/Brinedew/iconoplasm-blots/main"
const PUBLICATION_CDN = "https://img.brinedew.bio"

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

// B-836: a stub document (a per-gene document, or one of the route and
// not-found stubs below) exists for crawlers and link unfurlers. A reader must
// never see its plain text: paint the site background at once (same theme
// rule as the shell: saved choice, else light on this host), keep the body
// hidden, and start the shell request from <head>. The crawler copy is shown
// only if the shell cannot be fetched.
// B-1130: the script hides the body, not the stylesheet alone. A reader that
// runs no scripts (ChatGPT's browsing tool, 2026-10-20) never gets the shell,
// so a body hidden by CSS alone left it the title and nothing else.
// B-908: the shell carries the home page's <title>, so writing it over the stub
// would put the home title in the tab for the ~300 ms the
// app takes to start, then a symbol-only title, before the gene's own. The stub
// writes its own title into the shell it hands over to. The app keeps a title
// that is already this gene's (isIconoplasmGenePageTitle) and sets the loaded
// gene's name once, so the tab shows one title from first paint on.
// B-1161: on a gene's address the stub also starts the gene's published object,
// the request the app's publication reader would make (same URL, cache mode
// and credentials) only after its 600 KB of scripts and styles had arrived.
// document.open() keeps the window, so the reader finds it there and takes it.
const SHELL_STUB_BOOT = `<style>html{background:oklch(96% 0.015 75)}html[data-theme="dark"]{background:oklch(16% 0.01 45)}html.icono-stub-boot body{visibility:hidden}</style>
<script>(function(){var d=document.documentElement;d.classList.add("icono-stub-boot");try{var m=("; "+document.cookie).split("; brinedew_theme=")[1];var t=m?decodeURIComponent(m.split(";")[0]):localStorage.getItem("theme");if(t==="dark")d.setAttribute("data-theme","dark")}catch(e){}try{var g=location.pathname.split("/"),k=g.length===3&&g[1]==="gene"?decodeURIComponent(g[2]).trim().toUpperCase():"";if(/^[A-Z0-9][A-Z0-9._-]{0,63}$/.test(k))window.__iconoplasmGenePrefetch={key:k,text:fetch("${PUBLICATION_CDN}/genes/v3/"+encodeURIComponent(k)+".json",{credentials:"omit",cache:"no-cache"}).then(function(r){return r.ok?r.text():null}).catch(function(){return null})}}catch(e){}fetch("/",{credentials:"same-origin"}).then(function(r){if(!r.ok)throw new Error(String(r.status));return r.text()}).then(function(html){var n=document.title,a=html.indexOf("<title>"),b=html.indexOf("</title>");if(a>-1&&b>a)html=html.slice(0,a+7)+n.replace(/&/g,"&amp;").replace(/</g,"&lt;")+html.slice(b);document.open();document.write(html);document.close()}).catch(function(){d.classList.remove("icono-stub-boot")})})()</script>`

export function iconoplasmGenePageHtml({ symbol, fullName }) {
  const name = String(fullName || "").trim()
  const title = iconoplasmGenePageTitle(symbol, name)
  const description = `${symbol}${name ? ` (${name})` : ""} drawn as an Iconoplasm gene character card: a memorable labelled portrait for the human gene, free to reuse under CC0.`
  const url = `${ICONOPLASM_ORIGIN}/gene/${encodeURIComponent(symbol)}`
  const image = `${ICONOPLASM_ORIGIN}/blot/${encodeURIComponent(symbol)}.webp`
  // B-1130: chatbot sandboxes that read this page can't download from our
  // hosts, so the copy names the GitHub mirror's file for this gene.
  const upper = String(symbol).toUpperCase()
  const mirror = `${BLOT_MIRROR_RAW}/blot/${encodeURIComponent(upper[0])}/${encodeURIComponent(upper)}.webp`
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
${SHELL_STUB_BOOT}
</head>
<body>
<main>
<h1>${escapeHtml(symbol)}</h1>
<p>${escapeHtml(name || symbol)}</p>
<p><a href="/">Iconoplasm gene character cards</a></p>
<p><a href="${escapeHtml(image)}">${escapeHtml(symbol)} blot</a>, free to reuse under CC0. The same file on GitHub, for figures and for code that can't reach this site, such as Claude.ai's code sandbox: ${escapeHtml(mirror)}. Download it and embed it in the figure; if you can't download files, link this GitHub address rather than this site.</p>
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

// B-1098: /genes and /genes/<LETTER>, every published gene as a plain list of
// links, for readers without JavaScript, crawlers and AI agents (llms.txt names
// them). Static, so a view costs nothing; in a browser the stub boots the app,
// whose /genes page adds search and each gene's caretaker. The largest letter
// (C, about 2,200 genes) is about 160 KB.
export function geneIndexLetters(symbols) {
  return [...new Set(symbols.map((symbol) => symbol[0]).filter((c) => /[A-Z]/.test(c)))].sort()
}

function geneIndexDocument({ title, heading, canonicalPath, description, body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(`${ICONOPLASM_ORIGIN}${canonicalPath}`)}">
${SHELL_STUB_BOOT}
</head>
<body>
<main>
<h1>${escapeHtml(heading)}</h1>
${body}
</main>
</body>
</html>
`
}

export async function writeIconoplasmGeneIndexPages({ outputRoot, publishedGenes = [] }) {
  const genes = publishedGeneEntries(publishedGenes)
  if (!genes.length) return { geneIndexPages: 0 }
  const letters = geneIndexLetters(genes.map(([symbol]) => symbol))
  const byLetter = new Map(letters.map((letter) => [letter, []]))
  for (const [symbol, fullName] of genes) byLetter.get(symbol[0])?.push([symbol, fullName])
  const letterLinks = letters
    .map(
      (letter) =>
        `<li><a href="/genes/${letter}">${letter}</a> (${byLetter.get(letter).length.toLocaleString("en-US")})</li>`,
    )
    .join("\n")
  await writeFile(
    path.join(outputRoot, "genes.html"),
    geneIndexDocument({
      title: iconoplasmPageTitle("Genes"),
      heading: "Genes",
      canonicalPath: "/genes",
      description: `All ${genes.length.toLocaleString("en-US")} human genes with an Iconoplasm character card, by first letter.`,
      body: `<p>${genes.length.toLocaleString("en-US")} genes. Each gene's page is /gene/{SYMBOL}.</p>
<ul>
${letterLinks}
</ul>
<p><a href="/clans">Clans</a> · <a href="/caretakers">Caretakers</a></p>`,
    }),
    "utf8",
  )
  await mkdir(path.join(outputRoot, "genes"), { recursive: true })
  for (const letter of letters) {
    const rows = byLetter
      .get(letter)
      .map(
        ([symbol, fullName]) =>
          `<li><a href="/gene/${encodeURIComponent(symbol)}">${escapeHtml(symbol)}</a> ${escapeHtml(fullName)}</li>`,
      )
      .join("\n")
    await writeFile(
      path.join(outputRoot, "genes", `${letter}.html`),
      geneIndexDocument({
        title: iconoplasmPageTitle(`Genes: ${letter}`),
        heading: `Genes: ${letter}`,
        canonicalPath: `/genes/${letter}`,
        description: `Human genes whose symbol starts with ${letter}, each with an Iconoplasm character card.`,
        body: `<p><a href="/genes">All letters</a></p>
<ul>
${rows}
</ul>`,
      }),
      "utf8",
    )
  }
  return { geneIndexPages: letters.length + 1 }
}

// B-980: this host has no SPA fallback. A path with no document answers a real
// 404 (not_found_handling = "404-page" serves /404.html), so a crawler never
// indexes the shell under an address nobody published, and the shell's own
// "index,follow" and canonical stay the home page's. A browser still gets the
// app: the stub boots the shell in place, so an alias or lowercase gene link
// (/gene/tp53) renders the card client-side, as the app resolves the symbol.
// The two in-app routes that are not genes get a 200 stub of their own. None of
// the three is in the sitemap, and each says noindex until the shell takes over.
const ICONOPLASM_STUB_PAGES = Object.freeze([
  {
    file: "404.html",
    title: iconoplasmPageTitle("Page not found"),
    heading: "Page not found",
    text: "This address is not a page in the Iconoplasm archive.",
  },
  {
    file: "caretakers.html",
    title: iconoplasmPageTitle("Caretakers"),
    heading: "Caretakers",
    text: "Who cares for which gene. As JSON: /api/public/v1/caretakers",
  },
  {
    file: "clans.html",
    title: iconoplasmPageTitle("Clans"),
    heading: "Clans",
    text: "Protein clans in the Iconoplasm archive.",
  },
  {
    file: "studio.html",
    title: iconoplasmPageTitle("Diagram Studio"),
    heading: "Diagram Studio",
    text: "The Iconoplasm diagram studio.",
  },
])

export function iconoplasmStubPageHtml({ title, heading, text }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="robots" content="noindex,follow">
${SHELL_STUB_BOOT}
</head>
<body>
<main>
<h1>${escapeHtml(heading)}</h1>
<p>${escapeHtml(text)}</p>
<p><a href="/">Iconoplasm gene character cards</a></p>
</main>
</body>
</html>
`
}

export async function writeIconoplasmStubPages({ outputRoot }) {
  for (const page of ICONOPLASM_STUB_PAGES)
    await writeFile(path.join(outputRoot, page.file), iconoplasmStubPageHtml(page), "utf8")
  return { stubPages: ICONOPLASM_STUB_PAGES.length }
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
  docs = [],
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
    iconoplasmSitemap(publishedSymbols, docs),
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
// app-relative legal links resolve to paths this host does not serve. Point each
// at its real owner (the moved-path table above, exact paths before prefixes),
// then refuse a build that still links to a local path nobody serves.
const ICONOPLASM_LINK_REWRITES = Object.freeze([
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

// B-1164: Quartz writes links relative to the page's main-site slug
// (apps/iconoplasm/docs/faq). This host serves apps/iconoplasm/ at its root, so
// each relative link is resolved against that slug: Iconoplasm pages and the
// shared static files become paths here, and everything else (wiki notes,
// posts, the vault's attachments) goes to brinedew.bio.
const RELATIVE_URL = /\b(href|src)="(?![a-z][a-z0-9+.-]*:|\/|#)([^"]*)"/gi
// Quartz's alias pages (docs/FAQ.html for docs/faq) redirect with a relative meta refresh.
const RELATIVE_REFRESH =
  /(http-equiv="refresh" content="\d+;\s*url=)(?![a-z][a-z0-9+.-]*:|\/)([^"]*)"/gi
const SHARED_ROOT_FILE = /^\/[^/]+\.(?:css|js|ico)$/
function hostUrl(relative, pageSlug) {
  const resolved = new URL(relative, `${MAIN_SITE_ORIGIN}/${pageSlug}`)
  const { pathname } = resolved
  const suffix = `${resolved.search}${resolved.hash}`
  if (pathname.startsWith("/apps/iconoplasm/")) {
    const page = pathname.slice("/apps/iconoplasm/".length).replace(/(?:^|\/)(?:index)?$/, "")
    return `/${page}${suffix}`
  }
  if (pathname.startsWith("/static/") || SHARED_ROOT_FILE.test(pathname))
    return `${pathname}${suffix}`
  return resolved.href
}

export function standaloneIconoplasmHtml(html, pageSlug = "") {
  let out = String(html)
  if (pageSlug)
    out = out
      .replace(RELATIVE_URL, (match, attribute, relative) =>
        relative ? `${attribute}="${hostUrl(relative, pageSlug)}"` : match,
      )
      .replace(
        RELATIVE_REFRESH,
        (match, prefix, relative) => `${prefix}${hostUrl(relative, pageSlug)}"`,
      )
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

// B-1164: every page Quartz emits under content/apps/iconoplasm/docs/ is served
// here at /docs/<page>, its folder page at /docs.
async function iconoplasmDocPages(sourceRoot) {
  let entries
  try {
    entries = await readdir(path.join(sourceRoot, "apps", "iconoplasm", "docs"), {
      withFileTypes: true,
    })
  } catch (error) {
    if (error.code === "ENOENT") return { pages: [], listed: [] }
    throw error
  }
  const pages = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => (entry.name === "index.html" ? "docs" : `docs/${entry.name.slice(0, -5)}`))
    .sort()
  // Alias pages are served (old links still land) but stay out of the sitemap.
  const listed = []
  for (const page of pages) {
    const html = await readFile(
      path.join(sourceRoot, "apps", "iconoplasm", sourceDocument(page)),
      "utf8",
    )
    if (!/http-equiv="refresh"/i.test(html)) listed.push(page)
  }
  return { pages, listed }
}

function sourceDocument(page) {
  return page === "docs" ? "docs/index.html" : `${page}.html`
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

  // B-1165: GeneGuessr's files serve geneguessr.brinedew.bio only; on this host
  // they would spend 24 of Cloudflare's 20,000 files on nothing.
  const geneGuessrStatic = path.join(resolvedSource, "static", "geneguessr")
  await cp(path.join(resolvedSource, "static"), path.join(resolvedOutput, "static"), {
    recursive: true,
    force: true,
    filter: (source) =>
      source !== geneGuessrStatic && !source.startsWith(geneGuessrStatic + path.sep),
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
    standaloneIconoplasmHtml(sourceHome, "apps/iconoplasm/index"),
    "utf8",
  )
  const docs = await iconoplasmDocPages(resolvedSource)
  const pages = ["privacy", "license", "caretaker-terms", "developers", ...docs.pages]
  for (const page of pages) {
    const source = await readFile(
      path.join(resolvedSource, "apps", "iconoplasm", sourceDocument(page)),
      "utf8",
    )
    await mkdir(path.dirname(path.join(resolvedOutput, `${page}.html`)), { recursive: true })
    await writeFile(
      path.join(resolvedOutput, `${page}.html`),
      standaloneIconoplasmHtml(source, `apps/iconoplasm/${sourceDocument(page).slice(0, -5)}`),
      "utf8",
    )
  }
  await writeFile(path.join(resolvedOutput, "_headers"), headersFile, "utf8")
  await writeFile(path.join(resolvedOutput, "robots.txt"), iconoplasmRobots, "utf8")
  await writeFile(path.join(resolvedOutput, "llms.txt"), iconoplasmLlms, "utf8")
  await writeIconoplasmCompatibilityArtifacts({
    outputRoot: resolvedOutput,
    publishedGenes,
    docs: docs.listed,
  })
  await writeIconoplasmGenePages({ outputRoot: resolvedOutput, publishedGenes })
  await writeIconoplasmGeneIndexPages({ outputRoot: resolvedOutput, publishedGenes })
  await writeIconoplasmStubPages({ outputRoot: resolvedOutput })
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
  for (const page of ["index", ...pages]) {
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
  const packages = bundleFiles
    .filter((file) => file.startsWith(EXTENSION_DOWNLOADS) && file.endsWith(".zip"))
    .sort()
  if (packages.length || bundleFiles.includes(EXTENSION_RELEASE)) {
    let url
    try {
      url = JSON.parse(
        await readFile(path.join(resolvedOutput, EXTENSION_RELEASE), "utf8"),
      ).chromeDeveloperPackageUrl
    } catch (error) {
      throw new Error(`Iconoplasm asset bundle cannot read ${EXTENSION_RELEASE}: ${error.message}`)
    }
    const named = `${EXTENSION_DOWNLOADS}${path.posix.basename(String(url))}`
    if (path.posix.dirname(String(url)) !== `/${path.posix.dirname(named)}`) {
      throw new Error(`${EXTENSION_RELEASE} names ${url}, which is not in /${EXTENSION_DOWNLOADS}`)
    }
    if (!packages.includes(named)) {
      throw new Error(`${EXTENSION_RELEASE} names ${named}, which the bundle does not hold`)
    }
    const unreferenced = packages.filter((file) => file !== named)
    if (unreferenced.length) {
      throw new Error(
        `Iconoplasm asset bundle holds unreferenced extension packages: ${unreferenced.join(", ")}`,
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
