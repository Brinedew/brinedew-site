// GeneGuessr's structure lookups make no KV writes for a protein with a stored source.
//
// The free plan allows 1,000 KV writes a day, and the daily answer record
// (`puzzle_actual:*`), the daily bootstrap cache and the comments cache share that
// allowance. Looking up a protein's structure used to put `structure_source:<uniprot>`
// every time it resolved a protein from its stored row. The row always wins over
// that key, and the key's only reader runs when a protein has no stored source, so
// the write was never read back: each practice bootstrap, structure token and guess
// spent one (a first practice visit two).
//
// Production shape, measured 2026-10-03: 18,361 of 19,110 proteins have a stored
// structure source and resolve from their row. The other 749 have none, are not in
// the autocomplete index and are not in a target pool. Only those 749 reach the
// discovery path, which asks three public APIs and caches the answer in KV. A
// `/api/structure-token?uniprot=` request for an accession that is not in the
// catalog used to reach discovery too, and made a put per distinct string.
//
// Everything runs through the real Worker against a real local D1 built from the
// real GeneGuessr migrations and seeded with the production shape (19,110 proteins),
// with no R2 bucket bound and `fetch` counted. The KV stub records every put and
// its options.
//
// Failure modes this file proves, each written before the code that fixes it:
//   K1  a structure token for a protein with a stored source writes KV
//   K2  a first or a returning practice bootstrap writes KV for a stored source
//   K3  a guess writes KV for the guessed protein's structure
//   K4  an accession that is not in the catalog runs discovery and writes KV
//   K5  discovery writes on every lookup instead of once per protein, or its entry
//       expires after a day instead of a month
//   K6  the stored row stops winning over a stale KV entry
import assert from "node:assert/strict"
import test, { after, before, mock } from "node:test"

import worker from "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"
import {
  geneguessrWorkerEnv,
  meteredDb,
  openCatalogDb,
  productionShapedCatalogRows,
  seedCatalog,
} from "./daily-selection-pool-test-d1.js"

// A structure file every format's availability check accepts.
const PROBE_BODY = "data_structure\nHEADER    MODEL\nATOM  1\n"
const THIRTY_DAYS = 60 * 60 * 24 * 30

let db
let dispose
let rows

before(async () => {
  ;({ db, dispose } = await openCatalogDb())
  rows = productionShapedCatalogRows()
  await seedCatalog(db, rows)
  // The first practice start builds the stored pool (one scan). Pay it once here.
  await call("/api/game/bootstrap?practice=1", { cookie: "warm-up" })
})
after(async () => {
  await dispose()
})

const firstWith = (source) => rows.find((row) => row.structure_source === source)

