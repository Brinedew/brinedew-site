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
import { sha256Hex } from "./lib/iconoplasm-sha256.js"
import { iconoplasmDatabase } from "./test-helpers/account-erasure-fixture.js"
import { canonicalManifestationFieldsJson } from "./iconoplasm/caretaker/manifestation-tags-payload.js"
import { normalizeManifestationTags } from "./lib/iconoplasm-manifestation-tags.js"
import { writeFactoryGeneText } from "./iconoplasm/gene-text-write.js"

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

// B-1065: a generation request names the text it was drawn from, and the
// generator reads that exact text back from the plain tables of main migration
// 0125 (every migration loaded). Failure modes written before the code:
// 1. a request queued before the move to plain tables, whose IDs and hashes came
//    from the old authority, stops validating after the backfill;
// 2. a newer factory text silently replaces the one a queued request named;
// 3. a caretaker version that was withdrawn still feeds the generator;
// 4. a request whose hashes don't match the stored bytes is accepted;
// 5. a Tags request is made for a text without Tags, or a prose request needs
//    Tags it doesn't use.
function harness(t) {
  const db = iconoplasmDatabase()
  t.after(() => db.database.close())
  const env = { ICONOPLASM_DB: db }
  const run = (sql, ...args) => db.database.prepare(sql).run(...args)
  return { db, env, run }
}

async function rejects(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof IconoplasmGenerationSourceError, String(error))
    assert.equal(error.code, code)
    return true
  })
}

const ENCODER = new TextEncoder()
const FIELDS = { protein_class: "kinase", locations: ["nucleus"], note: "café" }

// What the retired caretaker authority (deleted in B-1065) computed when it
// accepted a Tags derivative: requests it queued still carry these hashes.
async function oldAuthorityTagsPayload(input = {}) {
  const normalized = normalizeManifestationTags(input.tagsText)
  const fieldsJson = canonicalManifestationFieldsJson(input.fieldsJson)
  const fieldsBytes = ENCODER.encode(fieldsJson)
  const tagsSha256 = await sha256Hex(normalized.bytes)
  const fieldsSha256 = await sha256Hex(fieldsBytes)
  assert.equal(input.tagsSha256, tagsSha256)
  assert.equal(input.fieldsSha256, fieldsSha256)
  const outputPlain = `${normalized.tags}\n${fieldsJson}`
  const outputBytes = ENCODER.encode(outputPlain)
  return Object.freeze({
    output_plain: outputPlain,
    output_bytes: outputBytes,
    output_plain_sha256: await sha256Hex(outputBytes),
    output_plain_bytes: outputBytes.byteLength,
    tags_text: normalized.tags,
    tags_sha256: tagsSha256,
    tags_bytes: normalized.bytes.byteLength,
    fields_json: JSON.parse(fieldsJson),
    fields_canonical_json: fieldsJson,
    fields_sha256: fieldsSha256,
    fields_bytes: fieldsBytes.byteLength,
  })
}

