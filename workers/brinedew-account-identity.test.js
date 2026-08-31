import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { DatabaseSync } from "node:sqlite"

import {
  brinedewFormerAuthorLabel,
  disableBrinedewAccount,
  eraseBrinedewAccount,
  hydrateBrinedewSessionAccountIdentity,
  linkBrinedewProviderIdentity,
  resolveBrinedewAccountIdentity,
  setBrinedewAccountStatus,
  unlinkBrinedewProviderIdentity,
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

test("the identity migration gives every existing Discord profile one opaque stable account", () => {
  const database = migratedDatabase()
  const users = database
    .prepare(`SELECT discord_id, account_id FROM users ORDER BY discord_id`)
    .all()
  const identities = database
    .prepare(
      `SELECT provider, provider_subject, account_id
       FROM brinedew_account_identities
       ORDER BY provider_subject`,
    )
    .all()

  assert.equal(users.length, 2)
  assert.match(users[0].account_id, /^acct_[0-9a-f]{32}$/)
  assert.match(users[1].account_id, /^acct_[0-9a-f]{32}$/)
  assert.notEqual(users[0].account_id, users[1].account_id)
  assert.deepEqual(
    identities.map((row) => [row.provider, row.provider_subject, row.account_id]),
    users.map((row) => ["discord", row.discord_id, row.account_id]),
  )
})

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

test("provider unlink and relink preserve account ownership and reject reassignment", async () => {
  const database = migratedDatabase()
  const db = new SqliteD1(database)
  const firstAccount = database
    .prepare(`SELECT account_id FROM users WHERE discord_id = 'discord-one'`)
    .get().account_id
  const secondAccount = database
    .prepare(`SELECT account_id FROM users WHERE discord_id = 'discord-two'`)
    .get().account_id

  const unlinked = await unlinkBrinedewProviderIdentity(db, {
    accountId: firstAccount,
    provider: "discord",
    providerSubject: "discord-one",
    commandId: "identity-unlink-1",
    now: 20,
  })
  assert.equal(unlinked.link_version, 2)
  await assert.rejects(
    resolveBrinedewAccountIdentity(db, {
      provider: "discord",
      providerSubject: "discord-one",
      now: 21,
    }),
    (error) => error?.code === "PROVIDER_IDENTITY_UNLINKED",
  )
  await assert.rejects(
    linkBrinedewProviderIdentity(db, {
      accountId: secondAccount,
      provider: "discord",
      providerSubject: "discord-one",
      commandId: "identity-steal-1",
      now: 22,
    }),
    (error) => error?.code === "PROVIDER_IDENTITY_COLLISION",
  )

  const relinked = await linkBrinedewProviderIdentity(db, {
    accountId: firstAccount,
    provider: "discord",
    providerSubject: "discord-one",
    commandId: "identity-relink-1",
    now: 23,
  })
  assert.equal(relinked.account_id, firstAccount)
  assert.equal(relinked.link_version, 3)
  assert.equal(
    (
      await resolveBrinedewAccountIdentity(db, {
        provider: "discord",
        providerSubject: "discord-one",
        now: 24,
      })
    ).account_id,
    firstAccount,
  )
})

test("account status and provider-link histories are append-only and command-idempotent", async () => {
  const database = migratedDatabase()
  const db = new SqliteD1(database)
  const accountId = database
    .prepare(`SELECT account_id FROM users WHERE discord_id = 'discord-one'`)
    .get().account_id

  const disabled = await disableBrinedewAccount(db, {
    accountId,
    commandId: "disable-account-1",
    reasonCode: "policy",
    now: 30,
  })
  const replay = await disableBrinedewAccount(db, {
    accountId,
    commandId: "disable-account-1",
    reasonCode: "policy",
    now: 31,
  })
  assert.equal(disabled.account_version, 2)
  assert.equal(replay.account_version, 2)
  assert.equal(replay.replay, true)
  assert.equal(
    database
      .prepare(
        `SELECT count(*) AS count
         FROM brinedew_account_lifecycle_events
         WHERE account_id = ? AND command_id = 'disable-account-1'`,
      )
      .get(accountId).count,
    1,
  )
  assert.throws(
    () =>
      database
        .prepare(
          `UPDATE brinedew_account_lifecycle_events
           SET reason_code = 'rewritten' WHERE account_id = ?`,
        )
        .run(accountId),
    /append-only/,
  )
  assert.throws(
    () =>
      database
        .prepare(`DELETE FROM brinedew_account_identity_events WHERE account_id = ?`)
        .run(accountId),
    /append-only/,
  )
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
  const publicProfile = database
    .prepare(
      `SELECT username, email, avatar_url, leaderboard_opt_in
       FROM users WHERE account_id = ?`,
    )
    .get(accountId)
  assert.deepEqual(
    { ...publicProfile },
    {
      username: expectedLabel,
      email: null,
      avatar_url: null,
      leaderboard_opt_in: 0,
    },
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
  assert.match(erasureLinkEvent.provider_subject_fingerprint, /^sha256:[0-9a-f]{64}$/)
  assert.equal(erasureLinkEvent.provider_subject_fingerprint.includes("discord-one"), false)
})
