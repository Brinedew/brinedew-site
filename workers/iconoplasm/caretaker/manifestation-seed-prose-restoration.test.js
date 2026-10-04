import assert from "node:assert/strict"
import test from "node:test"

import { createIconoplasmCaretakerAdminHandlers } from "../../iconoplasm-caretaker-admin-routes.js"
import { SEED_RESTORE_WORST_CASE_FETCHES } from "./manifestation-seed-prose-restoration.js"
import { readCanonicalProjectionRecord } from "./manifestation-authority.js"
import { row, rows, sha } from "./manifestation-authority-test-support.js"
import { ADMIN } from "./manifestation-plaintext-test-support.js"
import {
  ENCODER,
  longText,
  normalize,
  crop,
  restore,
  restoreCommand,
  selectCaretaker,
  sleep,
  stateOf,
  tableCounts,
  totalChanges,
  world,
} from "./manifestation-seed-restore-test-support.js"
import { sha256Hex } from "../../lib/iconoplasm-sha256.js"

// B-977: the cutover importer cut 6,817 seed manifestations at 4,000 characters,
// and the full texts survive only on the workstation. Restoring one appends a
// revision to the gene's seed manifestation, selects it, and carries the seed's
// Tags over, atomically. Failure modes, written before the code:
//  1. A gene a caretaker has edited or selected gets its canonical text replaced
//     (the one loss nobody can undo: caretaker prose is the point of the site).
//  2. A text that is not the seed's own continuation (the workstation holds a
//     different text for HIST1H2BK, IGKV1OR2-108 and two more) replaces the seed.
//  3. A replay of the same command id (a retry after a Worker CPU kill) writes a
//     second revision, or the same id with different bytes is accepted.
//  4. A write that lands between the read and the commit (a caretaker selecting
//     their own text) is overwritten: the compare-and-swap does not hold.
//  5. The new revision is canonical but has no accepted Tags, so image generation
//     for that gene fails until a model call; or the carried Tags are not the old
//     bytes, fields and provenance.
//  6. A text over 10,000 characters, one not longer than 4,000, or one with control
//     characters is accepted.
//  7. A refused restore (quota) leaves a revision, a selection, a reservation or
//     an object behind.
//  8. A Bunny that serves nothing makes the call blow the 50-fetch cap of a
//     free-plan Worker, or commits a revision whose object is not readable.
//  9. The restore leaves two active seeds, withdraws the seed, or rewrites the
//     old revision or its Tags.

