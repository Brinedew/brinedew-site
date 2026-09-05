import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"
import { TestD1, row } from "./manifestation-authority-test-support.js"
import { registerGeneIdentity } from "./manifestation-authority.js"
import {
  createManifestationSnapshot,
  readManifestationSnapshotPage,
  completeManifestationSnapshot,
  sweepManifestationSnapshots,
} from "./manifestation-authority-sync.js"

const cursorSecret = "streamed-snapshot-hostile-tests-secret-00000001"
const now = "2030-01-01T00:00:00.000Z"

test("legacy cleanup deletes at most 250 copied parts and retains unfinished leases", async (t) => {
  const db = new TestD1()
  t.after(() => db.close())
  await registerGeneIdentity(db, { geneId: "gene_cleanup", canonicalSymbol: "CLEAN" })
  const lease = await createManifestationSnapshot(db, {
    consumerId: "cleanup_reader",
    cursorSecret,
    now,
  })
  const insert = db.raw.prepare(`INSERT INTO icono_manifestation_snapshot_parts
    (snapshot_id,ordinal,part_kind,source_key,gene_id,part_json,payload_sha256)
    VALUES (?,?,'authority_event',?,'gene_cleanup','{}',?)`)
  for (let i = 1; i <= 260; i++) insert.run(lease.snapshot_id, i, String(i), "a".repeat(64))
  const options = { now: "2030-01-03T00:00:00.000Z" }
  assert.deepEqual(await sweepManifestationSnapshots(db, options), { purged: 0, parts_purged: 250 })
  assert.equal(row(db, "SELECT count(*) AS n FROM icono_manifestation_snapshot_parts").n, 10)
  assert.deepEqual(await sweepManifestationSnapshots(db, options), { purged: 1, parts_purged: 10 })
})

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
  assert.equal(row(db, "SELECT count(*) AS n FROM icono_manifestation_snapshot_parts").n, 0)
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
