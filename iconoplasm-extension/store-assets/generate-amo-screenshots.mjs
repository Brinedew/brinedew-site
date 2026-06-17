/**
 * AMO store-screenshot generator  (Playwright edition)
 *
 * Renders 1280x800 branded slides for the Firefox Add-on Marketplace.
 * Uses Playwright so text wraps via real CSS -- no SVG hacks, no overlap.
 *
 * Run:  node generate-amo-screenshots.mjs
 *
 * Design constraints & why they exist:
 *   - Two-column flexbox: text and frame are siblings, cannot overlap.
 *   - Single accent color (brand teal #4bb8ad) across all slides.
 *     The brand only has teal + rust; per-slide rainbow was off-palette.
 *   - Fonts: Crimson Pro (brand serif) for title + body,
 *     IBM Plex Mono (brand mono, Google Fonts stand-in for Monaspace Xenon).
 *   - No decorative chrome: no glow, no corner blobs, no branding bar,
 *     no "DESKTOP FIREFOX" label. The card and text do the work.
 *   - object-fit:cover with aspect-matched frames so screenshots fill
 *     fully -- no paper-colored letterbox gaps.
 */

import { chromium } from "playwright"
import { readFileSync, mkdirSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(__dirname, "amo")
mkdirSync(outDir, { recursive: true })

const W = 1280
const H = 800

/* ------------------------------------------------------------------
 *  Brand tokens
 *
 *  Pulled from the extension's actual CSS:
 *    popup.css   --dark: oklch(20% 0.035 50)  ~= #211c18
 *    popup.css   --accent: oklch(50% 0.08 185) ~= #4bb8ad
 *    content.css --iconoplasm-tooltip-ink: #211c18
 *    content.css --iconoplasm-tooltip-surface: rgba(248,244,236,0.99)
 *    shared-card-vote.css  approve: #4bb8ad
 * ------------------------------------------------------------------ */
const pal = {
  bg: "#151210", // slightly deeper than tooltip-dark-shell for poster weight
  text: "#f4eee6", // warm off-white (tooltip-ink inverted)
  muted: "#a09486", // warm mid-gray for kicker-ish uses
  body: "#c4b8aa", // warmer, brighter than muted -- readable at 36px
  accent: "#4bb8ad", // brand teal -- the ONE accent color
  paper: "#f3eadc", // card background (tooltip-light-shell area)
  paperInner: "#f8f2ea", // content inset
  border: "#d2c1aa", // card outline
}

/* ------------------------------------------------------------------
 *  Slide definitions
 *
 *  Frame inner dimensions are aspect-matched to each source image so
 *  object-fit:cover fills the frame with <3% crop (no letterboxing).
 *
 *  Source dimensions (from take-screenshots.mjs):
 *    screenshot-1-hovercard.png  575 x 802  (UCSC genome browser + RHO)
 *    screenshot-2-hovercard.png  628 x 907  (Wikipedia homeobox + HOXB1)
 *    screenshot-6-archive.png    750 x 1057 (archive lab-label card)
 *
 *  Only 3 slides -- showcase the selling points (hovercards, portraits,
 *  archive) not settings/blocklist UI that nobody cares about in a store.
 * ------------------------------------------------------------------ */
const slides = [
  {
    input: "screenshot-2-hovercard.png",
    output: "amo-screenshot-1-hovercard.png",
    kicker: "Firefox Add-on",
    title: "Hover any gene symbol",
    body: "Color-coded markers and portrait cards appear while you read papers, wikis, and notes.",
    // 628:907 ratio = 0.692.  Max inner height ~688, width = 688*0.692 = 476
    innerW: 476,
    innerH: 688,
    imgPos: "center 10%",
  },
  {
    input: "screenshot-1-hovercard.png",
    output: "amo-screenshot-2-hovercard-alt.png",
    kicker: "Gene Portraits",
    title: "Same symbol, same face",
    body: "Repeated genes keep their color and portrait so you recognize them at a glance.",
    // 575:802 ratio = 0.717.  innerH ~688, width = 688*0.717 = 493
    innerW: 493,
    innerH: 688,
    imgPos: "center 12%",
  },
  {
    input: "screenshot-6-archive.png",
    output: "amo-screenshot-3-archive.png",
    kicker: "Lab Archive",
    title: "Build a visual library",
    body: "Every gene you encounter is catalogued with its portrait, molecular data, and source context.",
    // 750:1057 ratio = 0.709.  innerH ~688, width = 688*0.709 = 488
    innerW: 488,
    innerH: 688,
    imgPos: "center 15%",
  },
]

/* ------------------------------------------------------------------
 *  Helpers
 * ------------------------------------------------------------------ */
function toDataUri(filename) {
  const buf = readFileSync(resolve(__dirname, filename))
  return "data:image/png;base64," + buf.toString("base64")
}

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/* ------------------------------------------------------------------
 *  HTML template
 *
 *  Layout: [ text 400px fixed ] | [ card column flex-1 ]
 *  Both are flex children -- geometrically cannot overlap.
 *  No absolute-positioned decorations that span columns.
 * ------------------------------------------------------------------ */
function slideHTML(slide, imgUri) {
  const pad = 12 // frame padding around the screenshot
  const bdr = 1 // frame border
  const frameW = slide.innerW + (pad + bdr) * 2
  const frameH = slide.innerH + (pad + bdr) * 2

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Crimson+Pro:wght@300;700&family=IBM+Plex+Mono:wght@500&display=swap"
      rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${W}px;height:${H}px;overflow:hidden}

body{
  background:${pal.bg};
  display:flex;
}

/* ---- text column ---- */
.text-col{
  flex:0 0 460px;
  padding:0 0 0 72px;
  display:flex;
  flex-direction:column;
  justify-content:center;
}

.kicker{
  font-family:'IBM Plex Mono',monospace;
  font-size:11px;font-weight:500;
  letter-spacing:2.4px;text-transform:uppercase;
  color:${pal.accent};
}

.title{
  margin-top:20px;
  font-family:'Crimson Pro',Georgia,serif;
  font-size:50px;font-weight:700;
  letter-spacing:-0.02em;line-height:1.1;
  color:${pal.text};
  max-width:400px;
  overflow-wrap:break-word;
}

.body-text{
  margin-top:24px;
  font-family:'Crimson Pro',Georgia,serif;
  font-size:36px;font-weight:300;
  line-height:1.35;
  color:${pal.body};
  max-width:370px;
}

/* ---- card column ---- */
.shot-col{
  flex:1;
  display:flex;
  align-items:center;
  justify-content:center;
  padding:40px 52px 40px 40px;
}

.frame{
  width:${frameW}px;height:${frameH}px;
  background:${pal.paper};
  border:${bdr}px solid ${pal.border};
  border-radius:14px;
  padding:${pad}px;
  box-shadow:
    0 4px 12px rgba(0,0,0,0.18),
    0 16px 40px rgba(0,0,0,0.28);
}

.frame-inner{
  width:${slide.innerW}px;height:${slide.innerH}px;
  border-radius:8px;overflow:hidden;
  background:${pal.paperInner};
}

.frame-inner img{
  display:block;
  width:100%;height:100%;
  object-fit:cover;
  object-position:${slide.imgPos || "center"};
}
</style></head>
<body>
  <div class="text-col">
    <span class="kicker">${esc(slide.kicker)}</span>
    <h1 class="title">${esc(slide.title)}</h1>
    <p class="body-text">${esc(slide.body)}</p>
  </div>
  <div class="shot-col">
    <div class="frame">
      <div class="frame-inner">
        <img src="${imgUri}">
      </div>
    </div>
  </div>
</body></html>`
}

/* ------------------------------------------------------------------
 *  Main
 * ------------------------------------------------------------------ */
async function main() {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
  })

  for (const slide of slides) {
    const imgUri = toDataUri(slide.input)
    const page = await ctx.newPage()
    await page.setContent(slideHTML(slide, imgUri), {
      waitUntil: "networkidle",
    })
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({
      path: resolve(outDir, slide.output),
      type: "png",
    })
    console.log("  " + slide.output)
    await page.close()
  }

  await browser.close()
  console.log("\nDone -- " + slides.length + " AMO screenshots in " + outDir)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
