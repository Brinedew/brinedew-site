// The record of failed GameSession writes (B-960). A failed Durable Object session write is
// recorded in D1 (one counted row a minute and kind, one sample); a successful one records
// nothing, because a success row cost 1 of every 2 D1 rows a guess wrote and no page read it.
// Everything runs through the real Worker on a real local D1 (Miniflare) with the Durable Object
// stubbed to fail the way production's does.
//
// Failure modes this file proves, each written before the code that fixes it (the visit that
// shows a success writes nothing is in geneguessr-row-budget.test.js):
//   E1  a failed session write is not recorded (no counted row, no sample), or the visitor stops
//       seeing the failure
//   E2  repeats of one failure in a minute are not folded into one counted row, or a repeat
//       loses its sample, or a different error text shares the row
//   E3  the record failing (D1 refuses the evidence write) changes what the visitor sees, or is
//       not logged
//   E4  the status reader counts a success row an earlier version wrote, or drops what the
//       admin needs from the failures (counts, first and last time, error texts, samples)
//   E5  the admin status route stops carrying the snapshot
//   E6  one failed write costs the D1 meter more than 4 rows once its minute's row exists (1 to
//       bump the counter, 3 for the sample: its row, its index entry, the autoincrement counter)
import assert from "node:assert/strict"
import test, { after, before, mock } from "node:test"

import { handleAdminStatus } from "./admin.js"
import { getGameSessionWriteEvidence } from "./lib/game-session-write-evidence.js"
import { isoDay } from "./daily-selection-pool-test-d1.js"
import { openVisitHarness } from "./geneguessr-visit-test-harness.js"

const WRITE_CAP = "Exceeded allowed rows written in Durable Objects free tier."
const RESET = "Durable Object reset because its code was updated."
const OBSERVATIONS = "game_session_write_observations_do_not_delete"
const SAMPLES = "game_session_write_failure_samples_do_not_delete"

let h
before(async () => {
  h = await openVisitHarness()
})
after(async () => {
  await h?.dispose()
})

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

async function clearEvidence() {
  for (const table of [OBSERVATIONS, SAMPLES]) {
    await h.db
      .prepare(`DELETE FROM ${table}`)
      .run()
      .catch(() => {})
  }
}
const observations = async () =>
  (
    await h.db
      .prepare(
        `SELECT operation, session_kind, outcome, error_fingerprint, count FROM ${OBSERVATIONS} ORDER BY minute_bucket, error_fingerprint`,
      )
      .all()
  ).results
const samples = async () =>
  (
    await h.db
      .prepare(
        `SELECT operation, session_kind, request_path, error_message FROM ${SAMPLES} ORDER BY id`,
      )
      .all()
  ).results

let visitors = 0
// A visitor with a healthy bootstrap, then a guess whose session write fails.
async function failingGuess(message) {
  visitors += 1
  const cookie = `geneguessr_session=evidence-${visitors}`
  await h.call("/api/game/bootstrap", { cookie })
  const restore = failSessionWrites(message)
  try {
    return await h.call("/api/game/guess", {
      method: "POST",
      cookie,
      body: { uniprot: h.guessRows(1)[0].uniprot },
    })
  } finally {
    restore()
  }
}

test("E1: a failed session write is recorded once, with a sample, and the visitor still sees the failure", async () => {
  await clearEvidence()
  const { response, payload } = await failingGuess(WRITE_CAP)
  assert.equal(response.status, 500)
  assert.equal(payload.error, "Guess submission failed")
  assert.deepEqual(await observations(), [
    {
      operation: "guess_submission",
      session_kind: "guest",
      outcome: "failure",
      error_fingerprint: WRITE_CAP,
      count: 1,
    },
  ])
  assert.deepEqual(await samples(), [
    {
      operation: "guess_submission",
      session_kind: "guest",
      request_path: "/api/game/guess",
      error_message: WRITE_CAP,
    },
  ])
})

test("E2: repeats within a minute fold into one counted row and each keeps a sample; another text is its own row", async () => {
  await clearEvidence()
  const minute = Date.UTC(2026, 9, 3, 12, 0, 30)
  const clock = mock.method(Date, "now", () => minute)
  try {
    await failingGuess(WRITE_CAP)
    await failingGuess(WRITE_CAP)
    await failingGuess(RESET)
  } finally {
    clock.mock.restore()
  }
  const rows = await observations()
  assert.deepEqual(
    rows.map((row) => [row.error_fingerprint, row.count]),
    [
      [RESET, 1],
      [WRITE_CAP, 2],
    ],
  )
  assert.equal((await samples()).length, 3, "every failure keeps a sample")
})

test("E3: a record that cannot be written changes nothing the visitor sees and is logged", async () => {
  await clearEvidence()
  const db = h.harness.env.DB
  h.harness.env.DB = {
    ...db,
    prepare(sql) {
      if (/game_session_write_/.test(sql)) throw new Error("D1 refused the evidence write")
      return db.prepare(sql)
    },
  }
  const logged = console.warn.mock.calls.length
  try {
    const { response, payload } = await failingGuess(WRITE_CAP)
    assert.equal(response.status, 500)
    assert.equal(payload.error, "Guess submission failed")
    assert.ok(
      console.warn.mock.calls
        .slice(logged)
        .some((call) => call.arguments[0] === "GameSession write evidence recording failed"),
      "the failed record is logged",
    )
  } finally {
    h.harness.env.DB = db
  }
  assert.deepEqual(await observations(), [], "nothing was recorded")
})

