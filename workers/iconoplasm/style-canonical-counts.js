import { normalizeFavoriteEmulsionFamilyId } from "../iconoplasm-emulsion-favorites.js"

// Canonical blots per style, kept exact by migration 0128's triggers on
// icono_publish_state and icono_portrait_assets. A style card's blot count is
// this number: how many genes' current portraits the style drew, across its
// legacy `0-N`, edited `0-N-e` and factory `X9-N` codes alike. The request-
// option rollups' live_count is not it (they count per vision or per factory
// code, and are rebuilt only when that vision changes).
//
// Two rows read per style on the page (the json_each value and one primary-key
// seek), measured on D1 in iconoplasm.style-canonical-counts.test.js.
export const STYLE_CANONICAL_COUNTS_SQL = `SELECT c.style_slot, c.canonical
  FROM json_each(?) j
  JOIN icono_style_canonical_counts c ON c.style_slot = j.value`

export function styleSlotOfOption(option) {
  const family = normalizeFavoriteEmulsionFamilyId(
    option?.emulsion_family_id || option?.emulsion_id || "",
  )
  const match = /^[A-Z0-9]+-([1-9][0-9]*)/.exec(family)
  return match ? Number.parseInt(match[1], 10) : 0
}

export async function attachStyleCanonicalCounts(db, options) {
  const list = Array.isArray(options) ? options : []
  const slots = Array.from(new Set(list.map(styleSlotOfOption).filter(Boolean)))
  const counts = new Map()
  if (db && slots.length) {
    const response = await db.prepare(STYLE_CANONICAL_COUNTS_SQL).bind(JSON.stringify(slots)).all()
    for (const row of response?.results || []) {
      counts.set(Number(row.style_slot), Math.max(0, Number(row.canonical) || 0))
    }
  }
  return list.map((option) => ({
    ...option,
    canonical_count: counts.get(styleSlotOfOption(option)) || 0,
  }))
}
