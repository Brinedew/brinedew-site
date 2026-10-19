#!/usr/bin/env node
// B-1131: THE ONLY drawer of blots. A blot is one WebP: the gene's current
// portrait with its name and symbol painted on, by the same painter the print
// button uses (shared/iconoplasm-card/blot-painter.js). Its address is a pure
// function of the gene's symbol, name and current portrait
// (workers/lib/iconoplasm-blot.js), so the site computes it from the published
// stable gene object and this script draws whatever address is still empty.
//
// Bunny storage is the record. A blot exists exactly when its file is in
// storage; one listing per first letter shows them all. Each run reads the
// catalogue (catalog/v3/index.json: every gene's symbol, name and current
// portrait), lists storage, paints the missing blots in headless Chrome and
// uploads them. No D1, no Worker request, no manifest, no watermark: a run
// that fails leaves its genes missing, and the next run draws them.
//
//   node scripts/draw-iconoplasm-blots.mjs              # draw every missing blot
//   node scripts/draw-iconoplasm-blots.mjs --dry-run    # count them, draw nothing
//   node scripts/draw-iconoplasm-blots.mjs --limit 50   # draw at most 50
//   node scripts/draw-iconoplasm-blots.mjs --symbols KRAS,TP53 --out <dir>
//                                                       # draw these into a folder, upload nothing
//
// Runs in GitHub Actions (.github/workflows/draw-iconoplasm-blots.yml) after
// every catalogue publication. Needs ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD
// except with --out, which reads the catalogue from the CDN instead.
import { createHash } from "node:crypto"
import { createServer } from "node:http"
import { mkdirSync, readFileSync, statSync, writeFileSync, appendFileSync } from "node:fs"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright-core"

import {
  ICONOPLASM_BLOT_HEIGHT,
  ICONOPLASM_BLOT_WIDTH,
  iconoplasmBlotFingerprint,
  iconoplasmBlotFolder,
  iconoplasmBlotObjectKey,
  webpDimensions,
} from "../workers/lib/iconoplasm-blot.js"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const STATIC_ROOT = path.join(ROOT, "quartz", "static")
const CDN = "https://img.brinedew.bio"
const STORAGE = "https://storage.bunnycdn.com/iconoplasm-portraits"
const CATALOG_KEY = "catalog/v3/index.json"
// Chrome's WebP encoder at the quality the earlier blots used (Pillow, 92).
const WEBP_QUALITY = 0.92
// Each worker is its own browser context, so its own renderer process: the
// GitHub runner has four cores, and fetching and uploading overlap painting.
const WORKERS = Math.max(1, Number(process.env.BLOT_WORKERS) || 6)
// A fresh page every few hundred paints keeps a renderer's memory bounded.
const PAINTS_PER_PAGE = 400

function parseArgs(argv) {
  const options = { dryRun: false, limit: Infinity, symbols: null, out: "" }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--dry-run") options.dryRun = true
    else if (arg === "--limit") options.limit = Math.max(0, Number(argv[++index]) || 0)
    else if (arg === "--symbols")
      options.symbols = new Set(
        String(argv[++index] || "")
          .split(",")
          .map((symbol) => symbol.trim().toUpperCase())
          .filter(Boolean),
      )
    else if (arg === "--out") options.out = path.resolve(String(argv[++index] || ""))
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return options
}