test("restoring a cut seed appends a revision, selects it and carries the Tags, in one event", async (t) => {
  const w = await world(t, "0001")
  const before = stateOf(w)
  const changesBefore = totalChanges(w.db)
  w.bunny.clearLog()

  const result = await restore(w)

  assert.equal(result.status, "restored")
  assert.equal(result.tags_carried, true)
  assert.equal(result.revision_number, 2)

  // The new revision is the seed lineage's second, child of the cut head, with the
  // full normalized text as its body.
  const revision = row(
    w.db,
    `SELECT revision.*, storage.object_key FROM icono_manifestation_revisions revision
       JOIN icono_manifestation_revision_storage_secrets storage USING (manifestation_revision_id)
      WHERE revision.manifestation_revision_id = ?`,
    result.manifestation_revision_id,
  )
  const fullBytes = ENCODER.encode(normalize(w.fullText))
  assert.equal(revision.revision_number, 2)
  assert.equal(revision.parent_revision_id, w.seedRevisionId)
  assert.equal(revision.author_account_id, null)
  assert.equal(revision.body_sha256, await sha256Hex(fullBytes))
  assert.deepEqual(Buffer.from(w.bunny.objects.get(revision.object_key)), Buffer.from(fullBytes))

  // The gene's canonical selection moved to it, as a migration selection.
  const head = row(w.db, "SELECT * FROM icono_manifestation_heads WHERE gene_id = ?", w.geneId)
  assert.equal(head.canonical_revision_id, revision.manifestation_revision_id)
  assert.equal(head.head_version, before.head.head_version + 1)
  assert.equal(head.gene_revision, before.head.gene_revision + 1)
  const selection = row(
    w.db,
    "SELECT * FROM icono_manifestation_canonical_selections WHERE canonical_selection_id = ?",
    head.canonical_selection_id,
  )
  assert.equal(selection.reason, "migration")
  assert.equal(selection.previous_revision_id, w.seedRevisionId)
  assert.equal(selection.actor_account_id, null)

  // Still exactly one active seed, not withdrawn, now headed by the new revision;
  // the cut revision and its Tags are untouched history.
  const seeds = rows(
    w.db,
    "SELECT * FROM icono_manifestations WHERE gene_id = ? AND origin = 'system_seed'",
    w.geneId,
  )
  assert.equal(seeds.length, 1)
  assert.equal(seeds[0].status, "active")
  assert.equal(seeds[0].manifestation_head_revision_id, revision.manifestation_revision_id)
  assert.deepEqual(stateOf(w).revisions[0], before.revisions[0])
  const oldHead = row(
    w.db,
    "SELECT accepted_derivative_id FROM icono_manifestation_derivative_heads WHERE manifestation_revision_id = ?",
    w.seedRevisionId,
  )
  assert.equal(oldHead.accepted_derivative_id, w.seedTags.derivativeId)

  // The Tags: a new derivative, accepted for the new revision, bound to the new
  // body hash, with the old tags text, fields and provenance, and a new object
  // holding the same bytes.
  const oldTags = row(
    w.db,
    "SELECT * FROM icono_manifestation_derivatives WHERE manifestation_derivative_id = ?",
    w.seedTags.derivativeId,
  )
  const newTags = row(
    w.db,
    `SELECT derivative.*, storage.object_key FROM icono_manifestation_derivatives derivative
       JOIN icono_manifestation_derivative_storage_secrets storage USING (manifestation_derivative_id)
      WHERE derivative.manifestation_derivative_id = ?`,
    result.manifestation_derivative_id,
  )
  assert.equal(newTags.manifestation_revision_id, revision.manifestation_revision_id)
  assert.equal(newTags.source_body_sha256, revision.body_sha256)
  for (const column of [
    "status",
    "body_sha256",
    "body_bytes",
    "tags_sha256",
    "tags_bytes",
    "fields_sha256",
    "fields_bytes",
    "recipe_id",
    "recipe_version",
    "provider_id",
    "model_id",
    "tagger_config_sha256",
    "provenance_status",
  ]) {
    assert.equal(newTags[column], oldTags[column], column)
  }
  assert.notEqual(newTags.object_key, w.seedTags.tagsKey)
  assert.deepEqual(
    Buffer.from(w.bunny.objects.get(newTags.object_key)),
    Buffer.from(w.seedTags.payload.output_bytes),
  )
  const newHead = row(
    w.db,
    "SELECT * FROM icono_manifestation_derivative_heads WHERE manifestation_revision_id = ?",
    revision.manifestation_revision_id,
  )
  assert.equal(newHead.accepted_derivative_id, newTags.manifestation_derivative_id)

  // The projection reads the canonical record from this row set: it sees the new
  // revision with its accepted Tags.
  const canonical = await readCanonicalProjectionRecord(w.db, w.geneId)
  assert.equal(canonical.canonical.manifestation_revision_id, revision.manifestation_revision_id)
  assert.equal(
    canonical.accepted_tags_derivative.manifestation_derivative_id,
    newTags.manifestation_derivative_id,
  )
  assert.equal(canonical.accepted_tags_derivative.source_body_sha256, revision.body_sha256)

  // One command, one event, pending for the normal projection.
  const events = rows(
    w.db,
    "SELECT * FROM icono_manifestation_events WHERE gene_id = ? AND gene_revision = ?",
    w.geneId,
    head.gene_revision,
  )
  assert.equal(events.length, 1)
  assert.equal(events[0].event_uuid, result.event_id)
  assert.equal(events[0].projection_status, "pending")
  const payload = JSON.parse(events[0].payload_json)
  assert.equal(payload.cause, "manifestation.seed_prose_restored")
  assert.equal(
    payload.changed_revision.manifestation_revision_id,
    revision.manifestation_revision_id,
  )
  assert.equal(
    payload.changed_derivative.manifestation_derivative_id,
    newTags.manifestation_derivative_id,
  )

  // Both upload intents were adopted by the batch, so nothing is left to sweep.
  const intents = rows(
    w.db,
    "SELECT status FROM icono_manifestation_upload_intents WHERE entity_id IN (?, ?)",
    revision.manifestation_revision_id,
    newTags.manifestation_derivative_id,
  )
  assert.deepEqual(
    intents.map((intent) => intent.status),
    ["adopted", "adopted"],
  )
  assert.equal(
    row(w.db, "SELECT body_reserved_bytes AS n FROM icono_authority_state").n,
    0,
    "reservations are released",
  )

  // Cost: one read of the old Tags, two PUTs, two read-backs when Bunny behaves.
  assert.equal(w.bunny.count("GET"), 3)
  assert.equal(w.bunny.count("PUT"), 2)
  assert.equal(result.bunny_fetches, 5)
  // Regression bound on the authority rows the restore changes (table rows and
  // trigger rows; D1 also counts index entries, see scripts/restore-cropped-seed-prose.mjs).
  assert.ok(
    totalChanges(w.db) - changesBefore <= 60,
    `changed ${totalChanges(w.db) - changesBefore}`,
  )
})

