import assert from "node:assert/strict"
import test from "node:test"
import {
  bodyEnvironment,
  bootstrap,
  browserRequest,
  headState,
  humanHandler,
  installBunnyFake,
  row,
} from "./manifestation-plaintext-test-support.js"

// B-859: a caretaker save uploads its bodies and then commits, with no
// reservation row in between, and deletes what the commit did not adopt. These
// drive the real routes over the real schema against a fake storage zone. Ways
// it can fail, written before the code:
// 1. a refused commit leaves its uploaded body behind for good;
// 2. two copies of one save race, and the loser's body is never deleted;
// 3. one of two uploads fails and the other's body is left behind, or deleted
//    before it has landed;
// 4. a commit that lands but reports an error deletes the body it now points at.
// After each, the zone must hold exactly the objects the storage rows point at.

function assertZoneMatchesRows(context, bunny) {
  const referenced = [
    ...context.db.raw
      .prepare("SELECT object_key FROM icono_manifestation_revision_storage_secrets")
      .all(),
    ...context.db.raw
      .prepare("SELECT object_key FROM icono_manifestation_derivative_storage_secrets")
      .all(),
  ]
    .map(({ object_key }) => object_key)
    .sort()
  assert.deepEqual([...bunny.objects.keys()].sort(), referenced)
}

function caretakerRevisions(context) {
  return row(
    context.db,
    "SELECT COUNT(*) AS n FROM icono_manifestation_revisions WHERE caretaker_assignment_id = ?",
    context.assignmentId,
  ).n
}

function saveRequest(context, commandId, prose, manifestationVersion = 0) {
  return browserRequest(`/api/iconoplasm/caretaker/genes/P${context.suffix}/revisions`, {
    command_id: commandId,
    prose,
    expected_assignment_version: 2,
    expected_manifestation_version: manifestationVersion,
  })
}

test("a save the database refuses deletes the body it uploaded", async (t) => {
  const bunny = installBunnyFake(t)
  const context = await bootstrap(t, "8101", bunny)
  const handler = humanHandler(context, bodyEnvironment())
  const saved = await handler(saveRequest(context, "uploaded_body_first", "The first text."))
  assert.ok([200, 202].includes(saved.status), `save answered ${saved.status}`)
  bunny.clearLog()
  const stale = await handler(saveRequest(context, "uploaded_body_stale", "Against version 0."))
  assert.equal(stale.status, 409)
  assert.equal(bunny.count("PUT"), 1)
  assert.equal(bunny.count("DELETE"), 1)
  assert.equal(caretakerRevisions(context), 1)
  assertZoneMatchesRows(context, bunny)
})

test("when two copies of one save race, the loser deletes its own upload", async (t) => {
  const bunny = installBunnyFake(t)
  const context = await bootstrap(t, "8102", bunny)
  const handler = humanHandler(context, bodyEnvironment())
  const request = () => saveRequest(context, "uploaded_body_race", "One text, sent twice.")
  // The first copy passes the replay check, and while its upload is in flight
  // the second copy runs start to finish and commits.
  let second = null
  bunny.rules.push(async ({ method }) => {
    if (method !== "PUT" || second) return null
    second = await handler(request())
    return null
  })
  const first = await handler(request())
  assert.ok([200, 202].includes(second.status), `second copy answered ${second.status}`)
  assert.ok([200, 202].includes(first.status), `first copy answered ${first.status}`)
  const [a, b] = [await first.json(), await second.json()]
  assert.equal(a.manifestation_revision_id, b.manifestation_revision_id)
  assert.equal(bunny.count("PUT"), 2)
  assert.equal(bunny.count("DELETE"), 1)
  assert.equal(caretakerRevisions(context), 1)
  assertZoneMatchesRows(context, bunny)
})

test("when one of a save's two uploads fails, nothing commits and no body is left", async (t) => {
  const bunny = installBunnyFake(t)
  const context = await bootstrap(t, "8103", bunny)
  const handler = humanHandler(context, bodyEnvironment())
  let puts = 0
  bunny.rules.push(async ({ method }) => {
    if (method !== "PUT" || ++puts !== 2) return null
    return new Response("storage unavailable", { status: 500 })
  })
  const head = headState(context)
  const response = await handler(
    browserRequest(`/api/iconoplasm/caretaker/genes/P${context.suffix}/saves`, {
      command_id: "uploaded_body_half",
      prose: "A text whose Tags upload fails.",
      tags_text: "careful_gaze, red_coat",
      fields_json: { face: ["careful_gaze"], outfit: ["red_coat"] },
      expected_assignment_version: 2,
      expected_manifestation_version: 0,
      expected_head_version: head.expectedHeadVersion,
      expected_canonical_revision_id: head.expectedCanonicalRevisionId,
    }),
  )
  assert.ok(response.status >= 500, `save answered ${response.status}`)
  assert.equal(caretakerRevisions(context), 0)
  assert.equal(bunny.count("DELETE"), 2)
  assertZoneMatchesRows(context, bunny)
})

test("a commit that lands but reports an error keeps the body it points at", async (t) => {
  const bunny = installBunnyFake(t)
  const context = await bootstrap(t, "8104", bunny)
  const handler = humanHandler(context, bodyEnvironment())
  const batch = context.db.batch.bind(context.db)
  let lose = true
  context.db.batch = async (statements) => {
    const results = await batch(statements)
    if (lose && statements.some(({ sql }) => sql.includes("icono_authoring_command_receipts"))) {
      lose = false
      throw new Error("D1_ERROR: Network connection lost.")
    }
    return results
  }
  const response = await handler(saveRequest(context, "uploaded_body_lost_reply", "Committed."))
  assert.ok([200, 202].includes(response.status), `save answered ${response.status}`)
  assert.equal(lose, false, "the commit's reply was lost")
  assert.equal(bunny.count("DELETE"), 0)
  assert.equal(caretakerRevisions(context), 1)
  assertZoneMatchesRows(context, bunny)
})
