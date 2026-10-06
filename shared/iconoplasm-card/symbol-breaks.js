// B-1038: a long gene symbol on a card takes two lines rather than crushing the full
// name beside it. It may break after a hyphen (TRAV38- / 2DV8; the browser already
// breaks there) and between a number and two or more letters after it (PALM2 / AKAP2,
// but never C1G… / L). The longest piece that can't break sets --icono-symbol-segment,
// which shrinks the type just enough for a symbol with no break at all (CSGALNACT1)
// to fit on its line.
const BREAK_AFTER_NUMBER = /(?<=\d)(?=[A-Za-z]{2})/
const ANY_BREAK = /(?<=-)|(?<=\d)(?=[A-Za-z]{2})/

export function symbolBreakParts(symbol) {
  const text = String(symbol || "")
  const parts = text.split(BREAK_AFTER_NUMBER)
  const pieces = text.split(ANY_BREAK)
  return { parts, longest: Math.max(1, ...pieces.map((piece) => piece.length)) }
}

export function imageOnlySymbolHtml(symbol, escapeHtml) {
  const { parts, longest } = symbolBreakParts(symbol)
  return (
    '<div class="icono-label-symbol icono-image-only-symbol" style="--icono-symbol-segment:' +
    longest +
    '">' +
    parts.map(escapeHtml).join("<wbr>") +
    "</div>"
  )
}
