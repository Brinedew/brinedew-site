import assert from "node:assert/strict"
import test from "node:test"

import { handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

const SOURCE_SHA = "a".repeat(64)
const EDITED_BYTES = new TextEncoder().encode("edited-webp-bytes")

function base64(bytes) {
  return Buffer.from(bytes).toString("base64")
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
        candidate_image_id: 123,
        image_upvotes: 7,
        image_downvotes: 1,
        image_score: 6,
      }
    }
    if (this.sql.includes("FROM icono_image_edit_jobs") && this.sql.includes("WHERE id = ?")) {
      const row = this.db.jobs.get(this.args[0]) || null
      if (row && this.sql.includes("user_id = ?") && row.user_id !== this.args[1]) return null
      return row
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
    if (this.sql.includes("FROM icono_gene_catalog gc")) {
      return {
        results: [
          {
            gene_symbol: "A1BG",
            catalog_full_name: "Alpha-1-B Glycoprotein",
            color_hex: "#8fb7c8",
            tmh: 0,
            asset_sha256: this.db.publishedAsset?.asset_sha256 || SOURCE_SHA,
            width: 1024,
            height: 1280,
            vision_id: "anima-v1-3001",
            candidate_image_id: 123,
          },
        ],
      }
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
    if (
      this.sql.includes("UPDATE icono_image_edit_jobs") &&
      this.sql.includes("status = 'failed'")
    ) {
      const row = this.db.jobs.get(this.args[1])
      Object.assign(row, { status: "failed", error: this.args[0] })
      return { meta: { changes: 1 } }
    }
    if (this.sql.includes("UPDATE icono_image_edit_jobs") && this.sql.includes("published_at")) {
      const row = this.db.jobs.get(this.args[0])
      row.published_at = "2026-05-16T00:00:02.000Z"
      return { meta: { changes: 1 } }
    }
    if (this.sql.includes("INSERT INTO icono_portrait_assets")) {
      this.db.publishedAsset = {
        gene_symbol: this.args[0],
        asset_sha256: this.args[1],
        r2_key_full: this.args[2],
        r2_key_medium: this.args[3],
        r2_key_thumb: this.args[4],
        created_by: this.args[this.args.length - 1],
      }
      return { meta: { changes: 1 } }
    }
    if (this.sql.includes("INSERT INTO icono_publish_events")) {
      this.db.publishEvent = {
        gene_symbol: this.args[0],
        to_asset_sha256: this.args[2],
        actor: this.args[3],
        reason: this.args[4],
      }
      return { meta: { changes: 1 } }
    }
    if (this.sql.includes("INSERT INTO icono_image_votes")) {
      this.db.voteProjectionRows.push({
        user_id: this.args[5],
        vote_value: this.args[6],
      })
      return { meta: { changes: 1 } }
    }
    if (this.sql.includes("INSERT INTO icono_vote_events")) {
      this.db.voteEvents.push({
        user_id: this.args[4],
        vote_value: this.args[5],
      })
      return { meta: { changes: 1 } }
    }
    if (this.sql.includes("icono_vote_projection_refresh_jobs")) {
      this.db.voteRefreshTouched = true
      return { meta: { changes: 1 } }
    }
    if (this.sql.trim().startsWith("DELETE FROM icono_image_votes")) {
      return { meta: { changes: 1 } }
    }
    return { meta: { changes: 0 } }
  }
}

class FakeDb {
  constructor() {
    this.providerRows = new Map()
    this.jobs = new Map()
    this.voteProjectionRows = []
    this.voteEvents = []
  }

  prepare(sql) {
    return new FakeStatement(this, sql)
  }
}

