// Independent follow-up against b3f2d027. Tests only; no production I/O.
// Uses actual handlers and SQLite, with controlled asynchronous source changes.
// The source-read holds model the await between D1 and local authority; this is
// not a production traffic or native workerd scheduling measurement.
import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'

const root = new URL('../', import.meta.url)
const fixture = readFileSync(new URL('workers/iconoplasm.vote-authority-slice.test.js',root),'utf8')
const marker = 'test("a gene stays on the legacy epoch'
assert.ok(fixture.indexOf(marker)>0,'Inspect changed fixture boundary')
const text = fixture.slice(0,fixture.indexOf(marker)).replace(
  '"./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"',
  JSON.stringify(new URL('workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js',root).href),
)+'\nexport {newCoordinator,seedAuthority,voteOptions,uploadedFor,sha};'
const {newCoordinator,seedAuthority,voteOptions,uploadedFor,sha} = await import('data:text/javascript,'+encodeURIComponent(text))
const candidate = asset => ({asset_sha256:asset,status:'approved',autopick_eligible:1})
const post = (owner,path,body) => owner.fetch(new Request('https://internal'+path,{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbol:'TP53',...body}),
}))
const activation = () => ({published_asset_sha256:sha('a'),published:{content_sha256:sha('e'),object_key:`published-cards/v2/immutable/cards/${sha('e')}.json`}})
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r});return{promise,resolve}}
function source(t,onRead=async rows=>rows){
  const db = new DatabaseSync(':memory:'); t.after(()=>db.close())
  db.exec('CREATE TABLE icono_image_votes(gene_symbol TEXT,user_id TEXT,asset_sha256 TEXT,vote_value INTEGER,PRIMARY KEY(gene_symbol,user_id,asset_sha256))')
  let reads = 0
  const binding = {prepare(query){return{bind(...args){return{
    async all(){const rows=db.prepare(query).all(...args);return{results:await onRead(rows,++reads,db)}},
    async first(){return db.prepare(query).get(...args)},
  }}}}}
  return{db,binding,reads:()=>reads}
}
async function legacy(t){
  const f=await newCoordinator(t)
  f.coordinator.importGeneCandidateAuthority([candidate(sha('a')),candidate(sha('b'))])
  f.coordinator.setMeta('published_asset_sha256',sha('a'))
  f.coordinator.ensureAssetSummaryRow(sha('a'),{visionId:'anima-v1-9'})
  f.coordinator.ensureAssetSummaryRow(sha('b'),{visionId:'anima-v1-8'})
  return f
}
function seedVotes(f,s,count){
  const remote=s.db.prepare('INSERT INTO icono_image_votes VALUES (?,?,?,?)')
  const local=f.sql.db.prepare('INSERT INTO vote_by_user_asset(user_id,asset_sha256,vision_id,vote_value) VALUES (?,?,?,?)')
  for(let i=0;i<count;i++){
    const reader=`reader-${String(i).padStart(5,'0')}`
    remote.run('TP53',reader,sha('a'),1)
    local.run(reader,sha('a'),'anima-v1-9',1)
  }
  f.sql.db.prepare('UPDATE asset_summary SET upvotes=?,vote_count=?,score=? WHERE asset_sha256=?').run(count,count,count,sha('a'))
  f.sql.db.prepare('UPDATE vision_summary SET upvotes=?,vote_count=?,score=? WHERE vision_id=?').run(count,count,count,'anima-v1-9')
}

test('CONTROL: matching stable source can activate with coherent selection',async t=>{
  const f=await legacy(t),s=source(t)
  seedVotes(f,s,501); f.coordinator.env={ICONOPLASM_DB:s.binding}
  const response=await post(f.coordinator,'/authority/activate',activation()),body=await response.json()
  const state=f.coordinator.publication.read()
  t.diagnostic(JSON.stringify({case:'stable_source_control',status:response.status,pages:s.reads(),body,selection:state?.selectionRef}))
  assert.equal(response.status,200)
  assert.equal(f.coordinator.getMeta('authority_epoch'),'v2')
  assert.ok(state.selectionRef.includes(`winner=${sha('a')}`))
})

test('TRANSFER: a changed already-read source row cannot disappear across OFFSET pages',async t=>{
  const f=await legacy(t)
  const s=source(t,async(rows,page,db)=>{
    if(page===1) db.prepare('UPDATE icono_image_votes SET vote_value=-1 WHERE user_id=?').run('reader-00000')
    return rows
  })
  seedVotes(f,s,501); f.coordinator.env={ICONOPLASM_DB:s.binding}
  const response=await post(f.coordinator,'/authority/activate',activation()),body=await response.json()
  const accepted=s.db.prepare('SELECT vote_value FROM icono_image_votes WHERE user_id=?').get('reader-00000').vote_value
  const imported=f.sql.db.prepare('SELECT vote_value FROM vote_by_user_asset WHERE user_id=?').get('reader-00000').vote_value
  t.diagnostic(JSON.stringify({case:'source_change_between_pages',status:response.status,pages:s.reads(),accepted,imported,epoch:f.coordinator.getMeta('authority_epoch'),body}))
  assert.ok(response.status>=400 || accepted===imported,'Live OFFSET reads certified a changed source as a complete snapshot')
})

