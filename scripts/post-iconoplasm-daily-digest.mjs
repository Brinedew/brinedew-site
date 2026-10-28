// B-733: posts yesterday's Iconoplasm digest to #iconoplasm
// (docs/ICONOPLASM_DAILY_DIGEST.md). Run daily by
// .github/workflows/post-iconoplasm-daily-digest.yml.
//
//   node scripts/post-iconoplasm-daily-digest.mjs [--day YYYY-MM-DD] [--dry-run] [--out DIR]
//
// 1. Reads the finished UTC day from the site (admin route, ICONOPLASM_ADMIN_TOKEN).
// 2. Looks up each shown gene's full name and blot on the free CDN.
// 3. Draws the strip (scripts/iconoplasm-daily-digest/template.html) in Chrome.
// 4. Sends the WebP and its gene-link text back to the site, which posts it.
// --dry-run stops after step 3 and writes the picture and text to --out.
// A day with nothing in it, one already posted, or any day while the admin
// panel's "Iconoplasm daily digest" switch (/admin#discord) is off, posts nothing.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { chromium } from "playwright-core"
import sharp from "sharp"
import {
  iconoplasmBlotFingerprint,
  iconoplasmBlotObjectKey,
} from "../workers/lib/iconoplasm-blot.js"

const SITE = (process.env.ICONOPLASM_BASE_URL || "https://iconoplasm.brinedew.bio").replace(
  /\/+$/,
  "",
)
const CDN = "https://iconoplasmportraits.b-cdn.net"
const TEMPLATE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "iconoplasm-daily-digest",
)
// The template's densest level shows at most this many items in a section (lore:
// 150 chips), so no gene past it needs a name or a blot.
const SHOWN_PER_SECTION = 150
const MAX_WEBP_HEIGHT = 16_383
const MAX_WEBP_BYTES = 10_000_000

const portraitUrl = (sha, size) => `${CDN}/portraits/v1/${sha.slice(0, 2)}/${sha}/${size}.webp`

function parseArgs(argv) {
  const args = { day: null, dryRun: false, out: path.resolve("artifacts/daily-digest") }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--day") args.day = argv[++i]
    else if (argv[i] === "--dry-run") args.dryRun = true
    else if (argv[i] === "--out") args.out = path.resolve(argv[++i])
    else throw new Error(`unknown argument: ${argv[i]}`)
  }
  if (!args.day) {
    const yesterday = new Date()
    yesterday.setUTCDate(yesterday.getUTCDate() - 1)
    args.day = yesterday.toISOString().slice(0, 10)
  }
  return args
}

async function admin(pathAndQuery, init = {}) {
  const token = process.env.ICONOPLASM_ADMIN_TOKEN
  if (!token) throw new Error("ICONOPLASM_ADMIN_TOKEN is not set")
  const response = await fetch(`${SITE}/api/iconoplasm/admin${pathAndQuery}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
    signal: AbortSignal.timeout(120_000),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${pathAndQuery}: ${response.status} ${body.error || ""}`)
  return body
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    }),
  )
  return out
}

// A gene's full name, its current portrait, and its blot when one is drawn for
// that portrait; otherwise the current portrait itself, so a fresh winner never
// shows blank.
async function lookUpGene(symbol) {
  const response = await fetch(`${CDN}/genes/v3/${encodeURIComponent(symbol)}.json`, {
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null)
  if (!response?.ok) return { symbol, name: "", blot: "", sha: "" }
  const gene = await response.json().catch(() => ({}))
  const key = iconoplasmBlotObjectKey(symbol, iconoplasmBlotFingerprint(gene))
  const blot = key ? `${CDN}/${key}` : ""
  const drawn =
    blot &&
    (await fetch(blot, { method: "HEAD", signal: AbortSignal.timeout(20_000) }).catch(() => null))
      ?.ok
  const sha = String(gene?.portrait?.asset_sha256 || "")
  return {
    symbol,
    name: String(gene?.full_name || ""),
    blot: drawn ? blot : /^[a-f0-9]{64}$/.test(sha) ? portraitUrl(sha, "medium") : "",
    sha,
  }
}

function longDate(day) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })
}

// The template's shape (window.DIGEST), from the site's day.
export async function digestPage(day, lookUp = lookUpGene) {
  const first = (list) => list.slice(0, SHOWN_PER_SECTION).map((x) => x.symbol)
  const shown = [
    ...first(day.updates),
    ...first(day.caretakers),
    ...first(day.lore),
    ...first(day.comments),
    ...first(day.candidates),
  ]
  const genes = await mapLimit([...new Set(shown)], 16, lookUp)
  const now = new Map(genes.map((g) => [g.symbol, g]))
  const who = (x) => ({ name: x.username, avatar: x.avatar })
  // The portrait that won during the day. The job runs hours after midnight,
  // so the gene's portrait by then may be a later winner; its blot stands in
  // only when it is the same portrait.
  const won = (symbol, sha) => {
    const gene = now.get(symbol)
    return gene?.sha === sha && gene.blot ? gene.blot : portraitUrl(sha, "medium")
  }
  const winners = new Map(day.updates.map((u) => [u.symbol, u.to_sha]))
  return {
    date: longDate(day.day),
    names: Object.fromEntries(genes.map((g) => [g.symbol, g.name])),
    blots: Object.fromEntries(genes.map((g) => [g.symbol, g.blot])),
    updates: day.updates.map((u) => ({
      symbol: u.symbol,
      from: portraitUrl(u.from_sha, "medium"),
      to: won(u.symbol, u.to_sha),
    })),
    caretakers: day.caretakers.map((c) => ({ symbol: c.symbol, who: who(c), from: c.from_symbol })),
    lore: day.lore.map((l) => ({ symbol: l.symbol, who: who(l), text: l.text })),
    comments: day.comments.map((c) => ({ symbol: c.symbol, who: who(c), text: c.text })),
    // A new candidate that became the canonical portrait the same day comes
    // first, so it matches its pair under Canonical portrait updates.
    candidates: day.candidates.map((c) => {
      const winner = winners.get(c.symbol)
      const shas = c.shas.includes(winner)
        ? [winner, ...c.shas.filter((sha) => sha !== winner)]
        : c.shas
      return {
        symbol: c.symbol,
        // "medium" (384x512) is sharp in the digest's 800 px wide picture.
        portraits: shas.map((sha) => portraitUrl(sha, "medium")),
      }
    }),
  }
}

