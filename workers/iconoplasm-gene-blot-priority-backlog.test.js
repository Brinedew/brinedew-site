// B-898 Stage 1 (step B): the candidate blot backlog answers from D1 and the
// stable gene objects only. The workstation drain POSTs
// {scope:"candidate", symbols:[], limit:25} and parses: items[] (symbol,
// scope, blot_fingerprint, renderer_revision, portrait_url, card_payload),
// symbols, candidate_symbols, render_queue_complete, next_after, failed,
// deferred. Failure modes, written before the code:
//   1. a gene whose winner changed after the watermark and has no blot is listed;
//   2. a gene whose current winner already has a current blot row is not listed,
//      and the watermark advances past it with zero storage reads;
//   3. a gene with no stable object yet is skipped, not an error, and holds the
//      watermark so the next poll re-examines it;
//   4. `limit` bounds the page and next_after lets the drain resume;
//   5. the stored high-water mark advances past listed and satisfied genes, and
//      an idle poll afterwards reads two indexed rows and writes nothing;
//   6. a storage error on one gene does not fail the page;
//   7. a stable object behind D1 (portrait differs) is held, never listed with
//      the wrong fingerprint;
//   8. a cold watermark starts at the newest event instead of walking history;
//   9. only canonical-affecting actions count: the drain's own
//      gene_blot_materialized event never re-triggers a render;
//  10. explicit symbols check exactly those genes and leave the watermark alone;
//  11. no query in the handler walks a whole table.
import assert from "node:assert/strict"
import test from "node:test"

import {
  ICONOPLASM_GENE_BLOT_RENDERER_REVISION,
  iconoplasmGeneBlotFingerprint,
} from "./iconoplasm-gene-card-materialization-runtime-inside-the-only-allowed-internal-stateful-worker-do-not-duplicate.js"
import { listIconoplasmGeneBlotBacklog } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import {
  SqliteD1,
  backlogEnv,
  backlogRequest,
  installStableObjectStorage,
  stableGeneObject,
  stableObjectPath,
} from "./iconoplasm-blot-backlog-test-d1.js"

const SHA_A = "a".repeat(64)
const SHA_B = "b".repeat(64)
const SHA_C = "c".repeat(64)

function currentBlot(object) {
  return {
    fingerprint: iconoplasmGeneBlotFingerprint(object),
    portraitSha: object.portrait.asset_sha256,
    rendererRevision: ICONOPLASM_GENE_BLOT_RENDERER_REVISION,
  }
}

async function candidate(env, payload) {
  return listIconoplasmGeneBlotBacklog(env, {
    request: backlogRequest(),
    payload: { scope: "candidate", symbols: [], limit: 25, ...payload },
  })
}

test("candidate backlog lists a gene whose winner changed after the watermark and has no blot", async (t) => {
  const db = new SqliteD1()
  db.exec(
    "INSERT INTO icono_gene_blot_backlog_watermark (watermark_key, through_event_id) VALUES ('candidate', 0)",
  )
  db.seedGene("TP53", { winner: SHA_A })
  db.event("TP53", "vote_auto_promote", { to: SHA_A })
  const object = stableGeneObject("TP53", { portraitSha: SHA_A })
  const reads = installStableObjectStorage(t, new Map([[stableObjectPath("TP53"), object]]))

  const result = await candidate(backlogEnv(db), {})

  assert.equal(result.ok, true)
  assert.equal(result.automatic, true)
  assert.equal(result.items.length, 1)
  const item = result.items[0]
  assert.equal(item.symbol, "TP53")
  assert.equal(item.scope, "candidate")
  assert.equal(item.blot_fingerprint, iconoplasmGeneBlotFingerprint(object))
  assert.equal(item.renderer_revision, ICONOPLASM_GENE_BLOT_RENDERER_REVISION)
  assert.equal(item.portrait_asset_sha256, SHA_A)
  assert.equal(item.portrait_url, object.portrait.hero_url)
  assert.equal(item.card_payload.full_name, "TP53 full name")
  assert.equal(item.card_payload.portrait.asset_sha256, SHA_A)
  assert.equal(
    "portrait_candidates" in item.card_payload,
    false,
    "the drain renders a card, not the candidate pool",
  )
  assert.match(
    item.upload_url,
    /\/api\/iconoplasm\/admin\/blots\/TP53\?scope=candidate&fingerprint=/,
  )
  assert.deepEqual(result.symbols, ["TP53"])
  assert.deepEqual(result.candidate_symbols, ["TP53"])
  assert.equal(result.render_queue_complete, true)
  assert.equal(result.done, true)
  assert.deepEqual(reads, [stableObjectPath("TP53")])
})

