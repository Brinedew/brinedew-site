import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import {
  runningFinalizationJobsSql,
  dueFinalizationJobsSql,
  pendingFinalizationWorkSql,
} from "./sync-finalization-selection.js"

const require = createRequire(import.meta.url)
const { Miniflare, convertV4MiniflareOptions } = createRequire(
  require.resolve("wrangler/package.json"),
)("miniflare")
const schema = readFileSync(
  new URL("../../migrations-iconoplasm/0028_add_finalization_jobs.sql", import.meta.url),
  "utf8",
)
const now = "2026-09-09T01:00:00.000Z"
const excluded = "completed_pending_finalize"
const symbols = [
  "VISION",
  "GENE",
  "VOTE",
  "RECONCILE",
  "FUTURE",
  "RUNNING",
  "READY",
  "DONE",
  "MISSING",
]

function queries(scoped = true, selected = symbols) {
  const json = JSON.stringify(scoped ? selected : [])
  const enabled = scoped ? 1 : 0
  return [
    [runningFinalizationJobsSql(scoped), [json, "running", excluded, enabled, 250]],
    [
      dueFinalizationJobsSql(scoped),
      [
        json,
        "queued",
        "retrying",
        excluded,
        now,
        enabled,
        "vision_rollups",
        "gene_rollups",
        "vote_summaries",
        25,
      ],
    ],
    [
      pendingFinalizationWorkSql(scoped),
      [
        "queued",
        "retrying",
        excluded,
        now,
        "queued",
        "retrying",
        excluded,
        now,
        "completed",
        enabled,
        json,
      ],
    ],
  ]
}

const fixture = `INSERT INTO icono_sync_finalization_jobs
  (gene_symbol, status, phase, requested_at, next_attempt_at, last_attempt_at) VALUES
  ('VISION','queued','vision_rollups','2026-09-08', '2026-09-08','2026-09-08'),
  ('GENE','retrying','gene_rollups','2026-09-07', '2026-09-08','2026-09-08'),
  ('VOTE','queued','vote_summaries','2026-09-06', '2026-09-08','2026-09-08'),
  ('RECONCILE','queued','reconcile','2026-09-05', '2026-09-08','2026-09-08'),
  ('FUTURE','retrying','vision_rollups','2026-09-04', '2026-09-10','2026-09-08'),
  ('RUNNING','running','reconcile','2026-09-03', '2026-09-08','2026-09-08'),
  ('READY','queued','completed_pending_finalize','2026-09-02', '2026-09-08','2026-09-08'),
  ('DONE','completed','completed','2026-09-01', '2026-09-08','2026-09-08')`

test("scoped finalization keeps phase order, retry dates and exact counts using unique key probes", () => {
  const db = new DatabaseSync(":memory:")
  try {
    db.exec(schema)
    db.exec(fixture)
    const selected = queries().map(([sql, args]) => {
      const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args)
      assert.ok(
        plan.some(({ detail }) =>
          /SEARCH icono_sync_finalization_jobs.*gene_symbol=\?/.test(detail),
        ),
      )
      assert.ok(plan.every(({ detail }) => !/SCAN icono_sync_finalization_jobs/.test(detail)))
      return db.prepare(sql).all(...args)
    })
    assert.deepEqual(
      selected[0].map((row) => row.gene_symbol),
      ["RUNNING"],
    )
    assert.deepEqual(
      selected[1].map((row) => row.gene_symbol),
      ["VISION", "GENE", "VOTE", "RECONCILE"],
    )
    assert.deepEqual(
      { ...selected[2][0] },
      { remaining: 7, runnable: 4, next_attempt_at: "2026-09-10" },
    )
    // No unscoped semantic changes are smuggled into the scope fix.
    assert.deepEqual(
      queries(false).map(([sql, args]) => db.prepare(sql).all(...args)),
      selected,
    )
    const [emptySql, emptyArgs] = queries(true, ["MISSING"])[2]
    assert.deepEqual(
      { ...db.prepare(emptySql).get(...emptyArgs) },
      { remaining: 0, runnable: null, next_attempt_at: null },
    )
  } finally {
    db.close()
  }
})

test(
  "workerd scoped selection cost stays tied to input beside completed, runnable and future backlogs",
  { timeout: 120000 },
  async (t) => {
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: "export default { fetch() { return new Response('finalization selection') } }",
        compatibilityDate: "2025-11-12",
        d1Databases: ["DB"],
      }),
    )
    try {
      const db = await runtime.getD1Database("DB")
      for (const sql of schema
        .replace(/^--.*$/gm, "")
        .split(";")
        .filter((sql) => sql.trim()))
        await db.prepare(sql).run()
      await db.prepare(fixture).run()
      const measure = async (selected) => {
        const results = []
        for (const [sql, args] of queries(true, selected)) {
          const result = await db
            .prepare(sql)
            .bind(...args)
            .all()
          assert.equal(result.meta.rows_written, 0)
          assert.ok(result.meta.rows_read <= 4 * selected.length + 8, JSON.stringify(result.meta))
          results.push({ rows: result.results, reads: result.meta.rows_read })
        }
        return results
      }
      const before = await measure(symbols)
      await db
        .prepare(
          `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<60000)
      INSERT INTO icono_sync_finalization_jobs(gene_symbol,status,phase,next_attempt_at)
      SELECT 'HISTORY'||n, CASE n%3 WHEN 0 THEN 'completed' WHEN 1 THEN 'running' ELSE 'queued' END,
        CASE n%4 WHEN 0 THEN 'vision_rollups' ELSE 'reconcile' END,
        CASE WHEN n%2=0 THEN '2026-09-08' ELSE '2026-09-10' END FROM ids`,
        )
        .run()
      const after = await measure(symbols)
      assert.deepEqual(after, before)
      const maximum = Array.from({ length: 5000 }, (_, n) => `HISTORY${n + 1}`)
      const maximumResult = await measure(maximum)
      assert.equal(maximumResult[2].rows[0].remaining, 3334)
      t.diagnostic(
        JSON.stringify({
          small: after.map((x) => x.reads),
          maximum: maximumResult.map((x) => x.reads),
          unrelated_rows: 60000,
        }),
      )
    } finally {
      await runtime.dispose()
    }
  },
)
