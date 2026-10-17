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
// Rows read per page: one json_each value per style, then one row and one
// vote-summary seek per blot of the styles on it, measured on D1 in
// iconoplasm.style-published-portraits.test.js. The ranking happens here, not
// in SQL: D1 bills every pass a window function makes over its rows, which
// tripled this read when it ranked in the statement.
export const STYLE_CARD_PORTRAIT_LIMIT = 4

export const STYLE_PUBLISHED_PORTRAITS_SQL = `SELECT m.style_slot, m.gene_symbol, m.asset_sha256,
    COALESCE(v.upvotes, 0) AS upvotes
  FROM json_each(?) j
  JOIN icono_style_published_portraits m ON m.style_slot = j.value
  LEFT JOIN icono_vote_asset_summary v
    ON v.gene_symbol = m.gene_symbol AND v.asset_sha256 = m.asset_sha256`

// Most upvoted first; ties break on the asset hash, so the order is stable.
function byVotes(a, b) {
  return (
    (Number(b.upvotes) || 0) - (Number(a.upvotes) || 0) ||
    (a.asset_sha256 < b.asset_sha256 ? -1 : a.asset_sha256 > b.asset_sha256 ? 1 : 0)
  )
}

// One style's blots: the whole count, and the pictures it shows.
export function styleCardBlots(rows) {
  const ranked = [...rows].sort(byVotes)
  return { count: ranked.length, shown: ranked.slice(0, STYLE_CARD_PORTRAIT_LIMIT) }
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
  const rowsBySlot = new Map()
  if (db && slots.length) {
    const response = await db
      .prepare(STYLE_PUBLISHED_PORTRAITS_SQL)
      .bind(JSON.stringify(slots))
      .all()
    for (const row of response?.results || []) {
      const slot = Number(row.style_slot)
      if (!rowsBySlot.has(slot)) rowsBySlot.set(slot, [])
      rowsBySlot.get(slot).push(row)
    }
  }
  const blots = new Map()
  for (const [slot, rows] of rowsBySlot) {
    const { count, shown } = styleCardBlots(rows)
    blots.set(slot, {
      count,
      portraits: shown.map((row) => ({
        gene_symbol: row.gene_symbol,
        asset_sha256: row.asset_sha256,
        is_current: true,
        medium_url: typeof portraitUrl === "function" ? portraitUrl(row.asset_sha256) : "",
      })),
    })
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
