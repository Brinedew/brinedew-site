// The 23:55 UTC pre-warm, and the first visitor after it.
//
// The cron is the one place a daily structure is verified. It probes tomorrow's
// pick, records it, and warms the bootstrap cache for each public origin. A visitor
// after midnight is served that verified pick: no outbound probe, no cache rewrite
// and no replacement of the record, however slow a provider is at that moment.
// When no pick was recorded at all, the visitor's request still computes, probes
// and records one.
//
// A probe that misses its 5 second timer proves nothing about a structure (RCSB's
// ModelServer takes 2 to 5 seconds to build one), so the player path never acts on
// one (B-918).
//
// Everything runs through the real Worker on a real local D1 built from the real
// migrations and seeded with the production shape (19,110 proteins, 10,312 playable
// in 3,900 families). `fetch` is the providers, and the clock is set per test.
//
// Failure modes this file proves, each written before the code that fixes it:
//   C1  a bootstrap whose cached entry is hours old sends an outbound probe
//   C2  that bootstrap, with a provider that never answers in time, deletes the
//       cache entry, writes a key or a `structure_failures` row, or replaces the pick
//   C3  with the cache gone but the pick recorded, the bootstrap probes anyway
//   C4  with no pick recorded, the request path stops computing, probing and recording
//   C5  the cron warms the caches before it records the pick
//   C6  the cron's pick write fails (or no target, or no reachable structure) and
//       the invocation still reports success
//   C7  a failed pre-warm is not reported to Sentry; or is reported with no DSN set
//   C8  a second cron run rewrites the record
//   C9  a provider's error page, sent with a 200, is accepted as a structure
//   C10 a staging Worker with no record of its own computes a pick instead of serving the
//       production record's, or scans the pool to do it
import assert from "node:assert/strict"
import test, { after, afterEach, before, mock } from "node:test"

import worker from "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"
import { DAILY_SELECTION_POOL_SOURCE_SQL } from "./lib/protein-store.js"
import {
  geneguessrWorkerEnv,
  meteredDb,
  openCatalogDb,
  productionShapedCatalogRows,
  seedCatalog,
} from "./daily-selection-pool-test-d1.js"

const CRON = "55 23 * * *"
const NIGHT = "2026-10-03T23:55:20.000Z"
const DAY = "2026-10-04"
const AN_HOUR_LATER = "2026-10-04T00:55:05.000Z"
const ORIGINS = ["brinedew.bio", "geneguessr.brinedew.bio", "iconoplasm.brinedew.bio"]
const SENTRY_DSN = "https://publickey@o1.ingest.us.sentry.io/42"
const USABLE_STRUCTURE = new TextEncoder().encode("HEADER    MODEL\ndata_probe\nATOM  \n")

let db
let dispose

before(async () => {
  const opened = await openCatalogDb()
  db = opened.db
  dispose = opened.dispose
  await seedCatalog(db, productionShapedCatalogRows())
})

after(async () => {
  await dispose?.()
})

let clockOn = false

afterEach(() => {
  mock.timers.reset()
  clockOn = false
  mock.restoreAll()
})

function setClock(iso) {
  if (clockOn) {
    mock.timers.setTime(Date.parse(iso))
  } else {
    mock.timers.enable({ apis: ["Date"], now: Date.parse(iso) })
    clockOn = true
  }
}

// The providers. `abortWhen(callNumber, url)` makes that provider call fail the way a
// probe that misses its 5 second timer does. Sentry envelopes are kept apart.
function stubNetwork({ abortWhen = () => false, respond = () => null } = {}) {
  const providerCalls = []
  const sentry = []
  mock.method(globalThis, "fetch", async (input) => {
    const url = String(input?.url ?? input)
    if (url.includes("ingest.us.sentry.io")) {
      sentry.push(url)
      return new Response("{}", { status: 200 })
    }
    providerCalls.push(url)
    if (abortWhen(providerCalls.length, url)) {
      throw new DOMException("The operation was aborted", "AbortError")
    }
    const answer = respond(providerCalls.length, url)
    if (answer) return answer
    return new Response(USABLE_STRUCTURE, {
      status: 200,
      headers: { "Content-Type": "application/octet-stream" },
    })
  })
  return { providerCalls, sentry }
}

function freshEnv(options = {}) {
  const metered = meteredDb(db)
  const harness = geneguessrWorkerEnv(metered, options)
  const waits = []
  const ctx = { waitUntil: (promise) => waits.push(Promise.resolve(promise)) }
  return {
    ...harness,
    metered,
    ctx,
    waits,
    settle: () => Promise.allSettled(waits),
    runCron: () => worker.scheduled({ cron: CRON, scheduledTime: Date.now() }, harness.env, ctx),
    bootstrap: () =>
      worker.fetch(
        new Request("https://geneguessr.brinedew.bio/api/game/bootstrap"),
        harness.env,
        ctx,
      ),
  }
}

