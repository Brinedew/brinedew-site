import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { createRequire } from "node:module"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { writeSyncFinalizationJobState } from "../iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

const require = createRequire(import.meta.url)
const { Miniflare, convertV4MiniflareOptions } = createRequire(
  require.resolve("wrangler/package.json"),
)("miniflare")
const migrations = new URL("../../migrations-iconoplasm/", import.meta.url)

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
      for (const file of readdirSync(migrations)
        .filter((name) => name.endsWith(".sql"))
        .sort())
        schema.exec(readFileSync(new URL(file, migrations), "utf8"))
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
          `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<25000)
      INSERT INTO icono_sync_finalization_jobs(gene_symbol,status,phase) SELECT 'G'||n,'completed','completed' FROM ids`,
        )
        .run()
      await db
        .prepare(
          "INSERT INTO icono_sync_finalization_jobs(gene_symbol,reason) VALUES('TP53','saved output')",
        )
        .run()
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
          transitions: receipts.map(({ rows_read, rows_written }) => ({ rows_read, rows_written })),
        }),
      )
    } finally {
      schema.close()
      await runtime.dispose()
    }
  },
)
