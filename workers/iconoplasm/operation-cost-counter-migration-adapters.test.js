import assert from "node:assert/strict"
import test from "node:test"
import { DatabaseSync } from "node:sqlite"
import { readFileSync, readdirSync } from "node:fs"
import { createRequire } from "node:module"
import { createInboxCountersMigrationCostAdapter } from "./operation-cost-counter-migration-adapters.js"
import { createResumableAdminCountsMigrationCostAdapter } from "./operation-cost-admin-seed-adapter.js"

test(
  "counter migrations bound full-schema backfills and roll back oversized sources before DDL",
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
    const schema = new DatabaseSync(":memory:")
    try {
      const root = new URL("../../migrations-iconoplasm/", import.meta.url)
      for (const file of readdirSync(root)
        .filter((name) => name.endsWith(".sql") && Number.parseInt(name, 10) < 95)
        .sort())
        schema.exec(readFileSync(new URL(file, root), "utf8"))
      const db = await runtime.getD1Database("DB")
      const definitions = schema
        .prepare(
          "SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,rowid",
        )
        .all()
      for (let offset = 0; offset < definitions.length; offset += 20)
        await db.batch(definitions.slice(offset, offset + 20).map(({ sql }) => db.prepare(sql)))
      for (const { name } of schema
        .prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all()) {
        for (const row of schema.prepare(`SELECT * FROM "${name}"`).all()) {
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
          "CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL UNIQUE,applied_at TEXT DEFAULT CURRENT_TIMESTAMP)",
        )
        .run()
      await db
        .prepare(
          `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<20000)
      INSERT INTO icono_gene_catalog(gene_symbol,full_name) SELECT 'G'||n,'Gene '||n FROM ids`,
        )
        .run()
      await db
        .prepare(
          "INSERT INTO icono_admin_gene_rollup(gene_symbol,candidate_count) SELECT gene_symbol,1 FROM icono_gene_catalog",
        )
        .run()
      await db
        .prepare(
          `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<50000)
      INSERT INTO icono_portrait_assets(gene_symbol,asset_sha256,r2_key_full,r2_key_thumb) SELECT 'G'||((n-1)%20000+1),printf('%064x',n),'full','thumb' FROM ids`,
        )
        .run()
      await db
        .prepare(
          `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<3000)
      INSERT INTO icono_generation_requests(id,requester_user_id,gene_symbol,fulfilled_asset_sha256,status) SELECT n,'reader','G1',printf('%064x',1),'fulfilled' FROM ids`,
        )
        .run()
      await db
        .prepare(
          `INSERT INTO icono_request_notifications(id,notification_key,request_id,requester_user_id,gene_symbol,fulfilled_asset_sha256,discord_status,fulfillment_publication_id)
      SELECT id,'n-'||id,id,requester_user_id,gene_symbol,fulfilled_asset_sha256,'sent','group-'||id FROM icono_generation_requests`,
        )
        .run()
      const identities = { db, executable_sha256: "a".repeat(64), schema_sha256: "b".repeat(64) }
      const admin = createResumableAdminCountsMigrationCostAdapter({
        ...identities,
        transition: "1",
      })
      let phase = "initialize"
      for (let steps = 0; phase !== "complete"; steps++) {
        assert.ok(steps < 100)
        const prepared = await admin.prepare({ phase })
        const { result, actual } = await admin.dispatch(prepared)
        assert.ok(actual.rows_read <= prepared.bound.rows_read)
        assert.ok(actual.rows_written <= prepared.bound.rows_written)
        phase = result.next_phase
      }
      for (const [label, adapter, args, overflow, marker] of [
        [
          "inbox",
          createInboxCountersMigrationCostAdapter(identities),
          { max_notifications: 3000, max_schema_rows: 512 },
          { max_notifications: 2999 },
          "icono_request_inbox_summary",
        ],
      ]) {
        for (const invalid of [
          null,
          { ...args, caller_sql: "SELECT 1" },
          { ...args, max_schema_rows: -1 },
        ])
          await assert.rejects(adapter.prepare(invalid), /COST_MIGRATION_ARGUMENTS_INVALID/)
        await assert.rejects(
          adapter.dispatch(await adapter.prepare({ ...args, ...overflow })),
          /COST_MIGRATION_ROW_BOUND_EXCEEDED|malformed JSON/,
        )
        assert.equal(
          await db
            .prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE name=?")
            .bind(marker)
            .first("n"),
          0,
        )
        const prepared = await adapter.prepare(args)
        const { actual } = await adapter.dispatch(prepared)
        for (const meter of ["rows_read", "rows_written", "requests"])
          assert.ok(
            actual[meter] <= prepared.bound[meter],
            `${label} ${meter}: ${actual[meter]} > ${prepared.bound[meter]}`,
          )
        t.diagnostic(JSON.stringify({ migration: label, actual, bound: prepared.bound }))
      }
      assert.equal(
        await db
          .prepare("SELECT genes FROM icono_admin_dashboard_summary WHERE summary_key='default'")
          .first("genes"),
        20000,
      )
      assert.equal(
        await db
          .prepare(
            "SELECT ready_count FROM icono_request_inbox_summary WHERE requester_user_id='reader'",
          )
          .first("ready_count"),
        3000,
      )
      assert.equal(await db.prepare("SELECT COUNT(*) AS n FROM d1_migrations").first("n"), 2)
    } finally {
      schema.close()
      await runtime.dispose()
    }
  },
)
