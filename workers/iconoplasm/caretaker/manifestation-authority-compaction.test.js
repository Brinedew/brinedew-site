import assert from "node:assert/strict"
import test from "node:test"

import {
  activateManifestationEventCheckpoint,
  buildManifestationEventCheckpointPage,
  buildManifestationSnapshotPage,
  compactManifestationCommandReceipts,
  completeManifestationSnapshot,
  createManifestationSnapshot,
  endCaretakerAssignment,
  offerCaretakerAssignment,
  pruneManifestationEventPage,
  readManifestationEventPage,
  readManifestationSnapshotPage,
  registerAuthorityAccount,
  registerCaretakerTermsVersion,
  registerGeneIdentity,
  saveManifestationRevision,
  seedSystemManifestation,
  startManifestationEventCheckpoint,
  sweepManifestationCommandTombstones,
  transitionCaretakerAssignment,
} from "./manifestation-authority.js"
import { TestD1, command, row, sha, storage } from "./manifestation-authority-test-support.js"

const ADMIN = "account_admin_compaction"
const USER = "account_user_compaction"
const GENE = "gene_compaction_0001"
const ASSIGNMENT = "assignment_compaction_0001"
const TERMS = "terms_compaction_0001"
const CURSOR_SECRET = "manifestation-event-cursor-secret-for-tests-0001"

async function bootstrap(t) {
  const db = new TestD1()
  t.after(() => db.close())
  await registerAuthorityAccount(db, { accountId: ADMIN, publicCreditLabel: "Administrator" })
  await registerAuthorityAccount(db, { accountId: USER, publicCreditLabel: "Caretaker" })
  await registerCaretakerTermsVersion(db, {
    termsVersionId: TERMS,
    termsSha256: sha("a"),
    documentUrl: "https://iconoplasm.brinedew.bio/caretaker-terms",
    displayLabel: "Caretaker terms",
    effectiveAt: "2026-08-01T00:00:00.000Z",
    createdByAccountId: ADMIN,
  })
  await registerGeneIdentity(db, { geneId: GENE, canonicalSymbol: "CMP1" })
  await seedSystemManifestation(db, {
    geneId: GENE,
    storage: storage(1),
    expectedHeadVersion: 0,
    expectedCanonicalRevisionId: null,
    manifestationId: "manifestation_compaction_seed",
    revisionId: "revision_compaction_seed",
    selectionId: "selection_compaction_seed",
    eventUuid: "event_compaction_seed",
    ...command("command_compaction_seed", "1", null, "migration"),
  })
  await offerCaretakerAssignment(db, {
    geneId: GENE,
    accountId: USER,
    invitedByAccountId: ADMIN,
    entitlementPolicyVersion: "entitlement-v1",
    expectedGeneRevision: 1,
    assignmentId: ASSIGNMENT,
    eventUuid: "event_compaction_offer",
    ...command("command_compaction_offer", "2", ADMIN, "administrator"),
  })
  await transitionCaretakerAssignment(db, {
    assignmentId: ASSIGNMENT,
    action: "accept",
    expectedAssignmentVersion: 1,
    termsVersionId: TERMS,
    relinquishPolicy: "retain",
    eventUuid: "event_compaction_accept",
    ...command("command_compaction_accept", "3", USER, "account"),
  })
  return db
}

function decodePart(part) {
  return JSON.parse(Buffer.from(part.payload_base64url, "base64url").toString("utf8"))
}