test("candidate backlog skips a gene whose current winner already has a current blot row", async (t) => {
  const db = new SqliteD1()
  db.exec(
    "INSERT INTO icono_gene_blot_backlog_watermark (watermark_key, through_event_id) VALUES ('candidate', 0)",
  )
  const object = stableGeneObject("BRCA1", { portraitSha: SHA_B })
  db.seedGene("BRCA1", { winner: SHA_B, blot: currentBlot(object) })
  const eventId = db.event("BRCA1", "publish", { to: SHA_B })
  const reads = installStableObjectStorage(t, new Map([[stableObjectPath("BRCA1"), object]]))

  const result = await candidate(backlogEnv(db), {})

  assert.deepEqual(result.items, [])
  assert.deepEqual(result.symbols, [])
  assert.equal(result.render_queue_complete, true)
  assert.equal(result.through_event_id, eventId)
  assert.equal(db.watermark(), eventId, "a satisfied gene advances the stored watermark")
  assert.deepEqual(reads, [], "a D1 row that already matches costs no storage read")
})

test("candidate backlog lists a gene whose blot belongs to the previous winner", async (t) => {
  const db = new SqliteD1()
  db.exec(
    "INSERT INTO icono_gene_blot_backlog_watermark (watermark_key, through_event_id) VALUES ('candidate', 0)",
  )
  const previous = stableGeneObject("EGFR", { portraitSha: SHA_A })
  db.seedGene("EGFR", { winner: SHA_B, blot: currentBlot(previous) })
  db.event("EGFR", "publish", { from: SHA_A, to: SHA_B })
  const current = stableGeneObject("EGFR", { portraitSha: SHA_B })
  installStableObjectStorage(t, new Map([[stableObjectPath("EGFR"), current]]))

  const result = await candidate(backlogEnv(db), {})

  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].blot_fingerprint, iconoplasmGeneBlotFingerprint(current))
  assert.equal(result.items[0].portrait_asset_sha256, SHA_B)
})

test("candidate backlog skips a gene with no stable object yet and holds the watermark", async (t) => {
  const db = new SqliteD1()
  db.exec(
    "INSERT INTO icono_gene_blot_backlog_watermark (watermark_key, through_event_id) VALUES ('candidate', 0)",
  )
  db.seedGene("NEWG", { winner: SHA_A })
  db.seedGene("TP53", { winner: SHA_B })
  const held = db.event("NEWG", "publish", { to: SHA_A })
  db.event("TP53", "publish", { to: SHA_B })
  installStableObjectStorage(
    t,
    new Map([[stableObjectPath("TP53"), stableGeneObject("TP53", { portraitSha: SHA_B })]]),
  )

  const result = await candidate(backlogEnv(db), {})

  assert.equal(result.ok, true)
  assert.deepEqual(
    result.items.map((item) => item.symbol),
    ["TP53"],
    "the gene with an object is still served",
  )
  assert.equal(result.skipped.missing, 1)
  assert.equal(
    result.through_event_id,
    held - 1,
    "the watermark stops before the held gene's event",
  )
  assert.equal(db.watermark(), 0, "nothing before the held event: the stored mark does not move")
  assert.equal(result.render_queue_complete, false, "the held gene keeps the drain polling")
})

test("candidate backlog respects limit and returns an event cursor the drain can resume from", async (t) => {
  const db = new SqliteD1()
  db.exec(
    "INSERT INTO icono_gene_blot_backlog_watermark (watermark_key, through_event_id) VALUES ('candidate', 0)",
  )
  const objects = new Map()
  const events = []
  for (const symbol of ["A1", "A2", "A3"]) {
    db.seedGene(symbol, { winner: SHA_A })
    events.push(db.event(symbol, "publish", { to: SHA_A }))
    objects.set(stableObjectPath(symbol), stableGeneObject(symbol, { portraitSha: SHA_A }))
  }
  const reads = installStableObjectStorage(t, objects)

  const first = await candidate(backlogEnv(db), { limit: 2 })
  assert.deepEqual(
    first.items.map((item) => item.symbol),
    ["A1", "A2"],
  )
  assert.equal(first.render_queue_complete, false)
  assert.equal(first.done, false)
  assert.equal(first.next_after, String(events[1]), "resume after the last handed-out gene's event")
  assert.equal(reads.length, 2, "storage reads are bounded by limit, not by the pending set")

  // The drain uppercases the cursor and sends it back as `after`.
  const second = await candidate(backlogEnv(db), {
    limit: 2,
    after: String(first.next_after).toUpperCase(),
  })
  assert.deepEqual(
    second.items.map((item) => item.symbol),
    ["A3"],
  )
  assert.equal(second.render_queue_complete, true)
  assert.equal(second.through_event_id, events[2])
  assert.equal(db.watermark(), events[2])
})

