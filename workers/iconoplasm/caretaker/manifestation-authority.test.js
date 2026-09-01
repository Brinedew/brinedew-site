import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { DatabaseSync } from "node:sqlite"

import {
  CARETAKER_ENTITLEMENT_POLICY_VERSION,
  MANIFESTATION_AUTHORITY_EVENT_TYPE,
  claimCaretakerAssignment,
  endCaretakerAssignment,
  mergeGeneIdentity,
  offerCaretakerAssignment,
  readCaretakerGeneDossier,
  readManifestationAuthorityGeneState,
  registerAuthorityAccount,
  registerCaretakerTermsVersion,
  registerGeneIdentity,
  restoreOwnManifestation,
  saveManifestationRevision,
  seedSystemManifestation,
  selectManifestationRevision,
  transitionCaretakerAssignment,
  withdrawOwnManifestation,
} from "./manifestation-authority.js"

const MIGRATIONS = [
  "../../../migrations-iconoplasm-authoring/0001_caretaker_manifestation_authority.sql",
  "../../../migrations-iconoplasm-authoring/0002_caretaker_server_boundary.sql",
  "../../../migrations-iconoplasm-authoring/0007_manifestation_page_visibility.sql",
].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"))
const NOW = "2026-08-30T00:00:00.000Z"
const ADMIN = "account_admin_0001"
const USER = "account_user_00001"
const OTHER = "account_user_00002"
const TERMS = "terms_version_0001"

class TestStatement {
  constructor(database, sql, parameters = []) {
    this.database = database
    this.sql = sql
    this.parameters = parameters
  }

  bind(...parameters) {
    return new TestStatement(this.database, this.sql, parameters)
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.parameters) || null
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.parameters) }
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.parameters)
    return { success: true, meta: { changes: Number(result.changes) } }
  }
}

class TestD1 {
  constructor() {
    this.raw = new DatabaseSync(":memory:")
    for (const migration of MIGRATIONS) this.raw.exec(migration)
  }

  prepare(sql) {
    return new TestStatement(this.raw, sql)
  }

  async batch(statements) {
    this.raw.exec("BEGIN IMMEDIATE")
    try {
      const results = []
      for (const statement of statements) results.push(await statement.run())
      this.raw.exec("COMMIT")
      return results
    } catch (error) {
      this.raw.exec("ROLLBACK")
      throw error
    }
  }

  close() {
    this.raw.close()
  }
}

function sha(character) {
  return character.repeat(64)
}

function command(commandId, hashCharacter = "a", actorAccountId = USER, actorKind = "account") {
  return {
    commandId,
    requestSha256: sha(hashCharacter),
    actorAccountId,
    actorKind,
  }
}

function storage(sequence, bodyBytes = 100) {
  const locator = `opaque_${String(sequence).padStart(4, "0")}_${"x".repeat(40)}`
  return {
    body_sha256: sha(sequence % 2 ? "b" : "c"),
    body_bytes: bodyBytes,
    object_key: `private/manifestations/v1/aa/${locator}.bin`,
    ciphertext_sha256: sha(sequence % 2 ? "d" : "e"),
    ciphertext_bytes: bodyBytes + 16,
    body_iv_base64: "A".repeat(16),
    wrapped_dek_base64: "B".repeat(32),
    wrap_iv_base64: "C".repeat(16),
    key_version: 1,
    object_etag: `etag-${sequence}`,
    verified_at: NOW,
  }
}

function row(db, sql, ...parameters) {
  return db.raw.prepare(sql).get(...parameters) || null
}

function rows(db, sql, ...parameters) {
  return db.raw.prepare(sql).all(...parameters)
}

async function bootstrap(t, suffix = "0001", relinquishPolicy = "retain") {
  const db = new TestD1()
  t.after(() => db.close())
  const geneId = `gene_tp53_${suffix}`
  const assignmentId = `assignment_${suffix}`
  const seedManifestationId = `manifestation_seed_${suffix}`
  const seedRevisionId = `revision_seed_${suffix}`

  await registerAuthorityAccount(db, { accountId: ADMIN, now: NOW })
  await registerAuthorityAccount(db, { accountId: USER, now: NOW })
  await registerAuthorityAccount(db, { accountId: OTHER, now: NOW })
  await registerGeneIdentity(db, { geneId, canonicalSymbol: `TP${suffix}`, now: NOW })
  await registerCaretakerTermsVersion(db, {
    termsVersionId: TERMS,
    termsSha256: sha("f"),
    documentUrl: "https://brinedew.com/iconoplasm/caretaker-terms/v1",
    displayLabel: "Caretaker terms v1",
    effectiveAt: NOW,
    createdByAccountId: ADMIN,
  })
  await seedSystemManifestation(db, {
    geneId,
    storage: storage(1),
    expectedHeadVersion: 0,
    expectedCanonicalRevisionId: null,
    manifestationId: seedManifestationId,
    revisionId: seedRevisionId,
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
    relinquishPolicy,
    eventUuid: `event_accept_${suffix}`,
    now: NOW,
    ...command(`command_accept_${suffix}`, "3"),
  })

  return {
    assignmentId,
    db,
    geneId,
    seedManifestationId,
    seedRevisionId,
  }
}

async function saveFirst(db, context, suffix = "0001") {
  return saveManifestationRevision(db, {
    assignmentId: context.assignmentId,
    expectedAssignmentVersion: 2,
    expectedManifestationVersion: 0,
    storage: storage(10),
    manifestationId: `manifestation_user_${suffix}`,
    revisionId: `revision_user_${suffix}_01`,
    eventUuid: `event_save_${suffix}_01`,
    now: NOW,
    ...command(`command_save_${suffix}_01`, "4"),
  })
}

