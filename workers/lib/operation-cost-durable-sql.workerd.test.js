import assert from "node:assert/strict"
import test from "node:test"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import esbuild from "esbuild"

test(
  "real Durable SQL execution retains uncertain work and admits later pages through the same ledger",
  { timeout: 30000 },
  async (t) => {
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
      stdin: {
        resolveDir: fileURLToPath(new URL("../../", import.meta.url)),
        contents: `
        import {OperationCostLedger} from './workers/lib/operation-cost-ledger.js';
        import {OperationCostExecutor} from './workers/lib/operation-cost-executor.js';
        const identity={executable_sha256:'a'.repeat(64),schema_sha256:'b'.repeat(64),resource:'fixture',adapter_id:'seed-page',principal:'admin'};
        export class Target {
          constructor(state) {
            this.state=state;
            state.blockConcurrencyWhile(async()=>state.storage.sql.exec('CREATE TABLE IF NOT EXISTS retained (id TEXT PRIMARY KEY, value INTEGER NOT NULL)'));
          }
          async fetch(request) {
            const input=await request.json();
            if(input.inspect) return Response.json(this.state.storage.sql.exec('SELECT COUNT(*) AS count,SUM(value) AS sum FROM retained').toArray()[0]);
            const cursor=this.state.storage.sql.exec(
              "WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<?) INSERT INTO retained SELECT ?||'-'||n,n FROM ids",
              input.rows,input.id);
            cursor.toArray();
            return Response.json({do_rows_read:cursor.rowsRead,do_rows_written:cursor.rowsWritten});
          }
        }
        export class Authority {
          constructor(state,env) {
            this.state=state;this.env=env;this.clock=Date.parse('2026-09-13T12:00:00Z');this.dispatched=0;
            this.cost={reads:0,writes:0};
            this.storage={sql:{exec:(...args)=>{
              const cursor=state.storage.sql.exec(...args);const rows=cursor.toArray();
              this.cost.reads+=cursor.rowsRead;this.cost.writes+=cursor.rowsWritten;
              return {toArray:()=>rows};
            }},transactionSync:fn=>state.storage.transactionSync(fn)};
            this.reconstruct();
            state.blockConcurrencyWhile(async()=>this.ledger.initialize());
          }
          reconstruct() {
            this.ledger=new OperationCostLedger(this.storage,()=>this.clock,()=>({
              day:new Date(this.clock).toISOString().slice(0,10),measured_at:this.clock,
              rows_read:0,rows_written:100000,requests:0,
              do_rows_read:0,do_rows_written:0,do_sql_measured_at:this.clock
            }));
          }
          async fetch(request) {
            const input=await request.json();
            if(input.reconstruct){this.reconstruct();this.ledger.initialize();}
            if(input.advance) this.clock+=86400000;
            this.cost={reads:0,writes:0};
            if(input.inspect) return Response.json({
              plan:this.ledger.readPlan(input.id),usage:this.ledger.durableSqlDayUsage(this.ledger.day()),
              dispatched:this.dispatched,ledger_sql:this.cost
            });
            const adapter={...identity,
              prepare:async(args)=>{
                if(!Number.isSafeInteger(args.rows)||args.rows<1||args.rows>6000)throw Error('invalid page');
                return {rows:args.rows,id:input.id,bound:{rows_read:0,rows_written:0,requests:1,do_rows_read:args.rows*8+32,do_rows_written:args.rows*2},sha256:'c'.repeat(64)};
              },
              dispatch:async(prepared)=>{
                this.dispatched++;
                const actual=await (await this.env.TARGET.get(this.env.TARGET.idFromName('retained')).fetch('https://target',{
                  method:'POST',body:JSON.stringify({id:input.id,rows:prepared.rows})
                })).json();
                if(input.loseReceipt)throw Error('receipt lost');
                return {actual:{rows_read:0,rows_written:0,requests:1,...actual},result:{rows:prepared.rows}};
              }
            };
            try {
              this.ledger.register({...identity,id:input.id,expires_at:this.clock+60000,
                ...(input.predecessor?{predecessor_id:input.predecessor}:{}),
                prediction:{rows_read:0,rows_written:0,requests:4,do_rows_read:50000,do_rows_written:12000}});
              const result=await new OperationCostExecutor({ledger:this.ledger,adapters:new Map([['seed-page',adapter]])}).execute({
                operation_id:input.id,step_id:'page',adapter_id:'seed-page',arguments:{rows:input.rows}
              });
              return Response.json({result,ledger_sql:this.cost,dispatched:this.dispatched});
            }catch(error){return Response.json({error:error.message,ledger_sql:this.cost,dispatched:this.dispatched});}
          }
        }
        export default {fetch(request,env){
          const binding=new URL(request.url).pathname==='/target'?env.TARGET:env.AUTHORITY;
          return binding.get(binding.idFromName(new URL(request.url).pathname==='/target'?'retained':'original')).fetch(request);
        }};
      `,
      },
    })
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: bundle.outputFiles[0].text,
        compatibilityDate: "2026-08-01",
        durableObjects: {
          AUTHORITY: { className: "Authority", useSQLite: true },
          TARGET: { className: "Target", useSQLite: true },
        },
      }),
    )
    try {
      const call = async (body, path = "/") =>
        (
          await runtime.dispatchFetch("https://test" + path, {
            method: "POST",
            body: JSON.stringify(body),
          })
        ).json()
      const lost = await call({ id: "seed-original", rows: 6000, loseReceipt: true })
      assert.equal(lost.error, "receipt lost")
      assert.equal(lost.dispatched, 1)
      const retained = await call({ id: "seed-original", inspect: true, reconstruct: true })
      assert.equal(retained.usage.do_rows_written, 12000)
      assert.equal(retained.plan.steps.page.status, "reserved")
      const refused = await call({ id: "other-gene", rows: 5000 })
      assert.equal(refused.error, "COST_SHARED_DAILY_LIMIT")
      assert.equal(refused.dispatched, 1)
      assert.equal((await call({ inspect: true }, "/target")).count, 6000)
      const replay = await call({ id: "seed-original", rows: 6000 })
      assert.equal(replay.error, "COST_STEP_ALREADY_RESERVED")
      assert.equal(replay.dispatched, 1)
      const continued = await call({
        id: "seed-next-day",
        predecessor: "seed-original",
        rows: 5000,
        advance: true,
      })
      assert.equal(continued.error, undefined)
      assert.equal(continued.result.result.rows, 5000)
      assert.equal(continued.result.usage.do_rows_written, 22000)
      assert.equal(continued.result.ceiling.do_rows_written, 24000)
      assert.deepEqual(await call({ inspect: true }, "/target"), { count: 11000, sum: 30505500 })
      const exhaustedForecast = await call({
        id: "seed-third-day",
        predecessor: "seed-next-day",
        rows: 2000,
        advance: true,
      })
      assert.equal(exhaustedForecast.error, "COST_TWICE_PREDICTION_LIMIT")
      assert.equal(exhaustedForecast.dispatched, 2)
      t.diagnostic(JSON.stringify({ lost, refused, continued, exhaustedForecast }))
    } finally {
      await runtime.dispose()
    }
  },
)
