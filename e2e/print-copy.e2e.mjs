// B-1068: the print copy is painted in the reader's browser. A reader opens a
// gene page, presses the printer button beside the star, sees the print in a
// viewer, presses its Download button and gets one PNG: the
// published portrait at its own pixels, with the card's name, symbol and
// shading baked in, and no border (like every blot).
//
// Ways this can fail, written before the check:
// 1. The portrait is resampled: drawn through a scale, stretched to 3:4, or
//    pushed through the page's device pixel ratio. The unshaded middle of the
//    print (rows 0-55%, columns 19-81%) must equal the published portrait's own
//    pixels exactly.
// 2. The print is the wrong size: anything but the portrait's own height (or
//    width), trimmed to 3:4 the way the card's object-fit: cover trims it.
// 3. The label drifts from the card: wrong font, baseline, wrapping or shadow.
//    Compared with Chrome's own screenshot of the same borderless card at the
//    print's scale, fewer than 0.5% of pixels may differ by more than 16
//    levels. Measured 2026-10-11: the painter 0.34%; native Chrome against
//    native Firefox on the same card 0.53%.
// 4. The button leads nowhere: no viewer, no download, or a download with
//    another name.
//
// What is real: the built site, the published card and portrait for KDM6B
// (a 1536x2048 portrait, so the reference renders at an integer scale), the
// shared card stylesheet and fonts, and Chrome. Nothing is mocked except the
// signed-in /api/* calls, which an anonymous reader never needs. The print,
// the reference and the difference layer land in artifacts/e2e.
import assert from "node:assert/strict"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"

import { HOST, OUT, launchChrome, routeProduction, startSite } from "./harness.mjs"

const SYMBOL = "KDM6B"
const CDN = "https://img.brinedew.bio"

// The image-only card on its borderless 384x512 artboard, as the print
// copy and the blot lay it out.
const REFERENCE_PAGE = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/static/iconoplasm/generated/shared-card-label.css">
<script src="/static/iconoplasm/generated/shared-card-runtime.js"></script>
<style>html,body{margin:0;width:384px;height:512px;overflow:hidden;color-scheme:light;
--light:oklch(96% 0.015 75);--dark:oklch(20% 0.035 50);
--icono-label-type:"IBM Plex Mono";--icono-label-hand:"Caveat"}
#artboard>.icono-card{width:384px;height:512px;max-width:none;box-sizing:border-box;border:0}</style>
</head><body><main id="artboard"></main></body></html>`

// The site loads the card fonts through the FontFace API from this contract
// (quartz/components/Head.tsx), not from a stylesheet, so the reference page
// must do the same or Chrome draws its fallbacks.
const CARD_FONTS = JSON.parse(
  readFileSync(new URL("../shared/iconoplasm-card/font-contract.json", import.meta.url), "utf8"),
).fonts

async function renderReference(page, card) {
  return page.evaluate(
    async ({ card, fonts }) => {
      for (const font of fonts) {
        const face = new FontFace(font.family, `url("${font.url}") format("woff2")`, {
          weight: String(font.weight),
        })
        document.fonts.add(await face.load())
      }
      const shared = globalThis.IconoplasmCardShared
      const body = shared.renderLabLabelCardHtml(card, {
        layoutVariant: "image-only",
        mode: "brick",
        portraitAlt: `${card.symbol} blot`,
        portraitSrc: card.portrait.hero_url,
        titleHref: "",
        voteHtml: "",
      })
      document.getElementById("artboard").innerHTML =
        `<article class="icono-card icono-card--brick icono-card--variant-image-only" data-icono-card-variant="image-only" style="--width:384;--height:512;--icono-card-accent:${card.color || "#888888"}">${body}</article>`
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
}

// Runs in the page: decodes the three images the way the painter decodes the
// portrait and returns the measurements plus an x8 difference layer.
async function measure({ print, reference, portraitUrl }) {
  const decode = async (blob) => {
    const bitmap = await createImageBitmap(blob)
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext("2d")
    context.drawImage(bitmap, 0, 0)
    return {
      width: bitmap.width,
      height: bitmap.height,
      data: context.getImageData(0, 0, bitmap.width, bitmap.height).data,
    }
  }
  const fromDataUrl = async (url) => (await fetch(url)).blob()
  const [printed, native, portrait] = await Promise.all([
    decode(await fromDataUrl(print)),
    decode(await fromDataUrl(reference)),
    decode(await (await fetch(portraitUrl, { mode: "cors" })).blob()),
  ])
  const k = Math.min(portrait.width / 384, portrait.height / 512)
  const expected = { width: Math.round(384 * k), height: Math.round(512 * k) }
  const sx = Math.round((portrait.width - expected.width) / 2)
  const sy = Math.round((portrait.height - expected.height) / 2)
  let portraitMax = 0
  for (let y = 0; y < Math.floor(expected.height * 0.55); y += 1) {
    for (let x = Math.floor(expected.width * 0.19); x < Math.floor(expected.width * 0.81); x += 1) {
      const a = (y * printed.width + x) * 4
      const b = ((y + sy) * portrait.width + x + sx) * 4
      for (let c = 0; c < 3; c += 1)
        portraitMax = Math.max(portraitMax, Math.abs(printed.data[a + c] - portrait.data[b + c]))
    }
  }
  let over16 = 0
  const diff = new OffscreenCanvas(printed.width, printed.height)
  const diffContext = diff.getContext("2d")
  const layer = diffContext.createImageData(printed.width, printed.height)
  const comparable = printed.width === native.width && printed.height === native.height
  if (comparable) {
    for (let i = 0; i < printed.data.length; i += 4) {
      const d = Math.max(
        Math.abs(printed.data[i] - native.data[i]),
        Math.abs(printed.data[i + 1] - native.data[i + 1]),
        Math.abs(printed.data[i + 2] - native.data[i + 2]),
      )
      if (d > 16) over16 += 1
      layer.data[i] = layer.data[i + 1] = layer.data[i + 2] = Math.min(255, d * 8)
      layer.data[i + 3] = 255
    }
  }
  diffContext.putImageData(layer, 0, 0)
  const diffBlob = await diff.convertToBlob({ type: "image/png" })
  const diffUrl = await new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.readAsDataURL(diffBlob)
  })
  return {
    print: { width: printed.width, height: printed.height },
    reference: { width: native.width, height: native.height },
    expected,
    portraitMax,
    labelPctOver16: comparable ? (over16 / (printed.width * printed.height)) * 100 : null,
    diffUrl,
  }
}

