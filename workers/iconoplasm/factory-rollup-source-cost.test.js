import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync, readdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { rebuildGenerationRequestFactoryOptionRollupsBatch } from "../iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import { createOperationCostD1Meter } from "./operation-cost-d1-meter.js"

test(
  "factory totals, previews and ranking share one source read beside unrelated growth",
  { timeout: 120000 },
  async (t) => {
    const require = createRequire(import.meta.url)
    const { Miniflare, convertV4MiniflareOptions } = createRequire(
      require.resolve("wrangler/package.json"),
    )("miniflare")
    const codes = ["A1-1"]
    let query
    await rebuildGenerationRequestFactoryOptionRollupsBatch(
      {
        ICONOPLASM_DB: {
          prepare(sql) {
            return {
              bind() {
                return this
              },
              async all() {
                return { results: codes.map((public_emulsion_code) => ({ public_emulsion_code })) }
              },
              async run() {
                if (sql.includes("source_assets AS")) query = sql
                return { success: true }
              },
            }
          },
        },
      },
      ["anima-v1-1"],
    )
    assert.ok(query)
    const schema = new DatabaseSync(":memory:")
    const migrations = new URL("../../migrations-iconoplasm/", import.meta.url)
    for (const file of readdirSync(migrations)
      .filter((n) => n.endsWith(".sql"))
      .sort())
      schema.exec(readFileSync(new URL(file, migrations), "utf8"))
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: "export default {fetch(){return new Response('factory cost')}}",
        compatibilityDate: "2026-08-01",
        d1Databases: ["DB"],
      }),
    )
    try {
      const db = await runtime.getD1Database("DB")
      const definitions = schema
        .prepare(
          "SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,rowid",
        )
        .all()
      for (let offset = 0; offset < definitions.length; offset += 20)
        await db.batch(definitions.slice(offset, offset + 20).map(({ sql }) => db.prepare(sql)))
      await db
        .prepare(
          `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<30000)
      INSERT INTO icono_portrait_assets(gene_symbol,asset_sha256,vision_id,emulsion_id,status,created_at,r2_key_full,r2_key_thumb)
      SELECT 'G'||n,printf('%064x',n),CASE WHEN n<=10000 THEN 'anima-v1-1' ELSE 'anima-v1-2' END,
      CASE WHEN n<=10000 THEN 'A1-1' ELSE 'A1-2' END,'approved','2026-09-01','full','thumb' FROM ids`,
        )
        .run()
      await db
        .prepare(
          "INSERT INTO icono_vote_asset_summary(gene_symbol,asset_sha256,candidate_ref,upvotes,score) SELECT gene_symbol,asset_sha256,gene_symbol||':'||asset_sha256,CAST(substr(gene_symbol,2) AS INTEGER)%7,CAST(substr(gene_symbol,2) AS INTEGER)%7-2 FROM icono_portrait_assets",
        )
        .run()
      await db
        .prepare(
          "INSERT INTO icono_publish_state(gene_symbol,current_asset_sha256) SELECT gene_symbol,asset_sha256 FROM icono_portrait_assets WHERE CAST(substr(gene_symbol,2) AS INTEGER)%3=0",
        )
        .run()
      for (const density of ["dense", "sparse"]) {
        if (density === "sparse") {
          await db.prepare("DELETE FROM icono_vote_asset_summary").run()
          await db.prepare("DELETE FROM icono_publish_state").run()
        }
        await db.prepare("DELETE FROM icono_generation_request_factory_option_rollup").run()
        const receipt = await db.prepare(query).bind(JSON.stringify(codes)).run()
        const state = (
          await db
            .prepare(
              "SELECT public_emulsion_code,emulsion_slot,image_count,live_count,score,vote_h_index,preview_assets_json FROM icono_generation_request_factory_option_rollup",
            )
            .all()
        ).results
        assert.equal(state.length, 1)
        const row = state[0]
        assert.equal(row.image_count, 10000)
        assert.equal(row.live_count, density === "dense" ? 3333 : 0)
        assert.equal(row.score, density === "dense" ? 9998 : 0)
        assert.equal(row.vote_h_index, density === "dense" ? 6 : 0)
        assert.deepEqual(
          JSON.parse(row.preview_assets_json).map((asset) => asset.gene_symbol),
          density === "dense" ? ["G6", "G27", "G48", "G69", "G90"] : ["G1", "G2", "G3", "G4", "G5"],
        )
        // Both bounds reject the former three-source query. The materialization
        // hint alone regressed sparse data; both populations must stay covered.
        assert.ok(
          receipt.meta.rows_read < (density === "dense" ? 95000 : 82000),
          JSON.stringify(receipt.meta),
        )
        assert.equal(receipt.meta.rows_written, 3)
        t.diagnostic(
          JSON.stringify({
            density,
            selectedAssets: 10000,
            unrelatedAssets: 20000,
            reads: receipt.meta.rows_read,
            writes: receipt.meta.rows_written,
          }),
        )
        // Exercise source-membership reconciliation and the public rollup as
        // one actual runtime path too, not just the isolated aggregation SQL.
        await rebuildGenerationRequestFactoryOptionRollupsBatch({ ICONOPLASM_DB: db }, [
          "anima-v1-1",
        ])
        const meter = createOperationCostD1Meter(db)
        await rebuildGenerationRequestFactoryOptionRollupsBatch({ ICONOPLASM_DB: meter.db }, [
          "anima-v1-1",
        ])
        const repeated = meter.finish()
        assert.equal(repeated.rows_written, 0, JSON.stringify(repeated))
        assert.ok(repeated.rows_read < 160000, JSON.stringify(repeated))
        assert.equal(
          (
            await db
              .prepare("SELECT COUNT(*) AS n FROM icono_generation_request_factory_option_sources")
              .first()
          ).n,
          1,
        )
        t.diagnostic(JSON.stringify({ density, phase: "complete factory repeat", ...repeated }))
      }
    } finally {
      schema.close()
      await runtime.dispose()
    }
  },
)
