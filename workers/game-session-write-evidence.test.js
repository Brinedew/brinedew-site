import assert from "node:assert/strict"
import test from "node:test"

import { handleAdminStatus } from "./admin.js"
import { getGameSessionWriteEvidence } from "./lib/game-session-write-evidence.js"

function makeEvidenceDb({ observationResults = [], failureResults = [] } = {}) {
  return {
    prepare(sql) {
      if (sql.includes("SELECT") && sql.includes("game_session_write_observations_do_not_delete")) {
        return {
          bind() {
            return {
              all: async () => ({ results: observationResults }),
            }
          },
        }
      }
      if (
        sql.includes("SELECT") &&
        sql.includes("game_session_write_failure_samples_do_not_delete")
      ) {
        return {
          bind() {
            return {
              all: async () => ({ results: failureResults }),
            }
          },
        }
      }
      return {
        bind() {
          return {
            run: async () => ({ success: true }),
            all: async () => ({ results: [] }),
            first: async () => null,
          }
        },
        run: async () => ({ success: true }),
        all: async () => ({ results: [] }),
        first: async () => null,
      }
    },
  }
}

test("game session evidence summarizes successes before the first failure and keeps failure samples", async () => {
  const db = makeEvidenceDb({
    observationResults: [
      {
        observed_day: "2026-04-17",
        minute_bucket: "2026-04-17T00:02Z",
        operation: "bootstrap_session_ensure",
        session_kind: "guest",
        outcome: "success",
        error_fingerprint: "",
        count: 3,
        first_seen_at: 1000,
        last_seen_at: 3000,
      },
      {
        observed_day: "2026-04-17",
        minute_bucket: "2026-04-17T00:03Z",
        operation: "guess_submission",
        session_kind: "guest",
        outcome: "success",
        error_fingerprint: "",
        count: 2,
        first_seen_at: 4000,
        last_seen_at: 5000,
      },
      {
        observed_day: "2026-04-17",
        minute_bucket: "2026-04-17T00:04Z",
        operation: "bootstrap_session_ensure",
        session_kind: "guest",
        outcome: "failure",
        error_fingerprint: "Exceeded allowed rows written in Durable Objects free tier.",
        count: 4,
        first_seen_at: 6000,
        last_seen_at: 9000,
      },
    ],
    failureResults: [
      {
        occurred_at: 9000,
        operation: "bootstrap_session_ensure",
        session_kind: "guest",
        request_path: "/api/game/bootstrap",
        error_message: "Exceeded allowed rows written in Durable Objects free tier.",
      },
    ],
  })

  const evidence = await getGameSessionWriteEvidence(db, { day: "2026-04-17" })

  assert.equal(evidence.ok, true)
  assert.equal(evidence.summary.attempts, 9)
  assert.equal(evidence.summary.successes, 5)
  assert.equal(evidence.summary.failures, 4)
  assert.equal(evidence.summary.successes_before_first_failure, 5)
  assert.equal(evidence.summary.attempts_before_first_failure, 5)
  assert.equal(
    evidence.failure_fingerprints[0].error_fingerprint,
    "Exceeded allowed rows written in Durable Objects free tier.",
  )
  assert.equal(evidence.failure_fingerprints[0].count, 4)
  assert.equal(evidence.recent_failures[0].request_path, "/api/game/bootstrap")
  assert.equal(evidence.by_operation[0].operation, "bootstrap_session_ensure")
  assert.equal(evidence.by_operation[0].failures, 4)
})

test("admin status includes the game session write evidence snapshot", async () => {
  const db = makeEvidenceDb({
    observationResults: [
      {
        observed_day: "2026-04-17",
        minute_bucket: "2026-04-17T00:04Z",
        operation: "bootstrap_session_ensure",
        session_kind: "guest",
        outcome: "failure",
        error_fingerprint: "Exceeded allowed rows written in Durable Objects free tier.",
        count: 1,
        first_seen_at: 6000,
        last_seen_at: 6000,
      },
    ],
    failureResults: [
      {
        occurred_at: 6000,
        operation: "bootstrap_session_ensure",
        session_kind: "guest",
        request_path: "/api/game/bootstrap",
        error_message: "Exceeded allowed rows written in Durable Objects free tier.",
      },
    ],
  })

  const env = {
    ADMIN_DISCORD_USER_ID: "12345",
    DB: db,
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
      idFromName(name) {
        return name
      },
      get() {
        return {
          async fetch() {
            return {
              ok: true,
              async json() {
                return { user_id: "12345" }
              },
            }
          },
        }
      },
    },
  }

  const response = await handleAdminStatus(
    new Request("https://geneguessr.brinedew.bio/api/admin/status", {
      headers: {
        Cookie: "session=abc123",
      },
    }),
    env,
  )

  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.feature_flags.liveMolstar, true)
  assert.equal(payload.game_session_write_evidence.ok, true)
  assert.equal(payload.game_session_write_evidence.summary.failures, 1)
  assert.equal(
    payload.game_session_write_evidence.recent_failures[0].error_message,
    "Exceeded allowed rows written in Durable Objects free tier.",
  )
})