test("a gene a caretaker has selected is skipped and nothing is written", async (t) => {
  const w = await world(t, "0002", { caretaker: true })
  await selectCaretaker(w, "0002")
  const canonicalBefore = row(
    w.db,
    "SELECT canonical_revision_id FROM icono_manifestation_heads WHERE gene_id = ?",
    w.geneId,
  ).canonical_revision_id
  assert.equal(canonicalBefore, w.caretakerRevisionId)
  const counts = tableCounts(w.db)
  w.bunny.clearLog()

  const result = await restore(w)

  assert.equal(result.status, "skipped_caretaker_canonical")
  assert.deepEqual(tableCounts(w.db), counts)
  assert.equal(w.bunny.log.length, 0, "no storage request is spent on a gene we will skip")
  assert.equal(
    row(
      w.db,
      "SELECT canonical_revision_id FROM icono_manifestation_heads WHERE gene_id = ?",
      w.geneId,
    ).canonical_revision_id,
    w.caretakerRevisionId,
  )
})

test("a gene whose caretaker edited but did not select still restores, and leaves the caretaker's revision", async (t) => {
  const w = await world(t, "0003", { caretaker: true })
  const counts = tableCounts(w.db)

  const result = await restore(w)

  assert.equal(result.status, "restored")
  const caretaker = row(
    w.db,
    "SELECT * FROM icono_manifestation_revisions WHERE manifestation_revision_id = ?",
    w.caretakerRevisionId,
  )
  assert.ok(caretaker, "the caretaker's revision is still there")
  assert.equal(
    tableCounts(w.db).icono_manifestation_revisions,
    counts.icono_manifestation_revisions + 1,
  )
  assert.equal(
    row(
      w.db,
      "SELECT manifestation_head_revision_id AS id FROM icono_manifestations WHERE manifestation_id = ?",
      `manifestation_caretaker_0003`,
    ).id,
    w.caretakerRevisionId,
  )
})

test("text that is not the seed's own continuation is refused and writes nothing", async (t) => {
  const w = await world(t, "0004")
  const counts = tableCounts(w.db)
  w.bunny.clearLog()
  // Same length class, different words: the workstation's text for a handful of
  // genes differs from what the site holds.
  const other = longText(6200, "Different")

  const result = await restore(w, { prose: other })

  assert.equal(result.status, "skipped_not_cropped")
  assert.equal(result.reason, "different_text")
  assert.deepEqual(tableCounts(w.db), counts)
  assert.equal(w.bunny.log.length, 0)
})

