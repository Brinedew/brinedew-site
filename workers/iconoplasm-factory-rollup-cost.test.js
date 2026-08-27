import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import test from "node:test"
import { rebuildGenerationRequestFactoryOptionRollupsBatch } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

const require = createRequire(import.meta.url)
const { Miniflare, convertV4MiniflareOptions } = createRequire(
  require.resolve("wrangler/package.json"),
)("miniflare")
const migration = readFileSync(
  new URL(
    "../migrations-iconoplasm/0081_factory_option_source_collation_index.sql",
    import.meta.url,
  ),
  "utf8",
)

// ARCHITECTURE FENCE [IPD-005]: prove both exact output and actual SQLite row
// work. A tiny mock/result-only test missed the collation regression in 0077.
test(
  "factory rollup uses collation-matched seeks without changing its result",
  { timeout: 30000 },
  async (t) => {
    const codes = Array.from({ length: 20 }, (_, i) => `A1-${i + 1}`)
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
      const ddl = [
        "CREATE TABLE icono_portrait_assets(gene_symbol TEXT,asset_sha256 TEXT,emulsion_id TEXT,created_at TEXT,status TEXT,PRIMARY KEY(gene_symbol,asset_sha256))",
        "CREATE INDEX idx_icono_portrait_assets_emulsion_status_created ON icono_portrait_assets(emulsion_id,status,created_at DESC,gene_symbol,asset_sha256)",
        "CREATE TABLE icono_publish_state(gene_symbol TEXT PRIMARY KEY,current_asset_sha256 TEXT)",
        "CREATE TABLE icono_vote_asset_summary(gene_symbol TEXT,asset_sha256 TEXT,upvotes INTEGER,score INTEGER,PRIMARY KEY(gene_symbol,asset_sha256))",
        "CREATE TABLE icono_generation_request_factory_option_rollup(public_emulsion_code TEXT PRIMARY KEY,emulsion_slot INTEGER,image_count INTEGER,live_count INTEGER,score INTEGER,vote_h_index INTEGER,preview_assets_json TEXT,updated_at TEXT)",
      ]
      for (const sql of ddl) await db.prepare(sql).run()
      // Seed inside SQLite: thousands of cross-process fixture RPCs would
      // measure the test harness rather than the production query.
      await db
        .prepare(
          `WITH RECURSIVE sample(i) AS (
        VALUES(0) UNION ALL SELECT i+1 FROM sample WHERE i<999
      ) INSERT INTO icono_portrait_assets
        SELECT 'G'||i,'sha'||i,(CASE WHEN i=0 THEN 'a' ELSE 'A' END)||'1-'||(i%200+1),
          '2026-08-27','ready' FROM sample`,
        )
        .run()
      const before = await db.prepare(query).bind(JSON.stringify(codes)).run()
      const read = async () =>
        (
          await db
            .prepare(
              "SELECT public_emulsion_code,image_count,live_count,score,vote_h_index,preview_assets_json FROM icono_generation_request_factory_option_rollup ORDER BY public_emulsion_code",
            )
            .all()
        ).results
      const original = await read()
      await db.prepare("DELETE FROM icono_generation_request_factory_option_rollup").run()
      await db.prepare(migration).run()
      const after = await db.prepare(query).bind(JSON.stringify(codes)).run()
      assert.deepEqual(await read(), original)
      assert.equal(
        original.find((x) => x.public_emulsion_code === "A1-1").image_count,
        5,
        "mixed-case source identity remains included",
      )
      const plan = (
        await db
          .prepare("EXPLAIN QUERY PLAN " + query)
          .bind(JSON.stringify(codes))
          .all()
      ).results
      assert.ok(
        plan.some((x) =>
          /SEARCH pa USING INDEX idx_icono_portrait_assets_factory_emulsion_nocase/.test(x.detail),
        ),
      )
      assert.ok(
        after.meta.rows_read < before.meta.rows_read / 5,
        `${before.meta.rows_read} -> ${after.meta.rows_read}`,
      )
      t.diagnostic(
        JSON.stringify({
          before: before.meta.rows_read,
          after: after.meta.rows_read,
          portraits: 1000,
          affectedFactories: 20,
        }),
      )
    } finally {
      await runtime.dispose()
    }
  },
)
