import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { writeSyncFinalizationJobState } from "../iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import { createFinalizationJobVersionMigrationCostAdapter } from "./operation-cost-finalization-job-migration-adapter.js"

const require = createRequire(import.meta.url)
const { Miniflare, convertV4MiniflareOptions } = createRequire(
  require.resolve("wrangler/package.json"),
)("miniflare")
const source = (name) =>
  readFileSync(new URL(`../../migrations-iconoplasm/${name}`, import.meta.url), "utf8")

test(
  "finalization versions fence duplicate claims, stale recovery and a newer enqueue without scanning history",
  { timeout: 120000 },
  async (t) => {
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: "export default {fetch(){return new Response('finalization')}}",
        compatibilityDate: "2026-08-01",
        d1Databases: ["jobs"],
      }),
    )
    const schema = new DatabaseSync(":memory:")
    try {
      schema.exec(source("0028_add_finalization_jobs.sql"))
      schema.exec(source("0094_finalization_summary.sql"))
      schema.exec(source("0099_finalization_queue_indexes.sql"))
      schema.exec(source("0103_finalization_running_index.sql"))
      const db = await runtime.getD1Database("jobs")
      for (const { sql } of schema
        .prepare(
          "SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,rowid",
        )
        .all())
        await db.prepare(sql).run()
      await db.prepare("INSERT INTO icono_sync_finalization_summary VALUES(1,0,0,0,0,0,0)").run()
      await db
        .prepare(
          "CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE)",
        )
        .run()
      await db
        .prepare(
          `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<25000)
      INSERT INTO icono_sync_finalization_jobs(gene_symbol,status,phase) SELECT 'G'||n,'completed','completed' FROM ids`,
        )
        .run()
      await db
        .prepare(
          "INSERT INTO icono_sync_finalization_jobs(gene_symbol,reason) VALUES('TP53','saved output')",
        )
        .run()
      const adapter = createFinalizationJobVersionMigrationCostAdapter({
        db,
        executable_sha256: "a".repeat(64),
        schema_sha256: "b".repeat(64),
      })
      await assert.rejects(adapter.prepare({ max_schema_rows: 512, caller_sql: "SELECT 1" }))
      await assert.rejects(adapter.dispatch(await adapter.prepare({ max_schema_rows: 1 })))
      assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM d1_migrations").first()).n, 0)
      const prepared = await adapter.prepare({ max_schema_rows: 512 })
      const { actual } = await adapter.dispatch(prepared)
      assert.ok(actual.rows_read <= prepared.bound.rows_read, JSON.stringify(actual))
      assert.ok(actual.rows_written <= prepared.bound.rows_written, JSON.stringify(actual))
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
                    receipts.push(result.meta)
                    return result
                  },
                }
              },
            }
          },
        },
      }
      const transition = (expectedVersion, status, phase = "reconcile") =>
        writeSyncFinalizationJobState(env, { symbol: "TP53", expectedVersion, status, phase })
      assert.equal(await transition(1, "running"), true)
      assert.equal(await transition(1, "running"), false, "duplicate delivery cannot claim twice")
      assert.equal(await transition(2, "retrying"), true, "stale recovery takes a new version")
      assert.equal(
        await transition(2, "queued", "vote_summaries"),
        false,
        "expired worker cannot advance",
      )
      assert.equal(await transition(3, "running"), true)
      await db
        .prepare(
          "UPDATE icono_sync_finalization_jobs SET job_version=job_version+1,status='queued',phase='reconcile',reason='newer saved output' WHERE gene_symbol='TP53'",
        )
        .run()
      assert.equal(
        await transition(4, "retrying"),
        false,
        "old failure cannot overwrite new enqueue",
      )
      assert.equal(await transition(4, "queued", "completed_pending_finalize"), false)
      assert.equal(await transition(5, "running"), true)
      assert.equal(await transition(6, "queued", "vote_summaries"), true)
      await assert.rejects(transition(undefined, "running"), /exact job version/)
      const row = await db
        .prepare(
          "SELECT job_version,status,phase,reason FROM icono_sync_finalization_jobs WHERE gene_symbol='TP53'",
        )
        .first()
      assert.deepEqual(row, {
        job_version: 7,
        status: "queued",
        phase: "vote_summaries",
        reason: "newer saved output",
      })
      for (const receipt of receipts) {
        assert.ok(receipt.rows_read <= 16, JSON.stringify(receipt))
        assert.ok(receipt.rows_written <= 8, JSON.stringify(receipt))
      }
      t.diagnostic(
        JSON.stringify({
          migration: actual,
          bound: prepared.bound,
          transitions: receipts.map(({ rows_read, rows_written }) => ({ rows_read, rows_written })),
        }),
      )
    } finally {
      schema.close()
      await runtime.dispose()
    }
  },
)
