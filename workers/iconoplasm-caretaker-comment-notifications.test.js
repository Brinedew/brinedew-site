import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { createRequire } from "node:module"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import {
  CARETAKER_COMMENT_DELIVERY_LIMIT,
  CARETAKER_SUPERVOTE_DELIVERY_LIMIT,
  caretakerCommentOutboxStatement,
  deliverPendingCaretakerCommentNotifications,
  deliverPendingCaretakerSupervoteNotifications,
  resolveCaretakerCommentRecipient,
} from "./iconoplasm-caretaker-comment-notifications.js"
import { TestD1 } from "./iconoplasm/caretaker/manifestation-authority-test-support.js"

const ACCOUNT = "account_caretaker_comment_0001"
const AUTHOR = "account_caretaker_comment_0002"
const ASSIGNMENT = "assignment_caretaker_comment_0001"

for (const [kind, deliver, maximum] of [
  ["comment", deliverPendingCaretakerCommentNotifications, CARETAKER_COMMENT_DELIVERY_LIMIT],
  ["supervote", deliverPendingCaretakerSupervoteNotifications, CARETAKER_SUPERVOTE_DELIVERY_LIMIT],
]) {
  test(`${kind} delivery caps caller input below D1 and Discord invocation limits`, async (t) => {
    const { primary, accounts, env } = setup(t)
    const table = `icono_caretaker_${kind}_notifications`
    for (let i = 0; i < maximum + 5; i++) {
      if (kind === "comment") {
        await caretakerCommentOutboxStatement(primary, {
          notification_key: `budget-${i}`,
          caretaker_assignment_id: ASSIGNMENT,
          caretaker_account_id: ACCOUNT,
          caretaker_discord_user_id: "123456789",
          gene_symbol: "TP53",
          comment_author_account_id: AUTHOR,
          comment_author_name: "Reader",
          comment_body: "comment",
        }).run()
      } else {
        primary.raw
          .prepare(
            `INSERT INTO ${table}(notification_key,caretaker_assignment_id,caretaker_account_id,gene_symbol,preferred_asset_sha256,canonical_asset_sha256,supervote_version)
          VALUES (?,?,?,'TP53',?,?,3)`,
          )
          .run(`budget-${i}`, ASSIGNMENT, ACCOUNT, "a".repeat(64), "b".repeat(64))
      }
    }
    let queries = 0
    for (const db of [primary, accounts]) {
      const prepare = db.prepare.bind(db)
      db.prepare = (sql) => {
        queries++
        return prepare(sql)
      }
    }
    let requests = 0
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => {
      requests++
      return Response.json({ id: `discord-${requests}` })
    }
    try {
      const result = await deliver({ ...env, DISCORD_BOT_TOKEN: "local-test" }, { limit: 50000 })
      assert.equal(result.delivered, maximum)
      assert.ok(queries <= 50, `${queries} D1 queries exceed the Free invocation limit`)
      assert.ok(requests <= 50, `${requests} external requests exceed the Free invocation limit`)
      assert.equal(
        primary.raw
          .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE discord_status='pending'`)
          .get().n,
        5,
      )
      t.diagnostic(
        `${kind}: ${result.delivered} messages, ${queries} D1 queries, ${requests} external requests`,
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })
}

test(
  "real D1 bounds both caretaker selectors across tied backlogs and legacy retry formats",
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
      const directory = new URL("../migrations-iconoplasm/", import.meta.url)
      for (const file of readdirSync(directory)
        .filter((f) => f.endsWith(".sql"))
        .sort())
        schema.exec(readFileSync(new URL(file, directory), "utf8"))
      const db = await runtime.getD1Database("DB")
      const definitions = schema
        .prepare(
          "SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,rowid",
        )
        .all()
      for (let i = 0; i < definitions.length; i += 20)
        await db.batch(definitions.slice(i, i + 20).map(({ sql }) => db.prepare(sql)))
      for (const [kind, deliver] of [
        ["comment", deliverPendingCaretakerCommentNotifications],
        ["supervote", deliverPendingCaretakerSupervoteNotifications],
      ]) {
        const table = `icono_caretaker_${kind}_notifications`
        const selectionLimit = kind === "comment" ? 20 : 16
        const extraColumns =
          kind === "comment"
            ? "caretaker_discord_user_id,comment_author_account_id,comment_author_name,comment_body"
            : "preferred_asset_sha256,canonical_asset_sha256,supervote_version"
        const extraValues =
          kind === "comment"
            ? "'recipient','author','Reader','body'"
            : "printf('%064x',1),printf('%064x',2),1"
        await db
          .prepare(
            `WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<20000)
        INSERT INTO ${table}(notification_key,caretaker_assignment_id,caretaker_account_id,gene_symbol,created_at,${extraColumns})
        SELECT 'n-'||i,'assignment','account','G1',CURRENT_TIMESTAMP,${extraValues} FROM n`,
          )
          .run()
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
        await deliver(
          { ICONOPLASM_DB: capture, DB: capture, DISCORD_BOT_TOKEN: "local-test" },
          { limit: 20 },
        )
        const read = async (expected, ceiling) => {
          const result = await statement.all()
          assert.equal(result.results.length, expected)
          assert.ok(
            result.meta.rows_read <= ceiling,
            `${kind}: ${result.meta.rows_read} > ${ceiling}`,
          )
          assert.equal(result.meta.rows_written, 0)
          t.diagnostic(`${kind}: ${expected} candidates, ${result.meta.rows_read} reads`)
          return result.results
        }
        await read(selectionLimit, 120)
        await db
          .prepare(
            `UPDATE ${table} SET discord_status='retry',discord_next_attempt_at='2099-01-01T00:00:00.000Z'`,
          )
          .run()
        await read(0, 30)
        // Populate every disjoint range, including equal timestamps. None may
        // scan its 2,500-row prefix merely to sort notification keys.
        await db
          .prepare(
            `UPDATE ${table} SET
        discord_status=CASE WHEN rowid%8<4 THEN 'pending' ELSE 'retry' END,
        discord_next_attempt_at=CASE rowid%4 WHEN 0 THEN NULL
          WHEN 1 THEN strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 days')
          WHEN 2 THEN datetime(date('now'),'+1 second')
          ELSE strftime('%Y-%m-%dT%H:%M:%fZ',date('now'),'+1 second') END`,
          )
          .run()
        await read(selectionLimit, 750)
        await db
          .prepare(
            `UPDATE ${table} SET discord_status='retry',discord_next_attempt_at='2099-01-01 00:00:00'`,
          )
          .run()
        await db
          .prepare(
            `UPDATE ${table} SET discord_next_attempt_at=CASE notification_key
        WHEN 'n-1' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 minute')
        WHEN 'n-2' THEN datetime('now','-1 minute')
        WHEN 'n-3' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 days')
        WHEN 'n-4' THEN datetime('now','-2 days') END
        WHERE notification_key IN ('n-1','n-2','n-3','n-4')`,
          )
          .run()
        await db
          .prepare(
            `UPDATE ${table} SET discord_status='pending',discord_next_attempt_at=NULL WHERE notification_key='n-5'`,
          )
          .run()
        const due = await read(5, 60)
        assert.deepEqual(
          new Set(due.map((r) => r.notification_key)),
          new Set(["n-1", "n-2", "n-3", "n-4", "n-5"]),
        )
        assert.equal(
          due.at(-1).notification_key,
          "n-5",
          "new pending work must not starve an older due retry",
        )
        // Execute the real claim on workerd too. A missing tenure suppresses the
        // notification without ever requesting a Discord channel.
        const result = await deliver({ ICONOPLASM_DB: db, DB: db, DISCORD_BOT_TOKEN: "local-test" })
        assert.equal(result.delivered, 0)
        assert.equal(
          (
            await db
              .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE discord_status='suppressed'`)
              .first()
          ).n,
          5,
        )
      }
    } finally {
      schema.close()
      await runtime.dispose()
    }
  },
)

