import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { DatabaseSync } from "node:sqlite"

import {
  brinedewFormerAuthorLabel,
  eraseBrinedewAccount,
  hydrateBrinedewSessionAccountIdentity,
  requestBrinedewAccountErasure,
  resolveBrinedewAccountIdentity,
  setBrinedewAccountStatus,
} from "./lib/brinedew-account-identity.js"

class D1Statement {
  constructor(database, sql, args = []) {
    this.database = database
    this.sql = sql
    this.args = args
  }

  bind(...args) {
    return new D1Statement(this.database, this.sql, args)
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
    this.serialized = Promise.resolve()
  }

  prepare(sql) {
    return new D1Statement(this.database, sql)
  }

  async batch(statements) {
    const operation = this.serialized.then(async () => {
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
    })
    this.serialized = operation.catch(() => undefined)
    return operation
  }
}

function migratedDatabase() {
  const database = new DatabaseSync(":memory:")
  database.exec("PRAGMA foreign_keys = ON")
  database.exec(readFileSync(new URL("../migrations/001_init.sql", import.meta.url), "utf8"))
  database.exec(
    readFileSync(new URL("../migrations/0016_add_leaderboard_opt_in.sql", import.meta.url), "utf8"),
  )
  database.exec(
    `INSERT INTO users (
       discord_id, username, tier, created_at, updated_at
     ) VALUES
       ('discord-one', 'Original name', 'registered', 1, 1),
       ('discord-two', 'Second person', 'registered', 1, 1)`,
  )
  database.exec(
    readFileSync(
      new URL("../migrations/0027_brinedew_account_identity.sql", import.meta.url),
      "utf8",
    ),
  )
  database.exec(
    readFileSync(
      new URL("../migrations/0028_brinedew_account_lifecycle.sql", import.meta.url),
      "utf8",
    ),
  )
  return database
}

test("concurrent first-login resolution is idempotent and leaves no orphan account", async () => {
  const database = migratedDatabase()
  const db = new SqliteD1(database)
  let candidate = 0
  const accountIdFactory = () => {
    candidate += 1
    return `acct_${String(candidate).padStart(32, "0")}`
  }

  const [first, second] = await Promise.all([
    resolveBrinedewAccountIdentity(db, {
      provider: "discord",
      providerSubject: "new-discord-user",
      now: 10,
      accountIdFactory,
    }),
    resolveBrinedewAccountIdentity(db, {
      provider: "discord",
      providerSubject: "new-discord-user",
      now: 11,
      accountIdFactory,
    }),
  ])

  assert.equal(first.account_id, second.account_id)
  assert.equal(database.prepare(`SELECT count(*) AS count FROM brinedew_accounts`).get().count, 3)
  assert.equal(
    database
      .prepare(
        `SELECT count(*) AS count
         FROM brinedew_account_identities
         WHERE provider = 'discord' AND provider_subject = 'new-discord-user'`,
      )
      .get().count,
    1,
  )
})

test("a legacy session hydrates the migrated account without changing user_id", async () => {
  const database = migratedDatabase()
  const db = new SqliteD1(database)
  const expected = database
    .prepare(`SELECT account_id FROM users WHERE discord_id = 'discord-one'`)
    .get().account_id

  const hydrated = await hydrateBrinedewSessionAccountIdentity(db, {
    user_id: "discord-one",
    username: "Renamed later",
  })

  assert.equal(hydrated.changed, true)
  assert.equal(hydrated.active, true)
  assert.equal(hydrated.session.user_id, "discord-one")
  assert.equal(hydrated.session.account_id, expected)
  assert.equal(hydrated.session.account_status, "active")
})

