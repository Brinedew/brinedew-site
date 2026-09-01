import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import {
  encryptManifestationProse,
  sha256Hex,
} from "../../lib/iconoplasm-manifestation-body-crypto.js"
import { createManifestationBodyObjectKey } from "../../lib/iconoplasm-manifestation-body-storage.js"
import { encryptManifestationTags } from "../../lib/iconoplasm-manifestation-tags-crypto.js"
import {
  PublicCanonicalMaterialError,
  readPublicCanonicalMaterial,
  verifyPublicCanonicalMaterial,
  verifyPublicCanonicalMaterialItem,
} from "./manifestation-public-canonical-material.js"
import { prepareManifestationTagsPayload } from "./manifestation-tags-payload.js"

const AUTHORING_MIGRATION = readFileSync(
  new URL(
    "../../../migrations-iconoplasm-authoring/0001_caretaker_manifestation_authority.sql",
    import.meta.url,
  ),
  "utf8",
)
const AUTHORING_VISIBILITY_MIGRATION = readFileSync(
  new URL(
    "../../../migrations-iconoplasm-authoring/0007_manifestation_page_visibility.sql",
    import.meta.url,
  ),
  "utf8",
)
const PRIMARY_MIGRATION = readFileSync(
  new URL(
    "../../../migrations-iconoplasm/0084_manifestation_authority_cutover.sql",
    import.meta.url,
  ),
  "utf8",
)
const PRIMARY_VISIBILITY_MIGRATION = readFileSync(
  new URL("../../../migrations-iconoplasm/0089_manifestation_page_visibility.sql", import.meta.url),
  "utf8",
)
const ENV = Object.freeze({
  ICONOPLASM_AUTHORING_BODY_KEY_VERSION: "1",
  ICONOPLASM_AUTHORING_BODY_KEK_V1: Buffer.from(new Uint8Array(32).fill(19)).toString("base64"),
  ICONOPLASM_AUTHORING_STORAGE_HOST: "storage.test.invalid",
  ICONOPLASM_AUTHORING_STORAGE_ZONE: "public-material-test",
  ICONOPLASM_AUTHORING_STORAGE_PASSWORD: "test-password",
  ICONOPLASM_AUTHORING_STORAGE_TIMEOUT_MS: "500",
})

class Statement {
  constructor(database, sql, parameters = []) {
    this.database = database
    this.sql = sql
    this.parameters = parameters
  }

