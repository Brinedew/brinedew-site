// The record of failed GameSession writes (B-963). A failed Durable Object session write is
// recorded in D1; a successful one records nothing (B-960). The D1 allowance a record spends is the
// one the whole account shares, and a Durable Object write-cap incident fails EVERY session write
// until 00:00 UTC, so the record must cost the same few rows whether it sees 100 failures or
// 100,000. Everything runs on a real local D1 (Miniflare), through the real Worker where the
// visitor is involved and through fresh copies of the module where an isolate is (a copy of the
// module is an isolate: its memory is its own).
//
// Failure modes this file proves, written from the requirement (a storm costs O(1) rows, not 4 a
// failure) before the code that meets them:
//   F1  one isolate's storm costs rows in proportion to the number of failures
//   F2  many isolates failing at once each write their first failure (a per-isolate throttle
//       cannot bound this; the bound has to be in D1)
//   F3  a full day of failures costs more than one row per five minutes for the failing key
//   F4  a message with a unique reference in it mints a row per failure (the key space is not closed)
//   F5  the operator loses what he needs: the operation, the session kind, the error class, the
//       first and last time, an example message and path, or the count of what D1 was told
//   F6  a refused D1 write loses the failures an isolate had counted, or the record failing changes
//       what the visitor sees, or is not logged, or a successful write runs a statement
//   F8  rows past the retention stay, or preparing costs a statement every time
//   F9  through the real Worker: a failed write is not recorded, or the visitor stops seeing the
//       failure, or the admin status stops carrying the record, or a 300-failure storm costs more
//       than a handful of rows
//   F10 a failure's class is not stable for the texts the platform really sends
import assert from "node:assert/strict"
import test, { after, before, mock } from "node:test"

import { handleAdminStatus } from "./admin.js"
import { openVisitHarness } from "./geneguessr-visit-test-harness.js"

const WRITE_CAP = "Exceeded allowed rows written in Durable Objects free tier."
const RESET = "Durable Object reset because its code was updated."
const FAILURES = "game_session_write_failures_do_not_delete"
const WINDOW_MS = 5 * 60 * 1000
// 12:00 UTC on 2026-10-03; every test moves the clock forward from here, inside that day unless it
// says otherwise (T0 + 144 windows is midnight).
const T0 = Date.UTC(2026, 9, 3, 12, 0, 0)

let h
let now = null
before(async () => {
  h = await openVisitHarness()
  const real = Date.now
  mock.method(Date, "now", () => now ?? real())
})
after(async () => {
  await h?.dispose()
})
const setClock = (time) => {
  now = time
}

let copies = 0
// A new isolate: a copy of the module with its own memory.
const isolate = () => import(`./lib/game-session-write-evidence.js?isolate=${(copies += 1)}`)

const mine = (receipts, pattern = /./) =>
  receipts.filter((receipt) => /game_session_write_/.test(receipt.sql) && pattern.test(receipt.sql))
const rowsOf = (receipts) => receipts.reduce((sum, receipt) => sum + receipt.rows_written, 0)

// What D1 charged for the statements `body` ran.
async function charged(body) {
  const from = h.metered.receipts.length
  await body()
  const receipts = h.metered.receipts.slice(from)
  return { receipts, evidence: mine(receipts), rows: rowsOf(mine(receipts)) }
}

// One failed session write by `details`, as the Worker's call sites do it.
async function fail(mod, details = {}, message = WRITE_CAP) {
  await assert.rejects(
    mod.withObservedGameSessionWrite(
      { DB: h.metered },
      {
        operation: "guess_submission",
        sessionId: "guest_visitor",
        requestPath: "/api/game/guess",
        ...details,
      },
      async () => {
        throw new Error(message)
      },
    ),
    { message },
  )
}

const stored = async () =>
  (
    await h.db
      .prepare(
        `SELECT observed_day, operation, session_kind, error_class, failures, first_seen_at, last_seen_at, request_path, error_message FROM ${FAILURES} ORDER BY first_seen_at, operation, session_kind, error_class`,
      )
      .all()
  ).results
const clearStored = async () => {
  await h.db
    .prepare(
      `CREATE TABLE IF NOT EXISTS ${FAILURES} (observed_day TEXT NOT NULL, operation TEXT NOT NULL, session_kind TEXT NOT NULL, error_class TEXT NOT NULL, failures INTEGER NOT NULL, first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, request_path TEXT, error_message TEXT NOT NULL, PRIMARY KEY (observed_day, operation, session_kind, error_class)) WITHOUT ROWID`,
    )
    .run()
  await h.db.prepare(`DELETE FROM ${FAILURES}`).run()
}

