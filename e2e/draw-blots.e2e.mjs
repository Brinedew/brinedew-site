// B-1131: scripts/draw-iconoplasm-blots.mjs, the one drawer of blots. A blot
// is a gene's current portrait with its name and symbol painted on; readers
// get it from /blot/{SYMBOL}.webp, share previews and the resolver's cdn_url.
//
// Ways this can fail, written before the check:
// 1. The script draws nothing, or a file that isn't a 768x1024 WebP.
// 2. The file lands at an address the site doesn't ask for: its key must be
//    the one the Worker computes from the gene's published card
//    (genes/v3/<SYMBOL>.json), or every reader gets a 404 forever.
// 3. The picture is another portrait, or stretched, or cropped differently
//    from the card: the unshaded middle must match the published portrait
//    cover-trimmed to 3:4 and scaled to 768x1024.
// 4. The label drifts from the card (a fallback face, a moved baseline):
//    compared with Chrome's own screenshot of the same borderless card at
//    device scale 2, which is how the earlier blots were made, few pixels may
//    differ by more than 16 levels, overall and in the label band alone.
//
// What is real: the script, the live catalogue, the live published cards and
// portraits, the site's own card stylesheet, runtime, painter and fonts, and
// Chrome. Only the upload is skipped (--out): the run writes into
// artifacts/e2e, where the blots, references and measurements land.
// E2E scope: shared/iconoplasm-card/ quartz/static/iconoplasm/generated/ quartz/static/iconoplasm/fonts/
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"

import { startPainterSite } from "../scripts/draw-iconoplasm-blots.mjs"
import {
  iconoplasmBlotFingerprint,
  iconoplasmBlotObjectKey,
  webpDimensions,
} from "../workers/lib/iconoplasm-blot.js"
import { OUT, ROOT, launchChrome } from "./harness.mjs"

const CDN = "https://img.brinedew.bio"
// KDM6B has a 1536x2048 portrait; KRAS an 882x1134 one that isn't 3:4 and was
// renamed by HGNC (B-1131's first symptom).
const SYMBOLS = ["KDM6B", "KRAS"]

const CARD_FONTS = JSON.parse(
  readFileSync(new URL("../shared/iconoplasm-card/font-contract.json", import.meta.url), "utf8"),
).fonts