const record = (harness) => JSON.parse(harness.kv.get(`puzzle_actual:${DAY}`))
const oneLine = (sql) => String(sql).replace(/\s+/g, " ").trim()

test("C5: the cron verifies once, records the pick first, then warms one cache per origin", async () => {
  setClock(NIGHT)
  const network = stubNetwork()
  const harness = freshEnv()

  await harness.runCron()
  await harness.settle()

  assert.deepEqual(harness.kvPuts, [
    `puzzle_actual:${DAY}`,
    ...ORIGINS.map((host) => `daily_bootstrap:${DAY}:${host}`),
  ])
  assert.equal(network.providerCalls.length, 1, "one probe verifies the pick")
  const stored = record(harness)
  assert.equal(stored.date, DAY)
  assert.equal(stored.source, "computed")
  assert.deepEqual(stored.rejected, [])
  for (const host of ORIGINS) {
    const cached = JSON.parse(harness.kv.get(`daily_bootstrap:${DAY}:${host}`))
    assert.equal(cached.targetProtein.uniprot, stored.uniprot_id)
    assert.ok(cached.structureToken.url.startsWith(`https://${host}/api/structure-cached?`))
  }
})

test("C1, C2: a visitor an hour after the cron is served its pick without a probe, a write, a delete or a replacement", async () => {
  setClock(NIGHT)
  stubNetwork()
  const night = freshEnv()
  await night.runCron()
  const recorded = night.kv.get(`puzzle_actual:${DAY}`)
  const putsAfterCron = [...night.kvPuts]

  // An hour later every provider call misses its timer.
  mock.restoreAll()
  setClock(AN_HOUR_LATER)
  const network = stubNetwork({ abortWhen: () => true })
  const visit = freshEnv({ kvEntries: Object.fromEntries(night.kv) })
  const failuresBefore = (await db.prepare("SELECT COUNT(*) AS n FROM structure_failures").first())
    .n

  const response = await visit.bootstrap()
  await visit.settle()

  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.status.date, DAY)
  assert.ok(payload.targetStructureToken?.url, "the cron's structure token is served")
  assert.equal(network.providerCalls.length, 0, "no outbound probe")
  assert.deepEqual(visit.kvPuts, [], "no KV write (no cache refresh, no record rewrite)")
  assert.deepEqual(visit.kvDeletes, [], "the cache entry is not deleted")
  assert.equal(visit.kv.get(`puzzle_actual:${DAY}`), recorded, "the recorded pick is untouched")
  assert.equal(
    (await db.prepare("SELECT COUNT(*) AS n FROM structure_failures").first()).n,
    failuresBefore,
    "no structure_failures row",
  )
  // The session's own bookkeeping writes are not about the pick or its structure.
  assert.deepEqual(
    visit.metered.receipts.filter(
      (receipt) =>
        receipt.rows_written > 0 &&
        /structure_failures|daily_selection_pool|daily_target_availability|proteins/i.test(
          receipt.sql,
        ),
    ),
    [],
    "no D1 write about the pick or its structure",
  )
  assert.equal(putsAfterCron.length, 4)
})

test("C2: a provider that is slow for the recorded pick's one structure does not replace the pick", async () => {
  setClock(NIGHT)
  stubNetwork()
  const night = freshEnv()
  await night.runCron()
  const recorded = night.kv.get(`puzzle_actual:${DAY}`)
  const slowUrl = JSON.parse(night.kv.get(`daily_bootstrap:${DAY}:geneguessr.brinedew.bio`))
    .structureMeta.upstreamUrl

  // An hour later that one structure misses its timer; every other structure is fine.
  mock.restoreAll()
  setClock(AN_HOUR_LATER)
  const network = stubNetwork({ abortWhen: (_call, url) => url === slowUrl })
  const entries = Object.fromEntries(night.kv)
  const deleted = []
  for (let visitor = 0; visitor < 3; visitor += 1) {
    const visit = freshEnv({ kvEntries: entries })
    const response = await visit.bootstrap()
    await visit.settle()
    assert.equal(response.status, 200)
    deleted.push(...visit.kvDeletes)
    for (const [key, value] of visit.kv) entries[key] = value
  }

  assert.equal(network.providerCalls.length, 0)
  assert.deepEqual(deleted, [])
  assert.equal(entries[`puzzle_actual:${DAY}`], recorded, "the recorded pick is untouched")
})

