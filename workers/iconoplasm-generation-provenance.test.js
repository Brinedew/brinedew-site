import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import {
  exactGenerationProvenanceValidationKey,
  IconoplasmGenerationSourceError,
  iconoplasmGenerationFingerprint,
  readExactGenerationSource,
  requireExactGenerationProvenance,
  resolveCanonicalGenerationSource,
  validateExactGenerationSource,
} from "./lib/iconoplasm-generation-provenance.js"
import { encryptManifestationProse, sha256Hex } from "./lib/iconoplasm-manifestation-body-crypto.js"
import { createManifestationBodyObjectKey } from "./lib/iconoplasm-manifestation-body-storage.js"
import { encryptManifestationTags } from "./lib/iconoplasm-manifestation-tags-crypto.js"
import { prepareManifestationTagsPayload } from "./iconoplasm/caretaker/manifestation-tags-payload.js"

test("generation source fingerprint matches the frozen Website/workstation vector", async () => {
  const source = {
    generation_provenance_status: "bound",
    source_gene_id: "gene_dnmt3b_0001",
    source_manifestation_id: "manifestation_dnmt3b_0001",
    source_manifestation_revision_id: "revision_dnmt3b_0001",
    source_manifestation_body_sha256: "a".repeat(64),
    source_manifestation_derivative_id: "",
    source_manifestation_derivative_sha256: "",
    source_manifestation_derivative_tags_sha256: "",
    source_manifestation_derivative_tags_bytes: 0,
    source_manifestation_derivative_fields_sha256: "",
    source_manifestation_derivative_fields_bytes: 0,
    source_manifestation_derivative_recipe_id: "",
    source_manifestation_derivative_recipe_version: "",
    source_manifestation_derivative_provider_id: "",
    source_manifestation_derivative_model_id: "",
    source_manifestation_derivative_tagger_config_sha256: "",
    source_canonical_selection_id: "selection_dnmt3b_0001",
    source_canonical_head_version: 1,
    source_gene_revision: 1,
    source_sample_label: "DNMT3B-1",
    source_sample_number: 1,
    source_sample_text_sha256: "c".repeat(64),
    prompt_body_mode: "prose_prompt",
  }

  assert.equal(
    await iconoplasmGenerationFingerprint("iconoplasm.generation-source.v1", source),
    "6535b5471ed0d236a89410a069ba27094a59b7a65398c3033c649346d19c02a7",
  )
  const boundSource = {
    ...source,
    source_snapshot_sha256: await iconoplasmGenerationFingerprint(
      "iconoplasm.generation-source.v1",
      source,
    ),
  }
  assert.notEqual(
    exactGenerationProvenanceValidationKey(boundSource),
    exactGenerationProvenanceValidationKey({ ...boundSource, source_sample_label: "DNMT3B-2" }),
  )
})

const AUTHORING_ENV = Object.freeze({
  ICONOPLASM_AUTHORING_BODY_KEY_VERSION: "1",
  ICONOPLASM_AUTHORING_BODY_KEK_V1: Buffer.from(new Uint8Array(32).fill(7)).toString("base64"),
  ICONOPLASM_AUTHORING_STORAGE_HOST: "storage.test.invalid",
  ICONOPLASM_AUTHORING_STORAGE_ZONE: "authoring-test-zone",
  ICONOPLASM_AUTHORING_STORAGE_PASSWORD: "authoring-test-password",
  ICONOPLASM_AUTHORING_STORAGE_TIMEOUT_MS: "500",
})

class D1Statement {
  constructor(statement) {
    this.statement = statement
    this.args = []
  }

  bind(...args) {
    this.args = args
    return this
  }

  async first() {
    return this.statement.get(...this.args) || null
  }
}

class D1Database {
  constructor(database) {
    this.database = database
  }

  prepare(sql) {
    return new D1Statement(this.database.prepare(sql))
  }
}