async function selectSavedRevision(
  db,
  {
    assignmentId,
    geneId,
    revisionId,
    selectionId,
    eventUuid,
    commandId,
    hashCharacter = "a",
    actorAccountId = USER,
  },
) {
  const assignment = row(
    db,
    `SELECT assignment_version FROM icono_caretaker_assignments
      WHERE caretaker_assignment_id = ?`,
    assignmentId,
  )
  const head = row(
    db,
    `SELECT head_version, canonical_revision_id FROM icono_manifestation_heads
      WHERE gene_id = ?`,
    geneId,
  )
  return selectManifestationRevision(db, {
    assignmentId,
    revisionId,
    expectedAssignmentVersion: assignment.assignment_version,
    expectedHeadVersion: head.head_version,
    expectedCanonicalRevisionId: head.canonical_revision_id,
    selectionId,
    eventUuid,
    now: NOW,
    ...command(commandId, hashCharacter, actorAccountId),
  })
}

test("registers stable identities and enforces one open gene assignment per account", async (t) => {
  const db = new TestD1()
  t.after(() => db.close())

  assert.deepEqual(
    await registerAuthorityAccount(db, { accountId: ADMIN, now: NOW }),
    await registerAuthorityAccount(db, { accountId: ADMIN, now: NOW }),
  )
  await registerAuthorityAccount(db, { accountId: USER, now: NOW })
  const geneA = await registerGeneIdentity(db, {
    geneId: "gene_identity_0001",
    canonicalSymbol: "abc1",
    now: NOW,
  })
  assert.equal(geneA.canonical_symbol, "ABC1")
  assert.equal(
    row(db, "SELECT gene_id FROM icono_gene_aliases WHERE alias_symbol = 'ABC1'").gene_id,
    geneA.gene_id,
  )
  await assert.rejects(
    registerGeneIdentity(db, {
      geneId: "gene_identity_0002",
      canonicalSymbol: "ABC1",
      now: NOW,
    }),
    { code: "GENE_IDENTITY_CONFLICT", status: 409 },
  )

  await registerGeneIdentity(db, {
    geneId: "gene_identity_0003",
    canonicalSymbol: "ABC3",
    now: NOW,
  })
  for (const [index, geneId] of ["gene_identity_0001", "gene_identity_0003"].entries()) {
    await seedSystemManifestation(db, {
      geneId,
      storage: storage(70 + index),
      expectedHeadVersion: 0,
      manifestationId: `manifestation_multi_seed_${index}`,
      revisionId: `revision_multi_seed_${index}`,
      selectionId: `selection_multi_seed_${index}`,
      eventUuid: `event_multi_seed_${index}`,
      now: NOW,
      ...command(`command_multi_seed_${index}`, index ? "7" : "6", null, "migration"),
    })
  }
  await offerCaretakerAssignment(db, {
    geneId: "gene_identity_0001",
    accountId: USER,
    invitedByAccountId: ADMIN,
    entitlementPolicyVersion: "entitlement-v1",
    expectedGeneRevision: 1,
    assignmentId: "assignment_multi_0000",
    eventUuid: "event_multi_0000",
    now: NOW,
    ...command("command_multi_0000", "5", ADMIN, "administrator"),
  })
  await assert.rejects(
    offerCaretakerAssignment(db, {
      geneId: "gene_identity_0003",
      accountId: USER,
      invitedByAccountId: ADMIN,
      entitlementPolicyVersion: "entitlement-v1",
      expectedGeneRevision: 1,
      assignmentId: "assignment_multi_0001",
      eventUuid: "event_multi_0001",
      now: NOW,
      ...command("command_multi_0001", "6", ADMIN, "administrator"),
    }),
    { code: "ACCOUNT_ALREADY_HAS_OPEN_ASSIGNMENT", status: 409 },
  )
  assert.equal(
    row(db, "SELECT count(*) AS count FROM icono_caretaker_assignments WHERE account_id = ?", USER)
      .count,
    1,
  )
  const declined = await transitionCaretakerAssignment(db, {
    assignmentId: "assignment_multi_0000",
    action: "decline",
    expectedAssignmentVersion: 1,
    eventUuid: "event_decline_multi_0000",
    now: NOW,
    ...command("command_decline_multi_0000", "7"),
  })
  assert.equal(declined.status, "ended")
  const declinedRow = row(
    db,
    `SELECT terms_accepted_at, relinquish_policy, end_reason
       FROM icono_caretaker_assignments WHERE caretaker_assignment_id = ?`,
    "assignment_multi_0000",
  )
  assert.equal(declinedRow.terms_accepted_at, null)
  assert.equal(declinedRow.relinquish_policy, null)
  assert.equal(declinedRow.end_reason, "invitation_declined")
  await offerCaretakerAssignment(db, {
    geneId: "gene_identity_0003",
    accountId: USER,
    invitedByAccountId: ADMIN,
    entitlementPolicyVersion: "entitlement-v1",
    expectedGeneRevision: 1,
    assignmentId: "assignment_multi_0002",
    eventUuid: "event_multi_0002",
    now: NOW,
    ...command("command_multi_0002", "8", ADMIN, "administrator"),
  })
  const cancelled = await transitionCaretakerAssignment(db, {
    assignmentId: "assignment_multi_0002",
    action: "cancel",
    expectedAssignmentVersion: 1,
    eventUuid: "event_cancel_multi_0002",
    now: NOW,
    ...command("command_cancel_multi_0002", "9", ADMIN, "administrator"),
  })
  assert.equal(cancelled.status, "ended")
  assert.equal(
    row(
      db,
      "SELECT end_reason FROM icono_caretaker_assignments WHERE caretaker_assignment_id = ?",
      "assignment_multi_0002",
    ).end_reason,
    "invitation_cancelled",
  )
})

