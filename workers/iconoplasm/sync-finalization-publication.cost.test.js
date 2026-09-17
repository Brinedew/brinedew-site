import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import {
  FINALIZATION_COMPLETION_PAGE_SIZE,
  SCOPED_READY_FINALIZATION_SQL,
  drainCompletedFinalization,
} from "./sync-finalization-publication.js"
import { createFinalizationPublicationMigrationCostAdapter } from "./operation-cost-finalization-publication-migration-adapter.js"

const require = createRequire(import.meta.url)
const { Miniflare, convertV4MiniflareOptions } = createRequire(
  require.resolve("wrangler/package.json"),
)("miniflare")
const source = (name) =>
  readFileSync(new URL(`../../migrations-iconoplasm/${name}`, import.meta.url), "utf8")
const now = "2026-09-09T03:00:00.000Z"

function installFinalizationSchema(sqlite, { handoff = true } = {}) {
  for (const file of [
    "0028_add_finalization_jobs.sql",
    "0094_finalization_summary.sql",
    "0099_finalization_queue_indexes.sql",
    "0100_finalization_job_version.sql",
    "0103_finalization_running_index.sql",
  ])
    sqlite.exec(source(file))
  if (handoff) sqlite.exec(source("0101_finalization_publication_barrier.sql"))
}

test(
  "scoped completion remains bounded beside large unrelated history",
  { timeout: 120000 },
  async (t) => {
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: "export default {fetch(){return new Response('handoff')}}",
        compatibilityDate: "2026-08-01",
        d1Databases: ["jobs"],
      }),
    )
    const schema = new DatabaseSync(":memory:")
    try {
      installFinalizationSchema(schema, { handoff: false })
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
          `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<60000)
       INSERT INTO icono_sync_finalization_jobs(gene_symbol,status,phase)
       SELECT 'H'||n,'completed','completed' FROM ids`,
        )
        .run()
      const scope = Array.from({ length: 5000 }, (_, index) => `T${index + 1}`)
      await db
        .prepare(
          `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<5000)
       INSERT INTO icono_sync_finalization_jobs(gene_symbol,status,phase)
       SELECT 'T'||n,'queued','completed' FROM ids`,
        )
        .run()

      const adapter = createFinalizationPublicationMigrationCostAdapter({
        db,
        executable_sha256: "a".repeat(64),
        schema_sha256: "b".repeat(64),
      })
      await assert.rejects(
        adapter.dispatch(await adapter.prepare({ max_terminal: 4999, max_schema_rows: 512 })),
      )
      assert.equal(
        (
          await db
            .prepare(
              "SELECT COUNT(*) AS n FROM sqlite_schema WHERE name='icono_sync_finalization_publication'",
            )
            .first()
        ).n,
        0,
        "a refused migration must not install the handoff table",
      )
      const prepared = await adapter.prepare({ max_terminal: 5000, max_schema_rows: 512 })
      const migration = await adapter.dispatch(prepared)
      assert.ok(migration.actual.rows_read <= prepared.bound.rows_read, JSON.stringify(migration))
      assert.ok(
        migration.actual.rows_written <= prepared.bound.rows_written,
        JSON.stringify(migration),
      )

      const selected = await db
        .prepare(SCOPED_READY_FINALIZATION_SQL)
        .bind(JSON.stringify(scope))
        .all()
      assert.equal(selected.results.length, FINALIZATION_COMPLETION_PAGE_SIZE)
      assert.ok(selected.meta.rows_read <= 20000, JSON.stringify(selected.meta))

      let total = 0
      let handoffs = 0
      for (
        let page = 0;
        page < Math.ceil(scope.length / FINALIZATION_COMPLETION_PAGE_SIZE);
        page++
      ) {
        const result = await drainCompletedFinalization(db, {
          symbols: scope,
          now,
          notifyPublisher: async ({ symbols }) => {
            handoffs += 1
            assert.ok(symbols.length <= FINALIZATION_COMPLETION_PAGE_SIZE)
            return { accepted: true }
          },
        })
        total += result.finalized
      }
      assert.equal(total, 5000)
      assert.equal(handoffs, Math.ceil(5000 / FINALIZATION_COMPLETION_PAGE_SIZE))
      assert.equal(
        (
          await db
            .prepare(
              "SELECT COUNT(*) AS n FROM icono_sync_finalization_jobs WHERE gene_symbol LIKE 'H%' AND status='completed'",
            )
            .first()
        ).n,
        60000,
        "unrelated history remains untouched",
      )
      t.diagnostic(
        JSON.stringify({
          migration: migration.actual,
          selected_rows_read: selected.meta.rows_read,
        }),
      )
    } finally {
      schema.close()
      await runtime.dispose()
    }
  },
)
