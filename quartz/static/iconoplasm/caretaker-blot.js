// Caretaker blot print (B-996): the caretaker's gene as its own archival autoradiograph.
//
// A period protein ladder sits beside the gene's lane, with one band at the gene's
// molecular weight and the portrait printed into the film. The symbol is written in
// wax China marker. Everything is drawn from data the sidebar already holds (symbol,
// molecular_weight_kda and portrait URL from the published gene detail), so no
// per-gene image exists anywhere and readers cost nothing extra. Styling lives in
// custom.css under .icono-blot; textures and the font live in caretaker-blot/.

// Bio-Rad SDS-PAGE Standards, Broad Range (cat. 161-0317), a 1980s lab staple. Ovalbumin
// (45 kDa) is the middle band, and the catalogue median is 47 kDa. Two bands print darker
// as reference bands. The band look (soft plateau, rounded ends, a faint smear above the
// sample) is the version the owner judged more realistic on 2026-10-06; a profile fitted
// to measured gels rendered thinner bands and was rejected.
const LADDER = {
  marks: [200, 116.25, 97.4, 66.2, 45, 31, 21.5, 14.4, 6.5],
  strong: [66.2, 21.5],
  hi: 260,
  lo: 5,
}

// 0 = top of the resolving gel, 1 = bottom; outside [0, 1] means off the ladder's range.
export function ladderPosition(kda) {
  return (Math.log(LADDER.hi) - Math.log(kda)) / (Math.log(LADDER.hi) - Math.log(LADDER.lo))
}

function band(pos, box, alpha) {
  const top = Math.min(100, Math.max(0, pos * 100)).toFixed(2)
  return `<span class="icono-blot__band" style="top:calc(${top}% - ${box / 2}px);height:${box}px;--a:${alpha}"></span>`
}

function sampleBands(kda) {
  if (!(kda > 0)) return ""
  const pos = ladderPosition(kda)
  // Too big to enter the gel: it piles up under the well with a smear (TTN, mucins).
  if (pos < 0) return band(0, 7, 0.95) + band(0.06, 18, 0.22)
  // Smaller than the gel resolves: it runs with the dye front.
  if (pos > 1) return band(1, 12, 0.55)
  // Overexposed band, a faint smear above it, and one minor product below.
  return band(pos, 9, 0.95) + band(pos - 0.09, 16, 0.12) + band(Math.min(1, pos + 0.2), 4, 0.2)
}

// Stable per-symbol pseudo-random stream, so a gene's handwriting never changes between visits.
function seeded(seed) {
  let h = 2166136261
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return () => (h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) / 4294967296
}

function waxLetters(text, seed, escapeHtml) {
  const r = seeded(seed)
  return Array.from(String(text))
    .map((ch) => {
      const dy = ((r() - 0.5) * 0.12).toFixed(3)
      const rot = (-4 + (r() - 0.5) * 10).toFixed(1)
      const sc = (1 + (r() - 0.5) * 0.12).toFixed(3)
      return `<span style="transform:translateY(${dy}em) rotate(${rot}deg) scale(${sc})">${escapeHtml(ch)}</span>`
    })
    .join("")
}

// Handwriting may run over the print, as on the gene card. A long fusion symbol breaks at
// its hyphen, like a person writing on film; font size follows length so nothing is measured.
function symbolMarkup(symbol, escapeHtml) {
  const text = String(symbol || "")
  const parts = text.length > 8 && text.includes("-") ? text.split(/-(.+)/).filter(Boolean) : [text]
  const longest = Math.max(...parts.map((p, i) => p.length + (i < parts.length - 1 ? 1 : 0)))
  const size = Math.max(
    parts.length > 1 ? 16 : 22,
    Math.min(parts.length > 1 ? 30 : 34, Math.round((34 * 5) / Math.max(5, longest))),
  )
  const lines = parts.map((p, i) =>
    waxLetters(i < parts.length - 1 ? p + "-" : p, text + i, escapeHtml),
  )
  return `<span class="icono-blot__wax icono-blot__symbol" style="font-size:${size}px">${lines.join("<br>")}</span>`
}

export function caretakerBlotMarkup({ symbol, kda, portraitUrl, escapeHtml }) {
  const ladder = LADDER.marks
    .map((k) =>
      LADDER.strong.includes(k) ? band(ladderPosition(k), 6, 0.9) : band(ladderPosition(k), 5, 0.7),
    )
    .join("")
  const photo = portraitUrl
    ? `<img class="icono-blot__photo" src="${escapeHtml(portraitUrl)}" alt="" loading="lazy" decoding="async">`
    : ""
  return (
    '<span class="icono-blot" aria-hidden="true">' +
    `<span class="icono-blot__lane icono-blot__lane--marker">${ladder}</span>` +
    `<span class="icono-blot__lane icono-blot__lane--sample">${sampleBands(Number(kda))}</span>` +
    photo +
    `<span class="icono-blot__wax icono-blot__mark icono-blot__mark--marker">${waxLetters("M", symbol + "M", escapeHtml)}</span>` +
    `<span class="icono-blot__wax icono-blot__mark icono-blot__mark--sample">${waxLetters("1", symbol + "1", escapeHtml)}</span>` +
    symbolMarkup(symbol, escapeHtml) +
    "</span>"
  )
}