test("candidate backlog advances the stored high-water mark and idles with zero storage reads and zero writes", async (t) => {
  const db = new SqliteD1()
  db.exec(
    "INSERT INTO icono_gene_blot_backlog_watermark (watermark_key, through_event_id) VALUES ('candidate', 0)",
  )
  const listedObject = stableGeneObject("TP53", { portraitSha: SHA_A })
  const satisfiedObject = stableGeneObject("BRCA1", { portraitSha: SHA_B })
  db.seedGene("TP53", { winner: SHA_A })
  db.seedGene("BRCA1", { winner: SHA_B, blot: currentBlot(satisfiedObject) })
  db.event("TP53", "publish", { to: SHA_A })
  const last = db.event("BRCA1", "publish", { to: SHA_B })
  const reads = installStableObjectStorage(t, new Map([[stableObjectPath("TP53"), listedObject]]))

  const first = await candidate(backlogEnv(db), {})
  assert.deepEqual(
    first.items.map((item) => item.symbol),
    ["TP53"],
  )
  assert.equal(db.watermark(), last, "listed and satisfied genes both move the mark")

  const queriesBefore = db.queries.length
  const writesBefore = db.rowsWritten
  const idle = await candidate(backlogEnv(db), {})
  assert.deepEqual(idle.items, [])
  assert.equal(idle.render_queue_complete, true)
  assert.equal(reads.length, 1, "the idle poll made no storage read")
  assert.equal(db.writesSince(writesBefore), 0, "an idle poll writes nothing")
  const idleQueries = db.queriesSince(queriesBefore)
  assert.equal(
    idleQueries.length,
    2,
    `idle poll = watermark row + empty event window, got ${idleQueries.length}`,
  )
})

test("a storage error on one gene does not fail the candidate page", async (t) => {
  const db = new SqliteD1()
  db.exec(
    "INSERT INTO icono_gene_blot_backlog_watermark (watermark_key, through_event_id) VALUES ('candidate', 0)",
  )
  db.seedGene("BAD1", { winner: SHA_A })
  db.seedGene("GOOD", { winner: SHA_B })
  const badEvent = db.event("BAD1", "publish", { to: SHA_A })
  db.event("GOOD", "publish", { to: SHA_B })
  installStableObjectStorage(
    t,
    new Map([
      [stableObjectPath("BAD1"), { throw: true }],
      [stableObjectPath("GOOD"), stableGeneObject("GOOD", { portraitSha: SHA_B })],
    ]),
  )

  const result = await candidate(backlogEnv(db), {})

  assert.equal(result.ok, true)
  assert.deepEqual(
    result.items.map((item) => item.symbol),
    ["GOOD"],
  )
  assert.equal(result.skipped.errors, 1)
  assert.equal(
    result.through_event_id,
    badEvent - 1,
    "a storage failure holds the mark like a missing object",
  )
})

test("a stable object behind D1 is held, never listed with the wrong fingerprint", async (t) => {
  const db = new SqliteD1()
  db.exec(
    "INSERT INTO icono_gene_blot_backlog_watermark (watermark_key, through_event_id) VALUES ('candidate', 0)",
  )
  db.seedGene("LAG1", { winner: SHA_B })
  db.event("LAG1", "reject", { from: SHA_A, to: SHA_B })
  // The Actions publisher has not rewritten the object yet: it still shows SHA_A.
  installStableObjectStorage(
    t,
    new Map([[stableObjectPath("LAG1"), stableGeneObject("LAG1", { portraitSha: SHA_A })]]),
  )

  const result = await candidate(backlogEnv(db), {})

  assert.deepEqual(result.items, [])
  assert.equal(result.skipped.stale, 1)
  assert.equal(db.watermark(), 0)
  assert.equal(result.render_queue_complete, false)
})

