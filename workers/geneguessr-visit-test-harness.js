// Test support: a GeneGuessr visit run through the real Worker on a real local D1 (Miniflare)
// seeded with the production shape, with every D1 statement's receipt (`rows_read`,
// `rows_written`) and every Durable Object and KV call counted per request.
//
// The visit is the page's own sequence (docs/GENEGUESSR_DAILY_SELECTION_RUNBOOK.md, "A visit's
// Worker requests"): one bootstrap, one request for the daily target's structure, one request a
// guess, and on a desktop one leaderboard read.
import { mock } from "node:test"

import worker from "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"
import {
  geneguessrWorkerEnv,
  meteredDb,
  openCatalogDb,
  productionShapedCatalogRows,
  seedCatalog,
  seedEmbeddings,
  seedLeaderboard,
} from "./daily-selection-pool-test-d1.js"

export const ORIGIN = "https://geneguessr.brinedew.bio"
// A structure file every format's availability check accepts; a visit's own structure requests
// never reach a provider.
const PROBE_BODY = "data_structure\nHEADER    MODEL\nATOM  1\n"

// Public streaks the leaderboard shows, best first (the same three as the browser E2E).
export const LEADERBOARD_ACCOUNTS = [
  { id: "d1", username: "Ada", streak: 12, wins: 40 },
  { id: "d2", username: "Barbara", streak: 7, wins: 31 },
  { id: "d3", username: "Chien-Shiung", streak: 3, wins: 9 },
]

export async function openVisitHarness({ accounts = LEADERBOARD_ACCOUNTS } = {}) {
  const { db, dispose: disposeDb } = await openCatalogDb()
  const rows = productionShapedCatalogRows()
  await seedCatalog(db, rows)
  const metered = meteredDb(db)
  const harness = geneguessrWorkerEnv(metered)
  const calls = { doReads: 0, doWrites: 0, kvGets: 0 }
  const sessionGet = harness.env.GAME_SESSIONS.get
  harness.env.GAME_SESSIONS.get = (id) => {
    const stub = sessionGet(id)
    return {
      fetch: (url, init = {}) => {
        calls[init.method === "POST" ? "doWrites" : "doReads"] += 1
        return stub.fetch(url, init)
      },
    }
  }
  const kvGet = harness.env.KV.get
  harness.env.KV.get = (...args) => {
    calls.kvGets += 1
    return kvGet(...args)
  }
  for (const method of ["log", "warn", "info", "error"]) mock.method(console, method, () => {})
  mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(PROBE_BODY, { status: 200, headers: { "Content-Type": "chemical/x-cif" } }),
  )

  // One request through the real Worker. `statements` are the receipts that read more than one
  // row or wrote any, which is every statement that costs something.
  async function call(path, { method = "GET", cookie, body } = {}) {
    const receiptsBefore = metered.receipts.length
    const before = { ...calls, kvPuts: harness.kvPuts.length }
    const headers = { "Content-Type": "application/json" }
    if (cookie) headers.Cookie = cookie
    const waits = []
    const response = await worker.fetch(
      new Request(`${ORIGIN}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      harness.env,
      { waitUntil: (promise) => waits.push(Promise.resolve(promise)) },
    )
    await Promise.allSettled(waits)
    const text = await response.clone().text()
    const receipts = metered.receipts.slice(receiptsBefore)
    return {
      response,
      text,
      payload: response.headers.get("content-type")?.includes("json") ? JSON.parse(text) : null,
      receipts,
      rowsRead: receipts.reduce((sum, receipt) => sum + receipt.rows_read, 0),
      rowsWritten: receipts.reduce((sum, receipt) => sum + receipt.rows_written, 0),
      doReads: calls.doReads - before.doReads,
      doWrites: calls.doWrites - before.doWrites,
      kvGets: calls.kvGets - before.kvGets,
      kvPuts: harness.kvPuts.length - before.kvPuts,
    }
  }

  // The first visitor of the day pays for the daily pick; the measured visits are not that one.
  await call("/api/game/bootstrap", { cookie: "geneguessr_session=warm-up" })
  const target = [...harness.sessions.values()].at(-1).targetId
  const guessRows = (count = 3) => {
    const sources = ["pdb", "swissmodel", "alphafold"]
    const pools = sources.map((source) =>
      rows.filter(
        (row) => row.structure_source === source && row.gene_summary && row.uniprot !== target,
      ),
    )
    return Array.from({ length: count }, (_, index) => pools[index % 3][Math.floor(index / 3)])
  }
  await seedEmbeddings(db, [
    rows.find((row) => row.uniprot === target).gene,
    ...guessRows(6).map((row) => row.gene),
  ])
  await seedLeaderboard(db, accounts)
  // The board is built by the first read; the measured visits start from the state production
  // is in after that.
  await call("/api/stats/leaderboard?limit=5")

  let visitors = 0
  // A visit with `guesses` guesses by a guest. `leaderboard: false` is a phone, whose sidebar
  // sits below the game and is read only when the visitor scrolls to it.
  async function visit({ guesses = 3, leaderboard = true } = {}) {
    visitors += 1
    const cookie = `geneguessr_session=visitor-${visitors}-${guesses}`
    const steps = []
    const step = async (label, path, options = {}) => {
      const result = await call(path, { cookie, ...options })
      steps.push({
        label,
        status: result.response.status,
        rowsRead: result.rowsRead,
        rowsWritten: result.rowsWritten,
        doReads: result.doReads,
        doWrites: result.doWrites,
        kvGets: result.kvGets,
        kvPuts: result.kvPuts,
        statements: result.receipts
          .filter((receipt) => receipt.rows_written || receipt.rows_read > 1)
          .map(
            (receipt) =>
              `${receipt.rows_read} read, ${receipt.rows_written} written: ${receipt.sql.slice(0, 110)}`,
          ),
        receipts: result.receipts,
      })
      return result
    }
    await step("bootstrap", "/api/game/bootstrap")
    await step("target structure", "/api/structure-cached?type=target")
    for (const [index, row] of guessRows(guesses).entries()) {
      await step(`guess ${index + 1}`, "/api/game/guess", {
        method: "POST",
        body: { uniprot: row.uniprot },
      })
    }
    if (leaderboard) await step("leaderboard", "/api/stats/leaderboard?limit=5")
    const sum = (key) => steps.reduce((total, item) => total + item[key], 0)
    return {
      guesses,
      requests: steps.length,
      steps,
      totals: {
        rowsRead: sum("rowsRead"),
        rowsWritten: sum("rowsWritten"),
        doReads: sum("doReads"),
        doWrites: sum("doWrites"),
        kvGets: sum("kvGets"),
        kvPuts: sum("kvPuts"),
      },
      receipts: steps.flatMap((item) => item.receipts),
    }
  }

  // The first visit creates what a day's first guesses create (the aggregate table, one row for
  // each protein guessed, the minute's row of any per-minute record), so a measured visit is a
  // steady-state one: a protein already guessed today costs 2 rows to guess again, a protein
  // nobody guessed today costs 3.
  await visit({ guesses: 6 })

  return {
    db,
    metered,
    harness,
    rows,
    target,
    guessRows,
    call,
    visit,
    dispose: async () => {
      mock.restoreAll()
      await disposeDb()
    },
  }
}
