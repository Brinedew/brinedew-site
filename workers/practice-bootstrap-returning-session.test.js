// A returning practice player is served from their own session, not from a fresh pick.
//
// `/api/game/bootstrap?practice=1` used to pick a random practice protein on every
// page load, in parallel with the session read, and then throw the pick away for a
// returning player: the session's own target, a stored practice pool, a `date=`
// link or `same_target=1` overwrote it. With R2 unbound, as in production, that pick
// was a D1 round (the stored pool, the failure lookup, a `structure_failures`
// DELETE), one outbound structure probe the player waited for, and a KV put.
//
// Now a practice request reads the session first and picks only when nothing
// names a target. A browser with no session cookie has no session by construction,
// so it neither reads one nor waits to pick.
//
// Everything runs through the real Worker against a real local D1 built from the
// real GeneGuessr migrations and seeded with the production shape (19,110
// proteins, 17,513 practice-eligible), with no R2 bucket bound and `fetch` counted.
//
// Failure modes this file proves, each written before the code that fixes it:
//   R1  a returning same-day bootstrap still picks, probes a structure and writes KV twice
//   R2  a first-time bootstrap loses its pick
//   R3  a restart keeps the old target, or drops the stored practice pool
//   R4  a session that cannot name a usable target stops picking a replacement
//   R5  yesterday's session keeps yesterday's target
//   R6  a `date=` or `same_target=1` link picks anyway, or is not honoured
//   R7  a failed session read stops the player instead of being treated as no session
//   R8  a browser with no cookie reads a session that cannot exist
import assert from "node:assert/strict"
import test, { after, before, mock } from "node:test"

import worker from "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"
import * as proteinStore from "./lib/protein-store.js"
import {
  geneguessrWorkerEnv,
  meteredDb,
  openCatalogDb,
  productionShapedCatalogRows,
  seedCatalog,
} from "./daily-selection-pool-test-d1.js"

// A structure file every format's availability check accepts.
const PROBE_BODY = "data_structure\nHEADER    MODEL\nATOM  1\n"
const SESSION_KIND = "practice_guest_"

let db
let dispose

before(async () => {
  ;({ db, dispose } = await openCatalogDb())
  await seedCatalog(db, productionShapedCatalogRows())
  // The first practice start builds the stored pool (one scan). Pay it once here,
  // so every test below starts from the state production is in.
  await bootstrap({ cookie: "warm-up" })
})
after(async () => {
  await dispose()
})

function seededRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const oneLine = (sql) => String(sql).replace(/\s+/g, " ").trim()
const today = () => new Date().toISOString().slice(0, 10)
const yesterday = () => new Date(Date.now() - 86400000).toISOString().slice(0, 10)

// The statements a pick makes: the stored pools and the failure lookup and write.
const pickStatements = (statements) =>
  statements.filter((sql) => /_selection_pool|structure_failures/.test(sql))

// The only session a test created.
const onlySession = (sessions) => {
  assert.equal(sessions.size, 1, "one session")
  const [[key, state]] = [...sessions.entries()]
  assert.ok(key.startsWith(SESSION_KIND), `a practice session, not ${key}`)
  return state
}

// What the picker returns first under a seed, computed outside the Worker.
async function firstCandidate(seed) {
  const random = mock.method(Math, "random", seededRandom(seed))
  try {
    return (await proteinStore.pickPracticeCandidateIds(meteredDb(db)))[0]
  } finally {
    random.mock.restore()
  }
}

// One practice bootstrap through the real Worker. `fetch` is the upstream: it
// records each URL the Worker asks for and answers with a usable structure file.
async function bootstrap({
  query = "",
  cookie = null,
  sessions = new Map(),
  failSessionReads = false,
  kvEntries = {},
  seed = null,
} = {}) {
  const fetched = []
  const statements = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    fetched.push(String(url))
    return new Response(PROBE_BODY, {
      status: 200,
      headers: { "Content-Type": "chemical/x-cif" },
    })
  }
  mock.method(console, "log", () => {})
  mock.method(console, "warn", () => {})
  mock.method(console, "error", () => {})
  if (seed !== null) mock.method(Math, "random", seededRandom(seed))
  try {
    const metered = meteredDb(db, { before: (sql) => statements.push(oneLine(sql)) })
    const harness = geneguessrWorkerEnv(metered, { sessions, failSessionReads, kvEntries })
    const waits = []
    const response = await worker.fetch(
      new Request(`https://geneguessr.brinedew.bio/api/game/bootstrap?practice=1${query}`, {
        headers: cookie ? { Cookie: `geneguessr_session=${cookie}` } : {},
      }),
      harness.env,
      { waitUntil: (promise) => waits.push(Promise.resolve(promise)) },
    )
    await Promise.allSettled(waits)
    const payload = response.ok ? await response.json() : null
    return { response, payload, fetched, statements, metered, ...harness }
  } finally {
    globalThis.fetch = originalFetch
    mock.restoreAll()
  }
}

