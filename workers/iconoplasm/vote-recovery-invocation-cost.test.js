import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync, readdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import {
  handleIconoplasmVoteProjectionQueue,
  processPendingVoteProjectionRefreshJobs,
} from "../iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import { createD1InvocationBudget } from "../lib/d1-invocation-budget.js"
import { createOperationCostD1Meter } from "./operation-cost-d1-meter.js"

const require = createRequire(import.meta.url)
const { Miniflare, convertV4MiniflareOptions } = createRequire(
  require.resolve("wrangler/package.json"),
)("miniflare")

test("failed vote lookups cannot spend the rollback allowance on more queued messages", async () => {
  let calls = 0,
    retries = 0
  const messages = Array.from({ length: 25 }, (_, i) => ({
    body: { kind: "process_vote_projection_refresh", symbol: `G${i}` },
    ack() {
      assert.fail("failed lookup must remain queued")
    },
    retry() {
      retries++
    },
  }))
  await handleIconoplasmVoteProjectionQueue(
    { messages },
    {
      ICONOPLASM_DB: {
        prepare() {
          return {
            bind() {
              return this
            },
            async first() {
              calls++
              throw new Error("lookup unavailable")
            },
          }
        },
      },
    },
  )
  assert.equal(calls, 2)
  assert.equal(retries, 25)
})

