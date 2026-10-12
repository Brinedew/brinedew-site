import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { createOperationCostD1Adapter } from "./operation-cost-d1-adapter.js"
import { createOperationCostD1Meter } from "./operation-cost-d1-meter.js"
import { createOperationCostQueryRegistry } from "./operation-cost-query-registry.js"

const require = createRequire(import.meta.url)
const { Miniflare, convertV4MiniflareOptions } = createRequire(
  require.resolve("wrangler/package.json"),
)("miniflare")
const identities = { executable_sha256: "a".repeat(64), schema_sha256: "b".repeat(64) }

test(
  "local workerd D1 receipts fit the finalization-summary reservations at catalogue scale",
  { timeout: 120000 },
  async (t) => {
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: "export default {fetch(){return new Response('local cost verification')}}",
        compatibilityDate: "2025-11-12",
        d1Databases: ["DB"],
      }),
    )
    try {
      const db = await runtime.getD1Database("DB")
      const finalizationSchema = new DatabaseSync(":memory:")
      try {
        for (const file of ["0028_add_finalization_jobs.sql", "0094_finalization_summary.sql"])
          finalizationSchema.exec(
            readFileSync(new URL(`../../migrations-iconoplasm/${file}`, import.meta.url), "utf8"),
          )
        for (const { sql } of finalizationSchema
          .prepare(
            "SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, rowid",
          )
          .all())
          await db.prepare(sql).run()
      } finally {
        finalizationSchema.close()
      }
      await db.prepare("INSERT INTO icono_sync_finalization_summary VALUES(1,0,0,0,0,0,0)").run()
      await db
        .prepare(
          `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<19024)
      INSERT INTO icono_sync_finalization_jobs(gene_symbol,status,completed_at)
      SELECT 'GENE'||n, 'completed', '2026-09-01' FROM ids`,
        )
        .run()
      const reader = createOperationCostD1Adapter({
        db,
        registry: createOperationCostQueryRegistry(),
        resource: "iconoplasm",
        ...identities,
      })
      for (const statement of [
        { query_id: "finalization-summary", arguments: {} },
        {
          query_id: "finalization-summary-for-symbols",
          arguments: { symbols: ["GENE19024", "MISSING"] },
        },
      ]) {
        const prepared = await reader.prepare({ statements: [statement] })
        const receipt = await reader.dispatch(prepared)
        assert.ok(receipt.actual.rows_read <= prepared.bound.rows_read)
        t.diagnostic(
          JSON.stringify({
            operation: statement.query_id,
            bound: prepared.bound,
            actual: receipt.actual,
          }),
        )
      }
    } finally {
      await runtime.dispose()
    }
  },
)
