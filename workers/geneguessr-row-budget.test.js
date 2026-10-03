// What a GeneGuessr visit costs on D1 rows (B-960, B-959). The free plan allows 100,000 D1 rows
// written and 5,000,000 rows read a day, and counts every index entry a statement writes. A
// visit is the page's own sequence through the real Worker: a bootstrap, the daily target's
// structure, one request a guess, and on a desktop one leaderboard read. Everything runs on a real
// local D1 (Miniflare) seeded with the production shape (19,110 proteins, embedding rows of
// production size, production-shaped account tables); each statement's own receipt is summed.
//
// Failure modes this file proves, each written before the code that fixes it:
//   V1  a visit writes a row to the session-write evidence tables, or runs a statement against
//       them: a successful write is recorded in D1 (5 of the 11 rows a 3-guess visit wrote), or a
//       cold isolate's first save creates the tables and prunes them
//   V2  a visit writes any D1 row other than the per-guess daily aggregate (2 rows a guess:
//       the day's row and its index entry, for a protein already guessed today)
// The numbers land in artifacts/b-960/geneguessr-d1-rows[.<ROWS_LABEL>].json.
import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import test, { after, before } from "node:test"

import { openVisitHarness } from "./geneguessr-visit-test-harness.js"

const OUT = path.join(
  process.env.ROWS_OUT || path.join(import.meta.dirname, "..", "artifacts", "b-960"),
)
const EVIDENCE_TABLES = /game_session_write_/
const AGGREGATE_TABLE = /daily_guess_aggregate/

let harness
const measured = {}

before(async () => {
  harness = await openVisitHarness()
})

after(async () => {
  mkdirSync(OUT, { recursive: true })
  const label = process.env.ROWS_LABEL ? `.${process.env.ROWS_LABEL}` : ""
  writeFileSync(
    path.join(OUT, `geneguessr-d1-rows${label}.json`),
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        note: "D1 receipts (rows_read, rows_written) of a visit through the real Worker on a production-shaped local D1; the free plan allows 100,000 rows written and 5,000,000 rows read a day",
        visits: measured,
      },
      null,
      2,
    ),
  )
  await harness?.dispose()
})

const summary = (visit) => ({
  requests: visit.requests,
  rowsRead: visit.totals.rowsRead,
  rowsWritten: visit.totals.rowsWritten,
  doReads: visit.totals.doReads,
  doWrites: visit.totals.doWrites,
  kvGets: visit.totals.kvGets,
  kvPuts: visit.totals.kvPuts,
  steps: visit.steps.map((step) => ({
    label: step.label,
    status: step.status,
    rowsRead: step.rowsRead,
    rowsWritten: step.rowsWritten,
    statements: step.statements,
  })),
})
const writing = (visit) => visit.receipts.filter((receipt) => receipt.rows_written)

for (const [name, options] of [
  ["3 guesses on a desktop", { guesses: 3, leaderboard: true }],
  ["6 guesses on a desktop", { guesses: 6, leaderboard: true }],
  ["3 guesses on a phone", { guesses: 3, leaderboard: false }],
  ["6 guesses on a phone", { guesses: 6, leaderboard: false }],
]) {
  test(`V1/V2: a visit of ${name} writes only the per-guess aggregate`, async (t) => {
    const visit = await harness.visit(options)
    measured[name] = summary(visit)
    t.diagnostic(
      `${name}: ${visit.requests} requests, ${visit.totals.rowsWritten} rows written, ` +
        `${visit.totals.rowsRead} rows read, ${visit.totals.doWrites} DO writes, ` +
        `${visit.totals.doReads} DO reads, ${visit.totals.kvPuts} KV puts`,
    )
    for (const step of visit.steps) {
      assert.equal(step.status, 200, `${step.label} answers 200`)
    }
    assert.deepEqual(
      visit.receipts
        .filter((receipt) => EVIDENCE_TABLES.test(receipt.sql))
        .map((receipt) => receipt.sql.slice(0, 70)),
      [],
      "no statement touches the session-write evidence tables",
    )
    assert.deepEqual(
      writing(visit)
        .filter((receipt) => !AGGREGATE_TABLE.test(receipt.sql))
        .map((receipt) => `${receipt.rows_written}: ${receipt.sql.slice(0, 100)}`),
      [],
      "the only rows a visit writes are the aggregates",
    )
    assert.equal(
      visit.totals.rowsWritten,
      2 * options.guesses,
      "2 rows a guess: the day's aggregate row and its index entry",
    )
  })
}
