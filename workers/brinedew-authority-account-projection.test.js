import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import { projectBrinedewAccountToManifestationAuthority } from "./lib/brinedew-authority-account-projection.js"

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
