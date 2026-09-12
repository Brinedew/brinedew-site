import assert from "node:assert/strict"
import test from "node:test"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import esbuild from "esbuild"

test(
  "eligibility-only changes do not rescan retained history or pending delivery",
  { timeout: 60000 },
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
        resolveDir: fileURLToPath(new URL("../../../", import.meta.url)),
        contents: `
        import {CaretakerSupervoteLedger} from './workers/iconoplasm/caretaker/caretaker-supervote.js';
        export class TestLedger {
          constructor(state) {
            this.state=state; this.cost={rows_read:0,rows_written:0};
            const sql={exec:(query,...args)=>{
              const cursor=state.storage.sql.exec(query,...args); const rows=cursor.toArray();
              this.cost.rows_read+=cursor.rowsRead; this.cost.rows_written+=cursor.rowsWritten;
              return {toArray:()=>rows};
            }};
            this.ledger=new CaretakerSupervoteLedger({storage:{sql,transactionSync:fn=>state.storage.transactionSync(fn)},getSymbol:()=>'TP53'});
            this.ledger.install();
          }
          async fetch(request) {
            if(new URL(request.url).pathname==='/seed') {
              this.state.storage.sql.exec("WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<100) INSERT INTO caretaker_supervote_audit(mutation_id,event_type,command_id,caretaker_assignment_id,caretaker_account_id,assignment_status,assignment_version,supervote_version) SELECT 'm'||n,'supervote_changed','c'||n,'assignment','account','active',1,n FROM ids");
              this.state.storage.sql.exec("INSERT INTO caretaker_supervote_command_receipts(command_id,request_sha256,response_json) SELECT command_id,'hash','{}' FROM caretaker_supervote_audit");
              this.state.storage.sql.exec("WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<20100) INSERT INTO caretaker_supervote_outbox(mutation_id,payload_json,delivered_at) SELECT 'm'||n,'{}',CASE WHEN n<=100 THEN CURRENT_TIMESTAMP ELSE NULL END FROM ids");
              return Response.json({ok:true});
            }
            this.cost={rows_read:0,rows_written:0};
            if(new URL(request.url).pathname==='/compact') {
              this.ledger.compactHistory();
              return Response.json({cost:this.cost});
            }
            const result=this.ledger.projectAssetEligibilityBatch({projections:Array.from({length:1000},(_,i)=>({event_id:'eligibility-'+(i+1),source_event_sequence:i+1,gene_symbol:'TP53',asset_sha256:(i+1).toString(16).padStart(64,'0'),eligibility_version:1,eligible:1,source_status:'draft'}))});
            const cost={...this.cost};
            const counts=this.state.storage.sql.exec('SELECT (SELECT COUNT(*) FROM caretaker_supervote_audit) AS audit, (SELECT COUNT(*) FROM caretaker_supervote_command_receipts) AS receipts, (SELECT COUNT(*) FROM caretaker_supervote_outbox WHERE delivered_at IS NULL) AS pending, (SELECT COUNT(*) FROM caretaker_supervote_outbox WHERE delivered_at IS NOT NULL) AS delivered').toArray()[0];
            return Response.json({changed:result.changed,cost,counts});
          }
        }
        export default {fetch(request,env){return env.LEDGER.get(env.LEDGER.idFromName('TP53')).fetch(request)}}
      `,
      },
    })
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: bundle.outputFiles[0].text,
        compatibilityDate: "2026-08-01",
        durableObjects: { LEDGER: { className: "TestLedger", useSQLite: true } },
      }),
    )
    try {
      await runtime.dispatchFetch("https://test/seed")
      const first = await (await runtime.dispatchFetch("https://test/project")).json()
      t.diagnostic(JSON.stringify(first))
      assert.equal(first.changed, 1000)
      assert.deepEqual(first.counts, { audit: 100, receipts: 100, pending: 20000, delivered: 100 })
      assert.ok(first.cost.rows_read <= 10000, JSON.stringify(first.cost))
      assert.ok(first.cost.rows_written <= 4000, JSON.stringify(first.cost))
      const repeat = await (await runtime.dispatchFetch("https://test/project")).json()
      assert.equal(repeat.changed, 0)
      assert.equal(repeat.cost.rows_written, 0)
      assert.deepEqual(repeat.counts, first.counts)
      const compact = await (await runtime.dispatchFetch("https://test/compact")).json()
      t.diagnostic(JSON.stringify({ compact }))
      assert.ok(compact.cost.rows_read <= 1000, JSON.stringify(compact.cost))
      assert.equal(compact.cost.rows_written, 0)
    } finally {
      await runtime.dispose()
    }
  },
)
