import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

const SOURCE_SHA = "a".repeat(64)
const EDITED_BYTES = new TextEncoder().encode("edited-webp-bytes")
const GENERATED_BYTES = new TextEncoder().encode("generated-webp-bytes")
const REFERENCE_SHA_1 = "b".repeat(64)
const REFERENCE_SHA_2 = "c".repeat(64)

function base64(bytes) {
  return Buffer.from(bytes).toString("base64")
}

function syntheticExtendedWebpWithLeadingChunk(width, height) {
  const widthMinusOne = width - 1
  const heightMinusOne = height - 1
  return Uint8Array.from([
    0x52,
    0x49,
    0x46,
    0x46,
    0x24,
    0x00,
    0x00,
    0x00,
    0x57,
    0x45,
    0x42,
    0x50,
    0x45,
    0x58,
    0x49,
    0x46,
    0x04,
    0x00,
    0x00,
    0x00,
    0x74,
    0x65,
    0x73,
    0x74,
    0x56,
    0x50,
    0x38,
    0x58,
    0x0a,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    widthMinusOne & 0xff,
    (widthMinusOne >> 8) & 0xff,
    (widthMinusOne >> 16) & 0xff,
    heightMinusOne & 0xff,
    (heightMinusOne >> 8) & 0xff,
    (heightMinusOne >> 16) & 0xff,
  ])
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
      this.sql.includes("FROM iconoplasm_user_emulsion_versions") &&
      this.sql.includes("public_id = ?")
    ) {
      const publicId = String(this.args[0] || "")
      return this.db.userEmulsionVersions.get(publicId) || null
    }
    if (this.sql.includes("FROM users") && this.sql.includes("discord_id = ?")) {
      return this.db.users.get(this.args[0]) || null
    }
    if (this.sql.includes("FROM users") && this.sql.includes("iconoplasm_emulsion_public_id = ?")) {
      const publicId = String(this.args[0] || "")
      for (const row of this.db.users.values()) {
        if (String(row.iconoplasm_emulsion_public_id || "") === publicId) return row
      }
      return null
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
    if (
      this.sql.includes("FROM icono_candidate_generation_jobs") &&
      this.sql.includes("WHERE id = ?")
    ) {
      const row = this.db.candidateGenerationJobs.get(this.args[0]) || null
      if (row && this.sql.includes("user_id = ?") && row.user_id !== this.args[1]) return null
      return row
    }
    if (this.sql.includes("FROM icono_generation_request_vision_option_rollup")) {
      return {
        vision_id: "anima-v1-3001",
        emulsion_id: "A1-93-19",
        artist_tag: "@anima",
        artist_name: "Anima Archive",
        workflow_id: "A1",
        workflow_label: "Anima v1",
        prompt_version: "93",
        variant_slot: "19",
        image_count: 8,
        live_count: 6,
        score: 5,
        vote_h_index: 4,
        preview_assets_json: JSON.stringify([
          {
            gene_symbol: "INS",
            asset_sha256: REFERENCE_SHA_1,
            is_current: true,
            preview_rank: 1,
          },
          {
            gene_symbol: "RHO",
            asset_sha256: REFERENCE_SHA_2,
            is_current: false,
            preview_rank: 2,
          },
        ]),
      }
    }
    if (
      this.sql.includes("FROM icono_gene_comments") &&
      this.sql.includes("COUNT(*)") &&
      this.sql.includes("user_id = ?")
    ) {
      const userId = String(this.args[0] || "")
      const sinceIso = String(this.args[1] || "")
      const n = this.db.geneComments.filter(
        (row) => String(row.user_id || "") === userId && String(row.created_at || "") > sinceIso,
      ).length
      return { n }
    }
    if (this.sql.includes("FROM icono_gene_catalog gc") && this.sql.includes("manifestation")) {
      return (
        this.db.geneContext || {
          gene_symbol: "A1BG",
          full_name: "Alpha-1-B Glycoprotein",
          manifestation:
            "A1BG appears as a calm archivist with pearl varnish and measured posture.",
          sample_label: "A1BG-7",
          sample_number: 7,
          sample_text_hash: "d".repeat(64),
        }
      )
    }
    return null
  }

  async all() {
    if (
      this.sql.includes("FROM iconoplasm_user_emulsion_versions") &&
      this.sql.includes("user_id = ?")
    ) {
      const userId = String(this.args[0] || "")
      return {
        results: Array.from(this.db.userEmulsionVersions.values())
          .filter((row) => row.user_id === userId)
          .sort((a, b) => Number(b.revision || 0) - Number(a.revision || 0)),
      }
    }
    if (
      this.sql.includes("FROM iconoplasm_user_emulsion_versions") &&
      this.sql.includes("revision > 0")
    ) {
      return {
        results: Array.from(this.db.userEmulsionVersions.values()).filter((row) =>
          String(row.emulsion_text || "").trim(),
        ),
      }
    }
    if (this.sql.includes("FROM users") && this.sql.includes("iconoplasm_emulsion_revision")) {
      const revision = Number(this.args[0] || 0) || 0
      return {
        results: Array.from(this.db.users.values()).filter(
          (row) =>
            Number(row.iconoplasm_emulsion_revision || 0) === revision &&
            String(row.iconoplasm_emulsion_text || "").trim(),
        ),
      }
    }
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
    if (this.sql.includes("INSERT OR IGNORE INTO iconoplasm_user_emulsion_versions")) {
      const row = {
        user_id: this.args[0],
        username: this.args[1],
        public_id: this.args[2],
        revision: this.args[3],
        emulsion_text: this.args[4],
        created_at: this.args[5],
      }
      if (!this.db.userEmulsionVersions.has(row.public_id)) {
        this.db.userEmulsionVersions.set(row.public_id, row)
      }
      return { meta: { changes: 1 } }
    }
    if (this.sql.includes("INSERT INTO users") && this.sql.includes("iconoplasm_emulsion_text")) {
      const row = this.db.users.get(this.args[0]) || {
        discord_id: this.args[0],
        username: this.args[1],
        iconoplasm_emulsion_text: "",
        iconoplasm_emulsion_revision: 0,
      }
      row.username = this.args[1]
      row.iconoplasm_emulsion_text = this.args[4]
      row.iconoplasm_emulsion_revision = this.args[5]
      row.iconoplasm_emulsion_public_id = this.args[6]
      this.db.users.set(row.discord_id, row)
      return { meta: { changes: 1 } }
    }
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
    if (this.sql.includes("INSERT INTO icono_image_edit_prompt_templates")) {
      const existing = this.db.promptTemplates.get(this.args[0]) || {
        kind: this.args[0],
        created_at: "2026-05-16T00:00:00.000Z",
      }
      const row = {
        ...existing,
        kind: this.args[0],
        prompt_template: this.args[1],
        updated_by: this.args[2],
        updated_at: "2026-05-16T00:00:01.000Z",
      }
      this.db.promptTemplates.set(row.kind, row)
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
        gene_full_name: this.args[8],
        manifestation: this.args[9],
        sample_label: this.args[10],
        sample_number: this.args[11],
        sample_text_hash: this.args[12],
        reference_assets_json: this.args[13],
        prompt_body_mode: this.args[14],
        community_comments_snapshot: this.args[15],
        prompt: this.args[16],
        status: this.args[17],
        created_at: "2026-05-16T00:00:00.000Z",
        updated_at: "2026-05-16T00:00:00.000Z",
      }
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
    if (
      this.sql.includes("UPDATE icono_candidate_generation_jobs") &&
      this.sql.includes("status = 'failed'")
    ) {
      const row = this.db.candidateGenerationJobs.get(this.args[1])
      Object.assign(row, { status: "failed", error: this.args[0] })
      return { meta: { changes: 1 } }
    }
    if (
      this.sql.includes("UPDATE icono_candidate_generation_jobs") &&
      this.sql.includes("published_at")
    ) {
      const row = this.db.candidateGenerationJobs.get(this.args[0])
      row.published_at = "2026-05-16T00:00:02.000Z"
      return { meta: { changes: 1 } }
    }
    if (this.sql.includes("UPDATE icono_image_edit_jobs") && this.sql.includes("published_at")) {
      const row = this.db.jobs.get(this.args[0])
      row.published_at = "2026-05-16T00:00:02.000Z"
      return { meta: { changes: 1 } }
    }
    if (this.sql.includes("INSERT INTO icono_portrait_assets")) {
      const isImageEdit = this.sql.includes("'image-edit'")
      this.db.publishedAsset = {
        gene_symbol: this.args[0],
        asset_sha256: this.args[1],
        r2_key_full: this.args[2],
        r2_key_medium: this.args[3],
        r2_key_thumb: this.args[4],
        vision_id: this.args[9],
        emulsion_id: isImageEdit ? (this.args[10] ?? null) : this.args[10],
        sample_label: isImageEdit
          ? (this.args[11] ?? null)
          : this.sql.includes("'image-gen'")
            ? (this.args[11] ?? null)
            : null,
        sample_number: isImageEdit
          ? (this.args[12] ?? null)
          : this.sql.includes("'image-gen'")
            ? (this.args[12] ?? null)
            : null,
        sample_text_hash: isImageEdit
          ? (this.args[13] ?? null)
          : this.sql.includes("'image-gen'")
            ? (this.args[13] ?? null)
            : null,
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
    if (this.sql.includes("INSERT INTO icono_gene_comments")) {
      const id = ++this.db.geneCommentsLastId
      this.db.geneComments.push({
        id,
        gene_symbol: this.args[0],
        user_id: this.args[1],
        username: this.args[2],
        avatar_url: this.args[3],
        body: this.args[4],
        status: "visible",
        created_at: new Date().toISOString(),
        updated_at: "",
      })
      return { meta: { changes: 1, last_row_id: id } }
    }
    if (this.sql.includes("UPDATE icono_gene_comments") && this.sql.includes("status = 'deleted'")) {
      // Soft delete: SET status='deleted', updated_at=? WHERE id=? AND user_id=? AND status='visible'
      const updatedAt = this.args[0]
      const commentId = Number(this.args[1] || 0)
      const userId = String(this.args[2] || "")
      const row = this.db.geneComments.find(
        (r) =>
          Number(r.id) === commentId &&
          String(r.user_id || "") === userId &&
          String(r.status || "") === "visible",
      )
      if (!row) return { meta: { changes: 0 } }
      row.status = "deleted"
      row.updated_at = updatedAt
      return { meta: { changes: 1 } }
    }
    if (this.sql.includes("UPDATE icono_gene_comments") && this.sql.includes("SET body = ?")) {
      // Edit: SET body=?, updated_at=? WHERE id=? AND user_id=? AND gene_symbol=? AND status='visible'
      const newBody = this.args[0]
      const updatedAt = this.args[1]
      const commentId = Number(this.args[2] || 0)
      const userId = String(this.args[3] || "")
      const row = this.db.geneComments.find(
        (r) =>
          Number(r.id) === commentId &&
          String(r.user_id || "") === userId &&
          String(r.status || "") === "visible",
      )
      if (!row) return { meta: { changes: 0 } }
      row.body = newBody
      row.updated_at = updatedAt
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
    this.geneContext = null
    this.geneComments = []
    this.geneCommentsLastId = 0
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

function buildEnv(db = new FakeDb(), session = { user_id: "user-1", username: "tester" }) {
  return {
    DB: db,
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

test("user emulsion settings store the current Discord-owned emulsion revision", async () => {
  const db = new FakeDb()
  const env = buildEnv(db)

  const initialResponse =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/user-emulsion",
        {
          headers: { Cookie: "session=abc123" },
        },
      ),
      env,
      { waitUntil() {} },
    )
  const initial = await initialResponse.json()
  assert.equal(initialResponse.status, 200)
  assert.equal(initial.emulsion.id, "TESTER-0")
  assert.equal(initial.emulsion.text, "")
  assert.equal(initial.emulsion.max_length, 140)

  const savedResponse =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/user-emulsion",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
          body: JSON.stringify({ emulsion: "cyan rim light, quiet archival scan texture" }),
        },
      ),
      env,
      { waitUntil() {} },
    )
  const saved = await savedResponse.json()
  assert.equal(savedResponse.status, 200)
  assert.equal(saved.emulsion.id, "TESTER-1")
  assert.equal(saved.emulsion.text, "cyan rim light, quiet archival scan texture")
  assert.equal(saved.history.length, 1)
  assert.equal(saved.history[0].id, "TESTER-1")

  const clearedResponse =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/user-emulsion",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
          body: JSON.stringify({ emulsion: "" }),
        },
      ),
      env,
      { waitUntil() {} },
    )
  const cleared = await clearedResponse.json()
  assert.equal(clearedResponse.status, 200)
  assert.equal(cleared.emulsion.id, "TESTER-0")
  assert.equal(cleared.emulsion.text, "")
  assert.equal(cleared.history[0].id, "TESTER-1")
})

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
            provider_id: "openai",
            api_key: "sk-test-secret",
            endpoint_url: "https://api.openai.com/v1",
            model: "gpt-image-2",
          }),
        },
      ),
      env,
      { waitUntil() {} },
    )
  const saved = await saveResponse.json()

  assert.equal(saveResponse.status, 200)
  assert.equal(saved.provider.provider_id, "openai")
  assert.equal(saved.provider.configured, true)
  const stored = db.providerRows.get("user-1|openai")
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
  assert.equal(listed.providers[0].provider_id, "openai")
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
    ["openai"],
  )
  assert.ok(
    !filtered.supported_providers.some((provider) => provider.provider_id === "openai-compatible"),
  )
  assert.ok(filtered.supported_providers.some((provider) => provider.provider_id === "openai"))
  assert.ok(filtered.supported_providers.some((provider) => provider.provider_id === "krea"))
  assert.ok(filtered.supported_providers.some((provider) => provider.provider_id === "gemini"))
  assert.ok(filtered.supported_providers.some((provider) => provider.provider_id === "luma"))
  const gemini = filtered.supported_providers.find((provider) => provider.provider_id === "gemini")
  assert.ok(gemini.model_options.some((option) => option.model === "gemini-3.1-flash-image"))
  assert.match(
    gemini.model_options.find((option) => option.model === "gemini-3.1-flash-image").pricing_label,
    /\$0\.039\/image/,
  )
})

