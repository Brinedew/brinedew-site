/**
 * B-762 reader view owner: one durable, change-driven projection of committed
 * per-gene card versions.
 *
 * The vote authority publishes a gene's exact immutable objects and then hands
 * the verified receipt to the card-publication coordinator, which owns the
 * shared KV projection. This module is the pure state machine behind that
 * owner: revision-checked commits, immutable directory segments, bounded chain
 * growth with newer-wins compaction that preserves tombstones, and an exact
 * base+delta view identity. No storage, network or clock access here.
 */
const SHA256 = /^[a-f0-9]{64}$/
const SYMBOL = /^[A-Z0-9][A-Z0-9._-]{0,31}$/

// A segment is one immutable directory object. 120 entries keep the canonical
// JSON under the 64 KiB index object limit; six segments bound the live delta
// to at most 720 genes before compaction folds the oldest pair.
export const GENE_DELTA_SEGMENT_ENTRY_CAP = 120
export const GENE_DELTA_CHAIN_LIMIT = 6
export const GENE_DELTA_SCHEMA_VERSION = 1

export function emptyGeneDeltaState() {
  return {
    schema_version: GENE_DELTA_SCHEMA_VERSION,
    seq: 0,
    pending: {},
    segments: [],
    latest: {},
    projection_pending: false,
    projected_hash: null,
    coalesce: null,
  }
}

function storedKey(value, name) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 2048 ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.includes(":") ||
    value.includes("?") ||
    value.includes("#") ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new TypeError(`${name} must be a relative immutable Storage key`)
  }
  return value
}

function receipt(value, name) {
  if (!value || typeof value !== "object") throw new TypeError(`${name} is required`)
  const key = storedKey(value.key, `${name}.key`)
  if (!SHA256.test(String(value.hash || ""))) throw new TypeError(`${name}.hash is invalid`)
  return { key, hash: value.hash }
}

export function normalizeGeneCommit(raw) {
  const symbol = String(raw?.symbol || "")
    .trim()
    .toUpperCase()
  if (!SYMBOL.test(symbol)) throw new TypeError("symbol is invalid")
  const version = Number(raw?.version)
  if (!Number.isSafeInteger(version) || version < 1) throw new TypeError("version is invalid")
  const selectionKey = String(raw?.selection_key || "")
    .trim()
    .toLowerCase()
  if (!SHA256.test(selectionKey)) throw new TypeError("selection_key is invalid")
  return {
    symbol,
    version,
    selectionKey,
    withdrawn: raw?.withdrawn === true,
    card: receipt(raw?.card, "card"),
    gene: receipt(raw?.gene, "gene"),
    portrait: receipt(raw?.portrait, "portrait"),
  }
}

function entryFromCommit(commit, seq) {
  return {
    symbol: commit.symbol,
    version: commit.version,
    selection_key: commit.selectionKey,
    seq,
    status: commit.withdrawn ? "withdrawn" : "committed",
    card: commit.card,
    gene: commit.gene,
    portrait: commit.portrait,
  }
}

function latestFor(state, symbol) {
  const pending = state.pending[symbol]
  const tracked = state.latest[symbol]
  const candidates = []
  if (pending)
    candidates.push({
      version: pending.version,
      selection_key: pending.selection_key,
      seq: pending.seq,
    })
  if (tracked) candidates.push(tracked)
  if (!candidates.length) return null
  return candidates.sort(
    (left, right) => right.version - left.version || right.seq - left.seq || 0,
  )[0]
}

/**
 * Revision-checked commit. Returns the next state and the outcome:
 * `accepted` (new/changed version), `replayed` (identical repeat) or a thrown
 * conflict/stale error, so the caller never loses accepted work silently.
 */