test("E4: the status reader reports the failures and ignores the success rows an earlier version wrote", async () => {
  await clearEvidence()
  await getGameSessionWriteEvidence(h.db) // creates the tables
  const day = isoDay(-3)
  const insert = h.db.prepare(
    `INSERT INTO ${OBSERVATIONS} (observed_day, minute_bucket, operation, session_kind, outcome, error_fingerprint, count, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  await h.db.batch([
    // What the code before B-960 wrote for every successful write.
    insert.bind(
      day,
      `${day}T00:02Z`,
      "bootstrap_session_ensure",
      "guest",
      "success",
      "",
      3,
      1000,
      3000,
    ),
    insert.bind(day, `${day}T00:03Z`, "guess_submission", "guest", "success", "", 2, 4000, 5000),
    insert.bind(
      day,
      `${day}T00:04Z`,
      "bootstrap_session_ensure",
      "guest",
      "failure",
      WRITE_CAP,
      4,
      6000,
      9000,
    ),
    insert.bind(
      day,
      `${day}T00:05Z`,
      "bootstrap_session_ensure",
      "guest",
      "failure",
      RESET,
      1,
      11000,
      11000,
    ),
    insert.bind(
      day,
      `${day}T00:05Z`,
      "guess_submission",
      "user",
      "failure",
      RESET,
      2,
      12000,
      13000,
    ),
    h.db
      .prepare(
        `INSERT INTO ${SAMPLES} (observed_day, occurred_at, operation, session_kind, request_path, error_message)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(day, 9000, "bootstrap_session_ensure", "guest", "/api/game/bootstrap", WRITE_CAP),
  ])

  const evidence = await getGameSessionWriteEvidence(h.db, { day })
  assert.equal(evidence.ok, true)
  assert.deepEqual(evidence.summary, {
    failures: 7,
    first_failure_at: 6000,
    last_failure_at: 13000,
  })
  assert.deepEqual(
    evidence.by_operation.map((row) => [row.operation, row.session_kind, row.failures]),
    [
      ["bootstrap_session_ensure", "guest", 5],
      ["guess_submission", "user", 2],
    ],
  )
  assert.deepEqual(evidence.failure_fingerprints, [
    { error_fingerprint: WRITE_CAP, count: 4, first_seen_at: 6000, last_seen_at: 9000 },
    { error_fingerprint: RESET, count: 3, first_seen_at: 11000, last_seen_at: 13000 },
  ])
  assert.deepEqual(
    evidence.recent_minute_buckets.map((row) => [row.minute_bucket, row.failures]),
    [
      [`${day}T00:04Z`, 4],
      [`${day}T00:05Z`, 3],
    ],
    "the minutes that only had successes are not listed",
  )
  assert.equal(evidence.recent_failures[0].request_path, "/api/game/bootstrap")
  assert.equal(evidence.recent_failures[0].error_message, WRITE_CAP)
  for (const gone of ["successes", "attempts", "successes_before_first_failure"]) {
    assert.equal(gone in evidence.summary, false, `no ${gone}`)
  }
})

test("E5: the admin status carries the failures", async () => {
  await clearEvidence()
  await failingGuess(WRITE_CAP)
  const env = {
    ADMIN_DISCORD_USER_ID: "12345",
    DB: h.db,
    KV: {
      async get(key) {
        if (key === "feature_flags") return JSON.stringify({ liveMolstar: true })
        return null
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
  const response = await handleAdminStatus(
    new Request("https://geneguessr.brinedew.bio/api/admin/status", {
      headers: { Cookie: "session=abc123" },
    }),
    env,
  )
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.feature_flags.liveMolstar, true)
  assert.equal(payload.game_session_write_evidence.ok, true)
  assert.equal(payload.game_session_write_evidence.summary.failures, 1)
  assert.equal(payload.game_session_write_evidence.recent_failures[0].error_message, WRITE_CAP)
})

test("E6: once its minute's row exists, a failed write costs the D1 meter at most 4 rows", async (t) => {
  await clearEvidence()
  // The first failure of a minute also creates that minute's row.
  const first = await failingGuess(WRITE_CAP)
  const rowsOf = (result) =>
    result.receipts
      .filter((receipt) => /game_session_write_/.test(receipt.sql))
      .reduce((sum, receipt) => sum + receipt.rows_written, 0)
  t.diagnostic(
    `the first failure of a minute (schema already there): ${rowsOf(first)} rows written`,
  )
  const second = await failingGuess(WRITE_CAP)
  const evidenceStatements = second.receipts.filter((receipt) =>
    /game_session_write_/.test(receipt.sql),
  )
  t.diagnostic(
    `a repeated failure: ${evidenceStatements.map((receipt) => receipt.rows_written).join(" + ")} rows written`,
  )
  const written = evidenceStatements.reduce((sum, receipt) => sum + receipt.rows_written, 0)
  assert.ok(written <= 4, `${written} rows written`)
})
