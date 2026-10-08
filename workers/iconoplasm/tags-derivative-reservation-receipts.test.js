import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test, { after, before } from "node:test"

import { handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate as gateway } from "../iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import {
  offerCaretakerAssignment,
  registerAuthorityAccount,
  registerCaretakerTermsVersion,
  registerGeneIdentity,
  seedSystemManifestation,
  transitionCaretakerAssignment,
} from "./caretaker/manifestation-authority.js"
import { command, sha, storage } from "./caretaker/manifestation-authority-test-support.js"
import { createReplicaOperationCostAdapter } from "./operation-cost-replica-adapter.js"
import { drainManifestationPublicCardPublicationWakes } from "../iconoplasm-manifestation-publication-wake.js"
import { drainManifestationAuthorityProjectionOutbox } from "../lib/iconoplasm-manifestation-authority-projection.js"
import {
  MUTATION_WRITE_FLOOR_UNITS,
  TAGS_DERIVATIVE_SUBMIT_ROWS,
  laptopReservation,
} from "../lib/iconoplasm-mutation-write-bounds.js"
import {
  liveD1Meter,
  openMigratedD1,
  realBudgetLedger,
  spyOnLedger,
} from "../test-helpers/reservation-receipts-harness.js"

// B-945. The tags-derivative submission reserved the 50-unit floor with a comment
// saying nobody had measured it. One command is a batch in the authoring D1
// (derivative, event, outbox, head, storage secret) and then the
// in-process projection of the accepted event into the primary D1. (The issue
// named a second route, the head selection; the gateway hands that one to the
// operation-cost authority before the budget wrapper, so it never reserved.)
//
// How a reservation could under-count (written before the tests, B-945):
// 1. Writes in two D1s counted as one.
// 2. The projection runs after the response is built and writes more.
// 3. A complete submission writes a storage secret that a failed one does not.
// 4. A replay is billed as a fresh write.
// 5. A refusal consumes the reservation, so the identical retry is refused forever.
// 6. A later migration adds an index or trigger and the number drifts.
// Each test drives the real command through the real gateway on real D1 receipts.

const REPLICA_TOKEN = "replica-secret"
const NOW = "2026-08-30T00:00:00.000Z"
const ADMIN = "account_admin_receipts"
const USER = "account_user_receipts"
const TERMS = "terms_receipts_0001"

let authoring
let primary
before(async () => {
  authoring = await openMigratedD1("../../migrations-iconoplasm-authoring/", { seedRows: true })
  primary = await openMigratedD1("../../migrations-iconoplasm/", { seedRows: true })
  await primary.db
    .prepare(
      "UPDATE icono_manifestation_projection_authority SET mode='authoritative',authority_epoch=2 WHERE singleton=1",
    )
    .run()
})
after(async () => {
  await authoring?.dispose()
  await primary?.dispose()
})

const quiet = (t) => {
  const original = [console.log, console.warn, console.error]
  console.log = console.warn = console.error = () => {}
  t.after(() => {
    ;[console.log, console.warn, console.error] = original
  })
}

function installMemoryBodyStorage(t) {
  const original = globalThis.fetch
  t.after(() => {
    globalThis.fetch = original
  })
  const objects = new Map()
  globalThis.fetch = async (url, init = {}) => {
    const key = String(url)
    const method = String(init.method || "GET").toUpperCase()
    if (method === "PUT") {
      objects.set(key, Uint8Array.from(init.body))
      return new Response(null, { status: 201, headers: { etag: '"test-etag"' } })
    }
    if (method === "DELETE") {
      objects.delete(key)
      return new Response(null, { status: 200 })
    }
    const bytes = objects.get(key)
    return bytes
      ? new Response(bytes, { status: 200, headers: { etag: '"test-etag"' } })
      : new Response(null, { status: 404 })
  }
  return objects
}

const base64 = (bytes) => Buffer.from(bytes).toString("base64")
const sha256 = (text) => createHash("sha256").update(text).digest("hex")

const TAGS_TEXT = "female scientist, green eyes\nprecision laboratory"
const FIELDS_JSON = { zeta: ["β", true, null], alpha: { species: "human" } }
const FIELDS_CANONICAL = '{"alpha":{"species":"human"},"zeta":["\\u03b2",true,null]}'

