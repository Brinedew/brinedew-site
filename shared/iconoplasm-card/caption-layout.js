// B-1038: the image-only card caption, laid out by measuring text in the real fonts
// with Pretext (@chenglou/pretext) instead of guessing in CSS. The gene symbol sits
// bottom-right on one line at full size; it shrinks only if it is wider than the card
// itself, and it is never split. The full name flows around it, set bottom-up so a
// short leftover line goes on top rather than dangling at the bottom: lines above the
// symbol use the full width, the lines level with it narrow to the space beside it.
// If that space can't hold the name's longest word, the whole name sits above the
// symbol at the card's full width, so no word is ever broken.
//
// Why a library: CSS can't size a wrapped box to its lines or flow text around a
// bottom-right object. Three hand-made attempts (#548, #552) left either a crushed
// name, a collision or a dead gap. Comparison and prototype: Linear B-1038.
//
// Without JavaScript the caption keeps its CSS layout (shared-card-label.css).
import { measureNaturalWidth, prepare } from "@chenglou/pretext"

const ROW = ".icono-image-only-caption-row"
const FLOWED = "icono-image-only-caption-row--flowed"

function fontOf(style, fontSize = style.fontSize) {
  return `${style.fontStyle} ${style.fontWeight} ${fontSize} ${style.fontFamily}`
}

function letterSpacingOf(style) {
  const value = Number.parseFloat(style.letterSpacing)
  return Number.isFinite(value) ? value : 0
}

function lineSpan(doc, text) {
  const span = doc.createElement("span")
  span.className = "icono-image-only-caption-line"
  span.textContent = text
  return span
}

// Lays out one caption row from its original text. Safe to call again on resize.
export function layoutImageOnlyCaption(row) {
  const nameEl = row.querySelector(".icono-image-only-name")
  const symbolEl = row.querySelector(".icono-image-only-symbol")
  if (!nameEl || !symbolEl) return null
  if (row.dataset.iconoCaptionName === undefined) {
    row.dataset.iconoCaptionName = nameEl.textContent.trim()
    row.dataset.iconoCaptionSymbol = symbolEl.textContent.trim()
  }
  const name = row.dataset.iconoCaptionName
  const symbol = row.dataset.iconoCaptionSymbol
  const width = row.clientWidth
  if (!width || !name || !symbol) return null

  const rowStyle = getComputedStyle(row)
  const nameStyle = getComputedStyle(nameEl)
  const symbolStyle = getComputedStyle(symbolEl)
  const gap = Number.parseFloat(rowStyle.columnGap) || 0
  const nameFont = fontOf(nameStyle)
  const nameSpacing = letterSpacingOf(nameStyle)
  const lineHeight = Number.parseFloat(nameStyle.lineHeight) || Number.parseFloat(nameStyle.fontSize) * 1.2

  // The symbol: one line, full size, smaller only if wider than the card.
  symbolEl.style.removeProperty("font-size")
  const baseSize = Number.parseFloat(getComputedStyle(symbolEl).fontSize)
  const symbolEm = letterSpacingOf(symbolStyle) / (Number.parseFloat(symbolStyle.fontSize) || 1)
  const symbolWidthAt = (px) =>
    measureNaturalWidth(
      prepare(symbol, fontOf(symbolStyle, px + "px"), { letterSpacing: symbolEm * px }),
    )
  let symbolSize = baseSize
  let symbolWidth = symbolWidthAt(symbolSize)
  if (symbolWidth > width) {
    symbolSize = Math.floor(((symbolSize * width) / symbolWidth) * 0.98 * 10) / 10
    symbolWidth = symbolWidthAt(symbolSize)
    symbolEl.style.fontSize = symbolSize + "px"
  }
  const symbolHeight = symbolSize * (Number.parseFloat(symbolStyle.lineHeight) / Number.parseFloat(symbolStyle.fontSize) || 0.9)

  // The name: set bottom-up. The caption sits on the card's bottom edge, so the
  // bottom line is filled first and words that don't fit spill upward; a short
  // leftover line ends up on top, not dangling at the bottom beside the symbol
  // (owner, 2026-10-06). Pretext measures every candidate line in the real font;
  // breaks fall only at spaces and after hyphens. The lines level with the symbol
  // narrow to the space left of it; the lines above use the card's full width.
  const measureOf = (text) => measureNaturalWidth(prepare(text, nameFont, { letterSpacing: nameSpacing }))
  const pieces = []
  for (const word of name.split(/\s+/).filter(Boolean)) {
    word.split(/(?<=-)/).forEach((piece, index) => pieces.push({ text: piece, glue: index ? "" : " " }))
  }
  const longestPiece = Math.max(...pieces.map((piece) => measureOf(piece.text)))
  const beside = width - symbolWidth - gap
  const besideLines = Math.ceil(symbolHeight / lineHeight)
  const linesFromBottom = (widthOfLine) => {
    const lines = []
    let end = pieces.length
    while (end > 0) {
      const limit = widthOfLine(lines.length)
      let start = end - 1
      let text = pieces[start].text
      while (start > 0) {
        const wider = pieces[start - 1].text + pieces[start].glue + text
        if (measureOf(wider) > limit) break
        start -= 1
        text = wider
      }
      lines.unshift(text)
      end = start
    }
    return lines
  }
  const mode = beside >= longestPiece ? "beside" : "above"
  const lines =
    mode === "beside"
      ? linesFromBottom((fromBottom) => (fromBottom < besideLines ? beside : width))
      : linesFromBottom(() => width)

  const doc = row.ownerDocument
  const parts = []
  lines.forEach((line, index) => {
    if (index) parts.push(doc.createTextNode(" "))
    parts.push(lineSpan(doc, line))
  })
  nameEl.replaceChildren(...parts)
  row.classList.add(FLOWED)
  row.dataset.iconoCaptionMode = mode
  row.style.minHeight = mode === "beside" ? Math.ceil(symbolHeight) + "px" : ""
  row.dataset.iconoCaptionWidth = String(width)
  return { mode, lines, symbolSize }
}

