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
    } finally {
      schema.close()
      await runtime.dispose()
    }
  },
)
