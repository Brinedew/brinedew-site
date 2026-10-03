// A GeneGuessr visit costs few Worker requests (B-957): the guess answers with its similarity
// score, and the bootstrap carries the graphics settings. The free plan counts every Worker
// request twice (the public edge Worker and the stateful Worker behind it), so each request a
// visit does not make raises the number of visitors a day.
//
// Everything runs through the real Worker against a real local D1 (Miniflare) built from the
// real GeneGuessr migrations, seeded with the production shape (19,110 proteins) and with
// embedding rows in the size and layout production stores them.
//
// Failure modes this file proves, each written before the code that fixes it:
//   S1  a wrong guess answers with no score (`score: null`, `similarityPending`), so the page
//       has to ask again, or the score it does carry is not the one the lazy call computed
//       (percent, ladder flag, ladder rank) for an ordinary guess and for a ladder neighbour
//   S2  a correct guess spends a D1 read on a similarity it already knows (100%)
//   S3  an embeddings read that fails fails the guess: the guess is lost, the hint is not
//       paid, the state is not saved; or the card gets a stuck "pending" instead of N/A
//   S4  a session stored as pending by the old code keeps its empty score after a reload
//   S5  the lazy `/api/game/guess-similarity` route still answers
//   S6  the bootstrap carries no graphics settings, or carries the built-in default instead of
//       the stored value, or the profile manager the page never reads
//   S7  an admin push is not visible on the next bootstrap (the value is cached in the isolate)
//   S8  an unreadable KV key fails the bootstrap instead of falling back to the defaults
//   S9  the bootstrap and `/api/graphics-settings` (the admin preview and the Discord recap read
//       it) disagree on the settings
import assert from "node:assert/strict"
import test, { after, before, mock } from "node:test"

import worker from "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"
import { DEFAULT_GRAPHICS_SETTINGS, normalizeGraphicsSettings } from "./admin.js"
import { getBlendedSimilarity } from "./lib/protein-store.js"
import {
  geneguessrWorkerEnv,
  meteredDb,
  openCatalogDb,
  productionShapedCatalogRows,
  seedCatalog,
  seedEmbeddings,
} from "./daily-selection-pool-test-d1.js"

const ORIGIN = "https://geneguessr.brinedew.bio"

let db
let dispose
let rows
let target
let ladderGuess
let ordinaryGuess
let failingGuess
let healedGuess

const playable = (skip) =>
  rows.filter(
    (row) => row.structure_source === "pdb" && row.gene_summary && !skip.includes(row.uniprot),
  )

before(async () => {
  ;({ db, dispose } = await openCatalogDb())
  rows = productionShapedCatalogRows()
  await seedCatalog(db, rows)
  // Four distinct families of guesses and the target, so no test shares a cached row.
  const picks = playable([]).slice(0, 5)
  ;[target, ladderGuess, ordinaryGuess, failingGuess, healedGuess] = picks
  // The target's precomputed neighbours (the ladder): the first guess is its closest.
  await db
    .prepare("UPDATE proteins SET neighbors = ? WHERE uniprot = ?")
    .bind(JSON.stringify([{ gene: ladderGuess.gene, similarity: 0.93 }]), target.uniprot)
    .run()
  await seedEmbeddings(
    db,
    picks.map((row) => row.gene),
  )
})
after(async () => {
  await dispose()
})

// Silences the Worker's logging, and stands in for the structure providers: a first practice
// bootstrap probes the structure of the target it picks, and no test may reach the network.
const PROBE_BODY = "data_structure\nHEADER    MODEL\nATOM  1\n"
const quiet = () => {
  for (const method of ["log", "warn", "info", "error"]) mock.method(console, method, () => {})
  mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(PROBE_BODY, { status: 200, headers: { "Content-Type": "chemical/x-cif" } }),
  )
}