// Every Durable Object write fails with `message` until the returned function restores it.
function failSessionWrites(message) {
  const get = h.harness.env.GAME_SESSIONS.get
  h.harness.env.GAME_SESSIONS.get = (id) => {
    const stub = get(id)
    return {
      fetch: (url, init = {}) =>
        init.method === "POST" ? Promise.reject(new Error(message)) : stub.fetch(url, init),
    }
  }
  return () => {
    h.harness.env.GAME_SESSIONS.get = get
  }
}

test("F1: a storm of 1,000 failures in one isolate reaches D1 once, and the next window carries the count", async () => {
  const mod = await isolate()
  setClock(T0)
  const first = await charged(async () => {
    for (let index = 0; index < 1000; index += 1) await fail(mod)
  })
  assert.equal(mine(first.receipts, /INSERT INTO/).length, 1, "one statement for 1,000 failures")
  assert.deepEqual(
    (await stored()).map((row) => [row.error_class, row.failures]),
    [["write_cap", 1]],
    "D1 was told about the first failure",
  )
  assert.ok(first.rows <= 4, `${first.rows} rows written, the table's creation included`)

  setClock(T0 + WINDOW_MS)
  const second = await charged(() => fail(mod))
  assert.equal(second.rows, 1, "the next window costs one row")
  assert.deepEqual(
    (await stored()).map((row) => row.failures),
    [1001],
    "and carries the 999 the isolate counted and the new one",
  )
})

test("F2: 50 isolates failing at the same instant write one row between them", async () => {
  await clearStored()
  const isolates = await Promise.all(Array.from({ length: 50 }, () => isolate()))
  setClock(T0 + 10 * WINDOW_MS)
  const burst = await charged(async () => {
    for (const mod of isolates) for (let index = 0; index < 20; index += 1) await fail(mod)
  })
  const asks = mine(burst.receipts, /INSERT INTO/)
  assert.equal(asks.length, 50, "each isolate asked once")
  assert.equal(rowsOf(asks), 1, "and D1 took one of the 50")
  assert.equal(
    asks.filter((receipt) => receipt.rows_read !== 0).length,
    0,
    "a refused ask reads nothing",
  )

  // Every isolate asks again in the next window: one wins, the rest keep what they counted.
  setClock(T0 + 11 * WINDOW_MS)
  const next = await charged(async () => {
    for (const mod of isolates) await fail(mod)
  })
  assert.equal(rowsOf(mine(next.receipts, /INSERT INTO/)), 1, "50 asks, one row")
  const [row] = await stored()
  assert.equal(row.failures, 1 + 19 + 1, "the winner added what it had counted: a lower bound")
  assert.ok(row.failures <= 1000 + 50, "never more than what happened")
})

test("F3: a day of failures, one every 10 seconds, costs one row per five minutes", async (t) => {
  await clearStored()
  const mod = await isolate()
  const failures = 24 * 360
  const dayStart = Date.UTC(2026, 9, 3, 0, 0, 0)
  const from = h.metered.receipts.length
  for (let index = 0; index < failures; index += 1) {
    setClock(dayStart + index * 10_000)
    await fail(mod, { operation: "bootstrap_session_ensure" })
  }
  const receipts = h.metered.receipts.slice(from)
  assert.equal(mine(receipts, /INSERT INTO/).length, 288, "288 five-minute windows in a day")
  const rows = rowsOf(mine(receipts))
  t.diagnostic(
    `${failures} failures cost ${rows} rows written (the per-minute record cost 4 a failure: ${4 * failures})`,
  )
  assert.ok(rows <= 288 + 4)
  const [row, ...others] = await stored()
  assert.equal(others.length, 0, "one row for the whole UTC day")
  assert.ok(row.failures >= failures - 30 && row.failures <= failures, `${row.failures} counted`)
})

test("F4: a message with a unique reference in it is one row, not one a failure", async () => {
  await clearStored()
  const mod = await isolate()
  const start = T0 + 40 * WINDOW_MS
  for (let index = 0; index < 100; index += 1) {
    setClock(start + index * WINDOW_MS)
    await fail(mod, {}, `internal error; reference = ${(index * 2654435761).toString(36)}abc`)
  }
  const rows = await stored()
  assert.equal(rows.length, 1, "one row for 100 distinct texts")
  assert.equal(rows[0].error_class, "internal")
  assert.match(
    rows[0].error_message,
    /^internal error; reference = /,
    "the first text is the example",
  )
  assert.equal(rows[0].failures, 100)

  // The combinations are bounded by the closed sets, not by the traffic.
  setClock(start + 100 * WINDOW_MS)
  for (const sessionId of ["guest_a", "user_b", "practice_guest_c", "oauth:d", "session:e"]) {
    for (const message of [WRITE_CAP, RESET, "x".repeat(900), "Network connection lost."]) {
      await fail(mod, { sessionId }, message)
    }
  }
  const all = await stored()
  assert.equal(all.length, 1 + 5 * 3, "5 kinds x the 3 classes these texts fall in")
  assert.ok(
    all.every((row) => row.error_message.length <= 220),
    "an example is cut at 220",
  )
  assert.ok(
    all.some((row) => row.error_message.length === 220),
    "a 900-character text is kept as 220",
  )
})

