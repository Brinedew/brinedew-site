import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

const SOURCE_SHA = "a".repeat(64)

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
      this.sql.includes("FROM icono_generation_request_vision_option_rollup") &&
      this.sql.includes("WHERE vision_id = ?")
    ) {
      if (this.db.noVisionOption) return null
      return {
        vision_id: this.args[0],
        emulsion_id: `A1-${String(this.args[0]).replace(/\D+/g, "") || "1"}`,
        preview_assets_json: JSON.stringify([{ asset_sha256: SOURCE_SHA, gene_symbol: "A1BG" }]),
      }
    }
    if (
      this.sql.includes("WHERE requester_user_id = ?") &&
      this.sql.includes("client_request_id = ?")
    ) {
      const existing = this.db.generationRequests.find(
        (item) =>
          item.requester_user_id === this.args[0] && item.client_request_id === this.args[1],
      )
      return existing ? { id: existing.id } : null
    }
    if (this.sql.includes("WHERE gr.id = ?")) {
      const stored = this.db.generationRequests.find((item) => item.id === Number(this.args[0]))
      return {
        id: stored?.id || this.db.lastRequestId || 1,
        gene_symbol: stored?.gene_symbol || this.db.lastGenerationRequest?.gene_symbol || "A1BG",
        full_name: "alpha-1-B glycoprotein",
        requester_user_id: this.db.lastGenerationRequest?.requester_user_id || "user-1",
        requester_username: this.db.lastGenerationRequest?.requester_username || "tester",
        request_kind: this.db.lastGenerationRequest?.request_kind || "new_candidate",
        request_prompt: this.db.lastGenerationRequest?.request_prompt || "",
        source_gene_symbol: this.db.lastGenerationRequest?.source_gene_symbol || "A1BG",
        source_asset_sha256: this.db.lastGenerationRequest?.source_asset_sha256 || "",
        request_mode: this.db.lastGenerationRequest?.request_mode || "random",
        requested_vision_id: this.db.lastGenerationRequest?.requested_vision_id || "",
        request_batch_id: this.db.lastGenerationRequest?.request_batch_id || "",
        request_batch_size: this.db.lastGenerationRequest?.request_batch_size || 1,
        status: "open",
        created_at: "2026-04-25T12:00:00Z",
        updated_at: "2026-04-25T12:00:00Z",
        fulfilled_at: "",
        fulfilled_by: "",
        fulfilled_asset_sha256: "",
        fulfilled_vision_id: "",
        fulfillment_note: "",
      }
    }
    if (
      this.sql.includes("FROM icono_gene_catalog") &&
      this.sql.includes("WHERE gene_symbol = ?")
    ) {
      return {
        gene_symbol: this.args[0],
        full_name: `${this.args[0]} target gene`,
      }
    }
    if (
      this.sql.includes("FROM icono_portrait_assets") &&
      this.sql.includes("WHERE gene_symbol = ?")
    ) {
      return {
        gene_symbol: this.args[0],
        asset_sha256: this.args[1],
        r2_key_full: `portraits/v1/aa/${SOURCE_SHA}/full.webp`,
        r2_key_medium: `portraits/v1/aa/${SOURCE_SHA}/medium.webp`,
        r2_key_thumb: `portraits/v1/aa/${SOURCE_SHA}/thumb.webp`,
        mime: "image/webp",
        width: 1024,
        height: 1280,
        bytes: 4567,
        status: "draft",
        autopick_eligible: 1,
        is_stale: 0,
        is_legacy: 0,
        vision_id: "anima-v1-3001",
        emulsion_id: "A1-93-19",
        workflow_id: "A1-",
        workflow_label: "Anima",
        workflow_path: "workflows/anima.json",
        prompt_version: "93",
        variant_slot: "19",
        candidate_image_id: 123,
        created_by: "sync",
      }
    }
    return null
  }

  async all() {
    return { results: [] }
  }

  async run() {
    if (this.sql.includes("INSERT INTO icono_generation_requests")) {
      const clientRequestId = this.args[11] || ""
      const existing = clientRequestId
        ? this.db.generationRequests.find(
            (item) =>
              item.requester_user_id === this.args[1] && item.client_request_id === clientRequestId,
          )
        : null
      if (existing) return { meta: { last_row_id: 0, changes: 0 } }
      this.db.lastRequestId += 1
      this.db.lastGenerationRequest = {
        id: this.db.lastRequestId,
        gene_symbol: this.args[0],
        requester_user_id: this.args[1],
        requester_username: this.args[2],
        request_kind: this.args[3],
        request_prompt: this.args[4],
        source_gene_symbol: this.args[5],
        source_asset_sha256: this.args[6],
        request_mode: this.args[7],
        requested_vision_id: this.args[8],
        client_request_id: clientRequestId,
        request_batch_id: this.args[12],
        request_batch_size: this.args[13],
      }
      this.db.generationRequests.push(this.db.lastGenerationRequest)
      return { meta: { last_row_id: this.db.lastRequestId, changes: 1 } }
    }
    if (this.sql.includes("INSERT INTO icono_portrait_assets")) {
      this.db.copyAssetInsert = {
        target_gene_symbol: this.args[0],
        asset_sha256: this.args[1],
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
      this.db.voteProjection = {
        candidate_ref: this.args[0],
        gene_symbol: this.args[1],
        asset_sha256: this.args[2],
        user_id: this.args[5],
        vote_value: this.args[6],
      }
      return { meta: { changes: 1 } }
    }
    if (this.sql.includes("INSERT INTO icono_vote_events")) {
      this.db.voteEvent = {
        gene_symbol: this.args[0],
        asset_sha256: this.args[1],
        vote_value: this.args[5],
      }
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
  constructor({ noVisionOption = false } = {}) {
    this.lastRequestId = 76
    this.generationRequests = []
    this.noVisionOption = noVisionOption
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
          const path = new URL(request.url).pathname
          const payload = await request.json()
          if (path === "/vote/set") db.voteCoordinatorSetPayload = payload
          else db.voteCoordinatorStatePayload = payload
          return new Response(
            JSON.stringify({
              ok: true,
              resolved_vision_id: payload.vision_id || "",
              candidate_image_id: payload.candidate_image_id || null,
              final_vote_value: payload.vote_value,
              changed: true,
              mutation_id: `${payload.symbol}:1`,
              snapshot: {
                asset_sha256: payload.asset_sha256,
                user_vote: payload.vote_value,
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          )
        },
      }
    },
  }
}

function buildEnv(db = new FakeDb()) {
  return {
    ICONOPLASM_DB: db,
    GAME_SESSIONS: buildSessionBinding({ user_id: "user-1", username: "tester" }),
    ICONOPLASM_VOTE_COORDINATORS: buildVoteCoordinatorBinding(db),
  }
}

test("edit blot requests preserve prompt and source canonical asset", async () => {
  const db = new FakeDb()
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/requests",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: "session=abc123",
          },
          body: JSON.stringify({
            symbol: "A1BG",
            request_kind: "edit_image",
            request_prompt: "Fix the hands but keep the same character concept.",
            source_gene_symbol: "A1BG",
            source_asset_sha256: SOURCE_SHA,
          }),
        },
      ),
      buildEnv(db),
      { waitUntil() {} },
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(db.lastGenerationRequest.request_kind, "edit_image")
  assert.equal(
    db.lastGenerationRequest.request_prompt,
    "Fix the hands but keep the same character concept.",
  )
  assert.equal(db.lastGenerationRequest.source_gene_symbol, "A1BG")
  assert.equal(db.lastGenerationRequest.source_asset_sha256, SOURCE_SHA)
  assert.equal(payload.request.request_kind, "edit_image")
  assert.equal(payload.request.request_prompt, "Fix the hands but keep the same character concept.")
})

