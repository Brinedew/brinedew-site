import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"
import { TestD1, command, row, sha, storage } from "./manifestation-authority-test-support.js"
import {
  offerCaretakerAssignment,
  readCanonicalProjectionRecord,
  registerAuthorityAccount,
  registerGeneIdentity,
  seedSystemManifestation,
} from "./manifestation-authority.js"
import {
  createManifestationSnapshot,
  readManifestationEventPage,
  readManifestationSnapshotPage,
  completeManifestationSnapshot,
} from "./manifestation-authority-sync.js"

const cursorSecret = "streamed-snapshot-hostile-tests-secret-00000001"
const now = "2030-01-01T00:00:00.000Z"

test("large bootstrap streams immutable bounded pages with zero copied rows and no GET writes", async (t) => {
  const db = new TestD1()
  t.after(() => db.close())
  for (let i = 0; i < 260; i++)
    await registerGeneIdentity(db, { geneId: `gene_stream_${i}`, canonicalSymbol: `G${i}` })
  const lease = await createManifestationSnapshot(db, {
    consumerId: "stream_reader",
    cursorSecret,
    now,
  })
  await registerGeneIdentity(db, { geneId: "gene_after_snapshot", canonicalSymbol: "LATE" })
  assert.throws(
    () => db.raw.prepare("UPDATE icono_gene_identity_baselines SET rowid=rowid+1000").run(),
    /gene_baseline_is_immutable/,
  )
  assert.throws(
    () => db.raw.prepare("DELETE FROM icono_gene_identity_baselines").run(),
    /gene_baseline_is_immutable/,
  )
  const input = { snapshotId: lease.snapshot_id, cursorSecret, now, limit: 250 }
  const before = row(db, "SELECT total_changes() AS writes").writes
  const first = await readManifestationSnapshotPage(db, input)
  assert.equal(first.parts.length, 250)
  assert.equal(first.has_more, true)
  assert.deepEqual(await readManifestationSnapshotPage(db, input), first)
  const last = await readManifestationSnapshotPage(db, {
    ...input,
    cursor: first.parts_resume_cursor,
  })
  assert.equal(last.parts.length, 10)
  assert.equal(last.has_more, false)
  assert.equal(last.total_parts, 260)
  assert.equal(row(db, "SELECT total_changes() AS writes").writes, before)
  assert.equal(
    row(
      db,
      "SELECT count(*) AS n FROM sqlite_schema WHERE name='icono_manifestation_snapshot_parts'",
    ).n,
    0,
  )
  const all = [...first.parts, ...last.parts]
  assert.equal(
    all.some((p) => p.gene_id === "gene_after_snapshot"),
    false,
  )
  let chain = "0".repeat(64)
  for (const part of all)
    chain = createHash("sha256")
      .update(`${chain}\n${part.ordinal}\n${part.payload_sha256}`)
      .digest("hex")
  assert.equal(last.manifest_sha256, chain)
  await assert.rejects(
    completeManifestationSnapshot(db, {
      ...input,
      totalParts: first.total_parts,
      manifestSha256: first.manifest_sha256,
      completionCursor: first.parts_resume_cursor,
    }),
    /Complete signed stream proof/,
  )
  await assert.rejects(
    completeManifestationSnapshot(db, {
      ...input,
      totalParts: last.total_parts,
      manifestSha256: "f".repeat(64),
      completionCursor: last.parts_resume_cursor,
    }),
    /Complete signed stream proof/,
  )
  const completion = {
    ...input,
    totalParts: last.total_parts,
    manifestSha256: chain,
    completionCursor: last.parts_resume_cursor,
  }
  const receipt = await completeManifestationSnapshot(db, completion)
  assert.equal(receipt.status, "completed")
  assert.deepEqual(await completeManifestationSnapshot(db, completion), receipt)
})

