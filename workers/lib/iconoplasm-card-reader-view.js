/**
 * B-762 reader side of the per-gene delta view.
 *
 * A reader-facing view id is `<base>.c<chainHash>`: the base names the exact
 * immutable card-catalog epoch and the chain hash names the exact immutable
 * chain object written by the card-publication coordinator. Resolution is pure
 * content-addressed reads of Bunny objects; no KV state, no D1, no writes.
 * Because every segment object is immutable and the chain names its exact
 * segments, an id advertised before compaction resolves to the same bytes
 * afterwards. Nothing in this module may fall back to the latest view.
 */
import {
  PUBLIC_GENE_DELTA_PROJECTION_KEY,
  resolveGeneDeltaEntry,
  validateGeneDeltaChainBody,
  validateGeneDeltaSegmentBody,
} from "./iconoplasm-card-gene-delta.js"
import {
  PUBLISHED_OBJECT_STORAGE_UNAVAILABLE,
  publishedCardObjectKey,
} from "./iconoplasm-published-card-objects.js"

const HASH = /^[a-f0-9]{64}$/
const VIEW_SUFFIX = /^(.*?)\.c([a-f0-9]{64})$/

// A deployment without immutable storage definitively holds no chain; that is
// an unavailable identity, not a retryable outage.
function readFailureCode(error) {
  return error?.code === PUBLISHED_OBJECT_STORAGE_UNAVAILABLE
    ? "CHAIN_UNAVAILABLE"
    : "CHAIN_READ_FAILED"
}

// Bounded, exact-identity cache: the key is the chain content hash, so a hit
// can only ever return the entries that chain names.
const CHAIN_ENTRY_CACHE_LIMIT = 4
const chainEntryCache = new Map()

export function resetPublishedViewReaderCachesForTest() {
  chainEntryCache.clear()
}

/**
 * Parse a published view id. Plain base versions (no `.c<hash>` suffix) return
 * `chainHash: null` and resolve exactly as before.
 */
export function parsePublishedViewId(raw) {
  const version = String(raw || "").trim()
  const match = VIEW_SUFFIX.exec(version)
  if (!match || !match[1]) return { version, base: version, chainHash: null }
  return { version, base: match[1], chainHash: match[2] }
}

function touchChainEntries(chainHash, entries) {
  chainEntryCache.delete(chainHash)
  chainEntryCache.set(chainHash, entries)
  while (chainEntryCache.size > CHAIN_ENTRY_CACHE_LIMIT) {
    chainEntryCache.delete(chainEntryCache.keys().next().value)
  }
}

/**
 * Read and validate one immutable chain, then aggregate its segment entries
 * with newer-wins semantics (exact version first, commit sequence second).
 * `base` may be null when the caller learns the base from the chain itself,
 * but a non-null base must match the chain exactly.
 */
export async function readGeneDeltaChain({ readObject, chainHash, base = null }) {
  const expectedBase = base == null ? null : String(base || "").trim()
  if (typeof readObject !== "function" || !HASH.test(String(chainHash || "")))
    return { ok: false, code: "CHAIN_INVALID" }
  let chainValue
  try {
    chainValue = await readObject(publishedCardObjectKey("indexes", chainHash), (value) =>
      Boolean(value && typeof value === "object"),
    )
  } catch (error) {
    return { ok: false, code: readFailureCode(error), error }
  }
  if (!chainValue) return { ok: false, code: "CHAIN_UNAVAILABLE" }
  const chain = validateGeneDeltaChainBody(chainValue, String(chainValue.base || ""))
  if (!chain) return { ok: false, code: "CHAIN_INVALID" }
  if (expectedBase != null && chain.base !== expectedBase)
    return { ok: false, code: "CHAIN_BASE_MISMATCH" }
  const cached = chainEntryCache.get(chainHash)
  if (cached) {
    touchChainEntries(chainHash, cached)
    return { ok: true, chain, entries: cached }
  }
  const segments = []
  for (const segment of chain.segments) {
    let body
    try {
      body = await readObject(segment.key, (value) =>
        Boolean(validateGeneDeltaSegmentBody(value, segment.seq)),
      )
    } catch (error) {
      return { ok: false, code: readFailureCode(error), error, segment }
    }
    const validated = body ? validateGeneDeltaSegmentBody(body, segment.seq) : null
    if (!validated) return { ok: false, code: "SEGMENT_UNAVAILABLE", segment }
    segments.push(validated.entries)
  }
  const resolved = new Map()
  for (const symbol of new Set(segments.flatMap((entries) => Object.keys(entries)))) {
    const winner = resolveGeneDeltaEntry(segments, symbol)
    if (winner) resolved.set(symbol, winner)
  }
  touchChainEntries(chainHash, resolved)
  return { ok: true, chain, entries: resolved }
}

/**
 * Exact per-symbol resolution for one advertised view. `entry: null` means the
 * symbol is untouched by this view and must be resolved from the base artifact;
 * a `withdrawn` entry is a tombstone that must not resurrect base content.
 */
export async function readPublishedViewEntry({ readObject, chainHash, base, symbol }) {
  const chain = await readGeneDeltaChain({ readObject, chainHash, base })
  if (!chain.ok) return chain
  return { ok: true, chain: chain.chain, entry: chain.entries.get(symbol) || null }
}

/**
 * Current advertised view from the publication owner's KV projection. The
 * compact form `{ view, base }` is only returned when the view id is a delta
 * view of its own base; the caller decides whether that base is still current.
 */
export async function readAdvertisedGeneDeltaView(env) {
  if (!env?.KV?.get) return null
  try {
    const raw = await env.KV.get(PUBLIC_GENE_DELTA_PROJECTION_KEY)
    if (!raw) return null
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw
    const view = String(parsed?.view || "").trim()
    const base = String(parsed?.base || "").trim()
    if (!view || !base) return null
    const parsedView = parsePublishedViewId(view)
    if (!parsedView.chainHash || parsedView.base !== base) return null
    return { view, base }
  } catch {
    return null
  }
}
