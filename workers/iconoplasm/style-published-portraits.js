import { normalizeFavoriteEmulsionFamilyId } from "../iconoplasm-emulsion-favorites.js"

// A style card's blots: the genes whose current portrait the style drew, under
// its legacy `0-N`, edited `0-N-e` and factory `X9-N` codes alike. Migration
// 0130's triggers keep icono_style_published_portraits equal to that set in the
// same transaction as every write that can change it, so the card's count and
// its pictures come from one table and cannot disagree (B-896, 2026-10-17).
// The pictures are the style's published portraits only, most upvoted first,
// at most four; a gene's portrait belongs to one style, so no gene can show on
// two cards.
//
// Migration 0144 stores each card (icono_style_cards): its blot count and its
// four pictures, kept equal to the blots by triggers on the same writes. A
// card costs one row and one json_each value to read, whatever the size of
// its style (B-1154, 2026-10-27). Working it out on read cost two rows per
// blot: about 1,450 rows for the picker job's 120 styles every 15 minutes, and
// about 1,160 for a reader with 26 favourite styles. The pictures keep the
// order of the upvotes they had when the style last changed (see 0144).
//
// Migration 0145 adds each picture's placeholder, a base64 ThumbHash that the
// picker decodes into a blurred copy of the portrait while its file loads.
export const STYLE_CARD_PORTRAIT_LIMIT = 4

export const STYLE_CARDS_SQL = `SELECT c.style_slot, c.blot_count, c.portraits_json
  FROM json_each(?) j
  JOIN icono_style_cards c ON c.style_slot = j.value`

// Most upvoted first; ties break on the asset hash, so the order is stable.
function byVotes(a, b) {
  return (
    (Number(b.upvotes) || 0) - (Number(a.upvotes) || 0) ||
    (a.asset_sha256 < b.asset_sha256 ? -1 : a.asset_sha256 > b.asset_sha256 ? 1 : 0)
  )
}

// One stored card: the whole count, and the pictures it shows. The stored
// [gene_symbol, asset_sha256, upvotes, placeholder] entries come in no
// promised order.
export function styleCardBlots(row) {
  let triples = []
  try {
    triples = JSON.parse(row?.portraits_json || "[]")
  } catch {
    triples = []
  }
  const shown = (Array.isArray(triples) ? triples : [])
    .filter((triple) => Array.isArray(triple) && triple[0] && triple[1])
    .map(([gene_symbol, asset_sha256, upvotes, placeholder]) => ({
      gene_symbol,
      asset_sha256,
      upvotes,
      placeholder: typeof placeholder === "string" && placeholder ? placeholder : null,
    }))
    .sort(byVotes)
    .slice(0, STYLE_CARD_PORTRAIT_LIMIT)
  return { count: Number(row?.blot_count) || 0, shown }
}

export function styleSlotOfOption(option) {
  const family = normalizeFavoriteEmulsionFamilyId(
    option?.emulsion_family_id || option?.emulsion_id || "",
  )
  const match = /^[A-Z0-9]+-([1-9][0-9]*)/.exec(family)
  return match ? Number.parseInt(match[1], 10) : 0
}

// Every picker page leaves through here: each card gets its blot count and its
// published portraits, whichever rollup supplied the card. A style that shows
// twice (a vision card and a factory card of the same number) is one card.
export async function attachStylePublishedPortraits(db, options, portraitUrl) {
  const seen = new Set()
  const list = (Array.isArray(options) ? options : []).filter((option) => {
    const slot = styleSlotOfOption(option)
    if (!slot) return true
    if (seen.has(slot)) return false
    seen.add(slot)
    return true
  })
  const slots = Array.from(seen)
  const blots = new Map()
  if (db && slots.length) {
    const response = await db.prepare(STYLE_CARDS_SQL).bind(JSON.stringify(slots)).all()
    for (const row of response?.results || []) {
      const { count, shown } = styleCardBlots(row)
      blots.set(Number(row.style_slot), {
        count,
        portraits: shown.map((portrait) => ({
          gene_symbol: portrait.gene_symbol,
          asset_sha256: portrait.asset_sha256,
          is_current: true,
          medium_url: portraitUrl(portrait.asset_sha256, "medium"),
          small_url: portraitUrl(portrait.asset_sha256, "small"),
          placeholder: portrait.placeholder,
        })),
      })
    }
  }
  return list.map((option) => {
    const entry = blots.get(styleSlotOfOption(option))
    return {
      ...option,
      canonical_count: entry ? entry.count : 0,
      preview_assets: entry ? entry.portraits : [],
    }
  })
}