test("verified normalized checkpoint prunes a long prefix and bootstraps a fresh replica", async (t) => {
  const db = await bootstrap(t)
  let manifestationVersion = 0
  let headVersion = 1
  let canonicalRevisionId = "revision_compaction_seed"
  let firstInput
  let firstResult
  for (let index = 1; index <= 28; index += 1) {
    const suffix = String(index).padStart(2, "0")
    const input = {
      assignmentId: ASSIGNMENT,
      expectedAssignmentVersion: 2,
      expectedManifestationVersion: manifestationVersion,
      expectedHeadVersion: headVersion,
      expectedCanonicalRevisionId: canonicalRevisionId,
      storage: storage(100 + index),
      manifestationId: index === 1 ? "manifestation_compaction_user" : undefined,
      revisionId: `revision_compaction_${suffix}`,
      selectionId: `selection_compaction_${suffix}`,
      eventUuid: `event_compaction_${suffix}`,
      ...command(`command_compaction_${suffix}`, String((index % 8) + 1), USER, "account"),
    }
    const result = await saveManifestationRevision(db, input)
    if (index === 1) {
      firstInput = input
      firstResult = result
    }
    manifestationVersion = result.manifestation_row_version
    headVersion = result.head_version
    canonicalRevisionId = result.manifestation_revision_id
  }
  db.raw.prepare("UPDATE icono_manifestation_events SET projection_status = 'not_required'").run()
  const eventCount = row(db, "SELECT count(*) AS total FROM icono_manifestation_events").total
  assert.equal(eventCount > 20, true)

  const started = await startManifestationEventCheckpoint(db, {
    checkpointId: "checkpoint_compaction_0001",
    watermarkSequence: eventCount,
    auditRetentionSeconds: 3_600,
    now: "2026-09-30T00:00:00.000Z",
  })
  assert.equal(started.status, "building")
  await buildManifestationEventCheckpointPage(db, {
    checkpointId: started.checkpoint_id,
    limit: 2,
    now: "2026-09-30T00:00:01.000Z",
  })
  const resumed = await startManifestationEventCheckpoint(db, {
    checkpointId: "checkpoint_should_not_replace_active_build",
    watermarkSequence: eventCount,
    auditRetentionSeconds: 3_600,
    now: "2026-09-30T00:00:02.000Z",
  })
  assert.equal(resumed.checkpoint_id, started.checkpoint_id)
  assert.equal(resumed.resumed, true)

  let checkpoint = resumed
  for (let page = 0; page < 500 && checkpoint.status === "building"; page += 1) {
    checkpoint = await buildManifestationEventCheckpointPage(db, {
      checkpointId: started.checkpoint_id,
      limit: 3,
      now: "2026-09-30T00:01:00.000Z",
    })
  }
  assert.equal(checkpoint.status, "verified")
  assert.equal(checkpoint.total_entities > 30, true)
  assert.match(checkpoint.manifest_sha256, /^[a-f0-9]{64}$/)

  const activated = await activateManifestationEventCheckpoint(db, {
    checkpointId: started.checkpoint_id,
    totalEntities: checkpoint.total_entities,
    manifestSha256: checkpoint.manifest_sha256,
    now: "2026-09-30T00:02:00.000Z",
  })
  assert.equal(activated.status, "active")
  assert.equal(
    row(db, "SELECT event_retention_floor FROM icono_authority_state WHERE singleton = 1")
      .event_retention_floor,
    eventCount,
  )

  let pruned = 0
  for (let page = 0; page < 20; page += 1) {
    const result = await pruneManifestationEventPage(db, {
      checkpointId: started.checkpoint_id,
      limit: 7,
      now: "2026-09-30T00:03:00.000Z",
    })
    pruned += result.pruned
    if (result.complete) break
  }
  assert.equal(pruned, eventCount)
  assert.equal(row(db, "SELECT count(*) AS total FROM icono_manifestation_events").total, 0)
  await assert.rejects(
    readManifestationEventPage(db, { cursorSecret: CURSOR_SECRET, cursor: null }),
    { code: "EVENT_CURSOR_EXPIRED_SNAPSHOT_REQUIRED", status: 410 },
  )

  const replay = await saveManifestationRevision(db, firstInput)
  assert.deepEqual(replay, { ...firstResult, replayed: true })
  assert.equal(replay.event_id, firstInput.eventUuid)

  const tail = await saveManifestationRevision(db, {
    assignmentId: ASSIGNMENT,
    expectedAssignmentVersion: 2,
    expectedManifestationVersion: manifestationVersion,
    expectedHeadVersion: headVersion,
    expectedCanonicalRevisionId: canonicalRevisionId,
    storage: storage(200),
    revisionId: "revision_compaction_tail",
    selectionId: "selection_compaction_tail",
    eventUuid: "event_compaction_tail",
    ...command("command_compaction_tail", "f", USER, "account"),
  })
  assert.equal(tail.accepted_event_sequence, eventCount + 1)

  const snapshot = await createManifestationSnapshot(db, {
    consumerId: "replica_compaction_fresh",
    snapshotId: "snapshot_compaction_fresh",
    cursorSecret: CURSOR_SECRET,
    now: "2026-09-30T00:04:00.000Z",
  })
  let build = snapshot
  for (let page = 0; page < 500 && build.status !== "ready"; page += 1) {
    build = await buildManifestationSnapshotPage(db, {
      snapshotId: snapshot.snapshot_id,
      limit: 4,
      now: "2026-09-30T00:04:01.000Z",
    })
  }
  assert.equal(build.status, "ready")
  const parts = []
  let partsCursor = null
  let resumeCursor = null
  do {
    const page = await readManifestationSnapshotPage(db, {
      snapshotId: snapshot.snapshot_id,
      cursorSecret: CURSOR_SECRET,
      cursor: partsCursor,
      limit: 5,
      now: "2026-09-30T00:04:02.000Z",
    })
    parts.push(...page.parts.map(decodePart))
    partsCursor = page.has_more ? page.parts_resume_cursor : null
    resumeCursor = page.resume_cursor
  } while (partsCursor)
  assert.equal(
    parts.filter((part) => part.part_kind === "authority_checkpoint_entity").length,
    checkpoint.total_entities,
  )
  assert.equal(parts.filter((part) => part.part_kind === "authority_event").length, 1)
  assert.equal(
    parts.some((part) => part.entity?.entity_kind === "canonical_selection"),
    true,
  )
  assert.equal(
    parts.some((part) => part.entity?.entity_kind === "revision"),
    true,
  )

  await completeManifestationSnapshot(db, {
    snapshotId: snapshot.snapshot_id,
    totalParts: build.total_parts,
    manifestSha256: build.manifest_sha256,
    cursorSecret: CURSOR_SECRET,
    now: "2026-09-30T00:04:03.000Z",
  })
  const tailPage = await readManifestationEventPage(db, {
    cursorSecret: CURSOR_SECRET,
    cursor: resumeCursor,
  })
  assert.deepEqual(tailPage.events, [])
})