test("an account atomically claims an available seeded gene with pinned terms and leave policy", async (t) => {
  const db = new TestD1()
  t.after(() => db.close())
  const geneId = "gene_claim_0001"
  await registerAuthorityAccount(db, { accountId: ADMIN, now: NOW })
  await registerAuthorityAccount(db, { accountId: USER, now: NOW })
  await registerAuthorityAccount(db, { accountId: OTHER, now: NOW })
  await registerGeneIdentity(db, { geneId, canonicalSymbol: "CLM1", now: NOW })
  await registerCaretakerTermsVersion(db, {
    termsVersionId: TERMS,
    termsSha256: sha("f"),
    documentUrl: "https://brinedew.com/iconoplasm/caretaker-terms/v1",
    displayLabel: "Caretaker terms v1",
    effectiveAt: NOW,
    createdByAccountId: ADMIN,
  })
  await seedSystemManifestation(db, {
    geneId,
    storage: storage(90),
    expectedHeadVersion: 0,
    manifestationId: "manifestation_claim_seed_0001",
    revisionId: "revision_claim_seed_0001",
    selectionId: "selection_claim_seed_0001",
    eventUuid: "event_claim_seed_0001",
    now: NOW,
    ...command("command_claim_seed_0001", "1", null, "migration"),
  })
  const claimInput = {
    geneId,
    accountId: USER,
    termsVersionId: TERMS,
    relinquishPolicy: "withdraw",
    entitlementPolicyVersion: CARETAKER_ENTITLEMENT_POLICY_VERSION,
    expectedGeneRevision: 1,
    assignmentId: "assignment_claim_0001",
    eventUuid: "event_claim_0001",
    now: NOW,
    ...command("command_claim_0001", "2"),
  }
  const claimed = await claimCaretakerAssignment(db, claimInput)
  const replayed = await claimCaretakerAssignment(db, claimInput)
  assert.deepEqual({ ...replayed, replayed: false }, claimed)
  assert.equal(replayed.replayed, true)
  assert.equal(claimed.status, "active")
  assert.equal(claimed.assignment_version, 1)
  assert.equal(claimed.gene_revision, 2)
  assert.deepEqual(
    {
      ...row(
        db,
        `SELECT account_id, invited_by_account_id, status, assignment_version,
              terms_version_id, entitlement_policy_version, relinquish_policy
         FROM icono_caretaker_assignments WHERE caretaker_assignment_id = ?`,
        "assignment_claim_0001",
      ),
    },
    {
      account_id: USER,
      invited_by_account_id: USER,
      status: "active",
      assignment_version: 1,
      terms_version_id: TERMS,
      entitlement_policy_version: CARETAKER_ENTITLEMENT_POLICY_VERSION,
      relinquish_policy: "withdraw",
    },
  )
  await assert.rejects(
    claimCaretakerAssignment(db, {
      ...claimInput,
      accountId: OTHER,
      assignmentId: "assignment_claim_0002",
      eventUuid: "event_claim_0002",
      ...command("command_claim_0002", "3", OTHER),
    }),
    { code: "STALE_AUTHORITY_STATE", status: 409 },
  )
})

test("assignment acceptance, suspension, and resume preserve the default leave policy", async (t) => {
  const context = await bootstrap(t, "1001", "withdraw")
  const suspended = await transitionCaretakerAssignment(context.db, {
    assignmentId: context.assignmentId,
    action: "suspend",
    expectedAssignmentVersion: 2,
    suspensionReason: "entitlement_lapsed",
    graceEndsAt: "2026-09-01T00:00:00Z",
    eventUuid: "event_suspend_1001",
    now: NOW,
    ...command("command_suspend_1001", "5", ADMIN, "administrator"),
  })
  assert.equal(suspended.status, "suspended")
  const resumed = await transitionCaretakerAssignment(context.db, {
    assignmentId: context.assignmentId,
    action: "resume",
    expectedAssignmentVersion: 3,
    eventUuid: "event_resume_1001",
    now: NOW,
    ...command("command_resume_1001", "6", ADMIN, "administrator"),
  })
  assert.equal(resumed.status, "active")
  const assignment = row(
    context.db,
    "SELECT status, assignment_version, relinquish_policy, suspension_reason FROM icono_caretaker_assignments WHERE caretaker_assignment_id = ?",
    context.assignmentId,
  )
  assert.deepEqual(
    { ...assignment },
    {
      status: "active",
      assignment_version: 4,
      relinquish_policy: "withdraw",
      suspension_reason: null,
    },
  )
})

