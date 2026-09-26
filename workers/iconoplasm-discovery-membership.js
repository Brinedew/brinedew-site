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
