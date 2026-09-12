import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { createRequire } from "node:module"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { fetchAssetStateRows } from "../iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import { createOperationCostD1Meter } from "./operation-cost-d1-meter.js"

const require = createRequire(import.meta.url)
const { Miniflare, convertV4MiniflareOptions } = createRequire(
  require.resolve("wrangler/package.json"),
)("miniflare")

test(
  "asset state seeks exact genes and votes with unchanged cost beside 100000 unrelated rows",
  { timeout: 120000 },
  async (t) => {
    const schema = new DatabaseSync(":memory:")
    const migrations = new URL("../../migrations-iconoplasm/", import.meta.url)
    for (const file of readdirSync(migrations)
      .filter((n) => n.endsWith(".sql"))
      .sort())
      schema.exec(readFileSync(new URL(file, migrations), "utf8"))
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: "export default {fetch(){return new Response('test')}}",
        compatibilityDate: "2026-08-01",
        d1Databases: ["DB"],
      }),
    )
    try {
      const db = await runtime.getD1Database("DB")
      for (const table of ["icono_portrait_assets", "icono_image_votes"]) {
        for (const { sql } of schema
          .prepare(
            "SELECT sql FROM sqlite_schema WHERE tbl_name=? AND type IN ('table','index') AND sql IS NOT NULL ORDER BY type DESC",
          )
          .all(table))
          await db.prepare(sql).run()
      }
      await db
        .prepare(
          "INSERT INTO icono_portrait_assets(gene_symbol,asset_sha256,sample_label,r2_key_full,r2_key_thumb) VALUES('TP53','a','TP53-1','',''),('TP53','b','TP53-2','',''),('BRCA1','c','BRCA1-1','','')",
        )
        .run()
      await db
        .prepare(
          "INSERT INTO icono_image_votes(candidate_ref,gene_symbol,asset_sha256,user_id,vote_value) VALUES('a:TP53|a','TP53','a','one',1),('a:TP53|a','TP53','a','two',-1),('a:TP53|b','TP53','b','one',1)",
        )
        .run()
      const read = async () => {
        const meter = createOperationCostD1Meter(db)
        const rows = await fetchAssetStateRows({ ICONOPLASM_DB: meter.db }, [
          " tp53 ",
          "TP53",
          "MISSING",
        ])
        assert.deepEqual(
          rows.map((r) => [
            r.gene_symbol,
            r.asset_sha256,
            r.sample_label,
            r.image_upvotes,
            r.image_downvotes,
            r.image_score,
          ]),
          [
            ["TP53", "a", "TP53-1", 1, 1, 0],
            ["TP53", "b", "TP53-2", 1, 0, 1],
          ],
        )
        const cost = meter.finish()
        assert.equal(cost.rows_written, 0)
        assert.ok(cost.rows_read <= 80, JSON.stringify(cost))
        return cost.rows_read
      }
      const before = await read()
      await db
        .prepare(
          "WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<100000) INSERT INTO icono_portrait_assets(gene_symbol,asset_sha256,r2_key_full,r2_key_thumb) SELECT 'OTHER'||i,'a','','' FROM n",
        )
        .run()
      await db
        .prepare(
          "WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<100000) INSERT INTO icono_image_votes(candidate_ref,gene_symbol,asset_sha256,user_id,vote_value) SELECT 'a:OTHER'||i||'|a','OTHER'||i,'a','user',1 FROM n",
        )
        .run()
      assert.equal(await read(), before)
      const empty = createOperationCostD1Meter(db)
      assert.deepEqual(await fetchAssetStateRows({ ICONOPLASM_DB: empty.db }, []), [])
      assert.equal(empty.finish().rows_read, 0)
      t.diagnostic(
        JSON.stringify({
          selectedAssets: 2,
          selectedVotes: 3,
          unrelatedAssets: 100000,
          unrelatedVotes: 100000,
          reads: before,
        }),
      )
    } finally {
      schema.close()
      await runtime.dispose()
    }
  },
)