test("save is atomic, noncanonical, idempotent, and reports orphan reconciliation on stale lineage CAS", async (t) => {
  const context = await bootstrap(t, "2001")
  const input = {
    assignmentId: context.assignmentId,
    expectedAssignmentVersion: 2,
    expectedManifestationVersion: 0,
    storage: storage(20),
    manifestationId: "manifestation_user_2001",
    revisionId: "revision_user_2001_01",
    eventUuid: "event_save_2001_01",
    now: NOW,
    ...command("command_save_2001_01", "7"),
  }
  const first = await saveManifestationRevision(context.db, input)
  assert.equal(first.event_id, "event_save_2001_01")
  assert.equal(first.accepted_event_sequence > 0, true)
  assert.equal(
    row(
      context.db,
      "SELECT canonical_revision_id FROM icono_manifestation_heads WHERE gene_id = ?",
      context.geneId,
    ).canonical_revision_id,
    context.seedRevisionId,
  )
  assert.equal(first.canonical_changed, false)
  assert.equal(first.canonical_revision_id, context.seedRevisionId)
  assert.equal(
    row(context.db, "SELECT count(*) AS count FROM icono_manifestation_canonical_selections").count,
    1,
  )
  const savedEvent = row(
    context.db,
    `SELECT canonical_selection_id, payload_json FROM icono_manifestation_events
      WHERE event_uuid = ?`,
    input.eventUuid,
  )
  assert.equal(savedEvent.canonical_selection_id, null)
  const savedPayload = JSON.parse(savedEvent.payload_json)
  assert.equal(savedPayload.canonical.manifestation_revision_id, context.seedRevisionId)
  assert.equal(savedPayload.changed_selection, null)
  const replay = await saveManifestationRevision(context.db, input)
  assert.equal(replay.replayed, true)
  assert.equal(replay.accepted_event_sequence, first.accepted_event_sequence)
  assert.equal(
    row(context.db, "SELECT count(*) AS count FROM icono_manifestation_revisions").count,
    2,
  )
  await assert.rejects(saveManifestationRevision(context.db, { ...input, actorAccountId: OTHER }), {
    code: "IDEMPOTENCY_ACTOR_MISMATCH",
    status: 403,
  })
  await assert.rejects(
    saveManifestationRevision(context.db, { ...input, requestSha256: sha("8") }),
    { code: "IDEMPOTENCY_KEY_REUSED", status: 409 },
  )

  const staleInput = {
    ...input,
    commandId: "command_save_2001_02",
    requestSha256: sha("9"),
    revisionId: "revision_user_2001_02",
    eventUuid: "event_save_2001_02",
    storage: storage(21),
  }
  await assert.rejects(saveManifestationRevision(context.db, staleInput), (error) => {
    assert.equal(error.code, "STALE_AUTHORITY_STATE")
    assert.deepEqual(error.storageReconciliation, {
      action: "verify_revision_then_delete_if_unreferenced",
      manifestation_revision_id: staleInput.revisionId,
      object_key: staleInput.storage.object_key,
      ciphertext_sha256: staleInput.storage.ciphertext_sha256,
    })
    return true
  })
  assert.equal(
    row(context.db, "SELECT count(*) AS count FROM icono_manifestation_revisions").count,
    2,
  )
})

test("save v2 preserves canonical v1 until explicit selection, then rollback selects v1", async (t) => {
  const context = await bootstrap(t, "3001")
  const first = await saveFirst(context.db, context, "3001")
  const selectedFirst = await selectManifestationRevision(context.db, {
    assignmentId: context.assignmentId,
    revisionId: first.manifestation_revision_id,
    expectedAssignmentVersion: 2,
    expectedHeadVersion: first.head_version,
    expectedCanonicalRevisionId: context.seedRevisionId,
    selectionId: "selection_user_3001_01",
    eventUuid: "event_select_3001_01",
    now: NOW,
    ...command("command_select_3001_01", "5"),
  })
  const selectionCountBeforeSave = row(
    context.db,
    "SELECT count(*) AS count FROM icono_manifestation_canonical_selections",
  ).count
  const second = await saveManifestationRevision(context.db, {
    assignmentId: context.assignmentId,
    expectedAssignmentVersion: 2,
    expectedManifestationVersion: 1,
    storage: storage(31),
    revisionId: "revision_user_3001_02",
    eventUuid: "event_save_3001_02",
    now: NOW,
    ...command("command_save_3001_02", "6"),
  })
  assert.equal(second.head_version, selectedFirst.head_version)
  assert.equal(second.canonical_changed, false)
  assert.equal(
    row(
      context.db,
      "SELECT canonical_revision_id FROM icono_manifestation_heads WHERE gene_id = ?",
      context.geneId,
    ).canonical_revision_id,
    first.manifestation_revision_id,
  )
  assert.equal(
    row(context.db, "SELECT count(*) AS count FROM icono_manifestation_canonical_selections").count,
    selectionCountBeforeSave,
  )

  const selectedSecond = await selectManifestationRevision(context.db, {
    assignmentId: context.assignmentId,
    revisionId: second.manifestation_revision_id,
    expectedAssignmentVersion: 2,
    expectedHeadVersion: second.head_version,
    expectedCanonicalRevisionId: first.manifestation_revision_id,
    selectionId: "selection_user_3001_02",
    eventUuid: "event_select_3001_02",
    now: NOW,
    ...command("command_select_3001_02", "7"),
  })
  assert.equal(selectedSecond.manifestation_revision_id, second.manifestation_revision_id)
  const rollback = await selectManifestationRevision(context.db, {
    assignmentId: context.assignmentId,
    revisionId: first.manifestation_revision_id,
    reason: "restore",
    expectedAssignmentVersion: 2,
    expectedHeadVersion: selectedSecond.head_version,
    expectedCanonicalRevisionId: second.manifestation_revision_id,
    selectionId: "selection_user_3001_03",
    eventUuid: "event_select_3001_03",
    now: NOW,
    ...command("command_select_3001_03", "8"),
  })
  assert.equal(rollback.manifestation_revision_id, first.manifestation_revision_id)
  await assert.rejects(
    selectManifestationRevision(context.db, {
      assignmentId: context.assignmentId,
      revisionId: second.manifestation_revision_id,
      expectedAssignmentVersion: 2,
      expectedHeadVersion: selectedSecond.head_version,
      expectedCanonicalRevisionId: second.manifestation_revision_id,
      selectionId: "selection_user_3001_04",
      eventUuid: "event_select_3001_04",
      now: NOW,
      ...command("command_select_3001_04", "9"),
    }),
    { code: "STALE_AUTHORITY_STATE", status: 409 },
  )
})

