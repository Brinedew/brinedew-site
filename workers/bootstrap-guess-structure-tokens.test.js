// A page load needs a structure token for every guess already made. The bootstrap
// puts each one in its guess entry, derived from the protein row it loads for that
// guess anyway, so a reload makes no `/api/structure-token?uniprot=` request.
//
// Everything runs through the real Worker against a real local D1 built from the real
// GeneGuessr migrations and seeded with the production shape (19,110 proteins), with
// `fetch` as the providers.
//
// Failure modes this file proves, each written before the code that fixes it:
//   G1  a guess entry in the bootstrap carries no token, so the browser asks for it
//   G2  the embedded token differs from what `/api/structure-token?uniprot=` returns for
//       the same protein (the browser would load a different structure on reload)
//   G3  a guess whose protein has no stored structure gets a token anyway
//   G4  the embedded tokens add D1 reads to the bootstrap
//   G5  a guess token names the target's structure
import assert from "node:assert/strict"
import test, { after, afterEach, before, mock } from "node:test"

import worker from "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"
import {
  geneguessrWorkerEnv,
  meteredDb,
  openCatalogDb,
  productionShapedCatalogRows,
  seedCatalog,
} from "./daily-selection-pool-test-d1.js"

const ORIGIN = "https://geneguessr.brinedew.bio"
const COOKIE = "geneguessr_session=token-guesser-1"
const PROBE_BODY = "data_structure\nHEADER    MODEL\nATOM  1\n"

let db
let dispose
let rows

before(async () => {
  ;({ db, dispose } = await openCatalogDb())
  rows = productionShapedCatalogRows()
  await seedCatalog(db, rows)
})
after(async () => {
  await dispose()
})
afterEach(() => mock.restoreAll())

const oneLine = (sql) => String(sql).replace(/\s+/g, " ").trim()

// One stored protein per structure source, and one with no stored source.
const pick = (source) => rows.find((row) => row.structure_source === source && row.gene_summary)
const withoutStructure = () => rows.find((row) => row.structure_source === null)

function stubProviders() {
  mock.method(globalThis, "fetch", async () => {
    return new Response(PROBE_BODY, {
      status: 200,
      headers: { "Content-Type": "chemical/x-cif" },
    })
  })
  mock.method(console, "log", () => {})
  mock.method(console, "warn", () => {})
}

async function bootstrap(harness, statements = []) {
  const waits = []
  const response = await worker.fetch(
    new Request(`${ORIGIN}/api/game/bootstrap`, { headers: { Cookie: COOKIE } }),
    harness.env,
    { waitUntil: (promise) => waits.push(Promise.resolve(promise)) },
  )
  await Promise.allSettled(waits)
  assert.equal(response.status, 200)
  return response.json()
}

async function tokenRoute(harness, uniprot) {
  const response = await worker.fetch(
    new Request(`${ORIGIN}/api/structure-token?uniprot=${uniprot}`),
    harness.env,
    { waitUntil() {} },
  )
  return { status: response.status, body: await response.json() }
}

// A session that has made these guesses. The first bootstrap creates the session; the
// guesses are then added to its stored state as the guess handler would leave them.
async function sessionWithGuesses(guessIds, { statements = [] } = {}) {
  const metered = meteredDb(db, { before: (sql) => statements.push(oneLine(sql)) })
  const harness = geneguessrWorkerEnv(metered)
  stubProviders()
  const first = await bootstrap(harness)
  assert.deepEqual(first.guesses, [])
  const [[key, state]] = [...harness.sessions.entries()]
  harness.sessions.set(key, {
    ...state,
    guesses: guessIds.map((uniprot, index) => ({
      guessId: `g${index + 1}`,
      uniprot,
      correct: false,
      createdAt: Date.now() + index,
      similarityPending: true,
    })),
  })
  return { harness, metered, statements, target: state.targetId }
}

test("G1, G2: every guess entry carries the token the token route returns for that protein", async () => {
  const guessed = [pick("pdb"), pick("swissmodel"), pick("alphafold")].map((row) => row.uniprot)
  const { harness } = await sessionWithGuesses(guessed)

  const payload = await bootstrap(harness)

  assert.deepEqual(
    payload.guesses.map((entry) => entry.uniprot),
    guessed,
  )
  for (const entry of payload.guesses) {
    assert.ok(entry.structureToken?.url, `${entry.uniprot} carries a token`)
    const route = await tokenRoute(harness, entry.uniprot)
    assert.equal(route.status, 200)
    assert.deepEqual(entry.structureToken, route.body, `${entry.uniprot}: same token as the route`)
    assert.ok(
      entry.structureToken.url.startsWith(`${ORIGIN}/api/structure-cached?key=`),
      "the URL is on the page's API origin",
    )
  }
})

test("G3: a guess whose protein has no stored structure has no token, and the route says so", async () => {
  const bare = withoutStructure().uniprot
  const { harness } = await sessionWithGuesses([pick("pdb").uniprot, bare])

  const payload = await bootstrap(harness)

  const entries = Object.fromEntries(payload.guesses.map((entry) => [entry.uniprot, entry]))
  assert.ok(entries[pick("pdb").uniprot].structureToken)
  assert.equal("structureToken" in entries[bare], false)
  assert.equal((await tokenRoute(harness, bare)).status, 404)
})

test("G4: the tokens cost no D1 read: a reload reads no protein row for the guesses", async () => {
  const guessed = [pick("pdb"), pick("swissmodel"), pick("alphafold")].map((row) => row.uniprot)
  const { harness, statements } = await sessionWithGuesses(guessed)
  await bootstrap(harness) // loads the guesses' rows into the session, as the first reload does

  statements.length = 0
  const payload = await bootstrap(harness)

  assert.equal(payload.guesses.length, 3)
  assert.ok(payload.guesses.every((entry) => entry.structureToken?.url))
  const proteinReads = statements.filter((sql) => /FROM proteins WHERE uniprot = \?/i.test(sql))
  assert.ok(
    proteinReads.length <= 1,
    `${proteinReads.length} protein reads (the target's, at most)`,
  )
})

test("G5: no guess token names the target's structure", async () => {
  const guessed = [pick("pdb"), pick("swissmodel"), pick("alphafold")].map((row) => row.uniprot)
  const { harness, target } = await sessionWithGuesses(guessed)

  const payload = await bootstrap(harness)

  const targetRow = rows.find((row) => row.uniprot === target)
  assert.ok(targetRow, "the session's target is in the catalog")
  assert.ok(!guessed.includes(target))
  const text = JSON.stringify(payload.guesses.map((entry) => entry.structureToken))
  assert.ok(!text.includes(targetRow.uniprot), "no token mentions the target")
  if (targetRow.pdb_id) assert.ok(!text.includes(targetRow.pdb_id))
})
