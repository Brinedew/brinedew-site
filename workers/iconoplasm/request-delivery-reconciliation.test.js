import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync, readdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { reconcileDeliveryBacklog } from "./request-delivery-reconciliation.js"
import { createDeliveryCursorMigrationCostAdapter } from "./operation-cost-counter-migration-adapters.js"
import { reconcileDeliveredRequestFulfillments } from "../iconoplasm-request-notifications.js"

test(
  "real D1 reconciliation bounds scans, advances past unsent rows and commits its checkpoint atomically",
  { timeout: 60000 },
  async (t) => {
    const require = createRequire(import.meta.url)
    const { Miniflare, convertV4MiniflareOptions } = createRequire(
      require.resolve("wrangler/package.json"),
    )("miniflare")
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: "export default {fetch(){return new Response('test')}}",
        compatibilityDate: "2026-08-01",
        d1Databases: ["DB"],
      }),
    )
    const schema = new DatabaseSync(":memory:")
    try {
      const db = await runtime.getD1Database("DB")
      const directory = new URL("../../migrations-iconoplasm/", import.meta.url)
      for (const file of readdirSync(directory)
        .filter((n) => n.endsWith(".sql") && parseInt(n) < 97)
        .sort())
        schema.exec(readFileSync(new URL(file, directory), "utf8"))
      const definitions = schema
        .prepare(
          "SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,rowid",
        )
        .all()
      for (let i = 0; i < definitions.length; i += 20)
        await db.batch(definitions.slice(i, i + 20).map(({ sql }) => db.prepare(sql)))
      for (const { name } of schema
        .prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all())
        for (const row of schema.prepare(`SELECT * FROM "${name}"`).all()) {
          const columns = Object.keys(row)
          await db
            .prepare(
              `INSERT INTO "${name}" (${columns.map((c) => `"${c}"`).join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
            )
            .bind(...Object.values(row))
            .run()
        }
      await db
        .prepare("CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL)")
        .run()
      const adapter = createDeliveryCursorMigrationCostAdapter({
        db,
        executable_sha256: "a".repeat(64),
        schema_sha256: "b".repeat(64),
      })
      await assert.rejects(
        adapter.dispatch(await adapter.prepare({ max_schema_rows: 1 })),
        /malformed JSON/,
      )
      assert.equal(
        await db
          .prepare(
            "SELECT name FROM sqlite_schema WHERE name='icono_delivery_reconciliation_cursor'",
          )
          .first(),
        null,
      )
      const prepared = await adapter.prepare({ max_schema_rows: 512 })
      const migrated = await adapter.dispatch(prepared)
      assert.ok(migrated.actual.rows_read <= prepared.bound.rows_read)
      assert.ok(migrated.actual.rows_written <= prepared.bound.rows_written)
      t.diagnostic(`cursor migration ${JSON.stringify(migrated.actual)}`)
      await db
        .prepare(
          "INSERT INTO icono_portrait_assets(gene_symbol,asset_sha256,r2_key_full,r2_key_thumb) VALUES ('G1',printf('%064x',1),'full','thumb')",
        )
        .run()
      await db
        .prepare(
          `WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<20000)
      INSERT INTO icono_generation_requests(id,gene_symbol,requester_user_id,status,created_at,fulfilled_asset_sha256)
      SELECT i,'G1','reader','delivery_pending','2026-01-01',printf('%064x',1) FROM n`,
        )
        .run()
      await db
        .prepare(
          `INSERT INTO icono_request_notifications(notification_key,request_id,requester_user_id,gene_symbol,discord_status,fulfilled_asset_sha256,fulfillment_publication_id)
      SELECT 'n-'||id,id,'reader',gene_symbol,'sent',fulfilled_asset_sha256,'group-'||id FROM icono_generation_requests WHERE id BETWEEN 101 AND 150`,
        )
        .run()
      const receipts = []
      const capture = (result) => {
        receipts.push(result.meta)
        return result
      }
      const measured = {
        prepare(sql) {
          const wrap = (statement) => ({
            bind: (...args) => wrap(statement.bind(...args)),
            first: async () => {
              const r = capture(await statement.all())
              return r.results[0] || null
            },
            all: async () => capture(await statement.all()),
            rawStatement: statement,
          })
          return wrap(db.prepare(sql))
        },
        batch: async (statements) =>
          (await db.batch(statements.map((s) => s.rawStatement))).map(capture),
      }
      const run = async () => {
        receipts.length = 0
        const result = await reconcileDeliveryBacklog(measured)
        const cost = receipts.reduce(
          (sum, m) => ({ reads: sum.reads + m.rows_read, writes: sum.writes + m.rows_written }),
          { reads: 0, writes: 0 },
        )
        assert.ok(cost.reads < 5000, JSON.stringify(cost))
        assert.ok(cost.writes < 2000, JSON.stringify(cost))
        assert.ok(result.considered <= 50)
        t.diagnostic(`reconciliation ${JSON.stringify({ result, cost })}`)
        return result
      }
      assert.equal((await run()).finalized, 0)
      assert.equal((await run()).finalized, 0)
      // A failed checkpoint write must also roll back the 50 completions.
      await db
        .prepare(
          `CREATE TRIGGER fail_checkpoint BEFORE UPDATE ON icono_delivery_reconciliation_cursor BEGIN SELECT RAISE(ABORT,'test_checkpoint_failure'); END`,
        )
        .run()
      await assert.rejects(run(), /test_checkpoint_failure/)
      assert.equal(
        (await db.prepare("SELECT status FROM icono_generation_requests WHERE id=101").first())
          .status,
        "delivery_pending",
      )
      assert.equal(
        (await db.prepare("SELECT request_id FROM icono_delivery_reconciliation_cursor").first())
          .request_id,
        100,
      )
      await db.prepare("DROP TRIGGER fail_checkpoint").run()
      assert.equal((await run()).finalized, 50)
      receipts.length = 0
      const replay = await reconcileDeliveredRequestFulfillments(
        { ICONOPLASM_DB: measured },
        { requestIds: [101, 151] },
      )
      assert.equal(replay.finalized, 0)
      assert.deepEqual(replay.pending_request_ids, [151])
      assert.ok(receipts.reduce((sum, m) => sum + m.rows_read, 0) < 100)
      // Seek near the end of 20,000 pending rows: no OFFSET or growing scan.
      await db
        .prepare(
          "UPDATE icono_delivery_reconciliation_cursor SET created_at='2026-01-01',request_id=19975",
        )
        .run()
      assert.equal((await run()).considered, 25)
      assert.equal(
        (await db.prepare("SELECT request_id FROM icono_delivery_reconciliation_cursor").first())
          .request_id,
        0,
      )
      const overlap = await Promise.all([run(), run()])
      assert.ok(overlap.every((r) => r.finalized === 0))
      const cursor = await db
        .prepare("SELECT request_id FROM icono_delivery_reconciliation_cursor")
        .first()
      assert.ok(cursor.request_id === 50 || cursor.request_id === 100)
    } finally {
      schema.close()
      await runtime.dispose()
    }
  },
)
