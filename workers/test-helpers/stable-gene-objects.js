// B-898 Stage 1: one fake Bunny Storage for the stable gene objects
// (genes/v3/<SYMBOL>.json) that first-party and public card readers resolve.
// Tests seed objects by symbol; the fake answers the authenticated storage GET
// the runtime's createPublishedCardObjectStore(env).readStable() issues, and
// records every storage read so a test can assert "one read per symbol".

export const STABLE_GENE_STORAGE_ZONE = "test-zone"
export const STABLE_GENE_STORAGE_HOST = "storage.test"

export function stableGeneStorageEnv(extra = {}) {
  return {
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_ZONE: STABLE_GENE_STORAGE_ZONE,
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_HOST: STABLE_GENE_STORAGE_HOST,
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD: "test-password",
    ICONOPLASM_PORTRAIT_STORAGE_RETRY_BASE_MS: "0",
    ...extra,
  }
}

export function stableGeneObjectPath(symbol) {
  return `/${STABLE_GENE_STORAGE_ZONE}/genes/v3/${String(symbol).toUpperCase()}.json`
}

// A stable object is the projected card record plus the candidate pool and
// publication stamp (composeStableGeneObject). Tests build one from the same
// payload the old card-catalog fixtures carried.
export function stableGeneObjectFromRecord(record, overrides = {}) {
  return {
    api_version: "v1",
    schema_version: 1,
    canonical_key: "symbol",
    canonical_symbol: record.symbol,
    ...record,
    portrait: record.portrait && typeof record.portrait === "object" ? record.portrait : null,
    portrait_candidates: Array.isArray(record.portrait_candidates)
      ? record.portrait_candidates
      : [],
    candidate_count: Array.isArray(record.portrait_candidates)
      ? record.portrait_candidates.length
      : 0,
    stable_object_version: 3,
    published_at: "2026-10-01T13:53:49.742Z",
    ...overrides,
  }
}

/**
 * Replaces globalThis.fetch for the storage host only. `objects` maps a
 * symbol (or a full storage path) to a stable object or a JSON string.
 * `status` other than 200 makes every storage read answer that status, which
 * is how a test models an outage. Returns the list of storage paths read.
 */
export function installStableGeneStorage(objects = new Map(), { status = 200 } = {}) {
  const reads = []
  const originalFetch = globalThis.fetch
  const bySymbolOrPath = objects instanceof Map ? objects : new Map(Object.entries(objects))
  function lookup(pathname) {
    if (bySymbolOrPath.has(pathname)) return bySymbolOrPath.get(pathname)
    const match = /\/genes\/v3\/([^/]+)\.json$/.exec(pathname)
    return match ? bySymbolOrPath.get(decodeURIComponent(match[1])) : undefined
  }
  globalThis.fetch = async (url, init = {}) => {
    const parsed = new URL(url instanceof Request ? url.url : String(url))
    if (parsed.hostname !== STABLE_GENE_STORAGE_HOST) return originalFetch(url, init)
    reads.push(parsed.pathname)
    if (status !== 200) return new Response(null, { status })
    const value = lookup(parsed.pathname)
    if (value === undefined || value === null) return new Response(null, { status: 404 })
    return new Response(typeof value === "string" ? value : JSON.stringify(value), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }
  return {
    reads,
    objects: bySymbolOrPath,
    restore() {
      globalThis.fetch = originalFetch
    },
  }
}
