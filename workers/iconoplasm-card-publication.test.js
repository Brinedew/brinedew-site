import assert from "node:assert/strict"
import test from "node:test"
// ARCHITECTURE FENCE [IPD-011]: failed bytes and late votes cannot advance canon.
import { createCardPublication, CARD_PUBLICATION_BATCH } from "./lib/iconoplasm-card-publication.js"
import { PUBLIC_CANONICAL_MATERIALIZATION_BATCH_LIMIT } from "./iconoplasm-public-canonical-runtime.js"
import {
  canonicalPublishedJson,
  publishedCardObjectKey,
  publishedObjectHash,
} from "./lib/iconoplasm-published-card-objects.js"

function fixture(count = 9) {
  let documents = new Map()
  let prepared = new Map()
  const bytes = new Map()
  const writes = []
  let failure = null
  let event = 1
  let dirty = []
  const cards = Array.from({ length: count }, (_, index) => ({
    symbol: `G${String(index).padStart(4, "0")}`,
    payload: { name: `Gene ${index}`, portrait: "original" },
  }))
  const repository = {
    get: (name) => structuredClone(documents.get(name) ?? null),
    put: (name, value) => documents.set(name, structuredClone(value)),
    remove: (name) => documents.delete(name),
    prepared: () => [...prepared.values()].map((value) => structuredClone(value)),
    prepare: (symbol, value) => prepared.set(symbol, structuredClone(value)),
    clearPrepared: () => prepared.clear(),
    transaction(callback) {
      const previous = [structuredClone(documents), structuredClone(prepared)]
      try {
        return callback()
      } catch (error) {
        ;[documents, prepared] = previous
        throw error
      }
    },
  }
  const objects = {
    async write(kind, value) {
      if (failure === kind) throw new Error("injected object failure")
      const serialized = canonicalPublishedJson(value)
      const hash = await publishedObjectHash(new TextEncoder().encode(serialized))
      const key = publishedCardObjectKey(kind, hash)
      bytes.set(key, serialized)
      writes.push({ kind, key })
      return { key, hash }
    },
    async read(key) {
      return bytes.has(key) ? { value: JSON.parse(bytes.get(key)) } : null
    },
  }
  const source = {
    legacyBaseline: async () => ({
      manifest: {
        schema: "test",
        build_revision: 1,
        shards: [
          {
            key: "legacy",
            first_symbol: cards[0].symbol,
            last_symbol: cards.at(-1).symbol,
            card_count: cards.length,
          },
        ],
      },
      watermark: { id: 1 },
    }),
    legacyCards: async () => structuredClone(cards),
    highWater: async () => ({ id: event }),
    changed: async () => ({ symbols: dirty, truncated: false }),
    materialize: async (symbols) =>
      structuredClone(cards.filter((card) => symbols.includes(card.symbol))),
    complete: (card) => Boolean(card.symbol && card.payload),
    stable: (value) => structuredClone(value),
    project: (payload) => payload,
    locator: (card) => ({ symbol: card.symbol, portrait: card.payload.portrait }),
  }
  const create = () =>
    createCardPublication({ repository, objects, source, now: () => "2026-08-27T00:00:00Z" })
  return {
    create,
    repository,
    objects,
    writes,
    cards,
    source,
    fail: (kind) => {
      failure = kind
    },
    change: (symbols) => {
      event++
      dirty = symbols
    },
  }
}

async function drain(publisher) {
  for (let i = 0; i < 200; i++) if (!(await publisher.step()).more) return
  throw new Error("publication failed to drain")
}

test("publication starts at most six storage pipelines and preserves bounded subrequest headroom", async () => {
  const f = fixture()
  const write = f.objects.write
  let active = 0
  let peak = 0
  f.objects.write = async (...args) => {
    active++
    peak = Math.max(peak, active)
    try {
      await new Promise((resolve) => setImmediate(resolve))
      return await write(...args)
    } finally {
      active--
    }
  }
  const p = f.create()
  await p.bootstrap()
  await p.step()
  assert.equal(peak, 6)
  assert.equal(active, 0)
  assert.equal(f.writes.length, CARD_PUBLICATION_BATCH * 3)
  assert.equal(f.repository.prepared().length, CARD_PUBLICATION_BATCH)
})

test("failed publication waits for started uploads to settle before retrying", async () => {
  const f = fixture()
  const write = f.objects.write
  let active = 0
  f.objects.write = async (kind, value) => {
    active++
    try {
      if (kind === "genes") throw new Error("injected upload failure")
      await new Promise((resolve) => setImmediate(resolve))
      return await write(kind, value)
    } finally {
      active--
    }
  }
  const p = f.create()
  await p.bootstrap()
  await assert.rejects(p.step(), /injected upload failure/)
  assert.equal(active, 0, "no upload may outlive its failed publication phase")
  assert.equal(f.repository.prepared().length, 0)
  assert.equal(p.status().job.offset, 0)
})

