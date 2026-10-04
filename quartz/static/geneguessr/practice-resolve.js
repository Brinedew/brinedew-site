// The "paste your own gene list" box resolves in the browser (B-934). A paste used to POST to
// /api/game/practice/resolve, which cost about three D1 rows per pasted symbol and one Worker
// request per paste. The static protein index (scripts/export-geneguessr-protein-index.mjs)
// already ships to every browser and holds every symbol a game can use; its
// `recognized_unplayable` list holds the symbols the catalog knows but a game cannot use. So a
// paste costs no D1 read and no Worker request at any traffic level.
//
// Pure functions only: no network, no DOM. The answer has the shape the old route gave.

// The old route stopped at this many distinct symbols and said so with `truncated`.
export const PRACTICE_RESOLVE_MAX_INPUTS = 10000

// Same cleaning the route used: trim, cut punctuation off both ends, upper-case. A pasted
// "(tp53)," and "TP53" are the same symbol; nothing else (no alias, no partial match) is folded.
export function normalizeGeneToken(raw) {
  const trimmed = String(raw || "").trim()
  if (!trimmed) return null
  const cleaned = trimmed.replace(/^[^A-Za-z0-9-]+|[^A-Za-z0-9-]+$/g, "")
  if (!cleaned) return null
  return cleaned.toUpperCase()
}

// Builds the lookup from the parsed protein-index.json payload. An index written before the
// `recognized_unplayable` field existed still works: those symbols then read as unrecognized.
export function buildPracticeLookup(payload) {
  const fields = Array.isArray(payload?.fields) ? payload.fields : []
  const uniprotAt = fields.indexOf("uniprot")
  const hgncAt = fields.indexOf("hgnc")
  if (
    payload?.schema_version !== 1 ||
    uniprotAt < 0 ||
    hgncAt < 0 ||
    !Array.isArray(payload.rows)
  ) {
    throw new Error("Protein index has an unknown shape")
  }
  const playable = new Map()
  for (const row of payload.rows) {
    const gene = normalizeGeneToken(row?.[hgncAt])
    if (gene && !playable.has(gene)) {
      playable.set(gene, String(row[uniprotAt] || "").toUpperCase())
    }
  }
  const unplayable = new Set()
  for (const value of Array.isArray(payload.recognized_unplayable)
    ? payload.recognized_unplayable
    : []) {
    const gene = normalizeGeneToken(value)
    if (gene && !playable.has(gene)) unplayable.add(gene)
  }
  return { playable, unplayable }
}

// `genes` is the list of pasted symbols (already split by the page). Returns the route's answer.
export function resolvePracticeGenes(lookup, genes) {
  const rawInputs = Array.isArray(genes) ? genes : []
  const normalized = []
  const seen = new Set()
  for (const value of rawInputs) {
    const gene = normalizeGeneToken(value)
    if (!gene || seen.has(gene)) continue
    seen.add(gene)
    normalized.push(gene)
    if (normalized.length >= PRACTICE_RESOLVE_MAX_INPUTS) break
  }
  if (normalized.length === 0) {
    return {
      inputCount: rawInputs.length,
      uniqueCount: 0,
      recognizedCount: 0,
      playableCount: 0,
      playable: [],
      unrecognized: [],
      recognizedUnplayable: [],
    }
  }
  const playable = []
  const recognizedUnplayable = []
  const unrecognized = []
  for (const gene of normalized) {
    if (lookup.playable.has(gene)) playable.push({ gene, uniprot: lookup.playable.get(gene) })
    else if (lookup.unplayable.has(gene)) recognizedUnplayable.push(gene)
    else unrecognized.push(gene)
  }
  return {
    inputCount: rawInputs.length,
    uniqueCount: normalized.length,
    recognizedCount: normalized.length - unrecognized.length,
    playableCount: playable.length,
    playable,
    unrecognized,
    recognizedUnplayable,
    truncated: normalized.length >= PRACTICE_RESOLVE_MAX_INPUTS,
  }
}