test("a text that agrees only up to character 3,999 is refused (the crop is the exact first 4,000)", async (t) => {
  const w = await world(t, "0005")
  const chars = Array.from(normalize(w.fullText))
  chars[3999] = chars[3999] === "x" ? "y" : "x"
  const counts = tableCounts(w.db)

  const result = await restore(w, { prose: chars.join("") })

  assert.equal(result.status, "skipped_not_cropped")
  assert.deepEqual(tableCounts(w.db), counts)
})

test("a gene that was already restored is not cropped any more", async (t) => {
  const w = await world(t, "0006")
  assert.equal((await restore(w)).status, "restored")
  const counts = tableCounts(w.db)
  w.bunny.clearLog()

  const again = await restore(w) // a new command id: tomorrow night's pass

  assert.equal(again.status, "skipped_not_cropped")
  assert.equal(again.reason, "already_full")
  assert.deepEqual(tableCounts(w.db), counts)
  assert.equal(w.bunny.log.length, 0)
})

test("the same command id replays the first answer and writes nothing; other bytes under it are refused", async (t) => {
  const w = await world(t, "0007")
  const cmd = restoreCommand("replay")
  const first = await restore(w, { cmd })
  assert.equal(first.status, "restored")
  const counts = tableCounts(w.db)
  w.bunny.clearLog()

  const replay = await restore(w, { cmd })

  assert.equal(replay.replayed, true)
  assert.equal(replay.manifestation_revision_id, first.manifestation_revision_id)
  assert.deepEqual(tableCounts(w.db), counts)
  assert.equal(w.bunny.log.length, 0)

  await assert.rejects(
    restore(w, { cmd: { ...cmd, requestSha256: sha("b") } }),
    (error) => error.code === "IDEMPOTENCY_KEY_REUSED" && error.status === 409,
  )
})

test("a write that lands between the read and the commit makes the restore refuse (compare-and-swap)", async (t) => {
  const w = await world(t, "0008", { caretaker: true })
  const real = w.db
  let fired = false
  // A real competing command, run at the moment the restore's batch starts: the
  // caretaker selects their own revision after the restore read the seed as canonical.
  const racing = {
    prepare: (sql) => real.prepare(sql),
    batch: async (statements) => {
      if (!fired) {
        fired = true
        await selectCaretaker(w, "0008")
      }
      return real.batch(statements)
    },
  }
  const revisionsBefore = tableCounts(real).icono_manifestation_revisions

  await assert.rejects(
    restore(w, { db: racing }),
    (error) => error.code === "STALE_AUTHORITY_STATE" && error.status === 409,
  )

  assert.equal(fired, true)
  assert.equal(
    row(
      real,
      "SELECT canonical_revision_id FROM icono_manifestation_heads WHERE gene_id = ?",
      w.geneId,
    ).canonical_revision_id,
    w.caretakerRevisionId,
    "the caretaker's selection stands",
  )
  assert.equal(tableCounts(real).icono_manifestation_revisions, revisionsBefore)
  assert.equal(
    row(
      real,
      "SELECT count(*) AS n FROM icono_manifestation_canonical_selections WHERE reason = 'migration'",
    ).n,
    0,
  )
  // The uploads the refused restore made stay unadopted intents; the ordinary
  // expired-upload sweep deletes them and their objects.
  assert.equal(
    row(
      real,
      "SELECT count(*) AS n FROM icono_manifestation_upload_intents WHERE status = 'uploading'",
    ).n,
    2,
  )
})