// Event checkpoints were the only way to back a raised retention floor, and
// they were retired (B-869). A raised floor must refuse, not stream a history
// whose prefix is gone.
test("a raised retention floor refuses a snapshot instead of streaming partial history", async (t) => {
  const db = new TestD1()
  t.after(() => db.close())
  await registerGeneIdentity(db, { geneId: "gene_floor_one", canonicalSymbol: "FLOOR" })
  db.raw.exec("UPDATE icono_authority_state SET event_retention_floor = 1 WHERE singleton = 1")
  await assert.rejects(
    createManifestationSnapshot(db, { consumerId: "floor_reader", cursorSecret, now }),
    { code: "SNAPSHOT_SOURCE_HISTORY_UNAVAILABLE" },
  )
  assert.equal(
    db.raw.prepare("SELECT COUNT(*) AS n FROM icono_manifestation_snapshot_leases").get().n,
    0,
    "a refused snapshot leaves no lease behind",
  )
})

test("foreign, expired and changed-epoch streams fail closed", async (t) => {
  const db = new TestD1()
  t.after(() => db.close())
  await registerGeneIdentity(db, { geneId: "gene_stream_one", canonicalSymbol: "ONE" })
  const a = await createManifestationSnapshot(db, { consumerId: "reader_one", cursorSecret, now })
  const b = await createManifestationSnapshot(db, { consumerId: "reader_two", cursorSecret, now })
  const page = await readManifestationSnapshotPage(db, {
    snapshotId: a.snapshot_id,
    cursorSecret,
    now,
  })
  await assert.rejects(
    readManifestationSnapshotPage(db, {
      snapshotId: b.snapshot_id,
      cursorSecret,
      now,
      cursor: page.parts_resume_cursor,
    }),
    /another snapshot/,
  )
  await assert.rejects(
    readManifestationSnapshotPage(db, {
      snapshotId: a.snapshot_id,
      cursorSecret,
      now: "2030-01-02T00:00:00.000Z",
    }),
    /no longer available/,
  )
  db.raw.exec("UPDATE icono_authority_state SET authority_epoch=2 WHERE singleton=1")
  assert.throws(
    () =>
      db.raw
        .prepare(
          `INSERT INTO icono_manifestation_snapshot_leases
    (snapshot_id, consumer_id, authority_epoch, watermark_event_sequence,
     source_checkpoint_watermark_sequence, status, expires_at, created_at, stream_version)
    VALUES ('stale_snapshot_insert', 'stale_snapshot_reader', 1, 0, 0,
      'building', '2030-01-01T01:00:00.000Z', '2030-01-01T00:00:00.000Z', 2)`,
        )
        .run(),
    /snapshot_source_changed/,
  )
  await assert.rejects(
    readManifestationSnapshotPage(db, { snapshotId: a.snapshot_id, cursorSecret, now }),
    /no longer available/,
  )
  const replacement = await createManifestationSnapshot(db, {
    consumerId: "reader_one",
    cursorSecret,
    now,
  })
  assert.notEqual(replacement.snapshot_id, a.snapshot_id)
  assert.equal(replacement.authority_epoch, 2)
})

