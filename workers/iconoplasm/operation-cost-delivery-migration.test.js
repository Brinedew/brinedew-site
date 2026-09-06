import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync, readdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { createInboxCountersMigrationCostAdapter } from "./operation-cost-counter-migration-adapters.js"

test(
  "joint inbox and delivery migration stays within its shared bound for pending and mixed history",
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
        d1Databases: ["pending", "mixed"],
      }),
    )
    const schema = new DatabaseSync(":memory:")
    try {
      const directory = new URL("../../migrations-iconoplasm/", import.meta.url)
      for (const file of readdirSync(directory)
        .filter((f) => f.endsWith(".sql") && parseInt(f) < 96)
        .sort())
        schema.exec(readFileSync(new URL(file, directory), "utf8"))
      const definitions = schema
        .prepare(
          "SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,rowid",
        )
        .all()
      for (const fixture of ["pending", "mixed"]) {
        const db = await runtime.getD1Database(fixture)
        for (let i = 0; i < definitions.length; i += 20)
          await db.batch(definitions.slice(i, i + 20).map(({ sql }) => db.prepare(sql)))
        await db
          .prepare("CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT NOT NULL UNIQUE)")
          .run()
        await db
          .prepare(
            "INSERT INTO icono_portrait_assets(gene_symbol,asset_sha256,r2_key_full,r2_key_thumb) VALUES ('G1',printf('%064x',1),'full','thumb')",
          )
          .run()
        await db
          .prepare(
            `WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<3000)
        INSERT INTO icono_generation_requests(id,requester_user_id,gene_symbol,status,fulfilled_asset_sha256)
        SELECT i,'reader','G1',CASE WHEN ?='mixed' AND i%2=1 THEN 'fulfilled' ELSE 'delivery_pending' END,printf('%064x',1) FROM n`,
          )
          .bind(fixture)
          .run()
        await db
          .prepare(
            `INSERT INTO icono_request_notifications(notification_key,request_id,requester_user_id,gene_symbol,discord_status,fulfilled_asset_sha256,fulfillment_publication_id,fulfillment_group_size)
        SELECT 'n-'||id,id,'reader','G1',CASE WHEN status='fulfilled' THEN 'sent' ELSE 'pending' END,fulfilled_asset_sha256,
        'group-'||(CASE WHEN ?='mixed' THEN (id+1)/2 ELSE id END),CASE WHEN ?='mixed' THEN 2 ELSE 1 END FROM icono_generation_requests`,
          )
          .bind(fixture, fixture)
          .run()
        const adapter = createInboxCountersMigrationCostAdapter({
          db,
          executable_sha256: "a".repeat(64),
          schema_sha256: "b".repeat(64),
        })
        const prepared = await adapter.prepare({ max_notifications: 3000, max_schema_rows: 512 })
        const { actual } = await adapter.dispatch(prepared)
        assert.ok(actual.rows_read <= prepared.bound.rows_read, JSON.stringify(actual))
        assert.ok(actual.rows_written <= prepared.bound.rows_written, JSON.stringify(actual))
        const groupCount = await db
          .prepare("SELECT COUNT(*) AS n FROM icono_request_delivery_ready_groups")
          .first("n")
        assert.equal(groupCount, fixture === "mixed" ? 1500 : 3000)
        const memberCount = await db
          .prepare("SELECT COUNT(*) AS n FROM icono_request_inbox_members")
          .first("n")
        assert.equal(memberCount, fixture === "mixed" ? 1500 : 0)
        t.diagnostic(JSON.stringify({ fixture, actual, bound: prepared.bound }))
      }
    } finally {
      schema.close()
      await runtime.dispose()
    }
  },
)
