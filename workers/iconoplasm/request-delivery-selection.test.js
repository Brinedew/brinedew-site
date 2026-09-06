import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync, readdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { readReadyDeliveryLeaders, claimReadyDeliveryGroup } from "./request-delivery-selection.js"
import {
  deliverPendingRequestFulfillmentNotifications,
  ICONOPLASM_FULFILLMENT_DM_TEST_RECIPIENT_ID,
} from "../iconoplasm-request-notifications.js"

function fullSchema() {
  const db = new DatabaseSync(":memory:")
  const directory = new URL("../../migrations-iconoplasm/", import.meta.url)
  for (const file of readdirSync(directory)
    .filter((f) => f.endsWith(".sql"))
    .sort())
    db.exec(readFileSync(new URL(file, directory), "utf8"))
  return db
}

test("delivery readiness follows membership, leader changes, retry and rollback without terminal history", () => {
  const db = fullSchema()
  const insert =
    db.prepare(`INSERT INTO icono_request_notifications(id,notification_key,request_id,requester_user_id,gene_symbol,discord_status,fulfillment_publication_id,fulfillment_group_size,created_at)
    VALUES (?,'n-'||?,?,'reader','G1',?,?,?,'2026-01-01')`)
  const add = (id, status = "pending", publication = "group", size = 3) =>
    insert.run(id, id, id, status, publication, size)
  const check = () => {
    const groups = new Map()
    for (const row of db.prepare("SELECT * FROM icono_request_notifications ORDER BY id").all()) {
      if (!row.fulfillment_publication_id) continue
      const key = JSON.stringify([
        row.requester_user_id,
        row.fulfillment_publication_id,
        row.gene_symbol,
      ])
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(row)
    }
    const expected = []
    for (const rows of groups.values()) {
      const eligibleTest = rows.filter((r) =>
        ["pending", "retry"].includes(r.discord_status),
      ).length
      const eligibleAll = rows.filter((r) =>
        ["pending", "retry", "suppressed_not_test_recipient"].includes(r.discord_status),
      ).length
      if (!eligibleAll) continue
      const first = rows[0]
      expected.push({
        requester_user_id: first.requester_user_id,
        fulfillment_publication_id: first.fulfillment_publication_id,
        gene_symbol: first.gene_symbol,
        leader_id: first.id,
        expected_count: first.fulfillment_group_size,
        due_at: first.discord_next_attempt_at || first.created_at,
        created_at: first.created_at,
        member_count: rows.length,
        eligible_test: eligibleTest,
        eligible_all: eligibleAll,
        overflowed: 0,
        ready_mode:
          rows.length === first.fulfillment_group_size
            ? eligibleTest === rows.length
              ? 2
              : eligibleAll === rows.length
                ? 1
                : 0
            : 0,
      })
    }
    const sort = (rows) =>
      rows.sort((a, b) =>
        JSON.stringify([
          a.requester_user_id,
          a.fulfillment_publication_id,
          a.gene_symbol,
        ]).localeCompare(
          JSON.stringify([b.requester_user_id, b.fulfillment_publication_id, b.gene_symbol]),
        ),
      )
    assert.deepEqual(
      sort(db.prepare("SELECT * FROM icono_request_delivery_ready_groups").all()).map((r) => ({
        ...r,
      })),
      sort(expected),
    )
  }
  try {
    add(2)
    check()
    add(3, "retry")
    check()
    add(1)
    check()
    db.exec(
      "UPDATE icono_request_notifications SET discord_status='suppressed_not_test_recipient' WHERE id=2",
    )
    check()
    db.exec(
      "UPDATE icono_request_notifications SET discord_next_attempt_at='2099-01-01' WHERE id=1",
    )
    check()
    db.exec(
      "UPDATE icono_request_notifications SET fulfillment_publication_id='other',fulfillment_group_size=1 WHERE id=1",
    )
    check()
    db.exec("UPDATE icono_request_notifications SET fulfillment_group_size=2 WHERE id IN (2,3)")
    check()
    db.exec("DELETE FROM icono_request_notifications WHERE id=2")
    check()
    db.exec("UPDATE icono_request_notifications SET discord_status='sent'")
    check()
    // A previously terminal group is reconstructed only when it becomes eligible.
    db.exec("UPDATE icono_request_notifications SET discord_status='retry' WHERE id=3")
    check()
    db.exec("UPDATE icono_request_notifications SET id=4,fulfillment_publication_id='' WHERE id=3")
    check()
    db.exec(
      "BEGIN; UPDATE icono_request_notifications SET fulfillment_publication_id='other',discord_status='pending' WHERE id=4; ROLLBACK",
    )
    check()
    db.exec("DELETE FROM icono_request_notifications")
    check()
  } finally {
    db.close()
  }
})

