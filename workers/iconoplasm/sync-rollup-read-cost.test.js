import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync, readdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import {
  rebuildVoteAssetSummaryForSymbols,
  rebuildGeneRollupForSymbols,
  rebuildVisionRollupsBatch,
} from "../iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import { createOperationCostD1Meter } from "./operation-cost-d1-meter.js"

const require = createRequire(import.meta.url)
const { Miniflare, convertV4MiniflareOptions } = createRequire(
  require.resolve("wrangler/package.json"),
)("miniflare")

test(
  "sync rollups preserve a selected gene and vision without reading unrelated assets or voters",
  { timeout: 120000 },
  async (t) => {
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: "export default {fetch(){return new Response('rollup cost')}}",
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
      for (let offset = 0; offset < definitions.length; offset += 20)
        await db.batch(definitions.slice(offset, offset + 20).map(({ sql }) => db.prepare(sql)))
      const sha = "a".repeat(64)
      await db.batch([
        db.prepare(
          "INSERT INTO icono_gene_catalog(gene_symbol,full_name) VALUES('TP53','tumor protein p53')",
        ),
        db
          .prepare(
            "INSERT INTO icono_portrait_assets(gene_symbol,asset_sha256,r2_key_full,r2_key_thumb,status,vision_id,emulsion_id) VALUES('TP53',?,'full','thumb','approved','anima-v1-1','A1-1')",
          )
          .bind(sha),
        db
          .prepare(
            "INSERT INTO icono_publish_state(gene_symbol,current_asset_sha256) VALUES('TP53',?)",
          )
          .bind(sha),
        db
          .prepare(
            "INSERT INTO icono_image_votes(user_id,gene_symbol,asset_sha256,vote_value,vision_id,candidate_ref) VALUES('u1','TP53',?,1,'anima-v1-1',?)",
          )
          .bind(sha, `a:TP53|${sha}`),
      ])
      for (const population of [0, 20000]) {
        if (population)
          await db.batch([
            db.prepare(
              `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<${population}) INSERT INTO icono_portrait_assets(gene_symbol,asset_sha256,r2_key_full,r2_key_thumb,vision_id,emulsion_id) SELECT 'G'||n,printf('%064x',n),'full','thumb','anima-v1-2','A1-2' FROM ids`,
            ),
            db.prepare(
              `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<${population}) INSERT INTO icono_image_votes(user_id,gene_symbol,asset_sha256,vote_value,candidate_ref) SELECT 'other','G'||n,printf('%064x',n),-1,'a:G'||n||'|'||printf('%064x',n) FROM ids`,
            ),
          ])
        for (const [phase, fn, scope] of [
          ["votes", rebuildVoteAssetSummaryForSymbols, ["TP53"]],
          ["gene", rebuildGeneRollupForSymbols, ["TP53"]],
          ["vision", rebuildVisionRollupsBatch, ["anima-v1-1"]],
        ]) {
          const meter = createOperationCostD1Meter(db)
          await fn({ ICONOPLASM_DB: meter.db }, scope)
          const cost = meter.finish()
          t.diagnostic(JSON.stringify({ phase, population, cost }))
          assert.ok(cost.rows_read < 250, JSON.stringify({ phase, population, cost }))
          if (population) assert.equal(cost.rows_written, 0, JSON.stringify({ phase, cost }))
        }
        const vote = await db
          .prepare("SELECT score,vote_count FROM icono_vote_asset_summary WHERE gene_symbol='TP53'")
          .first()
        assert.equal(vote.score, 1)
        assert.equal(vote.vote_count, 1)
        const gene = await db
          .prepare(
            "SELECT total_assets,live_score FROM icono_admin_gene_rollup WHERE gene_symbol='TP53'",
          )
          .first()
        assert.equal(gene.total_assets, 1)
        assert.equal(gene.live_score, 1)
        const vision = await db
          .prepare(
            "SELECT image_count,score,live_count FROM icono_admin_vision_rollup WHERE vision_id='anima-v1-1'",
          )
          .first()
        assert.equal(vision.image_count, 1)
        assert.equal(vision.score, 1)
        assert.equal(vision.live_count, 1)
      }

      const tables = [
        "icono_vote_asset_summary",
        "icono_admin_gene_rollup",
        "icono_admin_vision_rollup",
        "icono_generation_request_vision_option_rollup",
        "icono_generation_request_factory_option_sources",
        "icono_generation_request_factory_option_rollup",
      ]
      const snapshot = async () =>
        Promise.all(
          tables.map(
            async (table) =>
              (await db.prepare(`SELECT * FROM ${table} ORDER BY 1,2`).all()).results,
          ),
        )
      const rebuild = async () => {
        const meter = createOperationCostD1Meter(db)
        const env = { ICONOPLASM_DB: meter.db }
        await rebuildVoteAssetSummaryForSymbols(env, ["TP53"])
        await rebuildGeneRollupForSymbols(env, ["TP53"])
        await rebuildVisionRollupsBatch(env, ["anima-v1-1"])
        return meter.finish()
      }
      await db
        .prepare(
          `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<100)
        INSERT INTO icono_portrait_assets(gene_symbol,asset_sha256,r2_key_full,r2_key_thumb,vision_id,emulsion_id)
        SELECT 'TP53',printf('%064x',n),'full','thumb','anima-v1-1','a1-1' FROM ids`,
        )
        .run()
      await rebuild()
      const stable = await snapshot()
      const repeated = await rebuild()
      assert.equal(repeated.rows_written, 0, JSON.stringify(repeated))
      assert.deepEqual(await snapshot(), stable, "unchanged projections retain data and timestamps")
      t.diagnostic(
        JSON.stringify({ phase: "101 assets, complete three-phase repeat", cost: repeated }),
      )

      // Real source changes still reach every dependent rollup.
      await db.prepare("UPDATE icono_image_votes SET vote_value=-1 WHERE gene_symbol='TP53'").run()
      await rebuild()
      assert.equal(
        (
          await db
            .prepare("SELECT live_score FROM icono_admin_gene_rollup WHERE gene_symbol='TP53'")
            .first()
        ).live_score,
        -1,
      )
      assert.equal(
        (
          await db
            .prepare("SELECT score FROM icono_admin_vision_rollup WHERE vision_id='anima-v1-1'")
            .first()
        ).score,
        -1,
      )
      assert.equal(
        (
          await db
            .prepare(
              "SELECT score FROM icono_generation_request_factory_option_rollup WHERE public_emulsion_code='A1-1'",
            )
            .first()
        ).score,
        -1,
      )

      // A failed replacement must retain removals from the same atomic batch too.
      await db
        .prepare(
          "INSERT INTO icono_admin_gene_rollup(gene_symbol,full_name) VALUES('REMOVED','old')",
        )
        .run()
      const beforeFailure = await snapshot()
      await db
        .prepare(
          "CREATE TRIGGER fail_gene_rollup BEFORE INSERT ON icono_admin_gene_rollup BEGIN SELECT RAISE(ABORT,'injected rollup failure'); END",
        )
        .run()
      await assert.rejects(
        rebuildGeneRollupForSymbols({ ICONOPLASM_DB: db }, ["TP53", "REMOVED"]),
        /injected rollup failure/,
      )
      assert.deepEqual(await snapshot(), beforeFailure)
      await db.prepare("DROP TRIGGER fail_gene_rollup").run()
      await rebuildGeneRollupForSymbols({ ICONOPLASM_DB: db }, ["REMOVED"])
      assert.equal(
        await db
          .prepare("SELECT 1 FROM icono_admin_gene_rollup WHERE gene_symbol='REMOVED'")
          .first(),
        null,
      )

      // Clearing the last source must remove all scoped projections, including
      // factory source membership. Keep unrelated source data intact.
      await db.batch([
        db.prepare("DELETE FROM icono_portrait_assets WHERE gene_symbol='TP53'"),
        db.prepare("DELETE FROM icono_publish_state WHERE gene_symbol='TP53'"),
        db.prepare("DELETE FROM icono_gene_catalog WHERE gene_symbol='TP53'"),
      ])
      await rebuild()
      assert.deepEqual(
        await snapshot(),
        tables.map(() => []),
      )
      assert.equal(
        (await db.prepare("SELECT COUNT(*) AS n FROM icono_portrait_assets").first()).n,
        20000,
      )
    } finally {
      schema.close()
      await runtime.dispose()
    }
  },
)
