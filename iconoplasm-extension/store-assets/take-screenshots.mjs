/**
 * Real Playwright screenshots: launches Chromium with the Iconoplasm extension
 * loaded, navigates to actual web pages, and captures the extension in action.
 *
 * Design decisions for store screenshots:
 * - Color pills (not underline): most visually striking highlight mode
 * - Image-only card (not simple): shows the portrait, maximum visual impact
 * - Tooltip appears FROM a hovered pill: shows the connection hover -> card
 * - Popup reflects these same settings so popup + page screenshots are coherent
 */
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dir = dirname(__filename);
const extDir = resolve(__dir, "..");
const outDir = __dir;

async function main() {
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
    // "Image only" card style
    await setupPage.click('label:has(input[value="image-only"][name="card-variant"])');
    await sleep(300);
    // Light tooltip theme
    await setupPage.click('label:has(input[value="light"][name="tooltip-theme"])');
    await sleep(500);

    await setupPage.close();
    console.log("Settings applied: pill highlights, image-only card, light theme");
  }

  // ----------------------------------------------------------------
  // Step 1: Navigate to a gene-rich page and wait for highlights
  // ----------------------------------------------------------------
  const page = ctx.pages()[0] || (await ctx.newPage());
  const consoleMsgs = [];
  page.on("console", (msg) => consoleMsgs.push(`[${msg.type()}] ${msg.text()}`));

  // NCBI Gene TP53 page: dense with gene symbols, automation-friendly
  // Try multiple URLs in case of transient connection issues.
  const genePages = [
    "https://www.ncbi.nlm.nih.gov/gene/7157",
    "https://pubmed.ncbi.nlm.nih.gov/37474810/",
    "https://www.genecards.org/cgi-bin/carddisp.pl?gene=TP53",
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
  // Step 2: Screenshot 1 -- gene pills on the page (no tooltip)
  // ----------------------------------------------------------------
  // Scroll to the Summary section where TP53 and related genes appear densely
  await page.evaluate(() => {
    const summaryHeader = [...document.querySelectorAll("th, dt, b, strong")].find(
      (el) => el.textContent.trim() === "Summary",
    );
    if (summaryHeader) {
      summaryHeader.scrollIntoView({ block: "start" });
      window.scrollBy(0, -60);
    } else {
      const genes = [...document.querySelectorAll(".iconoplasm-gene")];
      if (genes.length > 0) {
        const mid = genes[Math.floor(genes.length / 3)];
        mid.scrollIntoView({ block: "center" });
      }
    }
  });
  await sleep(600);

  await page.screenshot({
    path: resolve(outDir, "screenshot-1-highlight.png"),
    type: "png",
  });
  console.log("Saved screenshot-1-highlight.png (pills on page)");

  // ----------------------------------------------------------------
  // Step 3: Screenshot 2 -- hover a pill to show the image-only tooltip
  // ----------------------------------------------------------------
  const targetGene = await page.$(
    '.iconoplasm-gene[data-gene-label="TP53"], .iconoplasm-gene',
  );
  if (targetGene) {
    // Scroll the gene into the upper-middle of the viewport so the tooltip
    // appears below it, fully visible and nicely framed.
    await targetGene.evaluate((el) => {
      el.scrollIntoView({ block: "start" });
      window.scrollBy(0, -120);
    });
    await sleep(400);

    await targetGene.hover();
    // Wait for tooltip animation + API data + portrait load
    await sleep(4000);

    await page.screenshot({
      path: resolve(outDir, "screenshot-2-hovercard.png"),
      type: "png",
    });
    console.log("Saved screenshot-2-hovercard.png (pill hover -> image tooltip)");
  } else {
    console.log("WARN: No highlighted genes found for tooltip screenshot");
  }

  // ----------------------------------------------------------------
  // Step 4: Popup screenshots -- settings reflect the pill + image choices
  // ----------------------------------------------------------------
  if (extensionId) {
    const popupUrl = `chrome-extension://${extensionId}/popup.html`;
    const popupPage = await ctx.newPage();
    await popupPage.setViewportSize({ width: 420, height: 700 });
    await popupPage.goto(popupUrl, { waitUntil: "load", timeout: 10000 });
    await sleep(1500);

    // Screenshot 3: Appearance tab -- should show pill + image-only selected
    const shell3 = await popupPage.$(".popup-shell");
    if (shell3) {
      await shell3.screenshot({
        path: resolve(outDir, "screenshot-3-popup.png"),
        type: "png",
      });
      console.log("Saved screenshot-3-popup.png (Appearance: pills + image-only)");
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
  // Step 5: Promo images -- compose real screenshots into CWS promos
  // ----------------------------------------------------------------
  // Use a fresh page (not the extension context) for HTML compositing.
  // Read the screenshots we just saved as base64 data URIs.
  const { readFileSync } = await import("fs");
  const toDataUri = (f) =>
    "data:image/png;base64," + readFileSync(resolve(outDir, f)).toString("base64");

  const highlightUri = toDataUri("screenshot-1-highlight.png");
  const hovercardUri = toDataUri("screenshot-2-hovercard.png");
  const popupUri = toDataUri("screenshot-3-popup.png");

  // -- Small promo tile: 440 x 280 --
  const promoSmallPage = await ctx.newPage();
  await promoSmallPage.setViewportSize({ width: 440, height: 280 });
  await promoSmallPage.setContent(`<!DOCTYPE html>
<html><head><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 440px; height: 280px; overflow: hidden;
    background: #1a1a1a;
    font-family: system-ui, -apple-system, sans-serif;
    display: flex; align-items: center; justify-content: center;
    gap: 24px; padding: 24px 28px;
  }
  .text-side {
    flex: 0 0 180px; color: #f5f0e8; display: flex;
    flex-direction: column; gap: 8px; z-index: 1;
  }
  .text-side h1 {
    font-size: 22px; font-weight: 700; letter-spacing: -0.02em;
    line-height: 1.15; color: #fff;
  }
  .text-side p {
    font-size: 11.5px; line-height: 1.45; color: #a8a29e;
    font-weight: 400;
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
    object-position: left top;
  }
</style></head><body>
  <div class="text-side">
    <div class="badge">Chrome Extension</div>
    <h1>Iconoplasm</h1>
    <p>Gene portraits and colors on every page.
    Hover any gene symbol for instant context.</p>
  </div>
  <div class="preview">
    <img src="${hovercardUri}" />
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
    padding: 48px 72px; gap: 56px;
  }
  .text-col {
    flex: 0 0 380px; color: #f5f0e8;
    display: flex; flex-direction: column; gap: 16px;
  }
  .text-col h1 {
    font-size: 48px; font-weight: 700; letter-spacing: -0.03em;
    line-height: 1.05; color: #fff;
  }
  .text-col p {
    font-size: 17px; line-height: 1.5; color: #a8a29e;
    max-width: 340px;
  }
  .stat {
    font-size: 13px; color: #78716c; letter-spacing: 0.04em;
    text-transform: uppercase; font-weight: 500;
  }
  .previews {
    flex: 1; display: flex; gap: 20px; height: 100%;
    align-items: center;
  }
  .prev-card {
    border-radius: 10px; overflow: hidden;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  }
  .prev-card img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .prev-main {
    flex: 1; height: 100%;
  }
  .prev-main img { object-position: left center; }
  .prev-popup {
    flex: 0 0 220px; height: 80%;
  }
  .prev-popup img { object-position: center top; }
</style></head><body>
  <div class="text-col">
    <p class="stat">19,000+ gene portraits</p>
    <h1>Iconoplasm</h1>
    <p>Every human gene gets a unique color and portrait.
    Hover any gene symbol on any page for instant visual context.</p>
  </div>
  <div class="previews">
    <div class="prev-card prev-main">
      <img src="${hovercardUri}" />
    </div>
    <div class="prev-card prev-popup">
      <img src="${popupUri}" />
    </div>
  </div>
</body></html>`, { waitUntil: "load" });
  await sleep(500);
  await promoLargePage.screenshot({
    path: resolve(outDir, "promo-marquee.png"),
    type: "png",
  });
  console.log("Saved promo-marquee.png (1400x560)");
  await promoLargePage.close();

  await ctx.close();
  console.log("Done");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