test("erasure removes active provider links and public credit but preserves immutable attribution", async () => {
  const database = migratedDatabase()
  const db = new SqliteD1(database)
  const accountId = database
    .prepare(`SELECT account_id FROM users WHERE discord_id = 'discord-one'`)
    .get().account_id
  database.exec(`
    CREATE TABLE test_manifestation_revision_attribution (
      revision_id TEXT PRIMARY KEY,
      author_account_id TEXT NOT NULL REFERENCES brinedew_accounts(account_id)
    );
  `)
  database
    .prepare(
      `INSERT INTO test_manifestation_revision_attribution (revision_id, author_account_id)
       VALUES ('revision-immutable', ?)`,
    )
    .run(accountId)
  await setBrinedewAccountStatus(db, {
    accountId,
    status: "erasure_pending",
    commandId: "request-erasure-1",
    finalLeavePolicy: "retain",
    now: 40,
  })
  const erased = await eraseBrinedewAccount(db, {
    accountId,
    commandId: "complete-erasure-1",
    reasonCode: "user_request",
    now: 41,
  })
  const expectedLabel = await brinedewFormerAuthorLabel(accountId)

  assert.equal(erased.status, "erased")
  assert.equal(erased.author_label, expectedLabel)
  assert.equal(
    database.prepare(`SELECT author_account_id FROM test_manifestation_revision_attribution`).get()
      .author_account_id,
    accountId,
  )
  assert.equal(
    database
      .prepare(`SELECT count(*) AS count FROM brinedew_account_identities WHERE account_id = ?`)
      .get(accountId).count,
    0,
  )
  // The `users` row is the last place the raw Discord id lived: it is deleted, not anonymised.
  assert.equal(
    database.prepare(`SELECT count(*) AS count FROM users WHERE account_id = ?`).get(accountId)
      .count,
    0,
  )
  assert.equal(
    database.prepare(`SELECT count(*) AS count FROM users WHERE discord_id = 'discord-one'`).get()
      .count,
    0,
  )
  const authorityProjection = database
    .prepare(
      `SELECT source_status, authority_status, final_leave_policy,
              projection_state, source_event_id, source_event_sequence
         FROM brinedew_authority_account_projection_outbox
        WHERE account_id = ?`,
    )
    .get(accountId)
  assert.deepEqual(
    {
      source_status: authorityProjection.source_status,
      authority_status: authorityProjection.authority_status,
      final_leave_policy: authorityProjection.final_leave_policy,
      projection_state: authorityProjection.projection_state,
    },
    {
      source_status: "erased",
      authority_status: "tombstoned",
      final_leave_policy: null,
      projection_state: "pending",
    },
  )
  assert.deepEqual(
    {
      ...database
        .prepare(
          `SELECT event_id, event_sequence
             FROM brinedew_account_lifecycle_events
            WHERE account_id = ? AND event_type = 'erasure_completed'`,
        )
        .get(accountId),
    },
    {
      event_id: authorityProjection.source_event_id,
      event_sequence: authorityProjection.source_event_sequence,
    },
  )
  const erasureLinkEvent = database
    .prepare(
      `SELECT provider_subject_fingerprint
       FROM brinedew_account_identity_events
       WHERE account_id = ? AND event_type = 'identity_erasure_unlinked'`,
    )
    .get(accountId)
  // No fingerprint of the subject survives, in any event or in the command ids built from it.
  assert.match(
    erasureLinkEvent.provider_subject_fingerprint,
    /^erased:identity_event_[0-9a-f]{32}$/,
  )
  const remaining = [
    ...database
      .prepare(
        `SELECT provider_subject_fingerprint AS value FROM brinedew_account_identity_events
         WHERE account_id = ?
         UNION ALL SELECT command_id FROM brinedew_account_identity_events WHERE account_id = ?
         UNION ALL SELECT command_id FROM brinedew_account_lifecycle_events WHERE account_id = ?`,
      )
      .all(accountId, accountId, accountId),
  ].map((entry) => entry.value)
  assert.equal(
    remaining.some((value) => value.includes("sha256:")),
    false,
  )
  // The history stays append-only for everyone: the guards erasure lifted are back.
  assert.throws(
    () => database.exec(`UPDATE brinedew_account_identity_events SET occurred_at = 0`),
    /append-only/,
  )
  assert.throws(
    () => database.exec(`UPDATE brinedew_account_lifecycle_events SET occurred_at = 0`),
    /append-only/,
  )
  // Another person's first-login fingerprint is untouched.
  assert.equal(
    database
      .prepare(
        `SELECT count(*) AS count FROM brinedew_account_identity_events
         WHERE account_id <> ? AND provider_subject_fingerprint NOT LIKE 'erased:%'`,
      )
      .get(accountId).count > 0,
    true,
  )
})

