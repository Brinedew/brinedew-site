import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
  registerAuthorityAccount,
  registerGeneIdentity,
  registerCaretakerTermsVersion,
  seedSystemManifestation,
  offerCaretakerAssignment,
  transitionCaretakerAssignment,
  saveManifestationRevision,
  submitTagsDerivative,
  createManifestationUploadIntent,
  admitManifestationUploadIntent,
  releaseAbandonedManifestationUploads,
} from "./manifestation-authority.js"
import { TestD1, command, sha, storage } from "./manifestation-authority-test-support.js"
import {
  ICONOPLASM_BACKGROUND_MINUTES,
  ICONOPLASM_RECURRING_CRON,
} from "../../iconoplasm-background-schedule.js"
import runtime from "../../the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"

const migration = readFileSync(
  new URL(
    "../../../migrations-iconoplasm-authoring/0014_bounded_lineage_upload_admission.sql",
    import.meta.url,
  ),
  "utf8",
)
// B-1018: the same caps over the last 30 days instead of a lifetime.
const windowMigration = readFileSync(
  new URL(
    "../../../migrations-iconoplasm-authoring/0022_lineage_quota_window_and_unread_indexes.sql",
    import.meta.url,
  ),
  "utf8",
)
const admin = "account_quota_admin",
  account = "account_quota_user",
  gene = "gene_quota_test",
  assignment = "assignment_quota_test"
async function fixture(t, { revisions = 0, bodyBytes = 1, historyAt } = {}) {
  const db = new TestD1()
  t.after(() => db.close())
  await registerAuthorityAccount(db, { accountId: admin })
  await registerAuthorityAccount(db, { accountId: account })
  await registerGeneIdentity(db, { geneId: gene, canonicalSymbol: "QUOTATEST" })
  await registerCaretakerTermsVersion(db, {
    termsVersionId: "terms_quota_test",
    termsSha256: sha("f"),
    documentUrl: "https://example.test/terms",
    displayLabel: "Terms",
    createdByAccountId: admin,
  })
  await seedSystemManifestation(db, {
    geneId: gene,
    storage: storage(1),
    expectedHeadVersion: 0,
    expectedCanonicalRevisionId: null,
    manifestationId: "manifestation_quota_seed",
    revisionId: "revision_quota_seed",
    selectionId: "selection_quota_seed",
    ...command("command_quota_seed", "a", null, "migration"),
  })
  await offerCaretakerAssignment(db, {
    geneId: gene,
    accountId: account,
    invitedByAccountId: admin,
    entitlementPolicyVersion: "entitlement-v1",
    expectedGeneRevision: 1,
    assignmentId: assignment,
    ...command("command_quota_offer", "b", admin, "administrator"),
  })
  await transitionCaretakerAssignment(db, {
    assignmentId: assignment,
    action: "accept",
    expectedAssignmentVersion: 1,
    termsVersionId: "terms_quota_test",
    relinquishPolicy: "retain",
    ...command("command_quota_accept", "c", account, "account"),
  })
  // Build genuine pre-migration history through the domain commands. This
  // deliberately exercises upgrade data that predates strict upload guards.
  for (let i = 0; i < revisions; i++)
    await saveManifestationRevision(db, {
      assignmentId: assignment,
      expectedAssignmentVersion: 2,
      expectedManifestationVersion: i,
      storage: storage(i + 10, bodyBytes),
      manifestationId: "manifestation_quota_user",
      revisionId: `revision_quota_${i}`,
      ...(historyAt ? { now: historyAt } : {}),
      ...command(`command_quota_save_${i}`, "d", account, "account"),
    })
  let serial = 10000
  return {
    db,
    migrate: () => db.raw.exec(migration),
    migrateWindow: () => db.raw.exec(windowMigration),
    async reserve(kind, bytes = 1, overrides = {}) {
      const n = serial++,
        envelope = storage(n, bytes)
      return createManifestationUploadIntent(db, {
        entityKind: kind,
        entityId: `${kind}_quota_${n}`,
        assignmentId: assignment,
        objectKey: envelope.object_key,
        ciphertextSha256: envelope.ciphertext_sha256,
        bodyBytes: bytes,
        actorKind: "account",
        actorAccountId: account,
        uploadIntentId: `intent_quota_${n}`,
        leaseToken: `lease_quota_${n}`,
        ...overrides,
      })
    },
  }
}

