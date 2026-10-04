import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync, readdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { rebuildVisionRollupsBatch } from "../iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import { createOperationCostD1Meter } from "./operation-cost-d1-meter.js"

test(
  "vision rollups avoid the asset/blacklist cross product through the normalized tag index",
  { timeout: 120000 },
  async (t) => {
    const require = createRequire(import.meta.url)
    const { Miniflare, convertV4MiniflareOptions } = createRequire(
      require.resolve("wrangler/package.json"),
    )("miniflare")
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: "export default {fetch(){return new Response('cost')}}",
        compatibilityDate: "2026-08-01",
        d1Databases: ["DB"],
      }),
    )
    const schema = new DatabaseSync(":memory:")
    try {
      const directory = new URL("../../migrations-iconoplasm/", import.meta.url)
      for (const file of readdirSync(directory)
        .filter((n) => n.endsWith(".sql"))
        .sort())
        schema.exec(readFileSync(new URL(file, directory), "utf8"))
      const db = await runtime.getD1Database("DB")
      const definitions = schema
        .prepare(
          "SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,rowid",
        )
        .all()
      for (let i = 0; i < definitions.length; i += 20)
        await db.batch(definitions.slice(i, i + 20).map(({ sql }) => db.prepare(sql)))
      await db
        .prepare(
          "WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<5000) INSERT INTO icono_artist_style_blacklist(artist_tag,reason) SELECT 'tag'||n,'reason'||n FROM ids",
        )
        .run()
      await db
        .prepare(
          "WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<10000) INSERT INTO icono_portrait_assets(gene_symbol,asset_sha256,r2_key_full,r2_key_thumb,status,vision_id,emulsion_id,artist_tag) SELECT 'G'||n,printf('%064x',n),'full','thumb',CASE WHEN n%2=0 THEN 'rejected' ELSE 'approved' END,'anima-v1-1','A1-1','TaG1' FROM ids",
        )
        .run()
      for (let pass = 0; pass < 2; pass++) {
        const meter = createOperationCostD1Meter(db)
        await rebuildVisionRollupsBatch({ ICONOPLASM_DB: meter.db }, ["anima-v1-1"])
        const cost = meter.finish()
        // The cross product this guards against would read about 50M rows.
        // 40,000 of the bound is the picker rollup's per-gene example ranking
        // (4 rows per selected portrait, B-896).
        assert.ok(cost.rows_read < 290000, JSON.stringify(cost))
        assert.ok(cost.rows_written < 30, JSON.stringify(cost))
        const row = await db
          .prepare(
            "SELECT image_count,rejected_count,blacklisted,blacklist_reason FROM icono_admin_vision_rollup WHERE vision_id='anima-v1-1'",
          )
          .first()
        assert.deepEqual(row, {
          image_count: 10000,
          rejected_count: 5000,
          blacklisted: 1,
          blacklist_reason: "reason1",
        })
        t.diagnostic(JSON.stringify({ pass, cost }))
      }
      const plan = (
        await db
          .prepare(
            "EXPLAIN QUERY PLAN SELECT pa.asset_sha256 FROM icono_portrait_assets pa LEFT JOIN icono_artist_style_blacklist bl INDEXED BY idx_icono_artist_blacklist_normalized_tag ON lower(COALESCE(bl.artist_tag,''))=lower(COALESCE(pa.artist_tag,'')) WHERE pa.vision_id=?",
          )
          .bind("anima-v1-1")
          .all()
      ).results
      assert.ok(
        // Newer SQLite (wrangler 4.147) answers from the index alone: "USING COVERING INDEX".
        plan.some((row) =>
          /SEARCH bl USING (COVERING )?INDEX idx_icono_artist_blacklist_normalized_tag/.test(
            row.detail,
          ),
        ),
        JSON.stringify(plan),
      )
    } finally {
      schema.close()
      await runtime.dispose()
    }
  },
)
