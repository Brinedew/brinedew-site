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
} from "./manifestation-authority.js"
import { TestD1, command, sha, storage } from "./manifestation-authority-test-support.js"
import { createLineageAdmissionMigrationCostAdapter } from "../operation-cost-lineage-migration-adapter.js"

const migration = readFileSync(
  new URL(
    "../../../migrations-iconoplasm-authoring/0014_bounded_lineage_upload_admission.sql",
    import.meta.url,
  ),
  "utf8",
)
const admin = "account_quota_admin",
  account = "account_quota_user",
  gene = "gene_quota_test",
  assignment = "assignment_quota_test"
async function fixture(t, { revisions = 0, bodyBytes = 1 } = {}) {
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
      ...command(`command_quota_save_${i}`, "d", account, "account"),
    })
  let serial = 10000
  return {
    db,
    migrate: () => db.raw.exec(migration),
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
  f.db.raw.exec("CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY, name TEXT UNIQUE)")
  const adapter = createLineageAdmissionMigrationCostAdapter({
    db: f.db,
    executable_sha256: sha("a"),
    schema_sha256: sha("b"),
  })
  for (const [maxRows, maxIndexed] of [
    [767, 768],
    [768, 767],
  ]) {
    await assert.rejects(
      adapter.dispatch(
        await adapter.prepare({
          max_rows: maxRows,
          max_indexed_rows: maxIndexed,
          max_schema_rows: 256,
        }),
      ),
      /malformed JSON/,
    )
    assert.equal(
      f.db.raw
        .prepare(
          "SELECT COUNT(*) AS n FROM sqlite_schema WHERE name='idx_icono_revisions_caretaker_quota'",
        )
        .get().n,
      0,
    )
    assert.equal(f.db.raw.prepare("SELECT COUNT(*) AS n FROM d1_migrations").get().n, 0)
  }
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