// Lays out every caption under `root` once fonts are ready. The blot renderer awaits
// this before its screenshot.
export async function layoutImageOnlyCaptions(root) {
  const doc = root.ownerDocument || root
  if (doc.fonts && doc.fonts.ready) await doc.fonts.ready
  return [...root.querySelectorAll(ROW)].map((row) => layoutImageOnlyCaption(row))
}

// Watches the page for captions and lays each out when it appears, when its width
// changes and when fonts finish loading.
export function watchImageOnlyCaptions(win) {
  if (!win || !win.document || win.__iconoCaptionLayoutStarted) return
  if (typeof win.ResizeObserver !== "function" || typeof win.MutationObserver !== "function") return
  win.__iconoCaptionLayoutStarted = true
  const relayout = (row) => {
    if (String(row.clientWidth) === row.dataset.iconoCaptionWidth) return
    try {
      layoutImageOnlyCaption(row)
    } catch (error) {
      // A layout failure leaves the CSS caption in place.
      console.warn("[iconoplasm-caption] layout failed", error)
    }
  }
  const sizes = new win.ResizeObserver((entries) => entries.forEach((entry) => relayout(entry.target)))
  const watch = (node) => {
    if (!node || node.nodeType !== 1) return
    const rows = node.matches(ROW) ? [node] : node.querySelectorAll(ROW)
    for (const row of rows) {
      if (row.__iconoCaptionWatched) continue
      row.__iconoCaptionWatched = true
      sizes.observe(row)
    }
  }
  watch(win.document.documentElement)
  new win.MutationObserver((mutations) => {
    for (const mutation of mutations) mutation.addedNodes.forEach(watch)
  }).observe(win.document.documentElement, { childList: true, subtree: true })
  if (win.document.fonts && win.document.fonts.ready) {
    win.document.fonts.ready.then(() => {
      for (const row of win.document.querySelectorAll(ROW)) {
        delete row.dataset.iconoCaptionWidth
        relayout(row)
      }
    })
  }
}