export function applyGeneCommit(state, rawCommit) {
  const commit = normalizeGeneCommit(rawCommit)
  const next = {
    ...state,
    pending: { ...state.pending },
    latest: { ...state.latest },
  }
  const prior = latestFor(state, commit.symbol)
  if (prior) {
    if (commit.version < prior.version) {
      const error = new Error("Gene commit is older than the accepted version")
      error.code = "STALE_GENE_COMMIT"
      throw error
    }
    if (commit.version === prior.version) {
      if (commit.selectionKey !== prior.selection_key) {
        const error = new Error("Gene commit version already has different content")
        error.code = "GENE_COMMIT_CONFLICT"
        throw error
      }
      return { state, accepted: false, replayed: true }
    }
  }
  const seq = Number(state.seq) || 0
  const entry = entryFromCommit(commit, seq)
  next.pending[commit.symbol] = entry
  next.latest[commit.symbol] = {
    version: commit.version,
    selection_key: commit.selectionKey,
    seq,
  }
  next.projection_pending = true
  return { state: next, accepted: true, replayed: false, entry }
}

/** Entries of the pending batch, as the immutable segment object body. */
export function pendingSegmentBody(state, seq) {
  return {
    schema_version: GENE_DELTA_SCHEMA_VERSION,
    seq,
    entries: state.pending,
  }
}

export function completeSegmentWrite(state, { seq, key, hash }) {
  const next = {
    ...state,
    seq,
    pending: {},
    segments: [...state.segments, { seq, key, hash, count: Object.keys(state.pending).length }],
  }
  return next
}

/**
 * Plan bounded compaction of the oldest segments. Returns null when the chain
 * is within its limit. The caller writes the merged object and then calls
 * completeCoalesce; tombstones and the newest version per symbol survive.
 */
export function planGeneDeltaCoalesce(state) {
  if (state.segments.length <= GENE_DELTA_CHAIN_LIMIT) return null
  const mergeSeqs = state.segments.slice(0, 2).map((segment) => segment.seq)
  return { mergeSeqs }
}

export function mergeSegmentEntries(segmentBodies, mergeSeqs) {
  const entries = {}
  for (const seq of mergeSeqs) {
    const body = segmentBodies.get(seq)
    if (!body) continue
    for (const [symbol, entry] of Object.entries(body.entries || {})) {
      const existing = entries[symbol]
      if (
        !existing ||
        entry.version > existing.version ||
        (entry.version === existing.version && entry.seq >= existing.seq)
      ) {
        entries[symbol] = entry
      }
    }
  }
  return { schema_version: GENE_DELTA_SCHEMA_VERSION, seq: Math.max(...mergeSeqs), entries }
}

export function completeCoalesce(state, { mergeSeqs, key, hash }) {
  const merged = new Set(mergeSeqs)
  const survivors = state.segments.filter((segment) => !merged.has(segment.seq))
  const count = Object.keys(state.pending).length
  return {
    ...state,
    segments: [{ seq: Math.max(...mergeSeqs), key, hash, count }, ...survivors].sort(
      (left, right) => left.seq - right.seq,
    ),
    coalesce: null,
  }
}

export function deltaViewId(baseVersion, state) {
  const base = String(baseVersion || "").trim()
  const seq = Math.max(0, Number(state?.seq) || 0)
  return seq > 0 && state?.segments?.length ? `${base}.d${seq}` : base
}

export function buildGeneDeltaProjection({ baseVersion, state, committedAt = null }) {
  const base = String(baseVersion || "").trim()
  const segments = (state?.segments || []).map((segment) => ({
    seq: segment.seq,
    key: segment.key,
    hash: segment.hash,
    count: segment.count,
  }))
  return {
    schema_version: GENE_DELTA_SCHEMA_VERSION,
    base,
    view: deltaViewId(base, state),
    segments,
    entry_count: segments.reduce((sum, segment) => sum + Number(segment.count || 0), 0),
    committed_at: committedAt,
  }
}

export function geneDeltaProjectionHash(projection) {
  return JSON.stringify(projection)
}

/** Bounded reader lookup over already-loaded immutable segment entries. */
export function resolveGeneDeltaEntry(segmentEntries, symbol) {
  let winner = null
  for (const entries of segmentEntries) {
    const entry = entries?.[symbol]
    if (!entry) continue
    if (
      !winner ||
      entry.version > winner.version ||
      (entry.version === winner.version && entry.seq > winner.seq)
    ) {
      winner = entry
    }
  }
  return winner
}
