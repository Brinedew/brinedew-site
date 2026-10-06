// B-1038: a long gene symbol on a card takes two lines rather than crushing the full
// name beside it. The split is chosen here, not by the browser: a wrapped line keeps
// the width of the unwrapped text, which left a wide gap between name and symbol.
// Two explicit lines make the symbol exactly as wide as its longer line.
//
// A symbol of 10 or more characters splits at a hyphen, the real boundary in names
// like ANKRD13C- / DT and TRAV38- / 2DV8, if one leaves 2 or more characters on the
// second line. Failing that it splits between a number and the letters after it
// (PALM2 / AKAP2), with 3 or more characters on each line. Within the kind, the most
// balanced point wins. A symbol that can't split stays on one line, and
// --icono-symbol-segment, its longest line, shrinks the type just enough to fit
// (CSGALNACT1, ERVMER34-1).
const SPLIT_FROM = 10

function bestSplit(text, isBreak, minLine) {
  let best = null
  for (let index = minLine; index <= text.length - minLine; index += 1) {
    if (!isBreak(index)) continue
    const imbalance = Math.abs(text.length - 2 * index)
    if (!best || imbalance < best.imbalance) best = { index, imbalance }
  }
  return best
}

export function symbolLines(symbol) {
  const text = String(symbol || "")
  if (text.length < SPLIT_FROM) return [text]
  const split =
    bestSplit(text, (index) => text[index - 1] === "-", 2) ||
    bestSplit(text, (index) => /\d/.test(text[index - 1]) && /[A-Za-z]/.test(text[index]), 3)
  return split ? [text.slice(0, split.index), text.slice(split.index)] : [text]
}

export function symbolSegment(lines) {
  return Math.max(1, ...lines.map((line) => line.length))
}

export function imageOnlySymbolHtml(symbol, escapeHtml) {
  const lines = symbolLines(symbol)
  return (
    '<div class="icono-label-symbol icono-image-only-symbol" style="--icono-symbol-segment:' +
    symbolSegment(lines) +
    '">' +
    lines.map(escapeHtml).join("<br>") +
    "</div>"
  )
}
