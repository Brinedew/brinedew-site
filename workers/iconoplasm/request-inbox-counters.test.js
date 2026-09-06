import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { requestInboxCounterMigration } from "../../scripts/generate-request-inbox-counters.mjs"
import { REQUEST_INBOX_COUNTS_SQL, REQUEST_INBOX_PAGE_SQL } from "./request-inbox-queries.js"
import { createRequire } from "node:module"
import { markRequestNotificationsRead } from "../iconoplasm-request-notifications.js"

function database() {
  const db = new DatabaseSync(":memory:")
  db.exec(`CREATE TABLE icono_generation_requests(id INTEGER PRIMARY KEY,requester_user_id TEXT,gene_symbol TEXT,fulfilled_asset_sha256 TEXT,status TEXT);
    CREATE TABLE icono_portrait_assets(gene_symbol TEXT,asset_sha256 TEXT,PRIMARY KEY(gene_symbol,asset_sha256));
    CREATE TABLE icono_request_notifications(id INTEGER PRIMARY KEY,request_id INTEGER UNIQUE,requester_user_id TEXT,gene_symbol TEXT,fulfilled_asset_sha256 TEXT,discord_status TEXT,read_at TEXT,fulfillment_publication_id TEXT,created_at TEXT NOT NULL);
    INSERT INTO icono_generation_requests VALUES(1,'user','TP53','a','fulfilled'),(2,'user','TP53','b','fulfilled'),(3,'user','OTHER','a','fulfilled'),(4,'user','TP53','c','delivery_pending');
    INSERT INTO icono_portrait_assets VALUES('TP53','a'),('TP53','b'),('OTHER','a'),('TP53','c');
    INSERT INTO icono_request_notifications VALUES(1,1,'user','TP53','a','sent',NULL,'publication','2026-09-06'),(2,2,'user','TP53','b','sent',NULL,'publication','2026-09-06'),(3,3,'user','OTHER','a','sent','read','','2026-09-06'),(4,4,'user','TP53','c','sent',NULL,'publication','2026-09-06');`)
  db.exec(
    "ALTER TABLE icono_generation_requests ADD COLUMN created_at TEXT DEFAULT '2026-09-06'; ALTER TABLE icono_portrait_assets ADD COLUMN created_at TEXT DEFAULT '2026-09-06'; ALTER TABLE icono_portrait_assets ADD COLUMN candidate_image_id INTEGER DEFAULT 1",
  )
  db.exec(
    "ALTER TABLE icono_request_notifications ADD COLUMN fulfillment_group_size INTEGER NOT NULL DEFAULT 1; ALTER TABLE icono_request_notifications ADD COLUMN discord_next_attempt_at TEXT; CREATE INDEX idx_icono_request_notifications_fulfillment_publication ON icono_request_notifications(requester_user_id,fulfillment_publication_id,gene_symbol,discord_status,id)",
  )
  db.exec(
    "CREATE INDEX idx_icono_request_notifications_delivery ON icono_request_notifications(discord_status); CREATE INDEX idx_icono_request_notifications_delivery_due ON icono_request_notifications(discord_status); CREATE INDEX idx_icono_request_notifications_delivery_batch ON icono_request_notifications(discord_status)",
  )
  return db
}

function assertExact(db) {
  // Independent JS oracle, including the original live identity joins and
  // distinct group semantics; never derive expected totals from the new tables.
  const requests = new Map(
    db
      .prepare("SELECT * FROM icono_generation_requests")
      .all()
      .map((r) => [r.id, r]),
  )
  const assets = new Set(
    db
      .prepare("SELECT * FROM icono_portrait_assets")
      .all()
      .map((a) => JSON.stringify([a.gene_symbol, a.asset_sha256])),
  )
  const valid = db
    .prepare("SELECT * FROM icono_request_notifications")
    .all()
    .filter((n) => {
      const r = requests.get(n.request_id)
      return (
        n.discord_status === "sent" &&
        r?.status === "fulfilled" &&
        r.requester_user_id === n.requester_user_id &&
        r.gene_symbol === n.gene_symbol &&
        r.fulfilled_asset_sha256 === n.fulfilled_asset_sha256 &&
        assets.has(JSON.stringify([n.gene_symbol, n.fulfilled_asset_sha256]))
      )
    })
  assert.deepEqual(
    db
      .prepare("SELECT notification_id FROM icono_request_inbox_members ORDER BY notification_id")
      .all()
      .map((r) => r.notification_id),
    valid.map((n) => n.id).sort((a, b) => a - b),
  )
  const stored = db.prepare("SELECT * FROM icono_request_inbox_summary").all()
  for (const user of new Set([
    ...valid.map((n) => n.requester_user_id),
    ...stored.map((s) => s.requester_user_id),
  ])) {
    const rows = valid.filter((n) => n.requester_user_id === user)
    const group = (n) =>
      (n.fulfillment_publication_id || "legacy-request:" + n.request_id) +
      String.fromCharCode(31) +
      n.gene_symbol
    assert.deepEqual(
      { ...stored.find((s) => s.requester_user_id === user) },
      {
        requester_user_id: user,
        ready_count: rows.length,
        unread_count: rows.filter((n) => n.read_at === null).length,
        ready_group_count: new Set(rows.map(group)).size,
        unread_group_count: new Set(rows.filter((n) => n.read_at === null).map(group)).size,
      },
    )
  }
}

