import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { createRequire } from "node:module"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import {
  projectBrinedewAccountToManifestationAuthority,
  drainBrinedewAuthorityAccountProjectionOutbox,
} from "./lib/brinedew-authority-account-projection.js"
import { TestD1 } from "./iconoplasm/caretaker/manifestation-authority-test-support.js"

test(
  "real D1 bounds account recovery selection with 20000 pending or deferred accounts",
  { timeout: 120000 },
  async (t) => {
    const require = createRequire(import.meta.url)
    const { Miniflare, convertV4MiniflareOptions } = createRequire(
      require.resolve("wrangler/package.json"),
    )("miniflare")
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: "export default {fetch(){return new Response('local')}}",
        compatibilityDate: "2026-08-01",
        d1Databases: ["DB"],
      }),
    )
    const schema = new DatabaseSync(":memory:")
    try {
      for (const owner of ["../migrations/", "./benchmark/migrations/"]) {
        const directory = new URL(owner, import.meta.url)
        for (const file of readdirSync(directory)
          .filter((f) => f.endsWith(".sql"))
          .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10) || a.localeCompare(b)))
          schema.exec(readFileSync(new URL(file, directory), "utf8"))
      }
      const db = await runtime.getD1Database("DB")
      const definitions = schema
        .prepare(
          "SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT IN (SELECT name FROM pragma_table_list WHERE type='shadow') ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,rowid",
        )
        .all()
      for (let i = 0; i < definitions.length; i += 20)
        await db.batch(definitions.slice(i, i + 20).map(({ sql }) => db.prepare(sql)))
      await db
        .prepare(
          `WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<20000)
      INSERT INTO brinedew_accounts(account_id,created_at,updated_at)
      SELECT 'acct_'||printf('%032x',i),0,0 FROM n`,
        )
        .run()
      await db
        .prepare(
          `INSERT INTO brinedew_authority_account_projection_outbox(account_id,source_event_id,source_event_sequence,account_version,source_status,authority_status,occurred_at)
      SELECT account_id,'event_'||rowid,rowid,1,'active','active',0 FROM brinedew_accounts`,
        )
        .run()
      const now = 1000000
      let statement
      const capture = {
        prepare(sql) {
          return {
            bind(...args) {
              statement = db.prepare(sql).bind(...args)
              return this
            },
            async all() {
              return { results: [] }
            },
          }
        },
      }
      await drainBrinedewAuthorityAccountProjectionOutbox({
        primaryDb: capture,
        authoringDb: capture,
        limit: 25,
        now,
      })
      const read = async (expected, maximum) => {
        const result = await statement.all()
        assert.equal(result.results.length, expected)
        assert.ok(result.meta.rows_read <= maximum, `${result.meta.rows_read} > ${maximum}`)
        assert.equal(result.meta.rows_written, 0)
        t.diagnostic(`account recovery: ${expected} candidates, ${result.meta.rows_read} reads`)
        return result.results
      }
      await read(25, 120)
      await db
        .prepare("UPDATE brinedew_authority_account_projection_outbox SET next_attempt_at=?")
        .bind(now + 1)
        .run()
      await read(0, 12)
      await db
        .prepare("UPDATE brinedew_authority_account_projection_outbox SET next_attempt_at=?")
        .bind(now - 1)
        .run()
      await read(25, 120)
      await db
        .prepare("UPDATE brinedew_authority_account_projection_outbox SET next_attempt_at=?")
        .bind(now + 1)
        .run()
      await db
        .prepare(
          "UPDATE brinedew_authority_account_projection_outbox SET next_attempt_at=NULL,occurred_at=? WHERE source_event_sequence=1",
        )
        .bind(now)
        .run()
      await db
        .prepare(
          "UPDATE brinedew_authority_account_projection_outbox SET next_attempt_at=? WHERE source_event_sequence=2",
        )
        .bind(now - 1)
        .run()
      const due = await read(2, 20)
      assert.equal(
        due[0].account_id,
        `acct_${(2).toString(16).padStart(32, "0")}`,
        "an older due retry must not be starved by new pending work",
      )
    } finally {
      schema.close()
      await runtime.dispose()
    }
  },
)

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
  let delivered = 0
  let batches = 0
  for (; batches < 25; batches++) {
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
    assert.ok(result.statement_count <= 50)
    assert.ok(result.delivered > 0)
    delivered += result.delivered
    if (!result.has_more) break
  }
  assert.equal(delivered, 25)
  assert.ok(batches < 25)
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
    `25 new accounts recovered in ${batches + 1} bounded invocations (${queries} prepared statements total)`,
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
