/** B-762 independent audit against 48408d8a. These are EXPECTED-TO-FAIL
 * regression tests until the reported defects are repaired. No production I/O.
 * Reuses the existing integrated suite's SQLite fixture, not its test cases.
 * The native test separately measures the real coordinator in workerd.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
const root = new URL('../', import.meta.url)
const fixturePath = new URL('workers/iconoplasm.vote-authority-slice.test.js', root)
const runtimePath = new URL('workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js', root)
const source = readFileSync(fixturePath, 'utf8')
const marker = 'test("a gene stays on the legacy epoch'
assert.ok(source.indexOf(marker) > 0, 'Fixture boundary changed; inspect before rerunning')
const fixtureSource = source.slice(0, source.indexOf(marker)).replace(
  '"./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"',
  JSON.stringify(runtimePath.href),
) + '\nexport {newCoordinator, seedAuthority, voteOptions, uploadedFor, sha};'
const {newCoordinator, seedAuthority, voteOptions, uploadedFor, sha} = await import(
  'data:text/javascript,' + encodeURIComponent(fixtureSource)
)
const candidate = (asset, extra = {}) => ({asset_sha256: asset, status:'approved', autopick_eligible:1, ...extra})
const call = (coordinator, path, body) => coordinator.fetch(new Request(`https://internal${path}`, {
  method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({symbol:'TP53', ...body}),
}))
async function seeded(t) {
  const f = await newCoordinator(t)
  await seedAuthority(f.coordinator, {publishedAssetSha:sha('a'), winnerCandidateRows:[candidate(sha('a')),candidate(sha('b'))]})
  f.coordinator.ensureAssetSummaryRow(sha('a'), {visionId:'anima-v1-9'})
  f.coordinator.ensureAssetSummaryRow(sha('b'), {visionId:'anima-v1-8'})
  return f
}
async function dirty(t) {
  const f = await seeded(t)
  await f.coordinator.applyAuthoritativeVoteMutation(voteOptions(f.coordinator,sha('b'),{visionId:'anima-v1-8'}))
  assert.equal(f.coordinator.publication.read().pending,true,'Setup must create pending v2 publication')
  return f
}

test('EXCISION: an activated v2 vote must not append the old D1/Queue outbox', async t => {
  const {coordinator} = await seeded(t)
  const outcome = await coordinator.applyAuthoritativeVoteMutation(voteOptions(coordinator,sha('a'),{visionId:'anima-v1-9'}))
  const legacyRows = coordinator.pendingOutboxRows().length
  t.diagnostic(JSON.stringify({case:'v2_legacy_outbox',authority:outcome.authority,voteChanged:outcome.vote.changed,publicationChanged:outcome.publication.changed,legacyRows}))
  assert.equal(legacyRows,0)
})

test('LIVENESS: newly created legacy delivery work must have a durable wake', async t => {
  const {coordinator,alarm} = await seeded(t)
  await coordinator.applyAuthoritativeVoteMutation(voteOptions(coordinator,sha('a'),{visionId:'anima-v1-9'}))
  const rows = coordinator.pendingOutboxRows().length
  t.diagnostic(JSON.stringify({case:'neutral_vote_wake',legacyRows:rows,alarm:alarm()}))
  assert.ok(rows === 0 || alarm() !== null,'Content-neutral vote left legacy work unarmed')
})

test('LIVENESS: actual alarm must process publication-only pending work', async t => {
  const {coordinator,sql,setAlarm} = await dirty(t)
  // Simulate the intended end state with legacy delivery already retired.
  sql.db.exec('DELETE FROM vote_outbox')
  setAlarm(null) // Native getAlarm returns null after delivery starts.
  let adapterCalls = 0
  coordinator.genePublicationAdapter = () => async ticket => {adapterCalls++;return uploadedFor(ticket)}
  const result = await coordinator.alarm()
  t.diagnostic(JSON.stringify({case:'publication_only_alarm',result,adapterCalls,stillPending:coordinator.publication.read().pending}))
  assert.equal(adapterCalls,1)
  assert.equal(coordinator.publication.read().pending,false)
})

test('ISOLATION: a legacy D1 pause must not prevent a D1-free publication', async t => {
  const {coordinator,sql,setAlarm} = await dirty(t)
  sql.db.exec('DELETE FROM vote_outbox')
  coordinator.setMeta('outbox_budget_retry_at',String(Date.now()+86400000))
  setAlarm(null)
  let adapterCalls = 0
  coordinator.genePublicationAdapter = () => async ticket => {adapterCalls++;return uploadedFor(ticket)}
  const result = await coordinator.alarm()
  t.diagnostic(JSON.stringify({case:'d1_pause_blocks_bunny',result,adapterCalls}))
  assert.equal(adapterCalls,1)
})

test('MIGRATION: oversized candidate batches must reject before silently dropping candidates', async t => {
  const {coordinator,sql} = await newCoordinator(t)
  const items = Array.from({length:65},(_,i)=>candidate((i+1).toString(16).padStart(64,'0')))
  const response = await call(coordinator,'/authority/candidates',{items})
  const body = await response.json()
  const stored = sql.db.prepare('SELECT COUNT(*) AS n FROM gene_candidate_authority').get().n
  t.diagnostic(JSON.stringify({case:'65_candidate_import',status:response.status,reported:body.candidate_count,stored}))
  assert.ok(response.status >= 400,'Silently accepted a truncated 65-candidate batch')
  assert.equal(stored,0)
})

test('MIGRATION: missing items must not delete the complete candidate authority', async t => {
  const {coordinator,sql} = await seeded(t)
  const response = await call(coordinator,'/authority/candidates',{})
  const remaining = sql.db.prepare('SELECT COUNT(*) AS n FROM gene_candidate_authority').get().n
  t.diagnostic(JSON.stringify({case:'missing_candidate_payload',status:response.status,remaining}))
  assert.ok(response.status >= 400)
  assert.equal(remaining,2)
})

test('CANON: withdrawing the current winner must atomically mark replacement pending', async t => {
  const {coordinator} = await seeded(t)
  const response = await call(coordinator,'/authority/candidates',{items:[candidate(sha('a'),{status:'rejected',autopick_eligible:0}),candidate(sha('b'))]})
  const body = await response.json()
  const state = coordinator.publication.read()
  t.diagnostic(JSON.stringify({case:'withdrawal',status:response.status,winner:body.winner_asset_sha256,selectionRef:state.selectionRef,pending:state.pending}))
  assert.equal(body.winner_asset_sha256,sha('b'))
  assert.equal(state.pending,true)
  assert.ok(state.selectionRef.includes(`winner=${sha('b')}`))
})

test('MIGRATION: activation must bind the seeded pointer to its administrator override', async t => {
  const {coordinator} = await newCoordinator(t)
  coordinator.importGeneCandidateAuthority([candidate(sha('a'),{created_at:'2026-01-02'}),candidate(sha('b'),{created_at:'2026-01-01'})])
  const response = await call(coordinator,'/authority/activate',{
    published_asset_sha256:sha('b'),admin_override:true,
    published:{content_sha256:sha('e'),object_key:'published-cards/v2/immutable/cards/seed.json'},
  })
  const body = await response.json()
  const state = coordinator.publication.read()
  t.diagnostic(JSON.stringify({case:'activation_override',status:response.status,reported:body.winner_asset_sha256,actual:coordinator.geneAuthorityWinner().winner?.asset_sha256,selectionRef:state?.selectionRef}))
  assert.equal(response.status,200)
  assert.ok(state.selectionRef.includes(`winner=${sha('b')}`),'Seeded clean pointer names the pre-override election')
  assert.ok(state.selectionRef.includes('admin=1'))
})

test('EXCISION: an empty eligible set must not silently downgrade an activated v2 gene', async t => {
  const {coordinator} = await seeded(t)
  coordinator.importGeneCandidateAuthority([])
  const outcome = await coordinator.applyAuthoritativeVoteMutation(voteOptions(coordinator,sha('a'),{visionId:'anima-v1-9'}))
  t.diagnostic(JSON.stringify({case:'v2_authority_downgrade',authority:outcome.authority,epoch:coordinator.getMeta('authority_epoch')}))
  assert.equal(outcome.authority,'v2')
})

test('COST: duplicate v2 votes must not export every historical asset summary', async t => {
  const {coordinator} = await seeded(t)
  await coordinator.applyAuthoritativeVoteMutation(voteOptions(coordinator,sha('a'),{visionId:'anima-v1-9'}))
  let exports = 0
  const original = coordinator.exportAssetSummaries.bind(coordinator)
  coordinator.exportAssetSummaries = () => {exports++;return original()}
  const outcome = await coordinator.applyAuthoritativeVoteMutation(voteOptions(coordinator,sha('a'),{visionId:'anima-v1-9'}))
  t.diagnostic(JSON.stringify({case:'duplicate_vote_history_exports',voteChanged:outcome.vote.changed,exports}))
  assert.equal(exports,0)
})

test('COST RECEIPTS: measure actual legacy and v2 routes in native workerd', {timeout:120000}, async t => {
  const require = createRequire(import.meta.url)
  const {Miniflare,convertV4MiniflareOptions} = createRequire(require.resolve('wrangler/package.json'))('miniflare')
  const esbuild = await import('esbuild')
  const bundle = await esbuild.build({bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',external:['cloudflare:*','node:*'],stdin:{resolveDir:fileURLToPath(root),contents:`
    import {IconoplasmVoteCoordinator as Coordinator} from './workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js';
    export class Probe {
      constructor(state) {
        this.state=state;this.cost={rows_read:0,rows_written:0,alarm_reads:0,alarm_writes:0};
        const sql={exec:(query,...args)=>{const cursor=state.storage.sql.exec(query,...args);const rows=cursor.toArray();this.cost.rows_read+=cursor.rowsRead;this.cost.rows_written+=cursor.rowsWritten;return{toArray:()=>rows}}};
        const storage={sql,transaction:fn=>state.storage.transaction(fn),transactionSync:fn=>state.storage.transactionSync(fn),getAlarm:async()=>{this.cost.alarm_reads++;return state.storage.getAlarm()},setAlarm:async time=>{this.cost.alarm_writes++;return state.storage.setAlarm(Math.max(time,Date.now()+86400000))}};
        this.coordinator=new Coordinator({storage,blockConcurrencyWhile:fn=>state.blockConcurrencyWhile(fn)},{ICONOPLASM_DB:{prepare(){throw Error('Unexpected D1 access')}}});
      }
      async alarm(){throw Error('Unexpected automatic alarm during isolated audit')}
      async fetch(request){
        const path=new URL(request.url).pathname;
        const input=await request.json();
        if(path==='/seed'){
          this.state.storage.sql.exec("WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<?) INSERT INTO asset_summary(asset_sha256,vision_id,candidate_image_id) SELECT printf('%064x',n),'anima-v1-9',n FROM ids",input.assets);
          this.coordinator.setMeta('symbol','TP53');this.coordinator.setMeta('bootstrapped','1');
          if(input.v2){
            this.coordinator.importGeneCandidateAuthority([1,2].map(n=>({asset_sha256:n.toString(16).padStart(64,'0'),status:'approved',autopick_eligible:1})));
            this.coordinator.setMeta('published_asset_sha256','1'.padStart(64,'0'));
            await this.coordinator.publication.seedPublished(this.coordinator.authoritativeSelectionIdentity(),{contentSha256:'e'.repeat(64),objectKey:'cards/seed.json'});
            this.coordinator.setMeta('authority_epoch','v2');
          }
          return Response.json({ok:true,epoch:this.coordinator.getMeta('authority_epoch')||'legacy'});
        }
        this.cost={rows_read:0,rows_written:0,alarm_reads:0,alarm_writes:0};
        const response=await this.coordinator.fetch(new Request('https://internal/vote/set',{method:'POST',body:JSON.stringify(input)}));
        const body=await response.json();
        const cost={...this.cost};
        return Response.json({status:response.status,authority:body.authority,changed:body.changed,publicationChanged:body.publication?.changed,cost,legacyOutboxRows:this.coordinator.pendingOutboxRows(100).length});
      }
    }
    export default {fetch(request,env){return env.PROBE.get(env.PROBE.idFromName(new URL(request.url).searchParams.get('id'))).fetch(request)}}
  `}})
  const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2025-11-12',compatibilityFlags:['nodejs_compat'],durableObjects:{PROBE:{className:'Probe',useSQLite:true}}}))
  t.after(()=>runtime.dispose())
  const send=async(id,path,body)=>(await runtime.dispatchFetch(`https://test${path}?id=${id}`,{method:'POST',body:JSON.stringify(body)})).json()
  const receipts=[]
  for(const [v2,assets] of [[false,2],[false,10000],[true,2],[true,1000],[true,10000]]){
    const id=`${v2?'v2':'legacy'}-${assets}`
    const seed=await send(id,'/seed',{assets,v2})
    assert.equal(seed.epoch,v2?'v2':'legacy')
    const input={symbol:'TP53',asset_sha256:'1'.padStart(64,'0'),user_id:'test-reader',vote_value:1}
    const vote=await send(id,'/vote',input)
    const duplicate=await send(id,'/vote',input)
    t.diagnostic(JSON.stringify({case:'native_route_cost',assets,v2,vote,duplicate}))
    assert.equal(vote.status,200)
    assert.equal(duplicate.status,200)
    assert.equal(vote.authority,v2?'v2':'legacy')
    receipts.push({assets,v2,vote,duplicate})
  }
  const small=receipts.find(r=>r.v2&&r.assets===2)
  const large=receipts.find(r=>r.v2&&r.assets===10000)
  assert.ok(large.duplicate.cost.rows_read<=small.duplicate.cost.rows_read+200,
    'Activated v2 reintroduces history-dependent reads even for duplicate votes: '+JSON.stringify(receipts))
})
