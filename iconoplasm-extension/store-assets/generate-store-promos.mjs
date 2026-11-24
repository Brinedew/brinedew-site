/**
 * Chrome Web Store promotional tile generator (Playwright edition)
 *
 * Renders promo-small.png (440x280) and promo-marquee.png (1400x560)
 * from screenshot-1-hovercard.png and screenshot-2-hovercard.png.
 *
 * Run:  node generate-store-promos.mjs
 */

import { chromium } from "playwright"
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))

function toDataUri(filename) {
  const buf = readFileSync(resolve(__dirname, filename))
  return "data:image/png;base64," + buf.toString("base64")
}

async function launchHeadless() {
  for (const opts of [
    { channel: "chrome", headless: true, chromiumSandbox: true },
    { channel: "msedge", headless: true, chromiumSandbox: true },
  ]) {
    try {
      return await chromium.launch(opts)
    } catch {
      // Try next installed browser channel.
    }
  }
  throw new Error("Could not launch Chromium, Chrome, or Edge")
}

function smallPromoHTML(cardUri) {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:440px;height:280px;overflow:hidden}
body{
  background:radial-gradient(circle at 75% 50%, #24211e 0%, #171513 65%);
  color:#f4eee6;
  font-family:'Inter',system-ui,-apple-system,sans-serif;
  display:flex;
  align-items:center;
  padding:20px 24px 20px 26px;
  gap:22px;
}
.copy{
  flex:1;
  display:flex;
  flex-direction:column;
  align-items:flex-start;
}
.badge{
  display:inline-block;
  background:#b85830;
  color:#fff7f0;
  font-size:9px;
  font-weight:700;
  letter-spacing:0.08em;
  text-transform:uppercase;
  padding:4px 8px;
  border-radius:4px;
  margin-bottom:10px;
}
h1{
  font-size:26px;
  font-weight:700;
  letter-spacing:-0.02em;
  line-height:1.1;
  color:#ffffff;
}
p{
  margin-top:8px;
  font-size:12px;
  line-height:1.45;
  color:#bfb6ac;
}
.shot{
  width:194px;
  height:244px;
  border-radius:10px;
  overflow:hidden;
  background:#ffffff;
  border:1px solid rgba(255,255,255,0.14);
  box-shadow:0 12px 28px rgba(0,0,0,0.45);
  flex-shrink:0;
}
.shot img{
  width:100%;
  height:100%;
  object-fit:cover;
  object-position:center 12%;
  display:block;
}
</style></head>
<body>
  <div class="copy">
    <span class="badge">Chrome Extension</span>
    <h1>Iconoplasm</h1>
    <p>Gene portraits and colors on every page. Hover any gene symbol for instant context.</p>
  </div>
  <div class="shot"><img src="${cardUri}" alt="CD4 hovercard preview"></div>
</body></html>`
}

function marqueePromoHTML(rhoUri, cd4Uri) {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1400px;height:560px;overflow:hidden}
body{
  background:radial-gradient(circle at 68% 48%, #25221e 0%, #171513 62%);
  color:#f4eee6;
  font-family:'Inter',system-ui,-apple-system,sans-serif;
  display:flex;
  align-items:center;
  padding:40px 56px 40px 72px;
  gap:54px;
}
.copy{
  flex:0 0 430px;
  display:flex;
  flex-direction:column;
  align-items:flex-start;
}
.eyebrow{
  font-size:13px;
  font-weight:600;
  letter-spacing:0.14em;
  text-transform:uppercase;
  color:#a89e93;
  margin-bottom:14px;
}
h1{
  font-size:56px;
  font-weight:700;
  letter-spacing:-0.03em;
  line-height:1.05;
  color:#ffffff;
}
p{
  margin-top:20px;
  font-size:21px;
  line-height:1.45;
  color:#bdb4aa;
  max-width:410px;
}
.cards{
  flex:1;
  display:flex;
  align-items:center;
  justify-content:flex-end;
  gap:24px;
}
.card{
  width:372px;
  height:482px;
  border-radius:14px;
  overflow:hidden;
  background:#ffffff;
  border:1px solid rgba(255,255,255,0.14);
  box-shadow:0 20px 48px rgba(0,0,0,0.48);
  flex-shrink:0;
}
.card img{
  width:100%;
  height:100%;
  object-fit:cover;
  object-position:center 10%;
  display:block;
}
</style></head>
<body>
  <div class="copy">
    <div class="eyebrow">19,000+ Gene Portraits</div>
    <h1>Iconoplasm</h1>
    <p>Every human gene gets a unique color and portrait. Hover any symbol on any page for instant context.</p>
  </div>
  <div class="cards">
    <div class="card"><img src="${rhoUri}" alt="RHO hovercard preview"></div>
    <div class="card"><img src="${cd4Uri}" alt="CD4 hovercard preview"></div>
  </div>
</body></html>`
}

async function main() {
  const rhoUri = toDataUri("screenshot-1-hovercard.png")
  const cd4Uri = toDataUri("screenshot-2-hovercard.png")
  const browser = await launchHeadless()
  try {
    const smallCtx = await browser.newContext({
      viewport: { width: 440, height: 280 },
      deviceScaleFactor: 1,
    })
    const smallPage = await smallCtx.newPage()
    await smallPage.setContent(smallPromoHTML(cd4Uri), { waitUntil: "networkidle" })
    await smallPage.evaluate(() => document.fonts.ready)
    await smallPage.screenshot({ path: resolve(__dirname, "promo-small.png"), type: "png" })
    await smallCtx.close()
    console.log("  promo-small.png")

    const marqueeCtx = await browser.newContext({
      viewport: { width: 1400, height: 560 },
      deviceScaleFactor: 1,
    })
    const marqueePage = await marqueeCtx.newPage()
    await marqueePage.setContent(marqueePromoHTML(rhoUri, cd4Uri), { waitUntil: "networkidle" })
    await marqueePage.evaluate(() => document.fonts.ready)
    await marqueePage.screenshot({ path: resolve(__dirname, "promo-marquee.png"), type: "png" })
    await marqueeCtx.close()
    console.log("  promo-marquee.png")
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