test("a seed whose Tags changed between the read and the commit also refuses", async (t) => {
  const w = await world(t, "0009")
  const real = w.db
  let fired = false
  const racing = {
    prepare: (sql) => real.prepare(sql),
    batch: async (statements) => {
      if (!fired) {
        fired = true
        // A second accepted derivative on the seed head, as a service Tags submission would make.
        real.raw
          .prepare(
            "UPDATE icono_manifestation_derivative_heads SET derivative_head_version = derivative_head_version + 1 WHERE manifestation_revision_id = ?",
          )
          .run(w.seedRevisionId)
      }
      return real.batch(statements)
    },
  }
  await assert.rejects(
    restore(w, { db: racing }),
    (error) => error.code === "STALE_AUTHORITY_STATE",
  )
  assert.equal(
    row(real, "SELECT count(*) AS n FROM icono_manifestation_revisions WHERE revision_number = 2")
      .n,
    0,
  )
})

test("a gene with no Tags restores without them; legacy-unknown provenance is copied as it is", async (t) => {
  const bare = await world(t, "0010", { tags: false })
  const result = await restore(bare)
  assert.equal(result.status, "restored")
  assert.equal(result.tags_carried, false)
  assert.equal(
    row(
      bare.db,
      "SELECT accepted_derivative_id FROM icono_manifestation_derivative_heads WHERE manifestation_revision_id = ?",
      result.manifestation_revision_id,
    ).accepted_derivative_id,
    null,
  )
  assert.equal(bare.bunny.count("PUT"), 1)

  const legacy = await world(t, "0011", { tags: "legacy_unknown" })
  const restored = await restore(legacy)
  assert.equal(restored.status, "restored")
  const tags = row(
    legacy.db,
    "SELECT provenance_status, recipe_id FROM icono_manifestation_derivatives WHERE manifestation_derivative_id = ?",
    restored.manifestation_derivative_id,
  )
  assert.equal(tags.provenance_status, "legacy_unknown")
  assert.equal(tags.recipe_id, null)
})

test("text over 10,000 characters, not longer than 4,000, or with control characters is refused", async (t) => {
  const w = await world(t, "0012")
  const counts = tableCounts(w.db)
  w.bunny.clearLog()
  const tooLong = longText(10001, "Alpha")
  const bad = [
    [tooLong, /10000|exceeds/],
    [crop(w.fullText), /longer than 4000/],
    [`${w.fullText}\u0007`, /control/],
    ["", /empty|text/],
  ]
  for (const [prose, pattern] of bad) {
    await assert.rejects(
      restore(w, { prose }),
      (error) =>
        error.code === "INVALID_SEED_RESTORE_REQUEST" &&
        error.status === 400 &&
        pattern.test(error.message),
    )
  }
  assert.deepEqual(tableCounts(w.db), counts)
  assert.equal(w.bunny.log.length, 0)
})

test("a text of exactly 10,000 characters restores", async (t) => {
  const w = await world(t, "0013", { full: longText(10000, "Alpha") })
  const result = await restore(w)
  assert.equal(result.status, "restored")
})

test("a quota refusal reserves nothing, stores nothing and commits nothing", async (t) => {
  const w = await world(t, "0014")
  const state = row(
    w.db,
    "SELECT body_admitted_bytes, body_admitted_limit_bytes FROM icono_authority_state",
  )
  const proseBytes = ENCODER.encode(normalize(w.fullText)).byteLength
  // Room for the text but not for the Tags next to it.
  w.db.raw
    .prepare("UPDATE icono_authority_state SET body_admitted_limit_bytes = ?")
    .run(Number(state.body_admitted_bytes) + proseBytes + 5)
  const counts = tableCounts(w.db)
  w.bunny.clearLog()

  await assert.rejects(
    restore(w),
    (error) => error.code === "AUTHORITY_BODY_QUOTA_EXCEEDED" && error.status === 429,
  )

  assert.deepEqual(tableCounts(w.db), counts, "no intent, revision or selection")
  assert.equal(w.bunny.count("PUT"), 0)
  assert.equal(row(w.db, "SELECT body_reserved_bytes AS n FROM icono_authority_state").n, 0)
})

