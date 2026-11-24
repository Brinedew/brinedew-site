/**
 * Captures CD4-based marketing screenshots (Chrome Web Store + AMO source)
 * and Brinedew getting-started docs screenshots (WebP with numbered callouts).
 *
 * Run from d:\Coding\Website\iconoplasm-extension\store-assets:
 *   node capture-cd4-marketing.mjs
 */

import { chromium } from "playwright"
import { mkdtempSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path, { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, "..", "..")
const extPath = resolve(repoRoot, "iconoplasm-extension")
const attachmentsDir = resolve(repoRoot, "content", "Attachments")
const sharp = createRequire(resolve(repoRoot, "package.json"))("sharp")

async function launchEdgeWithExtension(userDataDir) {
  const args = [
    `--disable-extensions-except=${extPath}`,
    `--load-extension=${extPath}`,
    "--no-first-run",
    "--no-default-browser-check",
  ]
  for (const opts of [
    { channel: "msedge", headless: true, chromiumSandbox: true, args },
    { channel: "msedge", headless: false, chromiumSandbox: true, args },
  ]) {
    try {
      const context = await chromium.launchPersistentContext(userDataDir, {
        ...opts,
        viewport: { width: 1280, height: 1100 },
        deviceScaleFactor: 2,
      })
      let worker = context.serviceWorkers()[0]
      if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 30000 })
      return { context, worker }
    } catch {
      // Try next Edge mode.
    }
  }
  throw new Error("Could not launch Edge with the unpacked extension")
}

