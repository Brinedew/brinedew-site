// B-898 Stage 1 (step B): the published blot backlog (the drain's full
// backfill walk, GET/POST scope=published with an `after` symbol cursor)
// keyset-paginates D1 route membership and reads a stable gene object only
// for a gene whose D1 blot row is not current. The drain parses items[],
// scanned, total_count, snapshot_version, next_after, done. Failure modes,
// written before the code:
//   1. pages walk icono_published_gene_routes by symbol with bounded, indexed
//      D1 reads: no manifest, no KV, no shard objects;
//   2. a gene whose blot row already matches costs zero storage reads, so a
//      full 19k walk over a satisfied catalog is D1-only;
//   3. storage reads are capped at 25 per page even when the drain asks for a
//      100-gene slice, and next_after resumes from the last examined symbol;
//   4. explicit symbols answer exactly those genes and echo the pinned
//      snapshot version so a checkpointed backfill does not abort;
//   5. a missing stable object and a storage error are skipped, not failures;
//   6. an unknown scope is a 400, and `limit` above the contract cap is clamped.
import assert from "node:assert/strict"
import test from "node:test"

import {
  ICONOPLASM_GENE_BLOT_RENDERER_REVISION,
  iconoplasmGeneBlotFingerprint,
} from "./iconoplasm-gene-card-materialization-runtime-inside-the-only-allowed-internal-stateful-worker-do-not-duplicate.js"
import { listIconoplasmGeneBlotBacklog } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import {
  SqliteD1,
  backlogEnv,
  backlogRequest,
  installStableObjectStorage,
  stableGeneObject,
  stableObjectPath,
} from "./iconoplasm-blot-backlog-test-d1.js"

const SHA_A = "a".repeat(64)
const SHA_B = "b".repeat(64)

function currentBlot(object) {
  return {
    fingerprint: iconoplasmGeneBlotFingerprint(object),
    portraitSha: object.portrait.asset_sha256,
    rendererRevision: ICONOPLASM_GENE_BLOT_RENDERER_REVISION,
  }
}

function symbolAt(index) {
  return `GENE${String(index).padStart(3, "0")}`
}

async function published(env, { after = "", limit = 25, snapshot = "" } = {}) {
  const query = `?scope=published&after=${encodeURIComponent(after)}&limit=${limit}${snapshot ? `&snapshot_version=${snapshot}` : ""}`
  return listIconoplasmGeneBlotBacklog(env, { request: backlogRequest("GET", query), payload: {} })
}

test("published backlog keyset-paginates route membership by symbol with bounded D1 reads", async (t) => {
  const db = new SqliteD1()
  const objects = new Map()
  for (const symbol of ["A1BG", "A1CF", "A2M", "A2ML1", "A4GALT", "ABAT"]) {
    db.seedGene(symbol, { winner: SHA_A })
    objects.set(stableObjectPath(symbol), stableGeneObject(symbol, { portraitSha: SHA_A }))
  }
  db.seedGene("ZZZ_UNROUTED", { winner: SHA_A, route: false })
  const reads = installStableObjectStorage(t, objects)

  const first = await published(backlogEnv(db), { limit: 4 })
  assert.equal(first.ok, true)
  assert.equal(first.scope, "published")
  assert.deepEqual(
    first.items.map((item) => item.symbol),
    ["A1BG", "A1CF", "A2M", "A2ML1"],
  )
  assert.equal(first.items[0].card_payload.full_name, "A1BG full name")
  assert.equal(first.items[0].scope, "published")
  assert.equal(
    first.items[0].blot_fingerprint,
    iconoplasmGeneBlotFingerprint(objects.get(stableObjectPath("A1BG"))),
  )
  assert.equal(first.scanned, 4)
  assert.equal(first.done, false)
  assert.equal(first.next_after, "A2ML1")

  const second = await published(backlogEnv(db), { after: first.next_after, limit: 4 })
  assert.deepEqual(
    second.items.map((item) => item.symbol),
    ["A4GALT", "ABAT"],
  )
  assert.equal(second.done, true)
  assert.equal(second.next_after, "ABAT")
  assert.equal(
    reads.length,
    6,
    "one storage read per gene without a blot, none for the unrouted gene",
  )

  for (const sql of db.queries.filter((value) => /^\s*SELECT/i.test(value))) {
    assert.match(sql, /icono_published_gene_routes/)
    assert.match(sql, /gene_symbol > \?/)
    assert.match(sql, /ORDER BY r\.gene_symbol/)
    assert.match(sql, /\bLIMIT\b/)
  }
})

test("published backlog reads stable objects only for genes without a current blot", async (t) => {
  const db = new SqliteD1()
  const objects = new Map()
  for (let index = 0; index < 10; index += 1) {
    const symbol = symbolAt(index)
    const object = stableGeneObject(symbol, { portraitSha: SHA_A })
    objects.set(stableObjectPath(symbol), object)
    // Every third gene still needs a blot; the rest are current.
    db.seedGene(symbol, { winner: SHA_A, blot: index % 3 === 0 ? null : currentBlot(object) })
  }
  db.seedGene("NOPORTRAIT", { winner: null })
  const reads = installStableObjectStorage(t, objects)

  const page = await published(backlogEnv(db), { limit: 100 })

  assert.deepEqual(
    page.items.map((item) => item.symbol),
    [symbolAt(0), symbolAt(3), symbolAt(6), symbolAt(9)],
  )
  assert.equal(page.scanned, 11)
  assert.equal(page.done, true)
  assert.equal(page.next_after, "NOPORTRAIT")
  assert.deepEqual(
    reads.sort(),
    [symbolAt(0), symbolAt(3), symbolAt(6), symbolAt(9)].map(stableObjectPath).sort(),
  )
})