test("C3: with the caches gone and the pick recorded, the visitor probes nothing and writes one cache entry", async () => {
  setClock(NIGHT)
  stubNetwork()
  const night = freshEnv()
  await night.runCron()
  const recorded = night.kv.get(`puzzle_actual:${DAY}`)

  mock.restoreAll()
  setClock(AN_HOUR_LATER)
  const network = stubNetwork({ abortWhen: () => true })
  const entries = Object.fromEntries(night.kv)
  for (const host of ORIGINS) delete entries[`daily_bootstrap:${DAY}:${host}`]
  const visit = freshEnv({ kvEntries: entries })

  const response = await visit.bootstrap()
  await visit.settle()

  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.ok(payload.targetStructureToken?.url)
  assert.equal(network.providerCalls.length, 0)
  // The recorded pick is read by its accession. The pool of 10,312 playable proteins is not
  // scanned again to find it.
  assert.ok(
    visit.metered.receipts.every(
      (receipt) => oneLine(receipt.sql) !== oneLine(DAILY_SELECTION_POOL_SOURCE_SQL),
    ),
    "no request runs the pool scan",
  )
  assert.ok(visit.metered.totalRead() < 100, `${visit.metered.totalRead()} rows read`)
  assert.deepEqual(visit.kvPuts, [`daily_bootstrap:${DAY}:geneguessr.brinedew.bio`])
  assert.deepEqual(visit.kvDeletes, [])
  assert.equal(visit.kv.get(`puzzle_actual:${DAY}`), recorded)
  assert.equal(
    JSON.parse(visit.kv.get(`daily_bootstrap:${DAY}:geneguessr.brinedew.bio`)).targetProtein
      .uniprot,
    JSON.parse(recorded).uniprot_id,
  )
})

test("C4: with no pick recorded the request still computes, probes and records one", async () => {
  setClock(AN_HOUR_LATER)
  const network = stubNetwork()
  const visit = freshEnv()

  const response = await visit.bootstrap()
  await visit.settle()

  assert.equal(response.status, 200)
  assert.ok(network.providerCalls.length >= 1, "the unverified pick is probed")
  const stored = record(visit)
  assert.equal(stored.source, "computed")
  assert.deepEqual(stored.rejected, [])
})

test("C4: with no pick recorded and the first candidate unreachable, the request advances and records the next", async () => {
  setClock(AN_HOUR_LATER)
  stubNetwork()
  const first = freshEnv()
  await first.bootstrap()
  await first.settle()
  const computedFirst = record(first).uniprot_id

  mock.restoreAll()
  const network = stubNetwork({ abortWhen: (call) => call === 1 })
  const visit = freshEnv()
  const response = await visit.bootstrap()
  await visit.settle()

  assert.equal(response.status, 200)
  assert.equal(network.providerCalls.length >= 2, true)
  const stored = record(visit)
  assert.notEqual(stored.uniprot_id, computedFirst)
  assert.deepEqual(stored.rejected, [
    { uniprot_id: computedFirst, reason: "structure_unreachable" },
  ])
})

test("C9: a provider's error page sent with a 200 is not a structure: the pick advances to one that is", async () => {
  setClock(NIGHT)
  stubNetwork()
  const first = freshEnv()
  await first.runCron()
  const computedFirst = JSON.parse(first.kv.get(`puzzle_actual:${DAY}`)).uniprot_id
  const firstUrl = JSON.parse(first.kv.get(`daily_bootstrap:${DAY}:geneguessr.brinedew.bio`))
    .structureMeta.upstreamUrl

  const soft404s = [
    ["an HTML page", "text/html; charset=utf-8", "<html>temporary error</html>"],
    ["a JSON error", "application/json", '{"error":"not found"}'],
  ]
  for (const [name, type, body] of soft404s) {
    mock.restoreAll()
    setClock(NIGHT)
    stubNetwork({
      respond: (_call, url) =>
        url === firstUrl
          ? new Response(body, { status: 200, headers: { "Content-Type": type } })
          : null,
    })
    const harness = freshEnv()
    await harness.runCron()
    const stored = JSON.parse(harness.kv.get(`puzzle_actual:${DAY}`))
    assert.notEqual(stored.uniprot_id, computedFirst, `${name} was recorded as the pick`)
    assert.deepEqual(stored.rejected[0], {
      uniprot_id: computedFirst,
      reason: "structure_unreachable",
    })
  }
})