test("R1: a returning practice bootstrap makes no pick, no structure probe and one KV write", async (t) => {
  const sessions = new Map()
  const first = await bootstrap({ cookie: "returning-1", sessions })
  assert.equal(first.response.status, 200)
  const targetId = onlySession(sessions).targetId
  assert.ok(pickStatements(first.statements).length > 0, "the first visit picks")
  assert.equal(first.fetched.length, 1, "and probes the picked structure once")

  const again = await bootstrap({ cookie: "returning-1", sessions })
  t.diagnostic(
    `returning bootstrap: ${pickStatements(again.statements).length} pick statements, ${again.fetched.length} probes, ${again.kvPuts.length} KV puts, ${again.metered.totalRead()} rows read, ${again.statements.length} statements in all`,
  )
  t.diagnostic(
    `first visit:         ${pickStatements(first.statements).length} pick statements, ${first.fetched.length} probes, ${first.kvPuts.length} KV puts, ${first.metered.totalRead()} rows read, ${first.statements.length} statements in all`,
  )
  assert.equal(again.response.status, 200)
  assert.ok(again.payload.targetStructureToken, "the browser still gets a structure token")
  assert.equal(onlySession(sessions).targetId, targetId, "the player keeps their target")
  assert.equal(pickStatements(again.statements).length, 0, "no pool read, failure lookup or write")
  assert.equal(again.fetched.length, 0, "no structure probe")
  assert.ok(again.kvPuts.length <= 1, `${again.kvPuts.length} KV puts: ${again.kvPuts.join(", ")}`)
})

test("R1: on a cold isolate a returning bootstrap reads the session's own protein row and nothing else", async (t) => {
  // Q18999 has not been loaded by this process, so its row is not in the
  // in-memory protein cache that makes a warm isolate read nothing. The test
  // drops the session's structure pin so the bootstrap pins it again, which is
  // one session write (and its observation row); that write is the test's, not
  // the returning path's, so the assertion is about the protein statements.
  const sessions = new Map()
  await bootstrap({ cookie: "returning-cold", sessions })
  const key = [...sessions.keys()][0]
  sessions.set(key, { ...onlySession(sessions), targetId: "Q18999", targetStructureMeta: null })

  const again = await bootstrap({ cookie: "returning-cold", sessions })
  const proteinReads = again.metered.receipts
    .filter((receipt) => /FROM proteins/i.test(receipt.sql))
    .map((receipt) => receipt.rows_read)
  t.diagnostic(`cold returning bootstrap: protein statements read ${proteinReads.join(", ")} rows`)
  assert.equal(again.response.status, 200)
  assert.equal(onlySession(sessions).targetId, "Q18999")
  assert.equal(pickStatements(again.statements).length, 0)
  assert.equal(again.fetched.length, 0)
  assert.deepEqual(proteinReads, [1], "one protein row: the session's target")
})

test("R2: a first-time practice bootstrap still picks, from the stored pool, and pins the pick", async () => {
  const expected = await firstCandidate(20261003)
  const sessions = new Map()
  const { response, payload, fetched } = await bootstrap({ sessions, seed: 20261003 })
  assert.equal(response.status, 200)
  assert.ok(payload.targetStructureToken)
  assert.equal(onlySession(sessions).targetId, expected, "the picker's first available candidate")
  assert.equal(fetched.length, 1, "the pick's structure is probed once")
})

test("R3: a restart with a stored practice pool picks from that pool and keeps it, with no global pick", async () => {
  const sessions = new Map()
  await bootstrap({ cookie: "restarter", sessions })
  const key = [...sessions.keys()][0]
  const pool = ["Q00010", "Q00020", "Q00030"]
  sessions.set(key, { ...onlySession(sessions), practicePool: pool })

  const restart = await bootstrap({ cookie: "restarter", sessions, query: "&restart=1" })
  assert.equal(restart.response.status, 200)
  const state = onlySession(sessions)
  assert.ok(pool.includes(state.targetId), `${state.targetId} comes from the pool`)
  assert.deepEqual(state.practicePool, pool, "the pool survives the restart")
  assert.deepEqual(pickStatements(restart.statements), [])
  assert.deepEqual(restart.fetched, [])
})