// One request through the real Worker. `fetch` is the network: discovery's three
// API lookups answer 404, and any structure file answers with a usable body.
async function call(path, { method = "GET", cookie = null, body = null, sessions = new Map(), kvEntries = {} } = {}) {
  const fetched = []
  const putOptions = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    fetched.push(String(url))
    if (/\/api\/|\.json|\/pdbe\//.test(String(url))) return new Response("{}", { status: 404 })
    return new Response(PROBE_BODY, { status: 200, headers: { "Content-Type": "chemical/x-cif" } })
  }
  mock.method(console, "log", () => {})
  mock.method(console, "warn", () => {})
  mock.method(console, "error", () => {})
  try {
    const metered = meteredDb(db)
    const harness = geneguessrWorkerEnv(metered, { sessions, kvEntries })
    const put = harness.env.KV.put
    harness.env.KV.put = async (key, value, options) => {
      putOptions.push({ key, ttl: options?.expirationTtl ?? null })
      return put(key, value, options)
    }
    const headers = { ...(cookie ? { Cookie: `geneguessr_session=${cookie}` } : {}) }
    if (body) headers["Content-Type"] = "application/json"
    const waits = []
    const response = await worker.fetch(
      new Request(`https://geneguessr.brinedew.bio${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      }),
      harness.env,
      { waitUntil: (promise) => waits.push(Promise.resolve(promise)) },
    )
    await Promise.allSettled(waits)
    const payload = response.headers.get("content-type")?.includes("json")
      ? await response.json()
      : await response.text()
    return { response, payload, fetched, putOptions, ...harness }
  } finally {
    globalThis.fetch = originalFetch
    mock.restoreAll()
  }
}

test("K1: a structure token for a protein with a stored source writes no KV, whichever source it has", async () => {
  for (const source of ["pdb", "swissmodel", "alphafold"]) {
    const row = firstWith(source)
    const { response, payload, kvPuts, fetched } = await call(
      `/api/structure-token?uniprot=${row.uniprot}`,
    )
    assert.equal(response.status, 200, source)
    assert.ok(payload.url, `${source}: the token carries a structure url`)
    assert.deepEqual(kvPuts, [], `${source}: KV puts`)
    assert.deepEqual(fetched, [], `${source}: the stored row is not probed`)
  }
})

test("K2: a first and a returning practice bootstrap write no KV for the target's structure", async () => {
  const sessions = new Map()
  const first = await call("/api/game/bootstrap?practice=1", { cookie: "kv-player", sessions })
  assert.equal(first.response.status, 200)
  assert.ok(first.payload.targetStructureToken, "the browser still gets a structure token")
  assert.deepEqual(first.kvPuts, [], "first visit")

  const again = await call("/api/game/bootstrap?practice=1", { cookie: "kv-player", sessions })
  assert.equal(again.response.status, 200)
  assert.deepEqual(again.kvPuts, [], "returning visit")
})

test("K3: a guess writes no KV, and still returns the guessed protein's structure token", async () => {
  for (const source of ["pdb", "swissmodel", "alphafold"]) {
    const sessions = new Map()
    const cookie = `kv-guesser-${source}`
    await call("/api/game/bootstrap?practice=1", { cookie, sessions })
    const target = [...sessions.values()][0].targetId
    const guess = rows.find((row) => row.structure_source === source && row.uniprot !== target)
    const { response, payload, kvPuts } = await call("/api/game/guess?practice=1", {
      method: "POST",
      cookie,
      sessions,
      body: { uniprot: guess.uniprot },
    })
    assert.equal(response.status, 200, source)
    assert.ok(payload.guessStructureToken?.url, `${source}: the guess card still has its structure`)
    assert.equal(payload.guessStructureToken.cacheKey.split("/")[0], source)
    assert.deepEqual(kvPuts, [], `${source}: KV puts`)
  }
})

test("K4: an accession that is not in the catalog is refused before discovery, with no fetch and no KV write", async () => {
  let puts = 0
  let fetches = 0
  for (let index = 0; index < 40; index += 1) {
    const { response, kvPuts, fetched } = await call(
      `/api/structure-token?uniprot=ZZ${String(index).padStart(4, "0")}`,
    )
    assert.equal(response.status, 404, `junk accession ${index}`)
    puts += kvPuts.length
    fetches += fetched.length
  }
  assert.equal(puts, 0, "KV puts for 40 junk accessions")
  assert.equal(fetches, 0, "outbound fetches for 40 junk accessions")
})

test("K5: the 749-protein class with no stored source is discovered once, and the answer is kept for a month", async () => {
  const row = rows.find((candidate) => candidate.structure_source === null)
  const first = await call(`/api/structure-token?uniprot=${row.uniprot}`)
  assert.equal(first.response.status, 200, "discovery still finds the AlphaFold file")
  assert.ok(first.fetched.length >= 3, `discovery asked ${first.fetched.length} public APIs`)
  assert.equal(first.putOptions.length, 1, `puts: ${first.putOptions.map((p) => p.key).join(", ")}`)
  assert.equal(first.putOptions[0].key, `structure_source:${row.uniprot}`)
  assert.equal(first.putOptions[0].ttl, THIRTY_DAYS)

  // The same protein again: a cache hit, so no discovery and no write.
  const kvEntries = Object.fromEntries(first.kv)
  const again = await call(`/api/structure-token?uniprot=${row.uniprot}`, { kvEntries })
  assert.equal(again.response.status, 200)
  assert.deepEqual(again.putOptions, [], "a cache hit writes nothing")
  assert.ok(again.fetched.length <= 1, `a cache hit probes the file at most once: ${again.fetched}`)
})

test("K6: a stale KV entry never beats the stored row, and is not rewritten", async () => {
  const row = firstWith("pdb")
  const stale = {
    source: "swissmodel",
    r2Key: `swissmodel/${row.uniprot}_old.pdb`,
    upstreamUrl: `https://swissmodel.expasy.org/repository/uniprot/${row.uniprot}.pdb`,
    shortLabel: "SWISS-MODEL",
    displayLabel: "SWISS-MODEL (old)",
    format: "pdb",
  }
  const { response, payload, putOptions } = await call(
    `/api/structure-token?uniprot=${row.uniprot}`,
    { kvEntries: { [`structure_source:${row.uniprot}`]: JSON.stringify(stale) } },
  )
  assert.equal(response.status, 200)
  assert.equal(payload.format, "bcif", "the stored PDB source wins")
  assert.equal(payload.cacheKey, `pdb/${row.pdb_id}.bcif`)
  assert.deepEqual(putOptions, [])
})