test("a concurrent canonical change does not block a valid lineage save", async (t) => {
  const context = await bootstrap(t, "3002")
  const first = await saveFirst(context.db, context, "3002")
  const selectedFirst = await selectManifestationRevision(context.db, {
    assignmentId: context.assignmentId,
    revisionId: first.manifestation_revision_id,
    expectedAssignmentVersion: 2,
    expectedHeadVersion: first.head_version,
    expectedCanonicalRevisionId: context.seedRevisionId,
    selectionId: "selection_user_3002_01",
    eventUuid: "event_select_3002_01",
    now: NOW,
    ...command("command_select_3002_01", "5"),
  })
  await selectManifestationRevision(context.db, {
    assignmentId: context.assignmentId,
    revisionId: context.seedRevisionId,
    expectedAssignmentVersion: 2,
    expectedHeadVersion: selectedFirst.head_version,
    expectedCanonicalRevisionId: first.manifestation_revision_id,
    selectionId: "selection_user_3002_02",
    eventUuid: "event_select_3002_02",
    now: NOW,
    ...command("command_select_3002_02", "6"),
  })

  const saved = await saveManifestationRevision(context.db, {
    assignmentId: context.assignmentId,
    expectedAssignmentVersion: 2,
    expectedManifestationVersion: 1,
    // Stale canonical values are deliberately ignored by the save boundary.
    expectedHeadVersion: selectedFirst.head_version,
    expectedCanonicalRevisionId: first.manifestation_revision_id,
    storage: storage(32),
    revisionId: "revision_user_3002_02",
    eventUuid: "event_save_3002_02",
    now: NOW,
    ...command("command_save_3002_02", "7"),
  })
  assert.equal(saved.canonical_changed, false)
  assert.equal(
    row(
      context.db,
      "SELECT canonical_revision_id FROM icono_manifestation_heads WHERE gene_id = ?",
      context.geneId,
    ).canonical_revision_id,
    context.seedRevisionId,
  )
})

test("suspension requires a bounded audit reason and resume or end clears suspension state", async (t) => {
  const context = await bootstrap(t, "3501")
  const suspend = (commandId, expectedAssignmentVersion, suspensionReason) =>
    transitionCaretakerAssignment(context.db, {
      assignmentId: context.assignmentId,
      action: "suspend",
      expectedAssignmentVersion,
      suspensionReason,
      eventUuid: `event_${commandId}`,
      now: NOW,
      ...command(commandId, String(expectedAssignmentVersion % 10), ADMIN, "administrator"),
    })
  await assert.rejects(suspend("command_suspend_missing_3501", 2, null), {
    code: "INVALID_SUSPENSION_REASON",
  })
  await assert.rejects(suspend("command_suspend_long_3501", 2, "x".repeat(501)), {
    code: "INVALID_SUSPENSION_REASON",
  })
  await suspend("command_suspend_exact_3501", 2, "  entitlement review  ")
  const suspended = row(
    context.db,
    "SELECT status, suspended_at, suspension_reason FROM icono_caretaker_assignments WHERE caretaker_assignment_id = ?",
    context.assignmentId,
  )
  assert.equal(suspended.status, "suspended")
  assert.equal(suspended.suspended_at, NOW)
  assert.equal(suspended.suspension_reason, "entitlement review")
  await transitionCaretakerAssignment(context.db, {
    assignmentId: context.assignmentId,
    action: "resume",
    expectedAssignmentVersion: 3,
    eventUuid: "event_resume_3501",
    now: NOW,
    ...command("command_resume_3501", "4", ADMIN, "administrator"),
  })
  const resumed = row(
    context.db,
    "SELECT status, suspended_at, suspension_reason FROM icono_caretaker_assignments WHERE caretaker_assignment_id = ?",
    context.assignmentId,
  )
  assert.equal(resumed.status, "active")
  assert.equal(resumed.suspended_at, null)
  assert.equal(resumed.suspension_reason, null)
  await suspend("command_suspend_again_3501", 4, "manual review")
  await endCaretakerAssignment(context.db, {
    assignmentId: context.assignmentId,
    expectedAssignmentVersion: 5,
    expectedHeadVersion: 1,
    expectedCanonicalRevisionId: context.seedRevisionId,
    relinquishPolicy: "retain",
    eventUuid: "event_end_suspended_3501",
    now: NOW,
    ...command("command_end_suspended_3501", "6", ADMIN, "administrator"),
  })
  const ended = row(
    context.db,
    "SELECT status, suspended_at, suspension_reason FROM icono_caretaker_assignments WHERE caretaker_assignment_id = ?",
    context.assignmentId,
  )
  assert.equal(ended.status, "ended")
  assert.equal(ended.suspended_at, null)
  assert.equal(ended.suspension_reason, null)
})