test("one request action queues a bounded idempotent emulsion batch", async () => {
  const db = new FakeDb()
  const requestBody = {
    symbol: "A1BG",
    request_kind: "new_candidate",
    requested_vision_ids: ["anima-v1-101", "anima-v1-102", "anima-v1-103"],
    client_batch_id: "batch-123",
  }
  const send = () =>
    handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/requests",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: "session=abc123",
          },
          body: JSON.stringify(requestBody),
        },
      ),
      buildEnv(db),
      { waitUntil() {} },
    )

  const firstResponse = await send()
  const firstPayload = await firstResponse.json()
  assert.equal(firstResponse.status, 200)
  assert.equal(firstPayload.queued_count, 3)
  assert.equal(firstPayload.failed_count, 0)
  assert.deepEqual(
    db.generationRequests.map((item) => item.requested_vision_id),
    requestBody.requested_vision_ids,
  )
  assert.ok(db.generationRequests.every((item) => item.request_batch_id === "batch-123"))
  assert.ok(db.generationRequests.every((item) => item.request_batch_size === 3))

  const retryResponse = await send()
  const retryPayload = await retryResponse.json()
  assert.equal(retryResponse.status, 200)
  assert.equal(retryPayload.queued_count, 3)
  assert.equal(db.generationRequests.length, 3, "retry must not duplicate queued work")
})

