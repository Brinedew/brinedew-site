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
  "one changed vote among 1000 images writes only its summary beside 20000 other genes",
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
      const first = Array.from({ length: 1000 }, (_, n) => ({
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
        const rows = first.map((row, index) => ({
          ...row,
          score: row.score + (index === 0 ? pass : 0),
        }))
        const written = await replaceVoteAssetSummaryForSymbolFromCoordinatorState(
          { ICONOPLASM_DB: budget.binding(meter.db) },
          { symbol: "tp53", assetSummaries: rows },
        )
        assert.equal(written, 1000)
        assert.equal(budget.used, 2)
        const actual = meter.finish()
        assert.ok(actual.rows_read <= 8016, JSON.stringify(actual))
        assert.ok(actual.rows_written <= (pass === 0 ? 4000 : 4), JSON.stringify(actual))
        const actualRows = (
          await db
            .prepare(
              "SELECT * FROM icono_vote_asset_summary WHERE gene_symbol='TP53' ORDER BY asset_sha256",
            )
            .all()
        ).results
        assert.equal(actualRows.length, 1000)
        assert.equal(actualRows[0].score, 1 + pass)
        assert.equal(actualRows[0].candidate_image_id, 1)
        assert.equal(actualRows[999].upvotes, 1001)
        assert.equal(actualRows[999].downvotes, 1)
        assert.equal(actualRows[999].vote_count, 1002)
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
      const repeated = first.map((row, index) => ({
        ...row,
        score: row.score + Number(index === 0),
      }))
      const repeatedMeter = createOperationCostD1Meter(db)
      await replaceVoteAssetSummaryForSymbolFromCoordinatorState(
        { ICONOPLASM_DB: repeatedMeter.db },
        { symbol: "TP53", assetSummaries: repeated },
      )
      const repeatedCost = repeatedMeter.finish()
      assert.equal(repeatedCost.rows_written, 0, JSON.stringify(repeatedCost))
      assert.deepEqual(
        await snapshot(),
        before,
        "a repeated delivery preserves exact state and timestamps",
      )
      t.diagnostic(JSON.stringify({ repeated: repeatedCost }))
      await assert.rejects(
        replaceVoteAssetSummaryForSymbolFromCoordinatorState(
          { ICONOPLASM_DB: db },
          { symbol: "TP53", assetSummaries: [...first, first[0]] },
        ),
        /Duplicate/,
      )
      await assert.rejects(
        replaceVoteAssetSummaryForSymbolFromCoordinatorState(
          { ICONOPLASM_DB: db },
          {
            symbol: "TP53",
            assetSummaries: [
              ...repeated.slice(1),
              { ...first[0], asset_sha256: "f".repeat(64), score: Infinity },
            ],
          },
        ),
        /NOT NULL/,
      )
      assert.deepEqual(
        await snapshot(),
        before,
        "a failing insert must restore the entire previous summary",
      )
      const removalMeter = createOperationCostD1Meter(db)
      await replaceVoteAssetSummaryForSymbolFromCoordinatorState(
        { ICONOPLASM_DB: removalMeter.db },
        { symbol: "TP53", assetSummaries: repeated.slice(1) },
      )
      const removalCost = removalMeter.finish()
      assert.ok(removalCost.rows_written <= 4, JSON.stringify(removalCost))
      assert.equal((await snapshot()).length, 999)
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