test("OpenAI is a first-class BYOK image provider with model pricing and Image API requests", async () => {
  const originalFetch = globalThis.fetch
  const originalSetTimeout = globalThis.setTimeout
  const db = new FakeDb()
  const env = buildEnv(db)
  const fetchCalls = []
  const timeoutDelays = []
  globalThis.setTimeout = (callback, delay, ...args) => {
    timeoutDelays.push(delay)
    return originalSetTimeout(callback, delay, ...args)
  }
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    fetchCalls.push({ url, init })
    if (url === "https://api.openai.com/v1/images/edits") {
      assert.equal(init.headers.Authorization, "Bearer sk-openai-test-secret")
      assert.equal(init.body.get("model"), "gpt-image-2")
      assert.equal(init.body.get("size"), "1536x2048")
      assert.equal(init.body.get("quality"), "high")
      assert.equal(init.body.get("output_format"), "webp")
      assert.match(init.body.get("prompt"), /3:4 vertical Iconoplasm blot/)
      assert.match(init.body.get("prompt"), /1536x2048 px/)
      assert.equal(init.body.getAll("image").length, 1)
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
    const listResponse =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(
          "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/image-edit/providers",
          { headers: { Cookie: "session=abc123" } },
        ),
        env,
        { waitUntil() {} },
      )
    const listed = await listResponse.json()
    const openaiProvider = listed.supported_providers.find(
      (provider) => provider.provider_id === "openai",
    )
    assert.ok(openaiProvider)
    assert.equal(openaiProvider.default_endpoint_url, "https://api.openai.com/v1")
    assert.ok(
      openaiProvider.model_options.some(
        (option) => option.model === "gpt-image-2" && option.pricing_label === "~$0.21/image",
      ),
    )
    assert.deepEqual(
      openaiProvider.model_options.map((option) => option.model),
      ["gpt-image-2"],
    )

    const saveResponse =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(
          "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/image-edit/providers",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
            body: JSON.stringify({
              provider_id: "openai",
              api_key: "sk-openai-test-secret",
              model: "gpt-image-2",
            }),
          },
        ),
        env,
        { waitUntil() {} },
      )
    const saved = await saveResponse.json()
    assert.equal(saveResponse.status, 200)
    assert.equal(saved.provider.provider_id, "openai")
    assert.equal(saved.provider.endpoint_url, "https://api.openai.com/v1")
    assert.equal(saved.provider.model, "gpt-image-2")
    assert.equal(saved.provider.pricing_label, "~$0.21/image")

    const createResponse =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(
          "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/image-edit/jobs",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
            body: JSON.stringify({
              provider_id: "openai",
              source_gene_symbol: "A1BG",
              source_asset_sha256: SOURCE_SHA,
              adjustments: { remove_ai_generation_errors: true },
            }),
          },
        ),
        env,
        { waitUntil() {} },
      )
    const created = await createResponse.json()
    assert.equal(createResponse.status, 200)
    assert.equal(created.job.status, "succeeded")
    assert.ok(created.job.result_asset_sha256)
    assert.equal(fetchCalls[0].url, "https://api.openai.com/v1/images/edits")
    assert.ok(
      timeoutDelays.includes(600_000),
      `OpenAI image edit should use the shared 10-minute provider timeout, saw ${timeoutDelays.join(", ")}`,
    )
  } finally {
    globalThis.fetch = originalFetch
    globalThis.setTimeout = originalSetTimeout
  }
})