  bind(...parameters) {
    return new Statement(this.database, this.sql, parameters)
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

class D1 {
  constructor(database) {
    this.raw = database
  }

  prepare(sql) {
    return new Statement(this.raw, sql)
  }

  async batch(statements) {
    const output = []
    for (const statement of statements) output.push(await statement.run())
    return output
  }
}

function installStorageFetch(objects) {
  const originalFetch = globalThis.fetch
  let reads = 0
  globalThis.fetch = async (url, init = {}) => {
    reads += 1
    assert.equal(init.method, "GET")
    assert.equal(init.headers.AccessKey, ENV.ICONOPLASM_AUTHORING_STORAGE_PASSWORD)
    const parts = new URL(String(url)).pathname.split("/").filter(Boolean)
    assert.equal(parts.shift(), ENV.ICONOPLASM_AUTHORING_STORAGE_ZONE)
    const bytes = objects.get(parts.join("/"))
    return bytes
      ? new Response(bytes, { status: 200, headers: { etag: '"fixture"' } })
      : new Response(null, { status: 404 })
  }
  return {
    reads: () => reads,
    restore() {
      globalThis.fetch = originalFetch
    },
  }
}

async function fixture({ mode = "authoritative" } = {}) {
  const authoringRaw = new DatabaseSync(":memory:")
  authoringRaw.exec(AUTHORING_MIGRATION)
  authoringRaw.exec(AUTHORING_VISIBILITY_MIGRATION)
  const primaryRaw = new DatabaseSync(":memory:")
  primaryRaw.exec(`
    CREATE TABLE icono_gene_essence (
      gene_symbol TEXT PRIMARY KEY,
      manifestation TEXT,
      manifestation_tags TEXT,
      manifestation_fields_json TEXT
    );
  `)
  primaryRaw.exec(PRIMARY_MIGRATION)
  primaryRaw.exec(PRIMARY_VISIBILITY_MIGRATION)
  primaryRaw
    .prepare(
      `INSERT INTO icono_gene_essence (
       gene_symbol, manifestation, manifestation_tags, manifestation_fields_json
     ) VALUES ('TP53', 'legacy prose must never be read', 'legacy tags', '{"legacy":true}')`,
    )
    .run()
  primaryRaw
    .prepare(
      `UPDATE icono_manifestation_projection_authority
        SET authority_epoch = 2, mode = ?, expected_gene_count = 1
      WHERE singleton = 1`,
    )
    .run(mode)

  authoringRaw
    .prepare(
      "INSERT INTO icono_gene_identities (gene_id, canonical_symbol) VALUES ('gene_tp53', 'TP53')",
    )
    .run()
  authoringRaw
    .prepare(
      `INSERT INTO icono_manifestations (
       manifestation_id, gene_id, origin, status, non_withdrawable
     ) VALUES ('manifestation_0001', 'gene_tp53', 'system_seed', 'active', 1)`,
    )
    .run()

  const objects = new Map()
  const proseEncrypted = await encryptManifestationProse(ENV, {
    revisionId: "revision_0001",
    geneId: "gene_tp53",
    prose: "The exact public canonical manifestation.",
  })
  const proseObjectKey = await createManifestationBodyObjectKey()
  authoringRaw
    .prepare(
      `INSERT INTO icono_manifestation_revisions (
       manifestation_revision_id, manifestation_id, revision_number,
       body_sha256, body_bytes, sample_label, sample_number, sample_text_sha256
     ) VALUES ('revision_0001', 'manifestation_0001', 1, ?, ?, 'TP53-1', 1, ?)`,
    )
    .run(proseEncrypted.body_sha256, proseEncrypted.body_bytes, "a".repeat(64))
  authoringRaw
    .prepare(
      `INSERT INTO icono_manifestation_revision_storage_secrets (
       manifestation_revision_id, object_key, ciphertext_sha256, ciphertext_bytes,
       body_iv_base64, wrapped_dek_base64, wrap_iv_base64, key_version, aad_version, verified_at
     ) VALUES ('revision_0001', ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    )
    .run(
      proseObjectKey,
      proseEncrypted.ciphertext_sha256,
      proseEncrypted.ciphertext_bytes,
      proseEncrypted.body_iv_base64,
      proseEncrypted.wrapped_dek_base64,
      proseEncrypted.wrap_iv_base64,
      proseEncrypted.key_version,
      proseEncrypted.aad_version,
    )
  authoringRaw
    .prepare(
      `INSERT INTO icono_manifestation_revision_lifecycle (
       manifestation_revision_id, status
     ) VALUES ('revision_0001', 'active')`,
    )
    .run()
  authoringRaw
    .prepare(
      `INSERT INTO icono_manifestation_canonical_selections (
       canonical_selection_id, gene_id, selected_manifestation_id, selected_revision_id,
       reason, command_id, head_version, gene_revision
     ) VALUES (
       'selection_0001', 'gene_tp53', 'manifestation_0001', 'revision_0001',
       'migration', 'command_selection_0001', 1, 1
     )`,
    )
    .run()

  const fieldsJson = { posture: "guarded", texture: ["dense", "quiet"] }
  const tagsText = "dense chromatin, guarded checkpoint"
  const preparedTags = await prepareManifestationTagsPayload({
    tagsText,
    fieldsJson,
    tagsSha256: await sha256Hex(tagsText),
    fieldsSha256: await sha256Hex(JSON.stringify(fieldsJson)),
  })
  const tagsEncrypted = await encryptManifestationTags(ENV, {
    derivativeId: "derivative_0001",
    revisionId: "revision_0001",
    sourceBodySha256: proseEncrypted.body_sha256,
    tags: preparedTags.output_plain,
  })
  const tagsObjectKey = await createManifestationBodyObjectKey()
  authoringRaw
    .prepare(
      `INSERT INTO icono_manifestation_derivatives (
       manifestation_derivative_id, manifestation_revision_id, derivative_kind, status,
       source_body_sha256, body_sha256, body_bytes, tags_sha256, tags_bytes,
       fields_sha256, fields_bytes, recipe_id, recipe_version, provider_id, model_id,
       tagger_config_sha256, completed_at
     ) VALUES (
       'derivative_0001', 'revision_0001', 'tags', 'complete', ?, ?, ?, ?, ?, ?, ?,
       'tagger-recipe', '3', 'tagger-provider', 'tagger-model', ?, CURRENT_TIMESTAMP
     )`,
    )
    .run(
      proseEncrypted.body_sha256,
      tagsEncrypted.body_sha256,
      tagsEncrypted.body_bytes,
      preparedTags.tags_sha256,
      preparedTags.tags_bytes,
      preparedTags.fields_sha256,
      preparedTags.fields_bytes,
      "b".repeat(64),
    )
  authoringRaw
    .prepare(
      `INSERT INTO icono_manifestation_derivative_storage_secrets (
       manifestation_derivative_id, object_key, ciphertext_sha256, ciphertext_bytes,
       body_iv_base64, wrapped_dek_base64, wrap_iv_base64, key_version, aad_version, verified_at
     ) VALUES ('derivative_0001', ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    )
    .run(
      tagsObjectKey,
      tagsEncrypted.ciphertext_sha256,
      tagsEncrypted.ciphertext_bytes,
      tagsEncrypted.body_iv_base64,
      tagsEncrypted.wrapped_dek_base64,
      tagsEncrypted.wrap_iv_base64,
      tagsEncrypted.key_version,
      tagsEncrypted.aad_version,
    )
  authoringRaw
    .prepare(
      `INSERT INTO icono_manifestation_derivative_heads (
       manifestation_revision_id, accepted_derivative_id, derivative_head_version
     ) VALUES ('revision_0001', 'derivative_0001', 1)`,
    )
    .run()

  authoringRaw
    .prepare(
      `INSERT INTO icono_authoring_command_receipts (
       command_id, command_type, actor_kind, gene_id, request_sha256, response_json
     ) VALUES ('command_event_0001', 'migration', 'migration', 'gene_tp53', ?, '{}')`,
    )
    .run("c".repeat(64))
  // This fixture needs the accepted event/head identity, not a second copy of
  // the command-layer snapshot builder already covered by authority tests.
  authoringRaw.exec("DROP TRIGGER icono_events_validate_snapshot")
  authoringRaw
    .prepare(
      `INSERT INTO icono_manifestation_events (
       event_uuid, command_id, event_type, gene_id, gene_revision,
       manifestation_id, manifestation_revision_id, canonical_selection_id, payload_json
     ) VALUES (
       'event_0001', 'command_event_0001', 'manifestation.authority_gene_snapshot.v1',
       'gene_tp53', 1, 'manifestation_0001', 'revision_0001', 'selection_0001', '{}'
     )`,
    )
    .run()

  primaryRaw
    .prepare(
      `INSERT INTO icono_manifestation_canonical_projection (
       gene_id, canonical_symbol, canonical_manifestation_id, canonical_revision_id,
       canonical_selection_id, canonical_body_sha256, canonical_body_bytes,
       canonical_revision_lifecycle, accepted_tags_derivative_id,
       accepted_tags_derivative_head_version, accepted_tags_status,
       accepted_tags_source_body_sha256, accepted_tags_body_sha256,
       accepted_tags_body_bytes, accepted_tags_text_sha256, accepted_tags_text_bytes,
       accepted_tags_fields_sha256, accepted_tags_fields_bytes, accepted_tags_recipe_id,
       accepted_tags_recipe_version, accepted_tags_provider_id, accepted_tags_model_id,
       accepted_tags_config_sha256, accepted_tags_provenance_status, head_version,
        gene_revision, authority_event_id, authority_event_sequence, authority_epoch,
        public_material_event_id, public_material_version
     ) VALUES (
       'gene_tp53', 'TP53', 'manifestation_0001', 'revision_0001', 'selection_0001', ?, ?,
       'active', 'derivative_0001', 1, 'complete', ?, ?, ?, ?, ?, ?, ?,
       'tagger-recipe', '3', 'tagger-provider', 'tagger-model', ?, 'generated',
        1, 1, 'event_0001', 1, 2, 'event_0001', 1
     )`,
    )
    .run(
      proseEncrypted.body_sha256,
      proseEncrypted.body_bytes,
      proseEncrypted.body_sha256,
      tagsEncrypted.body_sha256,
      tagsEncrypted.body_bytes,
      preparedTags.tags_sha256,
      preparedTags.tags_bytes,
      preparedTags.fields_sha256,
      preparedTags.fields_bytes,
      "b".repeat(64),
    )
  objects.set(proseObjectKey, proseEncrypted.ciphertext)
  objects.set(tagsObjectKey, tagsEncrypted.ciphertext)
  return {
    authoringDb: new D1(authoringRaw),
    primaryDb: new D1(primaryRaw),
    authoringRaw,
    primaryRaw,
    objects,
    proseObjectKey,
    tagsObjectKey,
    proseEncrypted,
    tagsEncrypted,
    preparedTags,
  }
}

function closeFixture(value) {
  value.authoringRaw.close()
  value.primaryRaw.close()
}

test("public canonical material exact-reads encrypted prose and compound Tags without secrets", async () => {
  const value = await fixture()
  const storage = installStorageFetch(value.objects)
  try {
    const material = await readPublicCanonicalMaterial({
      primaryDb: value.primaryDb,
      authoringDb: value.authoringDb,
      env: ENV,
      canonicalSymbol: "tp53",
    })
    assert.equal(material.canonical.prose, "The exact public canonical manifestation.")
    assert.equal(material.accepted_tags_derivative.tags_text, value.preparedTags.tags_text)
    assert.deepEqual(material.accepted_tags_derivative.fields_json, value.preparedTags.fields_json)
    assert.equal(material.canonical.body_sha256, value.proseEncrypted.body_sha256)
    assert.equal(material.accepted_tags_derivative.body_sha256, value.tagsEncrypted.body_sha256)
    assert.equal(storage.reads(), 2)
    assert.equal(JSON.stringify(material).includes("object_key"), false)
    assert.equal(JSON.stringify(material).includes("wrapped_dek"), false)
    assert.equal(JSON.stringify(material).includes("ciphertext"), false)
  } finally {
    storage.restore()
    closeFixture(value)
  }
})

test("public canonical material rejects primary/authoring drift before reading storage", async () => {
  const value = await fixture()
  const storage = installStorageFetch(value.objects)
  try {
    value.primaryRaw.exec("DROP TRIGGER icono_projection_epoch_guard_update")
    value.primaryRaw
      .prepare("UPDATE icono_manifestation_canonical_projection SET canonical_selection_id = ?")
      .run("selection_tampered")
    await assert.rejects(
      readPublicCanonicalMaterial({
        primaryDb: value.primaryDb,
        authoringDb: value.authoringDb,
        env: ENV,
        geneId: "gene_tp53",
      }),
      (error) =>
        error instanceof PublicCanonicalMaterialError &&
        error.code === "PUBLIC_CANONICAL_PROJECTION_DRIFT",
    )
    assert.equal(storage.reads(), 0)
  } finally {
    storage.restore()
    closeFixture(value)
  }
})

test("missing exact ciphertext fails closed and never falls back to legacy plaintext", async () => {
  const value = await fixture()
  value.objects.delete(value.proseObjectKey)
  const storage = installStorageFetch(value.objects)
  try {
    await assert.rejects(
      readPublicCanonicalMaterial({
        primaryDb: value.primaryDb,
        authoringDb: value.authoringDb,
        env: ENV,
        geneId: "gene_tp53",
      }),
      (error) =>
        error instanceof PublicCanonicalMaterialError &&
        error.code === "PUBLIC_CANONICAL_REVISION_BODY_UNAVAILABLE",
    )
    assert.equal(storage.reads(), 1)
  } finally {
    storage.restore()
    closeFixture(value)
  }
})

test("cutover item proof binds the exact projected body and Tags hashes", async () => {
  const value = await fixture({ mode: "shadow_frozen" })
  const storage = installStorageFetch(value.objects)
  try {
    const proof = await verifyPublicCanonicalMaterialItem({
      primaryDb: value.primaryDb,
      authoringDb: value.authoringDb,
      env: ENV,
      run: { cutover_run_id: "cutover_run_0001" },
      item: {
        cutover_run_id: "cutover_run_0001",
        gene_id: "gene_tp53",
        canonical_symbol: "TP53",
        source_kind: "manifestation",
        seed_manifestation_id: "manifestation_0001",
        seed_revision_id: "revision_0001",
        seed_selection_id: "selection_0001",
        seed_tags_derivative_id: "derivative_0001",
        source_body_sha256: value.proseEncrypted.body_sha256,
        source_body_bytes: value.proseEncrypted.body_bytes,
        source_tags_sha256: value.preparedTags.tags_sha256,
        source_tags_bytes: value.preparedTags.tags_bytes,
        source_fields_sha256: value.preparedTags.fields_sha256,
        source_fields_bytes: value.preparedTags.fields_bytes,
      },
    })
    assert.equal(proof.gene_id, "gene_tp53")
    assert.equal(proof.authority_event_sequence, 1)
    assert.match(proof.public_material_proof_sha256, /^[a-f0-9]{64}$/)
    assert.equal(storage.reads(), 2)
  } finally {
    storage.restore()
    closeFixture(value)
  }
})

test("run verification consumes durable per-item proofs without rereading 19k objects", async () => {
  const value = await fixture()
  value.authoringRaw.exec(`
    CREATE TABLE icono_manifestation_cutover_runs (
      cutover_run_id TEXT PRIMARY KEY,
      source_gene_count INTEGER NOT NULL,
      verified_items INTEGER NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE icono_manifestation_cutover_items (
      cutover_run_id TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      status TEXT NOT NULL,
      authority_event_sequence INTEGER,
      public_material_proof_sha256 TEXT,
      public_material_event_sequence INTEGER,
      public_material_verified_at TEXT
    );
    INSERT INTO icono_manifestation_cutover_runs
    VALUES ('cutover_run_0001', 1, 1, 'shadow_verified');
    INSERT INTO icono_manifestation_cutover_items
    VALUES (
      'cutover_run_0001', 'manifestation', 'verified', 1,
      '${"e".repeat(64)}', 1, '2026-08-30T00:00:00.000Z'
    );
  `)
  try {
    assert.deepEqual(
      await verifyPublicCanonicalMaterial({
        primaryDb: value.primaryDb,
        authoringDb: value.authoringDb,
        run: { cutover_run_id: "cutover_run_0001" },
      }),
      {
        ok: true,
        run_id: "cutover_run_0001",
        verified_gene_count: 1,
        snapshot_event_sequence: 1,
      },
    )
  } finally {
    closeFixture(value)
  }
})
