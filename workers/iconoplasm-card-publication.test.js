import assert from "node:assert/strict"
import test from "node:test"
// ARCHITECTURE FENCE [IPD-011]: failed bytes and late votes cannot advance canon.
import {
  createCardPublication,
  CARD_BLOT_ALIAS_BACKFILL_BATCH,
  CARD_PUBLICATION_BATCH,
  enrichPublishedGeneCandidates,
  projectCardBlot,
} from "./lib/iconoplasm-card-publication.js"
import { PUBLIC_CANONICAL_MATERIALIZATION_BATCH_LIMIT } from "./iconoplasm-public-canonical-runtime.js"
import {
  canonicalPublishedJson,
  PUBLISHED_CARD_OBJECT_LIMITS,
  publishedCardObjectKey,
  publishedObjectHash,
} from "./lib/iconoplasm-published-card-objects.js"

test("blot projection clones authoritative hydrated cards instead of mutating frozen input", () => {
  const frozen = Object.freeze({ symbol: "ATG9B", blot: { status: "stale" } })
  const ready = { status: "ready", asset_sha256: "a".repeat(64) }

  const projected = projectCardBlot(frozen, ready)
  const withoutBlot = projectCardBlot(frozen, null)

  assert.notEqual(projected, frozen)
  assert.equal(projected.blot, ready)
  assert.equal(frozen.blot.status, "stale")
  assert.equal("blot" in withoutBlot, false)
})

test("public gene publication adds complete candidate snapshots sequentially", async () => {
  const records = [
    { symbol: "TP53", portrait: { asset_sha256: "a".repeat(64) } },
    { symbol: "BRCA1", portrait: { asset_sha256: "b".repeat(64) } },
  ]
  const calls = []
  let active = 0
  const enriched = await enrichPublishedGeneCandidates(records, async (record) => {
    active += 1
    assert.equal(active, 1, "candidate projection must not fan out D1 reads")
    calls.push(record.symbol)
    active -= 1
    return Array.from({ length: 30 }, (_, index) => ({
      asset_sha256: String(index).padStart(64, "0"),
      image_score: index,
    }))
  })

  assert.deepEqual(calls, ["TP53", "BRCA1"])
  assert.equal(enriched[0].portrait_candidates.length, 30)
  assert.equal(enriched[1].portrait_candidates.length, 30)
  assert.equal("portrait_candidates" in records[0], false, "source records stay immutable")
})

