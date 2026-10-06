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
// as reference bands. Band sizes and darkness are the ones the owner judged more realistic
// on 2026-10-06 (a profile fitted to measured gels rendered thinner bands and was rejected).
//
// Each lane is exposed like film, after Gelbox's gel renderer (Douglas Lab, UCSF;
// github.com/douglaslab/gelbox, src/GelRender.cpp): a band is the well's rectangle of
// protein, bent into a slight smile and blurred by diffusion, never a shape cut out of a
// gradient. The blurred rectangle is computed exactly (erf edges), with both profiles
// measured on the same real bands (B-996): the heavier-than-Gaussian tail down the lane, and
// across it the soft edge, the faint lateral halo and the uneven plateau. Summed
// exposure passes through a saturating film curve, so a strong band blooms into a flat
// core instead of growing an outline. The lane becomes a mask over the theme's ink.
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

// A band: position in the lane (0 top, 1 bottom), thickness in CSS px, exposure 0..1.
function band(pos, box, alpha) {
  return { pos: Math.min(1, Math.max(0, pos)), box, alpha }
}

function sampleBands(kda) {
  if (!(kda > 0)) return []
  const pos = ladderPosition(kda)
  // Too big to enter the gel: it piles up under the well with a smear (TTN, mucins).
  if (pos < 0) return [band(0, 7, 0.95), band(0.06, 18, 0.22)]
  // Smaller than the gel resolves: it runs with the dye front.
  if (pos > 1) return [band(1, 12, 0.55)]
  // Overexposed band, a faint smear above it, and one minor product below.
  return [band(pos, 9, 0.95), band(pos - 0.09, 16, 0.12), band(Math.min(1, pos + 0.2), 4, 0.2)]
}

// Lane box in CSS px (custom.css: 15.8% x 66% of the 170 x 212.5 px film), rendered at 4x.
// The band itself is the middle half of the box; the rest holds its lateral halo.
const LANE = { width: 26.86, height: 140.25, scale: 4 }

// Abramowitz & Stegun 7.1.26, |error| < 1.5e-7.
function erf(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x))
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x)
  return x < 0 ? -y : y
}

// A rectangle [-half, half] blurred by a Gaussian of width sigma, at offset d.
function blurredBox(d, half, sigma) {
  const k = Math.SQRT2 * sigma
  return 0.5 * (erf((d + half) / k) - erf((d - half) / k))
}

// Horizontal profile, 1 at the centre, measured on 45 of the same bands (B-996): the edge
// falls from 90% to 10% over a quarter of the band's width (sigma 0.08 width), a halo at
// 7-10% of peak still lies 0.4 widths outside it, and the plateau ripples by about 5%.
function acrossProfile(u, bandWidth) {
  const at = (x) =>
    0.88 * blurredBox(x, bandWidth / 2, bandWidth * 0.08) +
    0.12 * blurredBox(x, bandWidth / 2, bandWidth * 0.35)
  return at(u) / at(0)
}

// Smooth seeded ripple along the band, knots every tenth of its width.
function ripple(seed, knots) {
  const r = seeded(seed)
  const values = Array.from({ length: knots + 2 }, () => (r() - 0.5) * 0.1)
  return (t) => {
    const f = Math.min(knots, Math.max(0, t * knots))
    const i = Math.floor(f)
    const w = (1 - Math.cos((f - i) * Math.PI)) / 2
    return 1 + values[i] * (1 - w) + values[i + 1] * w
  }
}

// Vertical profile, 1 at the band's centre: the loaded rectangle blurred by diffusion,
// plus the measured heavy tail (17% of peak one band-thickness away; a Gaussian gives 6%).
function bandProfile(d, box) {
  const half = box * 0.15
  const sigma = box * 0.17
  const at = (x) => 0.78 * blurredBox(x, half, sigma) + 0.22 * blurredBox(x, half, sigma * 2.6)
  return at(d) / at(0)
}

const laneMasks = new Map()

function laneMask(bands) {
  if (!bands.length || typeof document === "undefined") return ""
  const key = JSON.stringify(bands)
  if (laneMasks.has(key)) return laneMasks.get(key)
  const canvas = document.createElement("canvas")
  const ctx = canvas.getContext && canvas.getContext("2d")
  if (!ctx) return ""
  const { width, height, scale } = LANE
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  const image = ctx.createImageData(canvas.width, canvas.height)
  const bandWidth = width / 2
  const across = new Float32Array(canvas.width)
  const smile = new Float32Array(canvas.width)
  for (let px = 0; px < canvas.width; px++) {
    const u = (px + 0.5) / scale - width / 2
    across[px] = acrossProfile(u, bandWidth)
    // The ends ride up (Gelbox's smile), flattening out beyond the band's edge.
    smile[px] = Math.pow(Math.min(1.3, Math.abs(u) / (bandWidth / 2)), 2.2)
  }
  const ripples = bands.map((b) => ripple(`${b.pos}:${b.box}`, 10))
  const film = 1 - Math.exp(-1.4)
  for (let py = 0; py < canvas.height; py++) {
    const y = (py + 0.5) / scale
    for (let px = 0; px < canvas.width; px++) {
      const t = ((px + 0.5) / scale - width / 4) / bandWidth
      let exposure = 0
      bands.forEach((b, n) => {
        const d = y - (b.pos * height - b.box * 0.06 * smile[px])
        if (Math.abs(d) < b.box * 3)
          exposure += b.alpha * across[px] * ripples[n](t) * bandProfile(d, b.box)
      })
      // Film saturates: density rises steeply, then flattens near full black.
      const density = Math.min(1, (1 - Math.exp(-1.4 * exposure)) / film)
      const i = (py * canvas.width + px) * 4
      image.data[i] = image.data[i + 1] = image.data[i + 2] = 255
      image.data[i + 3] = Math.round(density * 255)
    }
  }
  ctx.putImageData(image, 0, 0)
  const url = canvas.toDataURL("image/png")
  laneMasks.set(key, url)
  return url
}

function laneMarkup(kind, bands) {
  const url = laneMask(bands)
  // Ink only through a mask: without one (no canvas) the lane stays blank, never a solid bar.
  const mask = url
    ? ` style="background:rgb(var(--ink));-webkit-mask-image:url(${url});mask-image:url(${url})"`
    : ""
  return `<span class="icono-blot__lane icono-blot__lane--${kind}"${mask}></span>`
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
  const ladder = LADDER.marks.map((k) =>
    LADDER.strong.includes(k) ? band(ladderPosition(k), 6, 0.9) : band(ladderPosition(k), 5, 0.7),
  )
  const photo = portraitUrl
    ? `<img class="icono-blot__photo" src="${escapeHtml(portraitUrl)}" alt="" loading="lazy" decoding="async">`
    : ""
  return (
    '<span class="icono-blot" aria-hidden="true">' +
    laneMarkup("marker", ladder) +
    laneMarkup("sample", sampleBands(Number(kda))) +
    photo +
    `<span class="icono-blot__wax icono-blot__mark icono-blot__mark--marker">${waxLetters("M", symbol + "M", escapeHtml)}</span>` +
    `<span class="icono-blot__wax icono-blot__mark icono-blot__mark--sample">${waxLetters("1", symbol + "1", escapeHtml)}</span>` +
    symbolMarkup(symbol, escapeHtml) +
    "</span>"
  )
}
