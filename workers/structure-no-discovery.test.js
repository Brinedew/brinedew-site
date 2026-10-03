// A GeneGuessr protein with no stored structure source has no structure.
//
// The stored `proteins.structure_source` is the decision. Production shape, measured
// on 2026-10-03: 18,361 of 19,110 proteins have a source and the column it needs
// (alphafold 7,482, pdb 4,989, swissmodel 5,890; none is missing its column); the
// other 749 have no source and none of `pdb_id`, `swissmodel_url` or `alphafold_url`.
// Those 749 are not in the autocomplete index (`structure_source IS NOT NULL`) and not
// in a target pool. Discovery used to run for them anyway: three outbound API calls, a
// five-second availability probe and one KV write per protein, reachable by a typed
// `/api/structure-token?uniprot=` and by a hand-made `POST /api/game/guess`, which
// accepts any catalog accession.
//
// Everything runs through the real Worker against a real local D1 built from the real
// GeneGuessr migrations and seeded with the production shape (19,110 proteins), with
// `fetch` counted and every KV operation recorded.
//
// Failure modes this file proves, each written before the code that fixes it:
//   D1  a structure token for a protein with no stored source runs discovery
//   D2  a guess naming such a protein runs discovery for its guess card
//   D3  a protein with no stored source but with candidate columns is probed over the
//       network for a fallback instead of having no structure
//   D4  any KV key in the `structure_source:` family is read, written or deleted
//   D5  a protein with a stored source stops getting its structure straight from its row
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

const withSource = (source) => rows.find((row) => row.structure_source === source)
const withoutSource = () => rows.filter((row) => row.structure_source === null)

// A structure file every format's availability check accepts.
const PROBE_BODY = "data_structure\nHEADER    MODEL\nATOM  1\n"

// One request through the real Worker. `fetch` is the network: discovery's public API
// lookups answer with a plausible empty result and a structure file with usable bytes,
// so a lookup that wrongly runs discovery would succeed and show itself in `fetched`.
async function call(
  path,
  { method = "GET", cookie = null, body = null, sessions = new Map(), kvEntries = {} } = {},
) {
  const fetched = []
  const kvOps = []
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
    for (const op of ["get", "put", "delete"]) {
      const original = harness.env.KV[op]
      harness.env.KV[op] = async (key, ...rest) => {
        kvOps.push(`${op} ${key}`)
        return original(key, ...rest)
      }
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
    return { response, payload, fetched, kvOps, metered, ...harness }
  } finally {
    globalThis.fetch = originalFetch
    mock.restoreAll()
  }
}

const structureSourceOps = (kvOps) => kvOps.filter((op) => op.includes("structure_source:"))

test("D1: a structure token for a protein with no stored source is 404, with no fetch and no KV key", async () => {
  const sample = withoutSource().filter((_row, index) => index % 150 === 0)
  assert.ok(sample.length >= 5, "the catalog has the 749-protein class")
  for (const row of sample) {
    const { response, payload, fetched, kvOps, metered } = await call(
      `/api/structure-token?uniprot=${row.uniprot}`,
    )
    assert.equal(response.status, 404, row.uniprot)
    assert.deepEqual(payload, { error: "Structure unavailable" })
    assert.deepEqual(fetched, [], `${row.uniprot}: outbound fetches`)
    assert.deepEqual(kvOps, [], `${row.uniprot}: KV operations`)
    assert.ok(metered.totalRead() <= 3, `${row.uniprot}: ${metered.totalRead()} rows read`)
  }
})

test("D2: a guess naming a protein with no stored source is accepted without a structure, a fetch or a KV key", async () => {
  const sessions = new Map()
  const cookie = "no-source-guesser"
  await call("/api/game/bootstrap?practice=1", { cookie, sessions })
  const guess = withoutSource()[7]
  const { response, payload, fetched, kvOps } = await call("/api/game/guess?practice=1", {
    method: "POST",
    cookie,
    sessions,
    body: { uniprot: guess.uniprot },
  })
  assert.equal(response.status, 200)
  assert.equal(payload.guessStructureToken, undefined, "the guess card has no structure")
  assert.deepEqual(fetched, [], "outbound fetches")
  assert.deepEqual(
    kvOps.filter((op) => !op.startsWith("get ")),
    [],
    "KV writes and deletes",
  )
  assert.deepEqual(structureSourceOps(kvOps), [])
})

test("D3: candidate columns without a stored source do not buy a network probe for a fallback", async () => {
  // Not a production shape (no such row exists: 0 of 19,110), the contract: the
  // stored source decides, so a row without one has no structure, whatever else it holds.
  await db
    .prepare(
      `INSERT INTO proteins (id, uniprot, gene, gene_surname, structure_source, gene_summary,
                             pdb_id, alphafold_url)
       VALUES (990001, 'Q990001', 'NOSOURCE1', 'FAM0001', NULL, 'Summary', '1ABC',
               'https://alphafold.ebi.ac.uk/files/AF-Q990001-F1-model_v6.pdb')`,
    )
    .run()
  try {
    const { response, payload, fetched, kvOps } = await call("/api/structure-token?uniprot=Q990001")
    assert.equal(response.status, 404)
    assert.deepEqual(payload, { error: "Structure unavailable" })
    assert.deepEqual(fetched, [], "outbound fetches")
    assert.deepEqual(kvOps, [], "KV operations")
  } finally {
    await db.prepare("DELETE FROM proteins WHERE id = 990001").run()
  }
})

test("D4: no request reads, writes or deletes a structure_source key, whatever KV holds", async () => {
  const stale = JSON.stringify({
    source: "swissmodel",
    r2Key: "swissmodel/STALE_old.pdb",
    upstreamUrl: "https://swissmodel.expasy.org/repository/uniprot/STALE.pdb",
    shortLabel: "SWISS-MODEL",
    displayLabel: "SWISS-MODEL (old)",
    format: "pdb",
  })
  const sourced = withSource("pdb")
  const missing = withoutSource()[0]
  const kvEntries = {
    [`structure_source:${sourced.uniprot}`]: stale,
    [`structure_source:${missing.uniprot}`]: stale,
  }
  for (const uniprot of [sourced.uniprot, missing.uniprot]) {
    const { kvOps, payload } = await call(`/api/structure-token?uniprot=${uniprot}`, { kvEntries })
    assert.deepEqual(structureSourceOps(kvOps), [], uniprot)
    if (uniprot === sourced.uniprot) {
      assert.equal(payload.cacheKey, `pdb/${sourced.pdb_id}.bcif`, "the stored row wins")
    } else {
      assert.deepEqual(payload, { error: "Structure unavailable" }, "a stale entry is not served")
    }
  }
})

test("D5: a protein with a stored source still gets its structure from its row, with no fetch and no KV", async () => {
  for (const source of ["pdb", "swissmodel", "alphafold"]) {
    const row = withSource(source)
    const { response, payload, fetched, kvOps, metered } = await call(
      `/api/structure-token?uniprot=${row.uniprot}`,
    )
    assert.equal(response.status, 200, source)
    assert.equal(payload.cacheKey.split("/")[0], source)
    assert.ok(payload.url.includes("/api/structure-cached?key="))
    assert.deepEqual(fetched, [], `${source}: the stored row is not probed`)
    assert.deepEqual(kvOps, [], `${source}: KV operations`)
    assert.ok(metered.totalRead() <= 3, `${source}: ${metered.totalRead()} rows read`)
  }
})