async function waitForLoadedExtension(context, worker) {
  const extensionId = new URL(worker.url()).host
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extensionId}/popup.html`)
  await popup.evaluate(() => chrome.storage.local.set({ iconoplasm_card_variant: "image-only" }))
  await popup.waitForFunction(
    async () =>
      Number(
        (await chrome.storage.local.get(["iconoplasm_gene_count"])).iconoplasm_gene_count || 0,
      ) > 0,
    null,
    { timeout: 60000, polling: 500 },
  )
  await popup.close()
}

async function hoverCd4AndWaitForCard(page) {
  // Hide Wikipedia TOC/appearance sidebars so the CD table fills the capture cleanly.
  await page.addStyleTag({
    content: `
      .mwe-popups,
      .vector-column-start,
      #vector-toc-pinned-container,
      .vector-column-end,
      .vector-header-container,
      .vector-sticky-header,
      #p-lang-btn { display: none !important; }
      .mw-page-container {
        max-width: none !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      .mw-page-container-inner {
        display: block !important;
        padding: 0 18px !important;
        margin: 0 !important;
        max-width: none !important;
      }
      .mw-content-container, #content, .mw-body, #mw-content-text {
        margin: 0 !important;
        padding: 0 !important;
        max-width: 900px !important;
      }
    `,
  })
  await page.waitForTimeout(300)

  const scrollTargetY = await page.evaluate(() => {
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let node
    while ((node = walk.nextNode())) {
      if (/\bCD4\b/.test(node.nodeValue || "") && node.parentElement?.closest("table.wikitable")) {
        const r = node.parentElement.getBoundingClientRect()
        return Math.max(0, Math.round(window.scrollY + r.top - 165))
      }
    }
    return 750
  })
  await page.evaluate((y) => window.scrollTo(0, y), scrollTargetY)
  await page.waitForTimeout(1200)

  const cd4Center = await page.evaluate(() => {
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let node
    while ((node = walk.nextNode())) {
      const m = /\bCD4\b/.exec(node.nodeValue || "")
      if (m && node.parentElement?.closest("table.wikitable")) {
        const range = document.createRange()
        range.setStart(node, m.index)
        range.setEnd(node, m.index + 3)
        const r = range.getBoundingClientRect()
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, box: r.toJSON() }
      }
    }
    throw new Error("Could not find CD4 inside Wikipedia table")
  })

  // Hover smoothly onto CD4 and trigger extension fetch/mount
  const deadline = Date.now() + 45000
  for (;;) {
    await page.mouse.move(cd4Center.x - 60, cd4Center.y + 40)
    await page.mouse.move(cd4Center.x, cd4Center.y, { steps: 6 })
    const visible = await page
      .locator(".iconoplasm-tooltip.iconoplasm-tooltip-visible")
      .isVisible()
      .catch(() => false)
    if (visible) break
    if (Date.now() > deadline) throw new Error("CD4 hovercard did not appear")
    await page.waitForTimeout(800)
  }

  // Wait for the frame inside the tooltip to finish rendering the portrait image
  const frame = page.frameLocator(".iconoplasm-tooltip.iconoplasm-tooltip-visible iframe")
  await frame.locator(".icono-image-only-symbol").waitFor({ state: "visible", timeout: 30000 })
  await frame.locator(".icono-image-only-media-stage img").evaluate(async (img) => {
    if (!img.complete) {
      await new Promise((res) => {
        img.addEventListener("load", res, { once: true })
        img.addEventListener("error", res, { once: true })
        setTimeout(res, 15000)
      })
    }
    if (img.decode) await img.decode().catch(() => {})
  })
  await page.waitForTimeout(600)

  const layout = await page.evaluate(() => {
    const tt = document.querySelector(".iconoplasm-tooltip.iconoplasm-tooltip-visible")
    const ttBox = tt?.getBoundingClientRect().toJSON() || null
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let tableBox = null
    let pillBox = null
    let extraCandidates = []
    let node
    while ((node = walk.nextNode())) {
      const txt = node.nodeValue || ""
      const tdTable = node.parentElement?.closest("table.wikitable")
      if (!tdTable) continue
      if (!tableBox) tableBox = tdTable.getBoundingClientRect().toJSON()
      if (!pillBox && /\bCD4\b/.test(txt)) {
        const m = /\bCD4\b/.exec(txt)
        const range = document.createRange()
        range.setStart(node, m.index)
        range.setEnd(node, m.index + 3)
        const r = range.getBoundingClientRect()
        if (r.top >= 40 && r.bottom <= window.innerHeight - 40) pillBox = r.toJSON()
      } else if (/^CD(?:8a|8b|8|9|5|6|7)\b/.test(txt.trim())) {
        const r = node.parentElement.getBoundingClientRect()
        if (r.top >= 40 && r.bottom <= window.innerHeight - 40) {
          extraCandidates.push({ text: txt.trim(), rect: r.toJSON() })
        }
      }
    }
    const extraBelow =
      extraCandidates.find((c) => ttBox && c.rect.top >= ttBox.bottom + 4) ||
      extraCandidates.find((c) => c.rect.top >= 30) ||
      null
    return {
      table: tableBox,
      tooltip: ttBox,
      pill: pillBox,
      extra: extraBelow?.rect || null,
    }
  })

  return layout
}

async function injectCallouts(page, items) {
  await page.evaluate((list) => {
    document.getElementById("__cd4-doc-callouts")?.remove()
    const root = document.createElement("div")
    root.id = "__cd4-doc-callouts"
    root.style.cssText =
      "position:fixed;inset:0;pointer-events:none;z-index:2147483647;font-family:system-ui,-apple-system,sans-serif;"

    for (const item of list) {
      if (item.box) {
        const pad = item.pad ?? 4
        const box = document.createElement("div")
        box.style.cssText = `
          position:fixed;
          left:${item.box.left - pad}px;
          top:${item.box.top - pad}px;
          width:${item.box.width + pad * 2}px;
          height:${item.box.height + pad * 2}px;
          border:2.5px solid #166a5f;
          border-radius:6px;
          box-sizing:border-box;
        `
        root.appendChild(box)
      }
      const badge = document.createElement("div")
      badge.textContent = String(item.num)
      badge.style.cssText = `
        position:fixed;
        left:${item.cx - 14}px;
        top:${item.cy - 14}px;
        width:28px;
        height:28px;
        border-radius:999px;
        background:#166a5f;
        color:#ffffff;
        font-size:15px;
        font-weight:700;
        display:flex;
        align-items:center;
        justify-content:center;
        border:2px solid #ffffff;
        box-shadow:0 2px 6px rgba(0,0,0,0.28);
      `
      root.appendChild(badge)
    }
    document.body.appendChild(root)
  }, items)
}

async function clearCallouts(page) {
  await page.evaluate(() => document.getElementById("__cd4-doc-callouts")?.remove())
}

async function saveClippedWebp(page, clip, outPath, targetWidth = 1600) {
  const pngBuf = await page.screenshot({ clip, type: "png" })
  await sharp(pngBuf)
    .resize({ width: targetWidth, kernel: sharp.kernel.lanczos3 })
    .webp({ quality: 92 })
    .toFile(outPath)
}

async function main() {
  const userDataDir = mkdtempSync(path.join(tmpdir(), "iconoplasm-cd4-capture-"))
  const { context, worker } = await launchEdgeWithExtension(userDataDir)
  try {
    await waitForLoadedExtension(context, worker)

    // 1. Wikipedia table + CD4 hovercard (store screenshot-2-hovercard.png + docs wikipedia webp)
    const wikiPage = await context.newPage()
    await wikiPage.setViewportSize({ width: 1280, height: 1100 })
    await wikiPage.goto("https://en.wikipedia.org/wiki/List_of_human_clusters_of_differentiation", {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    })
    await wikiPage.waitForTimeout(3500)
    const wikiLayout = await hoverCd4AndWaitForCard(wikiPage)
    console.log("Wiki layout:", JSON.stringify(wikiLayout))

    // Store screenshot-2-hovercard.png (exact 628x907)
    const tt = wikiLayout.tooltip
    const pill = wikiLayout.pill
    const tableLeft = wikiLayout.table?.left ?? pill.left
    const storeW = 628
    const storeH = 907
    const minTop = Math.min(tt.top, pill.top)
    const maxBottom = Math.max(tt.bottom, pill.bottom)
    const centerY = (minTop + maxBottom) / 2
    const storeClip = {
      x: Math.max(0, Math.min(1280 - storeW, Math.round(Math.min(tableLeft - 14, tt.left - 18)))),
      y: Math.max(0, Math.min(1100 - storeH, Math.round(centerY - storeH / 2))),
      width: storeW,
      height: storeH,
    }
    const storePng = await wikiPage.screenshot({ clip: storeClip, type: "png" })
    await sharp(storePng)
      .resize(storeW, storeH)
      .png()
      .toFile(resolve(__dirname, "screenshot-2-hovercard.png"))
    console.log("  wrote store screenshot-2-hovercard.png")

    // Docs iconoplasm-start-wikipedia.webp (1600w landscape showing full table + card + 1/2/3 badges)
    const docClipW = 920
    const docClipH = 796
    const docMinX = Math.min(tt.left, pill.left, tableLeft)
    const docClip = {
      x: Math.max(0, Math.min(1280 - docClipW, Math.round(docMinX - 24))),
      y: Math.max(0, Math.min(1100 - docClipH, Math.round(centerY - docClipH / 2))),
      width: docClipW,
      height: docClipH,
    }
    const extraPill = wikiLayout.extra
    const calloutsWiki = [
      {
        num: 1,
        cx: Math.round(pill.left + pill.width + 22),
        cy: Math.round(pill.top + pill.height / 2),
      },
      {
        num: 2,
        cx: Math.round(tt.right + 20),
        cy: Math.round(tt.top + 42),
      },
      {
        num: 3,
        cx: Math.round((extraPill?.right ?? pill.right) + 22),
        cy: Math.round(extraPill ? extraPill.top + extraPill.height / 2 : tt.bottom + 24),
      },
    ]
    await injectCallouts(wikiPage, calloutsWiki)
    await saveClippedWebp(
      wikiPage,
      docClip,
      resolve(attachmentsDir, "iconoplasm-start-wikipedia.webp"),
      1600,
    )
    console.log("  wrote iconoplasm-start-wikipedia.webp")
    await wikiPage.close()

    // 2. CD4 gene page + accession sheet (live https://iconoplasm.brinedew.bio/gene/CD4)
    const genePage = await context.newPage()
    await genePage.setViewportSize({ width: 1280, height: 1100 })
    await genePage.goto("https://iconoplasm.brinedew.bio/gene/CD4", {
      waitUntil: "networkidle",
      timeout: 45000,
    })
    await genePage.evaluate(() => document.fonts.ready)
    await genePage.waitForFunction(
      () =>
        [
          ...document.querySelectorAll(".icono-card--variant-lab-label .icono-vote-btn--approve"),
        ].some((el) => {
          const b = el.getBoundingClientRect()
          return b.width > 0 && b.height > 0
        }),
      null,
      { timeout: 15000 },
    )
    await genePage.waitForTimeout(800)

    const geneBoxes = await genePage.evaluate(() => {
      const card = [...document.querySelectorAll(".icono-card--variant-lab-label")].find((el) => {
        const b = el.getBoundingClientRect()
        return b.width > 0 && b.height > 0
      })
      const visibleRect = (sel, root = document) => {
        for (const el of root.querySelectorAll(sel)) {
          const b = el.getBoundingClientRect()
          if (b.width > 0 && b.height > 0) return b.toJSON()
        }
        return null
      }
      const favBtn =
        [...document.querySelectorAll("[aria-label*='favorite']")]
          .map((el) => el.getBoundingClientRect())
          .find((b) => b.width > 0 && b.height > 0)
          ?.toJSON() || null
      const printBtn =
        [...document.querySelectorAll("[aria-label*='Print']")]
          .map((el) => el.getBoundingClientRect())
          .find((b) => b.width > 0 && b.height > 0)
          ?.toJSON() || null
      const addBtn =
        [...document.querySelectorAll("button")]
          .find(
            (b) =>
              /add portraits|new candidate/i.test(b.textContent || "") &&
              b.getBoundingClientRect().width > 0,
          )
          ?.getBoundingClientRect()
          .toJSON() || null
      const voteReject = visibleRect(".icono-vote-btn--reject", card)
      const voteApprove = visibleRect(".icono-vote-btn--approve", card)
      const tabs = [...document.querySelectorAll(".icono-gene-tab")].filter(
        (el) => el.getBoundingClientRect().width > 0,
      )
      const bandCells = [...(card?.querySelectorAll(".icono-label-band-cell") || [])].filter(
        (el) => el.getBoundingClientRect().width > 0,
      )
      const swatchArea = visibleRect(".icono-label-specimen-decomposition", card)
      const colorRow = visibleRect(".icono-label-specimen-color-row", card)
      const styleStack = [
        ...(card?.querySelectorAll(".icono-label-style-row .icono-label-style-stack") || []),
      ].find((el) => el.getBoundingClientRect().width > 0)
      const styleChildren = [...(styleStack?.children || [])]
      const familyTrait = visibleRect(".icono-label-family-trait-field", card)
      const alignmentBody = visibleRect(".icono-label-alignment-body", card)

      const r = (el) => {
        if (!el) return null
        if ("left" in el && "width" in el && typeof el.getBoundingClientRect !== "function")
          return el
        const b = el.getBoundingClientRect()
        return b && b.width > 0 && b.height > 0 ? b.toJSON() : null
      }
      const union = (a, b) =>
        a && b
          ? {
              left: Math.min(a.left, b.left),
              top: Math.min(a.top, b.top),
              right: Math.max(a.right, b.right),
              bottom: Math.max(a.bottom, b.bottom),
              width: Math.max(a.right, b.right) - Math.min(a.left, b.left),
              height: Math.max(a.bottom, b.bottom) - Math.min(a.top, b.top),
            }
          : a || b

      const voteBox = union(voteReject, voteApprove)
      const pfamBox = styleChildren.length
        ? styleChildren.slice(0, 2).reduce((acc, el) => union(acc, r(el)), null)
        : r(styleStack)
      if (pfamBox && pfamBox.height > 88) pfamBox.height = 88

      const alignText = visibleRect(
        ".icono-label-alignment-row .icono-label-alignment-body span, .icono-label-alignment-row .icono-label-alignment-body > *",
        card,
      )
      const alignBox = alignText || alignmentBody

      return {
        card: r(card),
        favBtn,
        printBtn,
        addBtn,
        voteBox,
        tabs: tabs.length ? union(r(tabs[0]), r(tabs[tabs.length - 1])) : null,
        specimenMeta: union(colorRow, swatchArea),
        category: r(bandCells[0]),
        firstNoted: r(bandCells[1]),
        mass: r(bandCells[2]),
        pfam: pfamBox,
        familyTrait,
        alignment: alignBox,
      }
    })
    console.log("Gene boxes voteBox:", JSON.stringify(geneBoxes.voteBox))

    const card = geneBoxes.card
    const sheetClip = {
      x: Math.max(0, Math.round(card.left - 24)),
      y: Math.max(0, Math.round(card.top - 22)),
      width: Math.round(card.width + 64),
      height: Math.round(card.height + 44),
    }

    // (a) Gene page screenshot
    const pageClip = {
      x: Math.max(0, Math.round(card.left - 36)),
      y: Math.max(0, Math.round(card.top - 18)),
      width: Math.round(card.width + 80),
      height: Math.round((geneBoxes.tabs?.bottom || card.bottom + 100) - (card.top - 18) + 22),
    }
    const pageCallouts = [
      geneBoxes.favBtn && {
        num: 1,
        cx: Math.round(geneBoxes.favBtn.left - 18),
        cy: Math.round(geneBoxes.favBtn.top + geneBoxes.favBtn.height / 2),
      },
      geneBoxes.printBtn && {
        num: 2,
        cx: Math.round(geneBoxes.printBtn.right + 18),
        cy: Math.round(geneBoxes.printBtn.top + geneBoxes.printBtn.height / 2),
      },
      geneBoxes.addBtn && {
        num: 3,
        box: geneBoxes.addBtn,
        cx: Math.round(geneBoxes.addBtn.left - 10),
        cy: Math.round(geneBoxes.addBtn.top - 4),
      },
      geneBoxes.voteBox && {
        num: 4,
        box: geneBoxes.voteBox,
        pad: 4,
        cx: Math.round(geneBoxes.voteBox.right + 18),
        cy: Math.round(geneBoxes.voteBox.top - 4),
      },
      geneBoxes.tabs && {
        num: 5,
        box: geneBoxes.tabs,
        pad: 6,
        cx: Math.round(geneBoxes.tabs.right + 18),
        cy: Math.round(geneBoxes.tabs.top + geneBoxes.tabs.height / 2),
      },
    ].filter(Boolean)
    await injectCallouts(genePage, pageCallouts)
    await saveClippedWebp(
      genePage,
      pageClip,
      resolve(attachmentsDir, "iconoplasm-start-gene-page.webp"),
      1600,
    )
    console.log("  wrote iconoplasm-start-gene-page.webp")

    // (b) Accession sheet screenshot
    await clearCallouts(genePage)
    const sheetCallouts = [
      geneBoxes.specimenMeta && {
        num: 1,
        box: geneBoxes.specimenMeta,
        pad: 4,
        cx: Math.round(geneBoxes.specimenMeta.right + 10),
        cy: Math.round(geneBoxes.specimenMeta.top - 2),
      },
      geneBoxes.category && {
        num: 2,
        box: geneBoxes.category,
        pad: 1,
        cx: Math.round(geneBoxes.category.right - 14),
        cy: Math.round(geneBoxes.category.top - 10),
      },
      geneBoxes.firstNoted && {
        num: 3,
        box: geneBoxes.firstNoted,
        pad: 1,
        cx: Math.round(geneBoxes.firstNoted.right - 14),
        cy: Math.round(geneBoxes.firstNoted.bottom + 18),
      },
      geneBoxes.mass && {
        num: 4,
        box: geneBoxes.mass,
        pad: 1,
        cx: Math.round(geneBoxes.mass.right + 16),
        cy: Math.round(geneBoxes.mass.top + geneBoxes.mass.height / 2),
      },
      geneBoxes.pfam && {
        num: 5,
        box: geneBoxes.pfam,
        pad: 3,
        cx: Math.round(geneBoxes.pfam.right + 16),
        cy: Math.round(geneBoxes.pfam.top + 36),
      },
      geneBoxes.familyTrait && {
        num: 6,
        box: geneBoxes.familyTrait,
        pad: 2,
        cx: Math.round(geneBoxes.familyTrait.right - 16),
        cy: Math.round(geneBoxes.familyTrait.bottom + 10),
      },
      geneBoxes.alignment && {
        num: 7,
        box: geneBoxes.alignment,
        pad: 2,
        cx: Math.round(geneBoxes.alignment.right + 16),
        cy: Math.round(geneBoxes.alignment.top + geneBoxes.alignment.height / 2),
      },
      geneBoxes.voteBox && {
        num: 8,
        box: geneBoxes.voteBox,
        pad: 4,
        cx: Math.round(geneBoxes.voteBox.right + 16),
        cy: Math.round(geneBoxes.voteBox.top - 2),
      },
    ].filter(Boolean)
    await injectCallouts(genePage, sheetCallouts)
    await saveClippedWebp(
      genePage,
      sheetClip,
      resolve(attachmentsDir, "iconoplasm-start-accession-sheet.webp"),
      1600,
    )
    console.log("  wrote iconoplasm-start-accession-sheet.webp")
    await genePage.close()
  } finally {
    await context.close()
    rmSync(userDataDir, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
