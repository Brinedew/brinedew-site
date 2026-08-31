import assert from "node:assert/strict"
import test from "node:test"

import {
  changeManifestationLegalHold,
  offerCaretakerAssignment,
  purgeManifestation,
  registerAuthorityAccount,
  registerCaretakerTermsVersion,
  registerGeneIdentity,
  saveManifestationRevision,
  selectManifestationRevision,
  seedSystemManifestation,
  sweepManifestationPurgeQueue,
  sweepWithdrawnManifestationRetention,
  transitionCaretakerAssignment,
  withdrawOwnManifestation,
} from "./manifestation-authority.js"
import { TestD1, command, row, sha, storage } from "./manifestation-authority-test-support.js"

const NOW = "2026-08-30T00:00:00.000Z"
const DEADLINE = "2026-09-29T00:00:00.000Z"
const ADMIN = "account_retention_admin"
const USER = "account_retention_user1"
const TERMS = "terms_retention_0001"

async function bootstrap(t, suffix) {
  const db = new TestD1()
  t.after(() => db.close())
  await registerAuthorityAccount(db, { accountId: ADMIN, now: NOW })
  await registerAuthorityAccount(db, { accountId: USER, now: NOW })
  await registerCaretakerTermsVersion(db, {
    termsVersionId: TERMS,
    termsSha256: sha("f"),
    documentUrl: "https://iconoplasm.brinedew.bio/caretaker-terms",
    displayLabel: "Retention test terms",
    effectiveAt: NOW,
    createdByAccountId: ADMIN,
  })
  const geneId = `gene_retention_${suffix}`
  const assignmentId = `assignment_retention_${suffix}`
  const seedRevisionId = `revision_retention_seed_${suffix}`
  await registerGeneIdentity(db, { geneId, canonicalSymbol: `R${suffix}`, now: NOW })
  await seedSystemManifestation(db, {
    geneId,
    storage: storage(101),
    expectedHeadVersion: 0,
    manifestationId: `manifestation_retention_seed_${suffix}`,
    revisionId: seedRevisionId,
    selectionId: `selection_retention_seed_${suffix}`,
    eventUuid: `event_retention_seed_${suffix}`,
    now: NOW,
    ...command(`command_retention_seed_${suffix}`, "1", null, "migration"),
  })
  await offerCaretakerAssignment(db, {
    geneId,
    accountId: USER,
    invitedByAccountId: ADMIN,
    entitlementPolicyVersion: "entitlement-v1",
    expectedGeneRevision: 1,
    assignmentId,
    eventUuid: `event_retention_offer_${suffix}`,
    now: NOW,
    ...command(`command_retention_offer_${suffix}`, "2", ADMIN, "administrator"),
  })
  await transitionCaretakerAssignment(db, {
    assignmentId,
    action: "accept",
    expectedAssignmentVersion: 1,
    termsVersionId: TERMS,
    relinquishPolicy: "retain",
    eventUuid: `event_retention_accept_${suffix}`,
    now: NOW,
    ...command(`command_retention_accept_${suffix}`, "3", USER, "account"),
  })
  const manifestationId = `manifestation_retention_user_${suffix}`
  const revisionId = `revision_retention_user_${suffix}`
  await saveManifestationRevision(db, {
    assignmentId,
    expectedAssignmentVersion: 2,
    expectedManifestationVersion: 0,
    expectedHeadVersion: 1,
    expectedCanonicalRevisionId: seedRevisionId,
    storage: storage(102),
    manifestationId,
    revisionId,
    selectionId: `selection_retention_user_${suffix}`,
    eventUuid: `event_retention_save_${suffix}`,
    now: NOW,
    ...command(`command_retention_save_${suffix}`, "4", USER, "account"),
  })
  await selectManifestationRevision(db, {
    assignmentId,
    revisionId,
    expectedAssignmentVersion: 2,
    expectedHeadVersion: 1,
    expectedCanonicalRevisionId: seedRevisionId,
    selectionId: `selection_retention_user_${suffix}`,
    eventUuid: `event_retention_select_${suffix}`,
    now: NOW,
    ...command(`command_retention_select_${suffix}`, "5", USER, "account"),
  })
  await withdrawOwnManifestation(db, {
    manifestationId,
    expectedManifestationVersion: 1,
    expectedHeadVersion: 2,
    expectedCanonicalRevisionId: revisionId,
    selectionId: `selection_retention_withdraw_${suffix}`,
    eventUuid: `event_retention_withdraw_${suffix}`,
    now: NOW,
    ...command(`command_retention_withdraw_${suffix}`, "6", USER, "account"),
  })
  return { db, geneId, manifestationId, revisionId, seedRevisionId }
}