test('TRANSFER: vote accepted during source verification cannot leave the old selection clean at activation',async t=>{
  const f=await legacy(t),entered=deferred(),release=deferred()
  const s=source(t,async(_rows,page,db)=>{
    if(page===1){entered.resolve();await release.promise}
    return db.prepare('SELECT user_id,asset_sha256,vote_value FROM icono_image_votes ORDER BY user_id,asset_sha256').all()
  })
  f.coordinator.env={ICONOPLASM_DB:s.binding}
  const activating=post(f.coordinator,'/authority/activate',activation())
  await entered.promise
  // The existing public coordinator route accepts a legacy vote while the
  // activation handler is awaiting its D1 source. Mirror the committed D1 row
  // before its local outbox acknowledgement, a valid delivery crash window.
  let voteResponse
  try{
    voteResponse=await post(f.coordinator,'/vote/set',{asset_sha256:sha('b'),user_id:'new-reader',vote_value:1,vision_id:'anima-v1-8'})
    s.db.prepare('INSERT INTO icono_image_votes VALUES (?,?,?,?)').run('TP53','new-reader',sha('b'),1)
  }finally{release.resolve()}
  const response=await activating,body=await response.json()
  assert.equal(voteResponse.status,200,'Setup must accept the concurrent vote')
  const state=f.coordinator.publication.read(),winner=f.coordinator.geneAuthorityWinner().winner?.asset_sha256
  const unsettled=f.coordinator.pendingOutboxRows(10).length
  t.diagnostic(JSON.stringify({case:'vote_during_activation',status:response.status,body,winner,selectionRef:state?.selectionRef,pending:state?.pending,unsettled}))
  assert.ok(response.status>=400 || (state?.pending===true && unsettled===0) ||
    (state?.selectionRef.includes(`winner=${winner}`) && unsettled===0),
    'Activation used an identity captured before the accepted vote and skipped its new unsettled outbox')
})

test('SUPERVOTE: clearing an accepted supervote must not commit ahead of a failed v2 publication intent',async t=>{
  const f=await newCoordinator(t),c=f.coordinator
  await seedAuthority(c,{publishedAssetSha:sha('a'),winnerCandidateRows:[candidate(sha('a')),candidate(sha('b'))]})
  c.ensureAssetSummaryRow(sha('a'),{visionId:'anima-v1-9'})
  c.ensureAssetSummaryRow(sha('b'),{visionId:'anima-v1-8'})
  const event={event_id:'assignment-setup',event_sequence:100,gene:{gene_id:'gene-TP53',canonical_symbol:'TP53'},assignment:{caretaker_assignment_id:'assignment-1',account_id:'reader-1',status:'active',assignment_version:1}}
  assert.equal((await post(c,'/caretaker-assignment/project',{event})).status,200)
  c.caretakerSupervotes.projectAssetEligibility({event_id:'eligibility-setup',source_event_sequence:101,gene_symbol:'TP53',asset_sha256:sha('b'),eligibility_version:1,eligible:1,source_status:'draft'})
  await c.caretakerSupervotes.setSelection({accountId:'reader-1',assetSha256:sha('b'),direction:1,commandId:'setup-supervote',requestSha256:sha('1'),expectedAssignmentVersion:1,expectedSupervoteVersion:0})
  await c.commitAuthorityIntentIfActivated()
  c.genePublicationAdapter=()=>async ticket=>uploadedFor(ticket)
  await c.drainGenePublication()
  assert.equal(c.publication.read().pending,false,'Setup must start clean')
  const before=c.caretakerSupervotes.readHead(),outboxBefore=c.caretakerSupervotes.pendingOutboxRows(100).length
  c.publication.commitSelection=async()=>{throw Error('Audit: publication intent storage unavailable')}
  await assert.rejects(post(c,'/caretaker-supervote/set',{account_id:'reader-1',asset_sha256:null,command_id:'clear-supervote',request_sha256:sha('2'),expected_assignment_version:1,expected_supervote_version:before.supervote_version}),/publication intent storage unavailable/)
  const after=c.caretakerSupervotes.readHead(),state=c.publication.read()
  t.diagnostic(JSON.stringify({case:'supervote_intent_gap',before,after,pending:state.pending,selectionRef:state.selectionRef,newLegacyCaretakerRows:c.caretakerSupervotes.pendingOutboxRows(100).length-outboxBefore}))
  assert.deepEqual(after,before,'The assignment path is atomic, but the supervote path still commits first')
})