for (const [kind, deliver] of [
  ["comment", deliverPendingCaretakerCommentNotifications],
  ["supervote", deliverPendingCaretakerSupervoteNotifications],
]) {
  test(`${kind} retries use UTC SQL timestamps and stale overlapping selections cannot reclaim them`, async (t) => {
    const { primary, env } = setup(t)
    const table = `icono_caretaker_${kind}_notifications`
    if (kind === "comment") {
      await caretakerCommentOutboxStatement(primary, {
        notification_key: "overlap",
        caretaker_assignment_id: ASSIGNMENT,
        caretaker_account_id: ACCOUNT,
        caretaker_discord_user_id: "123456789",
        gene_symbol: "TP53",
        comment_author_account_id: AUTHOR,
        comment_author_name: "Reader",
        comment_body: "comment",
      }).run()
    } else {
      primary.raw
        .prepare(
          `INSERT INTO ${table}(notification_key,caretaker_assignment_id,caretaker_account_id,gene_symbol,preferred_asset_sha256,canonical_asset_sha256,supervote_version)
        VALUES ('overlap',?,?,'TP53',?,?,3)`,
        )
        .run(ASSIGNMENT, ACCOUNT, "a".repeat(64), "b".repeat(64))
    }
    const originalPrepare = primary.prepare.bind(primary)
    let snapshot
    primary.prepare = (sql) => {
      const statement = originalPrepare(sql)
      if (!sql.startsWith("WITH due_")) return statement
      const bind = statement.bind.bind(statement)
      statement.bind = (...args) => {
        const bound = bind(...args)
        const all = bound.all.bind(bound)
        bound.all = async () => snapshot || (snapshot = await all())
        return bound
      }
      return statement
    }
    const originalFetch = globalThis.fetch
    let calls = 0
    globalThis.fetch = async () => {
      calls += 1
      return new Response("rate limited", { status: 429 })
    }
    try {
      await deliver({ ...env, DISCORD_BOT_TOKEN: "local-test" })
      const row = primary.raw.prepare(`SELECT * FROM ${table}`).get()
      assert.equal(row.discord_status, "retry")
      assert.equal(row.discord_attempt_count, 1)
      assert.match(row.discord_next_attempt_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
      assert.ok(Date.parse(row.discord_next_attempt_at.replace(" ", "T") + "Z") > Date.now())
      await deliver({ ...env, DISCORD_BOT_TOKEN: "local-test" })
      assert.equal(calls, 1)
      assert.equal(
        primary.raw.prepare(`SELECT discord_attempt_count FROM ${table}`).get()
          .discord_attempt_count,
        1,
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })
}

function setup(t) {
  const primary = new TestD1()
  const accounts = new TestD1()
  primary.raw.exec(`
    CREATE TABLE icono_gene_comments (id INTEGER PRIMARY KEY, gene_symbol TEXT, status TEXT);
    CREATE TABLE icono_publish_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gene_symbol TEXT NOT NULL,
      from_asset_sha256 TEXT,
      to_asset_sha256 TEXT,
      action TEXT NOT NULL
    );
    CREATE TABLE icono_publish_state (
      gene_symbol TEXT PRIMARY KEY,
      current_asset_sha256 TEXT
    );
    INSERT INTO icono_publish_state VALUES ('TP53', '${"b".repeat(64)}');
    ${readFileSync(new URL("../migrations-iconoplasm/0085_caretaker_supervotes.sql", import.meta.url), "utf8")}
    ${readFileSync(new URL("../migrations-iconoplasm/0086_caretaker_assignment_notifications.sql", import.meta.url), "utf8")}
    ${readFileSync(new URL("../migrations-iconoplasm/0090_caretaker_coordination.sql", import.meta.url), "utf8")}
    ${readFileSync(new URL("../migrations-iconoplasm/0092_signed_caretaker_supervote.sql", import.meta.url), "utf8")}
    INSERT INTO icono_caretaker_assignment_notifications (
      caretaker_assignment_id, account_id, gene_id, canonical_symbol,
      assignment_status, assignment_version, notification_state,
      authority_event_id, authority_event_sequence, resolved_at
    ) VALUES (
      '${ASSIGNMENT}', '${ACCOUNT}', 'gene_caretaker_comment_0001', 'TP53',
      'active', 1, 'resolved', 'event_caretaker_comment_0001', 1, CURRENT_TIMESTAMP
    );
    INSERT INTO icono_caretaker_vote_assignment_projection (
      gene_symbol, gene_id, caretaker_assignment_id, caretaker_account_id,
      status, assignment_version, authority_event_id, authority_event_sequence
    ) VALUES ('TP53', 'gene_caretaker_comment_0001', '${ASSIGNMENT}', '${ACCOUNT}',
              'active', 1, 'event_caretaker_comment_0001', 1);
    INSERT INTO icono_caretaker_supervote_projection (
      gene_symbol, gene_id, caretaker_assignment_id, caretaker_account_id,
      asset_sha256, direction, active, weight, supervote_version, last_mutation_id
    ) VALUES ('TP53', 'gene_caretaker_comment_0001', '${ASSIGNMENT}', '${ACCOUNT}',
              '${"a".repeat(64)}', 1, 1, 10, 3, 'mutation_supervote_0001');
  `)
  accounts.raw.exec(`
    CREATE TABLE brinedew_account_identities (
      provider TEXT, provider_subject TEXT, account_id TEXT,
      link_version INTEGER, unlinked_at INTEGER
    );
    INSERT INTO brinedew_account_identities VALUES ('discord', '123456789', '${ACCOUNT}', 1, NULL);
  `)
  t.after(() => {
    primary.close()
    accounts.close()
  })
  return { primary, accounts, env: { ICONOPLASM_DB: primary, DB: accounts } }
}

test("recipient resolution uses the active assignment and suppresses self-notification", async (t) => {
  const { env } = setup(t)
  const recipient = await resolveCaretakerCommentRecipient(env, {
    symbol: "tp53",
    authorAccountId: AUTHOR,
  })
  assert.equal(recipient.caretaker_account_id, ACCOUNT)
  assert.equal(recipient.caretaker_discord_user_id, "123456789")
  assert.equal(
    await resolveCaretakerCommentRecipient(env, { symbol: "TP53", authorAccountId: ACCOUNT }),
    null,
  )
})

test("durable outbox sends one DM and records Discord receipt", async (t) => {
  const { primary, env } = setup(t)
  const row = {
    notification_key: "caretaker_comment_notification_0001",
    caretaker_assignment_id: ASSIGNMENT,
    caretaker_account_id: ACCOUNT,
    caretaker_discord_user_id: "123456789",
    gene_symbol: "TP53",
    comment_author_account_id: AUTHOR,
    comment_author_name: "Reader",
    comment_body: "🧬".repeat(2000),
  }
  await caretakerCommentOutboxStatement(primary, row).run()
  const originalFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(options.body) })
    if (String(url).endsWith("/users/@me/channels")) {
      return new Response(JSON.stringify({ id: "dm-channel" }), { status: 200 })
    }
    return new Response(JSON.stringify({ id: "dm-message" }), { status: 200 })
  }
  try {
    const results = await Promise.all([
      deliverPendingCaretakerCommentNotifications(
        { ...env, DISCORD_BOT_TOKEN: "test-token" },
        { limit: 1 },
      ),
      deliverPendingCaretakerCommentNotifications(
        { ...env, DISCORD_BOT_TOKEN: "test-token" },
        { limit: 1 },
      ),
    ])
    assert.equal(
      results.reduce((total, result) => total + result.delivered, 0),
      1,
    )
    assert.equal(requests.length, 2)
    assert.match(requests[1].body.content, /TP53[\s\S]*#gene-comments[\s\S]*Reader/)
    assert.equal(Array.from(requests[1].body.content).length, 2000)
    assert.doesNotMatch(requests[1].body.content, /\uFFFD/)
    assert.deepEqual(requests[1].body.allowed_mentions, { parse: [] })
    const delivered = primary.raw
      .prepare(
        "SELECT discord_status, discord_channel_id, discord_message_id FROM icono_caretaker_comment_notifications",
      )
      .get()
    assert.equal(delivered.discord_status, "sent")
    assert.equal(delivered.discord_channel_id, "dm-channel")
    assert.equal(delivered.discord_message_id, "dm-message")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("delivery revalidates tenure and suppresses a DM after caretaker departure", async (t) => {
  const { primary, env } = setup(t)
  await caretakerCommentOutboxStatement(primary, {
    notification_key: "caretaker_comment_notification_0002",
    caretaker_assignment_id: ASSIGNMENT,
    caretaker_account_id: ACCOUNT,
    caretaker_discord_user_id: "123456789",
    gene_symbol: "TP53",
    comment_author_account_id: AUTHOR,
    comment_author_name: "Reader",
    comment_body: "A late comment.",
  }).run()
  primary.raw
    .prepare(
      "UPDATE icono_caretaker_assignment_notifications SET assignment_status = 'ended', assignment_version = 2, authority_event_sequence = 2",
    )
    .run()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error("Discord must not be called")
  }
  try {
    const result = await deliverPendingCaretakerCommentNotifications({
      ...env,
      DISCORD_BOT_TOKEN: "test-token",
    })
    assert.equal(result.delivered, 0)
    assert.equal(
      primary.raw.prepare("SELECT discord_status FROM icono_caretaker_comment_notifications").get()
        .discord_status,
      "suppressed",
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("a positive preferred canonical loss enqueues and delivers one deduplicated bot DM", async (t) => {
  const { primary, env } = setup(t)
  primary.raw
    .prepare(
      `INSERT INTO icono_publish_events (
         id, gene_symbol, from_asset_sha256, to_asset_sha256, action
       ) VALUES (42, 'TP53', ?, ?, 'publish')`,
    )
    .run("a".repeat(64), "b".repeat(64))
  assert.equal(
    primary.raw
      .prepare("SELECT COUNT(*) AS count FROM icono_caretaker_supervote_notifications")
      .get().count,
    1,
  )

  const originalFetch = globalThis.fetch
  const messages = []
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith("/users/@me/channels")) {
      return new Response(JSON.stringify({ id: "supervote-dm" }), { status: 200 })
    }
    messages.push(JSON.parse(options.body))
    return new Response(JSON.stringify({ id: "supervote-message" }), { status: 200 })
  }
  try {
    const delivered = await deliverPendingCaretakerSupervoteNotifications({
      ...env,
      DISCORD_BOT_TOKEN: "test-token",
    })
    assert.equal(delivered.delivered, 1)
    assert.equal(messages.length, 1)
    assert.match(messages[0].content, /10x preferred blot for \*\*TP53\*\* is no longer canonical/)
    assert.deepEqual(messages[0].allowed_mentions, { parse: [] })
    assert.equal(
      primary.raw
        .prepare("SELECT discord_status FROM icono_caretaker_supervote_notifications")
        .get().discord_status,
      "sent",
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("negative, transferred, or ended supervotes cannot send a stale canonical-loss DM", async (t) => {
  const { primary, env } = setup(t)
  primary.raw.prepare("UPDATE icono_caretaker_supervote_projection SET direction = -1").run()
  primary.raw
    .prepare(
      `INSERT INTO icono_publish_events (
         id, gene_symbol, from_asset_sha256, to_asset_sha256, action
       ) VALUES (43, 'TP53', ?, ?, 'publish')`,
    )
    .run("a".repeat(64), "b".repeat(64))
  assert.equal(
    primary.raw
      .prepare("SELECT COUNT(*) AS count FROM icono_caretaker_supervote_notifications")
      .get().count,
    0,
  )

  primary.raw.prepare("UPDATE icono_caretaker_supervote_projection SET direction = 1").run()
  primary.raw
    .prepare(
      `INSERT INTO icono_publish_events (
         id, gene_symbol, from_asset_sha256, to_asset_sha256, action
       ) VALUES (44, 'TP53', ?, ?, 'publish')`,
    )
    .run("a".repeat(64), "b".repeat(64))
  primary.raw
    .prepare(
      `UPDATE icono_caretaker_supervote_projection
          SET asset_sha256 = '${"c".repeat(64)}', supervote_version = 4`,
    )
    .run()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error("Discord must not be called for a stale preference")
  }
  try {
    const result = await deliverPendingCaretakerSupervoteNotifications({
      ...env,
      DISCORD_BOT_TOKEN: "test-token",
    })
    assert.equal(result.delivered, 0)
    assert.equal(
      primary.raw
        .prepare("SELECT discord_status FROM icono_caretaker_supervote_notifications")
        .get().discord_status,
      "suppressed",
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})
