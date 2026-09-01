import assert from "node:assert/strict"
import test from "node:test"

import {
  IconoplasmPublicCanonicalRuntimeError,
  PUBLIC_CANONICAL_MATERIALIZATION_BATCH_LIMIT,
  hydratePublicCanonicalGeneRecord,
  hydratePublicCanonicalGeneRecords,
} from "./iconoplasm-public-canonical-runtime.js"

function database(mode) {
  return {
    prepare() {
      return {
        async first() {
          return { mode }
        },
      }
    },
  }
}

function material(symbol = "TP53") {
  return {
    schema_version: 1,
    gene_id: `gene_${symbol.toLowerCase()}`,
    canonical_symbol: symbol,
    head_version: 2,
    gene_revision: 4,
    authority_event_id: `event_${symbol.toLowerCase()}`,
    authority_event_sequence: 41,
    canonical: {
      manifestation_id: `manifestation_${symbol.toLowerCase()}`,
      manifestation_revision_id: `revision_${symbol.toLowerCase()}`,
      canonical_selection_id: `selection_${symbol.toLowerCase()}`,
      body_sha256: "a".repeat(64),
      body_bytes: 36,
      public_page_visible: true,
      prose: `${symbol} exact canonical prose`,
    },
    accepted_tags_derivative: {
      manifestation_derivative_id: `derivative_${symbol.toLowerCase()}`,
      derivative_head_version: 1,
      body_sha256: "b".repeat(64),
      body_bytes: 24,
      tags_sha256: "c".repeat(64),
      tags_bytes: 10,
      fields_sha256: "d".repeat(64),
      fields_bytes: 13,
      recipe_id: "tagger",
      recipe_version: "1",
      provider_id: "provider",
      model_id: "model",
      tagger_config_sha256: "e".repeat(64),
      provenance_status: "generated",
      tags_text: "exact tags",
      fields_json: { state: "exact" },
    },
  }
}

test("legacy publication remains unchanged before authority cutover", async () => {
  const records = Array.from(
    { length: PUBLIC_CANONICAL_MATERIALIZATION_BATCH_LIMIT + 1 },
    (_, index) => ({ symbol: `G${String(index).padStart(4, "0")}` }),
  )
  let reads = 0
  const output = await hydratePublicCanonicalGeneRecords(
    { ICONOPLASM_DB: database("legacy_write") },
    records,
    {
      readMaterial: async () => {
        reads += 1
        return material()
      },
    },
  )
  assert.equal(output, records)
  assert.equal(reads, 0)
})

test("authoritative publication carries exact public body identity and compound Tags", async () => {
  const output = await hydratePublicCanonicalGeneRecord(
    {
      ICONOPLASM_DB: database("authoritative"),
      ICONOPLASM_AUTHORING_DB: {},
    },
    { symbol: "TP53", full_name: "tumor protein p53" },
    { readMaterial: async () => material() },
  )
  assert.equal(output.canonical_manifestation.prose, "TP53 exact canonical prose")
  assert.equal(output.canonical_manifestation.accepted_tags_derivative.tags_text, "exact tags")
  assert.equal(output.canonical_manifestation.manifestation_revision_id, "revision_tp53")
  assert.equal(output.canonical_manifestation.body_sha256, "a".repeat(64))
})

test("hidden canonical manifestations expose no prose to the public gene payload", async () => {
  const hidden = material()
  hidden.canonical.public_page_visible = false
  const output = await hydratePublicCanonicalGeneRecord(
    {
      ICONOPLASM_DB: database("authoritative"),
      ICONOPLASM_AUTHORING_DB: {},
    },
    { symbol: "TP53" },
    { readMaterial: async () => hidden },
  )
  assert.equal(output.canonical_manifestation.public_page_visible, false)
  assert.equal(output.canonical_manifestation.prose, null)
})

test("shadow-frozen publication pauses instead of exposing shadow material", async () => {
  await assert.rejects(
    hydratePublicCanonicalGeneRecord(
      { ICONOPLASM_DB: database("shadow_frozen"), ICONOPLASM_AUTHORING_DB: {} },
      { symbol: "TP53" },
      { readMaterial: async () => material() },
    ),
    (error) =>
      error instanceof IconoplasmPublicCanonicalRuntimeError &&
      error.code === "PUBLIC_CANONICAL_CUTOVER_NOT_ACTIVE",
  )
})

test("authoritative mode never falls back when the authoring binding is missing", async () => {
  await assert.rejects(
    hydratePublicCanonicalGeneRecord(
      { ICONOPLASM_DB: database("authoritative") },
      { symbol: "TP53", manifestation: "legacy must not leak" },
    ),
    (error) =>
      error instanceof IconoplasmPublicCanonicalRuntimeError &&
      error.code === "PUBLIC_CANONICAL_AUTHORING_DB_REQUIRED",
  )
})

test("missing or unknown authority state fails closed without exposing legacy material", async () => {
  let reads = 0
  const missingState = {
    prepare() {
      return {
        async first() {
          return null
        },
      }
    },
  }
  for (const primaryDb of [missingState, database("unexpected_mode")]) {
    await assert.rejects(
      hydratePublicCanonicalGeneRecord(
        { ICONOPLASM_DB: primaryDb, ICONOPLASM_AUTHORING_DB: {} },
        { symbol: "TP53", manifestation: "legacy must not leak" },
        {
          readMaterial: async () => {
            reads += 1
            return material()
          },
        },
      ),
      (error) =>
        error instanceof IconoplasmPublicCanonicalRuntimeError &&
        new Set([
          "PUBLIC_CANONICAL_AUTHORITY_STATE_MISSING",
          "PUBLIC_CANONICAL_AUTHORITY_MODE_INVALID",
        ]).has(error.code),
    )
  }
  assert.equal(reads, 0)
})

test("material hydration admits only one durable card-publication batch", async () => {
  const records = Array.from(
    { length: PUBLIC_CANONICAL_MATERIALIZATION_BATCH_LIMIT + 1 },
    (_, index) => ({ symbol: `G${String(index).padStart(4, "0")}` }),
  )
  let reads = 0
  await assert.rejects(
    hydratePublicCanonicalGeneRecords(
      { ICONOPLASM_DB: database("authoritative"), ICONOPLASM_AUTHORING_DB: {} },
      records,
      {
        readMaterial: async () => {
          reads += 1
          return material()
        },
      },
    ),
    (error) =>
      error instanceof IconoplasmPublicCanonicalRuntimeError &&
      error.code === "PUBLIC_CANONICAL_BATCH_TOO_LARGE",
  )
  assert.equal(reads, 0)
})
