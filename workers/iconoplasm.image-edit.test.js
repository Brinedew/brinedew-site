import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import test from "node:test"

import { handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import { plainBodyObject } from "./lib/iconoplasm-body-object-test-support.js"
import { sha256Hex } from "./lib/iconoplasm-sha256.js"
import { prepareManifestationTagsPayload } from "./iconoplasm/caretaker/manifestation-tags-payload.js"
import { TEST_SESSION_SECRET, sessionCookieFor } from "./test-helpers/sealed-session-cookie.js"

const SOURCE_SHA = "a".repeat(64)
const EDITED_BYTES = new TextEncoder().encode("edited-webp-bytes")

function base64(bytes) {
  return Buffer.from(bytes).toString("base64")
}

// Bodies are stored as plain text (B-859), so the Worker under test has no key.
async function plainStored(text) {
  const body = await plainBodyObject(text)
  return { ...body, prose: body.text, ciphertext: body.bytes }
}

function defaultGeneContext() {
  return {
    gene_symbol: "A1BG",
    full_name: "Alpha-1-B Glycoprotein",
    manifestation: "A1BG appears as a calm archivist with pearl varnish and measured posture.",
    manifestation_tags: "calm_archivist, pearl_varnish, measured_posture",
    sample_label: "A1BG-7",
    sample_number: 7,
    sample_text_hash: "d".repeat(64),
  }
}

class FakeAuthoringStatement {
  constructor(authority, sql) {
    this.authority = authority
    this.sql = String(sql || "")
    this.args = []
  }

  bind(...args) {
    this.args = args
    return this
  }

  async first() {
    const row = await this.authority.row()
    if (this.sql.includes("WHERE g.canonical_symbol")) {
      return String(this.args[0] || "").toUpperCase() === row.canonical_symbol ? row : null
    }
    return row
  }
}

class FakeAuthoringDb {
  constructor(sourceDb, objects) {
    this.sourceDb = sourceDb
    this.objects = objects
    this.cachedRow = null
  }

  prepare(sql) {
    return new FakeAuthoringStatement(this, sql)
  }

  async row() {
    if (this.cachedRow) return this.cachedRow
    const context = this.sourceDb.geneContext || defaultGeneContext()
    const symbol = String(context.gene_symbol || "A1BG").toUpperCase()
    const geneId = `gene_${symbol.toLowerCase()}_0001`
    const manifestationId = `manifestation_${symbol.toLowerCase()}_0001`
    const revisionId = `revision_${symbol.toLowerCase()}_0001`
    const derivativeId = `derivative_${symbol.toLowerCase()}_0001`
    const revision = await plainStored(context.manifestation || "A manifestation body.")
    const tags = String(context.manifestation_tags || "")
    const preparedTags = tags
      ? await prepareManifestationTagsPayload({
          tagsText: tags,
          fieldsJson: {},
          tagsSha256: await sha256Hex(tags),
          fieldsSha256: await sha256Hex("{}"),
        })
      : null
    const derivative = tags ? await plainStored(preparedTags.output_plain) : null
    const revisionObjectKey =
      "private/manifestations/v1/aa/mbody_11111111111111111111111111111111.bin"
    const derivativeObjectKey =
      "private/manifestations/v1/bb/mbody_22222222222222222222222222222222.bin"
    this.objects.set(revisionObjectKey, revision.ciphertext)
    if (derivative) this.objects.set(derivativeObjectKey, derivative.ciphertext)
    this.cachedRow = {
      canonical_symbol: symbol,
      gene_id: geneId,
      gene_status: "active",
      manifestation_id: manifestationId,
      manifestation_status: "active",
      manifestation_revision_id: revisionId,
      body_sha256: revision.body_sha256,
      body_bytes: revision.body_bytes,
      sample_label: String(context.sample_label || ""),
      sample_number:
        context.sample_number == null ? null : Math.max(0, Number(context.sample_number || 0) || 0),
      sample_text_sha256: String(context.sample_text_hash || ""),
      revision_status: "active",
      revision_object_key: revisionObjectKey,
      revision_ciphertext_sha256: revision.ciphertext_sha256,
      revision_ciphertext_bytes: revision.ciphertext_bytes,
      revision_body_iv_base64: revision.body_iv_base64,
      revision_wrapped_dek_base64: revision.wrapped_dek_base64,
      revision_wrap_iv_base64: revision.wrap_iv_base64,
      revision_key_version: revision.key_version,
      revision_aad_version: revision.aad_version,
      revision_verified_at: "2026-08-30 00:00:00",
      canonical_selection_id: `selection_${symbol.toLowerCase()}_0001`,
      selected_manifestation_id: manifestationId,
      selected_revision_id: revisionId,
      selection_head_version: 1,
      selection_gene_revision: 1,
      manifestation_derivative_id: derivative ? derivativeId : null,
      derivative_status: derivative ? "complete" : null,
      derivative_source_body_sha256: derivative ? revision.body_sha256 : null,
      derivative_body_sha256: derivative?.body_sha256 || null,
      derivative_body_bytes: derivative?.body_bytes || null,
      derivative_tags_sha256: preparedTags?.tags_sha256 || null,
      derivative_tags_bytes: preparedTags?.tags_bytes || null,
      derivative_fields_sha256: preparedTags?.fields_sha256 || null,
      derivative_fields_bytes: preparedTags?.fields_bytes || null,
      derivative_recipe_id: derivative ? "taggerizer" : null,
      derivative_recipe_version: derivative ? "1" : null,
      derivative_provider_id: derivative ? "test-provider" : null,
      derivative_model_id: derivative ? "test-tagger" : null,
      derivative_tagger_config_sha256: derivative ? "e".repeat(64) : null,
      derivative_provenance_status: derivative ? "generated" : null,
      derivative_object_key: derivative ? derivativeObjectKey : null,
      derivative_ciphertext_sha256: derivative?.ciphertext_sha256 || null,
      derivative_ciphertext_bytes: derivative?.ciphertext_bytes || null,
      derivative_body_iv_base64: derivative?.body_iv_base64 || null,
      derivative_wrapped_dek_base64: derivative?.wrapped_dek_base64 || null,
      derivative_wrap_iv_base64: derivative?.wrap_iv_base64 || null,
      derivative_key_version: derivative?.key_version || null,
      derivative_aad_version: derivative?.aad_version || null,
      derivative_verified_at: derivative ? "2026-08-30 00:00:00" : null,
    }
    return this.cachedRow
  }
}

function authoringStorageResponse(env, input, init = {}) {
  const url = new URL(String(input))
  if (url.hostname !== "storage.test.invalid") return null
  assert.equal(init.method, "GET")
  const pathParts = url.pathname.split("/").filter(Boolean)
  assert.equal(pathParts.shift(), "authoring-test-zone")
  const bytes = env.__authoringObjects.get(pathParts.join("/"))
  return bytes ? new Response(bytes, { status: 200 }) : new Response(null, { status: 404 })
}

class FakeStatement {
  constructor(db, sql) {
    this.db = db
    this.sql = String(sql || "")
    this.args = []
  }

  bind(...args) {
    this.args = args
    return this
  }

  async first() {
    if (this.sql.includes("FROM users") && this.sql.includes("discord_id = ?")) {
      return this.db.users.get(this.args[0]) || null
    }
    if (
      this.sql.includes("FROM icono_user_image_provider_keys") &&
      this.sql.includes("provider_id = ?")
    ) {
      const key = `${this.args[0]}|${this.args[1]}`
      return this.db.providerRows.get(key) || null
    }
    if (
      this.sql.includes("FROM icono_portrait_assets pa") &&
      this.sql.includes("pa.asset_sha256 = ?")
    ) {
      return {
        gene_symbol: "A1BG",
        asset_sha256: SOURCE_SHA,
        r2_key_full: `portraits/v1/aa/${SOURCE_SHA}/full.webp`,
        r2_key_medium: `portraits/v1/aa/${SOURCE_SHA}/medium.webp`,
        r2_key_thumb: `portraits/v1/aa/${SOURCE_SHA}/thumb.webp`,
        mime: "image/webp",
        width: 1024,
        height: 1280,
        bytes: 4096,
        status: "approved",
        vision_id: "anima-v1-3001",
        emulsion_id: "A1-93-19",
        workflow_id: "A1",
        workflow_label: "Anima v1",
        workflow_path: "workflows/anima-v1.json",
        prompt_version: "93",
        variant_slot: "19",
        candidate_image_id: 123,
        sample_label: "A1BG-7",
        sample_number: 7,
        sample_text_hash: "d".repeat(64),
        image_upvotes: this.db.sourceUpvotes ?? 7,
        image_downvotes: 1,
        image_score: 6,
      }
    }
    if (this.sql.includes("FROM icono_image_edit_jobs") && this.sql.includes("WHERE id = ?")) {
      const row = this.db.jobs.get(this.args[0]) || null
      if (row && this.sql.includes("user_id = ?") && row.user_id !== this.args[1]) return null
      return row
    }
    if (
      this.sql.includes("FROM icono_candidate_generation_jobs") &&
      this.sql.includes("WHERE id = ?")
    ) {
      const row = this.db.candidateGenerationJobs.get(this.args[0]) || null
      if (row && this.sql.includes("user_id = ?") && row.user_id !== this.args[1]) return null
      return row
    }
    if (this.sql.includes("FROM icono_gene_catalog gc")) {
      return this.db.geneContext || defaultGeneContext()
    }
    return null
  }

  async all() {
    if (this.sql.includes("FROM icono_user_image_provider_keys")) {
      const userId = this.args[0]
      return {
        results: Array.from(this.db.providerRows.values()).filter((row) => row.user_id === userId),
      }
    }
    if (this.sql.includes("FROM icono_image_edit_prompt_templates")) {
      return {
        results: Array.from(this.db.promptTemplates.values()).sort((a, b) =>
          String(a.kind).localeCompare(String(b.kind)),
        ),
      }
    }
    if (this.sql.includes("FROM icono_gene_comments") && this.sql.includes("status = 'visible'")) {
      const symbol = String(this.args[0] || "")
      const limit = Number(this.args[1] || 50) || 50
      const results = this.db.geneComments
        .filter(
          (row) =>
            String(row.gene_symbol || "") === symbol && String(row.status || "") === "visible",
        )
        .sort(
          (a, b) =>
            String(b.created_at || "").localeCompare(String(a.created_at || "")) ||
            Number(b.id || 0) - Number(a.id || 0),
        )
        .slice(0, limit)
        .map((row) => ({
          id: row.id,
          user_id: row.user_id,
          username: row.username,
          avatar_url: row.avatar_url,
          body: row.body,
          status: row.status,
          created_at: row.created_at,
          updated_at: row.updated_at,
        }))
      return { results }
    }
    return { results: [] }
  }

  async run() {
    if (this.sql.includes("INSERT INTO icono_user_image_provider_keys")) {
      const row = {
        user_id: this.args[0],
        provider_id: this.args[1],
        encrypted_api_key: this.args[2],
        encryption_iv: this.args[3],
        key_fingerprint: this.args[4],
        endpoint_url: this.args[5],
        model: this.args[6],
      }
      this.db.providerRows.set(`${row.user_id}|${row.provider_id}`, row)
      return { meta: { changes: 1 } }
    }
    if (this.sql.includes("INSERT INTO icono_image_edit_jobs")) {
      const row = {
        id: this.args[0],
        user_id: this.args[1],
        provider_id: this.args[2],
        source_gene_symbol: this.args[3],
        source_asset_sha256: this.args[4],
        source_candidate_image_id: this.args[5],
        source_vision_id: this.args[6],
        source_upvotes: this.args[7],
        source_downvotes: this.args[8],
        source_score: this.args[9],
        adjustments_json: this.args[10],
        prompt: this.args[11],
        status: this.args[12],
        inherited_upvotes: this.args[13],
        created_at: "2026-05-16T00:00:00.000Z",
        updated_at: "2026-05-16T00:00:00.000Z",
      }
      this.db.jobs.set(row.id, row)
      return { meta: { changes: 1 } }
    }
    if (
      this.sql.includes("UPDATE icono_image_edit_jobs") &&
      this.sql.includes("status = 'succeeded'")
    ) {
      const row = this.db.jobs.get(this.args[8])
      Object.assign(row, {
        status: "succeeded",
        result_asset_sha256: this.args[0],
        result_r2_key_full: this.args[1],
        result_r2_key_medium: this.args[2],
        result_r2_key_thumb: this.args[3],
        result_mime: this.args[4],
        result_width: this.args[5],
        result_height: this.args[6],
        result_bytes: this.args[7],
        completed_at: "2026-05-16T00:00:01.000Z",
      })
      return { meta: { changes: 1 } }
    }
    if (this.sql.includes("INSERT INTO icono_candidate_generation_jobs")) {
      const row = {
        id: this.args[0],
        user_id: this.args[1],
        provider_id: this.args[2],
        gene_symbol: this.args[3],
        request_mode: this.args[4],
        requested_vision_id: this.args[5],
        requested_emulsion_id: this.args[6],
        requested_emulsion_label: this.args[7],
        requested_emulsion_slot: this.args[8],
        gene_full_name: this.args[9],
        manifestation: this.args[10],
        sample_label: this.args[11],
        sample_number: this.args[12],
        sample_text_hash: this.args[13],
        reference_assets_json: this.args[14],
        prompt_body_mode: this.args[15],
        community_comments_snapshot: this.args[16],
        prompt: this.args[17],
        factory_pipeline_code: this.args[18],
        factory_vision_revision: this.args[19],
        generation_provenance_status: "bound",
        generation_request_id: this.args[20],
        generation_attempt_id: this.args[21],
        source_gene_id: this.args[22],
        source_manifestation_id: this.args[23],
        source_manifestation_revision_id: this.args[24],
        source_manifestation_body_sha256: this.args[25],
        source_manifestation_derivative_id: this.args[26],
        source_manifestation_derivative_sha256: this.args[27],
        source_manifestation_derivative_tags_sha256: this.args[28],
        source_manifestation_derivative_tags_bytes: this.args[29],
        source_manifestation_derivative_fields_sha256: this.args[30],
        source_manifestation_derivative_fields_bytes: this.args[31],
        source_manifestation_derivative_recipe_id: this.args[32],
        source_manifestation_derivative_recipe_version: this.args[33],
        source_manifestation_derivative_provider_id: this.args[34],
        source_manifestation_derivative_model_id: this.args[35],
        source_manifestation_derivative_tagger_config_sha256: this.args[36],
        source_canonical_selection_id: this.args[37],
        source_canonical_head_version: this.args[38],
        source_gene_revision: this.args[39],
        source_sample_label: this.args[40],
        source_sample_number: this.args[41],
        source_sample_text_sha256: this.args[42],
        source_snapshot_sha256: this.args[43],
        generation_request_contract_sha256: this.args[44],
        provider_model_id: this.args[45],
        prompt_sha256: this.args[46],
        generation_config_sha256: this.args[47],
        status: this.args[48],
        created_at: "2026-05-16T00:00:00.000Z",
        updated_at: "2026-05-16T00:00:00.000Z",
      }
      const existing = Array.from(this.db.candidateGenerationJobs.values()).find(
        (candidate) =>
          candidate.user_id === row.user_id &&
          candidate.generation_request_id === row.generation_request_id,
      )
      if (existing) return { meta: { changes: 0 } }
      this.db.candidateGenerationJobs.set(row.id, row)
      return { meta: { changes: 1 } }
    }
    if (
      this.sql.includes("UPDATE icono_candidate_generation_jobs") &&
      this.sql.includes("status = 'succeeded'")
    ) {
      const row = this.db.candidateGenerationJobs.get(this.args[8])
      Object.assign(row, {
        status: "succeeded",
        result_asset_sha256: this.args[0],
        result_r2_key_full: this.args[1],
        result_r2_key_medium: this.args[2],
        result_r2_key_thumb: this.args[3],
        result_mime: this.args[4],
        result_width: this.args[5],
        result_height: this.args[6],
        result_bytes: this.args[7],
        completed_at: "2026-05-16T00:00:01.000Z",
      })
      return { meta: { changes: 1 } }
    }
    return { meta: { changes: 0 } }
  }
}

class FakeDb {
  constructor() {
    this.providerRows = new Map()
    this.promptTemplates = new Map()
    this.jobs = new Map()
    this.candidateGenerationJobs = new Map()
    this.generationReceipts = new Map()
    this.users = new Map([
      [
        "user-1",
        {
          discord_id: "user-1",
          username: "tester",
          iconoplasm_emulsion_text: "",
          iconoplasm_emulsion_revision: 0,
          iconoplasm_emulsion_public_id: "TESTER-0",
        },
      ],
    ])
    this.userEmulsionVersions = new Map()
    this.voteProjectionRows = []
    this.voteEvents = []
    this.publishEvents = []
    this.geneContext = null
    this.geneComments = []
    this.geneCommentsLastId = 0
  }

  prepare(sql) {
    return new FakeStatement(this, sql)
  }

  async batch(statements) {
    const results = []
    for (const statement of statements)
      results.push(
        /^\s*SELECT\b/i.test(statement.sql) ? await statement.all() : await statement.run(),
      )
    return results
  }
}

function buildPortraitStorage() {
  return {
    puts: [],
    deletes: [],
    async get(key) {
      return {
        body: new Response(`source:${key}`).body,
        httpMetadata: { contentType: "image/webp" },
        httpEtag: "source-etag",
      }
    },
    async put(key, bytes, options) {
      this.puts.push({
        key,
        bytes: new Uint8Array(bytes),
        contentType: options?.httpMetadata?.contentType || "",
      })
      return { ok: true }
    },
    async delete(key) {
      this.deletes.push(key)
      return { ok: true }
    },
  }
}

// The signed-in browser every request in this file sends (B-1069: a real sealed session cookie).
const SIGNED_IN = await sessionCookieFor({ user_id: "user-1", username: "tester" })

function buildEnv(db = new FakeDb()) {
  const authoringObjects = new Map()
  const env = {
    DB: db,
    ICONOPLASM_DB: db,
    ICONOPLASM_AUTHORING_DB: new FakeAuthoringDb(db, authoringObjects),
    ICONOPLASM_AUTHORING_STORAGE_HOST: "storage.test.invalid",
    ICONOPLASM_AUTHORING_STORAGE_ZONE: "authoring-test-zone",
    ICONOPLASM_AUTHORING_STORAGE_PASSWORD: "authoring-test-password",
    ICONOPLASM_AUTHORING_STORAGE_TIMEOUT_MS: "500",
    __authoringObjects: authoringObjects,
    ICONOPLASM_PORTRAITS: buildPortraitStorage(),
    KV: {
      async get() {
        return null
      },
      async put() {},
      async delete() {},
    },
    SESSION_SECRET: TEST_SESSION_SECRET,
    ICONOPLASM_IMAGE_EDIT_KEY_SECRET: "test-secret-with-more-than-32-bytes-for-aes",
    // Provider polling defaults to 10s initial wait + 10s interval.
    // Tests override to 0 so polling doesn't block the test suite.
    ICONOPLASM_PROVIDER_POLL_INTERVAL_MS: "0",
  }
  return env
}

// Captures every promise handed to ctx.waitUntil so tests can await them.
// Used by routes that have legitimate background work (vote projection,
// comment mirror, etc.). The Krea image-edit and candidate-generation
// routes are now synchronous and do not need this.
function capturingContext() {
  const tasks = []
  return {
    tasks,
    waitUntil(promise) {
      tasks.push(Promise.resolve(promise))
    },
    async drain() {
      while (tasks.length) {
        const task = tasks.shift()
        try {
          await task
        } catch {
          // The finalize function catches its own errors and writes them to
          // the job row. Tests should re-read the job to see the failure.
        }
      }
    },
  }
}

// Convenience helper for Krea image-edit jobs. Krea is now synchronous:
// the POST returns 200 with the job (or 502 with an error). For tests
// that want to assert the failure path, the helper returns the failure
// response as-is.
async function createKreaImageEditJobAndAwait({ env, ctx, body, cookie = SIGNED_IN }) {
  const create =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/image-edit/jobs",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: cookie },
          body: JSON.stringify(body),
        },
      ),
      env,
      ctx,
    )
  const created = await create.json()
  return { create, created }
}

