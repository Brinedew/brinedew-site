import assert from "node:assert/strict"
import test from "node:test"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import esbuild from "esbuild"

test(
  "budget snapshots do not scan unrelated historical days and retain restart accounting",
  { timeout: 60000 },
  async () => {
    const require = createRequire(import.meta.url)
    const { Miniflare, convertV4MiniflareOptions } = createRequire(
      require.resolve("wrangler/package.json"),
    )("miniflare")
    const bundle = await esbuild.build({
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      target: "es2022",
      external: ["cloudflare:*", "node:*"],
      stdin: {
        resolveDir: fileURLToPath(new URL("../", import.meta.url)),
        contents: `import { IconoplasmD1DailyBudgetKillSwitchDoNotDuplicate as Budget } from './workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js';
      export class TestBudget {
        constructor(state, env) {
          this.state=state; this.env=env; this.reads=0; this.writes=0;
          this.storage={sql:{exec:(...args)=>{const c=state.storage.sql.exec(...args);const rows=c.toArray();this.reads+=c.rowsRead;this.writes+=c.rowsWritten;return {toArray:()=>rows};}},transactionSync:fn=>state.storage.transactionSync(fn)};
          this.budget=new Budget({storage:this.storage,blockConcurrencyWhile:fn=>state.blockConcurrencyWhile(fn)},env);
        }
        async fetch(request) {
          const body=await request.json();
          if(body.seed) {
            this.state.storage.sql.exec("WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<10000) INSERT INTO daily_budget_usage(day_key,cycle_key,rows_read,rows_written) SELECT 'old-'||x,'old-cycle',7,2 FROM n");
            this.state.storage.sql.exec("INSERT INTO daily_budget_usage(day_key,cycle_key,rows_read,rows_written) VALUES ('2026-09-12','2026-09-07',20,3),('2026-09-11','2026-09-07',30,4)");
          }
          if(body.restart) this.budget=new Budget({storage:this.storage,blockConcurrencyWhile:fn=>fn()},this.env);
          this.reads=0;this.writes=0;
          const response=await this.budget.fetch(new Request('https://ledger/'+(body.record?'record':'snapshot'),{method:'POST',body:JSON.stringify({day_key:'2026-09-12',cycle_key:'2026-09-07',days_remaining_in_cycle:25,budgets:{rowsReadMonthlyLimit:24000000000,rowsWrittenMonthlyLimit:40000000},...(body.record||{})})}));
          return Response.json({value:await response.json(),reads:this.reads,writes:this.writes});
        }
      }
      export default {fetch(request,env){return env.BUDGET.get(env.BUDGET.idFromName('same-owner')).fetch(request)}}`,
      },
    })
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: bundle.outputFiles[0].text,
        compatibilityDate: "2026-08-01",
        compatibilityFlags: ["nodejs_compat"],
        durableObjects: { BUDGET: { className: "TestBudget", useSQLite: true } },
      }),
    )
    try {
      const send = async (body) =>
        (
          await runtime.dispatchFetch("https://test/", {
            method: "POST",
            body: JSON.stringify(body),
          })
        ).json()
      for (const body of [{ seed: true }, {}, { restart: true }]) {
        const result = await send(body)
        assert.equal(result.value.rows_read, 20)
        assert.equal(result.value.cycle_rows_read, 50)
        assert.equal(result.value.cycle_rows_written, 7)
        assert.ok(result.reads <= 8, JSON.stringify(result))
        assert.equal(result.writes, 0)
      }
      const recorded = await send({
        record: { rows_read: 11, rows_written: 2, query_count: 1, request_count: 1 },
      })
      assert.equal(recorded.value.rows_read, 31)
      assert.equal(recorded.value.cycle_rows_read, 61)
      assert.equal(recorded.value.cycle_rows_written, 9)
      assert.ok(recorded.reads <= 12, JSON.stringify(recorded))
      const restarted = await send({ restart: true })
      assert.equal(restarted.value.cycle_rows_read, 61)
      assert.ok(restarted.reads <= 8, JSON.stringify(restarted))
    } finally {
      await runtime.dispose()
    }
  },
)