// The message that carries the picture: gene links, because a picture can't be
// clicked. Each line links at most k genes and counts the rest; k shrinks until
// the text fits Discord's 2,000 characters. An empty day posts nothing.
export function discordText(page) {
  const g = (s) => `[${s}](${SITE}/gene/${s})`
  const groups = [
    ["Canonical portrait updates", page.updates.map((u) => u.symbol)],
    ["New caretakers", page.caretakers.map((c) => c.symbol)],
    ["Lore", page.lore.map((l) => l.symbol)],
    ["Comments", page.comments.map((c) => c.symbol)],
    ["New candidates", page.candidates.map((c) => c.symbol)],
  ]
    .map(([label, s]) => [label, [...new Set(s)]])
    .filter(([, s]) => s.length)
  if (!groups.length) return ""
  for (let k = 12; ; k--) {
    const text = [
      `## Iconoplasm · ${page.date.replace(/ \d{4}$/, "")}`,
      ...groups.map(
        ([label, list]) =>
          `**${label}:** ${list.slice(0, k).map(g).join(" · ")}${list.length > k ? ` and ${(list.length - k).toLocaleString("en")} more` : ""}`,
      ),
    ].join("\n")
    if (text.length <= 1950 || k === 1) return text
  }
}

export async function drawStrip(page, outDir) {
  mkdirSync(outDir, { recursive: true })
  // The base keeps the template's fonts/ and paper.jpg resolving from outDir.
  const html = readFileSync(path.join(TEMPLATE_DIR, "template.html"), "utf8")
    .replace("<head>", `<head>\n<base href="${pathToFileURL(TEMPLATE_DIR).href}/">`)
    .replace(
      "<script>",
      `<script>window.DIGEST = ${JSON.stringify(page).replace(/</g, "\\u003c")};</script>\n<script>`,
    )
  const file = path.join(outDir, "digest-page.html")
  writeFileSync(file, html)
  const browser = await chromium.launch({ channel: "chrome" })
  try {
    const tab = await browser.newPage({
      viewport: { width: 800, height: 1200 },
      deviceScaleFactor: 2,
    })
    await tab.goto(pathToFileURL(file).href)
    await tab.evaluate(() => document.fonts.ready)
    await tab.waitForFunction(() => [...document.images].every((i) => i.complete), null, {
      timeout: 300_000,
    })
    await tab.evaluate(() => window.replaceBrokenAvatars())
    const layout = await tab.evaluate(() => window.DIGEST_LAYOUT)
    // A short day must not be padded out to the viewport's height.
    await tab.setViewportSize({ width: 800, height: Math.min(layout.height, 1200) })
    const png = await tab.screenshot({ fullPage: true })
    const meta = await sharp(png, { limitInputPixels: false }).metadata()
    if (meta.height > MAX_WEBP_HEIGHT)
      throw new Error(`strip is ${meta.height} px tall, over WebP's ${MAX_WEBP_HEIGHT}`)
    const webp = await sharp(png, { limitInputPixels: false }).webp({ quality: 82 }).toBuffer()
    if (webp.length > MAX_WEBP_BYTES)
      throw new Error(`strip is ${webp.length} bytes, over Discord's 10 MB`)
    return { webp, layout, px: `${meta.width}x${meta.height}` }
  } finally {
    await browser.close()
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const day = await admin(`/daily-digest/day?day=${args.day}`)
  if (day.posted && !args.dryRun)
    return console.log(JSON.stringify({ day: args.day, already_posted: day.posted }))
  if (day.switched_on === false && !args.dryRun)
    return console.log(JSON.stringify({ day: args.day, switched_off: true }))
  const page = await digestPage(day)
  const content = discordText(page)
  if (!content) return console.log(JSON.stringify({ day: args.day, empty: true }))
  const t0 = Date.now()
  const { webp, layout, px } = await drawStrip(page, args.out)
  const report = {
    day: args.day,
    px,
    cssHeight: layout.height,
    levels: layout.levels,
    webpMB: +(webp.length / 1e6).toFixed(2),
    seconds: Math.round((Date.now() - t0) / 1000),
    textChars: content.length,
  }
  if (args.dryRun) {
    // The site's day as it came, so a strip can be redrawn from real data.
    writeFileSync(path.join(args.out, `iconoplasm-${args.day}-day.json`), JSON.stringify(day))
    writeFileSync(path.join(args.out, `iconoplasm-${args.day}.webp`), webp)
    writeFileSync(path.join(args.out, `iconoplasm-${args.day}.md`), content)
    return console.log(JSON.stringify({ ...report, dry_run: true, out: args.out }))
  }
  const form = new FormData()
  form.append("day", args.day)
  form.append("content", content)
  form.append("image", new Blob([webp], { type: "image/webp" }), `iconoplasm-${args.day}.webp`)
  const posted = await admin("/daily-digest/post", { method: "POST", body: form })
  console.log(JSON.stringify({ ...report, ...posted }))
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(error.stack || String(error))
    process.exit(1)
  })
}