test("a request queued under the old authority validates against its backfilled text", async (t) => {
  const h = harness(t)
  // What the old authority hashed when it accepted these Tags.
  const tagsText = "guardian, watchful"
  const canonicalFields = canonicalManifestationFieldsJson(FIELDS)
  assert.notEqual(canonicalFields, JSON.stringify(FIELDS), "the fixture must exercise escaping")
  const old = await oldAuthorityTagsPayload({
    tagsText,
    fieldsJson: FIELDS,
    tagsSha256: await sha256Hex(ENCODER.encode(tagsText)),
    fieldsSha256: await sha256Hex(ENCODER.encode(canonicalFields)),
  })
  const prose = "A guardian of the genome.\nIt stands watch."
  const bodySha = await sha256Hex(ENCODER.encode(prose))
  // The backfill keeps the old revision ID as the text ID and the canonical bytes.
  h.run(
    `INSERT INTO icono_gene_texts
       (gene_symbol, gene_id, text_id, version, text, text_sha256, tags, fields_json)
     VALUES ('TP53', 'gene_tp53', 'revision_old_0001', 3, ?, ?, ?, ?)`,
    prose,
    bodySha,
    old.tags_text,
    old.fields_canonical_json,
  )
  const queued = {
    generation_provenance_status: "bound",
    source_gene_id: "gene_tp53",
    source_manifestation_id: "manifestation_old_0001",
    source_manifestation_revision_id: "revision_old_0001",
    source_manifestation_body_sha256: bodySha,
    source_manifestation_derivative_id: "derivative_old_0001",
    source_manifestation_derivative_sha256: old.output_plain_sha256,
    source_manifestation_derivative_tags_sha256: old.tags_sha256,
    source_manifestation_derivative_tags_bytes: old.tags_bytes,
    source_manifestation_derivative_fields_sha256: old.fields_sha256,
    source_manifestation_derivative_fields_bytes: old.fields_bytes,
    source_manifestation_derivative_recipe_id: "tagger-recipe",
    source_manifestation_derivative_recipe_version: "7",
    source_canonical_selection_id: "selection_old_0001",
    source_canonical_head_version: 2,
    source_gene_revision: 5,
    source_sample_label: "TP53-2",
    source_sample_number: 2,
    prompt_body_mode: "taggerizer_prompt",
  }
  queued.source_snapshot_sha256 = await iconoplasmGenerationFingerprint(
    "iconoplasm.generation-source.v1",
    queued,
  )

  const validated = await validateExactGenerationSource(h.env, queued)
  assert.equal(
    exactGenerationProvenanceValidationKey(validated),
    exactGenerationProvenanceValidationKey(queued),
    "callers compare the key they stored, so validation hands back the request's own fields",
  )
  const read = await readExactGenerationSource(h.env, queued)
  assert.equal(read.prose, prose)
  assert.equal(read.tags, tagsText)
  assert.deepEqual(read.tags_fields_json, FIELDS)
  assert.equal(read.source_sample_label, "TP53-2")

  // A source resolved today from the same row carries the same hashes.
  const fresh = await resolveCanonicalGenerationSource(h.env, { geneSymbol: "tp53" })
  assert.equal(fresh.source_manifestation_revision_id, "revision_old_0001")
  assert.equal(fresh.source_manifestation_derivative_sha256, old.output_plain_sha256)
  assert.equal(fresh.source_manifestation_derivative_fields_sha256, old.fields_sha256)
  assert.equal(fresh.source_manifestation_derivative_fields_bytes, old.fields_bytes)
  assert.equal(
    fresh.source_snapshot_sha256,
    requireExactGenerationProvenance(fresh).source_snapshot_sha256,
  )
  await validateExactGenerationSource(h.env, fresh)
})