function storageKey() {
  return String(process.env.ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD || "").trim()
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function withRetries(label, attempt, delays = [1000, 4000, 10000]) {
  let lastError = null
  for (let tryIndex = 0; tryIndex <= delays.length; tryIndex += 1) {
    if (tryIndex > 0) await sleep(delays[tryIndex - 1])
    try {
      return await attempt()
    } catch (error) {
      lastError = error
    }
  }
  throw new Error(`${label}: ${lastError?.message || lastError}`)
}

async function readCatalog(key) {
  // The catalogue was rewritten seconds ago by the publish run that triggered
  // this one; storage's origin has it as written, the CDN edge keeps its copy
  // for 60 s.
  const url = key ? `${STORAGE}/${CATALOG_KEY}` : `${CDN}/${CATALOG_KEY}`
  return withRetries("catalogue read", async () => {
    const response = await fetch(url, { headers: key ? { AccessKey: key } : {} })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const catalog = await response.json()
    if (catalog?.schema !== 3 || !Array.isArray(catalog.genes)) {
      throw new Error("catalog/v3/index.json is not schema 3")
    }
    return catalog
  })
}

// Every gene with a published portrait, as the painter and the fingerprint
// see it: symbol, name and portrait, nothing else.
export function blotsOfCatalog(catalog) {
  const blots = []
  for (const row of catalog.genes) {
    const [symbol, fullName, portraitSha256] = row
    if (!portraitSha256) continue
    const geneObject = {
      symbol,
      full_name: fullName,
      portrait: { status: "published", asset_sha256: portraitSha256 },
    }
    const fingerprint = iconoplasmBlotFingerprint(geneObject)
    const key = iconoplasmBlotObjectKey(symbol, fingerprint)
    if (key) blots.push({ symbol, geneObject, key, folder: iconoplasmBlotFolder(symbol) })
  }
  return blots
}

// The file names storage holds in one blot folder.
async function listFolder(key, folder) {
  return withRetries(`listing ${folder}`, async () => {
    const response = await fetch(`${STORAGE}/${folder}`, {
      headers: { AccessKey: key, Accept: "application/json" },
    })
    if (response.status === 404) return new Set()
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const entries = await response.json()
    if (!Array.isArray(entries)) throw new Error("listing is not an array")
    return new Set(
      entries
        .filter((entry) => !entry.IsDirectory && Number(entry.Length) > 0)
        .map((entry) => `${folder}${entry.ObjectName}`),
    )
  })
}

async function drawnKeys(key, blots) {
  const folders = [...new Set(blots.map((blot) => blot.folder))].sort()
  const drawn = new Set()
  for (const folder of folders) {
    for (const objectKey of await listFolder(key, folder)) drawn.add(objectKey)
  }
  return { drawn, folders: folders.length }
}

function portraitUrl(sha256) {
  return `${CDN}/portraits/v1/${sha256.slice(0, 2)}/${sha256}/full.webp`
}

const TYPES = {
  ".css": "text/css",
  ".js": "text/javascript",
  ".woff2": "font/woff2",
  ".webp": "image/webp",
}

const PAINTER_PAGE = `<!doctype html><html><head><meta charset="utf-8">
<script src="/static/iconoplasm/generated/shared-card-runtime.js"></script>
<script src="/static/iconoplasm/generated/blot-painter.js"></script>
</head><body></body></html>`

// Serves the site's own card stylesheet, runtime, painter and fonts, and
// hands the painter each portrait from the same origin.
export async function startPainterSite() {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://local")
    try {
      if (url.pathname === "/painter.html") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" })
        response.end(PAINTER_PAGE)
        return
      }
      const portrait = /^\/portrait\/([a-f0-9]{64})\.webp$/.exec(url.pathname)
      if (portrait) {
        const bytes = await withRetries(`portrait ${portrait[1]}`, async () => {
          const reply = await fetch(portraitUrl(portrait[1]))
          if (!reply.ok) throw new Error(`HTTP ${reply.status}`)
          return Buffer.from(await reply.arrayBuffer())
        })
        response.writeHead(200, { "content-type": "image/webp" })
        response.end(bytes)
        return
      }
      if (url.pathname.startsWith("/static/")) {
        const file = path.join(
          STATIC_ROOT,
          decodeURIComponent(url.pathname.slice("/static/".length)),
        )
        if (file.startsWith(STATIC_ROOT) && statSync(file).isFile()) {
          response.writeHead(200, {
            "content-type": TYPES[path.extname(file)] || "application/octet-stream",
          })
          response.end(readFileSync(file))
          return
        }
      }
      response.writeHead(404)
      response.end()
    } catch (error) {
      response.writeHead(502, { "content-type": "text/plain" })
      response.end(String(error?.message || error))
    }
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  return { server, origin: `http://127.0.0.1:${server.address().port}` }
}

async function openPainterPage(context, origin) {
  const page = await context.newPage()
  await page.goto(`${origin}/painter.html`)
  await page.waitForFunction(() => !!(globalThis.IconoplasmBlot && globalThis.IconoplasmCardShared))
  return page
}

async function paintBlot(page, geneObject) {
  const base64 = await page.evaluate(
    async ({ geneObject, portraitUrl, width, quality }) => {
      const canvas = await globalThis.IconoplasmBlot.paint(geneObject, {
        portraitUrl,
        width,
        requireFonts: true,
        stylesheetHref: "/static/iconoplasm/generated/shared-card-label.css",
      })
      const blob = await new Promise((resolve, reject) =>
        canvas.toBlob(
          (value) => (value ? resolve(value) : reject(new Error("WebP encoding failed"))),
          "image/webp",
          quality,
        ),
      )
      const bytes = new Uint8Array(await blob.arrayBuffer())
      let binary = ""
      for (let index = 0; index < bytes.length; index += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
      }
      return btoa(binary)
    },
    {
      geneObject,
      portraitUrl: `/portrait/${geneObject.portrait.asset_sha256}.webp`,
      width: ICONOPLASM_BLOT_WIDTH,
      quality: WEBP_QUALITY,
    },
  )
  const bytes = Buffer.from(base64, "base64")
  const size = webpDimensions(bytes)
  if (size?.width !== ICONOPLASM_BLOT_WIDTH || size?.height !== ICONOPLASM_BLOT_HEIGHT) {
    throw new Error(`painted ${size ? `${size.width}x${size.height}` : "a non-WebP"}`)
  }
  return bytes
}