test("C9: a SWISS-MODEL answer that is no PDB file is not a structure, and a PDB file is", async () => {
  // Three SWISS-MODEL proteins, each in a family of its own: every candidate is a PDB file.
  const small = await openCatalogDb()
  try {
    await seedCatalog(
      small.db,
      productionShapedCatalogRows()
        .filter((row) => row.structure_source === "swissmodel" && row.gene_summary)
        .slice(0, 3)
        .map((row, index) => ({ ...row, gene_surname: `ONLY${index}` })),
    )
    setClock(NIGHT)
    stubNetwork({
      respond: () =>
        new Response("upstream is healthy", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        }),
    })
    const refused = geneguessrWorkerEnv(small.db)
    await assert.rejects(
      worker.scheduled({ cron: CRON, scheduledTime: Date.now() }, refused.env, { waitUntil() {} }),
      /no reachable target structure/i,
    )
    assert.deepEqual(refused.kvPuts, [], "nothing is recorded for a page that is no structure")

    mock.restoreAll()
    setClock(NIGHT)
    stubNetwork()
    const accepted = geneguessrWorkerEnv(small.db)
    await worker.scheduled({ cron: CRON, scheduledTime: Date.now() }, accepted.env, {
      waitUntil() {},
    })
    assert.ok(accepted.kv.get(`puzzle_actual:${DAY}`), "a PDB file is recorded as the pick")
  } finally {
    await small.dispose()
  }
})

test("C10: a staging Worker with no record of its own serves the production record's pick, with no pool scan", async () => {
  setClock(AN_HOUR_LATER)
  stubNetwork()
  const target = await db
    .prepare(
      "SELECT uniprot FROM proteins WHERE structure_source = 'pdb' AND gene_summary IS NOT NULL LIMIT 1",
    )
    .first()
  const visit = freshEnv()
  visit.env.PROD_KV = {
    async get(key) {
      return key === `puzzle_actual:${DAY}`
        ? JSON.stringify({ date: DAY, uniprot_id: target.uniprot, source: "computed" })
        : null
    },
  }

  const response = await visit.bootstrap()
  await visit.settle()

  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.status.date, DAY)
  assert.equal(JSON.stringify(payload).includes(target.uniprot), false, "the target stays secret")
  assert.ok(
    visit.metered.receipts.every(
      (receipt) => oneLine(receipt.sql) !== oneLine(DAILY_SELECTION_POOL_SOURCE_SQL),
    ),
    "the production record is read, the pool is not scanned",
  )
  assert.ok(visit.metered.totalRead() < 100, `${visit.metered.totalRead()} rows read`)
})

test("C6: a record write that fails makes the cron invocation fail, and nothing is warmed", async () => {
  setClock(NIGHT)
  stubNetwork()
  const harness = freshEnv()
  const put = harness.env.KV.put
  harness.env.KV.put = async (key, value, options) => {
    if (key.startsWith("puzzle_actual:")) throw new Error("KV put() limit exceeded for the day")
    return put(key, value, options)
  }

  await assert.rejects(harness.runCron(), /could not record/i)
  assert.deepEqual(harness.kvPuts, [])
})

test("C6: a pick whose structures are all unreachable makes the cron invocation fail", async () => {
  setClock(NIGHT)
  const network = stubNetwork({ abortWhen: () => true })
  const harness = freshEnv()

  await assert.rejects(harness.runCron(), /no reachable target structure/i)
  assert.ok(network.providerCalls.length >= 1 && network.providerCalls.length <= 10)
  assert.deepEqual(harness.kvPuts, [])
})

test("C6: an empty catalog makes the cron invocation fail", async () => {
  setClock(NIGHT)
  stubNetwork()
  const empty = await openCatalogDb()
  try {
    const harness = geneguessrWorkerEnv(empty.db)
    await assert.rejects(
      worker.scheduled({ cron: CRON, scheduledTime: Date.now() }, harness.env, {
        waitUntil() {},
      }),
      /no target protein/i,
    )
    assert.deepEqual(harness.kvPuts, [])
  } finally {
    await empty.dispose()
  }
})

test("C7: a failed pre-warm reaches Sentry when a DSN is set, and sends nothing without one", async () => {
  setClock(NIGHT)
  const network = stubNetwork({ abortWhen: () => true })

  const withDsn = freshEnv()
  withDsn.env.SENTRY_DSN = SENTRY_DSN
  await assert.rejects(withDsn.runCron(), /no reachable target structure/i)
  await withDsn.settle()
  assert.equal(network.sentry.length, 1)
  assert.equal(network.sentry[0], "https://o1.ingest.us.sentry.io/api/42/envelope/")

  const withoutDsn = freshEnv()
  await assert.rejects(withoutDsn.runCron(), /no reachable target structure/i)
  await withoutDsn.settle()
  assert.equal(network.sentry.length, 1, "no DSN, no envelope")
})

test("C8: a second cron run leaves the record as it was", async () => {
  setClock(NIGHT)
  stubNetwork()
  const harness = freshEnv()
  await harness.runCron()
  const recorded = harness.kv.get(`puzzle_actual:${DAY}`)

  setClock("2026-10-03T23:55:50.000Z")
  await harness.runCron()

  assert.equal(harness.kv.get(`puzzle_actual:${DAY}`), recorded)
  assert.equal(harness.kvPuts.filter((key) => key === `puzzle_actual:${DAY}`).length, 1)
})
