import assert from "node:assert/strict"
import test from "node:test"

import {
  geneDeltaChainBody,
  PUBLIC_GENE_DELTA_PROJECTION_KEY,
} from "./iconoplasm-card-gene-delta.js"
import { publishedCardObjectKey } from "./iconoplasm-published-card-objects.js"
import {
  parsePublishedViewId,
  readAdvertisedGeneDeltaView,
  readGeneDeltaChain,
  readPublishedViewEntry,
  resetPublishedViewReaderCachesForTest,
} from "./iconoplasm-card-reader-view.js"

const sha = (char) => char.repeat(64)
const receipt = (kind, hash) => ({ key: publishedCardObjectKey(kind, hash), hash })

function segment(seq, entries) {
  return {
    schema_version: 1,
    seq,
    entries: Object.fromEntries(
      Object.entries(entries).map(([symbol, raw]) => [
        symbol,
        {
          symbol,
          version: raw.version,
          selection_key: raw.selectionKey || sha("e"),
          seq: raw.seq ?? seq - 1,
          status: raw.status || "committed",
          card: receipt("cards", raw.card || sha("b")),
          gene: receipt("genes", raw.gene || sha("c")),
          portrait: receipt("portraits", raw.portrait || sha("d")),
        },
      ]),
    ),
  }
}

function chainFixture({ base = "ccv2-" + sha("1"), segments = [] } = {}) {
  const objects = new Map()
  let chainHash = null
  if (segments.length) {
    const refs = segments.map((body) => {
      const hash = sha(String(body.seq % 10))
      objects.set(publishedCardObjectKey("indexes", hash), body)
      return {
        seq: body.seq,
        key: publishedCardObjectKey("indexes", hash),
        hash,
        count: Object.keys(body.entries).length,
      }
    })
    const chain = geneDeltaChainBody(base, refs)
    chainHash = sha("f")
    objects.set(publishedCardObjectKey("indexes", chainHash), chain)
  }
  return {
    objects,
    chainHash,
    readObject: async (key, validate) => {
      const value = objects.get(key)
      if (!value) return null
      if (validate && !validate(value)) return null
      return value
    },
  }
}

test("a view id parses into base and exact chain hash", () => {
  assert.deepEqual(parsePublishedViewId("ccv2-" + sha("a")), {
    version: "ccv2-" + sha("a"),
    base: "ccv2-" + sha("a"),
    chainHash: null,
  })
  const view = `ccv2-${sha("a")}.c${sha("f")}`
  assert.deepEqual(parsePublishedViewId(view), {
    version: view,
    base: "ccv2-" + sha("a"),
    chainHash: sha("f"),
  })
  assert.equal(parsePublishedViewId("").chainHash, null)
  assert.equal(parsePublishedViewId("ccv2-x.cnothex").chainHash, null)
})

test("newer-wins across segments, tombstones survive, and reads are cached per chain", async () => {
  resetPublishedViewReaderCachesForTest()
  const base = "ccv2-" + sha("1")
  const fixture = chainFixture({
    base,
    segments: [
      segment(1, { TP53: { version: 2, card: sha("b") } }),
      segment(2, {
        TP53: { version: 5, status: "withdrawn", card: sha("b") },
        BRCA1: { version: 1, card: sha("b") },
      }),
    ],
  })
  let reads = 0
  const readObject = async (key, validate) => {
    reads += 1
    return fixture.readObject(key, validate)
  }
  const resolved = await readPublishedViewEntry({
    readObject,
    chainHash: fixture.chainHash,
    base,
    symbol: "TP53",
  })
  assert.equal(resolved.ok, true)
  assert.equal(resolved.entry.version, 5)
  assert.equal(resolved.entry.status, "withdrawn")
  assert.equal(reads, 3, "chain plus two segments")
  const cachedRead = await readGeneDeltaChain({ readObject, chainHash: fixture.chainHash, base })
  assert.equal(cachedRead.ok, true)
  assert.equal(reads, 4, "the chain object re-reads, but its exact segments are cached by hash")
  const absent = await readPublishedViewEntry({
    readObject,
    chainHash: fixture.chainHash,
    base,
    symbol: "MISSING",
  })
  assert.equal(absent.ok, true)
  assert.equal(absent.entry, null)
})

test("a chain from another base epoch never resolves a view id", async () => {
  resetPublishedViewReaderCachesForTest()
  const fixture = chainFixture({
    base: "ccv2-" + sha("1"),
    segments: [segment(1, { TP53: { version: 1 } })],
  })
  const mismatched = await readGeneDeltaChain({
    readObject: fixture.readObject,
    chainHash: fixture.chainHash,
    base: "ccv2-" + sha("2"),
  })
  assert.equal(mismatched.ok, false)
  assert.equal(mismatched.code, "CHAIN_BASE_MISMATCH")
})

test("missing, malformed and unreadable chains fail closed with distinct codes", async () => {
  resetPublishedViewReaderCachesForTest()
  const missing = await readGeneDeltaChain({
    readObject: async () => null,
    chainHash: sha("f"),
    base: null,
  })
  assert.equal(missing.code, "CHAIN_UNAVAILABLE")
  const base = "ccv2-" + sha("1")
  const body = segment(1, { TP53: { version: 1 } })
  const fixture = chainFixture({ base, segments: [body] })
  const tampered = new Map(fixture.objects)
  const chainKey = publishedCardObjectKey("indexes", fixture.chainHash)
  const originalChain = tampered.get(chainKey)
  tampered.set(chainKey, { ...originalChain, segments: [] })
  const malformed = await readGeneDeltaChain({
    readObject: async (key) => tampered.get(key) || null,
    chainHash: fixture.chainHash,
    base,
  })
  assert.equal(malformed.code, "CHAIN_INVALID")
  const throwing = await readGeneDeltaChain({
    readObject: async () => {
      throw new Error("network down")
    },
    chainHash: sha("f"),
    base,
  })
  assert.equal(throwing.code, "CHAIN_READ_FAILED")
  const invalidSegment = new Map(fixture.objects)
  const ref = originalChain.segments[0]
  invalidSegment.set(ref.key, { schema_version: 1, seq: 99, entries: {} })
  const lost = await readGeneDeltaChain({
    readObject: async (key, validate) => {
      const value = invalidSegment.get(key) || fixture.objects.get(key)
      return value && (!validate || validate(value)) ? value : null
    },
    chainHash: fixture.chainHash,
    base,
  })
  assert.equal(lost.code, "SEGMENT_UNAVAILABLE")
})

test("advertised view reads the owner projection and requires an exact chain id", async () => {
  const base = "ccv2-" + sha("1")
  const view = `${base}.c${sha("f")}`
  let stored = JSON.stringify({ view, base })
  const env = {
    KV: { get: async (key) => (key === PUBLIC_GENE_DELTA_PROJECTION_KEY ? stored : null) },
  }
  assert.deepEqual(await readAdvertisedGeneDeltaView(env), { view, base })
  stored = JSON.stringify({ view: base, base })
  assert.equal(await readAdvertisedGeneDeltaView(env), null)
  stored = JSON.stringify({ view, base: "ccv2-other" })
  assert.equal(await readAdvertisedGeneDeltaView(env), null)
  assert.equal(await readAdvertisedGeneDeltaView({}), null)
})