test("a preallocated emulsion queues its first blot without inventing a reference asset", async () => {
  const db = new FakeDb({ noVisionOption: true })
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/requests",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
          body: JSON.stringify({
            symbol: "TP53",
            requested_vision_ids: ["anima-v1-50817"],
            client_batch_id: "first-pablo-uchida-blot",
          }),
        },
      ),
      buildEnv(db),
      { waitUntil() {} },
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.failed_count, 0)
  assert.equal(db.generationRequests[0]?.requested_vision_id, "anima-v1-50817")
})

test("an unassigned emulsion number is rejected instead of reconstructed", async () => {
  const db = new FakeDb({ noVisionOption: true })
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/requests",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
          body: JSON.stringify({
            symbol: "TP53",
            requested_vision_ids: ["anima-v1-5000"],
            client_batch_id: "unassigned-emulsion-id",
          }),
        },
      ),
      buildEnv(db),
      { waitUntil() {} },
    )
  const payload = await response.json()

  assert.equal(response.status, 400)
  assert.match(JSON.stringify(payload), /not assigned/i)
  assert.equal(db.generationRequests.length, 0)
})

test("emulsion request batches reject more than twenty selections before writing", async () => {
  const db = new FakeDb()
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/requests",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: "session=abc123",
          },
          body: JSON.stringify({
            symbol: "A1BG",
            requested_vision_ids: Array.from({ length: 21 }, (_, index) => `anima-v1-${index}`),
            client_batch_id: "batch-too-large",
          }),
        },
      ),
      buildEnv(db),
      { waitUntil() {} },
    )

  assert.equal(response.status, 400)
  assert.equal(db.generationRequests.length, 0)
})

test("copy candidate endpoint adds target candidate and auto-checkmarks it", async () => {
  const db = new FakeDb()
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/candidates/copy",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: "session=abc123",
          },
          body: JSON.stringify({
            source_gene_symbol: "A1BG",
            target_gene_symbol: "INS",
            asset_sha256: SOURCE_SHA,
          }),
        },
      ),
      buildEnv(db),
      { waitUntil() {} },
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.ok, true)
  assert.equal(db.copyAssetInsert.target_gene_symbol, "INS")
  assert.equal(db.copyAssetInsert.asset_sha256, SOURCE_SHA)
  assert.equal(db.copyAssetInsert.created_by, "user-1")
  assert.equal(db.publishEvent.gene_symbol, "INS")
  assert.equal(db.voteCoordinatorSetPayload.symbol, "INS")
  assert.equal(db.voteCoordinatorSetPayload.asset_sha256, SOURCE_SHA)
  assert.equal(db.voteCoordinatorSetPayload.vote_value, 1)
  assert.equal(db.voteProjection, undefined)
  assert.equal(payload.auto_promote.mode, "durable_outbox")
  assert.equal(payload.auto_promote.mutation_id, "INS:1")
  assert.equal(payload.target_url, "/gene/INS")
})

test("candidate copy action stays in the compact candidate footer strip", () => {
  const app = readFileSync(new URL("../quartz/static/iconoplasm/app.js", import.meta.url), "utf8")
  const css = readFileSync(
    new URL("../quartz/static/iconoplasm/styles.css", import.meta.url),
    "utf8",
  )

  assert.match(app, /icono-candidate-secondary-actions/)
  assert.match(app, /Copy to gene/)
  assert.match(app, /Copy blot/)
  assert.doesNotMatch(app, /<summary>copy this image to another gene<\/summary>/)
  assert.match(css, /\.icono-candidate-secondary-actions/)
  assert.match(
    css,
    /\.icono-candidate-secondary-actions\s*\{[\s\S]*?flex-wrap:\s*nowrap;[\s\S]*?min-inline-size:\s*4\.9rem;[\s\S]*?\}/,
    "the no-reflow footer should reserve exactly the two public actions instead of an empty third slot",
  )
  assert.doesNotMatch(
    css,
    /\.icono-candidate-secondary-actions\s*\{[\s\S]*?min-inline-size:\s*7\.55rem;[\s\S]*?\}/,
    "the admin-only remove slot must not starve public Sample and Emulsion labels",
  )
  assert.match(css, /\.icono-candidate-copy-panel\[open\]/)
})
