import assert from "node:assert/strict"
import test from "node:test"
import { DatabaseSync } from "node:sqlite"
import { readFileSync, readdirSync } from "node:fs"
import { createRequire } from "node:module"
import { createResumableAdminCountsMigrationCostAdapter } from "./operation-cost-admin-seed-adapter.js"

test(
  "paged admin seed exceeds 50k assets, resumes after a lost response, and matches the complete canonical seed",
  { timeout: 60000 },
  async () => {
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
    const oracle = new DatabaseSync(":memory:")
    try {
      const root = new URL("../../migrations-iconoplasm/", import.meta.url)
      for (const file of readdirSync(root)
        .filter((name) => name.endsWith(".sql") && parseInt(name, 10) < 95)
        .sort())
        oracle.exec(readFileSync(new URL(file, root), "utf8"))
      const db = await runtime.getD1Database("DB")
      const definitions = oracle
        .prepare(
          "SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,rowid",
        )
        .all()
      for (let i = 0; i < definitions.length; i += 20)
        await db.batch(definitions.slice(i, i + 20).map(({ sql }) => db.prepare(sql)))
      const inputs = [
        "CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE)",
        "WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<2200) INSERT INTO icono_gene_catalog(rowid,gene_symbol,full_name) SELECT x-5000,'G'||x,'Gene '||x FROM n",
        "WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<2400) INSERT INTO icono_admin_gene_rollup(gene_symbol,candidate_count,current_asset_missing,admin_override,stale_count) SELECT 'G'||x,x%8,x%2,x%3=0,x%5 FROM n",
        "INSERT INTO icono_admin_gene_rollup(gene_symbol) VALUES(NULL)",
        "WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<60001) INSERT INTO icono_portrait_assets(gene_symbol,asset_sha256,r2_key_full,r2_key_thumb,is_stale) SELECT 'G'||(x%2500+1),printf('%064x',x),'full','thumb',x%2 FROM n",
      ]
      for (const sql of inputs) {
        oracle.exec(sql)
        await db.prepare(sql).run()
      }
      oracle.exec(readFileSync(new URL("0095_transactional_admin_counts.sql", root), "utf8"))
      const create = () =>
        createResumableAdminCountsMigrationCostAdapter({
          db,
          transition: "1",
          executable_sha256: "a".repeat(64),
          schema_sha256: "b".repeat(64),
        })
      await assert.rejects(
        createResumableAdminCountsMigrationCostAdapter({ db }).prepare({ phase: "initialize" }),
        /REQUIRES_QUIESCENCE/,
      )
      let phase = "initialize",
        steps = 0,
        reads = 0,
        writes = 0,
        lost = false
      while (phase !== "complete") {
        assert.ok(++steps < 100)
        const adapter = create(),
          prepared = await adapter.prepare({ phase })
        const result = await adapter.dispatch(prepared)
        assert.ok(
          result.actual.rows_read <= prepared.bound.rows_read,
          `${phase}: ${result.actual.rows_read} > ${prepared.bound.rows_read}`,
        )
        assert.ok(result.actual.rows_written <= prepared.bound.rows_written, `${phase} writes`)
        reads += result.actual.rows_read
        writes += result.actual.rows_written
        if (phase === "initialize") {
          await assert.rejects(
            db
              .prepare(
                "UPDATE icono_admin_gene_rollup SET candidate_count=0 WHERE gene_symbol='G1'",
              )
              .run(),
            /COST_ADMIN_SEED_IN_PROGRESS/,
          )
          await assert.rejects(
            db.prepare("DELETE FROM icono_portrait_assets WHERE rowid=1").run(),
            /COST_ADMIN_SEED_IN_PROGRESS/,
          )
        }
        if (phase === "assets" && !lost) {
          lost = true
          // Discard this response exactly as a network interruption would. The
          // next process discovers the committed phase without resetting totals.
          phase = "initialize"
          assert.equal(await db.prepare("SELECT COUNT(*) AS n FROM d1_migrations").first("n"), 0)
        } else phase = result.result.next_phase
      }
      for (const table of ["icono_admin_dashboard_summary", "icono_admin_gallery_count_cache"]) {
        const normalize = (rows) =>
          rows
            .map(({ updated_at, ...row }) => row)
            .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
        assert.deepEqual(
          normalize((await db.prepare(`SELECT * FROM ${table}`).all()).results),
          normalize(oracle.prepare(`SELECT * FROM ${table}`).all()),
        )
      }
      assert.equal(await db.prepare("SELECT COUNT(*) AS n FROM d1_migrations").first("n"), 1)
      assert.equal(
        await db
          .prepare(
            "SELECT COUNT(*) AS n FROM sqlite_schema WHERE name LIKE 'trg_icono_admin_counts_%'",
          )
          .first("n"),
        9,
      )
      assert.ok(reads < 300000, `total reads ${reads}`)
      assert.equal(
        await db
          .prepare(
            "SELECT COUNT(*) AS n FROM sqlite_schema WHERE name LIKE 'trg_icono_admin_seed_freeze_%' OR name='icono_admin_counts_seed_progress'",
          )
          .first("n"),
        0,
      )
      const completed = create()
      await assert.rejects(
        completed.dispatch(await completed.prepare({ phase: "initialize" })),
        /COST_MIGRATION_ALREADY_APPLIED|malformed JSON/,
      )
      await db
        .prepare("UPDATE icono_admin_gene_rollup SET candidate_count=0 WHERE gene_symbol='G1'")
        .run()
      assert.ok(writes < 500, `total writes ${writes}`)
      console.log(JSON.stringify({ steps, reads, writes }))
    } finally {
      oracle.close()
      await runtime.dispose()
    }
  },
)
