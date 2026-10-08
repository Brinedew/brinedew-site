import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
  appendSystemRevisionWithTags,
  registerAuthorityAccount,
  registerGeneIdentity,
  registerCaretakerTermsVersion,
  seedSystemManifestation,
  offerCaretakerAssignment,
  transitionCaretakerAssignment,
  saveManifestationRevision,
  submitTagsDerivative,
  releaseAbandonedManifestationUploads,
} from "./manifestation-authority.js"
import { TestD1, command, sha, storage } from "./manifestation-authority-test-support.js"
import {
  ICONOPLASM_BACKGROUND_MINUTES,
  ICONOPLASM_RECURRING_CRON,
} from "../../iconoplasm-background-schedule.js"
import runtime from "../../the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"

// The test double's base schema predates the upload reservations. These are the
// migrations production applied since, in order, and 0023, which retires them.
function migration(name) {
  return readFileSync(
    new URL(`../../../migrations-iconoplasm-authoring/${name}.sql`, import.meta.url),
    "utf8",
  )
}
const reservationEra = [
  "0013_strict_upload_reservations",
  "0014_bounded_lineage_upload_admission",
  "0022_lineage_quota_window_and_unread_indexes",
].map(migration)
const savesWithoutReservations = migration("0023_saves_without_upload_reservations")

const admin = "account_quota_admin",
  account = "account_quota_user",
  gene = "gene_quota_test",
  assignment = "assignment_quota_test",
  lineage = "manifestation_quota_user"

// Fixed clock: the caps count the 30 days before each row's own timestamp.
const NOW = "2026-10-05T10:00:00.000Z"
const RECENT = "2026-10-01T10:00:00.000Z"
const OLD = "2026-08-01T10:00:00.000Z"

async function fixture(t, { revisions = 0, bodyBytes = 1, historyAt = RECENT } = {}) {
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
  let serial = 10
  const f = {
    db,
    next: () => serial++,
    reservationEra: () => reservationEra.forEach((sql) => db.raw.exec(sql)),
    migrate() {
      f.reservationEra()
      db.raw.exec(savesWithoutReservations)
    },
  }
  // History written before the reservation-era fences, through the real commands.
  for (let i = 0; i < revisions; i++) await save(f, { bytes: bodyBytes, now: historyAt })
  return f
}

function save(f, { bytes = 1, now = NOW } = {}) {
  const n = f.next()
  const current = f.db.raw
    .prepare("SELECT row_version FROM icono_manifestations WHERE manifestation_id = ?")
    .get(lineage)
  return saveManifestationRevision(f.db, {
    assignmentId: assignment,
    expectedAssignmentVersion: 2,
    expectedManifestationVersion: current ? Number(current.row_version) : 0,
    storage: storage(n, bytes),
    manifestationId: lineage,
    revisionId: `revision_quota_${n}`,
    ...(now ? { now } : {}),
    ...command(`command_quota_save_${n}`, "d", account, "account"),
  })
}

function geneRevision(f) {
  return f.db.raw
    .prepare("SELECT gene_revision FROM icono_manifestation_heads WHERE gene_id = ?")
    .get(gene).gene_revision
}

function tags(f, revisionId, { status = "complete", now = NOW } = {}) {
  const n = f.next()
  const source = f.db.raw
    .prepare(
      "SELECT body_sha256 FROM icono_manifestation_revisions WHERE manifestation_revision_id = ?",
    )
    .get(revisionId).body_sha256
  return submitTagsDerivative(f.db, {
    revisionId,
    derivativeId: `derivative_quota_${n}`,
    status,
    sourceBodySha256: source,
    ...(status === "complete"
      ? {
          tagsSha256: sha("a"),
          tagsBytes: 7,
          fieldsSha256: sha("b"),
          fieldsBytes: 2,
          storage: storage(n, 10),
        }
      : { failureCode: "PROVIDER_FAILED" }),
    recipeId: "recipe",
    recipeVersion: "1",
    providerId: "provider",
    modelId: "model",
    taggerConfigSha256: sha("e"),
    expectedGeneRevision: geneRevision(f),
    now,
    ...command(`command_quota_tags_${n}`, "e"),
  })
}

const count = (f, table) => f.db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n
const reservedBytes = (f) =>
  f.db.raw.prepare("SELECT body_reserved_bytes AS n FROM icono_authority_state").get().n
const latestRevision = (f) =>
  f.db.raw
    .prepare(
      "SELECT manifestation_revision_id AS id FROM icono_manifestation_revisions WHERE manifestation_id = ? ORDER BY revision_number DESC LIMIT 1",
    )
    .get(lineage).id