test("bootstrap keeps legacy public until every object is prepared and atomically commits", async () => {
  const f = fixture()
  const p = f.create()
  await p.bootstrap()
  await p.step()
  assert.equal(p.status().head, null)
  assert.equal(f.repository.prepared().length, CARD_PUBLICATION_BATCH)
  await drain(p)
  assert.equal(p.status().head.current.manifest.card_count, 9)
  assert.equal(p.status().head.watermark.id, 1)
  assert.equal(p.status().job, null)
  assert.equal(p.status().requested, null)
})

test("a 750-card post-cutover repair resumes through bounded materialization pages", async () => {
  const f = fixture(750)
  const materialize = f.source.materialize
  let calls = 0
  let largestPage = 0
  f.source.materialize = async (symbols) => {
    calls += 1
    largestPage = Math.max(largestPage, symbols.length)
    return materialize(symbols)
  }
  const p = f.create()

  await p.bootstrap()
  await drain(p)
  calls = 0
  largestPage = 0
  for (const card of f.cards) card.payload.portrait = "post-cutover"
  f.change(f.cards.map((card) => card.symbol))
  p.wake()
  await drain(p)

  assert.equal(CARD_PUBLICATION_BATCH <= PUBLIC_CANONICAL_MATERIALIZATION_BATCH_LIMIT, true)
  assert.equal(p.status().head.current.manifest.card_count, 750)
  assert.equal(largestPage, CARD_PUBLICATION_BATCH)
  assert.equal(calls, Math.ceil(750 / CARD_PUBLICATION_BATCH))
  assert.equal(p.status().job, null)
})

test("storage bootstrap cannot silently acknowledge a mapping migration", async () => {
  const f = fixture()
  const p = f.create()
  await p.bootstrap()
  await drain(p)
  const original = p.status().head
  f.source.buildRevision = 2
  await assert.rejects(p.bootstrap(), /cannot perform a mapping migration/)
  p.wake()
  await assert.rejects(p.step(), /explicit catalog migration required/)
  assert.deepEqual(p.status().head, original)
})

test("failed bytes never advance head or watermark; a recreated publisher resumes durable progress", async () => {
  const f = fixture()
  const p = f.create()
  await p.bootstrap()
  await drain(p)
  const previous = p.status().head
  f.cards[0].payload.portrait = "new"
  f.change([f.cards[0].symbol])
  p.wake()
  f.fail("portraits")
  await assert.rejects(p.step(), /injected/)
  assert.deepEqual(p.status().head, previous)
  assert.equal(p.status().job.offset, 0)
  f.fail(null)
  const restarted = f.create()
  await drain(restarted)
  assert.equal(restarted.status().head.previous.version, previous.current.version)
  assert.equal(restarted.status().head.watermark.id, 2)
})

test("one gene change preserves its neighbors' independent card and lane identities", async () => {
  const f = fixture()
  const p = f.create()
  await p.bootstrap()
  await drain(p)
  const first = p.status().head.current.manifest.shards[0]
  const oldEntries = (await f.objects.read(first.delivery_indexes[0].key)).value.entries
  f.cards[0].payload.portrait = "new"
  f.change([f.cards[0].symbol])
  p.wake()
  const before = f.writes.length
  await drain(p)
  const next = p.status().head.current.manifest.shards[0]
  const newEntries = (await f.objects.read(next.delivery_indexes[0].key)).value.entries
  assert.notDeepEqual(oldEntries[0], newEntries[0])
  assert.deepEqual(oldEntries.slice(1), newEntries.slice(1))
  assert.equal(
    f.writes.slice(before).filter((write) => ["cards", "genes", "portraits"].includes(write.kind))
      .length,
    3,
  )
})

test("root upload failure leaves the old complete catalog and durable commit job intact", async () => {
  const f = fixture(1)
  const p = f.create()
  await p.bootstrap()
  await p.step()
  await p.step()
  f.fail("manifests")
  await assert.rejects(p.step(), /injected/)
  assert.equal(p.status().head, null)
  assert.equal(p.status().job.group, 1)
  f.fail(null)
  await drain(f.create())
  assert.equal(p.status().head.current.manifest.card_count, 1)
})

test("a vote arriving during preparation is consumed by a later publication, not swallowed by its watermark", async () => {
  const f = fixture(1)
  const p = f.create()
  await p.bootstrap()
  await p.step()
  f.cards[0].payload.portrait = "late winner"
  f.change([f.cards[0].symbol])
  await drain(p)
  assert.equal(p.status().head.watermark.id, 2)
  const key = p.status().head.current.manifest.shards[0].key
  assert.equal((await f.objects.read(key)).value.cards[0].payload.portrait, "late winner")
})

test("idle status and steps do no publication writes", async () => {
  const f = fixture(1)
  const p = f.create()
  await p.bootstrap()
  await drain(p)
  const writes = f.writes.length
  for (let i = 0; i < 10; i++) {
    p.status()
    assert.deepEqual(await p.step(), { more: false })
  }
  assert.equal(f.writes.length, writes)
})
