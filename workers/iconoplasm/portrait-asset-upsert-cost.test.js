import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync, readdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { PORTRAIT_ASSET_UPSERT_SQL } from "./portrait-asset-upsert.js"
import { createOperationCostD1Meter } from "./operation-cost-d1-meter.js"

const require = createRequire(import.meta.url)
const { Miniflare, convertV4MiniflareOptions } = createRequire(
  require.resolve("wrangler/package.json"),
)("miniflare")

test(
  "unchanged ingest preserves metadata and spends zero D1 writes with the complete trigger schema",
  { timeout: 120000 },
  async (t) => {
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
        .filter((name) => name.endsWith(".sql"))
        .sort())
        schema.exec(readFileSync(new URL(file, directory), "utf8"))
      const db = await runtime.getD1Database("DB")
      const definitions = schema
        .prepare(
          "SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,rowid",
        )
        .all()
      for (let offset = 0; offset < definitions.length; offset += 20)
        await db.batch(definitions.slice(offset, offset + 20).map(({ sql }) => db.prepare(sql)))
      await db
        .prepare("INSERT INTO icono_gene_catalog(gene_symbol,full_name) VALUES('TP53','TP53')")
        .run()
      const args = (n) => [
        "TP53",
        n.toString(16).padStart(64, "0"),
        "full",
        "medium",
        "thumb",
        768,
        1024,
        12345,
        "draft",
        1,
        0,
        "anima-v1-1",
        "A1-1",
        "workflow",
        "label",
        "path",
        "v1",
        1,
        n,
        "sample",
        1,
        "a".repeat(64),
        null,
        null,
        "operator",
      ]
      const run = async (sql, binding = db) => {
        for (let n = 1; n <= 100; n += 25)
          await binding.batch(
            Array.from({ length: 25 }, (_, i) => binding.prepare(sql).bind(...args(n + i))),
          )
      }
      await run(PORTRAIT_ASSET_UPSERT_SQL)
      const before = await db
        .prepare("SELECT * FROM icono_portrait_assets WHERE gene_symbol='TP53' AND asset_sha256=?")
        .bind(args(1)[1])
        .first()
      const repeat = createOperationCostD1Meter(db)
      await run(PORTRAIT_ASSET_UPSERT_SQL, repeat.db)
      const repeatedCost = repeat.finish()
      assert.equal(repeatedCost.rows_written, 0)
      assert.ok(repeatedCost.rows_read <= 300, JSON.stringify(repeatedCost))
      assert.deepEqual(
        await db
          .prepare(
            "SELECT * FROM icono_portrait_assets WHERE gene_symbol='TP53' AND asset_sha256=?",
          )
          .bind(args(1)[1])
          .first(),
        before,
      )
      const old = createOperationCostD1Meter(db)
      await run(PORTRAIT_ASSET_UPSERT_SQL.split("\n               WHERE ")[0], old.db)
      const oldCost = old.finish()
      assert.ok(oldCost.rows_written >= 1000, JSON.stringify(oldCost))
      // A null incoming optional value retains the exact stored value; a real
      // medium-key or sample change still updates the canonical metadata.
      const changed = args(1)
      changed[3] = "repaired-medium"
      changed[5] = null
      changed[19] = "new sample"
      await db
        .prepare(PORTRAIT_ASSET_UPSERT_SQL)
        .bind(...changed)
        .run()
      const updated = await db
        .prepare(
          "SELECT r2_key_medium,width,sample_label FROM icono_portrait_assets WHERE gene_symbol='TP53' AND asset_sha256=?",
        )
        .bind(args(1)[1])
        .first()
      assert.deepEqual(updated, {
        r2_key_medium: "repaired-medium",
        width: 768,
        sample_label: "new sample",
      })
      t.diagnostic(JSON.stringify({ assets: 100, old: oldCost, repeated: repeatedCost }))
    } finally {
      schema.close()
      await runtime.dispose()
    }
  },
)