test(
  "vote recovery restores every promoted selection and retains retries within one invocation",
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
      const oldSha = "a".repeat(64),
        newSha = "b".repeat(64)
      const symbols = ["TP53", "PRL", "GLB1"]
      for (const symbol of symbols)
        await db.batch([
          db
            .prepare("INSERT INTO icono_gene_catalog(gene_symbol,full_name) VALUES(?,?)")
            .bind(symbol, symbol),
          ...[oldSha, newSha].map((sha, i) =>
            db
              .prepare(
                "INSERT INTO icono_portrait_assets(gene_symbol,asset_sha256,r2_key_full,r2_key_thumb,status,vision_id,emulsion_id) VALUES(?,?,'full','thumb',?,?,?)",
              )
              .bind(
                symbol,
                sha,
                i ? "draft" : "approved",
                `anima-v1-${symbols.indexOf(symbol) + 1}`,
                `A1-${symbols.indexOf(symbol) + 1}`,
              ),
          ),
          db
            .prepare(
              "INSERT INTO icono_publish_state(gene_symbol,current_asset_sha256) VALUES(?,?)",
            )
            .bind(symbol, oldSha),
          db
            .prepare(
              "INSERT INTO icono_vote_projection_refresh_jobs(gene_symbol,actor_id,reason,next_attempt_at,job_version) VALUES(?,'tester','vote_auto_promote','2020-01-01',7)",
            )
            .bind(symbol),
        ])
      await db
        .prepare(
          "CREATE TRIGGER fail_vision_projection BEFORE INSERT ON icono_admin_vision_rollup BEGIN SELECT RAISE(ABORT,'injected vision failure'); END",
        )
        .run()
      const budget = createD1InvocationBudget()
      const deliveries = symbols.map((symbol) => ({
        body: { kind: "process_vote_projection_refresh", symbol },
        acked: 0,
        retries: [],
        ack() {
          this.acked++
        },
        retry(options) {
          this.retries.push(options)
        },
      }))
      const env = {
        ICONOPLASM_DB: budget.binding(db),
        ICONOPLASM_VOTE_COORDINATORS: {
          idFromName: (id) => id,
          get: () => ({
            fetch: async (request) => {
              const { symbol } = await request.json()
              return Response.json({
                ok: true,
                symbol,
                asset_summaries: [
                  {
                    asset_sha256: newSha,
                    vision_id: `anima-v1-${symbols.indexOf(symbol) + 1}`,
                    upvotes: 10,
                    downvotes: 0,
                    score: 10,
                    vote_count: 10,
                  },
                ],
              })
            },
          }),
        },
      }
      const result = await handleIconoplasmVoteProjectionQueue({ messages: deliveries }, env)
      assert.equal(result.failed, 2)
      assert.equal(result.retrying, 3)
      for (const [i, symbol] of symbols.entries()) {
        assert.equal(
          (
            await db
              .prepare("SELECT current_asset_sha256 FROM icono_publish_state WHERE gene_symbol=?")
              .bind(symbol)
              .first()
          ).current_asset_sha256,
          oldSha,
        )
        const job = await db
          .prepare(
            "SELECT attempts,job_version FROM icono_vote_projection_refresh_jobs WHERE gene_symbol=?",
          )
          .bind(symbol)
          .first()
        assert.equal(job.attempts, i < 2 ? 1 : 0)
        assert.equal(job.job_version, 7)
        assert.equal(deliveries[i].acked, 0)
        assert.equal(deliveries[i].retries.length, 1)
      }
      assert.equal(
        (
          await db
            .prepare("SELECT COUNT(*) AS n FROM icono_publish_events WHERE action='rollback'")
            .first()
        ).n,
        2,
      )
      assert.ok(budget.used <= 50)
      t.diagnostic(JSON.stringify({ phase: "vision rollback", statements: budget.used }))
      await db.prepare("DROP TRIGGER fail_vision_projection").run()
      await db
        .prepare("UPDATE icono_vote_projection_refresh_jobs SET next_attempt_at='2020-01-01'")
        .run()
      await db
        .prepare(
          "CREATE TRIGGER fail_job_completion BEFORE DELETE ON icono_vote_projection_refresh_jobs WHEN OLD.gene_symbol='PRL' BEGIN SELECT RAISE(ABORT,'injected completion failure'); END",
        )
        .run()
      const completionBudget = createD1InvocationBudget()
      const completion = await handleIconoplasmVoteProjectionQueue(
        { messages: deliveries.slice(0, 2) },
        { ...env, ICONOPLASM_DB: completionBudget.binding(db) },
      )
      assert.equal(completion.failed, 2)
      for (const symbol of symbols.slice(0, 2)) {
        assert.equal(
          (
            await db
              .prepare("SELECT current_asset_sha256 FROM icono_publish_state WHERE gene_symbol=?")
              .bind(symbol)
              .first()
          ).current_asset_sha256,
          oldSha,
        )
        assert.equal(
          (
            await db
              .prepare(
                "SELECT attempts FROM icono_vote_projection_refresh_jobs WHERE gene_symbol=?",
              )
              .bind(symbol)
              .first()
          ).attempts,
          2,
        )
      }
      assert.ok(completionBudget.used <= 50)
      t.diagnostic(
        JSON.stringify({ phase: "completion rollback", statements: completionBudget.used }),
      )
      await db.prepare("DROP TRIGGER fail_job_completion").run()
      await db
        .prepare("UPDATE icono_vote_projection_refresh_jobs SET next_attempt_at='2020-01-01'")
        .run()
      const pendingBudget = createD1InvocationBudget()
      const drained = await processPendingVoteProjectionRefreshJobs(
        { ...env, ICONOPLASM_DB: pendingBudget.binding(db) },
        { limit: 250 },
      )
      assert.equal(drained.processed, 2)
      assert.equal(drained.has_more, true)
      assert.equal(
        (await db.prepare("SELECT COUNT(*) AS n FROM icono_vote_projection_refresh_jobs").first())
          .n,
        1,
      )
      assert.ok(pendingBudget.used <= 50)
      await db.prepare("DELETE FROM icono_vote_projection_refresh_jobs").run()
      const future = new Date(Date.now() + 3600000).toISOString().slice(0, 19).replace("T", " ")
      await db
        .prepare(
          `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<20000)
      INSERT INTO icono_vote_projection_refresh_jobs(gene_symbol,next_attempt_at) SELECT 'G'||n,? FROM ids`,
        )
        .bind(future)
        .run()
      const meter = createOperationCostD1Meter(db)
      const empty = await processPendingVoteProjectionRefreshJobs({
        ...env,
        ICONOPLASM_DB: meter.db,
      })
      assert.equal(empty.processed, 0)
      assert.equal(empty.has_more, false)
      const cost = meter.finish()
      assert.ok(cost.rows_read <= 32, JSON.stringify(cost))
      assert.equal(cost.rows_written, 0)
      let retryDelay = 0
      const deferred = await handleIconoplasmVoteProjectionQueue(
        {
          messages: [
            {
              body: { kind: "process_vote_projection_refresh", symbol: "G1" },
              ack() {
                assert.fail("future SQLite UTC job acknowledged")
              },
              retry({ delaySeconds }) {
                retryDelay = delaySeconds
              },
            },
          ],
        },
        { ...env, ICONOPLASM_DB: db },
      )
      assert.equal(deferred.processed, 0)
      assert.ok(retryDelay > 3500 && retryDelay <= 3600)
      t.diagnostic(JSON.stringify({ phase: "20000 future jobs", cost }))
    } finally {
      schema.close()
      await runtime.dispose()
    }
  },
)