test("last-used model is remembered without reordering the providers list, but only on change", async () => {
  const originalFetch = globalThis.fetch
  const db = new FakeDb()
  // Track every KV put to the last-used key. A user who submits 10 successful
  // edits with the same model should produce exactly 1 KV write.
  const kvPuts = []
  const env = buildEnv(db)
  const lastUsedStore = new Map()
  // Pretend the user previously used Krea flux-1-kontext-dev.
  lastUsedStore.set(
    "iconoplasm:image-edit-last-used:image_edit:user-1",
    "krea:google/nano-banana-pro",
  )
  env.KV = {
    async get(k) {
      if (lastUsedStore.has(k)) return lastUsedStore.get(k)
      return null
    },
    async put(k, v, opts) {
      kvPuts.push({ k, v, opts })
      lastUsedStore.set(k, v)
    },
    async delete() {},
  }
  let kreaCalls = 0
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    if (url === "https://api.krea.ai/assets") {
      return new Response(
        JSON.stringify({
          id: "krea-asset-last-used",
          image_url: "https://krea.example/uploaded/last-used-source.png",
          width: 1024,
          height: 1024,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }
    if (
      url === "https://api.krea.ai/generate/image/google/nano-banana-pro" ||
      url === "https://api.krea.ai/generate/image/google/nano-banana-2"
    ) {
      kreaCalls += 1
      return new Response(JSON.stringify({ job_id: "job-" + kreaCalls, status: "queued" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }
    if (url.startsWith("https://api.krea.ai/jobs/job-")) {
      return new Response(
        JSON.stringify({
          job_id: url.split("/").pop(),
          status: "completed",
          result: { urls: ["https://krea.example/x.png"] },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }
    if (url === "https://krea.example/x.png") {
      return new Response("png", { status: 200, headers: { "Content-Type": "image/png" } })
    }
    if (init?.cf?.image?.format === "webp" && !init?.cf?.image?.width) {
      return new Response(EDITED_BYTES, {
        status: 200,
        headers: { "Content-Type": "image/webp" },
      })
    }
    if (init?.cf?.image?.width === 512) return new Response("medium-webp-bytes", { status: 200 })
    if (init?.cf?.image?.width === 256) return new Response("thumb-webp-bytes", { status: 200 })
    throw new Error(`Unexpected fetch ${url}`)
  }

  try {
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/image-edit/providers",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: SIGNED_IN },
          body: JSON.stringify({
            provider_id: "krea",
            api_key: "krea-test-secret",
            model: "google/nano-banana-pro",
          }),
        },
      ),
      env,
      { waitUntil() {} },
    )

    // The providers list keeps stable model order and only marks last_used.
    const listResponse =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(
          "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/image-edit/providers?op=image_edit",
          { headers: { Cookie: SIGNED_IN } },
        ),
        env,
        { waitUntil() {} },
      )
    const listed = await listResponse.json()
    const krea = listed.supported_providers.find((p) => p.provider_id === "krea")
    const lastUsedOption = krea.model_options.find((m) => m.last_used === true)
    assert.equal(lastUsedOption?.model, "google/nano-banana-pro")
    assert.deepEqual(listed.last_used, {
      provider_id: "krea",
      model: "google/nano-banana-pro",
    })
    // Order stays catalog order: Nano Banana Pro is first by definition, and
    // Nano Banana 2 remains after it. last_used is only a flag, not a reshuffle.
    const liveOrder = krea.model_options.map((m) => m.model)
    assert.equal(liveOrder[0], "google/nano-banana-pro")
    assert.ok(liveOrder.indexOf("google/nano-banana-2") > 0)
    assert.equal(
      krea.model_options.filter((m) => m.last_used === true).length,
      1,
      "exactly one last_used flag",
    )

    // Now submit a successful edit job using the same model. The worker must
    // NOT write to KV because the model is already the last-used one.
    const kvPutsBefore = kvPuts.filter(
      (p) => p.k === "iconoplasm:image-edit-last-used:image_edit:user-1",
    ).length
    const firstCtx = capturingContext()
    const createResponse =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(
          "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/image-edit/jobs",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: SIGNED_IN },
            body: JSON.stringify({
              provider_id: "krea",
              model: "google/nano-banana-pro",
              source_gene_symbol: "A1BG",
              source_asset_sha256: SOURCE_SHA,
              adjustments: { remove_ai_generation_errors: true },
            }),
          },
        ),
        env,
        firstCtx,
      )
    const created = await createResponse.json()
    assert.equal(createResponse.status, 200, "create status: " + JSON.stringify(created))
    assert.equal(created.job.status, "succeeded")
    await firstCtx.drain()
    const kvPutsAfter = kvPuts.filter(
      (p) => p.k === "iconoplasm:image-edit-last-used:image_edit:user-1",
    ).length
    assert.equal(
      kvPutsAfter,
      kvPutsBefore,
      "Worker should NOT write to KV when the user picks the same model they used before",
    )

    // Submit a job with a different model. The worker MUST write to KV once.
    const newKvPutsBefore = kvPuts.filter(
      (p) => p.k === "iconoplasm:image-edit-last-used:image_edit:user-1",
    ).length
    // Switch the saved provider's model to google/nano-banana-2 by sending the new
    // model in the request body. The route at line 25671 already applies the
    // model override from the body to providerRow.model.
    const secondCtx = capturingContext()
    const secondResponse =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(
          "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/image-edit/jobs",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: SIGNED_IN },
            body: JSON.stringify({
              provider_id: "krea",
              model: "google/nano-banana-2",
              source_gene_symbol: "A1BG",
              source_asset_sha256: SOURCE_SHA,
              adjustments: { remove_ai_generation_errors: true },
            }),
          },
        ),
        env,
        secondCtx,
      )
    const secondCreated = await secondResponse.json()
    assert.equal(secondResponse.status, 200, "create status: " + JSON.stringify(secondCreated))
    assert.equal(secondCreated.job.status, "succeeded")
    const newKvPutsAfter = kvPuts.filter(
      (p) => p.k === "iconoplasm:image-edit-last-used:image_edit:user-1",
    ).length
    assert.equal(
      newKvPutsAfter,
      newKvPutsBefore + 1,
      "Worker should write to KV exactly once when the user switches model",
    )
    const lastWrite = kvPuts
      .filter((p) => p.k === "iconoplasm:image-edit-last-used:image_edit:user-1")
      .at(-1)
    assert.equal(lastWrite?.v, "krea:google/nano-banana-2")
  } finally {
    globalThis.fetch = originalFetch
  }
})