test("gene merge preserves source history read-only and never cross-wires target caretaker authority", async (t) => {
  const db = new TestD1()
  t.after(() => db.close())
  await registerAuthorityAccount(db, { accountId: ADMIN, now: NOW })
  await registerAuthorityAccount(db, { accountId: USER, now: NOW })
  await registerAuthorityAccount(db, { accountId: OTHER, now: NOW })
  await registerCaretakerTermsVersion(db, {
    termsVersionId: TERMS,
    termsSha256: sha("f"),
    documentUrl: "https://brinedew.com/iconoplasm/caretaker-terms/v1",
    displayLabel: "Caretaker terms v1",
    effectiveAt: NOW,
    createdByAccountId: ADMIN,
  })
  const sourceGeneId = "gene_merge_source_0001"
  const targetGeneId = "gene_merge_target_0001"
  await registerGeneIdentity(db, { geneId: sourceGeneId, canonicalSymbol: "SRC1", now: NOW })
  await registerGeneIdentity(db, { geneId: targetGeneId, canonicalSymbol: "TGT1", now: NOW })
  for (const [index, geneId] of [sourceGeneId, targetGeneId].entries()) {
    await seedSystemManifestation(db, {
      geneId,
      storage: storage(90 + index),
      expectedHeadVersion: 0,
      manifestationId: `manifestation_merge_seed_${index}`,
      revisionId: `revision_merge_seed_${index}`,
      selectionId: `selection_merge_seed_${index}`,
      eventUuid: `event_merge_seed_${index}`,
      now: NOW,
      ...command(`command_merge_seed_${index}`, index ? "2" : "1", null, "migration"),
    })
  }
  const sourceAssignmentId = "assignment_merge_source_0001"
  const targetAssignmentId = "assignment_merge_target_0001"
  await offerCaretakerAssignment(db, {
    geneId: sourceGeneId,
    accountId: OTHER,
    invitedByAccountId: ADMIN,
    entitlementPolicyVersion: "entitlement-v1",
    expectedGeneRevision: 1,
    assignmentId: sourceAssignmentId,
    eventUuid: "event_merge_offer_source",
    now: NOW,
    ...command("command_merge_offer_source", "3", ADMIN, "administrator"),
  })
  await transitionCaretakerAssignment(db, {
    assignmentId: sourceAssignmentId,
    action: "accept",
    expectedAssignmentVersion: 1,
    termsVersionId: TERMS,
    relinquishPolicy: "retain",
    eventUuid: "event_merge_accept_source",
    now: NOW,
    ...command("command_merge_accept_source", "4", OTHER, "account"),
  })
  const sourceSave = await saveManifestationRevision(db, {
    assignmentId: sourceAssignmentId,
    expectedAssignmentVersion: 2,
    expectedManifestationVersion: 0,
    expectedHeadVersion: 1,
    expectedCanonicalRevisionId: "revision_merge_seed_0",
    storage: storage(92),
    manifestationId: "manifestation_merge_other_0001",
    revisionId: "revision_merge_other_0001",
    selectionId: "selection_merge_other_0001",
    eventUuid: "event_merge_save_source",
    now: NOW,
    ...command("command_merge_save_source", "5", OTHER, "account"),
  })
  await selectSavedRevision(db, {
    assignmentId: sourceAssignmentId,
    geneId: sourceGeneId,
    revisionId: sourceSave.manifestation_revision_id,
    selectionId: "selection_merge_other_0001",
    eventUuid: "event_merge_select_source",
    commandId: "command_merge_select_source",
    hashCharacter: "6",
    actorAccountId: OTHER,
  })
  await offerCaretakerAssignment(db, {
    geneId: targetGeneId,
    accountId: USER,
    invitedByAccountId: ADMIN,
    entitlementPolicyVersion: "entitlement-v1",
    expectedGeneRevision: 1,
    assignmentId: targetAssignmentId,
    eventUuid: "event_merge_offer_target",
    now: NOW,
    ...command("command_merge_offer_target", "6", ADMIN, "administrator"),
  })
  await transitionCaretakerAssignment(db, {
    assignmentId: targetAssignmentId,
    action: "accept",
    expectedAssignmentVersion: 1,
    termsVersionId: TERMS,
    relinquishPolicy: "retain",
    eventUuid: "event_merge_accept_target",
    now: NOW,
    ...command("command_merge_accept_target", "7", USER, "account"),
  })
  await assert.rejects(
    mergeGeneIdentity(db, {
      geneId: sourceGeneId,
      targetGeneId,
      expectedIdentityVersion: 1,
      expectedGeneRevision: 5,
      eventUuid: "event_merge_refused_open",
      now: NOW,
      ...command("command_merge_refused_open", "8", ADMIN, "administrator"),
    }),
    { code: "STALE_AUTHORITY_STATE" },
  )
  await endCaretakerAssignment(db, {
    assignmentId: sourceAssignmentId,
    expectedAssignmentVersion: 2,
    expectedHeadVersion: 2,
    expectedCanonicalRevisionId: sourceSave.manifestation_revision_id,
    relinquishPolicy: "retain",
    eventUuid: "event_merge_end_source",
    now: NOW,
    ...command("command_merge_end_source", "9", OTHER, "account"),
  })
  const merged = await mergeGeneIdentity(db, {
    geneId: sourceGeneId,
    targetGeneId,
    expectedIdentityVersion: 1,
    expectedGeneRevision: 6,
    eventUuid: "event_merge_committed_0001",
    now: NOW,
    ...command("command_merge_committed_0001", "a", ADMIN, "administrator"),
  })
  assert.equal(merged.merged_into_gene_id, targetGeneId)
  const targetAssignment = row(
    db,
    "SELECT gene_id, account_id, status, assignment_version FROM icono_caretaker_assignments WHERE caretaker_assignment_id = ?",
    targetAssignmentId,
  )
  assert.equal(targetAssignment.gene_id, targetGeneId)
  assert.equal(targetAssignment.account_id, USER)
  assert.equal(targetAssignment.status, "active")
  assert.equal(targetAssignment.assignment_version, 2)
  const dossier = await readCaretakerGeneDossier(db, {
    geneId: "SRC1",
    actorAccountId: USER,
    audience: "browser",
    cursorSecret: "c".repeat(32),
    includeBodies: false,
  })
  assert.equal(dossier.gene.status, "merged")
  assert.equal(dossier.gene.merged_into_symbol, "TGT1")
  assert.equal(dossier.viewer.can_edit, false)
  const formerLineage = dossier.manifestations.find(
    (item) => item.manifestation_id === sourceSave.manifestation_id,
  )
  assert.equal(formerLineage.author_is_viewer, false)
  assert.equal(formerLineage.can_withdraw, false)
  await assert.rejects(
    withdrawOwnManifestation(db, {
      manifestationId: sourceSave.manifestation_id,
      expectedManifestationVersion: 1,
      expectedHeadVersion: 2,
      expectedCanonicalRevisionId: sourceSave.manifestation_revision_id,
      eventUuid: "event_merge_target_withdraw_refused",
      now: NOW,
      ...command("command_merge_target_withdraw_refused", "b", USER, "account"),
    }),
    { code: "MANIFESTATION_NOT_OWNED", status: 404 },
  )
  const mergeEvent = JSON.parse(
    row(
      db,
      "SELECT payload_json FROM icono_manifestation_events WHERE event_uuid = ?",
      "event_merge_committed_0001",
    ).payload_json,
  )
  assert.equal(mergeEvent.cause, "gene.identity_merged")
  assert.deepEqual(mergeEvent.tombstones, [
    {
      entity_type: "gene_identity",
      entity_id: sourceGeneId,
      state: "merged",
      merged_into_gene_id: targetGeneId,
    },
  ])
})