function fixture(count = 9) {
  let documents = new Map()
  let prepared = new Map()
  const bytes = new Map()
  const writes = []
  const aliases = []
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
    async publishBlotAlias(symbol, blot, options) {
      if (failure === "blot-alias") throw new Error("injected alias failure")
      aliases.push({ symbol, blot: structuredClone(blot), options: structuredClone(options) })
      return { key: `blot/${symbol}.webp` }
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
    aliases,
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

test("publication verifies every gene blot alias before committing its head", async () => {
  const f = fixture(2)
  f.cards[0].payload.blot = {
    status: "ready",
    blot_fingerprint: "b".repeat(64),
    asset_sha256: "c".repeat(64),
    object_key: `blots/v1/G/G0000/${"b".repeat(64)}/G0000-iconoplasm-gene-blot.webp`,
  }
  const p = f.create()
  await p.bootstrap()
  await p.step()
  assert.equal(p.status().head, null)
  await p.step()
  assert.equal(p.status().head, null)
  assert.deepEqual(
    f.aliases.map((item) => item.symbol),
    ["G0000", "G0001"],
  )
  await drain(p)
  assert.ok(p.status().head)
})

test("an unverified blot alias leaves the prior publication head untouched", async () => {
  const f = fixture(1)
  const p = f.create()
  await p.bootstrap()
  await p.step()
  f.fail("blot-alias")
  await assert.rejects(p.step(), /injected alias failure/)
  assert.equal(p.status().head, null)
  assert.equal(p.status().job.alias_offset || 0, 0)
})

test("stable blot alias backfill reuses immutable cards without republishing authority", async () => {
  const f = fixture(9)
  const p = f.create()
  await p.bootstrap()
  await drain(p)
  const head = p.status().head
  const immutableWrites = f.writes.length
  f.aliases.length = 0

  await p.backfillBlotAliases()
  await drain(p)

  assert.deepEqual(
    f.aliases.map((item) => item.symbol),
    f.cards.map((item) => item.symbol),
  )
  assert.equal(
    f.aliases.every((item) => item.options.allowMissingImmutablePlaceholder === true),
    true,
  )
  assert.equal(f.writes.length, immutableWrites)
  assert.equal(CARD_BLOT_ALIAS_BACKFILL_BATCH * 3 + 1 < 50, true)
  assert.deepEqual(p.status().head, head)
  assert.equal(p.status().job, null)
})

test("only a compatibility alias backfill can be preempted for user publication", async () => {
  const f = fixture(9)
  const p = f.create()
  await p.bootstrap()
  assert.deepEqual(p.cancelBlotAliasBackfill(), { accepted: false })
  assert.ok(p.status().job, "a real bootstrap job cannot be cancelled by the alias control")
  await drain(p)
  const head = p.status().head

  await p.backfillBlotAliases()
  await p.step()
  assert.ok(f.repository.prepared().length > 0)
  assert.deepEqual(p.cancelBlotAliasBackfill(), { accepted: true, cleared_prepared_rows: 9 })

  assert.equal(p.status().job, null)
  assert.equal(f.repository.prepared().length, 0)
  assert.deepEqual(p.status().head, head)
})

async function drain(publisher) {
  for (let i = 0; i < 500; i++) if (!(await publisher.step()).more) return
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

test("the committed manifest atomically names a bounded compact public catalog index", async () => {
  const f = fixture(2)
  f.cards[0].payload = {
    symbol: "G0000",
    full_name: "First gene",
    color: "#123456",
    portrait: { status: "published", asset_sha256: "a".repeat(64) },
    portrait_candidates: [
      {
        candidate_image_id: 7,
        asset_sha256: "b".repeat(64),
        image_upvotes: 12,
        image_downvotes: 2,
        image_score: 10,
        is_current: true,
      },
    ],
  }
  const p = f.create()

  await p.bootstrap()
  await drain(p)

  const manifest = p.status().head.current.manifest
  assert.equal(manifest.catalog_pages, undefined, "page refs must not inflate the root manifest")
  assert.equal(manifest.shards.length, 1)
  const catalogIndexRef = manifest.shards[0].catalog_index
  assert.equal(catalogIndexRef.page_count, 1)
  assert.match(catalogIndexRef.key, /\/catalogindexes\/[a-f0-9]{64}\.json$/)
  const catalogIndex = (await f.objects.read(catalogIndexRef.key)).value
  assert.equal(
    new TextEncoder().encode(canonicalPublishedJson(catalogIndex)).byteLength <=
      PUBLISHED_CARD_OBJECT_LIMITS.catalogindexes,
    true,
  )
  assert.equal(catalogIndex.schema_version, 2)
  assert.equal(catalogIndex.pages.length, 1)
  assert.deepEqual(catalogIndex.search_entries[0], ["G0000", "First gene", 0, 0])
  assert.deepEqual(catalogIndex.gallery_entries[0], [
    "G0000",
    0,
    0,
    0,
    10,
    "",
    10,
    null,
    null,
    null,
    1,
  ])
  const pageRef = catalogIndex.pages[0]
  assert.equal(pageRef.first_symbol, "G0000")
  assert.equal(pageRef.last_symbol, "G0001")
  const page = (await f.objects.read(pageRef.key)).value
  assert.equal(page.schema_version, 1)
  assert.equal(page.entries[0].symbol, "G0000")
  assert.equal(page.entries[0].full_name, "First gene")
  assert.equal(page.entries[0].portrait.asset_sha256, "a".repeat(64))
  assert.deepEqual(page.entries[0].candidate_summaries, [
    {
      candidate_image_id: 7,
      asset_sha256: "b".repeat(64),
      image_upvotes: 12,
      image_downvotes: 2,
      image_score: 10,
      is_current: true,
    },
  ])
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

test("ordinary one-page publication fits the platform subrequest budget", () => {
  // One page is the measured current shape; multi-page pools are covered below.
  // Keep room for the old-shard read, source materialization and redirects.
  const PHASE_SUBREQUEST_LIMIT = 50
  const PHASE_SUBREQUEST_RESERVE = 18
  const objectsPerCard = 4
  assert.equal(
    CARD_PUBLICATION_BATCH * objectsPerCard * 2 + PHASE_SUBREQUEST_RESERVE <=
      PHASE_SUBREQUEST_LIMIT,
    true,
  )
})

test("multi-page galleries finish in smaller phases without crossing the Free subrequest budget", async () => {
  const f = fixture(4)
  for (const card of f.cards) {
    card.payload.portrait_candidates = Array.from({ length: 129 }, (_, index) => ({
      candidate_image_id: index,
      asset_sha256: index.toString(16).padStart(64, "0"),
    }))
  }
  const p = f.create()
  await p.bootstrap()
  let previousWrites = 0
  for (const [offset, expectedWrites] of [
    [3, 15],
    [4, 5],
  ]) {
    await p.step()
    const phaseWrites = f.writes.length - previousWrites
    assert.equal(p.status().job.offset, offset)
    assert.equal(phaseWrites, expectedWrites)
    assert.ok(phaseWrites * 2 + 18 <= 50)
    assert.equal(p.status().head, null, "partial phases must not become public")
    previousWrites = f.writes.length
  }
  await drain(p)
  assert.equal(p.status().head.current.manifest.card_count, 4)
  assert.equal(f.writes.filter((write) => write.kind === "galleries").length, 8)
})

test("a thousand candidates publish in one bounded phase and the next phase continues", async () => {
  const f = fixture(2)
  f.cards[0].payload.portrait_candidates = Array.from({ length: 1000 }, (_, index) => ({
    candidate_image_id: index,
    asset_sha256: index.toString(16).padStart(64, "0"),
  }))
  f.cards[1].payload.portrait_candidates = Array.from({ length: 257 }, (_, index) => ({
    candidate_image_id: index,
    asset_sha256: index.toString(16).padStart(64, "0"),
  }))
  const p = f.create()
  await p.bootstrap()
  await p.step()
  assert.equal(p.status().job.offset, 1)
  assert.equal(f.writes.length, 11, "eight gallery pages and three core objects")
  assert.equal(p.status().head, null)
  await drain(p)
  assert.equal(p.status().head.current.manifest.card_count, 2)
})

test("an oversized single gallery refuses before writing or advancing the public head", async () => {
  const f = fixture(1)
  f.cards[0].payload.portrait_candidates = Array.from({ length: 1665 }, (_, index) => ({
    candidate_image_id: index,
    asset_sha256: index.toString(16).padStart(64, "0"),
  }))
  const p = f.create()
  await p.bootstrap()
  await assert.rejects(p.step(), (error) => error.code === "CARD_PUBLICATION_PHASE_TOO_LARGE")
  assert.equal(f.writes.length, 0)
  assert.equal(p.status().job.offset, 0)
  assert.equal(p.status().head, null)
})

test("packed shards split on canonical UTF-8 bytes before immutable storage rejects them", async () => {
  const f = fixture(750)
  for (const card of f.cards) card.payload.name = `Gene ${card.symbol} ${"x".repeat(7000)}`
  const p = f.create()

  await p.bootstrap()
  await drain(p)

  const shards = p.status().head.current.manifest.shards
  assert.equal(shards.length > 1, true)
  assert.equal(
    shards.reduce((sum, shard) => sum + shard.card_count, 0),
    750,
  )
  for (const shard of shards) {
    const value = (await f.objects.read(shard.key)).value
    const bytes = new TextEncoder().encode(canonicalPublishedJson(value)).byteLength
    assert.equal(bytes <= PUBLISHED_CARD_OBJECT_LIMITS.shards, true)
  }
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

test("an explicit publication migration keeps the old head until the new catalog projection commits", async () => {
  const f = fixture()
  f.source.buildRevision = 1
  const p = f.create()
  await p.bootstrap()
  await drain(p)
  const original = p.status().head
  f.source.buildRevision = 2

  await p.migrate()
  assert.equal(p.status().job.migration, true)
  assert.deepEqual(p.status().head, original)
  await drain(p)

  const migrated = p.status().head
  assert.equal(migrated.current.manifest.build_revision, 2)
  assert.equal(migrated.current.manifest.shards[0].catalog_index.page_count, 1)
  assert.equal(migrated.previous.version, original.current.version)
})

test("a compatible publication migration reuses immutable per-gene objects", async () => {
  const f = fixture()
  f.source.buildRevision = 1
  const p = f.create()
  await p.bootstrap()
  await drain(p)
  const writesBeforeMigration = f.writes.length

  f.source.buildRevision = 2
  f.source.reuseExistingCardObjectsForMigration = true
  await p.migrate()
  await drain(p)

  const migrationKinds = f.writes.slice(writesBeforeMigration).map((write) => write.kind)
  assert.equal(migrationKinds.includes("cards"), false)
  assert.equal(migrationKinds.includes("genes"), false)
  assert.equal(migrationKinds.includes("portraits"), false)
  assert.ok(migrationKinds.includes("manifests"))
  assert.equal(p.status().head.current.manifest.build_revision, 2)
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

test("rematerialization republishes every page from source while the old head stays readable", async () => {
  const f = fixture(9)
  f.source.buildRevision = 1
  const p = f.create()
  await p.bootstrap()
  await drain(p)
  const original = p.status().head
  const writesBefore = f.writes.length
  const aliasesBefore = f.aliases.length
  const afterCommitReceipts = []
  f.source.afterCommit = async (receipt) => afterCommitReceipts.push(receipt)
  // A change arrives before the pass starts; the pass claims that event window
  // so it does not leave a stale dirty set behind after it commits.
  f.change(["G0000"])

  for (const card of f.cards) {
    card.payload.name = `${card.symbol} refreshed`
    card.payload.portrait_candidates = [{ asset_sha256: "c".repeat(64), image_upvotes: 3 }]
  }

  await p.rematerialize()
  assert.equal(p.status().job.rematerialize, true)
  assert.deepEqual(p.status().head, original, "the previous catalog stays readable until commit")
  await drain(p)

  const committed = p.status().head
  assert.notEqual(committed.current.version, original.current.version)
  assert.equal(committed.previous.version, original.current.version)
  assert.equal(committed.current.manifest.card_count, 9)
  assert.equal(committed.watermark.id, 2)
  assert.equal(p.status().job, null)
  assert.equal(f.repository.get("effects"), null)
  assert.deepEqual(afterCommitReceipts, [])

  const kinds = f.writes.slice(writesBefore).map((write) => write.kind)
  for (const kind of ["cards", "genes", "portraits"]) {
    assert.equal(kinds.filter((value) => value === kind).length, 9, `${kind} rewritten per card`)
  }
  // A catalog-wide rematerialization never republishes mutable per-symbol
  // aliases; that compatibility plane belongs to the alias backfill owner.
  assert.equal(f.aliases.length - aliasesBefore, 0)
  const shard = committed.current.manifest.shards[0]
  const index = (await f.objects.read(shard.delivery_indexes[0].key)).value
  const [symbol, , geneHash] = index.entries[0]
  const gene = (await f.objects.read(publishedCardObjectKey("genes", geneHash))).value
  assert.equal(gene.name, `${symbol} refreshed`)
  // B-793: the record carries the count and a reference; the pool lives in one
  // immutable gallery page written in the same phase.
  assert.equal("portrait_candidates" in gene, false, "the record stays small")
  assert.equal(gene.candidate_count, 1)
  assert.equal(
    kinds.filter((value) => value === "galleries").length,
    9,
    "one page per one-candidate pool",
  )
  const page = (await f.objects.read(gene.candidate_gallery.key)).value
  assert.equal(page.schema_version, 1)
  assert.equal(page.symbol, symbol)
  assert.equal(page.page, 0)
  assert.equal(page.next, null)
  assert.equal(page.candidates.length, 1)
  assert.equal(page.candidates[0].asset_sha256, "c".repeat(64))
  assert.equal(page.candidates[0].image_upvotes, 3)
})

test("a missing source card fails a rematerialization closed instead of deleting the page", async () => {
  const f = fixture(9)
  const p = f.create()
  await p.bootstrap()
  await drain(p)
  const original = p.status().head
  const materialize = f.source.materialize
  f.source.materialize = async (symbols) =>
    (await materialize(symbols)).filter((card) => card.symbol !== "G0004")
  for (const card of f.cards) card.payload.name = `v2 ${card.symbol}`

  await p.rematerialize()
  await assert.rejects(drain(p), /returned no card for G0004/)
  assert.deepEqual(p.status().head, original)
  assert.equal(p.status().job.rematerialize, true)

  f.source.materialize = materialize
  const restarted = f.create()
  await drain(restarted)
  const committed = restarted.status().head
  assert.equal(committed.previous.version, original.current.version)
  assert.equal(committed.current.manifest.card_count, 9)
  assert.equal(restarted.status().job, null)
})