test("F5: the status says what failed, since when, how it looked, and how much D1 was told", async () => {
  await clearStored()
  const mod = await isolate()
  setClock(T0 + 60 * WINDOW_MS)
  await fail(mod, { operation: "bootstrap_session_ensure", requestPath: "/api/game/bootstrap" })
  await fail(mod, { sessionId: "user_account" }, RESET)
  setClock(T0 + 61 * WINDOW_MS)
  await fail(mod, { operation: "bootstrap_session_ensure", requestPath: "/api/game/bootstrap" })
  const evidence = await mod.getGameSessionWriteEvidence(h.db, { day: "2026-10-03" })
  assert.equal(evidence.ok, true)
  assert.equal(evidence.observed_day, "2026-10-03")
  assert.equal(evidence.reset_started_at_utc, "2026-10-03T00:00:00.000Z")
  assert.equal(evidence.next_reset_at_utc, "2026-10-04T00:00:00.000Z")
  assert.match(evidence.counts_are_lower_bounds, /five minutes/)
  assert.deepEqual(evidence.summary, {
    failures: 3,
    first_failure_at: T0 + 60 * WINDOW_MS,
    last_failure_at: T0 + 61 * WINDOW_MS,
  })
  assert.deepEqual(evidence.failures, [
    {
      operation: "bootstrap_session_ensure",
      session_kind: "guest",
      error_class: "write_cap",
      failures: 2,
      first_seen_at: T0 + 60 * WINDOW_MS,
      last_seen_at: T0 + 61 * WINDOW_MS,
      request_path: "/api/game/bootstrap",
      error_message: WRITE_CAP,
    },
    {
      operation: "guess_submission",
      session_kind: "user",
      error_class: "reset",
      failures: 1,
      first_seen_at: T0 + 60 * WINDOW_MS,
      last_seen_at: T0 + 60 * WINDOW_MS,
      request_path: "/api/game/guess",
      error_message: RESET,
    },
  ])
  assert.deepEqual(
    (await mod.getGameSessionWriteEvidence(h.db, { day: "2026-09-01" })).failures,
    [],
    "a day with no failure lists none",
  )
  assert.deepEqual(await mod.getGameSessionWriteEvidence(null), { ok: false, reason: "missing_db" })
})

test("F6: a refused write keeps the isolate's count, a record D1 cannot take changes nothing the visitor sees, and a success runs no statement", async () => {
  await clearStored()
  const a = await isolate()
  const b = await isolate()
  setClock(T0 + 80 * WINDOW_MS)
  await fail(a)
  for (let index = 0; index < 30; index += 1) await fail(b)
  assert.deepEqual(
    (await stored()).map((row) => row.failures),
    [1],
    "b was refused: a had written in this window",
  )
  setClock(T0 + 81 * WINDOW_MS)
  await fail(b)
  assert.deepEqual(
    (await stored()).map((row) => row.failures),
    [32],
    "b's next ask carried the 30 it had counted and the new one",
  )

  // D1 refusing the record: the failure still reaches the caller and is logged.
  const refusing = {
    ...h.metered,
    prepare(sql) {
      if (/game_session_write_/.test(sql)) throw new Error("D1 refused the evidence write")
      return h.metered.prepare(sql)
    },
  }
  const logged = console.warn.mock.calls.length
  setClock(T0 + 90 * WINDOW_MS)
  const c = await isolate()
  await assert.rejects(
    c.withObservedGameSessionWrite(
      { DB: refusing },
      { operation: "guess_submission" },
      async () => {
        throw new Error(WRITE_CAP)
      },
    ),
    { message: WRITE_CAP },
  )
  assert.ok(
    console.warn.mock.calls
      .slice(logged)
      .some((call) => call.arguments[0] === "GameSession write evidence recording failed"),
    "the failed record is logged",
  )
  const quiet = await charged(async () => {
    const saved = await c.withObservedGameSessionWrite({ DB: h.metered }, {}, async () => "saved")
    assert.equal(saved, "saved")
  })
  assert.deepEqual(quiet.receipts, [], "a successful write runs no statement")
})