test("a sealed event archive preserves the exact replica stream while the writer retains current heads", async (t) => {
  const db = new TestD1()
  const archiveDb = new TestD1()
  t.after(() => db.close())
  t.after(() => archiveDb.close())
  for (const target of [db, archiveDb]) {
    await registerAuthorityAccount(target, {
      accountId: "archive_admin",
      publicCreditLabel: "Archive administrator",
    })
    await registerAuthorityAccount(target, {
      accountId: "archive_caretaker",
      publicCreditLabel: "Archive caretaker",
    })
    await registerGeneIdentity(target, { geneId: "archive_gene_one", canonicalSymbol: "ARC1" })
    await seedSystemManifestation(target, {
      geneId: "archive_gene_one",
      storage: storage(201),
      expectedHeadVersion: 0,
      expectedCanonicalRevisionId: null,
      manifestationId: "archive_manifestation_one",
      revisionId: "archive_revision_one",
      selectionId: "archive_selection_one",
      eventUuid: "archive_event_one",
      ...command("archive_command_one", "1", null, "migration"),
    })
    await offerCaretakerAssignment(target, {
      geneId: "archive_gene_one",
      accountId: "archive_caretaker",
      invitedByAccountId: "archive_admin",
      entitlementPolicyVersion: "entitlement-v1",
      expectedGeneRevision: 1,
      assignmentId: "archive_assignment_one",
      eventUuid: "archive_event_two",
      ...command("archive_command_two", "2", "archive_admin", "administrator"),
    })
  }
  const archiveHash = sha("a")
  archiveDb.raw.exec(
    `CREATE TABLE icono_event_archive_manifest (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      authority_epoch INTEGER NOT NULL,
      through_sequence INTEGER NOT NULL,
      event_count INTEGER NOT NULL,
      source_sha256 TEXT NOT NULL
    )`,
  )
  archiveDb.raw
    .prepare("INSERT INTO icono_event_archive_manifest VALUES (1, 1, 2, 2, ?)")
    .run(archiveHash)
  db.raw
    .prepare(
      "UPDATE icono_authority_state SET event_archive_through=2, event_archive_sha256=? WHERE singleton=1",
    )
    .run(archiveHash)
  db.raw.prepare("UPDATE icono_manifestation_events SET projection_status='published'").run()
  db.raw.prepare("DELETE FROM icono_manifestation_events WHERE event_sequence=1").run()
  assert.throws(
    () => db.raw.prepare("DELETE FROM icono_manifestation_events WHERE event_sequence=2").run(),
    /manifestation_events_are_immutable/,
  )
  await registerGeneIdentity(db, { geneId: "archive_gene_two", canonicalSymbol: "ARC2" })
  await seedSystemManifestation(db, {
    geneId: "archive_gene_two",
    storage: storage(202),
    expectedHeadVersion: 0,
    expectedCanonicalRevisionId: null,
    manifestationId: "archive_manifestation_two",
    revisionId: "archive_revision_two",
    selectionId: "archive_selection_two",
    eventUuid: "archive_event_three",
    ...command("archive_command_three", "3", null, "migration"),
  })
  const projection = await readCanonicalProjectionRecord(db, "archive_gene_one")
  assert.equal(projection.last_event_id, "archive_event_two")

  await assert.rejects(readManifestationEventPage(db, { cursorSecret, limit: 1 }), /archive/i)
  const eventIds = []
  let cursor = null
  for (let pageNumber = 0; pageNumber < 4; pageNumber += 1) {
    const page = await readManifestationEventPage(db, {
      archiveDb,
      cursorSecret,
      cursor,
      limit: 1,
    })
    eventIds.push(...page.events.map((event) => event.event_id))
    cursor = page.resume_cursor
    if (!page.has_more) break
  }
  assert.deepEqual(eventIds, ["archive_event_one", "archive_event_two", "archive_event_three"])

  const snapshot = await createManifestationSnapshot(db, {
    archiveDb,
    consumerId: "archive_replica",
    cursorSecret,
    now,
  })
  const parts = []
  let partsCursor = null
  for (let pageNumber = 0; pageNumber < 5; pageNumber += 1) {
    const page = await readManifestationSnapshotPage(db, {
      archiveDb,
      snapshotId: snapshot.snapshot_id,
      cursorSecret,
      cursor: partsCursor,
      now,
      limit: 2,
    })
    parts.push(...page.parts)
    partsCursor = page.parts_resume_cursor
    if (!page.has_more) break
  }
  assert.deepEqual(
    parts.map((part) => part.source_key),
    ["archive_gene_one", "archive_gene_two", "1", "2", "3"],
  )
  let chain = "0".repeat(64)
  for (const part of parts)
    chain = createHash("sha256")
      .update(`${chain}\n${part.ordinal}\n${part.payload_sha256}`)
      .digest("hex")
  const last = await readManifestationSnapshotPage(db, {
    archiveDb,
    snapshotId: snapshot.snapshot_id,
    cursorSecret,
    cursor: partsCursor,
    now,
    limit: 2,
  })
  assert.equal(last.manifest_sha256, chain)
  archiveDb.raw.prepare("UPDATE icono_event_archive_manifest SET source_sha256=?").run(sha("b"))
  await assert.rejects(
    readManifestationEventPage(db, { archiveDb, cursorSecret, limit: 1 }),
    /does not match authority/,
  )
})
