import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import {
  projectBrinedewAccountToManifestationAuthority,
  drainBrinedewAuthorityAccountProjectionOutbox,
} from "./lib/brinedew-authority-account-projection.js"
import { TestD1 } from "./iconoplasm/caretaker/manifestation-authority-test-support.js"

class Statement {
  constructor(database, sql, bindings = []) {
    this.database = database
    this.sql = sql
    this.bindings = bindings
  }

  bind(...bindings) {
    return new Statement(this.database, this.sql, bindings)
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.bindings) || null
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.bindings)
    return { success: true, meta: { changes: Number(result.changes || 0) } }
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.bindings) }
  }
}

function primaryDatabase() {
  const database = new DatabaseSync(":memory:")
  database.exec("PRAGMA foreign_keys = ON")
  database.exec(`
    CREATE TABLE users (
      discord_id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      email TEXT,
      avatar_url TEXT,
      tier TEXT NOT NULL,
      premium_until INTEGER,
      leaderboard_opt_in INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    INSERT INTO users (
      discord_id, username, tier, leaderboard_opt_in, created_at, updated_at
    ) VALUES ('discord-one', 'Brinedew caretaker', 'registered', 0, 1, 1);
  `)
  for (const migration of [
    "../migrations/0027_brinedew_account_identity.sql",
    "../migrations/0028_brinedew_account_lifecycle.sql",
  ]) {
    database.exec(readFileSync(new URL(migration, import.meta.url), "utf8"))
  }
  return {
    database,
    prepare(sql) {
      return new Statement(database, sql)
    },
  }
}

test("batch account recovery leaves downstream events durable without multiplying projection drains", async (t) => {
  const primary = primaryDatabase()
  const authoring = new TestD1()
  t.after(() => {
    primary.database.close()
    authoring.close()
  })
  for (let i = 1; i <= 24; i++) {
    const accountId = `acct_${i.toString(16).padStart(32, "0")}`
    primary.database
      .prepare("INSERT INTO brinedew_accounts(account_id,created_at,updated_at) VALUES (?,1,1)")
      .run(accountId)
    primary.database
      .prepare(
        `INSERT INTO brinedew_account_lifecycle_events(event_id,command_id,account_id,event_type,to_status,account_version,occurred_at)
      VALUES (?,? ,?,'account_created','active',1,1)`,
      )
      .run(`account_event_batch_${i}`, `command_batch_${i}`, accountId)
  }
  let queries = 0
  for (const db of [primary, authoring]) {
    const prepare = db.prepare.bind(db)
    db.prepare = (sql) => {
      queries++
      return prepare(sql)
    }
  }
  let wakes = 0
  const result = await drainBrinedewAuthorityAccountProjectionOutbox({
    primaryDb: primary,
    authoringDb: authoring,
    limit: 25,
    now: 100,
    // An obsolete caller cannot reinstate the per-account full-batch wake.
    wakeManifestationProjection: async () => {
      wakes++
    },
  })
  assert.equal(result.attempted, 25)
  assert.equal(result.delivered, 25, JSON.stringify(result.results))
  assert.equal(wakes, 0)
  assert.equal(
    primary.database
      .prepare(
        "SELECT COUNT(*) AS n FROM brinedew_authority_account_projection_outbox WHERE projection_state='pending'",
      )
      .get().n,
    0,
  )
  t.diagnostic(
    `25 new accounts prepare ${queries} D1 statements; individual batch admission remains under audit`,
  )
})

test("stable account projection registers once, delivers idempotently, and wakes authority events", async (t) => {
  const primary = primaryDatabase()
  t.after(() => primary.database.close())
  const accountId = primary.database.prepare("SELECT account_id FROM users").get().account_id
  const calls = []
  let registered = false
  let wakes = 0
  const dependencies = {
    async registerAccount(_db, input) {
      calls.push({ operation: "register", input })
      registered = true
      return { account_id: input.accountId, status: input.status }
    },
    async projectAccount(_db, input) {
      calls.push({ operation: "project", input })
      if (!registered) {
        const error = new Error("not registered")
        error.code = "ACCOUNT_NOT_REGISTERED"
        throw error
      }
      return {
        ok: true,
        account_id: input.accountId,
        status: input.status,
        event_id: "event_authority_account_1",
        accepted_event_sequence: 17,
      }
    },
  }
  const authoring = { prepare() {} }
  const result = await projectBrinedewAccountToManifestationAuthority(
    {
      primaryDb: primary,
      authoringDb: authoring,
      accountId,
      now: 100,
      wakeManifestationProjection: async () => {
        wakes += 1
      },
    },
    dependencies,
  )
  assert.equal(result.status, "active")
  assert.deepEqual(
    calls.map((call) => call.operation),
    ["project", "register", "project"],
  )
  assert.equal(calls[2].input.sourceEventSequence > 0, true)
  const sourceOccurredAt = primary.database
    .prepare(
      "SELECT occurred_at FROM brinedew_authority_account_projection_outbox WHERE account_id = ?",
    )
    .get(accountId).occurred_at
  assert.equal(Date.parse(calls[0].input.occurredAt), sourceOccurredAt)
  assert.equal(calls[1].input.now, calls[0].input.occurredAt)
  assert.equal(wakes, 1)
  assert.deepEqual(
    {
      ...primary.database
        .prepare(
          `SELECT projection_state, attempt_count, delivered_at, last_error_code
             FROM brinedew_authority_account_projection_outbox
            WHERE account_id = ?`,
        )
        .get(accountId),
    },
    {
      projection_state: "delivered",
      attempt_count: 1,
      delivered_at: 100,
      last_error_code: null,
    },
  )

  calls.length = 0
  const replay = await projectBrinedewAccountToManifestationAuthority(
    { primaryDb: primary, authoringDb: authoring, accountId, now: 101 },
    dependencies,
  )
  assert.equal(replay.replayed, true)
  assert.deepEqual(calls, [])
})

test("failed account projection remains pending behind a bounded retry time", async (t) => {
  const primary = primaryDatabase()
  t.after(() => primary.database.close())
  const accountId = primary.database.prepare("SELECT account_id FROM users").get().account_id
  const authoring = { prepare() {} }
  await assert.rejects(
    () =>
      projectBrinedewAccountToManifestationAuthority(
        { primaryDb: primary, authoringDb: authoring, accountId, now: 200 },
        {
          projectAccount: async () => {
            const error = new Error("authoring unavailable")
            error.code = "AUTHORING_UNAVAILABLE"
            throw error
          },
          registerAccount: async () => assert.fail("registration must not hide provider failure"),
        },
      ),
    /authoring unavailable/,
  )
  const pending = primary.database
    .prepare(
      `SELECT projection_state, attempt_count, last_error_code,
              last_attempted_at, next_attempt_at
         FROM brinedew_authority_account_projection_outbox
        WHERE account_id = ?`,
    )
    .get(accountId)
  assert.deepEqual(
    { ...pending },
    {
      projection_state: "pending",
      attempt_count: 1,
      last_error_code: "AUTHORING_UNAVAILABLE",
      last_attempted_at: 200,
      next_attempt_at: 5_200,
    },
  )
})