// A reservation exactly as the code before B-859 wrote it, ahead of its upload.
function oldReservation(
  f,
  { kind = "revision", bytes = 1, createdAt, leaseMs = 600_000, entityId, envelope, ...owner },
) {
  const n = f.next()
  const body = envelope || storage(n, bytes)
  const created = createdAt || new Date().toISOString()
  const id = `intent_quota_${n}`
  f.db.raw
    .prepare(
      `INSERT INTO icono_manifestation_upload_intents
         (upload_intent_id, entity_kind, entity_id, caretaker_assignment_id, object_key,
          ciphertext_sha256, planned_body_bytes, lease_token, lease_expires_at, actor_kind,
          actor_account_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      kind,
      entityId || `${kind}_quota_${n}`,
      "assignmentId" in owner ? owner.assignmentId : assignment,
      body.object_key,
      body.ciphertext_sha256,
      bytes,
      `lease_quota_${n}`,
      new Date(Date.parse(created) + leaseMs).toISOString(),
      owner.actorKind || "account",
      "actorAccountId" in owner ? owner.actorAccountId : account,
      created,
    )
  return { upload_intent_id: id, object_key: body.object_key }
}

function statusOf(f, id) {
  return f.db.raw
    .prepare("SELECT status FROM icono_manifestation_upload_intents WHERE upload_intent_id = ?")
    .get(id).status
}

// B-859, written before migration 0023. Ways the move from reservations to
// commit-time caps can fail:
// 1. a save still needs a reservation, so every caretaker save breaks;
// 2. a reservation the old code wrote during the deploy is never adopted, and the
//    sweeper later deletes a body that a committed revision points at;
// 3. the caps stop refusing, so one account can write without bound;
// 4. the caps count history older than 30 days and lock a long-time caretaker out;
// 5. the caps catch the workstation's system revisions and stall the regeneration
//    outbox;
// 6. the commit-time check scans the revisions or Tags table on every save.

test("after 0023 a caretaker save commits with no reservation; the fence it drops refused it", async (t) => {
  const f = await fixture(t)
  f.reservationEra()
  await assert.rejects(save(f), /revision_upload_intent_is_not_adoptable/)
  f.db.raw.exec(savesWithoutReservations)
  await save(f)
  await tags(f, latestRevision(f))
  assert.equal(count(f, "icono_manifestation_upload_intents"), 0)
  assert.equal(count(f, "icono_manifestation_revision_storage_secrets"), 2)
  assert.equal(count(f, "icono_manifestation_derivative_storage_secrets"), 1)
  assert.equal(reservedBytes(f), 0)
})

test("a reservation the old code wrote during the deploy is still adopted when its save commits", async (t) => {
  const f = await fixture(t)
  f.reservationEra()
  const n = f.next()
  const envelope = storage(n, 5)
  const reservation = oldReservation(f, {
    bytes: 5,
    entityId: `revision_quota_${n}`,
    envelope,
  })
  assert.equal(reservedBytes(f), 5)
  f.db.raw.exec(savesWithoutReservations)
  await saveManifestationRevision(f.db, {
    assignmentId: assignment,
    expectedAssignmentVersion: 2,
    expectedManifestationVersion: 0,
    storage: envelope,
    manifestationId: lineage,
    revisionId: `revision_quota_${n}`,
    ...command(`command_quota_old_${n}`, "d", account, "account"),
  })
  assert.equal(statusOf(f, reservation.upload_intent_id), "adopted")
  assert.equal(reservedBytes(f), 0)
})

test("256 caretaker revisions in 30 days refuse the next one at commit", async (t) => {
  const f = await fixture(t, { revisions: 255 })
  f.migrate()
  await save(f)
  await assert.rejects(save(f), { code: "LINEAGE_REVISION_LIMIT_EXCEEDED", status: 429 })
  assert.equal(
    f.db.raw
      .prepare(
        "SELECT COUNT(*) AS n FROM icono_manifestation_revisions WHERE caretaker_assignment_id = ?",
      )
      .get(assignment).n,
    256,
  )
})

test("revisions older than 30 days do not count", async (t) => {
  const f = await fixture(t, { revisions: 256, historyAt: OLD })
  f.migrate()
  await save(f)
})

test("the 2 MiB lineage limit counts revision and Tags bodies at commit", async (t) => {
  const f = await fixture(t, { revisions: 127, bodyBytes: 16384 })
  f.migrate()
  // 128 x 16 KiB is exactly 2 MiB: allowed.
  await save(f, { bytes: 16384 })
  await assert.rejects(tags(f, latestRevision(f)), { code: "LINEAGE_BODY_QUOTA_EXCEEDED" })
  await assert.rejects(save(f), { code: "LINEAGE_BODY_QUOTA_EXCEEDED" })
})

test("512 Tags derivatives in 30 days refuse the next completed one", async (t) => {
  const f = await fixture(t, { revisions: 1 })
  f.migrate()
  const revision = latestRevision(f)
  // A failed run stores no body and is not refused, but it counts.
  for (let i = 0; i < 511; i++) await tags(f, revision, { status: "failed", now: RECENT })
  await tags(f, revision)
  await assert.rejects(tags(f, revision), { code: "LINEAGE_DERIVATIVE_LIMIT_EXCEEDED" })
})

test("the workstation's system revisions are not counted against a full caretaker lineage", async (t) => {
  const f = await fixture(t, { revisions: 256 })
  f.migrate()
  await assert.rejects(save(f), { code: "LINEAGE_REVISION_LIMIT_EXCEEDED" })
  const head = f.db.raw
    .prepare(
      "SELECT head_version, canonical_revision_id FROM icono_manifestation_heads WHERE gene_id = ?",
    )
    .get(gene)
  const n = f.next()
  await appendSystemRevisionWithTags(f.db, {
    geneId: gene,
    storage: storage(n, 16384),
    tags: {
      tagsSha256: sha("a"),
      tagsBytes: 7,
      fieldsSha256: sha("b"),
      fieldsBytes: 2,
      storage: storage(n + 1, 10),
      recipeId: "recipe",
      recipeVersion: "1",
      providerId: "provider",
      modelId: "model",
      taggerConfigSha256: sha("e"),
    },
    expectedHeadVersion: Number(head.head_version),
    expectedCanonicalRevisionId: head.canonical_revision_id,
    revisionId: "revision_quota_system",
    now: NOW,
    ...command("command_quota_system", "f"),
  })
})

test("both commit-time caps seek their indexes and read a bounded number of rows", async (t) => {
  const f = await fixture(t, { revisions: 1 })
  f.migrate()
  for (const body of savesWithoutReservations.split("CREATE TRIGGER").slice(1)) {
    const query = body
      .slice(body.indexOf("  SELECT iif("), body.lastIndexOf("END;"))
      .replaceAll("NEW.caretaker_assignment_id", "?1")
      .replaceAll("NEW.created_at", "?2")
      .replaceAll("NEW.body_bytes", "?3")
      .replaceAll("NEW.manifestation_revision_id", "?4")
      .replace(/RAISE\(ABORT, '[^']+'\)/g, "0")
    const plans = f.db.raw
      .prepare(`EXPLAIN QUERY PLAN ${query}`)
      .all(assignment, NOW, 1, latestRevision(f))
      .map(({ detail }) => detail)
    assert.ok(
      plans.every(
        (detail) =>
          !/SCAN (icono_manifestation_revisions|icono_manifestation_derivatives|derivative)\b/.test(
            detail,
          ),
      ),
      plans.join("; "),
    )
    assert.ok(
      plans.some((detail) =>
        /idx_icono_revisions_caretaker_quota_window \(caretaker_assignment_id=\? AND created_at>\?\)/.test(
          detail,
        ),
      ),
      plans.join("; "),
    )
    assert.ok(
      plans.some((detail) => detail.includes("idx_icono_derivatives_revision")),
      plans.join("; "),
    )
  }
})

// B-985: reservations the old code left behind are released by the
// `manifestations` background tick, three at most per run, until none is left.
// These drive the Worker's real scheduled entry point over the real authoring
// schema; only the storage service is faked.
const storageEnv = {
  ICONOPLASM_AUTHORING_STORAGE_ZONE: "quota-test-zone",
  ICONOPLASM_AUTHORING_STORAGE_PASSWORD: "quota-test-password",
}
const PAST = "2026-08-30T00:00:00.000Z"
const TICK_DAY = "2026-10-03T00:00:00.000Z"

function stubStorage(t, handler) {
  const original = globalThis.fetch
  t.after(() => {
    globalThis.fetch = original
  })
  globalThis.fetch = handler
}

const deletingStorage = async (_url, init = {}) =>
  new Response(null, { status: String(init.method).toUpperCase() === "DELETE" ? 200 : 404 })

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
  const stray = oldReservation(f, { bytes: 5, createdAt: PAST, leaseMs: 30_000 })
  const live = oldReservation(f, { bytes: 7, createdAt: TICK_DAY, leaseMs: 86_400_000 })
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
  for (let i = 0; i < 5; i++) strays.push(oldReservation(f, { createdAt: PAST, leaseMs: 30_000 }))
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
  const stray = oldReservation(f, { bytes: 5, createdAt: PAST, leaseMs: 30_000 })
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