test("checkpoint activation refuses lagging active consumers", async (t) => {
  const db = await bootstrap(t)
  db.raw.prepare("UPDATE icono_manifestation_events SET projection_status = 'not_required'").run()
  const target = row(
    db,
    "SELECT max(event_sequence) AS value FROM icono_manifestation_events",
  ).value
  db.raw
    .prepare(
      `INSERT INTO icono_manifestation_consumer_cursors (
       consumer_id, last_event_sequence, updated_at
     ) VALUES ('lagging_replica', 0, '2026-09-30T00:00:00.000Z')`,
    )
    .run()
  const started = await startManifestationEventCheckpoint(db, {
    checkpointId: "checkpoint_compaction_lagging",
    watermarkSequence: target,
    auditRetentionSeconds: 3_600,
    now: "2026-09-30T00:00:00.000Z",
  })
  let checkpoint = started
  for (let page = 0; page < 100 && checkpoint.status === "building"; page += 1) {
    checkpoint = await buildManifestationEventCheckpointPage(db, {
      checkpointId: started.checkpoint_id,
      limit: 10,
      now: "2026-09-30T00:01:00.000Z",
    })
  }
  await assert.rejects(
    activateManifestationEventCheckpoint(db, {
      checkpointId: started.checkpoint_id,
      totalEntities: checkpoint.total_entities,
      manifestSha256: checkpoint.manifest_sha256,
      now: "2026-09-30T00:02:00.000Z",
    }),
    { code: "EVENT_COMPACTION_CONSUMER_LAGGING" },
  )
})