let counter = 0
async function bootstrapCaretaker() {
  const suffix = String(8000 + ++counter)
  const db = authoring.db
  const userAccountId = `${USER}_${suffix}`
  if (counter === 1) {
    await registerAuthorityAccount(db, {
      accountId: ADMIN,
      publicCreditLabel: "Shared caretaker credit",
      now: NOW,
    })
    await registerCaretakerTermsVersion(db, {
      termsVersionId: TERMS,
      termsSha256: sha("f"),
      documentUrl: "https://iconoplasm.brinedew.bio/caretaker-terms",
      displayLabel: "Caretaker terms - 30 August 2026",
      effectiveAt: NOW,
      createdByAccountId: ADMIN,
    })
  }
  await registerAuthorityAccount(db, {
    accountId: userAccountId,
    publicCreditLabel: "Shared caretaker credit",
    now: NOW,
  })
  const geneId = `gene_receipts_${suffix}`
  const assignmentId = `assignment_receipts_${suffix}`
  // Every revision needs its own encrypted object: odd sequences keep the
  // plaintext hash storage(1) uses, so the body hash is one constant.
  const envelope = storage(1000 + 2 * counter + 1)
  await registerGeneIdentity(db, { geneId, canonicalSymbol: `R${suffix}`, now: NOW })

  await seedSystemManifestation(db, {
    geneId,
    storage: envelope,
    expectedHeadVersion: 0,
    expectedCanonicalRevisionId: null,
    manifestationId: `manifestation_seed_${suffix}`,
    revisionId: `revision_seed_${suffix}`,
    selectionId: `selection_seed_${suffix}`,
    eventUuid: `event_seed_${suffix}`,
    now: NOW,
    ...command(`command_seed_${suffix}`, "1", null, "migration"),
  })
  await offerCaretakerAssignment(db, {
    geneId,
    accountId: userAccountId,
    invitedByAccountId: ADMIN,
    entitlementPolicyVersion: "entitlement-v1",
    expectedGeneRevision: 1,
    assignmentId,
    eventUuid: `event_offer_${suffix}`,
    now: NOW,
    ...command(`command_offer_${suffix}`, "2", ADMIN, "administrator"),
  })
  await transitionCaretakerAssignment(db, {
    assignmentId,
    action: "accept",
    expectedAssignmentVersion: 1,
    termsVersionId: TERMS,
    relinquishPolicy: "retain",
    eventUuid: `event_accept_${suffix}`,
    now: NOW,
    ...command(`command_accept_${suffix}`, "3", userAccountId, "account"),
  })
  return { geneId, revisionId: `revision_seed_${suffix}`, suffix }
}

async function geneRevision(geneId) {
  return Number(
    await authoring.db
      .prepare("SELECT gene_revision FROM icono_manifestation_heads WHERE gene_id = ?")
      .bind(geneId)
      .first("gene_revision"),
  )
}

const BUDGET_ENV = {
  ICONOPLASM_D1_ROWS_READ_HARD_MONTHLY_BUDGET_DO_NOT_SET_CASUALLY: "24000000000",
  ICONOPLASM_D1_ROWS_WRITTEN_HARD_MONTHLY_BUDGET_DO_NOT_SET_CASUALLY: "40000000",
}