test("image provider timeout policy does not cap slow providers at two minutes", () => {
  const source = readFileSync(
    new URL(
      "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
      import.meta.url,
    ),
    "utf8",
  )
  assert.match(source, /ICONOPLASM_IMAGE_PROVIDER_TIMEOUT_MS = 10 \* 60 \* 1000/)
  assert.doesNotMatch(source, /Math\.min\(\s*120_000/)
})

test("OpenAI image provider rejects obsolete GPT Image models", async () => {
  const originalFetch = globalThis.fetch
  const db = new FakeDb()
  const env = buildEnv(db)
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/image-edit/providers",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
          body: JSON.stringify({
            provider_id: "openai",
            api_key: "sk-openai-test-secret",
            model: "gpt-image-1.5",
          }),
        },
      ),
      env,
      { waitUntil() {} },
    )
  const body = await response.json()

  assert.equal(response.status, 400)
  assert.equal(body.ok, false)
  assert.match(body.error, /Provider model is required/)

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    if (url === "https://api.openai.com/v1/images/edits") {
      assert.equal(init.body.get("model"), "gpt-image-2")
      assert.equal(init.body.get("size"), "1536x2048")
      assert.equal(init.body.get("quality"), "high")
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
    const saveResponse =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(
          "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/image-edit/providers",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
            body: JSON.stringify({
              provider_id: "openai",
              api_key: "sk-openai-test-secret",
              model: "gpt-image-2",
            }),
          },
        ),
        env,
        { waitUntil() {} },
      )
    assert.equal(saveResponse.status, 200)
    db.providerRows.get("user-1|openai").model = "gpt-image-1.5"

    const createResponse =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(
          "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/image-edit/jobs",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
            body: JSON.stringify({
              provider_id: "openai",
              source_gene_symbol: "A1BG",
              source_asset_sha256: SOURCE_SHA,
              adjustments: { remove_ai_generation_errors: true },
            }),
          },
        ),
        env,
        { waitUntil() {} },
      )
    assert.equal(createResponse.status, 200)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("candidate generation jobs use novel provider generation and publish explicitly", async () => {
  const originalFetch = globalThis.fetch
  const db = new FakeDb()
  const env = buildEnv(db)
  const fetchCalls = []
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    fetchCalls.push({ url, init })
    if (url === "https://api.openai.com/v1/images/generations") {
      assert.equal(init.headers.Authorization, "Bearer sk-test-secret")
      const body = JSON.parse(String(init.body || "{}"))
      assert.equal(body.model, "gpt-image-2")
      assert.match(String(body.prompt || ""), /Alpha-1-B Glycoprotein/)
      assert.match(String(body.prompt || ""), /calm archivist/)
      assert.match(String(body.prompt || ""), /Reference images: none/)
      assert.doesNotMatch(String(body.prompt || ""), /A1-93-19/)
      return new Response(JSON.stringify({ data: [{ b64_json: base64(GENERATED_BYTES) }] }), {
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
            provider_id: "openai",
            api_key: "sk-test-secret",
            endpoint_url: "https://api.openai.com/v1",
            model: "gpt-image-2",
          }),
        },
      ),
      env,
      { waitUntil() {} },
    )

    const createResponse =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(
          "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/candidate-generation/jobs",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
            body: JSON.stringify({
              provider_id: "openai",
              symbol: "A1BG",
              request_mode: "novel",
            }),
          },
        ),
        env,
        { waitUntil() {} },
      )
    const created = await createResponse.json()

    assert.equal(createResponse.status, 200)
    assert.equal(created.job.status, "succeeded")
    assert.equal(created.job.gene_symbol, "A1BG")
    assert.equal(created.job.request_mode, "novel")
    assert.equal(created.job.requested_emulsion_label, "TESTER-0")
    assert.equal(created.job.requested_emulsion_id, "TESTER-0")
    assert.equal(created.job.requested_vision_id, "")
    assert.equal(created.job.prompt_body_mode, "prose_sample")
    assert.equal(created.job.sample_label, "A1BG-7")
    assert.equal("prompt" in created.job, false)
    assert.equal(created.job.reference_assets.length, 0)
    assert.ok(created.job.result_asset_sha256)
    assert.equal(env.ICONOPLASM_PORTRAITS.puts.length, 3)
    assert.equal(fetchCalls[0].url, "https://api.openai.com/v1/images/generations")

    const publishResponse =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(
          `https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/candidate-generation/jobs/${created.job.id}/publish`,
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
    assert.match(db.publishedAsset.vision_id, /^image-gen:/)
    assert.equal(db.voteImportPayload.items.length, 1)
    assert.equal(db.voteImportPayload.items[0].user_id, "user-1")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("candidate generation appends the signed-in user's saved emulsion and publishes with the user emulsion id", async () => {
  const originalFetch = globalThis.fetch
  const db = new FakeDb()
  db.users.set("user-1", {
    discord_id: "user-1",
    username: "tester",
    iconoplasm_emulsion_text: "cyan rim light, quiet archival scan texture",
    iconoplasm_emulsion_revision: 2,
  })
  const env = buildEnv(db)
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    if (url === "https://api.openai.com/v1/images/generations") {
      const body = JSON.parse(String(init.body || "{}"))
      const prompt = String(body.prompt || "")
      assert.match(prompt, /User emulsion:/)
      assert.match(prompt, /cyan rim light, quiet archival scan texture/)
      return new Response(JSON.stringify({ data: [{ b64_json: base64(GENERATED_BYTES) }] }), {
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
            provider_id: "openai",
            api_key: "sk-test-secret",
            endpoint_url: "https://api.openai.com/v1",
            model: "gpt-image-2",
          }),
        },
      ),
      env,
      { waitUntil() {} },
    )

    const createResponse =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(
          "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/candidate-generation/jobs",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
            body: JSON.stringify({
              provider_id: "openai",
              symbol: "A1BG",
              request_mode: "novel",
            }),
          },
        ),
        env,
        { waitUntil() {} },
      )
    const created = await createResponse.json()
    assert.equal(createResponse.status, 200)
    assert.equal(created.job.requested_emulsion_id, "TESTER-2")
    assert.equal(created.job.requested_emulsion_label, "TESTER-2")

    const publishResponse =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(
          `https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/candidate-generation/jobs/${created.job.id}/publish`,
          {
            method: "POST",
            headers: { Cookie: "session=abc123" },
          },
        ),
        env,
        { waitUntil() {} },
      )
    assert.equal(publishResponse.status, 200)
    assert.equal(db.publishedAsset.emulsion_id, "TESTER-2")
    assert.match(db.publishedAsset.vision_id, /^image-gen:/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("candidate generation can use another user's selected emulsion without local references", async () => {
  const originalFetch = globalThis.fetch
  const db = new FakeDb()
  db.users.set("user-2", {
    discord_id: "user-2",
    username: "loweren",
    iconoplasm_emulsion_text: "cyan rim light, quiet archival scan texture",
    iconoplasm_emulsion_revision: 2,
    iconoplasm_emulsion_public_id: "LOWEREN-2",
  })
  const env = buildEnv(db)
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    if (url === "https://api.openai.com/v1/images/generations") {
      const body = JSON.parse(String(init.body || "{}"))
      const prompt = String(body.prompt || "")
      assert.match(prompt, /User emulsion:/)
      assert.match(prompt, /cyan rim light, quiet archival scan texture/)
      assert.match(prompt, /Reference images: none/)
      return new Response(JSON.stringify({ data: [{ b64_json: base64(GENERATED_BYTES) }] }), {
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
            provider_id: "openai",
            api_key: "sk-test-secret",
            endpoint_url: "https://api.openai.com/v1",
            model: "gpt-image-2",
          }),
        },
      ),
      env,
      { waitUntil() {} },
    )

    const createResponse =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(
          "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/candidate-generation/jobs",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
            body: JSON.stringify({
              provider_id: "openai",
              symbol: "A1BG",
              request_mode: "novel",
              user_emulsion_id: "LOWEREN-2",
            }),
          },
        ),
        env,
        { waitUntil() {} },
      )
    const created = await createResponse.json()
    assert.equal(createResponse.status, 200)
    assert.equal(created.job.requested_emulsion_id, "LOWEREN-2")
    assert.equal(created.job.reference_assets.length, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("candidate generation stores actual WebP dimensions when provider output has leading metadata chunks", async () => {
  const originalFetch = globalThis.fetch
  const generatedWebp = syntheticExtendedWebpWithLeadingChunk(1024, 1536)
  const db = new FakeDb()
  const env = buildEnv(db)
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    if (url === "https://api.openai.com/v1/images/generations") {
      return new Response(JSON.stringify({ data: [{ b64_json: base64(generatedWebp) }] }), {
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
            provider_id: "openai",
            api_key: "sk-test-secret",
            endpoint_url: "https://api.openai.com/v1",
            model: "gpt-image-2",
          }),
        },
      ),
      env,
      { waitUntil() {} },
    )

    const createResponse =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(
          "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/candidate-generation/jobs",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
            body: JSON.stringify({
              provider_id: "openai",
              symbol: "A1BG",
              request_mode: "novel",
            }),
          },
        ),
        env,
        { waitUntil() {} },
      )
    const created = await createResponse.json()
    const storedJob = db.candidateGenerationJobs.get(created.job.id)

    assert.equal(createResponse.status, 200)
    assert.equal(storedJob.result_width, 1024)
    assert.equal(storedJob.result_height, 1536)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("candidate generation labels legacy current manifestations with sample zero", async () => {
  const originalFetch = globalThis.fetch
  const db = new FakeDb()
  db.geneContext = {
    gene_symbol: "A1BG",
    full_name: "Alpha-1-B Glycoprotein",
    manifestation: "This prose exists before the sample ID system.",
    sample_label: "",
    sample_number: 0,
    sample_text_hash: "",
  }
  const env = buildEnv(db)
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    if (url === "https://api.openai.com/v1/images/generations") {
      const body = JSON.parse(String(init.body || "{}"))
      const prompt = String(body.prompt || "")
      assert.match(prompt, /before the sample ID system/)
      assert.match(prompt, /Reference images: none/)
      return new Response(JSON.stringify({ data: [{ b64_json: base64(GENERATED_BYTES) }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }
    if (init?.cf?.image?.format === "webp" && !init?.cf?.image?.width) {
      return new Response(GENERATED_BYTES, {
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
          headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
          body: JSON.stringify({
            provider_id: "openai",
            api_key: "sk-test-secret",
            endpoint_url: "https://api.openai.com/v1",
            model: "gpt-image-2",
          }),
        },
      ),
      env,
      { waitUntil() {} },
    )

    const response =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(
          "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/candidate-generation/jobs",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
            body: JSON.stringify({
              provider_id: "openai",
              symbol: "A1BG",
              request_mode: "novel",
            }),
          },
        ),
        env,
        { waitUntil() {} },
      )
    const body = await response.json()

    assert.equal(response.status, 200)
    assert.equal(body.job.sample_label, "A1BG-0")
    assert.equal(body.job.sample_number, 0)
    assert.equal(body.job.request_mode, "novel")
    assert.match(body.job.sample_text_hash, /^[a-f0-9]{64}$/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("candidate generation can use tag sample mode with appended essence facts", async () => {
  const originalFetch = globalThis.fetch
  const db = new FakeDb()
  db.geneContext = {
    gene_symbol: "A1BG",
    full_name: "Alpha-1-B Glycoprotein",
    manifestation: "A prose body that should not be used for tags mode.",
    manifestation_tags: "pearl_archivist, measured_posture",
    weight_kg: 75,
    sex: "female",
    age_years: 39,
    faction: "Growth-aligned",
    skin_hex: "#7cc7b2",
    skin_name: "seafoam",
    family_feature: "glass harmonics",
    aesthetics_json: JSON.stringify(["Tropical Night Blue"]),
    sample_label: "A1BG-7",
    sample_number: 7,
    sample_text_hash: "d".repeat(64),
  }
  const env = buildEnv(db)
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    if (url === "https://api.openai.com/v1/images/generations") {
      const body = JSON.parse(String(init.body || "{}"))
      assert.match(String(body.prompt || ""), /Prompt body mode: tags sample/)
      assert.match(String(body.prompt || ""), /pearl_archivist, measured_posture/)
      assert.match(String(body.prompt || ""), /39 years old/)
      assert.match(String(body.prompt || ""), /75 kg/)
      assert.match(String(body.prompt || ""), /Tropical Night Blue/)
      assert.doesNotMatch(String(body.prompt || ""), /A prose body/)
      return new Response(JSON.stringify({ data: [{ b64_json: base64(GENERATED_BYTES) }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }
    if (init?.cf?.image?.format === "webp" && !init?.cf?.image?.width) {
      return new Response(GENERATED_BYTES, {
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
          headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
          body: JSON.stringify({
            provider_id: "openai",
            api_key: "sk-test-secret",
            endpoint_url: "https://api.openai.com/v1",
            model: "gpt-image-2",
          }),
        },
      ),
      env,
      { waitUntil() {} },
    )

    const response =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(
          "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/candidate-generation/jobs",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
            body: JSON.stringify({
              provider_id: "openai",
              symbol: "A1BG",
              request_mode: "novel",
              prompt_body_mode: "tags_sample",
            }),
          },
        ),
        env,
        { waitUntil() {} },
      )
    const body = await response.json()

    assert.equal(response.status, 200)
    assert.equal(body.job.prompt_body_mode, "tags_sample")
    assert.equal(body.job.sample_label, "A1BG-7")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("gene comments are public to read, authenticated to write, and hidden comments stay out", async () => {
  const db = new FakeDb()
  const env = buildEnv(db, {
    user_id: "user-1",
    username: "tester",
    avatar_url: "/api/avatars/user-1.png",
    expires_at: Date.now() + 60_000,
  })

  db.geneComments = [
    {
      id: 1,
      gene_symbol: "A1BG",
      user_id: "user-2",
      username: "visible-user",
      avatar_url: "/api/avatars/user-2.png",
      body: "Should have an eraser instead of a pen.",
      status: "visible",
      created_at: "2026-05-16T00:00:00.000Z",
      updated_at: "2026-05-16T00:00:00.000Z",
    },
    {
      id: 2,
      gene_symbol: "A1BG",
      user_id: "user-3",
      username: "hidden-user",
      avatar_url: "/api/avatars/user-3.png",
      body: "This hidden prompt should never render.",
      status: "hidden",
      created_at: "2026-05-16T00:00:01.000Z",
      updated_at: "2026-05-16T00:00:01.000Z",
    },
  ]

  const readResponse =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/comments/gene/A1BG",
      ),
      env,
      { waitUntil() {} },
    )
  const readBody = await readResponse.json()

  assert.equal(readResponse.status, 200)
  assert.equal(readBody.authenticated, false)
  assert.equal(readBody.comments.length, 1)
  assert.equal(readBody.comments[0].body, "Should have an eraser instead of a pen.")
  assert.equal(readBody.comments[0].avatar_url, "/api/avatars/user-2.png")

  const guestWrite =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/comments",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol: "A1BG", body: "Please add a lab stamp." }),
        },
      ),
      buildEnv(db, {}),
      { waitUntil() {} },
    )
  assert.equal(guestWrite.status, 401)

  const writeResponse =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/comments",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
          body: JSON.stringify({ symbol: "A1BG", body: "Please add a lab stamp." }),
        },
      ),
      env,
      { waitUntil() {} },
    )
  const writeBody = await writeResponse.json()

  assert.equal(writeResponse.status, 200)
  assert.equal(writeBody.comment.username, "tester")
  assert.equal(writeBody.comment.avatar_url, "/api/avatars/user-1.png")
  assert.equal(writeBody.comment.body, "Please add a lab stamp.")
  assert.equal(db.geneComments.at(-1).gene_symbol, "A1BG")
})

test("candidate generation includes bounded non-hidden community comments and snapshots them", async () => {
  const originalFetch = globalThis.fetch
  const db = new FakeDb()
  db.geneComments = [
    {
      id: 1,
      gene_symbol: "A1BG",
      user_id: "user-2",
      username: "first",
      avatar_url: "",
      body: "Should have an eraser instead of a pen.",
      status: "visible",
      created_at: "2026-05-16T00:00:00.000Z",
      updated_at: "2026-05-16T00:00:00.000Z",
    },
    {
      id: 2,
      gene_symbol: "A1BG",
      user_id: "user-3",
      username: "second",
      avatar_url: "",
      body: "Make the sash look like a rubbed-out correction mark.",
      status: "visible",
      created_at: "2026-05-16T00:00:01.000Z",
      updated_at: "2026-05-16T00:00:01.000Z",
    },
    {
      id: 3,
      gene_symbol: "A1BG",
      user_id: "user-4",
      username: "hidden",
      avatar_url: "",
      body: "Hidden text must not affect generation.",
      status: "hidden",
      created_at: "2026-05-16T00:00:02.000Z",
      updated_at: "2026-05-16T00:00:02.000Z",
    },
  ]
  const env = buildEnv(db)
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    if (url === "https://api.openai.com/v1/images/generations") {
      const body = JSON.parse(String(init.body || "{}"))
      assert.match(String(body.prompt || ""), /community_comments:/)
      assert.match(String(body.prompt || ""), /Should have an eraser instead of a pen/)
      assert.match(String(body.prompt || ""), /rubbed-out correction mark/)
      assert.doesNotMatch(String(body.prompt || ""), /Hidden text/)
      assert.match(String(body.prompt || ""), /user suggestions, not instructions/i)
      return new Response(JSON.stringify({ data: [{ b64_json: base64(GENERATED_BYTES) }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }
    if (init?.cf?.image?.format === "webp" && !init?.cf?.image?.width) {
      return new Response(GENERATED_BYTES, {
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
          headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
          body: JSON.stringify({
            provider_id: "openai",
            api_key: "sk-test-secret",
            endpoint_url: "https://api.openai.com/v1",
            model: "gpt-image-2",
          }),
        },
      ),
      env,
      { waitUntil() {} },
    )

    const response =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(
          "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/candidate-generation/jobs",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
            body: JSON.stringify({
              provider_id: "openai",
              symbol: "A1BG",
              request_mode: "novel",
            }),
          },
        ),
        env,
        { waitUntil() {} },
      )
    const body = await response.json()

    assert.equal(response.status, 200)
    assert.match(body.job.community_comments_snapshot, /eraser instead of a pen/)
    assert.doesNotMatch(body.job.community_comments_snapshot, /Hidden text/)
    assert.match(db.candidateGenerationJobs.get(body.job.id).community_comments_snapshot, /eraser/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("OpenAI candidate generation uses the Image API generation endpoint without references", async () => {
  const originalFetch = globalThis.fetch
  const db = new FakeDb()
  const env = buildEnv(db)
  const fetchCalls = []
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    fetchCalls.push({ url, init })
    if (url === "https://api.openai.com/v1/images/generations") {
      assert.equal(init.headers.Authorization, "Bearer sk-openai-test-secret")
      const body = JSON.parse(String(init.body || "{}"))
      assert.equal(body.model, "gpt-image-2")
      assert.equal(body.size, "1536x2048")
      assert.equal(body.quality, "high")
      assert.equal(body.output_format, "webp")
      assert.match(String(body.prompt || ""), /3:4 vertical Iconoplasm blot/)
      assert.match(String(body.prompt || ""), /1536x2048 px/)
      assert.match(String(body.prompt || ""), /Reference images: none/)
      assert.doesNotMatch(String(body.prompt || ""), /emulsion examples/)
      return new Response(JSON.stringify({ data: [{ b64_json: base64(GENERATED_BYTES) }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }
    if (init?.cf?.image?.width === 512) return new Response("medium-webp-bytes", { status: 200 })
    if (init?.cf?.image?.width === 256) return new Response("thumb-webp-bytes", { status: 200 })
    throw new Error(`Unexpected fetch ${url}`)
  }

  try {
    const saveResponse =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(
          "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/image-edit/providers",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
            body: JSON.stringify({
              provider_id: "openai",
              api_key: "sk-openai-test-secret",
              model: "gpt-image-2",
            }),
          },
        ),
        env,
        { waitUntil() {} },
      )
    const saved = await saveResponse.json()
    assert.equal(saveResponse.status, 200)
    assert.equal(saved.provider.pricing_label, "~$0.21/image")

    const createResponse =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(
          "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/candidate-generation/jobs",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
            body: JSON.stringify({
              provider_id: "openai",
              symbol: "A1BG",
              request_mode: "novel",
            }),
          },
        ),
        env,
        { waitUntil() {} },
      )
    const created = await createResponse.json()
    assert.equal(createResponse.status, 200)
    assert.equal(created.job.status, "succeeded")
    assert.equal(created.job.request_mode, "novel")
    assert.ok(created.job.result_asset_sha256)
    assert.equal(fetchCalls[0].url, "https://api.openai.com/v1/images/generations")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("Luma Uni image edits use the Agents API source field and visible pricing", async () => {
  const originalFetch = globalThis.fetch
  const db = new FakeDb()
  const env = buildEnv(db)
  const fetchCalls = []
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    fetchCalls.push({ url, init })
    if (url === "https://agents.lumalabs.ai/v1/generations") {
      assert.equal(init.headers.Authorization, "Bearer luma-agents-test-secret")
      const body = JSON.parse(String(init.body || "{}"))
      assert.equal(body.type, "image_edit")
      assert.equal(body.model, "uni-1")
      assert.equal(body.output_format, "png")
      assert.equal(body.aspect_ratio, "3:4")
      assert.match(body.source.url, /portraits\/v1\/aa\//)
      assert.equal(body.prompt.includes("visible AI generation errors"), true)
      return new Response(
        JSON.stringify({
          id: "luma-job-1",
          state: "queued",
          model: "uni-1",
          type: "image_edit",
          output: [],
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      )
    }
    if (url === "https://agents.lumalabs.ai/v1/generations/luma-job-1") {
      return new Response(
        JSON.stringify({
          id: "luma-job-1",
          state: "completed",
          model: "uni-1",
          type: "image_edit",
          output: [{ type: "image", url: "https://luma.example/output.png" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }
    if (url === "https://luma.example/output.png") {
      return new Response("luma-png-bytes", {
        status: 200,
        headers: { "Content-Type": "image/png" },
      })
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
    const saveResponse =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(
          "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/image-edit/providers",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
            body: JSON.stringify({
              provider_id: "luma",
              api_key: "luma-agents-test-secret",
              model: "uni-1",
            }),
          },
        ),
        env,
        { waitUntil() {} },
      )
    const saved = await saveResponse.json()
    assert.equal(saveResponse.status, 200)
    assert.equal(saved.provider.provider_id, "luma")
    assert.equal(saved.provider.model, "uni-1")
    assert.equal(saved.provider.pricing_label, "$0.043/image")

    const createResponse =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(
          "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/image-edit/jobs",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
            body: JSON.stringify({
              provider_id: "luma",
              source_gene_symbol: "A1BG",
              source_asset_sha256: SOURCE_SHA,
              adjustments: { remove_ai_generation_errors: true },
            }),
          },
        ),
        env,
        { waitUntil() {} },
      )
    const created = await createResponse.json()
    assert.equal(createResponse.status, 200)
    assert.equal(created.job.status, "succeeded")
    assert.ok(created.job.result_asset_sha256)
    assert.ok(
      fetchCalls.some(
        (call) => call.url === "https://agents.lumalabs.ai/v1/generations/luma-job-1",
      ),
    )
    assert.equal(env.ICONOPLASM_PORTRAITS.deletes.length, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("Luma Uni candidate generation does not attach local emulsion references", async () => {
  const originalFetch = globalThis.fetch
  const db = new FakeDb()
  const env = buildEnv(db)
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    if (url === "https://agents.lumalabs.ai/v1/generations") {
      assert.equal(init.headers.Authorization, "Bearer luma-agents-test-secret")
      const body = JSON.parse(String(init.body || "{}"))
      assert.equal(body.type, "image")
      assert.equal(body.model, "uni-1-max")
      assert.equal(body.output_format, "png")
      assert.equal(body.aspect_ratio, "3:4")
      assert.equal("image_ref" in body, false)
      return new Response(JSON.stringify({ id: "luma-job-2", state: "queued" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })
    }
    if (url === "https://agents.lumalabs.ai/v1/generations/luma-job-2") {
      return new Response(
        JSON.stringify({
          id: "luma-job-2",
          state: "completed",
          output: [{ type: "image", url: "https://luma.example/generated.png" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }
    if (url === "https://luma.example/generated.png") {
      return new Response("luma-generated-png-bytes", {
        status: 200,
        headers: { "Content-Type": "image/png" },
      })
    }
    if (init?.cf?.image?.format === "webp" && !init?.cf?.image?.width) {
      return new Response(GENERATED_BYTES, {
        status: 200,
        headers: { "Content-Type": "image/webp" },
      })
    }
    if (init?.cf?.image?.width === 512) return new Response("medium-webp-bytes", { status: 200 })
    if (init?.cf?.image?.width === 256) return new Response("thumb-webp-bytes", { status: 200 })
    throw new Error(`Unexpected fetch ${url}`)
  }

  try {
    const saveResponse =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(
          "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/image-edit/providers",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
            body: JSON.stringify({
              provider_id: "luma",
              api_key: "luma-agents-test-secret",
              model: "uni-1-max",
            }),
          },
        ),
        env,
        { waitUntil() {} },
      )
    const saved = await saveResponse.json()
    assert.equal(saveResponse.status, 200)
    assert.equal(saved.provider.pricing_label, "$0.103/image")

    const createResponse =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(
          "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/candidate-generation/jobs",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
            body: JSON.stringify({
              provider_id: "luma",
              symbol: "A1BG",
              request_mode: "novel",
            }),
          },
        ),
        env,
        { waitUntil() {} },
      )
    const created = await createResponse.json()
    assert.equal(createResponse.status, 200)
    assert.equal(created.job.status, "succeeded")
    assert.equal(created.job.request_mode, "novel")
    assert.ok(created.job.result_asset_sha256)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("candidate generation jobs can use Krea API models and expose compute-unit pricing", async () => {
  const originalFetch = globalThis.fetch
  const db = new FakeDb()
  const env = buildEnv(db)
  const fetchCalls = []
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    fetchCalls.push({ url, init })
    if (url === "https://api.krea.ai/generate/image/krea/krea-2/large") {
      assert.equal(init.headers.Authorization, "Bearer krea-test-secret")
      const body = JSON.parse(String(init.body || "{}"))
      assert.equal(body.prompt.includes("Alpha-1-B Glycoprotein"), true)
      // Krea 2 uses aspect_ratio/resolution instead of width/height
      assert.equal(body.aspect_ratio, "4:5")
      assert.equal(body.resolution, "1K")
      assert.equal("width" in body, false)
      assert.equal("height" in body, false)
      assert.equal("image_url" in body, false)
      return new Response(JSON.stringify({ job_id: "krea-job-1", status: "queued" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }
    if (url === "https://api.krea.ai/jobs/krea-job-1") {
      return new Response(
        JSON.stringify({
          job_id: "krea-job-1",
          status: "completed",
          result: { urls: ["https://krea.example/generated.png"] },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }
    if (url === "https://krea.example/generated.png") {
      return new Response("krea-png-bytes", {
        status: 200,
        headers: { "Content-Type": "image/png" },
      })
    }
    if (init?.cf?.image?.format === "webp" && !init?.cf?.image?.width) {
      return new Response(GENERATED_BYTES, {
        status: 200,
        headers: { "Content-Type": "image/webp" },
      })
    }
    if (init?.cf?.image?.width === 512) return new Response("medium-webp-bytes", { status: 200 })
    if (init?.cf?.image?.width === 256) return new Response("thumb-webp-bytes", { status: 200 })
    throw new Error(`Unexpected fetch ${url}`)
  }

  try {
    const saveResponse =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(
          "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/image-edit/providers",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
            body: JSON.stringify({
              provider_id: "krea",
              api_key: "krea-test-secret",
              model: "krea/krea-2/large",
            }),
          },
        ),
        env,
        { waitUntil() {} },
      )
    const saved = await saveResponse.json()
    assert.equal(saveResponse.status, 200)
    assert.equal(saved.provider.provider_id, "krea")
    assert.equal(saved.provider.model, "krea/krea-2/large")
    assert.equal(saved.provider.pricing_label, "$0.060/image")

    const createResponse =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(
          "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/candidate-generation/jobs",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
            body: JSON.stringify({
              provider_id: "krea",
              symbol: "A1BG",
              request_mode: "novel",
            }),
          },
        ),
        env,
        { waitUntil() {} },
      )
    const created = await createResponse.json()
    assert.equal(createResponse.status, 200)
    assert.equal(created.job.status, "succeeded")
    assert.equal(created.job.request_mode, "novel")
    assert.ok(created.job.result_asset_sha256)
    assert.ok(fetchCalls.some((call) => call.url === "https://api.krea.ai/jobs/krea-job-1"))
    assert.equal(env.ICONOPLASM_PORTRAITS.deletes.length, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("image edit jobs can use Gemini API models", async () => {
  const originalFetch = globalThis.fetch
  const db = new FakeDb()
  const env = buildEnv(db)
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    if (
      url ===
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent"
    ) {
      assert.equal(init.headers["x-goog-api-key"], "gemini-test-secret")
      const body = JSON.parse(String(init.body || "{}"))
      assert.deepEqual(body.generationConfig.responseFormat, {
        image: { aspectRatio: "ASPECT_RATIO_THREE_BY_FOUR", imageSize: "IMAGE_SIZE_ONE_K" },
      })
      assert.match(String(body.contents[0].parts[0].text || ""), /3:4 vertical Iconoplasm blot/)
      assert.equal(
        body.contents[0].parts.some((part) => part.inline_data),
        true,
      )
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: "image/webp",
                      data: base64(EDITED_BYTES),
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
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
            provider_id: "gemini",
            api_key: "gemini-test-secret",
            model: "gemini-3.1-flash-image",
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
              provider_id: "gemini",
              source_gene_symbol: "A1BG",
              source_asset_sha256: SOURCE_SHA,
              adjustments: { remove_ai_generation_errors: true },
            }),
          },
        ),
        env,
        { waitUntil() {} },
      )
    const created = await createResponse.json()
    assert.equal(createResponse.status, 200)
    assert.equal(created.job.status, "succeeded")
    assert.ok(created.job.result_asset_sha256)
  } finally {
    globalThis.fetch = originalFetch
  }
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
              provider_id: "openai",
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
            provider_id: "openai",
            api_key: "sk-test-secret",
            endpoint_url: "https://api.openai.com/v1",
            model: "gpt-image-2",
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
              provider_id: "openai",
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

test("image edit jobs accept titan-scale gene mass adjustments from essence data", async () => {
  const originalFetch = globalThis.fetch
  const db = new FakeDb()
  const env = buildEnv(db)
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    if (url === "https://api.openai.com/v1/images/edits") {
      const prompt =
        init.body && typeof init.body.get === "function"
          ? String(init.body.get("prompt") || "")
          : String(init.body || "")
      assert.match(prompt, /3816 kg/)
      assert.match(prompt, /head-to-body ratio/i)
      assert.match(prompt, /chibi/i)
      assert.match(prompt, /monumental/i)
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
            provider_id: "openai",
            api_key: "sk-test-secret",
            endpoint_url: "https://api.openai.com/v1",
            model: "gpt-image-2",
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
              provider_id: "openai",
              source_gene_symbol: "A1BG",
              source_asset_sha256: SOURCE_SHA,
              adjustments: { mass_kg: 3816 },
            }),
          },
        ),
        env,
        { waitUntil() {} },
      )
    const created = await createResponse.json()

    assert.equal(createResponse.status, 200)
    assert.equal(created.job.status, "succeeded")
    assert.equal(created.job.adjustments[0].kind, "mass_kg")
    assert.equal(created.job.adjustments[0].value, 3816)
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
            provider_id: "openai",
            api_key: "sk-test-secret",
            endpoint_url: "https://api.openai.com/v1",
            model: "gpt-image-2",
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
              provider_id: "openai",
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
            provider_id: "openai",
            api_key: "sk-test-secret",
            endpoint_url: "https://api.openai.com/v1",
            model: "gpt-image-2",
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
              provider_id: "openai",
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
    const editCall = fetchCalls.find(
      (call) => call.url === "https://api.openai.com/v1/images/edits",
    )
    const editPrompt =
      editCall?.init?.body && typeof editCall.init.body.get === "function"
        ? String(editCall.init.body.get("prompt") || "")
        : ""
    assert.match(editPrompt, /visible skin tone/i)
    assert.match(editPrompt, /outfit/i)
    assert.match(editPrompt, /leave wardrobe and costume colors unchanged/i)
    assert.doesNotMatch(editPrompt, /adjust surface tone/i)

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
    assert.equal(db.publishedAsset.emulsion_id, "A1-93-19-e")
    assert.equal(db.publishedAsset.sample_label, "A1BG-7")
    assert.equal(db.publishedAsset.sample_number, 7)
    assert.equal(db.publishedAsset.sample_text_hash, "d".repeat(64))
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

test("admin can save one image edit prompt template without changing the other checkmark prompts", async () => {
  const db = new FakeDb()
  const env = {
    ...buildEnv(db),
    ICONOPLASM_ADMIN_TOKEN: "admin-secret",
  }

  const initialResponse =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/admin/image-edit-prompts",
        { headers: { "x-iconoplasm-admin-token": "admin-secret" } },
      ),
      env,
      { waitUntil() {} },
    )
  const initial = await initialResponse.json()

  assert.equal(initialResponse.status, 200)
  assert.equal(initial.ok, true)
  assert.ok(initial.prompts.find((item) => item.kind === "mass_kg"))
  assert.ok(initial.prompts.find((item) => item.kind === "surface_tone_hex"))

  const customMassPrompt =
    "Custom mass prompt for {kg} kg: explicitly reshape the head-to-body ratio."
  const saveResponse =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/admin/image-edit-prompts",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-iconoplasm-admin-token": "admin-secret",
          },
          body: JSON.stringify({ kind: "mass_kg", prompt_template: customMassPrompt }),
        },
      ),
      env,
      { waitUntil() {} },
    )
  const saved = await saveResponse.json()

  assert.equal(saveResponse.status, 200)
  assert.equal(saved.prompt.kind, "mass_kg")
  assert.equal(saved.prompt.prompt_template, customMassPrompt)

  const afterResponse =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/admin/image-edit-prompts",
        { headers: { "x-iconoplasm-admin-token": "admin-secret" } },
      ),
      env,
      { waitUntil() {} },
    )
  const after = await afterResponse.json()
  const mass = after.prompts.find((item) => item.kind === "mass_kg")
  const tone = after.prompts.find((item) => item.kind === "surface_tone_hex")

  assert.equal(mass.prompt_template, customMassPrompt)
  assert.equal(mass.customized, true)
  assert.match(tone.prompt_template, /visible skin tone/i)
  assert.equal(tone.customized, false)
})

test("admin shared image edit prompt suffix is editable and appended once to edit jobs", async () => {
  const originalFetch = globalThis.fetch
  const db = new FakeDb()
  const env = {
    ...buildEnv(db),
    ICONOPLASM_ADMIN_TOKEN: "admin-secret",
  }
  const sharedSuffix =
    "Shared edit suffix: preserve identity, pose, composition, lighting, blot texture, framing, and background unless the selected edit explicitly requires a change."
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    if (url === "https://api.openai.com/v1/images/edits") {
      const prompt = String(init.body.get("prompt") || "")
      assert.match(prompt, /Custom mass prompt for 81 kg\./)
      assert.equal(prompt.includes(sharedSuffix), true)
      assert.equal(prompt.split(sharedSuffix).length - 1, 1)
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
    const initialResponse =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(
          "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/admin/image-edit-prompts",
          { headers: { "x-iconoplasm-admin-token": "admin-secret" } },
        ),
        env,
        { waitUntil() {} },
      )
    const initial = await initialResponse.json()
    assert.equal(initialResponse.status, 200)
    assert.equal(initial.suffix.kind, "shared_suffix")
    assert.match(initial.suffix.default_prompt_template, /preserve character identity/i)

    const saveSuffixResponse =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(
          "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/admin/image-edit-prompts",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-iconoplasm-admin-token": "admin-secret",
            },
            body: JSON.stringify({ kind: "shared_suffix", prompt_template: sharedSuffix }),
          },
        ),
        env,
        { waitUntil() {} },
      )
    const savedSuffix = await saveSuffixResponse.json()
    assert.equal(saveSuffixResponse.status, 200)
    assert.equal(savedSuffix.suffix.prompt_template, sharedSuffix)

    const saveMassResponse =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(
          "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/admin/image-edit-prompts",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-iconoplasm-admin-token": "admin-secret",
            },
            body: JSON.stringify({
              kind: "mass_kg",
              prompt_template: "Custom mass prompt for {kg} kg.",
            }),
          },
        ),
        env,
        { waitUntil() {} },
      )
    assert.equal(saveMassResponse.status, 200)

    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/image-edit/providers",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
          body: JSON.stringify({
            provider_id: "openai",
            api_key: "sk-openai-test-secret",
            model: "gpt-image-2",
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
              provider_id: "openai",
              source_gene_symbol: "A1BG",
              source_asset_sha256: SOURCE_SHA,
              adjustments: { mass_kg: 81 },
            }),
          },
        ),
        env,
        { waitUntil() {} },
      )
    const created = await createResponse.json()
    assert.equal(createResponse.status, 200)
    assert.equal(created.job.status, "succeeded")
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
            provider_id: "openai",
            api_key: "sk-test-secret",
            endpoint_url: "https://api.openai.com/v1",
            model: "gpt-image-2",
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
              provider_id: "openai",
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