test("only the author can withdraw a lineage; fallback and restoration are deterministic and events contain no prose or storage secrets", async (t) => {
  const context = await bootstrap(t, "4001")
  const first = await saveFirst(context.db, context, "4001")
  const selectedFirst = await selectSavedRevision(context.db, {
    assignmentId: context.assignmentId,
    geneId: context.geneId,
    revisionId: first.manifestation_revision_id,
    selectionId: "selection_user_4001_01",
    eventUuid: "event_select_4001_01",
    commandId: "command_select_4001_01",
    hashCharacter: "4",
  })
  const manifestationId = first.manifestation_id

  await assert.rejects(
    withdrawOwnManifestation(context.db, {
      manifestationId,
      expectedManifestationVersion: 1,
      expectedHeadVersion: selectedFirst.head_version,
      expectedCanonicalRevisionId: first.manifestation_revision_id,
      eventUuid: "event_bad_withdraw_4001",
      now: NOW,
      ...command("command_bad_withdraw_4001", "5", OTHER),
    }),
    { code: "MANIFESTATION_NOT_OWNED", status: 404 },
  )
  await assert.rejects(
    withdrawOwnManifestation(context.db, {
      manifestationId: context.seedManifestationId,
      expectedManifestationVersion: 1,
      expectedHeadVersion: selectedFirst.head_version,
      expectedCanonicalRevisionId: first.manifestation_revision_id,
      eventUuid: "event_bad_seed_4001",
      now: NOW,
      ...command("command_bad_seed_4001", "6"),
    }),
    { code: "MANIFESTATION_NOT_OWNED", status: 404 },
  )

  const withdrawn = await withdrawOwnManifestation(context.db, {
    manifestationId,
    expectedManifestationVersion: 1,
    expectedHeadVersion: selectedFirst.head_version,
    expectedCanonicalRevisionId: first.manifestation_revision_id,
    selectionId: "selection_fallback_4001",
    eventUuid: "event_withdraw_4001",
    now: NOW,
    ...command("command_withdraw_4001", "7"),
  })
  assert.equal(withdrawn.fallback_revision_id, context.seedRevisionId)
  const payload = JSON.parse(
    row(
      context.db,
      "SELECT payload_json FROM icono_manifestation_events WHERE event_uuid = 'event_withdraw_4001'",
    ).payload_json,
  )
  assert.equal(
    row(
      context.db,
      "SELECT event_type FROM icono_manifestation_events WHERE event_uuid = 'event_withdraw_4001'",
    ).event_type,
    MANIFESTATION_AUTHORITY_EVENT_TYPE,
  )
  assert.deepEqual(Object.keys(payload).sort(), [
    "assignment",
    "canonical",
    "cause",
    "changed_aliases",
    "changed_derivative",
    "changed_revision",
    "changed_selection",
    "derivative_head",
    "gene",
    "manifestation",
    "schema_version",
    "tombstones",
  ])
  assert.equal(payload.gene.aliases[0].alias_symbol, "TP4001")
  assert.deepEqual(payload.changed_selection, {
    canonical_selection_id: "selection_fallback_4001",
    gene_id: context.geneId,
    previous_selection_id: "selection_user_4001_01",
    previous_revision_id: first.manifestation_revision_id,
    selected_manifestation_id: context.seedManifestationId,
    selected_revision_id: context.seedRevisionId,
    actor_account_id: USER,
    caretaker_assignment_id: context.assignmentId,
    reason: "withdrawal_fallback",
    command_id: "command_withdraw_4001",
    head_version: withdrawn.head_version,
    gene_revision: withdrawn.gene_revision,
    created_at: NOW,
  })
  const forbiddenKeys = new Set([
    "body",
    "content",
    "prose",
    "text",
    "object_key",
    "ciphertext_sha256",
    "body_iv_base64",
    "wrapped_dek_base64",
    "wrap_iv_base64",
  ])
  const visit = (value) => {
    if (!value || typeof value !== "object") return
    for (const [key, child] of Object.entries(value)) {
      assert.equal(forbiddenKeys.has(key.toLowerCase()), false, key)
      visit(child)
    }
  }
  visit(payload)

  const restored = await restoreOwnManifestation(context.db, {
    manifestationId,
    revisionId: first.manifestation_revision_id,
    assignmentId: context.assignmentId,
    expectedManifestationVersion: withdrawn.manifestation_row_version,
    expectedAssignmentVersion: 2,
    expectedHeadVersion: withdrawn.head_version,
    expectedCanonicalRevisionId: context.seedRevisionId,
    selectionId: "selection_restore_4001",
    eventUuid: "event_restore_4001",
    now: NOW,
    ...command("command_restore_4001", "8"),
  })
  assert.equal(restored.status, "active")
  assert.deepEqual(
    rows(
      context.db,
      `SELECT lifecycle.status
         FROM icono_manifestation_revision_lifecycle lifecycle
         JOIN icono_manifestation_revisions revision
           ON revision.manifestation_revision_id = lifecycle.manifestation_revision_id
        WHERE revision.manifestation_id = ?`,
      manifestationId,
    ).map((item) => item.status),
    ["active"],
  )
})

