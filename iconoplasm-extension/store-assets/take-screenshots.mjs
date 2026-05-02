/**
 * Real Playwright screenshots: launches Chromium with the Iconoplasm extension
 * loaded, navigates to actual web pages, and captures the extension in action.
 *
 * Design decisions for store screenshots:
 * - Color pills (not underline): most visually striking highlight mode
 * - Image-only card (not simple): shows the portrait, maximum visual impact
 * - Single hero screenshot shows pills + hovercard together (Wikipedia homeobox)
 * - Popup screenshots show the same settings so store listing is coherent
 *
 * Usage:
 *   node take-screenshots.mjs           # full run: extension + promos
 *   node take-screenshots.mjs --promo   # only regenerate promo images from
 *                                       # existing screenshots (no extension)
 */
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { readFileSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dir = dirname(__filename);
const extDir = resolve(__dir, "..");
const outDir = __dir;
const promoOnly = process.argv.includes("--promo");

async function main() {
  if (promoOnly) {
    console.log("Promo-only mode: compositing from existing screenshots...");
    await generatePromos();
    return;
  }
  const ctx = await chromium.launchPersistentContext("", {
    headless: false,
    args: [
      `--disable-extensions-except=${extDir}`,
      `--load-extension=${extDir}`,
      "--no-first-run",
      "--disable-popup-blocking",
    ],
    viewport: { width: 1280, height: 800 },
  });

  await sleep(2000);

  // ----------------------------------------------------------------
  // Step 0: Find the extension ID and set designer-curated settings
  //         BEFORE navigating to any content page.
  // ----------------------------------------------------------------
  let extensionId;
  for (const sw of ctx.serviceWorkers()) {
    const url = sw.url();
    if (url.includes("chrome-extension://")) {
      extensionId = new URL(url).hostname;
      break;
    }
  }
  if (!extensionId) {
    for (const bg of ctx.backgroundPages()) {
      if (bg.url().startsWith("chrome-extension://")) {
        extensionId = new URL(bg.url()).hostname;
        break;
      }
    }
  }
  if (!extensionId) {
    await sleep(3000);
    for (const sw of ctx.serviceWorkers()) {
      const url = sw.url();
      if (url.includes("chrome-extension://")) {
        extensionId = new URL(url).hostname;
        break;
      }
    }
  }
  console.log("Extension ID:", extensionId || "NOT FOUND");

  // Set the showcase settings via the popup so chrome.storage is populated
  // before the content script reads them on the next page load.
  if (extensionId) {
    const setupPage = await ctx.newPage();
    await setupPage.goto(`chrome-extension://${extensionId}/popup.html`, {
      waitUntil: "load",
      timeout: 10000,
    });
    await sleep(1000);

    // Click the label wrapping each radio (the input itself is visually hidden)
    // "Color pills" highlight mode
    await setupPage.click('label:has(input[value="pill"][name="highlight-mode"])');
    await sleep(300);
    // "Blot only" card style
    await setupPage.click('label:has(input[value="image-only"][name="card-variant"])');
    await sleep(300);
    await setupPage.close();
    console.log("Settings applied: pill highlights, blot-only card");
  }

  // ----------------------------------------------------------------
  // Step 1: Navigate to a gene-rich page and wait for highlights
  // ----------------------------------------------------------------
  const page = ctx.pages()[0] || (await ctx.newPage());
  const consoleMsgs = [];
  page.on("console", (msg) => consoleMsgs.push(`[${msg.type()}] ${msg.text()}`));

  // Wikipedia homeobox genes: dense table of HOX gene pills, very visual.
  // Fallback to NCBI if Wikipedia blocks automation.
  const genePages = [
    "https://en.wikipedia.org/wiki/Homeobox",
    "https://www.ncbi.nlm.nih.gov/gene/7157",
  ];
  let loaded = false;
  for (const url of genePages) {
    try {
      console.log(`Trying ${url}...`);
      await page.goto(url, { waitUntil: "load", timeout: 20000 });
      loaded = true;
      console.log(`Loaded: ${url}`);
      break;
    } catch (e) {
      console.log(`Failed: ${e.message.split("\n")[0]}`);
      await sleep(2000);
    }
  }
  if (!loaded) {
    console.error("Could not load any gene page. Exiting.");
    await ctx.close();
    process.exit(1);
  }

  // Wait for extension to fetch gene data + scan + highlight
  await sleep(12000);

  let highlightCount = await page.evaluate(
    () => document.querySelectorAll(".iconoplasm-gene").length,
  );
  console.log(`Found ${highlightCount} gene highlights`);

  if (highlightCount === 0) {
    console.log("Waiting 10 more seconds...");
    await sleep(10000);
    highlightCount = await page.evaluate(
      () => document.querySelectorAll(".iconoplasm-gene").length,
    );
    console.log(`After retry: ${highlightCount} highlights`);
  }

  // Dump extension console for diagnostics
  const iconoMsgs = consoleMsgs.filter((m) => m.includes("Iconoplasm"));
  for (const m of iconoMsgs) console.log("  " + m);

  // ----------------------------------------------------------------
  // Step 2: Screenshot 2 -- pills on page + hovercard in one frame
  //         (consolidated: no separate "pills-only" screenshot)
  // ----------------------------------------------------------------
  // Scroll to the "Human homeobox genes" section (dense HOX table).
  // Fallback: find the densest cluster of gene highlights.
  await page.evaluate(() => {
    const heading = [...document.querySelectorAll("h2, h3")].find((el) =>
      el.textContent.includes("Human homeobox genes"),
    );
    if (heading) {
      heading.scrollIntoView({ block: "start" });
      window.scrollBy(0, -20);
    } else {
      const genes = [...document.querySelectorAll(".iconoplasm-gene")];
      if (genes.length > 0) {
        const mid = genes[Math.floor(genes.length / 3)];
        mid.scrollIntoView({ block: "center" });
      }
    }
  });
  await sleep(600);

  // Hover a gene in the HOX table to trigger the portrait hovercard.
  // Prefer HOXB1 for a visually rich portrait; fall back to any gene.
  const targetGene = await page.$(
    '.iconoplasm-gene[data-gene-label="HOXB1"], ' +
    '.iconoplasm-gene[data-gene-label="HOXA1"], ' +
    '.iconoplasm-gene',
  );
  if (targetGene) {
    await targetGene.evaluate((el) => {
      el.scrollIntoView({ block: "start" });
      window.scrollBy(0, -80);
    });
    await sleep(400);
    await targetGene.hover();
    await sleep(4000); // tooltip animation + API + portrait load
  } else {
    console.log("WARN: No highlighted genes found for hovercard");
  }

  await page.screenshot({
    path: resolve(outDir, "screenshot-2-hovercard.png"),
    type: "png",
  });
  console.log("Saved screenshot-2-hovercard.png (pills + hovercard)");

  // ----------------------------------------------------------------
  // Step 4: Popup screenshots -- settings reflect the pill + blot choices
  // ----------------------------------------------------------------
  if (extensionId) {
    const popupUrl = `chrome-extension://${extensionId}/popup.html`;
    const popupPage = await ctx.newPage();
    await popupPage.setViewportSize({ width: 420, height: 700 });
    await popupPage.goto(popupUrl, { waitUntil: "load", timeout: 10000 });
    await sleep(1500);

    // Screenshot 3: Appearance tab -- should show pill + blot-only selected
    const shell3 = await popupPage.$(".popup-shell");
    if (shell3) {
      await shell3.screenshot({
        path: resolve(outDir, "screenshot-3-popup.png"),
        type: "png",
      });
      console.log("Saved screenshot-3-popup.png (Appearance: pills + blot-only)");
    }

    // Screenshot 4: Blocklist tab -- clip to viewport height, not full scroll
    await popupPage.click("#tab-blocklist");
    await sleep(800);
    await popupPage.screenshot({
      path: resolve(outDir, "screenshot-4-blocklist.png"),
      type: "png",
      clip: { x: 0, y: 0, width: 420, height: 700 },
    });
    console.log("Saved screenshot-4-blocklist.png");

    // Screenshot 5: Account tab
    await popupPage.click("#tab-account");
    await sleep(800);
    const shell5 = await popupPage.$(".popup-shell");
    if (shell5) {
      await shell5.screenshot({
        path: resolve(outDir, "screenshot-5-appearance.png"),
        type: "png",
      });
      console.log("Saved screenshot-5-appearance.png (Account tab)");
    }

    await popupPage.close();
  }

  // ----------------------------------------------------------------
  // Step 5: Promo images
  // ----------------------------------------------------------------
  await generatePromos(ctx);

  await ctx.close();
  console.log("Done");
}

/**
 * Generate promo tiles from existing screenshots. Works with or without
 * an extension browser context -- if none is passed, launches a plain
 * headless Chromium just for compositing.
 */
async function generatePromos(ctx) {
  const ownBrowser = !ctx;
  if (ownBrowser) {
    ctx = await chromium.launchPersistentContext("", {
      headless: true,
      args: ["--no-first-run"],
      viewport: { width: 800, height: 600 },
    });
  }

  const toDataUri = (f) =>
    "data:image/png;base64," + readFileSync(resolve(outDir, f)).toString("base64");

  const hovercard1Uri = toDataUri("screenshot-1-hovercard.png");
  const hovercard2Uri = toDataUri("screenshot-2-hovercard.png");

  // ---------------------------------------------------------------
  // Pixel math:
  //   s1 (RHO/UCSC):   575 x 802, ratio 0.717
  //   s2 (HOXB1/Wiki):  628 x 907, ratio 0.692
  //
  // SMALL TILE (440 x 280):
  //   Using s2 (denser pills, more visual). Preview ~194x232.
  //   cover: 17% vertical crop centered. Acceptable.
  //
  // MARQUEE (1400 x 560):
  //   Padding: 40px top/bottom, 64px left/right.
  //   Content: 1272 x 480.
  //   Text column: 320px. Gap: 48px. Preview area: 904 x 480.
  //   Two images in standardized 3:4 frames (portrait device ratio).
  //   Frame: 480 * 0.75 = 360px wide each. Gap: 24px.
  //   Total: 360 + 24 + 360 = 744px. Remaining 160px in 904px.
  //   Frames pushed right (flex-end) — space flows between text and frames.
  //
  //   s1 in 360x480 frame: cover scales width -> 360/575*802 = 502px tall.
  //   Crop = 502-480 = 22px (4.4%). Minimal — essentially uncropped.
  //
  //   s2 in 360x480 frame: cover scales width -> 360/628*907 = 520px tall.
  //   Crop = 520-480 = 40px (7.7%). Very mild — table header trimmed.
  // ---------------------------------------------------------------

  // -- Small promo tile: 440 x 280 --
  // The 0.84 preview ratio vs 0.69 source means only ~17% vertical
  // crop with cover. Acceptable — it shows the table + most of the card.
  const promoSmallPage = await ctx.newPage();
  await promoSmallPage.setViewportSize({ width: 440, height: 280 });
  await promoSmallPage.setContent(`<!DOCTYPE html>
<html><head><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 440px; height: 280px; overflow: hidden;
    background: #1a1a1a;
    font-family: system-ui, -apple-system, sans-serif;
    display: flex; align-items: center;
    gap: 20px; padding: 24px 28px;
  }
  .text-side {
    flex: 0 0 170px; color: #f5f0e8; display: flex;
    flex-direction: column; gap: 8px;
  }
  .text-side h1 {
    font-size: 22px; font-weight: 700; letter-spacing: -0.02em;
    line-height: 1.15; color: #fff;
  }
  .text-side p {
    font-size: 11.5px; line-height: 1.45; color: #a8a29e;
  }
  .badge {
    display: inline-block; background: #c06030; color: #fff;
    font-size: 9px; font-weight: 600; letter-spacing: 0.08em;
    text-transform: uppercase; padding: 3px 7px; border-radius: 3px;
    width: fit-content;
  }
  .preview {
    flex: 1; min-width: 0; height: 100%;
    border-radius: 8px; overflow: hidden;
    box-shadow: 0 4px 24px rgba(0,0,0,0.5);
  }
  .preview img {
    width: 100%; height: 100%; object-fit: cover;
    object-position: center center;
  }
</style></head><body>
  <div class="text-side">
    <div class="badge">Chrome Extension</div>
    <h1>Iconoplasm</h1>
    <p>Gene portraits and colors on every page.
    Hover any gene symbol for instant context.</p>
  </div>
  <div class="preview">
    <img src="${hovercard2Uri}" />
  </div>
</body></html>`, { waitUntil: "load" });
  await sleep(500);
  await promoSmallPage.screenshot({
    path: resolve(outDir, "promo-small.png"),
    type: "png",
  });
  console.log("Saved promo-small.png (440x280)");
  await promoSmallPage.close();

  // -- Large marquee: 1400 x 560 --
  // Two portrait screenshots in standardized 3:4 frames, side by side.
  // Frames are 360x480 each. s1 loses 4.4% crop, s2 loses 7.7%. Both mild.
  const promoLargePage = await ctx.newPage();
  await promoLargePage.setViewportSize({ width: 1400, height: 560 });
  await promoLargePage.setContent(`<!DOCTYPE html>
<html><head><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1400px; height: 560px; overflow: hidden;
    background: #1a1a1a;
    font-family: system-ui, -apple-system, sans-serif;
    display: flex; align-items: center;
    padding: 40px 64px; gap: 48px;
  }
  .text-col {
    flex: 0 0 320px; color: #f5f0e8;
    display: flex; flex-direction: column; gap: 14px;
  }
  .text-col h1 {
    font-size: 44px; font-weight: 700; letter-spacing: -0.03em;
    line-height: 1.05; color: #fff;
  }
  .text-col p {
    font-size: 16px; line-height: 1.5; color: #a8a29e;
    max-width: 300px;
  }
  .stat {
    font-size: 12px; color: #78716c; letter-spacing: 0.05em;
    text-transform: uppercase; font-weight: 500;
  }
  .previews {
    flex: 1; height: 100%;
    display: flex; align-items: center; justify-content: flex-end;
    gap: 24px;
  }
  .frame {
    width: 360px; height: 480px;
    border-radius: 10px; overflow: hidden;
    box-shadow:
      0 0 0 0.5px rgba(255,255,255,0.06),
      0 8px 32px rgba(0,0,0,0.5);
  }
  .frame img {
    display: block; width: 100%; height: 100%;
    object-fit: cover;
  }
  .frame.left img { object-position: center 8%; }
  .frame.right img { object-position: center top; }
</style></head><body>
  <div class="text-col">
    <p class="stat">19,000+ gene portraits</p>
    <h1>Iconoplasm</h1>
    <p>Every human gene gets a unique color and portrait.
    Hover any symbol on any page for instant context.</p>
  </div>
  <div class="previews">
    <div class="frame left"><img src="${hovercard1Uri}" /></div>
    <div class="frame right"><img src="${hovercard2Uri}" /></div>
  </div>
</body></html>`, { waitUntil: "load" });
  await sleep(500);
  await promoLargePage.screenshot({
    path: resolve(outDir, "promo-marquee.png"),
    type: "png",
  });
  console.log("Saved promo-marquee.png (1400x560)");
  await promoLargePage.close();

  if (ownBrowser) await ctx.close();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