test("a Bunny that never serves the text fails the call within the 50-fetch cap with nothing committed", async (t) => {
  const w = await world(t, "0015")
  w.bunny.rules.push(({ method }) =>
    method === "PUT" ? new Response(null, { status: 500 }) : null,
  )
  w.bunny.clearLog()
  const revisionsBefore = tableCounts(w.db).icono_manifestation_revisions

  await assert.rejects(
    restore(w),
    (error) => error.code === "SEED_BODY_NOT_VERIFIED" && error.status === 503,
  )

  assert.equal(w.bunny.log.length, 1 + 3 * 6, "the Tags read, then 3 PUTs with 5 read-backs each")
  assert.ok(w.bunny.log.length <= SEED_RESTORE_WORST_CASE_FETCHES)
  assert.equal(tableCounts(w.db).icono_manifestation_revisions, revisionsBefore)
  assert.equal(
    row(
      w.db,
      "SELECT canonical_revision_id FROM icono_manifestation_heads WHERE gene_id = ?",
      w.geneId,
    ).canonical_revision_id,
    w.seedRevisionId,
  )
})

test("a Bunny that serves each new object only on its last read still fits: 37 fetches, the worst case", async (t) => {
  const w = await world(t, "0016")
  const reads = new Map()
  const stored = new Set()
  w.bunny.rules.push(({ method, objectKey }) => {
    if (method === "PUT") stored.add(objectKey)
    if (method !== "GET" || !stored.has(objectKey)) return null
    reads.set(objectKey, (reads.get(objectKey) ?? 0) + 1)
    return reads.get(objectKey) < 18 - 3 ? new Response(null, { status: 404 }) : null
  })
  w.bunny.clearLog()

  const result = await restore(w)

  assert.equal(result.status, "restored")
  assert.equal(w.bunny.log.length, SEED_RESTORE_WORST_CASE_FETCHES)
  assert.equal(SEED_RESTORE_WORST_CASE_FETCHES, 37)
  assert.equal(result.bunny_fetches, 37)
})

test("a PUT repeated until Bunny serves it commits the verified bytes", async (t) => {
  const w = await world(t, "0017")
  let puts = 0
  w.bunny.rules.push(({ method }) => {
    if (method !== "PUT") return null
    puts += 1
    // The first two PUTs are acknowledged and ignored, as Bunny has been seen to do.
    return puts <= 2 ? new Response(null, { status: 201 }) : null
  })

  const result = await restore(w)

  assert.equal(result.status, "restored")
  const key = row(
    w.db,
    "SELECT object_key FROM icono_manifestation_revision_storage_secrets WHERE manifestation_revision_id = ?",
    result.manifestation_revision_id,
  ).object_key
  assert.deepEqual(
    Buffer.from(w.bunny.objects.get(key)),
    Buffer.from(ENCODER.encode(normalize(w.fullText))),
  )
})

test("an unreadable seed Tags object fails the call before any upload", async (t) => {
  const w = await world(t, "0018")
  w.bunny.objects.delete(w.seedTags.tagsKey)
  const counts = tableCounts(w.db)
  w.bunny.clearLog()

  await assert.rejects(
    restore(w),
    (error) => error.code === "SEED_TAGS_UNREADABLE" && error.status === 503,
  )

  assert.deepEqual(tableCounts(w.db), counts)
  assert.equal(w.bunny.count("PUT"), 0)
})

test("CRLF text restores as its normalized form: the crop proof is on the normalized prefix", async (t) => {
  const crlf = longText(6200, "Alpha").replace(/ protein /g, " protein\r\n")
  const w = await world(t, "0019", { full: crlf })

  const result = await restore(w, { prose: crlf })

  assert.equal(result.status, "restored")
  const hash = row(
    w.db,
    "SELECT body_sha256 FROM icono_manifestation_revisions WHERE manifestation_revision_id = ?",
    result.manifestation_revision_id,
  ).body_sha256
  assert.equal(hash, await sha256Hex(ENCODER.encode(normalize(crlf))))
})

