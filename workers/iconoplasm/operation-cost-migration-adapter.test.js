import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
  createFinalizationMigrationCostAdapter,
  FINALIZATION_UNFINISHED_GUARD,
} from "./operation-cost-migration-adapter.js"
import { FINALIZATION_MIGRATION_NAME } from "../generated/operation-cost-migrations.js"

function fixture() {
  const raw = new DatabaseSync(":memory:")
  raw.exec(
    readFileSync(
      new URL("../../migrations-iconoplasm/0028_add_finalization_jobs.sql", import.meta.url),
      "utf8",
    ),
  )
  raw.exec(
    `CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
  )
  raw.exec(`WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<19024)
    INSERT INTO icono_sync_finalization_jobs(gene_symbol,status,completed_at)
    SELECT 'GENE'||n, 'completed', '2026-09-01' FROM ids`)
  let calls = 0
  const db = {
    prepare(sql) {
      return {
        bind(...parameters) {
          return { sql, parameters }
        },
      }
    },
    async batch(statements) {
      calls++
      raw.exec("BEGIN IMMEDIATE")
      try {
        const results = statements.map(({ sql, parameters }) => {
          const statement = raw.prepare(sql)
          const result = statement.columns().length
            ? statement.all(...parameters)
            : statement.run(...parameters)
          // Stub receipts test protocol handling, not Cloudflare billed costs.
          return { success: true, results: result, meta: { rows_read: 1, rows_written: 1 } }
        })
        raw.exec("COMMIT")
        return results
      } catch (error) {
        raw.exec("ROLLBACK")
        throw error
      }
    },
  }
  return {
    raw,
    calls: () => calls,
    adapter: createFinalizationMigrationCostAdapter({
      db,
      executable_sha256: "a".repeat(64),
      schema_sha256: "b".repeat(64),
    }),
  }
}

test("migration prepares without provider access, refuses too-small guards atomically, and records successful DDL with Wrangler", async () => {
  const f = fixture()
  try {
    const refused = await f.adapter.prepare({ max_rows: 19023, max_unfinished: 0 })
    assert.equal(f.calls(), 0)
    await assert.rejects(f.adapter.dispatch(refused), /malformed JSON/)
    assert.equal(
      f.raw
        .prepare(
          "SELECT COUNT(*) AS n FROM sqlite_schema WHERE name='icono_sync_finalization_summary'",
        )
        .get().n,
      0,
    )
    assert.equal(f.raw.prepare("SELECT COUNT(*) AS n FROM d1_migrations").get().n, 0)
    const prepared = await f.adapter.prepare({ max_rows: 19024, max_unfinished: 0 })
    assert.ok(prepared.bound.rows_written < 20000)
    await f.adapter.dispatch(prepared)
    assert.equal(
      f.raw.prepare("SELECT completed_count FROM icono_sync_finalization_summary").get()
        .completed_count,
      19024,
    )
    assert.equal(
      f.raw.prepare("SELECT name FROM d1_migrations").get().name,
      FINALIZATION_MIGRATION_NAME,
    )
  } finally {
    f.raw.close()
  }
})

test("unfinished guard uses capped indexed ranges and rejects before creating migration objects", async () => {
  const f = fixture()
  try {
    f.raw.exec("UPDATE icono_sync_finalization_jobs SET status='queued' WHERE gene_symbol='GENE1'")
    const plans = f.raw.prepare(`EXPLAIN QUERY PLAN ${FINALIZATION_UNFINISHED_GUARD}`).all(1, 1, 0)
    assert.equal(
      plans.filter(({ detail }) =>
        /SEARCH icono_sync_finalization_jobs USING COVERING INDEX/.test(detail),
      ).length,
      2,
    )
    assert.ok(plans.every(({ detail }) => !/SCAN icono_sync_finalization_jobs/.test(detail)))
    await assert.rejects(
      f.adapter.dispatch(await f.adapter.prepare({ max_rows: 19024, max_unfinished: 0 })),
      /malformed JSON/,
    )
    assert.equal(
      f.raw
        .prepare(
          "SELECT COUNT(*) AS n FROM sqlite_schema WHERE name='icono_sync_finalization_summary'",
        )
        .get().n,
      0,
    )
    await f.adapter.dispatch(await f.adapter.prepare({ max_rows: 19024, max_unfinished: 1 }))
    assert.equal(
      f.raw.prepare("SELECT queued_count FROM icono_sync_finalization_summary").get().queued_count,
      1,
    )
  } finally {
    f.raw.close()
  }
})

test("large sparse rowids cannot defeat the capped row-count guard", async () => {
  const f = fixture()
  try {
    f.raw.exec("DELETE FROM icono_sync_finalization_jobs")
    f.raw.exec(
      "INSERT INTO icono_sync_finalization_jobs(rowid,gene_symbol) VALUES(9223372036854775806,'A'),(9223372036854775807,'B')",
    )
    await assert.rejects(
      f.adapter.dispatch(await f.adapter.prepare({ max_rows: 1, max_unfinished: 2 })),
      /malformed JSON/,
    )
  } finally {
    f.raw.close()
  }
})