test("a newer factory text retires queued requests, while a caretaker version stays pinned", async (t) => {
  const h = harness(t)
  const first = await writeFactoryGeneText(h.env, {
    symbol: "WEE1",
    text: "A gatekeeper at G2.",
    tags: "gatekeeper",
    fields: { phase: "G2" },
  })
  const factorySource = await resolveCanonicalGenerationSource(h.env, { geneSymbol: "WEE1" })
  assert.equal(factorySource.source_manifestation_revision_id, first.text_id)
  assert.equal(factorySource.source_manifestation_id, first.gene_id)
  assert.equal((await readExactGenerationSource(h.env, factorySource)).prose, "A gatekeeper at G2.")

  const caretakerText = "A caretaker's gatekeeper."
  h.run(
    `INSERT INTO icono_caretaker_text_versions
       (version_id, gene_symbol, line_id, version, account_id, caretaker_assignment_id,
        text, text_sha256, tags, fields_json)
     VALUES ('ct_version_0001', 'WEE1', 'line_0001', 1, 'account_1', 'assignment_1', ?, ?, 'sentinel', '{}')`,
    caretakerText,
    await sha256Hex(ENCODER.encode(caretakerText)),
  )
  h.run(
    "UPDATE icono_gene_texts SET chosen_caretaker_version_id = 'ct_version_0001' WHERE gene_symbol = 'WEE1'",
  )
  const caretakerSource = await resolveCanonicalGenerationSource(h.env, { geneSymbol: "WEE1" })
  assert.equal(caretakerSource.source_manifestation_revision_id, "ct_version_0001")
  assert.equal(caretakerSource.source_manifestation_id, "line_0001")
  const caretakerRead = await readExactGenerationSource(h.env, caretakerSource)
  assert.equal(caretakerRead.prose, caretakerText)
  assert.equal(caretakerRead.tags, "sentinel")
  assert.deepEqual(caretakerRead.tags_fields_json, {})

  // The factory overwrites its own row; the caretaker version is untouched.
  await writeFactoryGeneText(h.env, {
    symbol: "WEE1",
    text: "A stricter gatekeeper.",
    tags: "strict",
  })
  await rejects(
    validateExactGenerationSource(h.env, factorySource),
    "GENERATION_SOURCE_REVISION_INACTIVE",
  )
  assert.equal((await readExactGenerationSource(h.env, caretakerSource)).prose, caretakerText)

  h.run("UPDATE icono_caretaker_text_versions SET withdrawn_at = CURRENT_TIMESTAMP")
  await rejects(
    validateExactGenerationSource(h.env, caretakerSource),
    "GENERATION_SOURCE_REVISION_INACTIVE",
  )
  // With its choice withdrawn the gene falls back to the factory's newest text.
  const fallback = await resolveCanonicalGenerationSource(h.env, { geneSymbol: "WEE1" })
  assert.equal((await readExactGenerationSource(h.env, fallback)).prose, "A stricter gatekeeper.")
})

test("tampered hashes, unknown genes and missing Tags fail closed", async (t) => {
  const h = harness(t)
  await writeFactoryGeneText(h.env, { symbol: "MFNG", text: "A fringe modifier.", tags: "fringe" })
  const source = await resolveCanonicalGenerationSource(h.env, { geneSymbol: "MFNG" })
  assert.equal(source.source_manifestation_derivative_fields_bytes, 2, "no fields read as {}")

  for (const field of [
    "source_manifestation_body_sha256",
    "source_manifestation_derivative_sha256",
    "source_manifestation_derivative_tags_sha256",
    "source_manifestation_derivative_fields_sha256",
  ]) {
    await rejects(
      validateExactGenerationSource(h.env, { ...source, [field]: "0".repeat(64) }),
      "GENERATION_SOURCE_SNAPSHOT_MISMATCH",
    )
  }
  await rejects(
    validateExactGenerationSource(h.env, {
      ...source,
      source_manifestation_derivative_tags_bytes:
        source.source_manifestation_derivative_tags_bytes + 1,
    }),
    "GENERATION_SOURCE_SNAPSHOT_MISMATCH",
  )
  await rejects(
    validateExactGenerationSource(h.env, { ...source, source_gene_id: "gene_nobody" }),
    "GENERATION_SOURCE_REVISION_INACTIVE",
  )
  await rejects(
    resolveCanonicalGenerationSource(h.env, { geneSymbol: "NOTAGENE" }),
    "CANONICAL_GENERATION_SOURCE_NOT_FOUND",
  )
  await rejects(validateExactGenerationSource({}, source), "TEXT_DATABASE_UNAVAILABLE")

  // A text saved without Tags serves prose prompts and refuses Tags prompts.
  await writeFactoryGeneText(h.env, { symbol: "WDR87", text: "A quiet repeat protein." })
  await rejects(
    resolveCanonicalGenerationSource(h.env, { geneSymbol: "WDR87" }),
    "GENERATION_SOURCE_DERIVATIVE_UNAVAILABLE",
  )
  const prose = await resolveCanonicalGenerationSource(h.env, {
    geneSymbol: "WDR87",
    promptBodyMode: "prose_prompt",
  })
  assert.equal(prose.source_manifestation_derivative_sha256, "")
  const proseRead = await readExactGenerationSource(h.env, prose)
  assert.equal(proseRead.prose, "A quiet repeat protein.")
  assert.equal(proseRead.tags, "")
  assert.equal(proseRead.tags_fields_json, null)
})