// Subrequest-budget regression. The synchronous Krea edit handler runs
// inside one Worker invocation, and Workers default to a 50-subrequest
// per-invocation cap on the free plan. A Krea edit on a slow model can
// legitimately take 60-120 seconds; if the polling cadence is fixed at 2s
// the poll loop alone fires 30-60 GET /jobs/{id} requests before the
// rendition pipeline runs. This test pins the per-invocation subrequest
// count for a worst-case 60s Krea edit (the nano-banana-pro slow path
// that B-574 verified live) and asserts the merged rendition pipeline +
// adaptive poll cadence stay under the 50-subrequest cap with headroom.
test("synchronous Krea edit stays under the 50-subrequest Worker cap on a slow model", async () => {
  const originalFetch = globalThis.fetch
  const db = new FakeDb()
  const env = buildEnv(db)
  // Default poll interval is 0 (set in buildEnv) so the test runs in
  // finite time, but the first poll must still fire without a sleep. The
  // adaptive cadence kicks in for the second+ polls; for the test we
  // simulate ~60 seconds of Krea work by returning "processing" for the
  // first 29 polls, then "completed" on the 30th. That is the same
  // number of polls a real 60s job would fire (30 polls × 2s = 60s).
  let pollIndex = 0
  let createCalls = 0
  let assetUploadCalls = 0
  const fetchUrls = []
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    fetchUrls.push(url)
    if (url === "https://api.krea.ai/assets") {
      assetUploadCalls += 1
      return new Response(
        JSON.stringify({
          id: "krea-asset-slow-1",
          image_url: "https://krea.example/uploaded/slow-source.png",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      )
    }
    if (url === "https://api.krea.ai/generate/image/google/nano-banana-pro") {
      createCalls += 1
      return new Response(JSON.stringify({ job_id: "krea-slow-job-1", status: "queued" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }
    if (url === "https://api.krea.ai/jobs/krea-slow-job-1") {
      pollIndex += 1
      if (pollIndex < 30) {
        return new Response(JSON.stringify({ job_id: "krea-slow-job-1", status: "processing" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      }
      return new Response(
        JSON.stringify({
          job_id: "krea-slow-job-1",
          status: "completed",
          result: { urls: ["https://krea.example/slow-result.png"] },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }
    if (url === "https://krea.example/slow-result.png") {
      // Non-WebP return so the merged normalize+writeImageEditRenditions
      // path runs and we exercise the (was-3-subrequest) tmp round-trip
      // saving. The merged pipeline produces full/medium/thumb WebP in
      // one normalize + one transform pass.
      return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
        status: 200,
        headers: { "Content-Type": "image/png" },
      })
    }
    if (init?.cf?.image?.format === "webp") {
      // Both the full normalize and the medium/thumb transforms come
      // through the worker-edge Image Resizing transform; return WebP
      // bytes regardless of width to keep the test cheap.
      return new Response(EDITED_BYTES, {
        status: 200,
        headers: { "Content-Type": "image/webp" },
      })
    }
    throw new Error(`Unexpected fetch ${url}`)
  }
  try {
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/image-edit/providers",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: SIGNED_IN },
          body: JSON.stringify({
            provider_id: "krea",
            api_key: "krea-test-secret",
            model: "google/nano-banana-pro",
          }),
        },
      ),
      env,
      { waitUntil() {} },
    )
    const { create, created } = await createKreaImageEditJobAndAwait({
      env,
      ctx: { waitUntil() {} },
      body: {
        provider_id: "krea",
        model: "google/nano-banana-pro",
        source_gene_symbol: "A1BG",
        source_asset_sha256: SOURCE_SHA,
        adjustments: { remove_ai_generation_errors: true },
      },
    })
    assert.equal(create.status, 200, "create status: " + JSON.stringify(created))
    assert.equal(created.job.status, "succeeded")
    // The synchronous flow must not blow the 50-subrequest cap. Headroom
    // is intentional: a 60s Krea job that returned WebP would cost 25
    // subrequests; non-WebP + tmp round-trip is the most expensive shape
    // the live path takes, and it must still be under 50.
    assert.ok(
      fetchUrls.length < 50,
      "Subrequest count " +
        fetchUrls.length +
        " is at or above the 50-subrequest Worker cap. URLs:\n" +
        fetchUrls.join("\n"),
    )
    assert.equal(assetUploadCalls, 1, "first edit must call Krea /assets")
    assert.equal(createCalls, 1, "must call Krea create-job once")
    // Confirm the merged normalize+writeImageEditRenditions path: with a
    // PNG return we expect the tmp normalize file to be PUT and DELETEd
    // exactly once (not 3 times as the previous implementation did).
    const normalizePuts = env.ICONOPLASM_PORTRAITS.puts.filter((p) =>
      String(p.key || "").startsWith("portraits/tmp/provider-output/"),
    )
    const normalizeDeletes = env.ICONOPLASM_PORTRAITS.deletes.filter((k) =>
      String(k || "").startsWith("portraits/tmp/provider-output/"),
    )
    assert.equal(
      normalizePuts.length,
      1,
      "merged normalize+writeImageEditRenditions must PUT the tmp source exactly once",
    )
    assert.equal(
      normalizeDeletes.length,
      1,
      "merged normalize+writeImageEditRenditions must DELETE the tmp source exactly once",
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

// Subrequest-budget regression for the re-edit KV cache. Editing the
// same blot twice with the same provider API key must skip the Krea
// /assets multipart upload on the second call, saving one subrequest.
// The cache is keyed by (userId, keyFingerprint, sourceSha) and is the
// load-bearing change that keeps the synchronous edit under the 50-
// subrequest cap for users who iterate on the same source image.
test("re-editing the same blot with the same Krea API key skips the /assets upload on the second call", async () => {
  const originalFetch = globalThis.fetch
  const db = new FakeDb()
  const env = buildEnv(db)
  const kvStore = new Map()
  env.KV = {
    async get(k, type) {
      const v = kvStore.get(k)
      if (v == null) return null
      if (type === "json") {
        try {
          return JSON.parse(v)
        } catch {
          return null
        }
      }
      return v
    },
    async put(k, v) {
      kvStore.set(k, v)
    },
    async delete(k) {
      kvStore.delete(k)
    },
  }
  let assetUploadCalls = 0
  let pollIndex = 0
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    if (url === "https://api.krea.ai/assets") {
      assetUploadCalls += 1
      return new Response(
        JSON.stringify({
          id: "krea-asset-reuse-1",
          image_url: "https://krea.example/uploaded/reuse.png",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }
    if (url === "https://api.krea.ai/generate/image/z-image/z-image") {
      return new Response(JSON.stringify({ job_id: "krea-reuse-job-1", status: "queued" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }
    if (url === "https://api.krea.ai/jobs/krea-reuse-job-1") {
      pollIndex += 1
      if (pollIndex < 2) {
        return new Response(JSON.stringify({ job_id: "krea-reuse-job-1", status: "processing" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      }
      return new Response(
        JSON.stringify({
          job_id: "krea-reuse-job-1",
          status: "completed",
          result: { urls: ["https://krea.example/reuse-result.png"] },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }
    if (url === "https://krea.example/reuse-result.png") {
      return new Response(EDITED_BYTES, {
        status: 200,
        headers: { "Content-Type": "image/webp" },
      })
    }
    if (init?.cf?.image?.format === "webp") {
      return new Response(EDITED_BYTES, {
        status: 200,
        headers: { "Content-Type": "image/webp" },
      })
    }
    throw new Error(`Unexpected fetch ${url}`)
  }
  try {
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/image-edit/providers",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: SIGNED_IN },
          body: JSON.stringify({
            provider_id: "krea",
            api_key: "krea-test-secret",
            model: "z-image/z-image",
          }),
        },
      ),
      env,
      { waitUntil() {} },
    )
    const first = await createKreaImageEditJobAndAwait({
      env,
      ctx: { waitUntil() {} },
      body: {
        provider_id: "krea",
        model: "z-image/z-image",
        source_gene_symbol: "A1BG",
        source_asset_sha256: SOURCE_SHA,
        adjustments: { remove_ai_generation_errors: true },
      },
    })
    assert.equal(first.create.status, 200, "first edit status: " + JSON.stringify(first.created))
    assert.equal(assetUploadCalls, 1, "first edit must call Krea /assets exactly once")
    // The asset upload cache must have been populated for the (user, key,
    // source-sha) tuple after the first edit.
    const cacheKeys = [...kvStore.keys()].filter((k) =>
      k.startsWith("iconoplasm:krea-asset-upload:v1:"),
    )
    assert.equal(
      cacheKeys.length,
      1,
      "first edit must populate the Krea asset upload cache exactly once",
    )
    // Re-edit the same blot with the same model. The /assets upload must
    // be served from the KV cache and not re-call Krea.
    const second = await createKreaImageEditJobAndAwait({
      env,
      ctx: { waitUntil() {} },
      body: {
        provider_id: "krea",
        model: "z-image/z-image",
        source_gene_symbol: "A1BG",
        source_asset_sha256: SOURCE_SHA,
        adjustments: { remove_ai_generation_errors: true },
      },
    })
    assert.equal(second.create.status, 200, "second edit status: " + JSON.stringify(second.created))
    assert.equal(
      assetUploadCalls,
      1,
      "re-edit with the same source bytes must NOT re-call Krea /assets",
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

// B-916: retiring a model must never need a data migration, and a retired model
// must never reach a provider API. Every way the stored or requested model can
// go stale is pinned below through the real Worker routes, with only the
// provider HTTP faked. The ways it can fail:
//   1. the stored provider row holds a model the registry no longer offers
//      (provider list read, a job that names no model, a save)
//   2. a stale browser tab names the retired model in the job body, which would
//      bill the person's own key for a model they did not pick
//   3. the last-used memory holds a retired model (read, and the write-back)
//   4. a candidate-generation job records which model it ran
//   5. a provider's default is not one of its own models, so nothing resolves
// gpt-image-2 is the retired model used here: OpenAI's guide files it under
// earlier models and the registry no longer offers it.
const RETIRED_OPENAI_MODEL = "gpt-image-2"
const WORKER_ORIGIN = "https://the-only-allowed-internal-stateful-worker-do-not-duplicate"

async function workerRequest(env, path, { method = "GET", body } = {}) {
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(`${WORKER_ORIGIN}${path}`, {
        method,
        headers: { "Content-Type": "application/json", Cookie: SIGNED_IN },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env,
      { waitUntil() {} },
    )
  return { status: response.status, body: await response.json() }
}

async function openAiDefaultModel(env) {
  const listed = await workerRequest(env, "/api/iconoplasm/image-edit/providers")
  return listed.body.supported_providers.find((provider) => provider.provider_id === "openai")
    .default_model
}

function fakeOpenAiFetch(fetchCalls, env) {
  return async (input, init = {}) => {
    const authoringBody = authoringStorageResponse(env, input, init)
    if (authoringBody) return authoringBody
    const url = String(input)
    fetchCalls.push({ url, init })
    if (url === "https://api.openai.com/v1/images/edits") {
      return new Response(JSON.stringify({ data: [{ b64_json: base64(EDITED_BYTES) }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }
    if (init?.cf?.image?.width === 512) return new Response("medium-webp-bytes", { status: 200 })
    if (init?.cf?.image?.width === 256) return new Response("thumb-webp-bytes", { status: 200 })
    throw new Error(`Unexpected fetch ${url}`)
  }
}

const EDIT_JOB_BODY = {
  provider_id: "openai",
  source_gene_symbol: "A1BG",
  source_asset_sha256: SOURCE_SHA,
  adjustments: { remove_ai_generation_errors: true },
}

test("a stored model the registry no longer offers resolves to the provider default on read, on a job and on save", async () => {
  const originalFetch = globalThis.fetch
  const db = new FakeDb()
  const env = buildEnv(db)
  const fetchCalls = []
  globalThis.fetch = fakeOpenAiFetch(fetchCalls, env)
  try {
    const defaultModel = await openAiDefaultModel(env)
    assert.notEqual(defaultModel, RETIRED_OPENAI_MODEL)
    const saved = await workerRequest(env, "/api/iconoplasm/image-edit/providers", {
      method: "POST",
      body: { provider_id: "openai", api_key: "sk-openai-test-secret", model: defaultModel },
    })
    assert.equal(saved.status, 200)
    // A row written before the model was retired.
    db.providerRows.get("user-1|openai").model = RETIRED_OPENAI_MODEL

    // 1a. Read: the provider list shows the default, never the retired model.
    const listed = await workerRequest(env, "/api/iconoplasm/image-edit/providers")
    assert.equal(listed.body.providers.length, 1)
    assert.equal(listed.body.providers[0].model, defaultModel)
    const offered = listed.body.supported_providers
      .find((provider) => provider.provider_id === "openai")
      .model_options.map((option) => option.model)
    assert.ok(!offered.includes(RETIRED_OPENAI_MODEL), "the retired model is not selectable")

    // 1b. A job that names no model runs the stored selection, resolved.
    const job = await workerRequest(env, "/api/iconoplasm/image-edit/jobs", {
      method: "POST",
      body: EDIT_JOB_BODY,
    })
    assert.equal(job.status, 200, JSON.stringify(job.body))
    const sent = fetchCalls.find((call) => call.url === "https://api.openai.com/v1/images/edits")
    assert.equal(sent.init.body.get("model"), defaultModel)

    // 1c. A save that carries the retired model stores the default.
    const resaved = await workerRequest(env, "/api/iconoplasm/image-edit/providers", {
      method: "POST",
      body: {
        provider_id: "openai",
        api_key: "sk-openai-test-secret",
        model: RETIRED_OPENAI_MODEL,
      },
    })
    assert.equal(resaved.status, 200)
    assert.equal(resaved.body.provider.model, defaultModel)
    assert.equal(db.providerRows.get("user-1|openai").model, defaultModel)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("a stale tab that names a retired model is refused before any provider request", async () => {
  const originalFetch = globalThis.fetch
  const db = new FakeDb()
  const env = buildEnv(db)
  const fetchCalls = []
  globalThis.fetch = fakeOpenAiFetch(fetchCalls, env)
  try {
    const saved = await workerRequest(env, "/api/iconoplasm/image-edit/providers", {
      method: "POST",
      body: { provider_id: "openai", api_key: "sk-openai-test-secret" },
    })
    assert.equal(saved.status, 200)

    const edit = await workerRequest(env, "/api/iconoplasm/image-edit/jobs", {
      method: "POST",
      body: { ...EDIT_JOB_BODY, model: RETIRED_OPENAI_MODEL },
    })
    assert.equal(edit.status, 400)
    assert.equal(edit.body.ok, false)
    assert.match(edit.body.error, /no longer offered/)
    assert.match(edit.body.error, /Reload the page/)

    const generation = await workerRequest(env, "/api/iconoplasm/candidate-generation/jobs", {
      method: "POST",
      body: { provider_id: "openai", symbol: "A1BG", model: RETIRED_OPENAI_MODEL },
    })
    assert.equal(generation.status, 400)
    assert.match(generation.body.error, /no longer offered/)

    assert.deepEqual(
      fetchCalls.map((call) => call.url),
      [],
      "no request may leave for a provider",
    )
    assert.equal(db.jobs.size, 0, "no edit job row is created for a refused model")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("a retired last-used model reads as the provider default and is never written back", async () => {
  const originalFetch = globalThis.fetch
  const db = new FakeDb()
  const env = buildEnv(db)
  const kvPuts = []
  const kvStore = new Map([
    ["iconoplasm:image-edit-last-used:image_edit:user-1", `openai:${RETIRED_OPENAI_MODEL}`],
  ])
  env.KV = {
    async get(key) {
      return kvStore.has(key) ? kvStore.get(key) : null
    },
    async put(key, value) {
      kvPuts.push({ key, value })
      kvStore.set(key, value)
    },
    async delete() {},
  }
  const fetchCalls = []
  globalThis.fetch = fakeOpenAiFetch(fetchCalls, env)
  try {
    const defaultModel = await openAiDefaultModel(env)
    await workerRequest(env, "/api/iconoplasm/image-edit/providers", {
      method: "POST",
      body: { provider_id: "openai", api_key: "sk-openai-test-secret", model: defaultModel },
    })
    const listed = await workerRequest(env, "/api/iconoplasm/image-edit/providers?op=image_edit")
    assert.deepEqual(listed.body.last_used, { provider_id: "openai", model: defaultModel })
    const flagged = listed.body.supported_providers
      .find((provider) => provider.provider_id === "openai")
      .model_options.filter((option) => option.last_used === true)
      .map((option) => option.model)
    assert.deepEqual(flagged, [defaultModel])

    // Running the default must not rewrite the memory that already resolves to it.
    const job = await workerRequest(env, "/api/iconoplasm/image-edit/jobs", {
      method: "POST",
      body: EDIT_JOB_BODY,
    })
    assert.equal(job.status, 200, JSON.stringify(job.body))
    assert.ok(
      kvPuts.every((put) => !put.value.includes(RETIRED_OPENAI_MODEL)),
      "a retired model is never written to the last-used memory",
    )
    assert.equal(kvPuts.length, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

// B-970: a job route checks that the model can do the job it was asked for.
// Krea offers edit-only models (bytedance/seededit) and generate-only ones
// (qwen/2512). Failure modes:
//   1. an edit job naming a generate-only model reaches the provider
//   2. a generation job naming an edit-only model reaches the provider
//   3. a job that names no model runs a stored model that cannot do the job
const KREA_EDIT_ONLY = "bytedance/seededit"
const KREA_GENERATE_ONLY = "qwen/2512"

async function saveKrea(env, model) {
  const saved = await workerRequest(env, "/api/iconoplasm/image-edit/providers", {
    method: "POST",
    body: { provider_id: "krea", api_key: "test-key-krea", model },
  })
  assert.equal(saved.status, 200, JSON.stringify(saved.body))
}

test("a model that cannot do the requested job is refused before any provider request", async () => {
  const originalFetch = globalThis.fetch
  const db = new FakeDb()
  const env = buildEnv(db)
  const recorded = []
  globalThis.fetch = recordingProviderFetch(env, recorded)
  try {
    await saveKrea(env)
    const edit = await workerRequest(env, "/api/iconoplasm/image-edit/jobs", {
      method: "POST",
      body: { ...EDIT_JOB_BODY, provider_id: "krea", model: KREA_GENERATE_ONLY },
    })
    assert.equal(edit.status, 400)
    assert.match(edit.body.error, /cannot edit an image/)

    const generation = await workerRequest(env, "/api/iconoplasm/candidate-generation/jobs", {
      method: "POST",
      body: { provider_id: "krea", symbol: "A1BG", model: KREA_EDIT_ONLY },
    })
    assert.equal(generation.status, 400)
    assert.match(generation.body.error, /cannot generate an image/)

    assert.deepEqual(
      recorded.map((call) => call.url),
      [],
      "no request may leave for a provider",
    )
    assert.equal(db.jobs.size, 0, "no job row is created for a refused model")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("a job naming no model runs a capable model when the saved one cannot do the job", async () => {
  for (const [saved, path, body, unwanted] of [
    [
      KREA_EDIT_ONLY,
      "/api/iconoplasm/candidate-generation/jobs",
      { provider_id: "krea", symbol: "A1BG", request_mode: "novel" },
      "seededit",
    ],
    [
      KREA_GENERATE_ONLY,
      "/api/iconoplasm/image-edit/jobs",
      { ...EDIT_JOB_BODY, provider_id: "krea" },
      "qwen",
    ],
  ]) {
    const originalFetch = globalThis.fetch
    const env = buildEnv(new FakeDb())
    const recorded = []
    globalThis.fetch = recordingProviderFetch(env, recorded)
    try {
      await saveKrea(env, saved)
      const job = await workerRequest(env, path, { method: "POST", body })
      assert.equal(job.status, 200, JSON.stringify(job.body).slice(0, 600))
      assert.equal(recorded.length, 1)
      assert.ok(recorded[0].url.startsWith("https://api.krea.ai/generate/image/"))
      assert.ok(!recorded[0].url.includes(unwanted), `${saved} must not run: ${recorded[0].url}`)
    } finally {
      globalThis.fetch = originalFetch
    }
  }
})

// B-916: every model the registry offers is sent exactly what its provider's own
// docs describe. The documented schemas and the exact bodies live in
// __fixtures__/image-provider-doc-schemas.json (read from each provider's docs on
// 2026-10-03; the file names the source per entry). Each flow runs through the
// real Worker route, with only the provider HTTP faked, and the first request
// that leaves for the provider is captured and checked three ways:
//   1. the URL, method and auth header are the documented ones
//   2. the body sends every documented required field, and only documented fields,
//      with documented enum values (a field the docs do not list is a defect)
//   3. where the fixture has a golden body, the body matches it exactly
// A new or changed model without a documented schema fails the coverage test, so
// a model cannot be added without reading its docs.
const DOC_FIXTURE = JSON.parse(
  readFileSync(new URL("./__fixtures__/image-provider-doc-schemas.json", import.meta.url), "utf8"),
)
const PROVIDER_AUTH = {
  openai: { header: "Authorization", prefix: "Bearer " },
  gemini: { header: "x-goog-api-key", prefix: "" },
  luma: { header: "Authorization", prefix: "Bearer " },
  krea: { header: "Authorization", prefix: "Bearer " },
  fal: { header: "Authorization", prefix: "Key " },
}
const KREA_ASSET_URL = "https://krea.example/uploaded/source.png"
const PROVIDER_OUTPUT_URL = "https://provider.example/out.png"

function docSchemaFor(flow) {
  return (
    DOC_FIXTURE.models[`${flow.provider_id}|${flow.model}|${flow.operation}`] ||
    DOC_FIXTURE.models[`${flow.provider_id}|${flow.model}`] ||
    null
  )
}

function goldenKey(flow) {
  return `${flow.provider_id}|${flow.model}|${flow.operation}`
}

async function offeredFlows() {
  const env = buildEnv(new FakeDb())
  const flows = []
  for (const [operation, query] of [
    ["edit", "image_edit"],
    ["generate", "candidate_generation"],
  ]) {
    const listed = await workerRequest(env, `/api/iconoplasm/image-edit/providers?op=${query}`)
    for (const provider of listed.body.supported_providers) {
      for (const option of provider.model_options) {
        flows.push({
          provider_id: provider.provider_id,
          model: option.model,
          operation,
          is_default: provider.default_model === option.model,
        })
      }
    }
  }
  return flows
}

// The provider's reply to the first request, so the job completes. Anything the
// Worker sends that is not a provider request (portrait storage, the image
// transform) gets the same stand-ins the other tests use.
function recordingProviderFetch(env, recorded) {
  const png = () =>
    new Response("provider-png-bytes", { status: 200, headers: { "Content-Type": "image/png" } })
  const json = (value) =>
    new Response(JSON.stringify(value), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  return async (input, init = {}) => {
    const authoringBody = authoringStorageResponse(env, input, init)
    if (authoringBody) return authoringBody
    const url = String(input)
    const method = String(init.method || "GET").toUpperCase()
    const create = (response) => {
      recorded.push({ url, method, headers: init.headers || {}, body: init.body })
      return response
    }
    if (
      url === "https://api.openai.com/v1/images/edits" ||
      url === "https://api.openai.com/v1/images/generations"
    ) {
      return create(json({ data: [{ b64_json: base64(EDITED_BYTES) }] }))
    }
    if (url.startsWith("https://generativelanguage.googleapis.com/")) {
      return create(
        json({
          candidates: [
            {
              content: {
                parts: [{ inlineData: { mimeType: "image/png", data: base64(EDITED_BYTES) } }],
              },
            },
          ],
        }),
      )
    }
    if (url === "https://agents.lumalabs.ai/v1/generations" && method === "POST") {
      return create(
        json({
          id: "luma-1",
          state: "completed",
          output: [{ type: "image", url: PROVIDER_OUTPUT_URL }],
        }),
      )
    }
    if (url === "https://api.krea.ai/assets") {
      return json({ id: "krea-asset-1", image_url: KREA_ASSET_URL })
    }
    if (url.startsWith("https://api.krea.ai/generate/image/")) {
      return create(json({ job_id: "krea-job-1", status: "queued" }))
    }
    if (url === "https://api.krea.ai/jobs/krea-job-1") {
      return json({
        job_id: "krea-job-1",
        status: "completed",
        result: { urls: [PROVIDER_OUTPUT_URL] },
      })
    }
    if (url.startsWith("https://queue.fal.run/") && method === "POST") {
      return create(
        json({
          request_id: "fal-1",
          status_url: "https://queue.fal.run/app/requests/fal-1/status",
          response_url: "https://queue.fal.run/app/requests/fal-1",
        }),
      )
    }
    if (url === "https://queue.fal.run/app/requests/fal-1/status") {
      return json({
        status: "COMPLETED",
        request_id: "fal-1",
        response_url: "https://queue.fal.run/app/requests/fal-1",
      })
    }
    if (url === "https://queue.fal.run/app/requests/fal-1") {
      return json({ images: [{ url: PROVIDER_OUTPUT_URL }] })
    }
    if (url === PROVIDER_OUTPUT_URL) return png()
    if (url.includes("/portraits/") || url.includes("/portrait/")) {
      return new Response("source-portrait-bytes", {
        status: 200,
        headers: { "Content-Type": "image/webp" },
      })
    }
    if (init?.cf?.image?.width === 512) return new Response("medium-webp-bytes", { status: 200 })
    if (init?.cf?.image?.width === 256) return new Response("thumb-webp-bytes", { status: 200 })
    throw new Error(`Unexpected fetch ${method} ${url}`)
  }
}

async function captureProviderRequest(flow) {
  const originalFetch = globalThis.fetch
  const env = buildEnv(new FakeDb())
  const recorded = []
  globalThis.fetch = recordingProviderFetch(env, recorded)
  try {
    const saved = await workerRequest(env, "/api/iconoplasm/image-edit/providers", {
      method: "POST",
      body: {
        provider_id: flow.provider_id,
        api_key: `test-key-${flow.provider_id}`,
        model: flow.model,
      },
    })
    assert.equal(saved.status, 200, JSON.stringify(saved.body))
    const job =
      flow.operation === "edit"
        ? await workerRequest(env, "/api/iconoplasm/image-edit/jobs", {
            method: "POST",
            body: {
              provider_id: flow.provider_id,
              model: flow.model,
              source_gene_symbol: "A1BG",
              source_asset_sha256: SOURCE_SHA,
              adjustments: { age_years: 30 },
            },
          })
        : await workerRequest(env, "/api/iconoplasm/candidate-generation/jobs", {
            method: "POST",
            body: {
              provider_id: flow.provider_id,
              model: flow.model,
              symbol: "A1BG",
              request_mode: "novel",
            },
          })
    assert.equal(job.status, 200, JSON.stringify(job.body).slice(0, 600))
    assert.equal(recorded.length, 1, "exactly one provider request is created per job")
    return recorded[0]
  } finally {
    globalThis.fetch = originalFetch
  }
}

// Turns the captured body into the golden's vocabulary: the long prompt, the
// source image in each of its forms, and file parts become placeholders.
function normalizeCapturedBody(body) {
  if (body instanceof FormData) {
    const fields = {}
    for (const [key, value] of body.entries()) {
      fields[key] = typeof value === "string" ? value : "$FILE"
    }
    return normalizeCapturedBody(fields)
  }
  const value = typeof body === "string" ? JSON.parse(body) : body
  const walk = (node, key = "") => {
    if (Array.isArray(node)) return node.map((item) => walk(item, key))
    if (node && typeof node === "object") {
      return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v, k)]))
    }
    if (typeof node !== "string") return node
    if (node === KREA_ASSET_URL) return "$KREA_ASSET_URL"
    if (node.includes("/portraits/")) return "$SOURCE_URL"
    if ((key === "mime_type" || key === "media_type") && node.startsWith("image/")) return "$MIME"
    if (key === "data" && /^[A-Za-z0-9+/]{8,}={0,2}$/.test(node)) return "$SOURCE_BASE64"
    if (node.length > 100) return "$PROMPT"
    return node
  }
  return walk(value)
}

function assertConformsToDocs(schema, body, label) {
  for (const field of schema.required) {
    assert.ok(field in body, `${label}: the docs require "${field}" and the request omits it`)
  }
  for (const [field, value] of Object.entries(body)) {
    const documented = schema.properties[field]
    assert.ok(documented, `${label}: the request sends "${field}", which the docs do not list`)
    if (Array.isArray(documented.enum) && ["string", "number"].includes(typeof value)) {
      assert.ok(
        documented.enum.includes(String(value)),
        `${label}: "${field}" is ${JSON.stringify(value)}, the docs allow ${documented.enum.join(", ")}`,
      )
    }
  }
}

test("every offered image model is sent exactly what its provider's docs describe", async (t) => {
  const flows = await offeredFlows()
  assert.ok(flows.length > 40, `expected the full registry, saw ${flows.length} flows`)
  for (const flow of flows) {
    await t.test(`${flow.provider_id} ${flow.model} ${flow.operation}`, async () => {
      const label = `${flow.provider_id} ${flow.model} ${flow.operation}`
      const schema = docSchemaFor(flow)
      assert.ok(schema, `${label}: no documented schema in the fixture`)
      const request = await captureProviderRequest(flow)
      assert.equal(request.method, schema.endpoint.method, `${label}: method`)
      assert.equal(request.url, schema.endpoint.url, `${label}: documented endpoint`)
      const auth = PROVIDER_AUTH[flow.provider_id]
      assert.equal(
        request.headers[auth.header],
        `${auth.prefix}test-key-${flow.provider_id}`,
        `${label}: documented auth header`,
      )
      const body = normalizeCapturedBody(request.body)
      assertConformsToDocs(schema, body, label)
      const golden = DOC_FIXTURE.golden[goldenKey(flow)]
      if (golden) assert.deepEqual(body, golden, `${label}: golden body`)
    })
  }
})

test("every new, default and direct-provider flow has a golden body, and no golden is orphaned", async () => {
  const flows = await offeredFlows()
  const keys = new Set(flows.map(goldenKey))
  for (const key of Object.keys(DOC_FIXTURE.golden)) {
    assert.ok(keys.has(key), `golden ${key} matches no offered flow`)
  }
  for (const key of Object.keys(DOC_FIXTURE.models)) {
    const [providerId, model, operation] = key.split("|")
    assert.ok(
      flows.some(
        (flow) =>
          flow.provider_id === providerId &&
          flow.model === model &&
          (operation === undefined || flow.operation === operation),
      ),
      `documented schema ${key} matches no offered flow`,
    )
  }
  const addedByB916 = new Set([
    "ideogram/ideogram-4.5",
    "ideogram/ideogram-4.5-precise",
    "ideogram/v4.5",
    "ideogram/v4.5/edit",
    "blackforestlabs/flux-3/edit-image",
    "blackforestlabs/flux-3/text-to-image",
    "google/nano-banana-flash-lite",
    "google/nano-banana-lite",
    "google/nano-banana-lite/edit",
    "openai/gpt-image-2.5-sunburst",
    "openai/gpt-image-2.5-flare",
    "openai/gpt-image-2.5/sunburst/edit",
    "openai/gpt-image-2.5/sunburst/text-to-image",
    "openai/gpt-image-2.5/flare/edit",
    "openai/gpt-image-2.5/flare/text-to-image",
  ])
  for (const flow of flows) {
    const direct = ["openai", "gemini", "luma"].includes(flow.provider_id)
    if (direct || flow.is_default || addedByB916.has(flow.model)) {
      assert.ok(
        DOC_FIXTURE.golden[goldenKey(flow)],
        `${goldenKey(flow)} needs a golden body (direct provider, default or added model)`,
      )
    }
  }
})