async function uploadBlot(key, objectKey, bytes) {
  const checksum = createHash("sha256").update(bytes).digest("hex").toUpperCase()
  await withRetries(`upload ${objectKey}`, async () => {
    const response = await fetch(`${STORAGE}/${objectKey}`, {
      method: "PUT",
      headers: {
        AccessKey: key,
        "Content-Type": "image/webp",
        // Bunny refuses the write when the bytes it received don't hash to this.
        Checksum: checksum,
      },
      body: bytes,
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
  })
}

async function drawAll(missing, { key, out }) {
  const { server, origin } = await startPainterSite()
  const browser = await chromium.launch({ channel: "chrome" })
  const failures = []
  let drawn = 0
  let next = 0
  const started = Date.now()
  try {
    async function worker() {
      const context = await browser.newContext()
      let page = await openPainterPage(context, origin)
      let paints = 0
      try {
        while (next < missing.length) {
          const blot = missing[next++]
          if (paints >= PAINTS_PER_PAGE) {
            await page.close()
            page = await openPainterPage(context, origin)
            paints = 0
          }
          paints += 1
          try {
            const bytes = await paintBlot(page, blot.geneObject)
            if (out) {
              const file = path.join(out, blot.key)
              mkdirSync(path.dirname(file), { recursive: true })
              writeFileSync(file, bytes)
            } else {
              await uploadBlot(key, blot.key, bytes)
            }
            drawn += 1
            if (drawn % 250 === 0) {
              const seconds = Math.round((Date.now() - started) / 1000)
              console.log(`drew ${drawn}/${missing.length} in ${seconds} s`)
            }
          } catch (error) {
            failures.push({
              symbol: blot.symbol,
              key: blot.key,
              error: String(error?.message || error),
            })
            // A crashed renderer takes the page with it; start a new one.
            if (page.isClosed()) page = await openPainterPage(context, origin)
          }
        }
      } finally {
        await context.close()
      }
    }
    await Promise.all(Array.from({ length: Math.min(WORKERS, missing.length) }, worker))
  } finally {
    await browser.close()
    server.close()
  }
  return { drawn, failures, seconds: Math.round((Date.now() - started) / 1000) }
}

function writeSummary(report) {
  console.log(JSON.stringify(report, null, 2))
  const file = process.env.GITHUB_STEP_SUMMARY
  if (!file) return
  const lines = [
    "## Blots",
    "",
    `| Genes with a portrait | Already drawn | Missing | Drawn now | Failed |`,
    `| --: | --: | --: | --: | --: |`,
    `| ${report.expected} | ${report.already_drawn} | ${report.missing} | ${report.drawn} | ${report.failures.length} |`,
    "",
    ...report.failures.slice(0, 50).map((failure) => `- ${failure.symbol}: ${failure.error}`),
  ]
  appendFileSync(file, `${lines.join("\n")}\n`)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const key = storageKey()
  if (!key && !options.out) {
    throw new Error("Missing ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD (or pass --out <dir>)")
  }
  const catalog = await readCatalog(key)
  let blots = blotsOfCatalog(catalog)
  if (options.symbols) blots = blots.filter((blot) => options.symbols.has(blot.symbol))
  let alreadyDrawn = 0
  let missing = blots
  if (!options.out) {
    const { drawn } = await drawnKeys(key, blots)
    missing = blots.filter((blot) => !drawn.has(blot.key))
    alreadyDrawn = blots.length - missing.length
  }
  const toDraw = missing.slice(0, options.limit)
  const report = {
    catalog_generated_at: catalog.generated_at,
    expected: blots.length,
    already_drawn: alreadyDrawn,
    missing: missing.length,
    drawn: 0,
    failures: [],
    seconds: 0,
  }
  if (!options.dryRun && toDraw.length) {
    Object.assign(report, await drawAll(toDraw, { key, out: options.out }))
  }
  writeSummary(report)
  if (report.failures.length) process.exitCode = 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
