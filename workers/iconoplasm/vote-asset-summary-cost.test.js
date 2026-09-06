import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync, readdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { replaceVoteAssetSummaryForSymbolFromCoordinatorState } from "../iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import { createD1InvocationBudget } from "../lib/d1-invocation-budget.js"
import { createOperationCostD1Meter } from "./operation-cost-d1-meter.js"

const require = createRequire(import.meta.url)
const { Miniflare, convertV4MiniflareOptions } = createRequire(
  require.resolve("wrangler/package.json"),
)("miniflare")

test(
  "vote summary replaces 100 images in two atomic statements beside 20000 other genes",
  { timeout: 120000 },
  async (t) => {
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: "export default {fetch(){return new Response('vote summary cost')}}",
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
        .prepare(
          `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<20000)
      INSERT INTO icono_vote_asset_summary(gene_symbol,asset_sha256,candidate_ref,score)
      SELECT 'G'||n,printf('%064x',n),'G'||n||':'||printf('%064x',n),9 FROM ids`,
        )
        .run()
      const first = Array.from({ length: 100 }, (_, n) => ({
        asset_sha256: (n + 1).toString(16).padStart(64, "0"),
        vision_id: "anima-v1-18",
        candidate_image_id: n + 1,
        upvotes: n + 2,
        downvotes: 1,
        score: n + 1,
        vote_count: n + 3,
      }))
      for (let pass = 0; pass < 2; pass++) {
        const meter = createOperationCostD1Meter(db),
          budget = createD1InvocationBudget()
        const rows = first.map((row) => ({ ...row, score: row.score + pass }))
        const written = await replaceVoteAssetSummaryForSymbolFromCoordinatorState(
          { ICONOPLASM_DB: budget.binding(meter.db) },
          { symbol: "tp53", assetSummaries: rows },
        )
        assert.equal(written, 100)
        assert.equal(budget.used, 2)
        const actual = meter.finish()
        assert.ok(actual.rows_read <= 416, JSON.stringify(actual))
        assert.ok(actual.rows_written <= 800, JSON.stringify(actual))
        const actualRows = (
          await db
            .prepare(
              "SELECT * FROM icono_vote_asset_summary WHERE gene_symbol='TP53' ORDER BY asset_sha256",
            )
            .all()
        ).results
        assert.equal(actualRows.length, 100)
        assert.equal(actualRows[0].score, 1 + pass)
        assert.equal(actualRows[0].candidate_image_id, 1)
        assert.equal(actualRows[99].upvotes, 101)
        assert.equal(actualRows[99].downvotes, 1)
        assert.equal(actualRows[99].vote_count, 102)
        t.diagnostic(JSON.stringify({ pass, statements: budget.used, actual }))
      }
      const snapshot = async () =>
        (
          await db
            .prepare(
              "SELECT * FROM icono_vote_asset_summary WHERE gene_symbol='TP53' ORDER BY asset_sha256",
            )
            .all()
        ).results
      const before = await snapshot()
      await assert.rejects(
        replaceVoteAssetSummaryForSymbolFromCoordinatorState(
          { ICONOPLASM_DB: db },
          { symbol: "TP53", assetSummaries: [...first, first[0]] },
        ),
        /UNIQUE/,
      )
      assert.deepEqual(
        await snapshot(),
        before,
        "a failing insert must restore the entire previous summary",
      )
      assert.equal(
        await replaceVoteAssetSummaryForSymbolFromCoordinatorState(
          { ICONOPLASM_DB: db },
          { symbol: "TP53", assetSummaries: [] },
        ),
        0,
      )
      assert.deepEqual(await snapshot(), [])
      assert.equal(
        (await db.prepare("SELECT COUNT(*) AS n FROM icono_vote_asset_summary").first()).n,
        20000,
      )
      assert.equal(
        (
          await db
            .prepare("SELECT score FROM icono_vote_asset_summary WHERE gene_symbol='G1'")
            .first()
        ).score,
        9,
      )
    } finally {
      schema.close()
      await runtime.dispose()
    }
  },
)