// One request through the real Worker.
async function call(
  path,
  { method = "GET", cookie = null, body = null, sessions = new Map(), kvEntries = {}, wrap } = {},
) {
  quiet()
  try {
    const metered = meteredDb(db)
    const harness = geneguessrWorkerEnv(wrap ? wrap(metered) : metered, { sessions, kvEntries })
    const headers = { ...(cookie ? { Cookie: `geneguessr_session=${cookie}` } : {}) }
    if (body) headers["Content-Type"] = "application/json"
    const waits = []
    const response = await worker.fetch(
      new Request(`${ORIGIN}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      }),
      harness.env,
      { waitUntil: (promise) => waits.push(Promise.resolve(promise)) },
    )
    await Promise.allSettled(waits)
    const text = await response.clone().text()
    const payload = response.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text
    return { response, payload, text, metered, harness, sessions }
  } finally {
    mock.restoreAll()
  }
}

// A practice game against `target`, with the session kept in `sessions`.
async function startGame(cookie) {
  const sessions = new Map()
  const start = await call("/api/game/practice/start?practice=1", {
    method: "POST",
    cookie,
    sessions,
    body: { uniprots: [target.uniprot] },
  })
  assert.equal(start.response.status, 200)
  return sessions
}
const guessAs = (cookie, sessions, row, extra = {}) =>
  call("/api/game/guess?practice=1", {
    method: "POST",
    cookie,
    sessions,
    body: { uniprot: row.uniprot },
    ...extra,
  })

// What the lazy call computed: the one similarity rule on the same rows.
async function expectedScore(guess) {
  const similarity = await getBlendedSimilarity(db, guess.gene, target.gene, {
    targetNeighbors: [{ gene: ladderGuess.gene, similarity: 0.93 }],
  })
  return {
    percent: similarity.blended,
    similarity: similarity.blended,
    isLadder: similarity.isLadder,
    ladderRank: similarity.ladderRank,
  }
}

test("S1: a wrong guess answers with its similarity score, the one the lazy call computed", async () => {
  const cookie = "budget-s1"
  const sessions = await startGame(cookie)
  for (const [guess, expectLadder] of [
    [ordinaryGuess, false],
    [ladderGuess, true],
  ]) {
    const { response, payload } = await guessAs(cookie, sessions, guess)
    assert.equal(response.status, 200)
    const entry = payload.guesses.find((item) => item.uniprot === guess.uniprot)
    const expected = await expectedScore(guess)
    assert.equal(typeof entry.score?.percent, "number", `${guess.gene}: a score in the answer`)
    assert.equal(entry.score.percent, expected.percent, `${guess.gene}: percent`)
    assert.equal(entry.score.similarity, expected.similarity, `${guess.gene}: similarity`)
    assert.equal(entry.score.isLadder, expectLadder, `${guess.gene}: ladder flag`)
    assert.equal(entry.score.ladderRank, expectLadder ? 1 : null, `${guess.gene}: ladder rank`)
    assert.equal("similarityPending" in entry, false, `${guess.gene}: nothing is pending`)
    assert.equal(
      "similarityPending" in sessions.values().next().value.guesses.at(-1),
      false,
      `${guess.gene}: the stored guess is not pending either`,
    )
  }
})

test("S2: a correct guess scores 100% without reading an embedding", async () => {
  const cookie = "budget-s2"
  const sessions = await startGame(cookie)
  const { response, payload, metered } = await guessAs(cookie, sessions, target)
  assert.equal(response.status, 200)
  const entry = payload.guesses[0]
  assert.equal(entry.correct, true)
  assert.equal(entry.score.percent, 100)
  assert.equal("similarityPending" in entry, false)
  assert.deepEqual(
    metered.receipts.filter((receipt) => receipt.sql.includes("protein_embeddings_old")),
    [],
    "no embedding read",
  )
})

test("S3: a failing embeddings read does not fail the guess; the card says N/A and the next load computes it", async () => {
  const cookie = "budget-s3"
  const sessions = await startGame(cookie)
  const broken = (inner) => ({
    ...inner,
    prepare(sql) {
      const statement = inner.prepare(sql)
      if (!sql.includes("protein_embeddings_old")) return statement
      const fail = async () => {
        throw new Error("D1 unavailable")
      }
      return { ...statement, bind: () => ({ first: fail, all: fail, run: fail }) }
    },
  })
  const hintsBefore = (await call("/api/game/bootstrap?practice=1", { cookie, sessions })).payload
    .status.hintBalance
  const { response, payload } = await guessAs(cookie, sessions, failingGuess, { wrap: broken })
  assert.equal(response.status, 200, "the guess is accepted")
  const entry = payload.guesses[0]
  assert.equal(entry.uniprot, failingGuess.uniprot)
  assert.equal(entry.score.percent, null, "no number to show: the card says N/A")
  assert.equal("similarityPending" in entry, false, "and never a spinner")
  assert.equal(payload.status.hintBalance, hintsBefore + 1, "the hint is still paid")
  assert.equal(sessions.values().next().value.guesses.length, 1, "the guess is saved")

  const reload = await call("/api/game/bootstrap?practice=1", { cookie, sessions })
  const healed = reload.payload.guesses[0]
  assert.equal(typeof healed.score.percent, "number", "the next load computes it")
  assert.equal(healed.score.percent, (await expectedScore(failingGuess)).percent)
})

test("S4: a guess the old code stored as pending gets its score on the next load", async () => {
  const cookie = "budget-s4"
  const sessions = await startGame(cookie)
  assert.equal((await guessAs(cookie, sessions, healedGuess)).response.status, 200)
  // What the old guess handler left behind: no score, `similarityPending`.
  const [key, state] = [...sessions.entries()][0]
  const stored = structuredClone(state)
  stored.guesses[0].score = null
  stored.guesses[0].similarityPending = true
  sessions.set(key, stored)

  const reload = await call("/api/game/bootstrap?practice=1", { cookie, sessions })
  assert.equal(reload.response.status, 200)
  const entry = reload.payload.guesses[0]
  assert.equal(typeof entry.score?.percent, "number", "a score, not a spinner")
  assert.equal(entry.score.percent, (await expectedScore(healedGuess)).percent)
  assert.equal("similarityPending" in entry, false)
  assert.equal("similarityPending" in sessions.get(key).guesses[0], false, "the flag is gone")
})

test("S5: the lazy similarity route is gone", async () => {
  const cookie = "budget-s5"
  const sessions = await startGame(cookie)
  const answer = await guessAs(cookie, sessions, ordinaryGuess)
  const { response } = await call("/api/game/guess-similarity?practice=1", {
    method: "POST",
    cookie,
    sessions,
    body: { guessId: answer.payload.guesses[0].guessId },
  })
  assert.equal(response.status, 404)
})

const strip = ({ profileManager: _manager, ...sections }) => sections
const TUNED = normalizeGraphicsSettings({
  ...DEFAULT_GRAPHICS_SETTINGS,
  occlusion: { ...DEFAULT_GRAPHICS_SETTINGS.occlusion, enabled: false, samples: 0, radius: 0 },
  fog: { ...DEFAULT_GRAPHICS_SETTINGS.fog, intensity: 0.2 },
})

test("S6: the bootstrap carries the stored graphics settings, the sections the page reads", async () => {
  const empty = await call("/api/game/bootstrap?practice=1", { cookie: "budget-s6a" })
  assert.deepEqual(empty.payload.graphicsSettings, strip(DEFAULT_GRAPHICS_SETTINGS), "defaults")

  const tuned = await call("/api/game/bootstrap?practice=1", {
    cookie: "budget-s6b",
    kvEntries: { graphics_settings: JSON.stringify(TUNED) },
  })
  assert.deepEqual(tuned.payload.graphicsSettings, strip(TUNED), "the stored value")
  assert.equal(tuned.payload.graphicsSettings.occlusion.enabled, false)
  assert.equal("profileManager" in tuned.payload.graphicsSettings, false, "no profile manager")
  assert.ok(JSON.stringify(tuned.payload.graphicsSettings).length < 1200, "a small payload")
})

test("S7: an admin push is on the next bootstrap", async () => {
  const before = await call("/api/game/bootstrap?practice=1", {
    cookie: "budget-s7",
    kvEntries: { graphics_settings: JSON.stringify(TUNED) },
  })
  assert.equal(before.payload.graphicsSettings.fog.intensity, 0.2)
  const pushed = normalizeGraphicsSettings({
    ...TUNED,
    fog: { ...TUNED.fog, intensity: 0.9 },
  })
  const after = await call("/api/game/bootstrap?practice=1", {
    cookie: "budget-s7",
    kvEntries: { graphics_settings: JSON.stringify(pushed) },
  })
  assert.equal(after.payload.graphicsSettings.fog.intensity, 0.9)
})

test("S8: an unreadable settings key falls back to the defaults, the bootstrap still answers", async () => {
  quiet()
  try {
    const harness = geneguessrWorkerEnv(meteredDb(db))
    const get = harness.env.KV.get
    harness.env.KV.get = async (key, ...rest) => {
      if (key === "graphics_settings") throw new Error("KV unavailable")
      return get(key, ...rest)
    }
    const response = await worker.fetch(
      new Request(`${ORIGIN}/api/game/bootstrap?practice=1`, {
        headers: { Cookie: "geneguessr_session=budget-s8" },
      }),
      harness.env,
      { waitUntil() {} },
    )
    assert.equal(response.status, 200)
    assert.deepEqual((await response.json()).graphicsSettings, strip(DEFAULT_GRAPHICS_SETTINGS))
  } finally {
    mock.restoreAll()
  }
})

test("S9: the bootstrap and the settings route read one value", async () => {
  const kvEntries = { graphics_settings: JSON.stringify(TUNED) }
  const boot = await call("/api/game/bootstrap?practice=1", { cookie: "budget-s9", kvEntries })
  const route = await call("/api/graphics-settings", { kvEntries })
  assert.equal(route.response.status, 200)
  assert.deepEqual(strip(route.payload), boot.payload.graphicsSettings)
  assert.ok(route.payload.profileManager, "the route keeps the profile manager for the admin")
})
