import assert from "node:assert/strict"
import test from "node:test"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { writeFileSync } from "node:fs"
import esbuild from "esbuild"

const root = new URL("../", import.meta.url)
const evidence = {
  source: "d00ae8e39bb5c2115c5a70d42a8ca76fc84127ce",
  scope: "Isolated native workerd/SQLite DO route measurement, no production access. Warm object, one candidate, no historical votes. D1 source verification deliberately omitted to measure favorable DO-only work, not a full production transfer.",
  cases: {},
}
function receipt(name, value) {
  evidence.cases[name] = value
  writeFileSync(new URL("v2-transfer-batch-cost-evidence.json", root), JSON.stringify(evidence, null, 2))
  console.log("V2_TRANSFER_COST", name, JSON.stringify(value))
}

async function fixture(t) {
  const require = createRequire(import.meta.url)
  const { Miniflare, convertV4MiniflareOptions } = createRequire(require.resolve("wrangler/package.json"))("miniflare")
  const bundle = await esbuild.build({
    bundle: true, write: false, format: "esm", platform: "browser", target: "es2022",
    external: ["cloudflare:*", "node:*"],
    stdin: {
      resolveDir: fileURLToPath(root),
      contents: `
import {IconoplasmVoteCoordinator as Coordinator} from './workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js';
export class Probe {
  constructor(state) {
    this.state=state;
    this.reset();
    const sql={exec:(query,...args)=>{
      const cursor=state.storage.sql.exec(query,...args);
      const rows=cursor.toArray();
      this.cost.rows_read+=cursor.rowsRead;
      this.cost.rows_written+=cursor.rowsWritten;
      if(cursor.rowsWritten) this.cost.mutations.push({query,rows_written:cursor.rowsWritten});
      return {toArray:()=>rows};
    }};
    const storage={
      sql,
      transaction:fn=>state.storage.transaction(fn),
      transactionSync:fn=>state.storage.transactionSync(fn),
      getAlarm:async()=>{this.cost.alarm_reads++;return state.storage.getAlarm()},
      setAlarm:async value=>{this.cost.alarm_writes++;return state.storage.setAlarm(value)}
    };
    // No production D1 binding: this favorable fixture excludes the extra D1
    // source verification and vote import costs. Actual DO SQL is unchanged.
    this.coordinator=new Coordinator({storage,blockConcurrencyWhile:fn=>state.blockConcurrencyWhile(fn)},{});
  }
  reset(){this.cost={rows_read:0,rows_written:0,alarm_reads:0,alarm_writes:0,mutations:[]}}
  async alarm(){throw Error('Unexpected automatic alarm')}
  async fetch(request){
    const input=await request.json();
    if(input.prepare){
      this.coordinator.setMeta('symbol','TP53');
      this.coordinator.setMeta('bootstrapped','1');
      this.coordinator.setMeta('admin_override','0');
      this.coordinator.setMeta('published_asset_sha256','a'.repeat(64));
      this.coordinator.ensureAssetSummaryRow('a'.repeat(64),{visionId:'anima-v1-9'});
      return Response.json({prepared:true});
    }
    this.reset();
    const response=await this.coordinator.fetch(new Request('https://internal'+input.path,{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbol:'TP53',...input.body})
    }));
    const body=await response.json();
    const cost=structuredClone(this.cost);
    return Response.json({status:response.status,body,cost});
  }
}
export default {fetch(request,env){return env.PROBE.get(env.PROBE.idFromName(new URL(request.url).searchParams.get('id'))).fetch(request)}}
`,
    },
  })
  const runtime = new Miniflare(convertV4MiniflareOptions({
    modules:true, script:bundle.outputFiles[0].text, compatibilityDate:"2026-08-01",
    compatibilityFlags:["nodejs_compat"], durableObjects:{PROBE:{className:"Probe",useSQLite:true}},
  }))
  t.after(()=>runtime.dispose())
  return async (id, input) => {
    const response=await runtime.dispatchFetch(`https://test/?id=${id}`,{method:"POST",body:JSON.stringify(input)})
    const text=await response.text()
    assert.equal(response.status,200,text)
    return JSON.parse(text)
  }
}
const candidate={asset_sha256:"a".repeat(64),status:"approved",autopick_eligible:1}
const activation={published_asset_sha256:"a".repeat(64),admin_override:false,published:{content_sha256:"e".repeat(64),object_key:"cards/verified-existing.json"}}

test("measure real candidate and activation routes, then exact replay",{timeout:120000},async t=>{
  const send=await fixture(t)
  await send("single",{prepare:true})
  const imported=await send("single",{path:"/authority/candidates",body:{items:[candidate]}})
  const activated=await send("single",{path:"/authority/activate",body:activation})
  assert.equal(imported.status,200,JSON.stringify(imported))
  assert.equal(activated.status,200,JSON.stringify(activated))
  assert.equal(activated.body.authority_epoch,"v2")
  const repeatedImport=await send("single",{path:"/authority/candidates",body:{items:[candidate]}})
  const repeatedActivation=await send("single",{path:"/authority/activate",body:activation})
  assert.equal(repeatedImport.status,200)
  assert.equal(repeatedActivation.status,200)
  const total={rows_read:imported.cost.rows_read+activated.cost.rows_read,rows_written:imported.cost.rows_written+activated.cost.rows_written,alarm_writes:imported.cost.alarm_writes+activated.cost.alarm_writes}
  receipt("warm_one_candidate_transfer",{
    imported,activated,repeatedImport,repeatedActivation,total,
    hypothetical_identical_genes:19023,
    scaled_sql_writes:19023*total.rows_written,
    quoted_application_do_write_allowance:70000,
    fits_quoted_allowance:19023*total.rows_written<=70000,
    exclusions:"constructor/schema installation, baseline preparation, D1 source checks and vote imports, snapshot capture, outer authentication/admission, network wrappers, progress receipts, unrelated traffic. Population scaling is a conditional calculation, not a production inventory.",
  })
})

test("record activation semantics for an empty candidate set",{timeout:120000},async t=>{
  const send=await fixture(t)
  await send("empty",{prepare:true})
  const imported=await send("empty",{path:"/authority/candidates",body:{items:[]}})
  const activated=await send("empty",{path:"/authority/activate",body:activation})
  receipt("empty_candidates",{imported,activated})
  assert.equal(imported.status,200)
  assert.equal(activated.status,409)
  assert.equal(activated.body.code,"NO_AUTHORITY_WINNER")
})