test("published backlog caps storage reads at 25 per page and resumes from the last examined symbol", async (t) => {
  const db = new SqliteD1()
  const objects = new Map()
  for (let index = 0; index < 60; index += 1) {
    const symbol = symbolAt(index)
    db.seedGene(symbol, { winner: SHA_A })
    objects.set(stableObjectPath(symbol), stableGeneObject(symbol, { portraitSha: SHA_A }))
  }
  const reads = installStableObjectStorage(t, objects)

  const page = await published(backlogEnv(db), { limit: 1000 })

  assert.equal(page.items.length, 25)
  assert.equal(reads.length, 25)
  assert.equal(page.scanned, 25)
  assert.equal(page.next_after, symbolAt(24))
  assert.equal(page.done, false)

  const rest = await published(backlogEnv(db), { after: page.next_after, limit: 100 })
  assert.equal(rest.items.length, 25)
  assert.equal(rest.next_after, symbolAt(49))
  assert.equal(rest.done, false)
})

test("published backlog with explicit symbols echoes the pinned snapshot version", async (t) => {
  const db = new SqliteD1()
  const current = stableGeneObject("A1BG", { portraitSha: SHA_B })
  db.seedGene("A1BG", { winner: SHA_B })
  db.seedGene("TP53", {
    winner: SHA_A,
    blot: currentBlot(stableGeneObject("TP53", { portraitSha: SHA_A })),
  })
  const reads = installStableObjectStorage(t, new Map([[stableObjectPath("A1BG"), current]]))

  const result = await listIconoplasmGeneBlotBacklog(backlogEnv(db), {
    request: backlogRequest(),
    payload: {
      scope: "published",
      symbols: ["A1BG", "TP53"],
      limit: 25,
      snapshot_version: "ccv1-old-checkpoint",
    },
  })

  assert.equal(result.automatic, false)
  assert.deepEqual(
    result.items.map((item) => item.symbol),
    ["A1BG"],
  )
  assert.equal(result.items[0].portrait_asset_sha256, SHA_B)
  assert.equal(result.items[0].blot_fingerprint, iconoplasmGeneBlotFingerprint(current))
  assert.deepEqual(result.symbols, ["A1BG", "TP53"])
  assert.equal(result.snapshot_version, "ccv1-old-checkpoint")
  assert.equal(result.total_count, 2)
  assert.equal(result.done, true)
  assert.equal(result.next_after, null)
  assert.deepEqual(reads, [stableObjectPath("A1BG")])

  const unpinned = await published(backlogEnv(db), { limit: 5 })
  assert.equal(
    unpinned.snapshot_version,
    "genes-v3",
    "an unpinned walk pins the stable object generation",
  )
})

test("published backlog skips a missing stable object and a storage error without failing the page", async (t) => {
  const db = new SqliteD1()
  for (const symbol of ["ERR1", "GOOD", "MISS"]) db.seedGene(symbol, { winner: SHA_A })
  installStableObjectStorage(
    t,
    new Map([
      [stableObjectPath("ERR1"), { status: 500 }],
      [stableObjectPath("GOOD"), stableGeneObject("GOOD", { portraitSha: SHA_A })],
    ]),
  )

  const page = await published(backlogEnv(db), { limit: 25 })

  assert.equal(page.ok, true)
  assert.deepEqual(
    page.items.map((item) => item.symbol),
    ["GOOD"],
  )
  assert.equal(page.scanned, 3)
  assert.equal(page.skipped.missing, 1)
  assert.equal(page.skipped.errors, 1)
  assert.equal(page.done, true)
  assert.equal(page.next_after, "MISS")
})

test("an unknown scope is rejected and an oversized limit is clamped", async (t) => {
  const db = new SqliteD1()
  installStableObjectStorage(t, new Map())
  await assert.rejects(
    listIconoplasmGeneBlotBacklog(backlogEnv(db), {
      request: backlogRequest(),
      payload: { scope: "everything" },
    }),
    (error) => error.status === 400 && error.code === "INVALID_BLOT_SCOPE",
  )
  const page = await published(backlogEnv(db), { limit: 99999 })
  assert.deepEqual(page.items, [])
  assert.equal(page.done, true)
  const rowsQuery = db.queries.find((sql) => /icono_published_gene_routes/.test(sql))
  assert.ok(rowsQuery, "the walk still ran one bounded routes query")
})

// 7. The drain pins the version it started a backfill with and aborts the walk
//    when a page names another one. An automatic (paged) walk must echo the pin
//    exactly like the explicit-symbol path does; measured 2026-10-02 01:09
//    local, the drain raised "changed snapshots during a pinned backfill".
test("an automatic published walk echoes the pinned snapshot version page after page", async (t) => {
  const db = new SqliteD1()
  for (let index = 0; index < 3; index += 1) {
    db.seedGene(symbolAt(index), {
      winner: SHA_A,
      blot: currentBlot(stableGeneObject(symbolAt(index), { portraitSha: SHA_A })),
    })
  }
  installStableObjectStorage(t, new Map())
  const first = await published(backlogEnv(db), { limit: 2, snapshot: "ccv2-pinned-by-the-drain" })
  assert.equal(first.automatic, true)
  assert.equal(first.snapshot_version, "ccv2-pinned-by-the-drain")
  assert.equal(first.done, false)
  const second = await published(backlogEnv(db), {
    after: first.next_after,
    limit: 2,
    snapshot: "ccv2-pinned-by-the-drain",
  })
  assert.equal(second.snapshot_version, "ccv2-pinned-by-the-drain")
  assert.equal(second.done, true)
})