test("print copy: the downloaded PNG is the portrait's own pixels with the card's label baked in", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  const { server, origin } = await startSite()
  try {
    mkdirSync(OUT, { recursive: true })
    const card = await (await fetch(`${CDN}/genes/v3/${SYMBOL}.json`)).json()
    const portraitUrl = card.portrait.hero_url

    // The reader: an anonymous visitor on a 2x screen, so the page's own
    // pixel ratio can't be what sets the print's size.
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      deviceScaleFactor: 2,
      acceptDownloads: true,
    })
    await routeProduction(context, origin, () => undefined, { session: false })
    // Published portraits are real production reads, not files of the build.
    await context.route(`${HOST}/portraits/**`, (route) => route.continue())
    const page = await context.newPage()
    await page.goto(`${HOST}/gene/${SYMBOL}`)
    const button = page.locator(`[data-icono-print-copy-symbol="${SYMBOL}"]`).first()
    await button.waitFor({ state: "visible", timeout: 30000 })
    await page.waitForFunction(
      (symbol) =>
        document
          .querySelector(`[data-icono-print-copy-symbol="${symbol}"]`)
          ?.getAttribute("data-icono-print-copy-state") === "idle",
      SYMBOL,
      { timeout: 30000 },
    )
    assert.equal(await button.getAttribute("aria-label"), `Print copy of ${SYMBOL}`)
    await button.click()
    // The print opens in the viewer first; nothing lands on disk unasked.
    const viewerImage = page.locator(".pswp .pswp__img").first()
    await viewerImage.waitFor({ state: "visible", timeout: 60000 })
    assert.match(String(await viewerImage.getAttribute("src")), /^blob:/)
    const saveButton = page.locator(".pswp [data-icono-print-copy-download]")
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 60000 }),
      saveButton.click(),
    ])
    assert.equal(download.suggestedFilename(), `${SYMBOL}-iconoplasm-print-copy.png`)
    const printPath = path.join(OUT, `print-copy-${SYMBOL}.png`)
    await download.saveAs(printPath)
    const portraitSize = await page.evaluate(async (url) => {
      const bitmap = await createImageBitmap(await (await fetch(url, { mode: "cors" })).blob())
      return { width: bitmap.width, height: bitmap.height }
    }, portraitUrl)
    await context.close()

    // The reference: Chrome's own screenshot of the same borderless card at
    // the print's scale (a 1536x2048 portrait: 4).
    const portraitScale = Math.min(portraitSize.width / 384, portraitSize.height / 512)
    const referenceContext = await browser.newContext({
      viewport: { width: 384, height: 512 },
      deviceScaleFactor: portraitScale,
    })
    await routeProduction(referenceContext, origin, () => undefined, { session: false })
    await referenceContext.route(`${HOST}/portraits/**`, (route) => route.continue())
    await referenceContext.route(`${HOST}/__print-copy-reference`, (route) =>
      route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: REFERENCE_PAGE }),
    )
    const referencePage = await referenceContext.newPage()
    await referencePage.goto(`${HOST}/__print-copy-reference`)
    await renderReference(referencePage, card)
    const reference = await referencePage.screenshot({ type: "png", scale: "device" })
    writeFileSync(path.join(OUT, `print-copy-${SYMBOL}-reference.png`), reference)

    const result = await referencePage.evaluate(measure, {
      print: `data:image/png;base64,${readFileSync(printPath).toString("base64")}`,
      reference: `data:image/png;base64,${reference.toString("base64")}`,
      portraitUrl,
    })
    await referenceContext.close()
    writeFileSync(
      path.join(OUT, `print-copy-${SYMBOL}-diff.png`),
      Buffer.from(result.diffUrl.split(",")[1], "base64"),
    )
    const { diffUrl, ...measured } = result
    writeFileSync(path.join(OUT, `print-copy-${SYMBOL}.json`), JSON.stringify(measured, null, 2))

    assert.deepEqual(
      measured.print,
      measured.expected,
      "the print is the portrait's own size, trimmed to 3:4",
    )
    assert.equal(
      measured.portraitMax,
      0,
      "the unshaded portrait area is the published portrait's own pixels",
    )
    assert.notEqual(measured.labelPctOver16, null, "the reference has the print's size")
    assert.ok(
      measured.labelPctOver16 < 0.5,
      `the label matches Chrome's own card: ${measured.labelPctOver16.toFixed(3)}% of pixels differ by more than 16`,
    )
  } finally {
    await browser.close()
    server.close()
  }
})
