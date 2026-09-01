import assert from "node:assert/strict"
import test from "node:test"

import {
  CARETAKER_ENTITLEMENT_POLICY_VERSION,
  createManifestationUploadIntent,
  createManifestationAuthorityRouteHandler,
  createManifestationAuthorityServiceHandler,
  createCaretakerManifestationHttpHandler,
  computeManifestationSnapshotChainHash,
  offerCaretakerAssignment,
  projectAuthorityAccountStatus,
  registerAuthorityAccount,
  registerCaretakerTermsVersion,
  registerGeneIdentity,
  recycleUnverifiedManifestationUploadIntent,
  requireAdoptedManifestationUpload,
  saveManifestationRevision,
  seedSystemManifestation,
  sweepExpiredManifestationUploadIntents,
  transitionCaretakerAssignment,
} from "./manifestation-authority.js"
import { prepareManifestationTagsPayload } from "./manifestation-tags-payload.js"
import { encryptManifestationProse } from "../../lib/iconoplasm-manifestation-body-crypto.js"
import {
  createManifestationBodyObjectKey,
  putEncryptedManifestationBody,
} from "../../lib/iconoplasm-manifestation-body-storage.js"
import { TestD1, command, row, sha, storage } from "./manifestation-authority-test-support.js"

const NOW = "2026-08-30T00:00:00.000Z"
const ADMIN = "account_admin_server"
const USER = "account_user_server1"
const TERMS = "terms_server_0001"
const OTHER = "account_other_server"

function base64(bytes) {
  return Buffer.from(bytes).toString("base64")
}

function serviceEnvironment() {
  return {
    ICONOPLASM_AUTHORING_BODY_KEY_VERSION: "1",
    ICONOPLASM_AUTHORING_BODY_KEK_V1: base64(new Uint8Array(32).fill(11)),
    ICONOPLASM_AUTHORING_STORAGE_ZONE: "authority-test-zone",
    ICONOPLASM_AUTHORING_STORAGE_PASSWORD: "authority-test-password",
  }
}

function serviceRequest(path, body = null, method = body == null ? "GET" : "POST") {
  return new Request(`https://iconoplasm.test${path}`, {
    method,
    headers:
      body == null
        ? { authorization: "Bearer test-service" }
        : { authorization: "Bearer test-service", "content-type": "application/json" },
    body: body == null ? undefined : JSON.stringify(body),
  })
}