test("R3: a restart with no pool picks a new target", async () => {
  const sessions = new Map()
  await bootstrap({ cookie: "restarter-2", sessions })
  const before = onlySession(sessions).targetId
  const expected = await firstCandidate(77)
  assert.notEqual(expected, before, "the seed names another protein")

  const restart = await bootstrap({
    cookie: "restarter-2",
    sessions,
    query: "&restart=1",
    seed: 77,
  })
  assert.equal(restart.response.status, 200)
  assert.equal(onlySession(sessions).targetId, expected)
  assert.ok(pickStatements(restart.statements).length > 0)
})

test("R4: a same-day session whose target is not in the catalog behaves as it did", async () => {
  // Proteins are never removed from the catalog, so this is not a path a player
  // takes. It is pinned so a later change to it is deliberate: the session keeps
  // the target it has, and the request answers that the target is unavailable.
  const sessions = new Map()
  await bootstrap({ cookie: "orphan", sessions })
  const key = [...sessions.keys()][0]
  sessions.set(key, { ...onlySession(sessions), targetId: "QZZZZZ" })

  const { response } = await bootstrap({ cookie: "orphan", sessions })
  assert.equal(response.status, 500)
  assert.equal(onlySession(sessions).targetId, "QZZZZZ")
})

test("R5: yesterday's session is replaced by a fresh pick", async () => {
  const sessions = new Map()
  await bootstrap({ cookie: "yesterday", sessions })
  const key = [...sessions.keys()][0]
  const old = onlySession(sessions)
  sessions.set(key, { ...old, date: yesterday() })
  const expected = await firstCandidate(5)
  assert.notEqual(expected, old.targetId)

  const { response, statements } = await bootstrap({ cookie: "yesterday", sessions, seed: 5 })
  assert.equal(response.status, 200)
  const state = onlySession(sessions)
  assert.equal(state.date, today())
  assert.equal(state.targetId, expected)
  assert.ok(pickStatements(statements).length > 0)
})

test("R6: same_target=1 replays the named target with no pick, and picks when that target is unknown", async () => {
  const named = await bootstrap({ query: "&same_target=1&target_id=Q00010" })
  assert.equal(named.response.status, 200)
  assert.equal(onlySession(named.sessions).targetId, "Q00010")
  assert.deepEqual(pickStatements(named.statements), [])
  assert.deepEqual(named.fetched, [])

  const expected = await firstCandidate(11)
  const unknown = await bootstrap({ query: "&same_target=1&target_id=QZZZZZ", seed: 11 })
  assert.equal(unknown.response.status, 200)
  assert.equal(onlySession(unknown.sessions).targetId, expected)
  assert.ok(pickStatements(unknown.statements).length > 0)
})

test("R6: date= replays that day's puzzle with no pick", async () => {
  const kvEntries = { "puzzle_actual:2026-09-20": JSON.stringify({ uniprot_id: "Q00040" }) }
  const { response, sessions, statements, fetched } = await bootstrap({
    query: "&date=2026-09-20",
    kvEntries,
  })
  assert.equal(response.status, 200)
  assert.equal(onlySession(sessions).targetId, "Q00040")
  assert.deepEqual(pickStatements(statements), [])
  assert.deepEqual(fetched, [])
})

test("R7: a session read that fails is treated as no session, so the player still gets a pick", async () => {
  const expected = await firstCandidate(31)
  const { response, sessions, sessionReads, statements } = await bootstrap({
    cookie: "unreadable",
    failSessionReads: true,
    seed: 31,
  })
  assert.equal(response.status, 200)
  assert.ok(sessionReads.length >= 1, "the Worker did try to read the session")
  assert.equal(onlySession(sessions).targetId, expected)
  assert.ok(pickStatements(statements).length > 0)
})

test("R8: a browser with no session cookie reads no session, and one with a cookie reads it", async () => {
  const guest = await bootstrap({})
  assert.equal(guest.response.status, 200)
  assert.deepEqual(guest.sessionReads, [], "a session minted for this request cannot exist yet")

  const cookie = await bootstrap({ cookie: "has-cookie" })
  assert.equal(cookie.response.status, 200)
  assert.equal(cookie.sessionReads.length, 1)
})