function fixture(t, providerRowsWritten = 0) {
  const authoringMeter = liveD1Meter(authoring.db)
  const primaryMeter = liveD1Meter(primary.db)
  const ledger = realBudgetLedger(providerRowsWritten)
  t.after(() => ledger.close())
  const spy = spyOnLedger(ledger)
  const env = {
    ICONOPLASM_DB: primaryMeter.db,
    ICONOPLASM_AUTHORING_DB: authoringMeter.db,
    ICONOPLASM_AUTHORITY_REPLICA_TOKEN: REPLICA_TOKEN,
    ICONOPLASM_AUTHORING_BODY_KEY_VERSION: "1",
    ICONOPLASM_AUTHORING_BODY_KEK_V1: base64(new Uint8Array(32).fill(11)),
    ICONOPLASM_AUTHORING_STORAGE_ZONE: "authority-test-zone",
    ICONOPLASM_AUTHORING_STORAGE_PASSWORD: "authority-test-password",
    ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: spy.namespace,
    ...BUDGET_ENV,
  }
  const written = () => authoringMeter.totals.rows_written + primaryMeter.totals.rows_written
  async function post(path, body, token = REPLICA_TOKEN) {
    const response = await gateway(
      new Request(`https://the-only-allowed-internal-stateful-worker-do-not-duplicate${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      }),
      env,
      { waitUntil() {} },
    )
    return { status: response.status, payload: await response.json().catch(() => null) }
  }
  return { authoringMeter, primaryMeter, ledger, spy, env, written, post }
}

const submitPath = (revisionId) =>
  `/api/iconoplasm/authority/revisions/${revisionId}/tags-derivatives`
const selectPath = (revisionId) =>
  `/api/iconoplasm/authority/revisions/${revisionId}/tags-derivative-head`

function completeSubmission(geneRevision, revisionBodySha, commandId) {
  return {
    command_id: commandId,
    status: "complete",
    source_body_sha256: revisionBodySha,
    tags_text: TAGS_TEXT,
    tags_sha256: sha256(TAGS_TEXT),
    fields_json: FIELDS_JSON,
    fields_sha256: sha256(FIELDS_CANONICAL),
    recipe_id: "tags_recipe",
    recipe_version: "v1",
    provider_id: "provider",
    model_id: "model",
    tagger_config_sha256: sha("9"),
    expected_gene_revision: geneRevision,
  }
}

function failedSubmission(geneRevision, revisionBodySha, commandId) {
  return {
    command_id: commandId,
    status: "failed",
    source_body_sha256: revisionBodySha,
    failure_code: "provider_timeout",
    recipe_id: "tags_recipe",
    recipe_version: "v1",
    provider_id: "provider",
    model_id: "model",
    tagger_config_sha256: sha("9"),
    expected_gene_revision: geneRevision,
  }
}

const SEED_BODY_SHA = storage(1).body_sha256

// Failure modes 1, 2 and 3: the sequence a revision really sees, each command
// run through the real gateway on both databases.
test("every submission a revision can take writes what the reservation counts across both databases", async (t) => {
  quiet(t)
  installMemoryBodyStorage(t)
  const { geneId, revisionId } = await bootstrapCaretaker()
  const run = fixture(t)
  const points = []
  for (const [label, build] of [
    ["complete", completeSubmission],
    ["complete again", completeSubmission],
    ["failed", failedSubmission],
    ["failed again", failedSubmission],
    ["complete after failures", completeSubmission],
  ]) {
    const before = {
      authoring: run.authoringMeter.totals.rows_written,
      primary: run.primaryMeter.totals.rows_written,
    }
    const response = await run.post(
      submitPath(revisionId),
      build(
        await geneRevision(geneId),
        SEED_BODY_SHA,
        `command_${label.replace(/ /g, "_")}_${++counter}`,
      ),
    )
    assert.equal(response.status, 200, `${label}: ${JSON.stringify(response.payload)}`)
    assert.notEqual(response.payload.projection_pending, true, label)
    const reservation = run.spy.reservations().at(-1)
    const authoringWrote = run.authoringMeter.totals.rows_written - before.authoring
    const primaryWrote = run.primaryMeter.totals.rows_written - before.primary
    points.push({
      label,
      authoring: authoringWrote,
      primary: primaryWrote,
      wrote: authoringWrote + primaryWrote,
      units: reservation.units,
      lane: reservation.lane,
    })
  }
  t.diagnostic(JSON.stringify({ site: "tags-submit", points }))
  for (const point of points) {
    assert.equal(point.lane, "laptop_delivery")
    assert.ok(
      point.units >= point.wrote,
      `${point.label} under-reserved: ${JSON.stringify(points)}`,
    )
  }
  // The constant is the worst measured, with no estimate on top.
  assert.equal(
    TAGS_DERIVATIVE_SUBMIT_ROWS,
    Math.max(...points.map((point) => point.wrote)),
    JSON.stringify(points),
  )
})

test("a replay writes nothing and a command on a stale gene revision is refused without a write", async (t) => {
  quiet(t)
  installMemoryBodyStorage(t)
  const { geneId, revisionId } = await bootstrapCaretaker()
  const run = fixture(t)
  const commandId = `command_replayed_${++counter}`
  const revision = await geneRevision(geneId)
  const first = await run.post(
    submitPath(revisionId),
    completeSubmission(revision, SEED_BODY_SHA, commandId),
  )
  assert.equal(first.status, 200, JSON.stringify(first.payload))
  const afterFirst = run.written()
  const replay = await run.post(
    submitPath(revisionId),
    completeSubmission(revision, SEED_BODY_SHA, commandId),
  )
  assert.equal(replay.status, 200, JSON.stringify(replay.payload))
  assert.equal(replay.payload.replayed, true)
  assert.equal(run.written(), afterFirst, "the command ledger answers a replay without a write")
  // The same body is the same operation: one identity, so a retry never takes a
  // second reservation of its own.
  const reservations = run.spy.reservations()
  assert.equal(reservations.at(-1).operation_id, reservations.at(-2).operation_id)

  const stale = await run.post(
    submitPath(revisionId),
    failedSubmission(revision, SEED_BODY_SHA, `command_stale_${++counter}`),
  )
  assert.equal(stale.status, 409, JSON.stringify(stale.payload))
  assert.equal(run.written(), afterFirst)
})

// Failure mode 5, on the real ledger.
test("at the ceiling a submission refuses before any write and leaves no trace, and the same command is admitted when pressure falls", async (t) => {
  quiet(t)
  installMemoryBodyStorage(t)
  const { geneId, revisionId } = await bootstrapCaretaker()
  const units = laptopReservation("authority_tags_derivative_submit", { command_id: "x" }).units
  assert.ok(units > MUTATION_WRITE_FLOOR_UNITS, "the measured size is above the floor")
  // Room for the old 50 but not for what a submission writes.
  const run = fixture(t, 70_000 - units + 1)
  const body = completeSubmission(
    await geneRevision(geneId),
    SEED_BODY_SHA,
    `command_refused_${++counter}`,
  )
  const refused = await run.post(submitPath(revisionId), body)
  assert.equal(refused.status, 503, JSON.stringify(refused.payload))
  assert.equal(refused.payload.code, "ICONOPLASM_D1_DAILY_BUDGET_EXHAUSTED")
  assert.equal(run.written(), 0)
  assert.equal(
    await authoring.db
      .prepare(
        "SELECT COUNT(*) AS n FROM icono_manifestation_derivatives WHERE manifestation_revision_id = ?",
      )
      .bind(revisionId)
      .first("n"),
    0,
    "the refused command created nothing",
  )

  run.ledger.observe(0)
  const admitted = await run.post(submitPath(revisionId), body)
  assert.equal(admitted.status, 200, JSON.stringify(admitted.payload))
  assert.equal(admitted.payload.replayed, false)
  assert.ok(run.written() <= units, `${run.written()} > ${units}`)
})

test("the head selection never reaches the laptop lane: the operation-cost authority admits it", async (t) => {
  quiet(t)
  const run = fixture(t)
  // Anonymous, and authenticated without an operation: both are answered before
  // the budget wrapper, and neither reserves anything.
  const anonymous = await run.post(
    selectPath("revision_0001"),
    { command_id: "select_anonymous" },
    null,
  )
  assert.equal(anonymous.status, 401)
  const unregistered = await run.post(selectPath("revision_0001"), {
    command_id: "select_unregistered",
  })
  assert.equal(unregistered.status, 428)
  assert.equal(unregistered.payload.error.code, "COST_PREDICTION_NOT_REGISTERED")
  assert.equal(run.spy.reservations().length, 0)
  assert.equal(run.written(), 0)
  // It has no entry in the laptop sizing, because that entry could never be used.
  assert.throws(
    () => laptopReservation("authority_tags_derivative_select", { command_id: "x" }),
    RangeError,
  )
})

test("the head selection writes less than the bound the operation-cost authority admits it against", async (t) => {
  quiet(t)
  installMemoryBodyStorage(t)
  const { geneId, revisionId } = await bootstrapCaretaker()
  const run = fixture(t)
  const submitted = await run.post(
    submitPath(revisionId),
    completeSubmission(await geneRevision(geneId), SEED_BODY_SHA, `command_to_select_${++counter}`),
  )
  assert.equal(submitted.status, 200, JSON.stringify(submitted.payload))
  const headVersion = Number(
    await authoring.db
      .prepare(
        "SELECT derivative_head_version FROM icono_manifestation_derivative_heads WHERE manifestation_revision_id = ?",
      )
      .bind(revisionId)
      .first("derivative_head_version"),
  )
  const adapter = createReplicaOperationCostAdapter({
    env: {
      ...run.env,
      ICONOPLASM_AUTHORING_DB: authoring.db,
      ICONOPLASM_DB: primary.db,
    },
    executable_sha256: sha("1"),
    schema_sha256: sha("2"),
    async onAuthorityEvent(event, scopedEnv) {
      const result = await drainManifestationAuthorityProjectionOutbox({
        authoringDb: scopedEnv.ICONOPLASM_AUTHORING_DB,
        primaryDb: scopedEnv.ICONOPLASM_DB,
        priorityEventId: event.event_id,
        limit: 1,
        projectPublicMaterialEvent: (accepted) =>
          drainManifestationPublicCardPublicationWakes(scopedEnv.ICONOPLASM_DB, {
            authorityEventId: accepted.event_id,
          }),
      })
      assert.equal(result.published, 1, JSON.stringify(result))
    },
  })
  const prepared = await adapter.prepare({
    method: "POST",
    path: selectPath(revisionId),
    body: {
      command_id: `command_select_${++counter}`,
      manifestation_derivative_id: submitted.payload.manifestation_derivative_id,
      expected_derivative_head_version: headVersion,
      expected_gene_revision: await geneRevision(geneId),
    },
  })
  const selected = await adapter.dispatch(prepared)
  assert.equal(selected.result.status, 200, JSON.stringify(selected.result))
  t.diagnostic(
    JSON.stringify({
      site: "tags-select",
      wrote: selected.actual.rows_written,
      bound: prepared.bound.rows_written,
    }),
  )
  assert.ok(selected.actual.rows_written <= prepared.bound.rows_written)
})