test("inbox counters retain exact receipt validity and grouping through source changes", () => {
  assert.equal(
    readFileSync(
      new URL("../../migrations-iconoplasm/0096_request_inbox_counters.sql", import.meta.url),
      "utf8",
    ).replaceAll("\r\n", "\n"),
    requestInboxCounterMigration(),
  )
  const db = database()
  try {
    db.exec(requestInboxCounterMigration())
    assertExact(db)
    for (const sql of [
      "UPDATE icono_request_notifications SET read_at='now' WHERE id=1",
      "UPDATE icono_request_notifications SET read_at='now' WHERE id=2",
      "UPDATE icono_request_notifications SET read_at=NULL,fulfillment_publication_id='new-group' WHERE id=1",
      "UPDATE icono_generation_requests SET status='fulfilled' WHERE id=4",
      "UPDATE icono_generation_requests SET requester_user_id='other' WHERE id=1",
      "UPDATE icono_request_notifications SET requester_user_id='other' WHERE id=1",
      "DELETE FROM icono_portrait_assets WHERE gene_symbol='TP53' AND asset_sha256='b'",
      "INSERT INTO icono_portrait_assets(gene_symbol,asset_sha256) VALUES('TP53','b')",
      "UPDATE icono_portrait_assets SET asset_sha256='renamed' WHERE gene_symbol='TP53' AND asset_sha256='b'",
      "UPDATE icono_generation_requests SET fulfilled_asset_sha256='renamed' WHERE id=2",
      "UPDATE icono_request_notifications SET fulfilled_asset_sha256='renamed' WHERE id=2",
      "UPDATE icono_request_notifications SET discord_status='retry' WHERE id=4",
      "UPDATE icono_request_notifications SET discord_status='sent' WHERE id=4",
      "DELETE FROM icono_generation_requests WHERE id=3",
      "DELETE FROM icono_request_notifications WHERE id=4",
    ]) {
      db.exec(sql)
      assertExact(db)
    }
    db.exec("BEGIN; DELETE FROM icono_portrait_assets")
    assertExact(db)
    db.exec("ROLLBACK")
    assertExact(db)
    const before = db.prepare("SELECT total_changes() AS n").get().n
    db.exec("UPDATE icono_request_notifications SET read_at=read_at")
    assert.equal(db.prepare("SELECT total_changes() AS n").get().n - before, 3)
  } finally {
    db.close()
  }
})

test("inbox counts and newest-page plans do not traverse growing notification history", () => {
  const db = database()
  try {
    db.exec(requestInboxCounterMigration())
    db.exec(`WITH RECURSIVE ids(n) AS (VALUES(10) UNION ALL SELECT n+1 FROM ids WHERE n<10010)
      INSERT INTO icono_generation_requests(id,requester_user_id,gene_symbol,fulfilled_asset_sha256,status)
      SELECT n,'user','TP53','a','fulfilled' FROM ids`)
    db.exec(`WITH RECURSIVE ids(n) AS (VALUES(10) UNION ALL SELECT n+1 FROM ids WHERE n<20010)
      INSERT INTO icono_request_notifications(id,request_id,requester_user_id,gene_symbol,fulfilled_asset_sha256,discord_status,read_at,fulfillment_publication_id,created_at) SELECT n,n,'user','TP53','a','sent',NULL,'history','2020-01-01' FROM ids`)
    assertExact(db)
    const plans = [
      db.prepare("EXPLAIN QUERY PLAN " + REQUEST_INBOX_COUNTS_SQL).all("user"),
      db.prepare("EXPLAIN QUERY PLAN " + REQUEST_INBOX_PAGE_SQL).all("user", 50),
    ]
    for (const rows of plans) {
      assert.ok(rows.some((r) => /SEARCH/.test(r.detail)))
      assert.ok(rows.every((r) => !/SCAN|TEMP B-TREE/.test(r.detail)))
    }
    assert.equal(db.prepare(REQUEST_INBOX_COUNTS_SQL).get("user").ready_count, 10004)
    assert.equal(db.prepare(REQUEST_INBOX_PAGE_SQL).all("user", 50).length, 50)
  } finally {
    db.close()
  }
})