// The admin route: authorization, the bounded body, and delivery of the accepted
// event to the projection the way every other admin command is delivered.
function routeHandlers({ authorized = true, wakeCalls = [], pending = false } = {}) {
  return createIconoplasmCaretakerAdminHandlers({
    isAdmin: async () => authorized,
    json: (value, status = 200, headers = {}) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { "content-type": "application/json", ...headers },
      }),
    resolveActiveAccount: async () => ({ account_id: ADMIN }),
    wakeAuthorityProjection: async (_env, event) => {
      wakeCalls.push(event.event_id)
      return {
        ok: true,
        results: [{ event_id: event.event_id, status: pending ? "pending" : "published" }],
      }
    },
    sleep,
  })
}

async function callRoute(handlers, w, body) {
  const request = new Request(
    "https://iconoplasm.brinedew.bio/api/iconoplasm/admin/caretakers/restore-seed-prose",
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test" },
      body: JSON.stringify(body),
    },
  )
  const response = await handlers["caretaker_admin.restore_seed_prose"]({
    request,
    env: { ...w.env, ICONOPLASM_AUTHORING_DB: w.db },
    done: (_name, answer) => answer,
  })
  return { status: response.status, body: await response.json() }
}

test("the route restores one gene and wakes the projection with the accepted event", async (t) => {
  const w = await world(t, "0020")
  const wakeCalls = []
  const handlers = routeHandlers({ wakeCalls })
  const body = { command_id: "restore_route_0020_a", gene_symbol: w.symbol, prose: w.fullText }

  const answer = await callRoute(handlers, w, body)

  assert.equal(answer.status, 200, JSON.stringify(answer.body))
  assert.equal(answer.body.status, "restored")
  assert.equal(wakeCalls.length, 1)
  assert.equal(wakeCalls[0], answer.body.event_id)
  assert.equal(
    row(
      w.db,
      "SELECT projection_status FROM icono_manifestation_events WHERE event_uuid = ?",
      answer.body.event_id,
    ).projection_status,
    "published",
  )

  // A retry of the identical call (a Worker killed after the commit) replays.
  const retry = await callRoute(handlers, w, body)
  assert.equal(retry.status, 200)
  assert.equal(retry.body.replayed, true)
  assert.equal(retry.body.manifestation_revision_id, answer.body.manifestation_revision_id)
  assert.equal(
    row(w.db, "SELECT count(*) AS n FROM icono_manifestation_revisions WHERE revision_number = 2")
      .n,
    1,
  )
})

test("the route answers 202 when the projection is still pending, and 200 for a skip", async (t) => {
  const w = await world(t, "0021")
  const pending = await callRoute(routeHandlers({ pending: true }), w, {
    command_id: "restore_route_0021_a",
    gene_symbol: w.symbol,
    prose: w.fullText,
  })
  assert.equal(pending.status, 202)
  assert.equal(pending.body.projection_pending, true)
  assert.equal(pending.body.status, "restored")

  const skipped = await callRoute(routeHandlers(), w, {
    command_id: "restore_route_0021_b",
    gene_symbol: w.symbol,
    prose: w.fullText,
  })
  assert.equal(skipped.status, 200)
  assert.equal(skipped.body.status, "skipped_not_cropped")
})

test("the route refuses a caller who is not an administrator, and a malformed body", async (t) => {
  const w = await world(t, "0022")
  const counts = tableCounts(w.db)
  const denied = await callRoute(routeHandlers({ authorized: false }), w, {
    command_id: "restore_route_0022_a",
    gene_symbol: w.symbol,
    prose: w.fullText,
  })
  assert.equal(denied.status, 403)
  const noCommand = await callRoute(routeHandlers(), w, {
    gene_symbol: w.symbol,
    prose: w.fullText,
  })
  assert.equal(noCommand.status, 400)
  const noGene = await callRoute(routeHandlers(), w, {
    command_id: "restore_route_0022_b",
    gene_symbol: "NOSUCHGENE",
    prose: w.fullText,
  })
  assert.equal(noGene.status, 404)
  assert.deepEqual(tableCounts(w.db), counts)
})
