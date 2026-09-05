import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
  registerGeneIdentity,
  seedSystemManifestation,
  submitTagsDerivative,
} from "./manifestation-authority.js"
import { createManifestationUploadIntent } from "./manifestation-authority.js"
import { TestD1, command, sha, storage } from "./manifestation-authority-test-support.js"
import { createUploadReservationMigrationCostAdapter } from "../operation-cost-upload-migration-adapter.js"

const migration = readFileSync(
  new URL(
    "../../../migrations-iconoplasm-authoring/0013_strict_upload_reservations.sql",
    import.meta.url,
  ),
  "utf8",
)

test("schema growth refuses the upload migration before replacing guards or writing its receipt", async (t) => {
  const db = new TestD1()
  t.after(() => db.close())
  db.raw.exec("CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY, name TEXT UNIQUE)")
  const before = db.raw.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger'").all()
  for (let n = 0; n < 257; n++) db.raw.exec(`CREATE TABLE extra_schema_${n}(id INTEGER)`)
  const adapter = createUploadReservationMigrationCostAdapter({
    db,
    executable_sha256: sha("a"),
    schema_sha256: sha("b"),
  })
  await assert.rejects(
    adapter.prepare({ sql: "DROP TABLE d1_migrations" }),
    /COST_MIGRATION_ARGUMENTS_INVALID/,
  )
  const prepared = await adapter.prepare({})
  await assert.rejects(adapter.dispatch(prepared), /malformed JSON/)
  assert.deepEqual(
    db.raw.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger'").all(),
    before,
  )
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM d1_migrations").get().n, 0)
})

for (const kind of ["revision", "derivative"]) {
  for (const scenario of [
    "missing",
    "wrong-entity",
    "wrong-object",
    "wrong-hash",
    "expired",
    "failed",
    "valid",
  ]) {
    test(`${kind} upload reservation: ${scenario}`, async (t) => {
      const db = new TestD1()
      t.after(() => db.close())
      await registerGeneIdentity(db, { geneId: "gene_upload_test", canonicalSymbol: "UPLOADTEST" })
      const seed = (suffix, envelope) =>
        seedSystemManifestation(db, {
          geneId: "gene_upload_test",
          storage: envelope,
          expectedHeadVersion: 0,
          expectedCanonicalRevisionId: null,
          manifestationId: `manifestation_${suffix}`,
          revisionId: `revision_${suffix}`,
          selectionId: `selection_${suffix}`,
          ...command(`command_${suffix}`, "a", null, "migration"),
        })
      // Existing pre-migration content is a real upgrade fixture, not an
      // automatic reservation fabricated by the database test double.
      if (kind === "derivative") await seed("parent", storage(1))
      const before = db.raw
        .prepare("SELECT * FROM icono_manifestation_revision_storage_secrets")
        .all()
      db.raw.exec(migration)
      assert.deepEqual(
        db.raw.prepare("SELECT * FROM icono_manifestation_revision_storage_secrets").all(),
        before,
      )
      const envelope = storage(2, kind === "derivative" ? 10 : 100)
      const entityId = `${kind}_new`
      if (scenario !== "missing") {
        await createManifestationUploadIntent(db, {
          entityKind: kind,
          entityId: scenario === "wrong-entity" ? `${kind}_other` : entityId,
          objectKey: scenario === "wrong-object" ? storage(3).object_key : envelope.object_key,
          ciphertextSha256: scenario === "wrong-hash" ? sha("f") : envelope.ciphertext_sha256,
          bodyBytes: envelope.body_bytes,
          actorKind: "migration",
          uploadIntentId: "intent_new",
          leaseToken: "lease_new",
          ...(scenario === "expired" ? { now: "2020-01-01T00:00:00.000Z", leaseMs: 30000 } : {}),
        })
        if (scenario === "failed")
          db.raw.exec(
            "UPDATE icono_manifestation_upload_intents SET status='failed' WHERE upload_intent_id='intent_new'",
          )
      }
      const write = () =>
        kind === "revision"
          ? seed("new", envelope)
          : submitTagsDerivative(db, {
              revisionId: "revision_parent",
              derivativeId: entityId,
              status: "complete",
              sourceBodySha256: storage(1).body_sha256,
              tagsSha256: sha("a"),
              tagsBytes: 7,
              fieldsSha256: sha("b"),
              fieldsBytes: 2,
              storage: envelope,
              recipeId: "recipe",
              recipeVersion: "1",
              providerId: "provider",
              modelId: "model",
              taggerConfigSha256: sha("e"),
              expectedGeneRevision: 1,
              ...command("command_derivative", "b"),
            })
      if (scenario === "valid") {
        await write()
        assert.equal(
          db.raw
            .prepare(
              "SELECT status FROM icono_manifestation_upload_intents WHERE upload_intent_id='intent_new'",
            )
            .get().status,
          "adopted",
        )
      } else {
        await assert.rejects(write(), new RegExp(`${kind}_upload_intent_is_not_adoptable`))
      }
      const lookup = db.raw
        .prepare(
          `EXPLAIN QUERY PLAN SELECT 1 FROM icono_manifestation_upload_intents intent WHERE intent.object_key = ? AND intent.entity_kind = ? AND intent.entity_id = ? AND intent.ciphertext_sha256 = ? AND intent.status = 'uploading' AND julianday(intent.lease_expires_at) >= julianday(CURRENT_TIMESTAMP)`,
        )
        .all(envelope.object_key, kind, entityId, envelope.ciphertext_sha256)
      assert.ok(lookup.every(({ detail }) => !detail.includes("SCAN intent")))
      assert.ok(lookup.some(({ detail }) => detail.includes("object_key=?")))
    })
  }
}