// B-871 (26 Sep 2026), B-987: the privacy page promises that an erased account loses its provider
// identity while retained authorship shows a stable anonymous label. Failure modes:
// 1. an erasure request needs two hand-typed commands and can stop halfway;
// 2. replaying the same request double-applies or errors;
// 3. an unknown account, or a second request under a different command after erasure, looks like
//    success;
// 4. the request leaves the caretaker withdraw policy (not implemented downstream) reachable,
//    contradicting the promised retained history;
// 5. the Discord id survives in `users`, so the erased person is locked out forever by an account
//    that no longer holds anything of theirs.
test("a requested erasure completes once, replays idempotently and frees the Discord id (B-987)", async () => {
  const database = migratedDatabase()
  const db = new SqliteD1(database)
  const accountId = database
    .prepare(`SELECT account_id FROM users WHERE discord_id = 'discord-one'`)
    .get().account_id

  await assert.rejects(
    eraseBrinedewAccount(db, { accountId, commandId: "erasure-request-6", now: 40 }),
    (error) => error?.code === "ERASURE_NOT_PENDING",
  )
  const pending = await requestBrinedewAccountErasure(db, {
    accountId,
    commandId: "erasure-request-7",
    now: 50,
  })
  assert.equal(pending.status, "erasure_pending")
  // Asking again (a resumed erasure) changes nothing.
  assert.deepEqual(
    await requestBrinedewAccountErasure(db, { accountId, commandId: "erasure-request-7", now: 51 }),
    pending,
  )
  const erased = await eraseBrinedewAccount(db, {
    accountId,
    commandId: "erasure-request-7",
    now: 52,
  })
  assert.equal(erased.status, "erased")
  assert.equal(erased.author_label, await brinedewFormerAuthorLabel(accountId))
  assert.equal(
    database
      .prepare(`SELECT count(*) AS count FROM brinedew_account_identities WHERE account_id = ?`)
      .get(accountId).count,
    0,
  )
  const requested = database
    .prepare(
      `SELECT final_leave_policy FROM brinedew_account_lifecycle_events
        WHERE account_id = ? AND to_status = 'erasure_pending'`,
    )
    .get(accountId)
  assert.equal(requested.final_leave_policy, "retain")

  const replay = await eraseBrinedewAccount(db, {
    accountId,
    commandId: "erasure-request-7",
    now: 60,
  })
  assert.equal(replay.replay, true)
  assert.equal(replay.status, "erased")

  await assert.rejects(
    eraseBrinedewAccount(db, { accountId, commandId: "erasure-request-8", now: 70 }),
    (error) => error?.code === "ACCOUNT_COMMAND_REUSED" || error?.code === "ACCOUNT_ERASED",
  )
  await assert.rejects(
    requestBrinedewAccountErasure(db, {
      accountId: "acct_" + "0".repeat(32),
      commandId: "erasure-request-9",
    }),
    (error) => error?.code === "ACCOUNT_NOT_FOUND",
  )

  // A session the person still holds stops being active. Their next Discord login is not blocked:
  // nothing is left to resolve the id to, so it opens a brand-new account, and the erased one keeps
  // its anonymous label.
  const held = await hydrateBrinedewSessionAccountIdentity(db, {
    user_id: "discord-one",
    account_id: accountId,
  })
  assert.equal(held.active, false)
  assert.equal(held.session.account_status, "erased")
  const accountsBefore = database
    .prepare(`SELECT count(*) AS count FROM brinedew_accounts`)
    .get().count
  const signIn = await resolveBrinedewAccountIdentity(db, {
    provider: "discord",
    providerSubject: "discord-one",
    now: 80,
  })
  assert.notEqual(signIn.account_id, accountId)
  assert.equal(signIn.status, "active")
  assert.equal(
    database.prepare(`SELECT count(*) AS count FROM brinedew_accounts`).get().count,
    accountsBefore + 1,
  )
  assert.equal(
    database.prepare(`SELECT status FROM brinedew_accounts WHERE account_id = ?`).get(accountId)
      .status,
    "erased",
  )
})

test("a provider identity cannot be reassigned to another account", () => {
  const database = migratedDatabase()
  const other = database
    .prepare(`SELECT account_id FROM users WHERE discord_id = 'discord-two'`)
    .get().account_id
  assert.throws(
    () =>
      database
        .prepare(
          `UPDATE brinedew_account_identities SET account_id = ? WHERE provider_subject = 'discord-one'`,
        )
        .run(other),
    /cannot be reassigned/,
  )
})