async function insertRevision(
  database,
  env,
  objects,
  {
    revisionId,
    revisionNumber,
    prose,
    parentRevisionId = null,
    sampleLabel = `TP53-${revisionNumber}`,
    sampleNumber = revisionNumber,
    sampleTextSha256 = "c".repeat(64),
  },
) {
  const encrypted = await encryptManifestationProse(env, {
    revisionId,
    geneId: "gene_tp53",
    prose,
  })
  const objectKey = await createManifestationBodyObjectKey()
  database
    .prepare(
      `INSERT INTO icono_manifestation_revisions (
         manifestation_revision_id, manifestation_id, revision_number,
         parent_revision_id, body_sha256, body_bytes, sample_label, sample_number,
         sample_text_sha256
       ) VALUES (?, 'manifestation_0001', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      revisionId,
      revisionNumber,
      parentRevisionId,
      encrypted.body_sha256,
      encrypted.body_bytes,
      sampleLabel,
      sampleNumber,
      sampleTextSha256,
    )
  database
    .prepare(
      `INSERT INTO icono_manifestation_revision_storage_secrets (
         manifestation_revision_id, object_key, ciphertext_sha256, ciphertext_bytes,
         body_iv_base64, wrapped_dek_base64, wrap_iv_base64, key_version,
         aad_version, verified_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    )
    .run(
      revisionId,
      objectKey,
      encrypted.ciphertext_sha256,
      encrypted.ciphertext_bytes,
      encrypted.body_iv_base64,
      encrypted.wrapped_dek_base64,
      encrypted.wrap_iv_base64,
      encrypted.key_version,
      encrypted.aad_version,
    )
  database
    .prepare(
      `INSERT INTO icono_manifestation_revision_lifecycle (
         manifestation_revision_id, status
       ) VALUES (?, 'active')`,
    )
    .run(revisionId)
  database
    .prepare(
      `UPDATE icono_manifestations
       SET manifestation_head_revision_id = ?
       WHERE manifestation_id = 'manifestation_0001'`,
    )
    .run(revisionId)
  objects.set(objectKey, encrypted.ciphertext)
  return {
    revisionId,
    prose: encrypted.prose,
    hash: encrypted.body_sha256,
    objectKey,
    ciphertext: encrypted.ciphertext,
    sampleTextSha256,
  }
}

async function insertAcceptedTags(database, env, objects, { revision, tags, imported = false }) {
  const derivativeId = "derivative_0001"
  const recipeId = imported ? null : "tagger-v1"
  const recipeVersion = imported ? null : "1"
  const providerId = imported ? null : "tagger-provider"
  const modelId = imported ? null : "tagger-model"
  const taggerConfigSha256 = imported ? null : "d".repeat(64)
  const fieldsJson = { posture: "guarded", texture: ["dense", "quiet"] }
  const tagsSha256 = await sha256Hex(tags)
  const fieldsCanonicalJson = JSON.stringify(fieldsJson)
  const fieldsSha256 = await sha256Hex(fieldsCanonicalJson)
  const prepared = await prepareManifestationTagsPayload({
    tagsText: tags,
    fieldsJson,
    tagsSha256,
    fieldsSha256,
  })
  const encrypted = await encryptManifestationTags(env, {
    derivativeId,
    revisionId: revision.revisionId,
    sourceBodySha256: revision.hash,
    tags: prepared.output_plain,
  })
  const objectKey = await createManifestationBodyObjectKey()
  database
    .prepare(
      `INSERT INTO icono_manifestation_derivatives (
         manifestation_derivative_id, manifestation_revision_id, derivative_kind,
         status, source_body_sha256, body_sha256, body_bytes,
         tags_sha256, tags_bytes, fields_sha256, fields_bytes,
         recipe_id, recipe_version, provider_id, model_id, tagger_config_sha256,
         provenance_status, completed_at
       ) VALUES (?, ?, 'tags', 'complete', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    )
    .run(
      derivativeId,
      revision.revisionId,
      revision.hash,
      encrypted.body_sha256,
      encrypted.body_bytes,
      prepared.tags_sha256,
      prepared.tags_bytes,
      prepared.fields_sha256,
      prepared.fields_bytes,
      recipeId,
      recipeVersion,
      providerId,
      modelId,
      taggerConfigSha256,
      imported ? "legacy_unknown" : "generated",
    )
  database
    .prepare(
      `INSERT INTO icono_manifestation_derivative_storage_secrets (
         manifestation_derivative_id, object_key, ciphertext_sha256, ciphertext_bytes,
         body_iv_base64, wrapped_dek_base64, wrap_iv_base64, key_version,
         aad_version, verified_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    )
    .run(
      derivativeId,
      objectKey,
      encrypted.ciphertext_sha256,
      encrypted.ciphertext_bytes,
      encrypted.body_iv_base64,
      encrypted.wrapped_dek_base64,
      encrypted.wrap_iv_base64,
      encrypted.key_version,
      encrypted.aad_version,
    )
  database
    .prepare(
      `INSERT INTO icono_manifestation_derivative_heads (
         manifestation_revision_id, accepted_derivative_id, derivative_head_version
       ) VALUES (?, ?, 1)`,
    )
    .run(revision.revisionId, derivativeId)
  objects.set(objectKey, encrypted.ciphertext)
  return {
    derivativeId,
    tags: prepared.tags_text,
    fieldsJson: prepared.fields_json,
    recipeId,
    recipeVersion,
    providerId,
    modelId,
    taggerConfigSha256,
  }
}

function selectCanonical(
  database,
  { selectionId, revisionId, headVersion, previousSelectionId = null },
) {
  database
    .prepare(
      `INSERT INTO icono_manifestation_canonical_selections (
         canonical_selection_id, gene_id, previous_selection_id, previous_revision_id,
         selected_manifestation_id, selected_revision_id, reason, command_id,
         head_version, gene_revision
       ) VALUES (?, 'gene_tp53', ?, NULL, 'manifestation_0001', ?, 'select', ?, ?, ?)`,
    )
    .run(
      selectionId,
      previousSelectionId,
      revisionId,
      `command_${selectionId}`,
      headVersion,
      headVersion,
    )
}

async function authorityFixture({ sampleNumber = 1, sampleTextSha256 = "c".repeat(64) } = {}) {
  const database = new DatabaseSync(":memory:")
  database.exec(
    readFileSync(
      new URL(
        "../migrations-iconoplasm-authoring/0001_caretaker_manifestation_authority.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  )
  database
    .prepare(
      "INSERT INTO icono_gene_identities (gene_id, canonical_symbol) VALUES ('gene_tp53', 'TP53')",
    )
    .run()
  database
    .prepare(
      `INSERT INTO icono_manifestations (
         manifestation_id, gene_id, origin, status, non_withdrawable
       ) VALUES ('manifestation_0001', 'gene_tp53', 'system_seed', 'active', 1)`,
    )
    .run()
  const objects = new Map()
  const env = {
    ...AUTHORING_ENV,
    ICONOPLASM_AUTHORING_DB: new D1Database(database),
  }
  const first = await insertRevision(database, env, objects, {
    revisionId: "revision_0001",
    revisionNumber: 1,
    prose: "The first immutable manifestation.",
    sampleNumber,
    sampleTextSha256,
  })
  selectCanonical(database, {
    selectionId: "selection_0001",
    revisionId: first.revisionId,
    headVersion: 1,
  })
  return { database, env, objects, first }
}

test("accepted encrypted Tags are read with derivative identity and Tags AAD", async () => {
  const fixture = await authorityFixture()
  const derivative = await insertAcceptedTags(fixture.database, fixture.env, fixture.objects, {
    revision: fixture.first,
    tags: "dense chromatin, guarded checkpoint, quiet nuclear tension",
  })
  const restoreFetch = installStorageFetch(fixture.objects)
  try {
    const queued = await resolveCanonicalGenerationSource(fixture.env, {
      geneSymbol: "TP53",
      promptBodyMode: "taggerizer_prompt",
    })
    const exact = await readExactGenerationSource(fixture.env, queued)

    assert.equal(queued.source_manifestation_derivative_id, derivative.derivativeId)
    assert.equal(queued.source_manifestation_derivative_recipe_id, derivative.recipeId)
    assert.equal(queued.source_manifestation_derivative_recipe_version, derivative.recipeVersion)
    assert.equal(queued.source_manifestation_derivative_provider_id, derivative.providerId)
    assert.equal(queued.source_manifestation_derivative_model_id, derivative.modelId)
    assert.equal(
      queued.source_manifestation_derivative_tagger_config_sha256,
      derivative.taggerConfigSha256,
    )
    assert.equal(exact.prose, fixture.first.prose)
    assert.equal(exact.tags, derivative.tags)
  } finally {
    restoreFetch()
    fixture.database.close()
  }
})

test("imported Tags bind new generation to verified bytes without inventing authoring history", async () => {
  const fixture = await authorityFixture()
  const derivative = await insertAcceptedTags(fixture.database, fixture.env, fixture.objects, {
    revision: fixture.first,
    tags: "guarded checkpoint, quiet nuclear tension",
    imported: true,
  })
  const restoreFetch = installStorageFetch(fixture.objects)
  try {
    const queued = await resolveCanonicalGenerationSource(fixture.env, {
      geneSymbol: "TP53",
      promptBodyMode: "taggerizer_prompt",
    })
    assert.equal(queued.source_manifestation_derivative_recipe_id, "")
    assert.equal(queued.source_manifestation_derivative_tagger_config_sha256, "")
    assert.equal(
      requireExactGenerationProvenance(queued).source_snapshot_sha256,
      queued.source_snapshot_sha256,
    )
    assert.equal((await readExactGenerationSource(fixture.env, queued)).tags, derivative.tags)
    assert.equal(
      (await validateExactGenerationSource(fixture.env, queued)).source_snapshot_sha256,
      queued.source_snapshot_sha256,
    )
    await assert.rejects(
      readExactGenerationSource(fixture.env, {
        ...queued,
        source_snapshot_sha256: "0".repeat(64),
      }),
      (error) => error.code === "GENERATION_SOURCE_SNAPSHOT_MISMATCH",
    )
    assert.throws(
      () =>
        requireExactGenerationProvenance({
          ...queued,
          source_manifestation_derivative_tags_sha256: "",
        }),
      (error) => error.code === "GENERATION_SOURCE_INVALID",
    )
  } finally {
    restoreFetch()
    fixture.database.close()
  }
})

test("exact source identity distinguishes nullable sample number and sample text hash", async () => {
  const initialSampleTextSha256 = await sha256Hex("initial sample source")
  const fixture = await authorityFixture({
    sampleNumber: null,
    sampleTextSha256: initialSampleTextSha256,
  })
  try {
    const queued = await resolveCanonicalGenerationSource(fixture.env, {
      geneSymbol: "TP53",
      promptBodyMode: "prose_prompt",
    })
    assert.equal(queued.source_sample_number, null)
    assert.equal(queued.source_sample_text_sha256, initialSampleTextSha256)
    assert.equal(requireExactGenerationProvenance(queued).source_sample_number, null)

    assert.throws(
      () =>
        fixture.database
          .prepare(
            `UPDATE icono_manifestation_revisions
             SET sample_number = 0
             WHERE manifestation_revision_id = ?`,
          )
          .run(fixture.first.revisionId),
      /manifestation_revisions_are_immutable/,
    )
    // Model authority-file corruption after proving the normal SQL boundary rejects it.
    // The generation boundary must still refuse the now-mismatched snapshot.
    fixture.database.exec("DROP TRIGGER icono_manifestation_revisions_immutable_update")
    fixture.database
      .prepare(
        `UPDATE icono_manifestation_revisions
         SET sample_number = 0
         WHERE manifestation_revision_id = ?`,
      )
      .run(fixture.first.revisionId)
    const zeroSample = await resolveCanonicalGenerationSource(fixture.env, {
      geneSymbol: "TP53",
      promptBodyMode: "prose_prompt",
    })
    assert.equal(zeroSample.source_sample_number, 0)
    assert.notEqual(zeroSample.source_snapshot_sha256, queued.source_snapshot_sha256)
    await assert.rejects(
      validateExactGenerationSource(fixture.env, queued),
      (error) =>
        error instanceof IconoplasmGenerationSourceError &&
        error.code === "GENERATION_SOURCE_SNAPSHOT_MISMATCH",
    )

    const changedSampleTextSha256 = await sha256Hex("changed sample source")
    fixture.database
      .prepare(
        `UPDATE icono_manifestation_revisions
         SET sample_number = NULL, sample_text_sha256 = ?
         WHERE manifestation_revision_id = ?`,
      )
      .run(changedSampleTextSha256, fixture.first.revisionId)
    const changedSample = await resolveCanonicalGenerationSource(fixture.env, {
      geneSymbol: "TP53",
      promptBodyMode: "prose_prompt",
    })
    assert.equal(changedSample.source_sample_number, null)
    assert.equal(changedSample.source_sample_text_sha256, changedSampleTextSha256)
    assert.notEqual(changedSample.source_snapshot_sha256, queued.source_snapshot_sha256)
  } finally {
    fixture.database.close()
  }
})

function installStorageFetch(objects) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(init.method, "GET")
    assert.equal(init.headers.AccessKey, AUTHORING_ENV.ICONOPLASM_AUTHORING_STORAGE_PASSWORD)
    const pathParts = new URL(String(url)).pathname.split("/").filter(Boolean)
    assert.equal(pathParts.shift(), AUTHORING_ENV.ICONOPLASM_AUTHORING_STORAGE_ZONE)
    const objectKey = pathParts.join("/")
    const bytes = objects.get(objectKey)
    return bytes
      ? new Response(bytes, { status: 200, headers: { etag: '"test-etag"' } })
      : new Response(null, { status: 404 })
  }
  return () => {
    globalThis.fetch = originalFetch
  }
}

test("a queued source remains pinned after the canonical head changes", async () => {
  const fixture = await authorityFixture()
  const restoreFetch = installStorageFetch(fixture.objects)
  try {
    const queued = await resolveCanonicalGenerationSource(fixture.env, {
      geneSymbol: "TP53",
      promptBodyMode: "prose_prompt",
    })
    const second = await insertRevision(fixture.database, fixture.env, fixture.objects, {
      revisionId: "revision_0002",
      revisionNumber: 2,
      prose: "The later canonical manifestation.",
      parentRevisionId: fixture.first.revisionId,
    })
    selectCanonical(fixture.database, {
      selectionId: "selection_0002",
      revisionId: second.revisionId,
      headVersion: 2,
      previousSelectionId: "selection_0001",
    })

    const current = await resolveCanonicalGenerationSource(fixture.env, {
      geneSymbol: "TP53",
      promptBodyMode: "prose_prompt",
    })
    const validatedQueued = await validateExactGenerationSource(fixture.env, queued)
    const materializedQueued = await readExactGenerationSource(fixture.env, queued)

    assert.equal(current.source_manifestation_revision_id, "revision_0002")
    assert.equal(validatedQueued.source_manifestation_revision_id, "revision_0001")
    assert.equal(materializedQueued.prose, fixture.first.prose)
    assert.equal(materializedQueued.source_snapshot_sha256, queued.source_snapshot_sha256)
  } finally {
    restoreFetch()
    fixture.database.close()
  }
})

test("withdrawn and tampered exact sources fail closed", async () => {
  const fixture = await authorityFixture()
  try {
    const queued = await resolveCanonicalGenerationSource(fixture.env, {
      geneSymbol: "TP53",
      promptBodyMode: "prose_prompt",
    })
    const second = await insertRevision(fixture.database, fixture.env, fixture.objects, {
      revisionId: "revision_0002",
      revisionNumber: 2,
      prose: "A replacement canonical manifestation.",
      parentRevisionId: fixture.first.revisionId,
    })
    selectCanonical(fixture.database, {
      selectionId: "selection_0002",
      revisionId: second.revisionId,
      headVersion: 2,
      previousSelectionId: "selection_0001",
    })
    fixture.database
      .prepare(
        `UPDATE icono_manifestation_revision_lifecycle
         SET status = 'withdrawn', lifecycle_version = lifecycle_version + 1
         WHERE manifestation_revision_id = 'revision_0001'`,
      )
      .run()

    await assert.rejects(
      validateExactGenerationSource(fixture.env, queued),
      (error) =>
        error instanceof IconoplasmGenerationSourceError &&
        error.code === "GENERATION_SOURCE_REVISION_INACTIVE",
    )
    await assert.rejects(
      validateExactGenerationSource(fixture.env, {
        ...queued,
        source_manifestation_revision_id: "revision_fake1",
      }),
      (error) => error instanceof IconoplasmGenerationSourceError,
    )
  } finally {
    fixture.database.close()
  }
})

test("missing ciphertext and purged storage secrets cannot use cached plaintext", async () => {
  const fixture = await authorityFixture()
  const restoreFetch = installStorageFetch(fixture.objects)
  try {
    const queued = await resolveCanonicalGenerationSource(fixture.env, {
      geneSymbol: "TP53",
      promptBodyMode: "prose_prompt",
    })
    fixture.objects.delete(fixture.first.objectKey)
    await assert.rejects(
      readExactGenerationSource(fixture.env, queued),
      (error) =>
        error instanceof IconoplasmGenerationSourceError &&
        error.code === "GENERATION_SOURCE_BODY_MISSING",
    )

    fixture.objects.set(fixture.first.objectKey, fixture.first.ciphertext)
    const second = await insertRevision(fixture.database, fixture.env, fixture.objects, {
      revisionId: "revision_0002",
      revisionNumber: 2,
      prose: "A replacement canonical manifestation.",
      parentRevisionId: fixture.first.revisionId,
    })
    selectCanonical(fixture.database, {
      selectionId: "selection_0002",
      revisionId: second.revisionId,
      headVersion: 2,
      previousSelectionId: "selection_0001",
    })
    fixture.database
      .prepare(
        `DELETE FROM icono_manifestation_revision_storage_secrets
         WHERE manifestation_revision_id = ?`,
      )
      .run(fixture.first.revisionId)
    await assert.rejects(
      validateExactGenerationSource(fixture.env, queued),
      (error) =>
        error instanceof IconoplasmGenerationSourceError &&
        error.code === "GENERATION_SOURCE_BODY_UNAVAILABLE",
    )
  } finally {
    restoreFetch()
    fixture.database.close()
  }
})

test("legacy rows are refused instead of resolving the current gene revision", () => {
  assert.throws(
    () =>
      requireExactGenerationProvenance({
        gene_symbol: "TP53",
        manifestation: "mutable legacy text",
        generation_provenance_status: "legacy_unbound",
      }),
    (error) =>
      error instanceof IconoplasmGenerationSourceError &&
      error.code === "LEGACY_GENERATION_SOURCE_UNBOUND",
  )
})

test("the primary migration leaves history unbound and accepts an exact receipt", async () => {
  const database = new DatabaseSync(":memory:")
  try {
    database.exec(`
      CREATE TABLE icono_generation_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        gene_symbol TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE icono_candidate_generation_jobs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        provider_id TEXT NOT NULL DEFAULT '',
        gene_symbol TEXT NOT NULL,
        manifestation TEXT NOT NULL DEFAULT '',
        prompt_body_mode TEXT NOT NULL DEFAULT 'taggerizer_prompt',
        prompt TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE icono_portrait_assets (
        gene_symbol TEXT NOT NULL,
        asset_sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (gene_symbol, asset_sha256)
      );
      INSERT INTO icono_generation_requests (gene_symbol) VALUES ('TP53');
      INSERT INTO icono_candidate_generation_jobs (id, user_id, gene_symbol)
        VALUES ('legacy_job', 'account_1', 'TP53');
      INSERT INTO icono_portrait_assets (gene_symbol, asset_sha256)
        VALUES ('TP53', '${"a".repeat(64)}');
    `)
    database.exec(
      readFileSync(
        new URL("../migrations-iconoplasm/0083_exact_generation_provenance.sql", import.meta.url),
        "utf8",
      ),
    )
    assert.equal(
      database
        .prepare("SELECT generation_provenance_status FROM icono_generation_requests WHERE id = 1")
        .get().generation_provenance_status,
      "legacy_unbound",
    )
    assert.equal(
      database
        .prepare(
          "SELECT generation_provenance_status FROM icono_candidate_generation_jobs WHERE id = 'legacy_job'",
        )
        .get().generation_provenance_status,
      "legacy_unbound",
    )
    assert.equal(
      database
        .prepare(
          "SELECT generation_provenance_status FROM icono_portrait_assets WHERE gene_symbol = 'TP53'",
        )
        .get().generation_provenance_status,
      "legacy_unbound",
    )
    assert.throws(
      () =>
        database
          .prepare(
            `UPDATE icono_candidate_generation_jobs
             SET generation_provenance_status = 'bound', manifestation = 'forbidden plaintext'
             WHERE id = 'legacy_job'`,
          )
          .run(),
      /bound_generation_job_plaintext_forbidden/,
    )
    assert.throws(
      () =>
        database
          .prepare(
            `UPDATE icono_candidate_generation_jobs
             SET generation_provenance_status = 'bound', manifestation = '', prompt = ''
             WHERE id = 'legacy_job'`,
          )
          .run(),
      /bound_generation_job_provenance_incomplete/,
    )
    database
      .prepare(
        `INSERT INTO icono_portrait_generation_provenance (
           generation_request_id, generation_attempt_id, gene_symbol, asset_sha256,
           source_gene_id, source_manifestation_id, source_manifestation_revision_id,
           source_manifestation_body_sha256, source_canonical_selection_id,
           source_canonical_head_version, source_gene_revision, source_snapshot_sha256,
           provider_id, model_id, prompt_sha256, generation_config_sha256
         ) VALUES (?, ?, 'TP53', ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?)`,
      )
      .run(
        "request_exact_0001",
        "attempt_exact_0001",
        "a".repeat(64),
        "gene_tp53",
        "manifestation_0001",
        "revision_0001",
        "b".repeat(64),
        "selection_0001",
        "c".repeat(64),
        "provider-test",
        "model-test",
        "d".repeat(64),
        "e".repeat(64),
      )
    assert.equal(
      database
        .prepare(
          "SELECT source_manifestation_revision_id FROM icono_portrait_generation_provenance",
        )
        .get().source_manifestation_revision_id,
      "revision_0001",
    )
  } finally {
    database.close()
  }
})
