// ARCHITECTURE FENCE [IPD-008]: hover asks about a bounded set of symbols,
// never downloads or joins a person's entire discovery shelf.
export const DISCOVERY_MEMBERSHIP_LIMIT = 128

export function parseDiscoveryMembershipSymbols(raw = "[]") {
  let values
  try {
    values = JSON.parse(raw)
  } catch {
    throw new Error("symbols must be a JSON array")
  }
  if (!Array.isArray(values) || values.length > DISCOVERY_MEMBERSHIP_LIMIT)
    throw new Error("Request at most 128 discovery symbols")
  if (values.some((value) => typeof value !== "string" || !value.trim() || value.length > 64))
    throw new Error("Invalid discovery symbol")
  return [...new Set(values.map((value) => value.trim().toUpperCase()))]
}

export async function readDiscoveryMembership(db, userId, symbols) {
  if (!symbols.length) return []
  // Raw keys preserve the composite PK seek even for a lifelong collector.
  // json_each avoids a variable count above D1's statement binding limit.
  const result = await db
    .prepare(
      `SELECT gene_symbol
    FROM icono_gene_discoveries
    WHERE user_id = ? AND gene_symbol IN (SELECT value FROM json_each(?))
    ORDER BY gene_symbol`,
    )
    .bind(userId, JSON.stringify(symbols))
    .all()
  return (result.results || []).map((row) => row.gene_symbol)
}