test(
  "real D1 selects from a 20000-group backlog and claims 500 requests below the parameter limit",
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
    const schema = fullSchema()
    const originalFetch = globalThis.fetch
    try {
      const db = await runtime.getD1Database("DB")
      const definitions = schema
        .prepare(
          "SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,rowid",
        )
        .all()
      for (let i = 0; i < definitions.length; i += 20)
        await db.batch(definitions.slice(i, i + 20).map(({ sql }) => db.prepare(sql)))
      await db
        .prepare(
          `WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<20000)
      INSERT INTO icono_request_notifications(id,notification_key,request_id,requester_user_id,gene_symbol,discord_status,fulfillment_publication_id,fulfillment_group_size)
      SELECT i,'n-'||i,i,'reader','G1','pending','group-'||i,1 FROM n`,
        )
        .run()
      let receipts = []
      const capture = (r) => {
        receipts.push(r.meta)
        return r
      }
      const measured = {
        prepare(sql) {
          const wrap = (s) => ({
            bind(...args) {
              assert.ok(args.length <= 100, `D1 parameter limit: ${args.length}`)
              return wrap(s.bind(...args))
            },
            all: async () => capture(await s.all()),
            run: async () => capture(await s.run()),
          })
          return wrap(db.prepare(sql))
        },
      }
      const read = async (ids = [], allRequesters = false) => {
        receipts = []
        const rows = await readReadyDeliveryLeaders(measured, {
          requestIds: ids,
          allRequesters,
          limit: 1,
        })
        const reads = receipts.reduce((n, r) => n + r.rows_read, 0)
        assert.ok(reads <= 400, `ready selector scanned ${reads} rows`)
        t.diagnostic(
          `selector ${JSON.stringify({ scope: ids.length, allRequesters, reads, selected: rows.length })}`,
        )
        return rows
      }
      assert.equal((await read()).length, 1)
      assert.equal((await read([20000]))[0].id, 20000)
      assert.equal((await read(Array.from({ length: 50 }, (_, i) => 19951 + i))).length, 1)
      assert.equal((await read([], true)).length, 1)
      await db
        .prepare("UPDATE icono_request_notifications SET discord_next_attempt_at='2099-01-01'")
        .run()
      assert.equal((await read()).length, 0)
      assert.equal((await read([], true)).length, 0)
      // A group that is too large stays ineligible; reconstruction never scans
      // its 20,000 terminal members beyond the 501-row structural sentinel.
      await db
        .prepare(
          `WITH RECURSIVE n(i) AS (VALUES(30001) UNION ALL SELECT i+1 FROM n WHERE i<50000)
      INSERT INTO icono_request_notifications(id,notification_key,request_id,requester_user_id,gene_symbol,discord_status,fulfillment_publication_id,fulfillment_group_size)
      SELECT i,'n-'||i,i,'reader','G1','failed','oversized',500 FROM n`,
        )
        .run()
      const reconstruction = await db
        .prepare("UPDATE icono_request_notifications SET discord_status='pending' WHERE id=30001")
        .run()
      assert.ok(reconstruction.meta.rows_read < 5000, JSON.stringify(reconstruction.meta))
      assert.equal(
        (
          await db
            .prepare(
              "SELECT ready_mode FROM icono_request_delivery_ready_groups WHERE fulfillment_publication_id='oversized'",
            )
            .first()
        ).ready_mode,
        0,
      )
      t.diagnostic(`oversized reconstruction ${JSON.stringify(reconstruction.meta)}`)
      const recipient = ICONOPLASM_FULFILLMENT_DM_TEST_RECIPIENT_ID
      await db
        .prepare(
          `WITH RECURSIVE n(i) AS (VALUES(60001) UNION ALL SELECT i+1 FROM n WHERE i<60500)
      INSERT INTO icono_request_notifications(id,notification_key,request_id,requester_user_id,gene_symbol,discord_status,fulfillment_publication_id,fulfillment_group_size,fulfilled_asset_sha256)
      SELECT i,'n-'||i,i,?,'G1','pending','batch-500',500,printf('%064x',1) FROM n`,
        )
        .bind(recipient)
        .run()
      const leader = (await read([60001]))[0]
      const notificationIds = Array.from({ length: 500 }, (_, i) => 60001 + i)
      // A stale partial claim cannot move even one member to sending.
      assert.equal(
        await claimReadyDeliveryGroup(measured, {
          notificationIds: [60001, 999999],
          leader,
          allRequesters: false,
        }),
        false,
      )
      assert.equal(
        await claimReadyDeliveryGroup(measured, {
          notificationIds: [60001, 60002],
          leader,
          allRequesters: false,
        }),
        false,
      )
      assert.equal(
        (
          await db
            .prepare("SELECT discord_status FROM icono_request_notifications WHERE id=60001")
            .first()
        ).discord_status,
        "pending",
      )
      await db
        .prepare(
          "CREATE TRIGGER test_fail_claim BEFORE UPDATE ON icono_request_notifications WHEN NEW.id=60300 AND NEW.discord_status='sending' BEGIN SELECT RAISE(ABORT,'claim_rollback'); END",
        )
        .run()
      await assert.rejects(
        claimReadyDeliveryGroup(measured, { notificationIds, leader, allRequesters: false }),
        /claim_rollback/,
      )
      assert.equal(
        (
          await db
            .prepare(
              "SELECT COUNT(*) AS n FROM icono_request_notifications WHERE fulfillment_publication_id='batch-500' AND discord_status='pending'",
            )
            .first()
        ).n,
        500,
      )
      await db.prepare("DROP TRIGGER test_fail_claim").run()
      const claims = await Promise.all(
        [1, 2].map(() =>
          claimReadyDeliveryGroup(measured, { notificationIds, leader, allRequesters: false }),
        ),
      )
      assert.deepEqual(claims.sort(), [false, true])
      await db
        .prepare(
          "UPDATE icono_request_notifications SET discord_status='pending' WHERE fulfillment_publication_id='batch-500'",
        )
        .run()
      let messages = 0,
        portraits = 0,
        channels = 0
      globalThis.fetch = async (url, init) => {
        const value = String(url)
        if (value.startsWith("http://127.0.0.1:") || value.startsWith("http://localhost:"))
          return originalFetch(url, init)
        if (value.startsWith("https://storage.bunnycdn.com/")) {
          portraits++
          return new Response(
            new Uint8Array([82, 73, 70, 70, 8, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 32]),
            { headers: { "Content-Type": "image/webp" } },
          )
        }
        if (value === "https://discord.com/api/v10/users/@me/channels") {
          channels++
          return Response.json({ id: "local-channel" })
        }
        assert.equal(value, "https://discord.com/api/v10/channels/local-channel/messages")
        assert.equal(JSON.parse(init.body.get("payload_json")).attachments.length, 10)
        messages++
        return Response.json({ id: "local-message" })
      }
      receipts = []
      const result = await deliverPendingRequestFulfillmentNotifications(
        {
          ICONOPLASM_DB: measured,
          DISCORD_BOT_TOKEN: "test-only",
          ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_HOST: "storage.bunnycdn.com",
          ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_ZONE: "iconoplasm-portraits",
          ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD: "test-only",
        },
        { requestIds: [60001] },
      )
      assert.equal(result.delivered, 1)
      assert.equal(result.delivered_requests, 500)
      assert.deepEqual(result.delivered_request_ids, notificationIds)
      assert.deepEqual(
        { messages, portraits, channels },
        { messages: 1, portraits: 10, channels: 1 },
      )
      const cost = receipts.reduce(
        (n, r) => ({ reads: n.reads + r.rows_read, writes: n.writes + r.rows_written }),
        { reads: 0, writes: 0 },
      )
      assert.ok(cost.reads < 20000, JSON.stringify(cost))
      assert.ok(cost.writes < 12000, JSON.stringify(cost))
      t.diagnostic(`500-request delivery ${JSON.stringify(cost)}`)
      assert.equal(
        (
          await db
            .prepare(
              "SELECT COUNT(*) AS n FROM icono_request_notifications WHERE fulfillment_publication_id='batch-500' AND discord_status='sent'",
            )
            .first()
        ).n,
        500,
      )
      assert.equal((await read([60001])).length, 0)
      await db
        .prepare(
          "INSERT INTO icono_request_notifications(id,notification_key,request_id,requester_user_id,gene_symbol,discord_status,fulfillment_publication_id,fulfillment_group_size,created_at,discord_next_attempt_at) VALUES (61001,'n-61001',61001,'reader','G1','retry','older-retry',1,'2020-01-01','2020-01-02'),(61002,'n-61002',61002,'reader','G1','pending','newer-pending',1,'2020-01-03',NULL)",
        )
        .run()
      assert.equal((await read())[0].id, 61001)
    } finally {
      globalThis.fetch = originalFetch
      schema.close()
      await runtime.dispose()
    }
  },
)
