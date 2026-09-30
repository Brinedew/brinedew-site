import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import { viaStatefulWorker } from "./test-helpers/via-stateful-worker.js"
import { handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import { brinedewFormerAuthorLabel } from "./lib/brinedew-account-identity.js"

// B-871: the privacy page promises erasure; this route is the one command
// that performs it. Failure modes: a non-admin can erase; a malformed request
// reaches the database; the route reports success without the promised result.

class Statement {
  constructor(database, sql, args = []) {
    this.database = database
    this.sql = sql
    this.args = args
  }
  bind(...args) {
    return new Statement(this.database, this.sql, args)
  }
  async first() {
    return this.database.prepare(this.sql).get(...this.args) || null
  }
  async all() {
    return { results: this.database.prepare(this.sql).all(...this.args) }
  }
  async run() {
    const result = this.database.prepare(this.sql).run(...this.args)
    return { success: true, meta: { changes: Number(result.changes || 0) } }
  }
}

class SqliteD1 {
  constructor(database) {
    this.database = database
  }
  prepare(sql) {
    return new Statement(this.database, sql)
  }
  async batch(statements) {
    this.database.exec("BEGIN IMMEDIATE")
    try {
      const results = []
      for (const statement of statements) results.push(await statement.run())
      this.database.exec("COMMIT")
      return results
    } catch (error) {
      this.database.exec("ROLLBACK")
      throw error
    }
  }
}

function accountsDatabase() {
  const database = new DatabaseSync(":memory:")
  database.exec("PRAGMA foreign_keys = ON")
  for (const name of [
    "001_init.sql",
    "0016_add_leaderboard_opt_in.sql",
    "INSERT",
    "0027_brinedew_account_identity.sql",
    "0028_brinedew_account_lifecycle.sql",
  ]) {
    if (name === "INSERT") {
      database.exec(
        `INSERT INTO users (discord_id, username, tier, created_at, updated_at)
         VALUES ('discord-one', 'Original name', 'registered', 1, 1)`,
      )
      continue
    }
    database.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"))
  }
  return database
}

function erasureEnv(database) {
  const gatewayEnv = { ICONOPLASM_ADMIN_TOKEN: "secret-admin-token", DB: new SqliteD1(database) }
  const env = { ...gatewayEnv }
  env.THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE = {
    fetch: (request) =>
      handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        request,
        gatewayEnv,
        { waitUntil() {} },
      ),
  }
  return env
}

function erase(env, body, token = "secret-admin-token") {
  return viaStatefulWorker(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/accounts/erase", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
    {},
  )
}

test("the admin erasure route fulfils the privacy promise and refuses non-admins (B-871)", async () => {
  const database = accountsDatabase()
  const env = erasureEnv(database)
  const accountId = database
    .prepare(`SELECT account_id FROM users WHERE discord_id = 'discord-one'`)
    .get().account_id

  const denied = await erase(env, { account_id: accountId, command_id: "req-1" }, "wrong")
  assert.equal([401, 403].includes(denied.status), true)
  assert.equal(
    database.prepare(`SELECT status FROM brinedew_accounts WHERE account_id = ?`).get(accountId)
      .status,
    "active",
  )

  const invalid = await erase(env, { account_id: accountId, command_id: " " })
  assert.equal(invalid.status, 400)

  const response = await erase(env, { account_id: accountId, command_id: "req-1" })
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.account.status, "erased")
  const label = await brinedewFormerAuthorLabel(accountId)
  assert.equal(
    database.prepare(`SELECT username FROM users WHERE account_id = ?`).get(accountId).username,
    label,
  )

  const replay = await erase(env, { account_id: accountId, command_id: "req-1" })
  assert.equal(replay.status, 200)
  assert.equal((await replay.json()).account.replay, true)
})
