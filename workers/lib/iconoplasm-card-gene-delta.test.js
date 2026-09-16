import assert from "node:assert/strict"
import test from "node:test"

import {
  applyGeneCommit,
  buildGeneDeltaProjection,
  completeCoalesce,
  completeSegmentWrite,
  deltaViewId,
  emptyGeneDeltaState,
  geneDeltaChainBody,
  geneDeltaChainFingerprint,
  GENE_DELTA_CHAIN_LIMIT,
  GENE_DELTA_SEGMENT_ENTRY_CAP,
  mergeSegmentEntries,
  pendingSegmentBody,
  planGeneDeltaCoalesce,
  resolveGeneDeltaEntry,
  validateGeneDeltaChainBody,
  validateGeneDeltaSegmentBody,
} from "./iconoplasm-card-gene-delta.js"

const sha = (char) => char.repeat(64)
const commit = (symbol, version, { selectionKey = sha("a"), withdrawn = false } = {}) => ({
  symbol,
  version,
  selection_key: selectionKey,
  withdrawn,
  card: { key: `published-cards/v2/immutable/cards/${sha("b")}.json`, hash: sha("b") },
  gene: { key: `published-cards/v2/immutable/genes/${sha("c")}.json`, hash: sha("c") },
  portrait: {
    key: `published-cards/v2/immutable/portraits/${sha("d")}.json`,
    hash: sha("d"),
  },
})

function segmentBody(state, seq) {
  return pendingSegmentBody(state, seq)
}

test("commits are revision-checked: accepted, replayed, stale and conflicting outcomes", () => {
  let state = emptyGeneDeltaState()
  const first = applyGeneCommit(state, commit("TP53", 1))
  assert.equal(first.accepted, true)
  state = first.state
  assert.equal(state.projection_pending, true)
  const replay = applyGeneCommit(state, commit("TP53", 1))
  assert.equal(replay.accepted, false)
  assert.equal(replay.replayed, true)
  assert.equal(replay.state, state)
  assert.throws(() => applyGeneCommit(state, commit("TP53", 1, { selectionKey: sha("e") })), {
    code: "GENE_COMMIT_CONFLICT",
  })
  assert.throws(() => applyGeneCommit(state, commit("TP53", 0)), /version is invalid/)
  const next = applyGeneCommit(state, commit("TP53", 2))
  assert.equal(next.accepted, true)
  assert.throws(() => applyGeneCommit(next.state, commit("TP53", 1)), {
    code: "STALE_GENE_COMMIT",
  })
})

test("pending batch becomes one immutable segment carrying the exact references", () => {
  let state = emptyGeneDeltaState()
  state = applyGeneCommit(state, commit("TP53", 1)).state
  state = applyGeneCommit(state, commit("BRCA1", 1)).state
  const body = segmentBody(state, 1)
  assert.deepEqual(Object.keys(body.entries).sort(), ["BRCA1", "TP53"])
  assert.equal(body.entries.TP53.status, "committed")
  state = completeSegmentWrite(state, { seq: 1, key: "indexes/a.json", hash: sha("a") })
  assert.equal(state.segments.length, 1)
  assert.equal(state.segments[0].count, 2)
  assert.deepEqual(state.pending, {})
  assert.equal(state.seq, 1)
})

test("withdrawn tombstones survive commits and reads", () => {
  let state = emptyGeneDeltaState()
  state = applyGeneCommit(state, commit("TP53", 1)).state
  state = applyGeneCommit(state, commit("TP53", 2, { withdrawn: true })).state
  assert.equal(state.pending.TP53.status, "withdrawn")
  const resolved = resolveGeneDeltaEntry([state.pending], "TP53")
  assert.equal(resolved.status, "withdrawn")
  assert.equal(resolved.version, 2)
})

test("resolveGeneDeltaEntry prefers the newest version and seq across segments", () => {
  const older = { TP53: { version: 2, seq: 1 } }
  const newer = { TP53: { version: 3, seq: 0 } }
  assert.equal(resolveGeneDeltaEntry([older, newer], "TP53").version, 3)
  assert.equal(resolveGeneDeltaEntry([newer, older], "TP53").version, 3)
  assert.equal(resolveGeneDeltaEntry([older], "MISSING"), null)
})

test("bounded chain compacts the oldest pair with newer versions winning", () => {
  const bodies = new Map([
    [1, { entries: { TP53: { version: 1, seq: 1, status: "committed" } } }],
    [
      2,
      {
        entries: {
          TP53: { version: 4, seq: 2, status: "withdrawn" },
          BRCA1: { version: 1, seq: 2, status: "committed" },
        },
      },
    ],
  ])
  const merged = mergeSegmentEntries(bodies, [1, 2])
  assert.equal(merged.entries.TP53.version, 4)
  assert.equal(merged.entries.TP53.status, "withdrawn")
  assert.equal(merged.entries.BRCA1.version, 1)
})