test("assignment end atomically freezes the final retain or withdraw policy", async (t) => {
  await t.test("retain", async (t) => {
    const context = await bootstrap(t, "5001", "withdraw")
    const saved = await saveFirst(context.db, context, "5001")
    const selectedSaved = await selectSavedRevision(context.db, {
      assignmentId: context.assignmentId,
      geneId: context.geneId,
      revisionId: saved.manifestation_revision_id,
      selectionId: "selection_user_5001_01",
      eventUuid: "event_select_5001_01",
      commandId: "command_select_5001_01",
      hashCharacter: "4",
    })
    const ended = await endCaretakerAssignment(context.db, {
      assignmentId: context.assignmentId,
      expectedAssignmentVersion: 2,
      expectedManifestationVersion: 0,
      expectedHeadVersion: selectedSaved.head_version,
      expectedCanonicalRevisionId: saved.manifestation_revision_id,
      relinquishPolicy: "retain",
      eventUuid: "event_end_5001",
      now: NOW,
      ...command("command_end_5001", "5"),
    })
    const replayed = await endCaretakerAssignment(context.db, {
      assignmentId: context.assignmentId,
      expectedAssignmentVersion: 2,
      expectedManifestationVersion: 0,
      expectedHeadVersion: selectedSaved.head_version,
      expectedCanonicalRevisionId: saved.manifestation_revision_id,
      relinquishPolicy: "retain",
      eventUuid: "event_end_5001",
      now: NOW,
      ...command("command_end_5001", "5"),
    })
    assert.equal(replayed.replayed, true)
    assert.equal(ended.manifestation_status, "active")
    assert.equal(
      row(
        context.db,
        "SELECT relinquish_policy FROM icono_caretaker_assignments WHERE caretaker_assignment_id = ?",
        context.assignmentId,
      ).relinquish_policy,
      "retain",
    )
    assert.equal(
      row(
        context.db,
        "SELECT canonical_revision_id FROM icono_manifestation_heads WHERE gene_id = ?",
        context.geneId,
      ).canonical_revision_id,
      saved.manifestation_revision_id,
    )
    await assert.rejects(
      context.db
        .prepare(
          "UPDATE icono_caretaker_assignments SET status = 'active' WHERE caretaker_assignment_id = ?",
        )
        .bind(context.assignmentId)
        .run(),
      /ended_caretaker_assignment_is_terminal/,
    )
  })

  await t.test("withdraw", async (t) => {
    const context = await bootstrap(t, "5002", "withdraw")
    const saved = await saveFirst(context.db, context, "5002")
    const selectedSaved = await selectSavedRevision(context.db, {
      assignmentId: context.assignmentId,
      geneId: context.geneId,
      revisionId: saved.manifestation_revision_id,
      selectionId: "selection_user_5002_01",
      eventUuid: "event_select_5002_01",
      commandId: "command_select_5002_01",
      hashCharacter: "4",
    })
    const ended = await endCaretakerAssignment(context.db, {
      assignmentId: context.assignmentId,
      expectedAssignmentVersion: 2,
      expectedHeadVersion: selectedSaved.head_version,
      expectedCanonicalRevisionId: saved.manifestation_revision_id,
      relinquishPolicy: "withdraw",
      selectionId: "selection_end_fallback_5002",
      eventUuid: "event_end_5002",
      now: NOW,
      ...command("command_end_5002", "7"),
    })
    assert.equal(ended.manifestation_status, "withdrawn")
    assert.equal(ended.fallback_revision_id, context.seedRevisionId)
  })
})

test("the schema rejects predictable locators, oversized bodies, invalid JSON, and a canonical withdrawal without fallback", async (t) => {
  const context = await bootstrap(t, "6001")
  await assert.rejects(
    saveManifestationRevision(context.db, {
      assignmentId: context.assignmentId,
      expectedAssignmentVersion: 2,
      expectedManifestationVersion: 0,
      expectedHeadVersion: 1,
      expectedCanonicalRevisionId: context.seedRevisionId,
      storage: {
        ...storage(60),
        object_key: "private/manifestations/v1/aa/revision_user_6001_01.bin",
      },
      manifestationId: "manifestation_user_6001",
      revisionId: "revision_user_6001_01",
      selectionId: "selection_user_6001_01",
      eventUuid: "event_save_6001_01",
      now: NOW,
      ...command("command_save_6001_01", "8"),
    }),
    { code: "PREDICTABLE_OBJECT_KEY" },
  )
  assert.throws(
    () =>
      context.db.raw
        .prepare(
          `INSERT INTO icono_authoring_command_receipts (
             command_id, command_type, actor_kind, request_sha256, response_json
           ) VALUES (?, 'hostile', 'migration', ?, 'not-json')`,
        )
        .run("command_hostile_6001", sha("9")),
    /malformed JSON|json|CHECK constraint failed/i,
  )
  assert.throws(
    () =>
      context.db.raw
        .prepare(
          "UPDATE icono_manifestations SET status = 'withdrawn', withdrawn_at = ? WHERE manifestation_id = ?",
        )
        .run(NOW, context.seedManifestationId),
    /system_seed_cannot_be_withdrawn|canonical_manifestation_must_be_reselected_first/,
  )
  await assert.rejects(
    saveManifestationRevision(context.db, {
      assignmentId: context.assignmentId,
      expectedAssignmentVersion: 2,
      expectedManifestationVersion: 0,
      expectedHeadVersion: 1,
      expectedCanonicalRevisionId: context.seedRevisionId,
      storage: storage(61, 16 * 1024 + 1),
      manifestationId: "manifestation_user_6001",
      revisionId: "revision_user_6001_02",
      selectionId: "selection_user_6001_02",
      eventUuid: "event_save_6001_02",
      now: NOW,
      ...command("command_save_6001_02", "a"),
    }),
    { code: "INVALID_BODY_SIZE" },
  )
  const snapshot = await readManifestationAuthorityGeneState(context.db, context.geneId)
  assert.equal(snapshot.last_event_sequence > 0, true)
  assert.equal(snapshot.canonical.manifestation_revision_id, context.seedRevisionId)
})