function buildSessionBinding(session) {
  return {
    idFromName(name) {
      return name
    },
    get() {
      return {
        async fetch() {
          return new Response(JSON.stringify(session), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        },
      }
    },
  }
}

function buildVoteCoordinatorBinding(db) {
  return {
    idFromName(name) {
      return name
    },
    get() {
      return {
        async fetch(request) {
          if (new URL(request.url).pathname === "/state") {
            return new Response(JSON.stringify({ ok: true, asset_summaries: [] }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            })
          }
          const payload = await request.json()
          if (new URL(request.url).pathname === "/vote/import") {
            db.voteImportPayload = payload
            return new Response(
              JSON.stringify({
                ok: true,
                upserted: payload.items.length,
                deleted: 0,
                invalid: 0,
                results: payload.items.map((item) => ({
                  candidate_ref: `a:${payload.symbol}|${item.asset_sha256}`,
                  symbol: payload.symbol,
                  asset_sha256: item.asset_sha256,
                  vision_id: item.vision_id || "",
                  candidate_image_id: item.candidate_image_id || null,
                  user_id: item.user_id,
                  current_vote_value: 0,
                  final_vote_value: item.vote_value,
                })),
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            )
          }
          throw new Error("Unexpected vote coordinator call")
        },
      }
    },
  }
}

function buildPortraitStorage() {
  return {
    puts: [],
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
  }
}

function buildEnv(db = new FakeDb(), session = { user_id: "user-1", username: "tester" }) {
  return {
    ICONOPLASM_DB: db,
    ICONOPLASM_PORTRAITS: buildPortraitStorage(),
    KV: {
      async get() {
        return null
      },
      async put() {},
      async delete() {},
    },
    GAME_SESSIONS: buildSessionBinding(session),
    ICONOPLASM_VOTE_COORDINATORS: buildVoteCoordinatorBinding(db),
    ICONOPLASM_IMAGE_EDIT_KEY_SECRET: "test-secret-with-more-than-32-bytes-for-aes",
  }
}

test("image edit provider keys are encrypted and listed without secrets", async () => {
  const db = new FakeDb()
  const env = buildEnv(db)
  const saveResponse =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/image-edit/providers",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
          body: JSON.stringify({
            provider_id: "openai-compatible",
            api_key: "sk-test-secret",
            endpoint_url: "https://api.openai.com/v1/images/edits",
            model: "gpt-image-1.5",
          }),
        },
      ),
      env,
      { waitUntil() {} },
    )
  const saved = await saveResponse.json()

  assert.equal(saveResponse.status, 200)
  assert.equal(saved.provider.provider_id, "openai-compatible")
  assert.equal(saved.provider.configured, true)
  const stored = db.providerRows.get("user-1|openai-compatible")
  assert.ok(stored.encrypted_api_key)
  assert.ok(stored.encryption_iv)
  assert.notEqual(stored.encrypted_api_key, "sk-test-secret")
  assert.doesNotMatch(stored.encrypted_api_key, /sk-test-secret/)

  const listResponse =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/image-edit/providers",
        {
          headers: { Cookie: "session=abc123" },
        },
      ),
      env,
      { waitUntil() {} },
    )
  const listed = await listResponse.json()

  assert.equal(listResponse.status, 200)
  assert.equal(listed.providers.length, 1)
  assert.equal(listed.providers[0].provider_id, "openai-compatible")
  assert.equal(listed.providers[0].configured, true)
  assert.equal(listed.providers[0].api_key, undefined)
  assert.equal(listed.providers[0].encrypted_api_key, undefined)
  db.providerRows.set("user-1|unsupported-provider", {
    user_id: "user-1",
    provider_id: "unsupported-provider",
    encrypted_api_key: "ciphertext",
    encryption_iv: "iv",
    key_fingerprint: "fingerprint",
    endpoint_url: "https://example.com/images",
    model: "example",
  })
  const filteredResponse =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/image-edit/providers",
        {
          headers: { Cookie: "session=abc123" },
        },
      ),
      env,
      { waitUntil() {} },
    )
  const filtered = await filteredResponse.json()
  assert.deepEqual(
    filtered.providers.map((provider) => provider.provider_id),
    ["openai-compatible"],
  )
})