test("the primary migration leaves history unbound and accepts an exact receipt", async () => {
  const database = new DatabaseSync(":memory:")
  try {
    database.exec(`
      CREATE TABLE icono_generation_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        gene_symbol TEXT NOT NULL,
        prompt_body_mode TEXT NOT NULL DEFAULT 'taggerizer_prompt',
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
    database.exec(
      readFileSync(
        new URL(
          "../migrations-iconoplasm/0093_imported_generation_source_history.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    )
    const exact = {
      generation_provenance_status: "bound",
      generation_request_id: "request_imported_0001",
      generation_attempt_id: "attempt_imported_0001",
      gene_symbol: "TP53",
      asset_sha256: "f".repeat(64),
      source_gene_id: "gene_tp53",
      source_manifestation_id: "manifestation_0001",
      source_manifestation_revision_id: "revision_0001",
      source_manifestation_body_sha256: "b".repeat(64),
      source_manifestation_derivative_id: "derivative_imported",
      source_manifestation_derivative_sha256: "c".repeat(64),
      source_manifestation_derivative_tags_sha256: "d".repeat(64),
      source_manifestation_derivative_tags_bytes: 20,
      source_manifestation_derivative_fields_sha256: "e".repeat(64),
      source_manifestation_derivative_fields_bytes: 2,
      source_canonical_selection_id: "selection_0001",
      source_canonical_head_version: 1,
      source_gene_revision: 1,
      source_snapshot_sha256: "a".repeat(64),
      generation_request_contract_sha256: "a".repeat(64),
      generation_config_sha256: "a".repeat(64),
      provider_id: "actual-renderer",
      provider_model_id: "actual-model",
      model_id: "actual-model",
      generation_provider_id: "actual-renderer",
      generation_model_id: "actual-model",
      generation_prompt_sha256: "a".repeat(64),
      prompt_sha256: "a".repeat(64),
      id: "imported_job",
      user_id: "account_1",
    }
    for (const table of [
      "icono_generation_requests",
      "icono_candidate_generation_jobs",
      "icono_portrait_assets",
      "icono_portrait_generation_provenance",
    ]) {
      const columns = new Set(
        database
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .map((row) => row.name),
      )
      const values = Object.fromEntries(
        Object.entries(exact).filter(
          ([name]) =>
            columns.has(name) && !(table === "icono_generation_requests" && name === "id"),
        ),
      )
      const insert = (patch) => {
        const row = { ...values, ...patch }
        database
          .prepare(
            `INSERT INTO ${table} (${Object.keys(row).join(",")}) VALUES (${Object.keys(row)
              .map(() => "?")
              .join(",")})`,
          )
          .run(...Object.values(row))
      }
      // Test the storage boundary itself, including malformed input and invented partial history.
      assert.throws(
        () => insert({ source_manifestation_derivative_tags_sha256: "" }),
        /provenance_incomplete/,
      )
      assert.throws(
        () => insert({ source_manifestation_derivative_model_id: "guessed" }),
        /provenance_incomplete/,
      )
      insert({})
      if (table !== "icono_portrait_generation_provenance") {
        assert.doesNotThrow(() =>
          database
            .prepare(
              `UPDATE ${table} SET generation_config_sha256 = generation_config_sha256 WHERE generation_request_id = ?`,
            )
            .run(exact.generation_request_id),
        )
        assert.throws(
          () =>
            database
              .prepare(
                `UPDATE ${table} SET source_manifestation_derivative_tags_sha256 = '' WHERE generation_request_id = ?`,
              )
              .run(exact.generation_request_id),
          /provenance_incomplete|identity_is_immutable/,
        )
      }
      assert.equal(
        database
          .prepare(
            `SELECT source_manifestation_derivative_model_id FROM ${table} WHERE generation_request_id = ?`,
          )
          .get(exact.generation_request_id).source_manifestation_derivative_model_id,
        "",
      )
    }
  } finally {
    database.close()
  }
})