test("F8: rows past 14 days are pruned when an isolate prepares, and preparing happens once a day", async () => {
  await clearStored()
  const insert = h.db.prepare(
    `INSERT INTO ${FAILURES} (observed_day, operation, session_kind, error_class, failures, first_seen_at, last_seen_at, request_path, error_message) VALUES (?, 'guess_submission', 'guest', 'other', 5, 1, 2, NULL, 'x')`,
  )
  await h.db.batch(
    ["2026-09-03", "2026-09-18", "2026-09-19", "2026-10-02"].map((day) => insert.bind(day)),
  )
  const mod = await isolate()
  setClock(T0 + 120 * WINDOW_MS)
  await mod.getGameSessionWriteEvidence(h.db)
  assert.deepEqual(
    (await stored()).map((row) => row.observed_day),
    ["2026-09-19", "2026-10-02"],
    "14 days back from 2026-10-03 is kept, older is gone",
  )
  const again = await charged(() => mod.getGameSessionWriteEvidence(h.metered))
  assert.deepEqual(
    again.evidence.filter((receipt) => !/SELECT/.test(receipt.sql)),
    [],
    "the second read of the day prepares nothing",
  )
})

test("F10: the texts the platform sends fall in stable classes", async () => {
  const { classifyGameSessionWriteError: classify } = await isolate()
  const golden = [
    [WRITE_CAP, "write_cap"],
    ["Exceeded allowed rows read in Durable Objects free tier.", "write_cap"],
    [RESET, "reset"],
    ["Durable Object's isolate exceeded its memory limit and was reset.", "reset"],
    ["Durable Object storage operation exceeded timeout which caused object to be reset.", "reset"],
    ["Durable Object is overloaded. Requests queued for too long.", "overloaded"],
    ["internal error; reference = 6mq4e2ahc5f5mm1u4ge2j2d9", "internal"],
    ["Network connection lost.", "other"],
    ["", "other"],
    [undefined, "other"],
  ]
  assert.deepEqual(
    golden.map(([text]) => [text, classify(text)]),
    golden,
  )
})

test("F9: through the real Worker, a failed write is recorded once, the visitor still sees it, the admin status carries it, and a 300-failure storm costs a handful of rows", async () => {
  await clearStored()
  setClock(null)
  const cookie = "geneguessr_session=evidence-worker"
  await h.call("/api/game/bootstrap", { cookie })
  const guess = { method: "POST", cookie, body: { uniprot: h.guessRows(1)[0].uniprot } }

  const restore = failSessionWrites(WRITE_CAP)
  let one
  try {
    one = await h.call("/api/game/guess", guess)
  } finally {
    restore()
  }
  assert.equal(one.response.status, 500)
  assert.equal(one.payload.error, "Guess submission failed")
  assert.ok(rowsOf(mine(one.receipts)) <= 4, `${rowsOf(mine(one.receipts))} rows for a failure`)
  const [row] = await stored()
  assert.deepEqual(
    [row.operation, row.session_kind, row.error_class, row.failures, row.request_path],
    ["guess_submission", "guest", "write_cap", 1, "/api/game/guess"],
  )

  const adminEnv = {
    ADMIN_DISCORD_USER_ID: "12345",
    DB: h.db,
    KV: {
      async get(key) {
        return key === "feature_flags" ? JSON.stringify({ liveMolstar: true }) : null
      },
      async list() {
        return { keys: [] }
      },
    },
    GAME_SESSIONS: {
      idFromName: (name) => name,
      get: () => ({
        async fetch() {
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => ({ user_id: "12345" }),
          }
        },
      }),
    },
  }
  const status = await handleAdminStatus(
    new Request("https://geneguessr.brinedew.bio/api/admin/status", {
      headers: { Cookie: "session=abc123" },
    }),
    adminEnv,
  )
  assert.equal(status.status, 200)
  const payload = await status.json()
  assert.equal(payload.feature_flags.liveMolstar, true)
  assert.equal(payload.game_session_write_evidence.ok, true)
  assert.equal(payload.game_session_write_evidence.summary.failures, 1)
  assert.equal(payload.game_session_write_evidence.failures[0].error_message, WRITE_CAP)

  // The storm: the same text, 300 more failed guesses from one visitor inside the window.
  const restoreStorm = failSessionWrites(WRITE_CAP)
  const from = h.metered.receipts.length
  try {
    for (let index = 0; index < 300; index += 1) {
      const answer = await h.call("/api/game/guess", guess)
      assert.equal(answer.response.status, 500)
    }
  } finally {
    restoreStorm()
  }
  const storm = mine(h.metered.receipts.slice(from))
  assert.ok(rowsOf(storm) <= 4, `${rowsOf(storm)} rows written by 300 failures`)
  assert.ok(storm.length <= 6, `${storm.length} statements for 300 failures`)
})