function installMemoryBodyStorage(t) {
  const originalFetch = globalThis.fetch
  const objects = new Map()
  t.after(() => {
    globalThis.fetch = originalFetch
  })
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

test("replica sync refuses cursor and snapshot churn before authority activation", async (t) => {
  const context = await bootstrap(t, "7010")
  let authorizations = 0
  const handler = createManifestationAuthorityRouteHandler({
    db: context.db,
    env: serviceEnvironment(),
    authorizeReplicaBearer: async () => {
      authorizations += 1
      return { authorized: true, actor_kind: "service" }
    },
  })
  const events = await handler(serviceRequest("/api/iconoplasm/authority/events"))
  assert.equal(events.status, 503)
  assert.equal((await events.json()).error.code, "AUTHORITY_NOT_ACTIVE")
  const snapshot = await handler(
    serviceRequest("/api/iconoplasm/authority/snapshots", {
      consumer_id: "consumer_shadow_sync_0001",
      ttl_seconds: 300,
    }),
  )
  assert.equal(snapshot.status, 503)
  assert.equal((await snapshot.json()).error.code, "AUTHORITY_NOT_ACTIVE")
  assert.equal(authorizations, 2)
})

function ids() {
  let sequence = 0
  return (prefix) => `${prefix}_${String(++sequence).padStart(12, "0")}`
}

async function bootstrap(t, suffix = "7001") {
  const db = new TestD1()
  t.after(() => db.close())
  await registerAuthorityAccount(db, {
    accountId: ADMIN,
    publicCreditLabel: "Shared caretaker credit",
    now: NOW,
  })
  await registerAuthorityAccount(db, {
    accountId: USER,
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
  const geneId = `gene_server_${suffix}`
  const assignmentId = `assignment_server_${suffix}`
  await registerGeneIdentity(db, { geneId, canonicalSymbol: `S${suffix}`, now: NOW })
  await seedSystemManifestation(db, {
    geneId,
    storage: storage(1),
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
    accountId: USER,
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
    ...command(`command_accept_${suffix}`, "3", USER, "account"),
  })
  return { db, geneId, assignmentId, seedRevisionId: `revision_seed_${suffix}` }
}

test("account projection preserves duplicate public labels and enforces disable, erasure, and terminal tombstone", async (t) => {
  const context = await bootstrap(t)
  assert.equal(
    row(
      context.db,
      "SELECT count(*) AS total FROM icono_authority_accounts WHERE public_credit_label = ?",
      "Shared caretaker credit",
    ).total,
    2,
  )

  const disabled = await projectAuthorityAccountStatus(context.db, {
    accountId: USER,
    status: "disabled",
    sourceEventId: "primary_account_event_0001",
    sourceEventSequence: 1,
    occurredAt: "2026-08-30T00:01:00.000Z",
    authorityEventId: "authority_account_event_0001",
  })
  assert.equal(disabled.assignment_status, "suspended")
  assert.equal(
    row(context.db, "SELECT status FROM icono_authority_accounts WHERE account_id = ?", USER)
      .status,
    "disabled",
  )
  assert.equal(
    row(
      context.db,
      "SELECT status FROM icono_caretaker_assignments WHERE caretaker_assignment_id = ?",
      context.assignmentId,
    ).status,
    "suspended",
  )

  const enabled = await projectAuthorityAccountStatus(context.db, {
    accountId: USER,
    status: "active",
    publicCreditLabel: "Shared caretaker credit",
    sourceEventId: "primary_account_event_0002",
    sourceEventSequence: 2,
    occurredAt: "2026-08-30T00:02:00.000Z",
    authorityEventId: "authority_account_event_0002",
  })
  assert.equal(enabled.assignment_status, "active")

  await assert.rejects(
    projectAuthorityAccountStatus(context.db, {
      accountId: USER,
      status: "erasure_pending",
      sourceEventId: "primary_account_event_0003",
      sourceEventSequence: 3,
      occurredAt: "2026-08-30T00:03:00.000Z",
    }),
    { code: "RELINQUISH_POLICY_CONFIRMATION_REQUIRED" },
  )
  const erasure = await projectAuthorityAccountStatus(context.db, {
    accountId: USER,
    status: "erasure_pending",
    finalLeavePolicy: "retain",
    sourceEventId: "primary_account_event_0003",
    sourceEventSequence: 3,
    occurredAt: "2026-08-30T00:03:00.000Z",
    authorityEventId: "authority_account_event_0003",
  })
  assert.equal(erasure.assignment_status, "ended")
  assert.equal(erasure.relinquish_policy, "retain")
  assert.equal(
    row(
      context.db,
      "SELECT count(*) AS total FROM icono_caretaker_assignments WHERE account_id = ? AND status <> 'ended'",
      USER,
    ).total,
    0,
  )

  const tombstone = await projectAuthorityAccountStatus(context.db, {
    accountId: USER,
    status: "tombstoned",
    sourceEventId: "primary_account_event_0004",
    sourceEventSequence: 4,
    occurredAt: "2026-08-30T00:04:00.000Z",
    authorityEventId: "authority_account_event_0004",
  })
  assert.equal(tombstone.status, "tombstoned")
  const account = row(
    context.db,
    "SELECT status, public_credit_label FROM icono_authority_accounts WHERE account_id = ?",
    USER,
  )
  assert.equal(account.status, "tombstoned")
  assert.match(account.public_credit_label, /^Former caretaker [A-F0-9]{8}$/)
  await assert.rejects(
    projectAuthorityAccountStatus(context.db, {
      accountId: USER,
      status: "active",
      sourceEventId: "primary_account_event_0005",
      sourceEventSequence: 5,
      occurredAt: "2026-08-30T00:05:00.000Z",
    }),
    { code: "ACCOUNT_STATUS_TERMINAL" },
  )
})

test("upload intents reserve before PUT, survive termination, and atomically adopt a committed revision", async (t) => {
  const context = await bootstrap(t, "7002")
  const idFactory = ids()
  const pendingStorage = storage(82)
  const pending = await createManifestationUploadIntent(context.db, {
    entityKind: "revision",
    // A failed transfer for the same immutable entity must not mask a later
    // adopted retry when the adoption proof is read back.
    entityId: "revision_adopted_7002",
    assignmentId: context.assignmentId,
    objectKey: pendingStorage.object_key,
    ciphertextSha256: pendingStorage.ciphertext_sha256,
    bodyBytes: pendingStorage.body_bytes,
    actorKind: "account",
    actorAccountId: USER,
    uploadIntentId: "upload_intent_abandoned_7002",
    leaseToken: "upload_lease_abandoned_7002",
    now: "2026-08-30T00:00:00.000Z",
    leaseMs: 30_000,
  })
  assert.equal(pending.status, "uploading")
  assert.equal(
    row(context.db, "SELECT body_reserved_bytes FROM icono_authority_state WHERE singleton = 1")
      .body_reserved_bytes,
    pendingStorage.body_bytes,
  )

  const originalFetch = globalThis.fetch
  t.after(() => {
    globalThis.fetch = originalFetch
  })
  const methods = []
  globalThis.fetch = async (_url, init = {}) => {
    methods.push(init.method)
    return new Response(null, { status: 404 })
  }
  const swept = await sweepExpiredManifestationUploadIntents(
    context.db,
    {
      ICONOPLASM_AUTHORING_STORAGE_ZONE: "private-zone",
      ICONOPLASM_AUTHORING_STORAGE_PASSWORD: "test-password",
    },
    {
      now: "2026-08-30T00:01:00.000Z",
      idFactory,
    },
  )
  assert.equal(swept.processed, 1)
  assert.deepEqual(methods, ["DELETE", "GET"])
  assert.equal(
    row(
      context.db,
      "SELECT status FROM icono_manifestation_upload_intents WHERE upload_intent_id = ?",
      pending.upload_intent_id,
    ).status,
    "deleted",
  )
  assert.equal(
    row(context.db, "SELECT body_reserved_bytes FROM icono_authority_state WHERE singleton = 1")
      .body_reserved_bytes,
    0,
  )

  const adoptedStorage = storage(83)
  await createManifestationUploadIntent(context.db, {
    entityKind: "revision",
    entityId: "revision_adopted_7002",
    assignmentId: context.assignmentId,
    objectKey: adoptedStorage.object_key,
    ciphertextSha256: adoptedStorage.ciphertext_sha256,
    bodyBytes: adoptedStorage.body_bytes,
    actorKind: "account",
    actorAccountId: USER,
    uploadIntentId: "upload_intent_adopted_7002",
    leaseToken: "upload_lease_adopted_7002",
    now: "2099-08-30T00:00:00.000Z",
    leaseMs: 600_000,
  })
  const saved = await saveManifestationRevision(context.db, {
    assignmentId: context.assignmentId,
    expectedAssignmentVersion: 2,
    expectedManifestationVersion: 0,
    expectedHeadVersion: 1,
    expectedCanonicalRevisionId: context.seedRevisionId,
    storage: adoptedStorage,
    manifestationId: "manifestation_adopted_7002",
    revisionId: "revision_adopted_7002",
    selectionId: "selection_adopted_7002",
    eventUuid: "event_adopted_7002",
    now: NOW,
    ...command("command_adopted_7002", "8", USER, "account"),
  })
  assert.equal(saved.manifestation_revision_id, "revision_adopted_7002")
  assert.equal(
    (await requireAdoptedManifestationUpload(context.db, "revision", "revision_adopted_7002"))
      .status,
    "adopted",
  )
  assert.equal(
    row(context.db, "SELECT body_reserved_bytes FROM icono_authority_state WHERE singleton = 1")
      .body_reserved_bytes,
    0,
  )
})

test("an unadopted upload that never becomes readable is deleted before replacement", async (t) => {
  const context = await bootstrap(t, "7011")
  const pendingStorage = storage(91)
  const pending = await createManifestationUploadIntent(context.db, {
    entityKind: "revision",
    entityId: "revision_recycle_7011",
    assignmentId: context.assignmentId,
    objectKey: pendingStorage.object_key,
    ciphertextSha256: pendingStorage.ciphertext_sha256,
    bodyBytes: pendingStorage.body_bytes,
    actorKind: "account",
    actorAccountId: USER,
    uploadIntentId: "upload_intent_recycle_7011",
    leaseToken: "upload_lease_recycle_7011",
    now: NOW,
    leaseMs: 600_000,
  })
  const originalFetch = globalThis.fetch
  t.after(() => {
    globalThis.fetch = originalFetch
  })
  const methods = []
  globalThis.fetch = async (_url, init = {}) => {
    methods.push(String(init.method || "GET").toUpperCase())
    return new Response(null, { status: init.method === "DELETE" ? 200 : 404 })
  }
  const recycled = await recycleUnverifiedManifestationUploadIntent(
    context.db,
    {
      ICONOPLASM_AUTHORING_STORAGE_ZONE: "private-zone",
      ICONOPLASM_AUTHORING_STORAGE_PASSWORD: "test-password",
    },
    pending,
    {
      now: "2026-08-30T00:02:00.000Z",
      idFactory: ids(),
    },
  )
  assert.equal(recycled, true)
  assert.deepEqual(methods, ["DELETE", "GET"])
  assert.equal(
    row(
      context.db,
      "SELECT status FROM icono_manifestation_upload_intents WHERE upload_intent_id = ?",
      pending.upload_intent_id,
    ).status,
    "deleted",
  )
  const replacement = await createManifestationUploadIntent(context.db, {
    entityKind: "revision",
    entityId: "revision_recycle_7011",
    assignmentId: context.assignmentId,
    objectKey: storage(92).object_key,
    ciphertextSha256: storage(92).ciphertext_sha256,
    bodyBytes: storage(92).body_bytes,
    actorKind: "account",
    actorAccountId: USER,
    uploadIntentId: "upload_intent_replacement_7011",
    leaseToken: "upload_lease_replacement_7011",
    now: "2026-08-30T00:03:00.000Z",
    leaseMs: 600_000,
  })
  assert.equal(replacement.status, "uploading")
})

test("authority epoch and mode cannot rewind", async (t) => {
  const db = new TestD1()
  t.after(() => db.close())
  db.raw.prepare("UPDATE icono_authority_state SET authority_epoch = 2 WHERE singleton = 1").run()
  db.raw
    .prepare(
      "UPDATE icono_authority_state SET authority_mode = 'authoritative' WHERE singleton = 1",
    )
    .run()
  assert.throws(
    () =>
      db.raw
        .prepare("UPDATE icono_authority_state SET authority_epoch = 1 WHERE singleton = 1")
        .run(),
    /authority_epoch_cannot_rewind/,
  )
  assert.throws(
    () =>
      db.raw
        .prepare("UPDATE icono_authority_state SET authority_mode = 'shadow' WHERE singleton = 1")
        .run(),
    /authority_mode_cannot_rewind_to_shadow/,
  )
  db.raw
    .prepare("UPDATE icono_authority_state SET authority_mode = 'read_only' WHERE singleton = 1")
    .run()
  db.raw
    .prepare(
      "UPDATE icono_authority_state SET authority_mode = 'authoritative' WHERE singleton = 1",
    )
    .run()
})

test("snapshot checksum chain uses actual UTF-8 LF bytes", async () => {
  assert.equal(
    await computeManifestationSnapshotChainHash(
      "0".repeat(64),
      1,
      "5e7e94c82e04372eb36de9a72cbced586e5a5a872ca291070b945d920b2613a6",
    ),
    "3847874c06d922e1f921d678bebbbddb2cd22f248a8d4e3a2f7d6ba2441eb827",
  )
})

function browserRequest(
  path,
  body,
  { method = "POST", origin = "https://iconoplasm.test", fetchSite = "same-origin" } = {},
) {
  const headers = { "content-type": "application/json" }
  if (origin != null) headers.origin = origin
  if (fetchSite != null) headers["sec-fetch-site"] = fetchSite
  return new Request(`https://iconoplasm.test${path}`, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  })
}

test("browser routes hide unauthorized dossiers, reject CSRF and body-ID smuggling, and project replay safely", async (t) => {
  const context = await bootstrap(t, "7003")
  await registerAuthorityAccount(context.db, {
    accountId: OTHER,
    publicCreditLabel: "Another caretaker",
    now: NOW,
  })
  context.db.raw
    .prepare(
      "UPDATE icono_authority_state SET authority_mode = 'authoritative' WHERE singleton = 1",
    )
    .run()
  let sessionAccount = OTHER
  const projected = []
  let failProjection = false
  const handler = createCaretakerManifestationHttpHandler({
    db: context.db,
    env: {},
    cursorSecret: "c".repeat(32),
    resolveSession: async () => ({ account_id: sessionAccount }),
    onAuthorityEvent: async (event) => {
      projected.push(event)
      if (failProjection) {
        failProjection = false
        throw new Error("primary temporarily unavailable")
      }
    },
    idFactory: ids(),
  })

  const hidden = await handler(
    new Request("https://iconoplasm.test/api/iconoplasm/caretaker/genes/S7003"),
  )
  assert.equal(hidden.status, 200)
  assert.deepEqual(await hidden.json(), { enabled: false })

  sessionAccount = USER
  const missingOrigin = await handler(
    browserRequest(
      "/api/iconoplasm/caretaker/genes/S7003/canonical-selections",
      { command_id: "browser_command_7003a" },
      { origin: null },
    ),
  )
  assert.equal(missingOrigin.status, 403)
  assert.equal((await missingOrigin.json()).error.code, "STRICT_SAME_ORIGIN_REQUIRED")

  const smuggled = await handler(
    browserRequest("/api/iconoplasm/caretaker/genes/S7003/canonical-selections", {
      command_id: "browser_command_7003b",
      manifestation_revision_id: context.seedRevisionId,
      manifestation_id: "manifestation_cross_lineage_smuggle",
      expected_assignment_version: 2,
      expected_head_version: 1,
      expected_canonical_revision_id: context.seedRevisionId,
    }),
  )
  assert.equal(smuggled.status, 400)
  assert.equal((await smuggled.json()).error.code, "ROUTE_ENTITY_MISMATCH")

  const selectionBody = {
    command_id: "browser_command_7003c",
    manifestation_revision_id: context.seedRevisionId,
    expected_assignment_version: 2,
    expected_head_version: 1,
    expected_canonical_revision_id: context.seedRevisionId,
  }
  failProjection = true
  const committedButPending = await handler(
    browserRequest("/api/iconoplasm/caretaker/genes/S7003/canonical-selections", selectionBody),
  )
  assert.equal(committedButPending.status, 202)
  const accepted = await committedButPending.json()
  assert.equal(accepted.projection_pending, true)
  assert.equal(accepted.ok, true)
  const retry = await handler(
    browserRequest("/api/iconoplasm/caretaker/genes/S7003/canonical-selections", selectionBody),
  )
  assert.equal(retry.status, 200)
  const replay = await retry.json()
  assert.equal(replay.replayed, true)
  assert.equal(projected.length, 2)
  assert.equal(projected[0].event_id, projected[1].event_id)
  assert.equal(new Set(projected.map((event) => event.event_id)).size, 1)
  assert.equal(
    row(
      context.db,
      "SELECT count(*) AS total FROM icono_authoring_command_receipts WHERE command_id = ?",
      selectionBody.command_id,
    ).total,
    1,
  )
  assert.equal(
    row(
      context.db,
      "SELECT count(*) AS total FROM icono_manifestation_canonical_selections WHERE command_id = ?",
      selectionBody.command_id,
    ).total,
    1,
  )
})

test("browser claim route exposes exact terms and atomically activates an available gene", async (t) => {
  const context = await bootstrap(t, "7014")
  const currentTerms = "terms_server_2026_09_01_v2"
  await registerCaretakerTermsVersion(context.db, {
    termsVersionId: currentTerms,
    termsSha256: sha("e"),
    documentUrl: "https://iconoplasm.brinedew.bio/caretaker-terms",
    displayLabel: "Caretaker terms - 1 September 2026",
    effectiveAt: "2026-09-01T00:00:00.000Z",
    createdByActorKind: "migration",
  })
  await registerAuthorityAccount(context.db, {
    accountId: OTHER,
    publicCreditLabel: "Self-claiming caretaker",
    now: NOW,
  })
  const geneId = "gene_server_claim_7014"
  await registerGeneIdentity(context.db, { geneId, canonicalSymbol: "CLAIM14", now: NOW })
  await seedSystemManifestation(context.db, {
    geneId,
    storage: storage(14),
    expectedHeadVersion: 0,
    expectedCanonicalRevisionId: null,
    manifestationId: "manifestation_claim_seed_7014",
    revisionId: "revision_claim_seed_7014",
    selectionId: "selection_claim_seed_7014",
    eventUuid: "event_claim_seed_7014",
    now: NOW,
    ...command("command_claim_seed_7014", "4", null, "migration"),
  })
  context.db.raw
    .prepare(
      "UPDATE icono_authority_state SET authority_mode = 'authoritative' WHERE singleton = 1",
    )
    .run()
  const handler = createCaretakerManifestationHttpHandler({
    db: context.db,
    env: {},
    resolveSession: async () => ({ account_id: OTHER }),
    idFactory: ids(),
    now: () => "2026-09-01T00:00:01.000Z",
  })
  const path = "/api/iconoplasm/caretaker/genes/CLAIM14/claim"
  const availabilityResponse = await handler(new Request(`https://iconoplasm.test${path}`))
  assert.equal(availabilityResponse.status, 200)
  const availability = await availabilityResponse.json()
  assert.equal(availability.claim.available, true)
  assert.equal(availability.claim.gene_revision, 1)
  assert.equal(availability.claim.terms.terms_version_id, currentTerms)
  assert.equal(availability.claim.entitlement_policy_version, CARETAKER_ENTITLEMENT_POLICY_VERSION)
  const claimedResponse = await handler(
    browserRequest(path, {
      command_id: "browser_claim_7014",
      expected_gene_revision: availability.claim.gene_revision,
      terms_version_id: availability.claim.terms.terms_version_id,
      terms_accepted: true,
      entitlement_policy_version: availability.claim.entitlement_policy_version,
      default_leave_policy: "retain",
    }),
  )
  assert.ok(new Set([200, 202]).has(claimedResponse.status))
  const claimed = await claimedResponse.json()
  assert.equal(claimed.status, "active")
  assert.equal(
    row(
      context.db,
      "SELECT status FROM icono_caretaker_assignments WHERE gene_id = ? AND account_id = ?",
      geneId,
      OTHER,
    ).status,
    "active",
  )
  const noLongerAvailable = await handler(new Request(`https://iconoplasm.test${path}`))
  assert.equal((await noLongerAvailable.json()).claim.reason, "already_caretaking")
})

test("caretaker browser routes persist manual Tags on the exact autosaved revision", async (t) => {
  installMemoryBodyStorage(t)
  const context = await bootstrap(t, "7011")
  context.db.raw
    .prepare(
      "UPDATE icono_authority_state SET authority_mode = 'authoritative' WHERE singleton = 1",
    )
    .run()
  const handler = createCaretakerManifestationHttpHandler({
    db: context.db,
    env: serviceEnvironment(),
    resolveSession: async () => ({ account_id: USER }),
    idFactory: ids(),
  })
  const base = "/api/iconoplasm/caretaker/genes/S7011"
  const savedResponse = await handler(
    browserRequest(`${base}/revisions`, {
      command_id: "browser_revision_tags_7011",
      prose: "A caretaker-authored manifestation with manual Tags.",
      expected_assignment_version: 2,
      expected_manifestation_version: 0,
    }),
  )
  assert.ok(new Set([200, 202]).has(savedResponse.status))
  const saved = await savedResponse.json()
  const revisionId = saved.manifestation_revision_id
  assert.match(revisionId, /^revision_/)

  const submittedResponse = await handler(
    browserRequest(`${base}/revisions/${revisionId}/tags-derivatives`, {
      command_id: "browser_tags_submit_7011",
      tags_text: "red coat, careful gaze",
      expected_gene_revision: row(
        context.db,
        "SELECT gene_revision FROM icono_manifestation_heads WHERE gene_id = ?",
        context.geneId,
      ).gene_revision,
    }),
  )
  assert.ok(new Set([200, 202]).has(submittedResponse.status))
  const submitted = await submittedResponse.json()
  assert.match(submitted.manifestation_derivative_id, /^derivative_/)

  const selectedResponse = await handler(
    browserRequest(`${base}/revisions/${revisionId}/tags-derivative-head`, {
      command_id: "browser_tags_select_7011",
      manifestation_derivative_id: submitted.manifestation_derivative_id,
      expected_derivative_head_version: submitted.derivative_head_version,
      expected_gene_revision: row(
        context.db,
        "SELECT gene_revision FROM icono_manifestation_heads WHERE gene_id = ?",
        context.geneId,
      ).gene_revision,
    }),
  )
  assert.ok(new Set([200, 202]).has(selectedResponse.status))

  const bodyResponse = await handler(
    new Request(
      `https://iconoplasm.test${base}/derivatives/${submitted.manifestation_derivative_id}/body`,
    ),
  )
  assert.equal(bodyResponse.status, 200)
  assert.equal((await bodyResponse.json()).tags.tags_text, "red coat, careful gaze")
})

test("shadow mode keeps browser dossier hidden and mutations fail closed", async (t) => {
  const context = await bootstrap(t, "7004")
  const handler = createCaretakerManifestationHttpHandler({
    db: context.db,
    env: {},
    resolveSession: async () => ({ account_id: USER }),
  })
  const hidden = await handler(
    new Request("https://iconoplasm.test/api/iconoplasm/caretaker/genes/S7004"),
  )
  assert.deepEqual(await hidden.json(), { enabled: false })
  const mutation = await handler(
    browserRequest("/api/iconoplasm/caretaker/genes/S7004/canonical-selections", {
      command_id: "browser_shadow_7004",
    }),
  )
  assert.equal(mutation.status, 503)
  assert.equal((await mutation.json()).error.code, "AUTHORITY_NOT_ACTIVE")
})

test("withdraw and restore require the browser's exact manifestation CAS version", async (t) => {
  const context = await bootstrap(t, "7007")
  context.db.raw
    .prepare(
      "UPDATE icono_authority_state SET authority_mode = 'authoritative' WHERE singleton = 1",
    )
    .run()
  const manifestationId = "manifestation_browser_cas_7007"
  const revisionId = "revision_browser_cas_7007"
  await saveManifestationRevision(context.db, {
    assignmentId: context.assignmentId,
    expectedAssignmentVersion: 2,
    expectedManifestationVersion: 0,
    expectedHeadVersion: 1,
    expectedCanonicalRevisionId: context.seedRevisionId,
    storage: storage(87),
    manifestationId,
    revisionId,
    selectionId: "selection_browser_cas_7007",
    eventUuid: "event_browser_cas_7007",
    now: NOW,
    ...command("command_browser_cas_7007", "7", USER, "account"),
  })
  const handler = createCaretakerManifestationHttpHandler({
    db: context.db,
    env: {},
    resolveSession: async () => ({ account_id: USER }),
    idFactory: ids(),
  })
  const path = `/api/iconoplasm/caretaker/genes/S7007/manifestations/${manifestationId}`
  const visibility = await handler(
    browserRequest(`${path}/page-visibility`, {
      command_id: "browser_visibility_7007",
      visible: true,
      expected_assignment_version: 2,
      expected_manifestation_version: 1,
      expected_gene_revision: row(
        context.db,
        "SELECT gene_revision FROM icono_manifestation_heads WHERE gene_id = ?",
        context.geneId,
      ).gene_revision,
    }),
  )
  assert.equal(visibility.status, 200)
  assert.equal(
    row(
      context.db,
      "SELECT public_page_visible FROM icono_manifestations WHERE manifestation_id = ?",
      manifestationId,
    ).public_page_visible,
    1,
  )
  const base = {
    expected_head_version: 1,
    expected_canonical_revision_id: context.seedRevisionId,
  }

  const missingWithdraw = await handler(
    browserRequest(
      path,
      { ...base, command_id: "browser_withdraw_missing_cas_7007" },
      { method: "DELETE" },
    ),
  )
  assert.equal(missingWithdraw.status, 400)
  assert.equal((await missingWithdraw.json()).error.code, "INVALID_VERSION")
  const staleWithdraw = await handler(
    browserRequest(
      path,
      {
        ...base,
        command_id: "browser_withdraw_stale_cas_7007",
        expected_manifestation_version: 1,
      },
      { method: "DELETE" },
    ),
  )
  assert.equal(staleWithdraw.status, 409)
  assert.equal((await staleWithdraw.json()).error.code, "STALE_AUTHORITY_STATE")
  const withdrawn = await handler(
    browserRequest(
      path,
      {
        ...base,
        command_id: "browser_withdraw_exact_cas_7007",
        expected_manifestation_version: 2,
      },
      { method: "DELETE" },
    ),
  )
  assert.equal(withdrawn.status, 200)

  const restorePath = `${path}/restore`
  const restoreBase = {
    expected_assignment_version: 2,
    expected_head_version: 1,
    expected_canonical_revision_id: context.seedRevisionId,
  }
  const missingRestore = await handler(
    browserRequest(restorePath, { ...restoreBase, command_id: "browser_restore_missing_cas_7007" }),
  )
  assert.equal(missingRestore.status, 400)
  assert.equal((await missingRestore.json()).error.code, "INVALID_VERSION")
  const staleRestore = await handler(
    browserRequest(restorePath, {
      ...restoreBase,
      command_id: "browser_restore_stale_cas_7007",
      expected_manifestation_version: 1,
    }),
  )
  assert.equal(staleRestore.status, 409)
  assert.equal((await staleRestore.json()).error.code, "STALE_AUTHORITY_STATE")
  assert.equal(
    row(
      context.db,
      "SELECT status FROM icono_manifestations WHERE manifestation_id = ?",
      manifestationId,
    ).status,
    "withdrawn",
  )
})

test("service material routes round-trip exact prose and structured Tags without storage metadata", async (t) => {
  const context = await bootstrap(t, "7005")
  const env = serviceEnvironment()
  const objects = installMemoryBodyStorage(t)
  const revisionId = "revision_material_7005"
  const prose = "A caretaker-authored manifestation.\r\nSecond line with café."
  const encryptedRevision = await encryptManifestationProse(env, {
    revisionId,
    geneId: context.geneId,
    prose,
  })
  const revisionObjectKey = await createManifestationBodyObjectKey()
  await createManifestationUploadIntent(context.db, {
    entityKind: "revision",
    entityId: revisionId,
    assignmentId: context.assignmentId,
    objectKey: revisionObjectKey,
    ciphertextSha256: encryptedRevision.ciphertext_sha256,
    bodyBytes: encryptedRevision.body_bytes,
    actorKind: "account",
    actorAccountId: USER,
    uploadIntentId: "upload_intent_material_7005",
    leaseToken: "upload_lease_material_7005",
    now: "2099-08-30T00:00:00.000Z",
  })
  const revisionUpload = await putEncryptedManifestationBody(
    env,
    revisionObjectKey,
    encryptedRevision.ciphertext,
    { expectedSha256: encryptedRevision.ciphertext_sha256 },
  )
  await saveManifestationRevision(context.db, {
    assignmentId: context.assignmentId,
    expectedAssignmentVersion: 2,
    expectedManifestationVersion: 0,
    expectedHeadVersion: 1,
    expectedCanonicalRevisionId: context.seedRevisionId,
    storage: {
      body_sha256: encryptedRevision.body_sha256,
      body_bytes: encryptedRevision.body_bytes,
      object_key: revisionObjectKey,
      ciphertext_sha256: encryptedRevision.ciphertext_sha256,
      ciphertext_bytes: encryptedRevision.ciphertext_bytes,
      body_iv_base64: encryptedRevision.body_iv_base64,
      wrapped_dek_base64: encryptedRevision.wrapped_dek_base64,
      wrap_iv_base64: encryptedRevision.wrap_iv_base64,
      key_version: encryptedRevision.key_version,
      aad_version: encryptedRevision.aad_version,
      object_etag: revisionUpload.etag,
      verified_at: NOW,
    },
    manifestationId: "manifestation_material_7005",
    revisionId,
    selectionId: "selection_material_7005",
    eventUuid: "event_material_7005",
    now: NOW,
    ...command("command_material_7005", "7", USER, "account"),
  })

  const integrityFailures = []
  let replicaAuthorizations = 0
  let backupAuthorizations = 0
  const handler = createManifestationAuthorityServiceHandler({
    db: context.db,
    env,
    authorizeReplicaBearer: async () => {
      replicaAuthorizations += 1
      return { authorized: true, actor_kind: "service" }
    },
    authorizeBackupBearer: async () => {
      backupAuthorizations += 1
      return { authorized: true, actor_kind: "service" }
    },
    onIntegrityFailure: async (descriptor) => {
      integrityFailures.push(descriptor)
    },
    idFactory: ids(),
  })
  const revisionResponse = await handler(
    serviceRequest(`/api/iconoplasm/authority/revisions/${revisionId}/body`),
  )
  assert.equal(revisionResponse.status, 200)
  assert.equal(revisionResponse.headers.get("cache-control"), "private, no-store")
  assert.deepEqual(await revisionResponse.json(), {
    schema_version: 1,
    entity_kind: "revision_body",
    manifestation_revision_id: revisionId,
    body_plain: encryptedRevision.prose,
    body_plain_sha256: encryptedRevision.body_sha256,
    body_byte_length: encryptedRevision.body_bytes,
  })

  const tagsInput = {
    tagsText: "female scientist, green eyes\r\nprecision laboratory",
    fieldsJson: { zeta: ["β", true, null], alpha: { species: "human" } },
  }
  const preparedTags = await prepareManifestationTagsPayload({
    ...tagsInput,
    tagsSha256: await crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(tagsInput.tagsText.replace(/\r\n?/g, "\n")))
      .then((value) => Buffer.from(value).toString("hex")),
    fieldsSha256: await crypto.subtle
      .digest(
        "SHA-256",
        new TextEncoder().encode('{"alpha":{"species":"human"},"zeta":["\\u03b2",true,null]}'),
      )
      .then((value) => Buffer.from(value).toString("hex")),
  })
  const expectedGeneRevision = row(
    context.db,
    "SELECT gene_revision FROM icono_manifestation_heads WHERE gene_id = ?",
    context.geneId,
  ).gene_revision
  const submitResponse = await handler(
    serviceRequest(`/api/iconoplasm/authority/revisions/${revisionId}/tags-derivatives`, {
      command_id: "service_tags_command_7005",
      status: "complete",
      source_body_sha256: encryptedRevision.body_sha256,
      tags_text: tagsInput.tagsText,
      tags_sha256: preparedTags.tags_sha256,
      fields_json: tagsInput.fieldsJson,
      fields_sha256: preparedTags.fields_sha256,
      recipe_id: "tags_recipe",
      recipe_version: "v1",
      provider_id: "provider",
      model_id: "model",
      tagger_config_sha256: sha("9"),
      expected_gene_revision: expectedGeneRevision,
    }),
  )
  assert.equal(submitResponse.status, 200)
  const submitted = await submitResponse.json()
  const derivative = row(
    context.db,
    "SELECT * FROM icono_manifestation_derivatives WHERE manifestation_derivative_id = ?",
    submitted.manifestation_derivative_id,
  )
  assert.equal(derivative.tags_sha256, preparedTags.tags_sha256)
  assert.equal(derivative.fields_sha256, preparedTags.fields_sha256)
  assert.equal(derivative.body_bytes, derivative.tags_bytes + 1 + derivative.fields_bytes)
  const event = JSON.parse(
    row(
      context.db,
      "SELECT payload_json FROM icono_manifestation_events WHERE event_uuid = ?",
      submitted.event_id,
    ).payload_json,
  )
  assert.equal(event.changed_derivative.fields_sha256, preparedTags.fields_sha256)

  const materialResponse = await handler(
    serviceRequest(
      `/api/iconoplasm/authority/derivatives/${submitted.manifestation_derivative_id}/body`,
    ),
  )
  assert.equal(materialResponse.status, 200)
  assert.equal(materialResponse.headers.get("cache-control"), "private, no-store")
  const material = await materialResponse.json()
  assert.deepEqual(Object.keys(material), [
    "schema_version",
    "entity_kind",
    "manifestation_derivative_id",
    "manifestation_revision_id",
    "output_plain_sha256",
    "output_plain_bytes",
    "tags_text",
    "tags_sha256",
    "fields_json",
    "fields_sha256",
  ])
  assert.equal(material.tags_text, preparedTags.tags_text)
  assert.deepEqual(material.fields_json, preparedTags.fields_json)
  assert.equal(material.output_plain_sha256, preparedTags.output_plain_sha256)
  assert.equal(material.output_plain_bytes, preparedTags.output_plain_bytes)
  assert.equal("tags_bytes" in material, false)
  assert.equal("fields_bytes" in material, false)

  const storageRow = row(
    context.db,
    "SELECT object_key FROM icono_manifestation_derivative_storage_secrets WHERE manifestation_derivative_id = ?",
    submitted.manifestation_derivative_id,
  )
  const derivativeUrl = [...objects.keys()].find((key) => key.endsWith(storageRow.object_key))
  const corrupted = Uint8Array.from(objects.get(derivativeUrl))
  corrupted[0] ^= 0xff
  objects.set(derivativeUrl, corrupted)
  const corruptResponse = await handler(
    serviceRequest(
      `/api/iconoplasm/authority/derivatives/${submitted.manifestation_derivative_id}/body`,
    ),
  )
  assert.equal(corruptResponse.status, 503)
  assert.equal((await corruptResponse.json()).error.code, "DERIVATIVE_BODY_UNAVAILABLE")
  assert.equal(integrityFailures.at(-1).entity_id, submitted.manifestation_derivative_id)

  const backupCapability = await handler(
    serviceRequest("/api/iconoplasm/authority/backups/capabilities", {
      entity_kind: "revision",
      entity_id: revisionId,
      ttl_seconds: 120,
    }),
  )
  assert.equal(backupCapability.status, 200)
  assert.equal((await backupCapability.json()).entity_id, revisionId)
  assert.equal(replicaAuthorizations > 0, true)
  assert.equal(backupAuthorizations, 1)
})

test("structured Tags submission rejects hash mismatch and numeric fields before upload", async (t) => {
  const context = await bootstrap(t, "7006")
  const env = serviceEnvironment()
  const objects = installMemoryBodyStorage(t)
  const handler = createManifestationAuthorityServiceHandler({
    db: context.db,
    env,
    authorizeReplicaBearer: async () => ({ authorized: true, actor_kind: "service" }),
    idFactory: ids(),
  })
  const expectedGeneRevision = row(
    context.db,
    "SELECT gene_revision FROM icono_manifestation_heads WHERE gene_id = ?",
    context.geneId,
  ).gene_revision
  const base = {
    status: "complete",
    source_body_sha256: storage(1).body_sha256,
    tags_text: "green eyes",
    tags_sha256: sha("0"),
    fields_json: { traits: ["green eyes"] },
    fields_sha256: sha("0"),
    recipe_id: "tags_recipe",
    recipe_version: "v1",
    provider_id: "provider",
    model_id: "model",
    tagger_config_sha256: sha("9"),
    expected_gene_revision: expectedGeneRevision,
  }
  const hashMismatch = await handler(
    serviceRequest(
      `/api/iconoplasm/authority/revisions/${context.seedRevisionId}/tags-derivatives`,
      { ...base, command_id: "service_tags_bad_hash_7006" },
    ),
  )
  assert.equal(hashMismatch.status, 409)
  assert.equal((await hashMismatch.json()).error.code, "TAGS_HASH_MISMATCH")
  const numeric = await handler(
    serviceRequest(
      `/api/iconoplasm/authority/revisions/${context.seedRevisionId}/tags-derivatives`,
      {
        ...base,
        command_id: "service_tags_numeric_7006",
        fields_json: { confidence: 0.9 },
      },
    ),
  )
  assert.equal(numeric.status, 400)
  assert.equal((await numeric.json()).error.code, "NUMERIC_TAG_FIELD_FORBIDDEN")
  assert.equal(objects.size, 0)
  assert.equal(
    row(context.db, "SELECT count(*) AS total FROM icono_manifestation_upload_intents").total,
    0,
  )
})

test("service-authenticated maintenance exposes bounded command replay retention", async (t) => {
  const context = await bootstrap(t, "7007")
  let authorizations = 0
  let wrongAudienceAuthorizations = 0
  const handler = createManifestationAuthorityServiceHandler({
    db: context.db,
    env: serviceEnvironment(),
    authorizeMaintenanceBearer: async () => {
      authorizations += 1
      return { authorized: true, actor_kind: "service" }
    },
    authorizeReplicaBearer: async () => {
      wrongAudienceAuthorizations += 1
      return { authorized: true, actor_kind: "service" }
    },
    authorizeBackupBearer: async () => {
      wrongAudienceAuthorizations += 1
      return { authorized: true, actor_kind: "service" }
    },
  })
  const compact = await handler(
    serviceRequest("/api/iconoplasm/authority/maintenance/command-receipts/compact", {
      limit: 7,
      now: "2026-09-30T00:00:00.000Z",
    }),
  )
  assert.equal(compact.status, 200)
  assert.deepEqual(await compact.json(), { schema_version: 1, compacted: 0 })
  const sweep = await handler(
    serviceRequest("/api/iconoplasm/authority/maintenance/command-tombstones/sweep", {
      limit: 7,
      now: "2026-09-30T00:00:00.000Z",
    }),
  )
  assert.equal(sweep.status, 200)
  assert.deepEqual(await sweep.json(), { schema_version: 1, purged: 0 })
  assert.equal(authorizations, 2)
  assert.equal(wrongAudienceAuthorizations, 0)
})