test("receipt compaction preserves replay fences after the source event is pruned", async (t) => {
  const db = await bootstrap(t)
  const saved = await saveManifestationRevision(db, {
    assignmentId: ASSIGNMENT,
    expectedAssignmentVersion: 2,
    expectedManifestationVersion: 0,
    expectedHeadVersion: 1,
    expectedCanonicalRevisionId: "revision_compaction_seed",
    storage: storage(300),
    manifestationId: "manifestation_compaction_retained",
    revisionId: "revision_compaction_retained",
    selectionId: "selection_compaction_retained",
    eventUuid: "event_compaction_retained",
    now: "2026-01-01T00:00:00.000Z",
    ...command("command_compaction_retained", "8", USER, "account"),
  })
  const endInput = {
    assignmentId: ASSIGNMENT,
    expectedAssignmentVersion: 2,
    expectedHeadVersion: saved.head_version,
    expectedCanonicalRevisionId: "revision_compaction_seed",
    relinquishPolicy: "retain",
    eventUuid: "event_compaction_end_retain",
    now: "2026-01-01T00:01:00.000Z",
    ...command("command_compaction_end_retain", "9", USER, "account"),
  }
  await endCaretakerAssignment(db, endInput)
  db.raw.prepare("UPDATE icono_manifestation_events SET projection_status = 'not_required'").run()
  db.raw
    .prepare("UPDATE icono_authoring_command_receipts SET created_at = '2026-01-01T00:00:00.000Z'")
    .run()
  const watermark = row(
    db,
    "SELECT max(event_sequence) AS value FROM icono_manifestation_events",
  ).value
  let checkpoint = await startManifestationEventCheckpoint(db, {
    checkpointId: "checkpoint_command_receipts",
    watermarkSequence: watermark,
    auditRetentionSeconds: 3_600,
    now: "2026-09-30T00:00:00.000Z",
  })
  for (let page = 0; page < 100 && checkpoint.status === "building"; page += 1) {
    checkpoint = await buildManifestationEventCheckpointPage(db, {
      checkpointId: checkpoint.checkpoint_id,
      limit: 10,
      now: "2026-09-30T00:01:00.000Z",
    })
  }
  await activateManifestationEventCheckpoint(db, {
    checkpointId: checkpoint.checkpoint_id,
    totalEntities: checkpoint.total_entities,
    manifestSha256: checkpoint.manifest_sha256,
    now: "2026-09-30T00:02:00.000Z",
  })

  assert.equal(
    (
      await compactManifestationCommandReceipts(db, {
        now: "2026-09-30T00:03:00.000Z",
        retentionDays: 90,
        limit: 50,
      })
    ).compacted,
    0,
  )
  while (
    (
      await pruneManifestationEventPage(db, {
        checkpointId: checkpoint.checkpoint_id,
        limit: 10,
        now: "2026-09-30T00:04:00.000Z",
      })
    ).complete === false
  ) {}

  const compacted = await compactManifestationCommandReceipts(db, {
    now: "2026-09-30T00:05:00.000Z",
    retentionDays: 90,
    limit: 50,
  })
  assert.equal(compacted.compacted > 0, true)
  const commandTombstone = row(
    db,
    `SELECT request_sha256, response_sha256, accepted_event_uuid,
              accepted_event_sequence, accepted_gene_revision
         FROM icono_authoring_command_tombstones WHERE command_id = ?`,
    endInput.commandId,
  )
  assert.deepEqual(
    { ...commandTombstone },
    {
      request_sha256: endInput.requestSha256,
      response_sha256: commandTombstone.response_sha256,
      accepted_event_uuid: endInput.eventUuid,
      accepted_event_sequence: watermark,
      accepted_gene_revision: row(
        db,
        "SELECT gene_revision FROM icono_manifestation_heads WHERE gene_id = ?",
        GENE,
      ).gene_revision,
    },
  )
  assert.match(commandTombstone.response_sha256, /^[a-f0-9]{64}$/)
  await assert.rejects(endCaretakerAssignment(db, endInput), {
    code: "IDEMPOTENCY_RECEIPT_EXPIRED",
  })
  await assert.rejects(
    endCaretakerAssignment(db, {
      ...endInput,
      relinquishPolicy: "withdraw",
      requestSha256: sha("a"),
    }),
    { code: "IDEMPOTENCY_KEY_REUSED" },
  )
  assert.equal(
    row(
      db,
      "SELECT relinquish_policy FROM icono_caretaker_assignments WHERE caretaker_assignment_id = ?",
      ASSIGNMENT,
    ).relinquish_policy,
    "retain",
  )

  assert.equal(
    (
      await sweepManifestationCommandTombstones(db, {
        now: "2026-10-01T00:00:00.000Z",
        retentionDays: 365,
        limit: 50,
      })
    ).purged,
    0,
  )
  db.raw
    .prepare(
      "UPDATE icono_authoring_command_tombstones SET compacted_at = '2025-01-01T00:00:00.000Z'",
    )
    .run()
  assert.equal(
    (
      await sweepManifestationCommandTombstones(db, {
        now: "2026-10-01T00:00:00.000Z",
        retentionDays: 365,
        limit: 50,
      })
    ).purged > 0,
    true,
  )
  await assert.rejects(
    endCaretakerAssignment(db, {
      ...endInput,
      relinquishPolicy: "withdraw",
    }),
    { code: "ASSIGNMENT_ALREADY_ENDED" },
  )
  assert.equal(
    row(
      db,
      "SELECT relinquish_policy FROM icono_caretaker_assignments WHERE caretaker_assignment_id = ?",
      ASSIGNMENT,
    ).relinquish_policy,
    "retain",
  )
})