test("image edit jobs validate provider and adjustment input before calling providers", async () => {
  const originalFetch = globalThis.fetch
  const db = new FakeDb()
  const env = buildEnv(db)
  let providerCalled = false
  globalThis.fetch = async () => {
    providerCalled = true
    throw new Error("provider should not be called")
  }

  try {
    const unconfiguredResponse =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(
          "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/image-edit/jobs",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
            body: JSON.stringify({
              provider_id: "openai-compatible",
              source_gene_symbol: "A1BG",
              source_asset_sha256: SOURCE_SHA,
              adjustments: { remove_ai_generation_errors: true },
            }),
          },
        ),
        env,
        { waitUntil() {} },
      )
    const unconfigured = await unconfiguredResponse.json()
    assert.equal(unconfiguredResponse.status, 400)
    assert.match(unconfigured.error, /not configured/i)

    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/image-edit/providers",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
          body: JSON.stringify({
            provider_id: "openai-compatible",
            api_key: "sk-test-secret",
            endpoint_url: "https://api.openai.com/v1/images/edits",
            model: "gpt-image-1.5",
          }),
        },
      ),
      env,
      { waitUntil() {} },
    )

    const invalidAdjustmentResponse =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(
          "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/image-edit/jobs",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
            body: JSON.stringify({
              provider_id: "openai-compatible",
              source_gene_symbol: "A1BG",
              source_asset_sha256: SOURCE_SHA,
              adjustments: {},
            }),
          },
        ),
        env,
        { waitUntil() {} },
      )
    const invalidAdjustment = await invalidAdjustmentResponse.json()
    assert.equal(invalidAdjustmentResponse.status, 400)
    assert.match(invalidAdjustment.error, /at least one/i)
    assert.equal(providerCalled, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("image edit jobs persist failed provider responses without publishing assets", async () => {
  const originalFetch = globalThis.fetch
  const db = new FakeDb()
  const env = buildEnv(db)
  globalThis.fetch = async (input) => {
    if (String(input) === "https://api.openai.com/v1/images/edits") {
      return new Response(JSON.stringify({ error: { message: "provider quota exhausted" } }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      })
    }
    throw new Error(`Unexpected fetch ${input}`)
  }

  try {
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/image-edit/providers",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
          body: JSON.stringify({
            provider_id: "openai-compatible",
            api_key: "sk-test-secret",
            endpoint_url: "https://api.openai.com/v1/images/edits",
            model: "gpt-image-1.5",
          }),
        },
      ),
      env,
      { waitUntil() {} },
    )

    const createResponse =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(
          "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/image-edit/jobs",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
            body: JSON.stringify({
              provider_id: "openai-compatible",
              source_gene_symbol: "A1BG",
              source_asset_sha256: SOURCE_SHA,
              adjustments: { remove_ai_generation_errors: true },
            }),
          },
        ),
        env,
        { waitUntil() {} },
      )
    const failed = await createResponse.json()

    assert.equal(createResponse.status, 502)
    assert.equal(failed.job.status, "failed")
    assert.match(failed.job.error, /provider quota exhausted/i)
    assert.equal(env.ICONOPLASM_PORTRAITS.puts.length, 0)
    assert.equal(db.publishedAsset, undefined)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("image edit jobs call the provider, write renditions, and publish with inherited votes", async () => {
  const originalFetch = globalThis.fetch
  const db = new FakeDb()
  const env = buildEnv(db)
  const fetchCalls = []
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    fetchCalls.push({ url, init })
    if (url === "https://api.openai.com/v1/images/edits") {
      assert.equal(init.headers.Authorization, "Bearer sk-test-secret")
      return new Response(JSON.stringify({ data: [{ b64_json: base64(EDITED_BYTES) }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }
    if (init?.cf?.image?.width === 512) {
      return new Response("medium-webp-bytes", {
        status: 200,
        headers: { "Content-Type": "image/webp" },
      })
    }
    if (init?.cf?.image?.width === 256) {
      return new Response("thumb-webp-bytes", {
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
          headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
          body: JSON.stringify({
            provider_id: "openai-compatible",
            api_key: "sk-test-secret",
            endpoint_url: "https://api.openai.com/v1/images/edits",
            model: "gpt-image-1.5",
          }),
        },
      ),
      env,
      { waitUntil() {} },
    )

    const createResponse =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(
          "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/image-edit/jobs",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
            body: JSON.stringify({
              provider_id: "openai-compatible",
              source_gene_symbol: "A1BG",
              source_asset_sha256: SOURCE_SHA,
              adjustments: {
                remove_ai_generation_errors: true,
                age_years: 42,
                surface_tone_hex: "#b17f62",
              },
            }),
          },
        ),
        env,
        { waitUntil() {} },
      )
    const created = await createResponse.json()

    assert.equal(createResponse.status, 200)
    assert.equal(created.job.status, "succeeded")
    assert.equal(created.job.inherited_upvotes, 6)
    assert.ok(created.job.result_asset_sha256)
    assert.equal(env.ICONOPLASM_PORTRAITS.puts.length, 3)
    assert.ok(env.ICONOPLASM_PORTRAITS.puts.every((put) => put.contentType === "image/webp"))
    assert.ok(fetchCalls.some((call) => call.init?.cf?.image?.width === 512))
    assert.ok(fetchCalls.some((call) => call.init?.cf?.image?.width === 256))

    const publishResponse =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(
          `https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/image-edit/jobs/${created.job.id}/publish`,
          {
            method: "POST",
            headers: { Cookie: "session=abc123" },
          },
        ),
        env,
        { waitUntil() {} },
      )
    const published = await publishResponse.json()

    assert.equal(publishResponse.status, 200)
    assert.equal(published.ok, true)
    assert.equal(db.publishedAsset.gene_symbol, "A1BG")
    assert.equal(db.publishedAsset.asset_sha256, created.job.result_asset_sha256)
    assert.equal(published.vote_inheritance.inherited_upvotes, 6)
    assert.equal(published.vote_inheritance.imported_votes, 7)
    assert.equal(published.vote_inheritance.user_upvote, true)
    assert.equal(db.voteImportPayload.items.length, 7)
    assert.equal(db.voteImportPayload.items.filter((item) => item.user_id === "user-1").length, 1)
    assert.equal(
      db.voteImportPayload.items.filter((item) =>
        String(item.user_id || "").startsWith("__system_image_edit_inherit__:"),
      ).length,
      6,
    )
    assert.equal(db.voteProjectionRows.length, 7)
    assert.equal(db.voteRefreshTouched, true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("image edit publish is limited to the job owner", async () => {
  const originalFetch = globalThis.fetch
  const db = new FakeDb()
  const ownerEnv = buildEnv(db, { user_id: "owner-1", username: "owner" })
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
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

  try {
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/image-edit/providers",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
          body: JSON.stringify({
            provider_id: "openai-compatible",
            api_key: "sk-test-secret",
            endpoint_url: "https://api.openai.com/v1/images/edits",
            model: "gpt-image-1.5",
          }),
        },
      ),
      ownerEnv,
      { waitUntil() {} },
    )
    const createResponse =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(
          "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/image-edit/jobs",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
            body: JSON.stringify({
              provider_id: "openai-compatible",
              source_gene_symbol: "A1BG",
              source_asset_sha256: SOURCE_SHA,
              adjustments: { remove_ai_generation_errors: true },
            }),
          },
        ),
        ownerEnv,
        { waitUntil() {} },
      )
    const created = await createResponse.json()
    const intruderEnv = buildEnv(db, { user_id: "user-2", username: "intruder" })

    const publishResponse =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(
          `https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/image-edit/jobs/${created.job.id}/publish`,
          {
            method: "POST",
            headers: { Cookie: "session=abc123" },
          },
        ),
        intruderEnv,
        { waitUntil() {} },
      )
    const publishPayload = await publishResponse.json()

    assert.equal(publishResponse.status, 404)
    assert.match(publishPayload.error, /not found/i)
    assert.equal(db.publishedAsset, undefined)
    assert.equal(db.voteImportPayload, undefined)
  } finally {
    globalThis.fetch = originalFetch
  }
})
