import { Hsluv } from "hsluv"

const LIGHTNESS_BINS = [
  [0, 1 / 9, "near-black"],
  [1 / 9, 2 / 9, "extremely dark"],
  [2 / 9, 3 / 9, "very dark"],
  [3 / 9, 4 / 9, "dark"],
  [4 / 9, 5 / 9, "medium-dark"],
  [5 / 9, 6 / 9, "medium-light"],
  [6 / 9, 7 / 9, "light"],
  [7 / 9, 8 / 9, "very light"],
  [8 / 9, 1, "near-white"],
]

const CHROMA_BINS = [
  [0, 0.02, "grayish"],
  [0.02, 0.05, "muted"],
  [0.05, 0.1, "subdued"],
  [0.1, 0.18, "colorful"],
  [0.18, Number.POSITIVE_INFINITY, "vivid"],
]

// These are the same midpoint bands as describeHueWord in
// shared-card-runtime.js. The site uses HPLuv hue for gene-card labels, so the
// prompt injector uses the same source rather than unstable OKLCH hue for
// grayish colors.
const HUE_BINS = [
  [0, 7, "red"],
  [7, 21, "vermilion"],
  [21, 35, "orange"],
  [35, 49, "amber"],
  [49, 62, "gold"],
  [62, 76, "yellow"],
  [76, 90, "lime"],
  [90, 104, "chartreuse"],
  [104, 118, "spring"],
  [118, 132, "jade"],
  [132, 145, "emerald"],
  [145, 159, "teal"],
  [159, 173, "cyan"],
  [173, 187, "azure"],
  [187, 201, "cerulean"],
  [201, 215, "blue"],
  [215, 229, "sapphire"],
  [229, 242, "indigo"],
  [242, 256, "violet"],
  [256, 270, "purple"],
  [270, 284, "amethyst"],
  [284, 298, "magenta"],
  [298, 312, "fuchsia"],
  [312, 325, "rose"],
  [325, 339, "cerise"],
  [339, 353, "crimson"],
  [353, 360, "red"],
]

function normalizeHexColor(raw) {
  const value = String(raw || "").trim()
  if (!/^#?[a-f0-9]{6}$/i.test(value)) return ""
  return value.startsWith("#") ? value.toLowerCase() : `#${value.toLowerCase()}`
}

function srgbToLinear(channel) {
  return channel <= 0.04045
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4)
}

function hexToOklch(hex) {
  const normalized = normalizeHexColor(hex)
  if (!normalized) return null
  const rgb = [0, 2, 4].map((offset) =>
    srgbToLinear(parseInt(normalized.slice(offset + 1, offset + 3), 16) / 255),
  )
  const l = 0.4122214708 * rgb[0] + 0.5363325363 * rgb[1] + 0.0514459929 * rgb[2]
  const m = 0.2119034982 * rgb[0] + 0.6806995451 * rgb[1] + 0.1073969566 * rgb[2]
  const s = 0.0883024619 * rgb[0] + 0.2817188376 * rgb[1] + 0.6299787005 * rgb[2]
  const lRoot = Math.cbrt(l)
  const mRoot = Math.cbrt(m)
  const sRoot = Math.cbrt(s)
  const lightness = 0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot
  const a = 1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot
  const b = 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot
  const chroma = Math.sqrt(a * a + b * b)
  const hue = chroma > 1e-7 ? ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 : null
  return { lightness, chroma, hue }
}

function hexToGeneCardHue(hex) {
  const normalized = normalizeHexColor(hex)
  if (!normalized) return null
  const color = new Hsluv()
  color.hex = normalized
  color.hexToHpluv()
  if (!Number.isFinite(color.hpluv_p) || color.hpluv_p <= 1e-7) return null
  return Number.isFinite(color.hpluv_h) ? color.hpluv_h : null
}

function rangeTerm(value, bins) {
  if (!Number.isFinite(value)) return ""
  const clamped = Math.min(Math.max(value, 0), 1)
  for (let index = 0; index < bins.length; index += 1) {
    const [lower, upper, term] = bins[index]
    if (clamped >= lower && (clamped < upper || index === bins.length - 1)) return term
  }
  return ""
}

function chromaTerm(value) {
  if (!Number.isFinite(value)) return ""
  const normalized = Math.max(0, value)
  const bin = CHROMA_BINS.find(
    ([lower, upper]) => normalized >= lower && normalized < upper,
  )
  return bin ? bin[2] : ""
}

function hueTerm(value) {
  if (!Number.isFinite(value)) return ""
  const normalized = ((value % 360) + 360) % 360
  const bin = HUE_BINS.find(([lower, upper]) => normalized >= lower && normalized < upper)
  return bin ? bin[2] : ""
}

function skinTag(term) {
  return term ? `${term} skin color` : ""
}

export function skinColorPromptTagsFromHex(rawHex) {
  const normalized = normalizeHexColor(rawHex)
  const oklch = hexToOklch(normalized)
  if (!oklch) return []
  const tags = [
    skinTag(rangeTerm(oklch.lightness, LIGHTNESS_BINS)),
    skinTag(chromaTerm(oklch.chroma)),
    skinTag(hueTerm(hexToGeneCardHue(normalized) ?? oklch.hue)),
  ]
  return tags.filter(Boolean)
}