test("a cold watermark starts at the newest canonical event instead of walking history", async (t) => {
  const db = new SqliteD1()
  db.seedGene("OLD1", { winner: SHA_A })
  db.seedGene("OLD2", { winner: SHA_B })
  db.event("OLD1", "publish", { to: SHA_A })
  const newest = db.event("OLD2", "publish", { to: SHA_B })
  db.event("OLD2", "gene_blot_materialized", { to: SHA_B })
  const reads = installStableObjectStorage(t, new Map())

  const result = await candidate(backlogEnv(db), {})

  assert.deepEqual(result.items, [])
  assert.equal(result.through_event_id, newest)
  assert.equal(
    db.watermark(),
    newest,
    "history belongs to the published walk; the cold mark is persisted",
  )
  assert.deepEqual(reads, [])
})

test("the drain's own gene_blot_materialized event never re-triggers a render", async (t) => {
  const db = new SqliteD1()
  db.exec(
    "INSERT INTO icono_gene_blot_backlog_watermark (watermark_key, through_event_id) VALUES ('candidate', 0)",
  )
  db.seedGene("TP53", { winner: SHA_A })
  db.event("TP53", "gene_blot_materialized", { to: SHA_A })
  db.event("TP53", "gene_card_materialized", { to: SHA_A })
  const reads = installStableObjectStorage(
    t,
    new Map([[stableObjectPath("TP53"), stableGeneObject("TP53", { portraitSha: SHA_A })]]),
  )

  const result = await candidate(backlogEnv(db), {})

  assert.deepEqual(result.items, [])
  assert.deepEqual(reads, [])
  assert.equal(result.render_queue_complete, true)
})

test("explicit candidate symbols check exactly those genes and leave the watermark alone", async (t) => {
  const db = new SqliteD1()
  db.exec(
    "INSERT INTO icono_gene_blot_backlog_watermark (watermark_key, through_event_id) VALUES ('candidate', 7)",
  )
  const ready = stableGeneObject("DONE", { portraitSha: SHA_C })
  db.seedGene("WANT", { winner: SHA_A })
  db.seedGene("DONE", { winner: SHA_C, blot: currentBlot(ready) })
  db.seedGene("NONE", { winner: null })
  db.seedGene("OTHR", { winner: SHA_B })
  db.event("OTHR", "publish", { to: SHA_B })
  const reads = installStableObjectStorage(
    t,
    new Map([
      [stableObjectPath("WANT"), stableGeneObject("WANT", { portraitSha: SHA_A })],
      [stableObjectPath("OTHR"), stableGeneObject("OTHR", { portraitSha: SHA_B })],
    ]),
  )

  const result = await candidate(backlogEnv(db), { symbols: ["want", "DONE", "NONE"] })

  assert.equal(result.automatic, false)
  assert.deepEqual(
    result.items.map((item) => item.symbol),
    ["WANT"],
  )
  assert.deepEqual(result.symbols, ["WANT", "DONE", "NONE"])
  assert.deepEqual(result.candidate_symbols, ["WANT", "DONE", "NONE"])
  assert.equal(result.render_queue_complete, true)
  assert.deepEqual(
    reads,
    [stableObjectPath("WANT")],
    "a gene without a winner needs no blot and no read",
  )
  assert.equal(db.watermark(), 7)
})

test("candidate backlog queries are bounded: every D1 read names a key range or list and a limit", async (t) => {
  const db = new SqliteD1()
  db.exec(
    "INSERT INTO icono_gene_blot_backlog_watermark (watermark_key, through_event_id) VALUES ('candidate', 0)",
  )
  db.seedGene("TP53", { winner: SHA_A })
  db.event("TP53", "publish", { to: SHA_A })
  installStableObjectStorage(
    t,
    new Map([[stableObjectPath("TP53"), stableGeneObject("TP53", { portraitSha: SHA_A })]]),
  )

  await candidate(backlogEnv(db), {})

  const selects = db.queries.filter((sql) => /^\s*SELECT/i.test(sql))
  assert.ok(selects.length >= 3, "watermark, event window, readiness join")
  for (const sql of selects) {
    assert.match(sql, /\bWHERE\b/, `unbounded read: ${sql.slice(0, 80)}`)
    assert.ok(
      /\bLIMIT\b/.test(sql) || /\bIN \(/.test(sql),
      `page-unbounded read: ${sql.slice(0, 80)}`,
    )
    assert.doesNotMatch(sql, /COUNT\(\*\)/i, "no whole-table counts in the drain's poll")
  }
})