test("planGeneDeltaCoalesce fires only past the chain limit and replaces refs", () => {
  const segments = Array.from({ length: GENE_DELTA_CHAIN_LIMIT }, (_, index) => ({
    seq: index + 1,
    key: `indexes/${index}.json`,
    hash: sha("a"),
    count: 1,
  }))
  let state = { ...emptyGeneDeltaState(), seq: GENE_DELTA_CHAIN_LIMIT, segments }
  assert.equal(planGeneDeltaCoalesce(state), null)
  state = {
    ...state,
    segments: [
      ...segments,
      { seq: GENE_DELTA_CHAIN_LIMIT + 1, key: "indexes/x.json", hash: sha("b"), count: 1 },
    ],
  }
  assert.deepEqual(planGeneDeltaCoalesce(state), { mergeSeqs: [1, 2] })
  const next = completeCoalesce(state, {
    mergeSeqs: [1, 2],
    key: "indexes/merged.json",
    hash: sha("c"),
  })
  assert.equal(next.coalesce, null)
  assert.deepEqual(
    next.segments.map((segment) => segment.seq),
    [2, 3, 4, 5, 6, 7],
  )
})

test("view identity is the content-added chain of the exact delta and names its base", () => {
  const empty = emptyGeneDeltaState()
  assert.equal(deltaViewId("ccv2-abc", empty), "ccv2-abc")
  const withDelta = {
    ...empty,
    seq: 2,
    segments: [
      {
        seq: 2,
        key: `published-cards/v2/immutable/indexes/${sha("a")}.json`,
        hash: sha("a"),
        count: 1,
      },
    ],
  }
  // A delta with no written chain has no exact view id; the accepted writer
  // only advertises after the chain object exists.
  assert.equal(deltaViewId("ccv2-abc", withDelta), "ccv2-abc")
  const view = deltaViewId("ccv2-abc", withDelta, sha("f"))
  assert.equal(view, `ccv2-abc.c${sha("f")}`)
  const projection = buildGeneDeltaProjection({
    baseVersion: "ccv2-abc",
    state: withDelta,
    chainHash: sha("f"),
  })
  assert.equal(projection.view, view)
  assert.equal(projection.base, "ccv2-abc")
  assert.equal(projection.chain_hash, sha("f"))
  assert.equal(projection.entry_count, 1)
  assert.deepEqual(projection.segments[0], withDelta.segments[0])
})

test("chain body names the exact segments and validates against its own base", () => {
  const segments = [
    {
      seq: 1,
      key: `published-cards/v2/immutable/indexes/${sha("a")}.json`,
      hash: sha("a"),
      count: 2,
    },
    {
      seq: 3,
      key: `published-cards/v2/immutable/indexes/${sha("b")}.json`,
      hash: sha("b"),
      count: 1,
    },
  ]
  const body = geneDeltaChainBody("ccv2-abc", segments)
  assert.equal(body.kind, "gene_delta_chain")
  assert.deepEqual(body.segments, segments)
  const validated = validateGeneDeltaChainBody(body, "ccv2-abc")
  assert.deepEqual(validated.segments, segments)
  // A chain can never be re-pointed at another catalog epoch.
  assert.equal(validateGeneDeltaChainBody(body, "ccv2-other"), null)
  assert.equal(validateGeneDeltaChainBody({ ...body, segments: [] }, "ccv2-abc"), null)
  assert.equal(
    validateGeneDeltaChainBody(
      { ...body, segments: Array.from({ length: GENE_DELTA_CHAIN_LIMIT + 1 }, () => segments[0]) },
      "ccv2-abc",
    ),
    null,
  )
  assert.equal(
    validateGeneDeltaChainBody(
      {
        ...body,
        segments: [
          { ...segments[0], key: `published-cards/v2/immutable/indexes/${sha("c")}.json` },
        ],
      },
      "ccv2-abc",
    ),
    null,
  )
  assert.equal(
    geneDeltaChainFingerprint("ccv2-abc", segments),
    geneDeltaChainFingerprint("ccv2-abc", segments),
  )
  assert.notEqual(
    geneDeltaChainFingerprint("ccv2-abc", segments),
    geneDeltaChainFingerprint("ccv2-other", segments),
  )
})

test("segment bodies validate exact receipts and reject mismatched symbols", () => {
  let state = emptyGeneDeltaState()
  state = applyGeneCommit(state, commit("TP53", 1)).state
  const body = segmentBody(state, 1)
  const validated = validateGeneDeltaSegmentBody(body, 1)
  assert.equal(validated.entries.TP53.version, 1)
  assert.equal(validated.entries.TP53.gene.hash, sha("c"))
  assert.equal(validateGeneDeltaSegmentBody(body, 2), null)
  assert.equal(
    validateGeneDeltaSegmentBody(
      { ...body, entries: { TP53: { ...body.entries.TP53, symbol: "BRCA1" } } },
      1,
    ),
    null,
  )
  assert.equal(
    validateGeneDeltaSegmentBody(
      {
        ...body,
        entries: {
          TP53: {
            ...body.entries.TP53,
            gene: { key: `published-cards/v2/immutable/genes/${sha("f")}.json`, hash: sha("c") },
          },
        },
      },
      1,
    ),
    null,
  )
})

test("segment entry cap keeps each immutable directory bounded", () => {
  let state = emptyGeneDeltaState()
  for (let index = 0; index < GENE_DELTA_SEGMENT_ENTRY_CAP; index += 1) {
    state = applyGeneCommit(state, commit(`G${String(index).padStart(4, "0")}`, 1)).state
  }
  assert.equal(Object.keys(state.pending).length, GENE_DELTA_SEGMENT_ENTRY_CAP)
  assert.ok(GENE_DELTA_SEGMENT_ENTRY_CAP <= 120)
})