test("indexed admission counts concurrent live reservations at the existing lineage limits", async (t) => {
  const f = await fixture(t)
  for (let n = 0; n < 256; n++) await f.reserve("revision")
  await assert.rejects(f.reserve("revision"), { code: "LINEAGE_REVISION_LIMIT_EXCEEDED" })
  for (let n = 0; n < 512; n++) await f.reserve("derivative")
  f.migrate()
  await assert.rejects(f.reserve("derivative"), { code: "LINEAGE_DERIVATIVE_LIMIT_EXCEEDED" })
  assert.equal(
    f.db.raw.prepare("SELECT COUNT(*) AS n FROM icono_manifestation_upload_intents").get().n,
    768,
  )
})

test("all quota aggregates traverse indexed capped inputs", async (t) => {
  const f = await fixture(t, { revisions: 1 })
  f.migrate()
  const query = migration
    .slice(migration.indexOf("  SELECT CASE\n    WHEN revisions"), migration.lastIndexOf("END;"))
    .replaceAll("NEW.caretaker_assignment_id", "?1")
    .replaceAll("NEW.entity_kind", "?2")
    .replaceAll("NEW.planned_body_bytes", "?3")
    .replace(/RAISE\(ABORT, '[^']+'\)/g, "0")
  const plans = f.db.raw.prepare(`EXPLAIN QUERY PLAN ${query}`).all(assignment, "derivative", 1)
  assert.ok(
    plans.every(
      ({ detail }) =>
        !/SCAN (icono_manifestation_revisions|icono_manifestation_derivatives|icono_manifestation_upload_intents|derivative)\b/.test(
          detail,
        ),
    ),
    JSON.stringify(plans),
  )
  for (const index of [
    "idx_icono_revisions_caretaker_quota",
    "idx_icono_derivatives_revision",
    "idx_icono_upload_intents_caretaker_quota",
  ])
    assert.ok(
      plans.some(({ detail }) => detail.includes(index)),
      index,
    )
})

test("the byte quota includes history and reservations, and terminal release restores capacity", async (t) => {
  const f = await fixture(t, { revisions: 127, bodyBytes: 16384 })
  f.migrate()
  const reserved = await f.reserve("revision", 16384)
  await assert.rejects(f.reserve("derivative"), { code: "LINEAGE_BODY_QUOTA_EXCEEDED" })
  f.db.raw
    .prepare(
      "UPDATE icono_manifestation_upload_intents SET status='deleted', resolved_at=CURRENT_TIMESTAMP WHERE upload_intent_id=?",
    )
    .run(reserved.upload_intent_id)
  await f.reserve("derivative", 16384)
  await assert.rejects(f.reserve("revision"), { code: "LINEAGE_BODY_QUOTA_EXCEEDED" })
})

test("oversized historical revision counts cannot pass through a capped byte sum", async (t) => {
  const f = await fixture(t, { revisions: 260 })
  f.migrate()
  await assert.rejects(f.reserve("derivative"), { code: "LINEAGE_REVISION_LIMIT_EXCEEDED" })
})

test("failed derivative history counts toward the derivative limit without scanning past its cap", async (t) => {
  const f = await fixture(t, { revisions: 1 })
  for (let n = 0; n < 520; n++)
    await submitTagsDerivative(f.db, {
      revisionId: "revision_quota_0",
      derivativeId: `derivative_history_${n}`,
      status: "failed",
      sourceBodySha256: storage(10).body_sha256,
      failureCode: "PROVIDER_FAILED",
      recipeId: "recipe",
      recipeVersion: "1",
      providerId: "provider",
      modelId: "model",
      taggerConfigSha256: sha("e"),
      expectedGeneRevision: f.db.raw
        .prepare("SELECT gene_revision FROM icono_manifestation_heads WHERE gene_id=?")
        .get(gene).gene_revision,
      ...command(`command_derivative_${n}`, "e"),
    })
  f.migrate()
  await assert.rejects(f.reserve("revision"), { code: "LINEAGE_DERIVATIVE_LIMIT_EXCEEDED" })
})

// B-875: admission counts every live intent, expired or not, against these caps.
// Nothing released an abandoned upload, so a caretaker on a flaky connection
// slowly lost lineage slots for good. Admission now first releases up to three of
// that caretaker's own expired strays, using the quota index 0014 creates.
const storageEnv = {
  ICONOPLASM_AUTHORING_STORAGE_ZONE: "quota-test-zone",
  ICONOPLASM_AUTHORING_STORAGE_PASSWORD: "quota-test-password",
}
const PAST = "2026-08-30T00:00:00.000Z"
const LATER = "2026-08-30T00:05:00.000Z"

function stubStorage(t, handler) {
  const original = globalThis.fetch
  t.after(() => {
    globalThis.fetch = original
  })
  globalThis.fetch = handler
}

const deletingStorage = async (_url, init = {}) =>
  new Response(null, { status: String(init.method).toUpperCase() === "DELETE" ? 200 : 404 })

function statusOf(f, id) {
  return f.db.raw
    .prepare("SELECT status FROM icono_manifestation_upload_intents WHERE upload_intent_id = ?")
    .get(id).status
}

function admit(f, n) {
  const envelope = storage(n, 1)
  return admitManifestationUploadIntent(f.db, storageEnv, {
    entityKind: "revision",
    entityId: `revision_admit_${n}`,
    assignmentId: assignment,
    objectKey: envelope.object_key,
    ciphertextSha256: envelope.ciphertext_sha256,
    bodyBytes: 1,
    actorKind: "account",
    actorAccountId: account,
    uploadIntentId: `intent_admit_${n}`,
    leaseToken: `lease_admit_${n}`,
    now: LATER,
    leaseMs: 600_000,
  })
}

test("a caretaker's next upload releases their own expired strays first (B-875)", async (t) => {
  const f = await fixture(t)
  f.migrate()
  stubStorage(t, deletingStorage)
  const reserved = () =>
    f.db.raw.prepare("SELECT body_reserved_bytes AS n FROM icono_authority_state").get().n
  const stray = await f.reserve("revision", 1, { now: PAST, leaseMs: 30_000 })
  assert.equal(reserved(), 1)
  const fresh = await admit(f, 20001)
  assert.equal(fresh.status, "uploading")
  assert.equal(statusOf(f, stray.upload_intent_id), "deleted")
  // Releasing the stray gave its bytes back; the fresh intent holds its own until adopted.
  assert.equal(reserved(), 1)
  f.db.raw
    .prepare(
      "UPDATE icono_manifestation_upload_intents SET status = 'adopted', resolved_at = CURRENT_TIMESTAMP WHERE upload_intent_id = ?",
    )
    .run("intent_admit_20001")
  assert.equal(reserved(), 0)
})

test("the release is bounded to three strays per upload (B-875)", async (t) => {
  const f = await fixture(t)
  f.migrate()
  stubStorage(t, deletingStorage)
  const strays = []
  for (let i = 0; i < 5; i++)
    strays.push(await f.reserve("revision", 1, { now: PAST, leaseMs: 30_000 }))
  await admit(f, 20002)
  const released = strays.filter((s) => statusOf(f, s.upload_intent_id) === "deleted").length
  assert.equal(released, 3)
})

test("admission leaves strays still inside their lease and strays it doesn't own (B-875)", async (t) => {
  const f = await fixture(t)
  f.migrate()
  stubStorage(t, deletingStorage)
  const live = await f.reserve("revision", 1, { now: LATER, leaseMs: 3_600_000 })
  const unowned = await f.reserve("revision", 1, {
    now: PAST,
    leaseMs: 30_000,
    assignmentId: null,
    actorKind: "migration",
    actorAccountId: null,
  })
  await admit(f, 20003)
  assert.equal(statusOf(f, live.upload_intent_id), "uploading", "lease not expired")
  assert.equal(statusOf(f, unowned.upload_intent_id), "uploading", "not this caretaker's")
})

test("a storage outage during the release never blocks the new upload (B-875)", async (t) => {
  const f = await fixture(t)
  f.migrate()
  stubStorage(t, async () => {
    throw new TypeError("fetch failed")
  })
  const stray = await f.reserve("revision", 1, { now: PAST, leaseMs: 30_000 })
  const fresh = await admit(f, 20004)
  assert.equal(fresh.status, "uploading")
  assert.equal(statusOf(f, stray.upload_intent_id), "uploading", "released on a later upload")
})

// B-985: a caretaker who abandons an upload and never uploads again is invisible to
// the release above. The `manifestations` background tick sweeps every caretaker's
// expired strays, three at most per run. These drive the Worker's real scheduled
// entry point over the real authoring schema; only the storage service is faked.
const reservedBytes = (f) =>
  f.db.raw.prepare("SELECT body_reserved_bytes AS n FROM icono_authority_state").get().n

function manifestationsTick(f) {
  // This test is about uploads: the fixture's own events need no projection.
  f.db.raw.exec("UPDATE icono_manifestation_events SET projection_status = 'not_required'")
  const refusePrimary = {
    prepare() {
      throw new Error("the upload sweep never touches the primary database")
    },
  }
  return runtime.scheduled(
    {
      cron: ICONOPLASM_RECURRING_CRON,
      scheduledTime: Date.UTC(2026, 9, 3, 12, ICONOPLASM_BACKGROUND_MINUTES.manifestations[0]),
    },
    { ...storageEnv, ICONOPLASM_DB: refusePrimary, ICONOPLASM_AUTHORING_DB: f.db },
    { waitUntil() {} },
  )
}

test("the scheduled manifestations tick releases an abandoned upload nobody retries (B-985)", async (t) => {
  const f = await fixture(t)
  f.migrate()
  const deleted = []
  stubStorage(t, async (url, init = {}) => {
    const isDelete = String(init.method).toUpperCase() === "DELETE"
    if (isDelete) deleted.push(String(url))
    return new Response(null, { status: isDelete ? 200 : 404 })
  })
  const stray = await f.reserve("revision", 5, { now: PAST, leaseMs: 30_000 })
  const live = await f.reserve("revision", 7, { leaseMs: 600_000 })
  assert.equal(reservedBytes(f), 12)
  await manifestationsTick(f)
  assert.equal(statusOf(f, stray.upload_intent_id), "deleted")
  assert.equal(statusOf(f, live.upload_intent_id), "uploading", "its lease has not ended")
  assert.equal(reservedBytes(f), 7, "the stray's bytes came back and the live upload's did not")
  assert.equal(deleted.length, 1)
  assert.ok(deleted[0].endsWith(stray.object_key), "the stray's stored body was deleted")
})

test("each tick releases at most three strays and the next tick finishes the rest (B-985)", async (t) => {
  const f = await fixture(t)
  f.migrate()
  stubStorage(t, deletingStorage)
  const strays = []
  for (let i = 0; i < 5; i++)
    strays.push(await f.reserve("revision", 1, { now: PAST, leaseMs: 30_000 }))
  const released = () => strays.filter((s) => statusOf(f, s.upload_intent_id) === "deleted").length
  await manifestationsTick(f)
  assert.equal(released(), 3)
  assert.equal(reservedBytes(f), 2)
  await manifestationsTick(f)
  assert.equal(released(), 5)
  assert.equal(reservedBytes(f), 0)
})

test("a storage outage keeps the stray reserved, is reported as pending, and a later tick releases it (B-985)", async (t) => {
  const f = await fixture(t)
  f.migrate()
  const errors = []
  t.mock.method(console, "error", (...args) => errors.push(args.join(" ")))
  let storageIsUp = false
  stubStorage(t, async (url, init) => {
    if (!storageIsUp) throw new TypeError("fetch failed")
    return deletingStorage(url, init)
  })
  const stray = await f.reserve("revision", 5, { now: PAST, leaseMs: 30_000 })
  await manifestationsTick(f)
  assert.equal(statusOf(f, stray.upload_intent_id), "uploading")
  assert.equal(reservedBytes(f), 5)
  assert.ok(
    errors.some((line) => line.includes("manifestations remains pending")),
    errors.join("; "),
  )
  // The failed release leased the stray for a minute; let that minute pass.
  f.db.raw
    .prepare(
      "UPDATE icono_manifestation_upload_intents SET lease_expires_at = ? WHERE upload_intent_id = ?",
    )
    .run(PAST, stray.upload_intent_id)
  storageIsUp = true
  await manifestationsTick(f)
  assert.equal(statusOf(f, stray.upload_intent_id), "deleted")
  assert.equal(reservedBytes(f), 0)
})

test("the scheduled read walks the due index in order, so its cost is the limit and not the number of strays (B-985)", async (t) => {
  const db = new TestD1()
  t.after(() => db.close())
  stubStorage(t, deletingStorage)
  const captured = []
  const prepare = db.prepare.bind(db)
  db.prepare = (sql) => {
    captured.push(sql)
    return prepare(sql)
  }
  await releaseAbandonedManifestationUploads({ ...storageEnv, ICONOPLASM_AUTHORING_DB: db })
  const read = captured.find((sql) =>
    /FROM icono_manifestation_upload_intents\s+WHERE status IN/.test(sql),
  )
  assert.ok(read, "the sweep reads the expired intents of every caretaker")
  const plan = db.raw
    .prepare(`EXPLAIN QUERY PLAN ${read}`)
    .all(PAST, 3)
    .map(({ detail }) => detail)
  assert.ok(
    plan.some((detail) => detail.includes("idx_icono_upload_intents_due")),
    plan.join("; "),
  )
  assert.ok(!plan.some((detail) => /TEMP B-TREE|SCAN/.test(detail)), plan.join("; "))
})

// B-1018. Ways the window can fail, written before the migration:
// 1. old history still counts, so a long-time caretaker stays locked out;
// 2. a full window no longer refuses, so the caps stop bounding an account;
// 3. live reservations escape the count because they are older than the window;
// 4. the window query scans the revisions table instead of seeking the index.
test("B-1018: 256 revisions older than 30 days no longer block the next save", async (t) => {
  const f = await fixture(t, { revisions: 256, historyAt: "2026-08-01T10:00:00.000Z" })
  f.migrate()
  await assert.rejects(f.reserve("revision", 1, { now: "2026-10-05T10:00:00.000Z" }), {
    code: "LINEAGE_REVISION_LIMIT_EXCEEDED",
  })
  f.migrateWindow()
  const admitted = await f.reserve("revision", 1, { now: "2026-10-05T10:00:00.000Z" })
  assert.equal(admitted.status, "uploading")
})

test("B-1018: a full 30-day window still refuses, and live reservations count at any age", async (t) => {
  const f = await fixture(t, { revisions: 255, historyAt: "2026-10-01T10:00:00.000Z" })
  f.migrate()
  f.migrateWindow()
  // An old reservation that is still uploading counts like a recent one.
  await f.reserve("revision", 1, {
    now: "2026-08-01T10:00:00.000Z",
    leaseMs: 10 * 60 * 1000,
  })
  await assert.rejects(f.reserve("revision", 1, { now: "2026-10-05T10:00:00.000Z" }), {
    code: "LINEAGE_REVISION_LIMIT_EXCEEDED",
  })
})

test("B-1018: the window quota seeks its index and every capped input", async (t) => {
  const f = await fixture(t, { revisions: 1 })
  f.migrate()
  f.migrateWindow()
  const query = windowMigration
    .slice(
      windowMigration.indexOf("  SELECT CASE\n    WHEN revisions"),
      windowMigration.lastIndexOf("END;"),
    )
    .replaceAll("NEW.caretaker_assignment_id", "?1")
    .replaceAll("NEW.entity_kind", "?2")
    .replaceAll("NEW.planned_body_bytes", "?3")
    .replaceAll("NEW.created_at", "?4")
    .replace(/RAISE\(ABORT, '[^']+'\)/g, "0")
  const plans = f.db.raw
    .prepare(`EXPLAIN QUERY PLAN ${query}`)
    .all(assignment, "derivative", 1, "2026-10-05T10:00:00.000Z")
  assert.ok(
    plans.every(
      ({ detail }) =>
        !/SCAN (icono_manifestation_revisions|icono_manifestation_derivatives|icono_manifestation_upload_intents|derivative)\b/.test(
          detail,
        ),
    ),
    JSON.stringify(plans),
  )
  assert.ok(
    plans.some(({ detail }) =>
      /idx_icono_revisions_caretaker_quota_window \(caretaker_assignment_id=\? AND created_at>\?\)/.test(
        detail,
      ),
    ),
    JSON.stringify(plans),
  )
  // B-859 step 2: the three unread indexes are gone.
  const left = f.db.raw
    .prepare(
      `SELECT name FROM sqlite_schema WHERE type = 'index' AND name IN (
         'idx_icono_revisions_manifestation_history', 'idx_icono_revisions_body_hash',
         'idx_icono_events_cursor', 'idx_icono_revisions_caretaker_quota')`,
    )
    .all()
  assert.deepEqual(left, [])
})