test("withdrawal retention is clock-bound, legal-hold aware, key-erasing, and retryable", async (t) => {
  const context = await bootstrap(t, "8001")
  const withdrawn = row(
    context.db,
    "SELECT status, purge_eligible_at FROM icono_manifestations WHERE manifestation_id = ?",
    context.manifestationId,
  )
  assert.equal(withdrawn.status, "withdrawn")
  assert.equal(withdrawn.purge_eligible_at, DEADLINE)
  assert.equal(
    (
      await sweepWithdrawnManifestationRetention(context.db, {
        now: "2026-09-28T23:59:59.999Z",
      })
    ).processed,
    0,
  )
  await assert.rejects(
    purgeManifestation(context.db, {
      manifestationId: context.manifestationId,
      expectedManifestationVersion: 2,
      expectedHeadVersion: 3,
      expectedCanonicalRevisionId: context.seedRevisionId,
      reasonCode: "early_nonurgent_attempt",
      now: "2026-09-28T23:59:59.999Z",
      ...command("command_retention_early_8001", "6", ADMIN, "administrator"),
    }),
    { code: "MANIFESTATION_PURGE_RETENTION_ACTIVE" },
  )
  await changeManifestationLegalHold(context.db, {
    manifestationId: context.manifestationId,
    action: "place",
    legalHoldId: "legal_hold_retention_8001",
    reasonCode: "preservation_request",
    expectedGeneRevision: 6,
    eventUuid: "event_retention_hold_8001",
    now: "2026-09-01T00:00:00.000Z",
    ...command("command_retention_hold_8001", "7", ADMIN, "administrator"),
  })
  assert.equal(
    (await sweepWithdrawnManifestationRetention(context.db, { now: DEADLINE })).processed,
    0,
  )
  await changeManifestationLegalHold(context.db, {
    manifestationId: context.manifestationId,
    action: "release",
    legalHoldId: "legal_hold_retention_8001",
    reasonCode: "preservation_complete",
    expectedGeneRevision: 7,
    eventUuid: "event_retention_release_8001",
    now: DEADLINE,
    ...command("command_retention_release_8001", "8", ADMIN, "administrator"),
  })
  const due = await sweepWithdrawnManifestationRetention(context.db, { now: DEADLINE })
  assert.equal(due.processed, 1)
  assert.equal(due.results[0].status, "purged")
  assert.equal(
    row(
      context.db,
      "SELECT status FROM icono_manifestations WHERE manifestation_id = ?",
      context.manifestationId,
    ).status,
    "purged",
  )
  assert.equal(
    row(
      context.db,
      "SELECT status FROM icono_manifestation_revision_lifecycle WHERE manifestation_revision_id = ?",
      context.revisionId,
    ).status,
    "purged",
  )
  assert.equal(
    row(
      context.db,
      "SELECT count(*) AS total FROM icono_manifestation_revision_storage_secrets WHERE manifestation_revision_id = ?",
      context.revisionId,
    ).total,
    0,
  )
  assert.equal(
    row(
      context.db,
      "SELECT status FROM icono_manifestation_object_purge_queue WHERE entity_id = ?",
      context.revisionId,
    ).status,
    "pending",
  )
  assert.equal(
    (await sweepWithdrawnManifestationRetention(context.db, { now: DEADLINE })).processed,
    0,
  )
  assert.equal(
    row(
      context.db,
      "SELECT count(*) AS total FROM icono_manifestation_events WHERE manifestation_id = ? AND payload_json LIKE '%manifestation.purged%'",
      context.manifestationId,
    ).total,
    1,
  )

  const originalFetch = globalThis.fetch
  t.after(() => {
    globalThis.fetch = originalFetch
  })
  let failDelete = true
  globalThis.fetch = async () =>
    failDelete ? new Response(null, { status: 500 }) : new Response(null, { status: 404 })
  const purgeEnv = {
    ICONOPLASM_AUTHORING_STORAGE_ZONE: "retention-test-zone",
    ICONOPLASM_AUTHORING_STORAGE_PASSWORD: "retention-test-password",
  }
  const failed = await sweepManifestationPurgeQueue(context.db, purgeEnv, {
    limit: 1,
    now: DEADLINE,
  })
  assert.equal(failed.results[0].status, "failed")
  assert.equal(
    row(
      context.db,
      "SELECT count(*) AS total FROM icono_manifestation_revision_storage_secrets WHERE manifestation_revision_id = ?",
      context.revisionId,
    ).total,
    0,
  )
  failDelete = false
  const retried = await sweepManifestationPurgeQueue(context.db, purgeEnv, {
    limit: 1,
    now: "2026-09-30T00:00:00.000Z",
  })
  assert.equal(retried.results[0].status, "deleted", JSON.stringify(retried))
})

test("urgent purge is explicit and bypasses only the retention clock", async (t) => {
  const context = await bootstrap(t, "8002")
  const purged = await purgeManifestation(context.db, {
    manifestationId: context.manifestationId,
    expectedManifestationVersion: 2,
    expectedHeadVersion: 3,
    expectedCanonicalRevisionId: context.seedRevisionId,
    reasonCode: "urgent_legal_removal",
    urgentPurge: true,
    now: "2026-08-31T00:00:00.000Z",
    ...command("command_retention_urgent_8002", "6", ADMIN, "administrator"),
  })
  assert.equal(purged.status, "purged")
  assert.equal(
    row(
      context.db,
      "SELECT count(*) AS total FROM icono_manifestation_revision_storage_secrets WHERE manifestation_revision_id = ?",
      context.revisionId,
    ).total,
    0,
  )
})