test(
  "measure inbox receipt reads and mutation amplification in local workerd",
  { timeout: 60000 },
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
    const local = new DatabaseSync(":memory:")
    try {
      const migrationRoot = new URL("../../migrations-iconoplasm/", import.meta.url)
      for (const file of readdirSync(migrationRoot)
        .filter((name) => name.endsWith(".sql"))
        .sort())
        local.exec(readFileSync(new URL(file, migrationRoot), "utf8"))
      const db = await runtime.getD1Database("DB")
      const definitions = local
        .prepare(
          "SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,rowid",
        )
        .all()
      for (let offset = 0; offset < definitions.length; offset += 20)
        await db.batch(definitions.slice(offset, offset + 20).map(({ sql }) => db.prepare(sql)))
      // Carry migration-owned seed rows too, so trigger destinations match a
      // freshly migrated production schema rather than an empty DDL skeleton.
      for (const { name } of local
        .prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all()) {
        for (const row of local.prepare(`SELECT * FROM "${name}"`).all()) {
          const columns = Object.keys(row)
          await db
            .prepare(
              `INSERT INTO "${name}" (${columns.map((column) => `"${column}"`).join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
            )
            .bind(...Object.values(row))
            .run()
        }
      }
      await db
        .prepare(
          "INSERT INTO icono_portrait_assets(gene_symbol,asset_sha256,r2_key_full,r2_key_thumb) VALUES('TP53',?,'full','thumb')",
        )
        .bind("a".repeat(64))
        .run()
      await db
        .prepare(
          `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<20000)
      INSERT INTO icono_generation_requests(id,requester_user_id,gene_symbol,fulfilled_asset_sha256,status)
      SELECT n,'reader','TP53',?,'fulfilled' FROM ids`,
        )
        .bind("a".repeat(64))
        .run()
      await db
        .prepare(
          `INSERT INTO icono_request_notifications(id,notification_key,request_id,requester_user_id,gene_symbol,fulfilled_asset_sha256,discord_status,fulfillment_publication_id,created_at)
      SELECT id,'notification-' || id,id,requester_user_id,gene_symbol,fulfilled_asset_sha256,'sent','group-' || (id / 20),'2026-09-06' FROM icono_generation_requests`,
        )
        .run()
      const count = await db.prepare(REQUEST_INBOX_COUNTS_SQL).bind("reader").all()
      const page = await db.prepare(REQUEST_INBOX_PAGE_SQL).bind("reader", 50).all()
      assert.equal(count.results[0].ready_count, 20000)
      assert.equal(page.results.length, 50)
      assert.ok(count.meta.rows_read <= 2)
      assert.ok(page.meta.rows_read <= 400)
      const receipts = []
      const env = {
        ICONOPLASM_DB: {
          prepare(sql) {
            return {
              bind(...args) {
                return {
                  async run() {
                    const result = await db
                      .prepare(sql)
                      .bind(...args)
                      .run()
                    receipts.push(result)
                    return result
                  },
                }
              },
            }
          },
        },
      }
      const mark = () =>
        markRequestNotificationsRead(env, { requesterUserId: "reader", notificationIds: [20000] })
      assert.equal((await mark()).ok, true)
      assert.equal((await mark()).marked_read, 0)
      const [read, duplicate] = receipts
      assert.ok(read.meta.rows_read <= 6)
      assert.ok(read.meta.rows_written <= 5)
      assert.equal(duplicate.meta.rows_written, 0)
      t.diagnostic(
        JSON.stringify({
          history: 20000,
          count: count.meta,
          page: page.meta,
          markOneRead: read.meta,
          duplicateRead: duplicate.meta,
        }),
      )
      assert.equal(
        (await db.prepare(REQUEST_INBOX_COUNTS_SQL).bind("reader").all()).results[0].unread_count,
        19999,
      )
      assert.ok(duplicate.meta.rows_written < read.meta.rows_written)
    } finally {
      local.close()
      await runtime.dispose()
    }
  },
)