const REFERENCE_PAGE = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/static/iconoplasm/generated/shared-card-label.css">
<script src="/static/iconoplasm/generated/shared-card-runtime.js"></script>
<style>html,body{margin:0;width:384px;height:512px;overflow:hidden;color-scheme:light;
--light:oklch(96% 0.015 75);--dark:oklch(20% 0.035 50)}
#artboard>.icono-card{width:384px;height:512px;max-width:none;box-sizing:border-box;border:0}</style>
</head><body><main id="artboard"></main></body></html>`

function listFiles(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath ?? entry.path, entry.name))
}

// Chrome's own screenshot of the borderless card at device scale 2.
async function renderReference(browser, origin, card) {
  const context = await browser.newContext({
    viewport: { width: 384, height: 512 },
    deviceScaleFactor: 2,
  })
  try {
    const page = await context.newPage()
    await page.route(`${origin}/reference.html`, (route) =>
      route.fulfill({ contentType: "text/html", body: REFERENCE_PAGE }),
    )
    await page.goto(`${origin}/reference.html`)
    await page.evaluate(
      async ({ card, fonts }) => {
        for (const font of fonts) {
          const face = new FontFace(font.family, `url("${font.url}") format("woff2")`, {
            weight: String(font.weight),
          })
          document.fonts.add(await face.load())
        }
        const body = globalThis.IconoplasmCardShared.renderLabLabelCardHtml(card, {
          layoutVariant: "image-only",
          mode: "brick",
          portraitAlt: `${card.symbol} portrait`,
          portraitSrc: `/portrait/${card.portrait.asset_sha256}.webp`,
          titleHref: "",
          voteHtml: "",
        })
        document.getElementById("artboard").innerHTML =
          `<article class="icono-card icono-card--brick icono-card--variant-image-only" data-icono-card-variant="image-only" style="--width:384;--height:512;--icono-card-accent:#888888">${body}</article>`
        const img = document.querySelector(".icono-image-only-photo")
        if (!img.complete)
          await new Promise((resolve) => img.addEventListener("load", resolve, { once: true }))
        await img.decode()
        img.classList.add("icono-image-only-photo--loaded")
        document
          .querySelector(".icono-image-only-media-stage")
          ?.classList.add("icono-image-only-media-stage--loaded")
        document
          .querySelector(".icono-image-only-link")
          ?.classList.add("icono-image-only-link--loaded")
        await document.fonts.ready
      },
      { card, fonts: CARD_FONTS },
    )
    return await page.screenshot({ type: "png", scale: "device" })
  } finally {
    await context.close()
  }
}

// Runs in a page: decodes the blot, the reference and the portrait, and
// measures the three checks above.
async function measure({ blot, reference, portraitUrl }) {
  const decode = async (blob) => {
    const bitmap = await createImageBitmap(blob)
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    canvas.getContext("2d").drawImage(bitmap, 0, 0)
    return {
      width: bitmap.width,
      height: bitmap.height,
      data: canvas.getContext("2d").getImageData(0, 0, bitmap.width, bitmap.height).data,
    }
  }
  const fromBase64 = (base64, type) =>
    new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type })
  const portraitBitmap = await createImageBitmap(await (await fetch(portraitUrl)).blob())
  const painted = await decode(fromBase64(blot, "image/webp"))
  const native = await decode(fromBase64(reference, "image/png"))
  // The portrait cover-trimmed to 3:4 and scaled to the blot, as a browser
  // would draw it: the yardstick for the unshaded middle.
  const k = Math.min(portraitBitmap.width / 384, portraitBitmap.height / 512)
  const sw = Math.round(384 * k)
  const sh = Math.round(512 * k)
  const scaled = new OffscreenCanvas(painted.width, painted.height)
  const scaledContext = scaled.getContext("2d")
  scaledContext.imageSmoothingQuality = "high"
  scaledContext.drawImage(
    portraitBitmap,
    Math.round((portraitBitmap.width - sw) / 2),
    Math.round((portraitBitmap.height - sh) / 2),
    sw,
    sh,
    0,
    0,
    painted.width,
    painted.height,
  )
  const portrait = scaledContext.getImageData(0, 0, painted.width, painted.height).data
  const channelDiff = (a, b, i) =>
    Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]))
  let middleSum = 0
  let middleCount = 0
  for (let y = 0; y < Math.floor(painted.height * 0.55); y += 1) {
    for (let x = Math.floor(painted.width * 0.19); x < Math.floor(painted.width * 0.81); x += 1) {
      middleSum += channelDiff(painted.data, portrait, (y * painted.width + x) * 4)
      middleCount += 1
    }
  }
  const comparable = painted.width === native.width && painted.height === native.height
  let over16 = 0
  let labelOver16 = 0
  let labelCount = 0
  const labelTop = Math.floor(painted.height * 0.82)
  if (comparable) {
    for (let i = 0; i < painted.data.length; i += 4) {
      const d = channelDiff(painted.data, native.data, i)
      const inLabel = Math.floor(i / 4 / painted.width) >= labelTop
      if (d > 16) over16 += 1
      if (inLabel) {
        labelCount += 1
        if (d > 16) labelOver16 += 1
      }
    }
  }
  return {
    blot: { width: painted.width, height: painted.height },
    reference: { width: native.width, height: native.height },
    middleMeanDiff: middleSum / middleCount,
    pctOver16: comparable ? (over16 / (painted.width * painted.height)) * 100 : null,
    labelPctOver16: comparable ? (labelOver16 / labelCount) * 100 : null,
  }
}

test("draw blots: the script paints each gene's blot at the address the site computes, matching the card", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  const out = path.join(OUT, "draw-blots")
  mkdirSync(out, { recursive: true })
  const { server, origin } = await startPainterSite()
  try {
    execFileSync(
      process.execPath,
      ["scripts/draw-iconoplasm-blots.mjs", "--symbols", SYMBOLS.join(","), "--out", out],
      { cwd: ROOT, stdio: "inherit", timeout: 120000 },
    )
    const files = listFiles(out).filter((file) => file.endsWith(".webp"))
    const results = {}
    for (const symbol of SYMBOLS) {
      const card = await (await fetch(`${CDN}/genes/v3/${symbol}.json`)).json()
      const key = iconoplasmBlotObjectKey(symbol, iconoplasmBlotFingerprint(card))
      const file = files.find((candidate) => candidate.split(path.sep).join("/").endsWith(key))
      assert.ok(file, `${symbol}: no blot at ${key}; drew ${files.join(", ")}`)
      const bytes = readFileSync(file)
      assert.deepEqual(webpDimensions(bytes), { width: 768, height: 1024 }, `${symbol} size`)

      const reference = await renderReference(browser, origin, {
        symbol,
        full_name: card.full_name,
        portrait: { status: "published", asset_sha256: card.portrait.asset_sha256 },
      })
      writeFileSync(path.join(out, `${symbol}-reference.png`), reference)
      const page = await browser.newPage()
      try {
        await page.goto(`${origin}/painter.html`)
        const measured = await page.evaluate(measure, {
          blot: bytes.toString("base64"),
          reference: reference.toString("base64"),
          portraitUrl: `/portrait/${card.portrait.asset_sha256}.webp`,
        })
        results[symbol] = { key, bytes: bytes.length, ...measured }
      } finally {
        await page.close()
      }
    }
    writeFileSync(path.join(out, "measurements.json"), JSON.stringify(results, null, 2))
    for (const [symbol, result] of Object.entries(results)) {
      assert.ok(
        result.middleMeanDiff < 4,
        `${symbol}: the middle isn't the portrait (${result.middleMeanDiff})`,
      )
      assert.ok(
        result.pctOver16 < 3,
        `${symbol}: ${result.pctOver16}% of pixels differ from the card`,
      )
      assert.ok(
        result.labelPctOver16 < 6,
        `${symbol}: ${result.labelPctOver16}% of the label band differs from the card`,
      )
    }
  } finally {
    server.close()
    await browser.close()
  }
})
