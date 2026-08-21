import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
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

test("candidate prompt authority migration renames every stored mode without losing jobs", () => {
  const db = new DatabaseSync(":memory:")
  try {
    db.exec("CREATE TABLE icono_gene_essence (gene_symbol TEXT PRIMARY KEY)")
    for (const name of [
      "0034_candidate_generation_jobs.sql",
      "0037_candidate_generation_jobs_novel_mode.sql",
      "0038_candidate_generation_prompt_body_mode.sql",
      "0045_gene_comments_and_clans_backend.sql",
    ]) {
      db.exec(readFileSync(new URL(`../migrations-iconoplasm/${name}`, import.meta.url), "utf8"))
    }
    const insert = db.prepare(
      `INSERT INTO icono_candidate_generation_jobs
         (id, user_id, provider_id, gene_symbol, prompt_body_mode)
       VALUES (?, 'user-1', 'openai', 'TP53', ?)`,
    )
    insert.run("tag-job", "tags_sample")
    insert.run("prose-job", "prose_sample")

    db.exec(
      readFileSync(
        new URL(
          "../migrations-iconoplasm/0068_candidate_prompt_authority_names.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    )

    const migratedJobs = db
      .prepare("SELECT id, prompt_body_mode FROM icono_candidate_generation_jobs ORDER BY id")
      .all()
      .map((row) => ({ id: row.id, prompt_body_mode: row.prompt_body_mode }))
    assert.deepEqual(migratedJobs, [
      { id: "prose-job", prompt_body_mode: "prose_prompt" },
      { id: "tag-job", prompt_body_mode: "taggerizer_prompt" },
    ])
    db.prepare(
      `INSERT INTO icono_candidate_generation_jobs
         (id, user_id, provider_id, gene_symbol)
       VALUES ('default-job', 'user-1', 'openai', 'BRCA1')`,
    ).run()
    assert.equal(
      db
        .prepare(
          "SELECT prompt_body_mode FROM icono_candidate_generation_jobs WHERE id = 'default-job'",
        )
        .get().prompt_body_mode,
      "taggerizer_prompt",
    )
  } finally {
    db.close()
  }
})

test("website generation requests default to complete Tags prompts and fresh seeds", () => {
  const db = new DatabaseSync(":memory:")
  try {
    db.exec(`
      CREATE TABLE icono_generation_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        gene_symbol TEXT NOT NULL
      );
    `)
    db.exec(
      readFileSync(
        new URL(
          "../migrations-iconoplasm/0069_generation_request_prompt_and_seed_authority.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    )
    db.prepare("INSERT INTO icono_generation_requests (gene_symbol) VALUES ('CDK1')").run()
    assert.deepEqual(
      {
        ...db
          .prepare(
            "SELECT prompt_body_mode, seed_mode FROM icono_generation_requests WHERE gene_symbol = 'CDK1'",
          )
          .get(),
      },
      { prompt_body_mode: "taggerizer_prompt", seed_mode: "random" },
    )
    assert.throws(
      () =>
        db
          .prepare(
            "INSERT INTO icono_generation_requests (gene_symbol, prompt_body_mode) VALUES ('TP53', 'sampled_tags')",
          )
          .run(),
      /CHECK constraint failed/,
    )
    assert.throws(
      () =>
        db
          .prepare(
            "INSERT INTO icono_generation_requests (gene_symbol, seed_mode) VALUES ('TP53', 'custom')",
          )
          .run(),
      /CHECK constraint failed/,
    )
  } finally {
    db.close()
  }
})

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
          manifestation_tags: "calm_archivist, pearl_varnish, measured_posture",
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
    if (this.db.runFailureSqlFragment && this.sql.includes(String(this.db.runFailureSqlFragment))) {
      throw new Error(this.db.runFailureMessage || "Synthetic D1 write failure")
    }
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
        status: this.args[20],
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
        emulsion_id: this.args[10] ?? null,
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
      const imageEdit = this.sql.includes("'edit_candidate'")
      const event = imageEdit
        ? {
            gene_symbol: this.args[0],
            to_asset_sha256: this.args[2],
            actor: this.args[3],
            reason: this.args[4],
          }
        : {
            gene_symbol: this.args[0],
            to_asset_sha256: this.args[1],
            actor: this.args[2],
            reason: this.args[3],
          }
      const duplicate = this.db.publishEvents.some(
        (existing) =>
          existing.gene_symbol === event.gene_symbol && existing.reason === event.reason,
      )
      if (duplicate) return { meta: { changes: 0 } }
      this.db.publishEvent = event
      this.db.publishEvents.push(event)
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
    if (
      this.sql.includes("UPDATE icono_gene_comments") &&
      this.sql.includes("status = 'deleted'")
    ) {
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
    this.publishEvents = []
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
            if (db.voteImportFailure) {
              return new Response(JSON.stringify({ error: db.voteImportFailure }), {
                status: 503,
                headers: { "Content-Type": "application/json" },
              })
            }
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
                  changed: true,
                  mutation_id: `${payload.symbol}:${item.user_id}`,
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
    // Provider polling defaults to 10s initial wait + 10s interval.
    // Tests override to 0 so polling doesn't block the test suite.
    ICONOPLASM_PROVIDER_POLL_INTERVAL_MS: "0",
  }
}

function seedSucceededCandidateGenerationJob(db, id = "candidate-publish-test") {
  const row = {
    id,
    user_id: "user-1",
    provider_id: "openai",
    gene_symbol: "A1BG",
    request_mode: "novel",
    reference_assets_json: "[]",
    prompt_body_mode: "prose_prompt",
    status: "succeeded",
    result_asset_sha256: "e".repeat(64),
    result_r2_key_full: `portraits/v1/ee/${"e".repeat(64)}/full.webp`,
    result_r2_key_medium: `portraits/v1/ee/${"e".repeat(64)}/medium.webp`,
    result_r2_key_thumb: `portraits/v1/ee/${"e".repeat(64)}/thumb.webp`,
    result_mime: "image/webp",
    created_at: "2026-05-16T00:00:00.000Z",
    completed_at: "2026-05-16T00:00:01.000Z",
  }
  db.candidateGenerationJobs.set(id, row)
  return row
}

function seedSucceededImageEditJob(db, id = "image-edit-publish-test") {
  const row = {
    id,
    user_id: "user-1",
    provider_id: "openai",
    source_gene_symbol: "A1BG",
    source_asset_sha256: SOURCE_SHA,
    adjustments_json: "[]",
    status: "succeeded",
    inherited_upvotes: 2,
    result_asset_sha256: "f".repeat(64),
    result_r2_key_full: `portraits/v1/ff/${"f".repeat(64)}/full.webp`,
    result_r2_key_medium: `portraits/v1/ff/${"f".repeat(64)}/medium.webp`,
    result_r2_key_thumb: `portraits/v1/ff/${"f".repeat(64)}/thumb.webp`,
    result_mime: "image/webp",
    created_at: "2026-05-16T00:00:00.000Z",
    completed_at: "2026-05-16T00:00:01.000Z",
  }
  db.jobs.set(id, row)
  return row
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
async function createKreaImageEditJobAndAwait({ env, ctx, body, cookie = "session=abc123" }) {
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

test("candidate publish explains a vote-service failure and preserves the generated image", async () => {
  const db = new FakeDb()
  const job = seedSucceededCandidateGenerationJob(db)
  db.voteImportFailure = "Synthetic vote coordinator outage"
  const env = buildEnv(db)

  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        `https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/candidate-generation/jobs/${job.id}/publish`,
        { method: "POST", headers: { Cookie: "session=abc123" } },
      ),
      env,
      { waitUntil() {} },
    )
  const payload = await response.json()

  assert.equal(response.status, 502)
  assert.equal(payload.code, "CANDIDATE_PUBLISH_VOTE_FAILED")
  assert.equal(payload.failure.stage, "record_vote")
  assert.equal(payload.failure.result_saved, true)
  assert.equal(payload.failure.candidate_added, true)
  assert.equal(payload.failure.vote_recorded, false)
  assert.match(payload.failure.preserved_message, /generated image is saved/i)
  assert.match(payload.failure.next_action, /retry publish/i)
  assert.match(payload.failure.next_action, /not be regenerated/i)
  assert.equal(payload.failure.job_id, job.id)
  assert.equal(payload.job.id, job.id)
  assert.equal(payload.job.published, false)
  assert.equal(db.publishedAsset.asset_sha256, job.result_asset_sha256)
})

test("image edit publish explains a candidate-write failure without losing the edit", async () => {
  const db = new FakeDb()
  const job = seedSucceededImageEditJob(db)
  db.runFailureSqlFragment = "INSERT INTO icono_portrait_assets"
  db.runFailureMessage = "Synthetic portrait write outage"
  const env = buildEnv(db)

  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        `https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/image-edit/jobs/${job.id}/publish`,
        { method: "POST", headers: { Cookie: "session=abc123" } },
      ),
      env,
      { waitUntil() {} },
    )
  const payload = await response.json()

  assert.equal(response.status, 503)
  assert.equal(payload.code, "IMAGE_EDIT_PUBLISH_CANDIDATE_FAILED")
  assert.equal(payload.failure.stage, "add_candidate")
  assert.equal(payload.failure.result_saved, true)
  assert.equal(payload.failure.candidate_added, false)
  assert.equal(payload.failure.vote_recorded, false)
  assert.match(payload.failure.preserved_message, /edited image is saved/i)
  assert.match(payload.failure.next_action, /retry publish/i)
  assert.equal(payload.job.id, job.id)
  assert.equal(payload.job.published, false)
  assert.equal(db.voteImportPayload, undefined)
})

test("image edit publish distinguishes a final confirmation failure", async () => {
  const db = new FakeDb()
  const job = seedSucceededImageEditJob(db, "image-edit-confirmation-test")
  db.runFailureSqlFragment = "UPDATE icono_image_edit_jobs"
  db.runFailureMessage = "Synthetic confirmation write outage"
  const env = buildEnv(db)

  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        `https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/image-edit/jobs/${job.id}/publish`,
        { method: "POST", headers: { Cookie: "session=abc123" } },
      ),
      env,
      { waitUntil() {} },
    )
  const payload = await response.json()

  assert.equal(response.status, 503)
  assert.equal(payload.code, "IMAGE_EDIT_PUBLISH_CONFIRMATION_FAILED")
  assert.equal(payload.failure.stage, "confirm_publish")
  assert.equal(payload.failure.result_saved, true)
  assert.equal(payload.failure.candidate_added, true)
  assert.equal(payload.failure.vote_recorded, true)
  assert.match(payload.error, /candidate and its votes were saved/i)
  assert.equal(payload.job.published, false)
  assert.equal(db.voteImportPayload.items.length, 3)
  assert.equal(db.publishEvents.length, 1)

  db.runFailureSqlFragment = ""
  const retryResponse =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        `https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/image-edit/jobs/${job.id}/publish`,
        { method: "POST", headers: { Cookie: "session=abc123" } },
      ),
      env,
      { waitUntil() {} },
    )
  const retryPayload = await retryResponse.json()
  assert.equal(retryResponse.status, 200)
  assert.equal(retryPayload.job.published, true)
  assert.equal(db.publishEvents.length, 1, "a retry must not duplicate the publish audit event")
})

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
  assert.ok(filtered.supported_providers.some((provider) => provider.provider_id === "fal"))
  const fal = filtered.supported_providers.find((provider) => provider.provider_id === "fal")
  const falEditModels = (fal.model_options || []).map((o) => o.model)
  for (const required of [
    "fal-ai/nano-banana-pro/edit",
    "fal-ai/nano-banana-2/edit",
    "fal-ai/flux-pro/kontext",
    "fal-ai/flux-2/edit",
    "openai/gpt-image-2/edit",
    "bytedance/seedream/v5/pro/edit",
    "bytedance/seedream/v5/lite/edit",
    "fal-ai/omnigen-v2",
  ]) {
    assert.ok(falEditModels.includes(required), "Fal edit dialog should expose " + required)
  }
  for (const hidden of [
    "fal-ai/nano-banana-pro",
    "fal-ai/nano-banana-2",
    "fal-ai/flux-2",
    "bytedance/seedream/v5/pro/text-to-image",
    "bytedance/seedream/v5/lite/text-to-image",
    "openai/gpt-image-2",
  ]) {
    assert.ok(
      !falEditModels.includes(hidden),
      "Fal edit dialog should NOT expose gen-only " + hidden,
    )
  }
  const gemini = filtered.supported_providers.find((provider) => provider.provider_id === "gemini")
  assert.ok(gemini.model_options.some((option) => option.model === "gemini-3.1-flash-image"))
  assert.match(
    gemini.model_options.find((option) => option.model === "gemini-3.1-flash-image").pricing_label,
    /\$0\.067\/image/,
  )
  const krea = filtered.supported_providers.find((provider) => provider.provider_id === "krea")
  // The default op is image_edit, so the list is filtered to edit-capable models.
  // Verify every edit-capable Krea model is exposed and the text-to-image-only
  // ones (Krea 2 Large, Seedream 4) are absent from the edit dialog.
  const kreaModelNames = (krea.model_options || []).map((option) => option.model)
  for (const required of [
    "bfl/flux-1-kontext-dev",
    "bfl/flux-1-dev",
    "google/nano-banana",
    "google/nano-banana-pro",
    "google/nano-banana-2",
    "openai/gpt-image",
    "openai/gpt-image-2",
    "bytedance/seededit",
    "ideogram/ideogram-3",
    "z-image/z-image",
  ]) {
    assert.ok(kreaModelNames.includes(required), "Krea edit dialog should expose " + required)
  }
  for (const hidden of [
    "krea/krea-2/large",
    "krea/krea-2/medium",
    "krea/krea-2/medium-turbo",
    "bytedance/seedream-4",
    "bytedance/seedream-5-lite",
    "luma/uni-1",
    "google/imagen-3",
    "google/imagen-4",
    "google/imagen-4-fast",
    "google/imagen-4-ultra",
    "bfl/flux-1.1-pro",
    "bfl/flux-1.1-pro-ultra",
    "ideogram/ideogram-2-turbo",
    "qwen/2512",
    "runway/gen-4-image",
  ]) {
    assert.ok(!kreaModelNames.includes(hidden), "Krea edit dialog should NOT expose " + hidden)
  }
  // The edit-capable flag and the source-image field name are preserved on
  // every exposed model so the backend can pick the right body shape.
  const fluxKontext = krea.model_options.find((option) => option.model === "bfl/flux-1-kontext-dev")
  assert.equal(fluxKontext.edit_capable, true)
  assert.equal(fluxKontext.edit_image_param, "image_url")
  assert.equal(fluxKontext.edit_strength_param, "strength")
  // Krea's docs say strength: 1.0 "fully replaces the source". The
  // default here has to be a real-edit value, not a regenerate value —
  // see the regression test for the "edit returns a new image" bug.
  assert.equal(fluxKontext.edit_strength_default, 0.5)
  const fluxDev = krea.model_options.find((option) => option.model === "bfl/flux-1-dev")
  assert.equal(fluxDev.edit_strength_param, "strength")
  assert.equal(fluxDev.edit_strength_default, 0.5)
  const nanoBananaPro = krea.model_options.find(
    (option) => option.model === "google/nano-banana-pro",
  )
  assert.equal(nanoBananaPro.edit_capable, true)
  assert.equal(nanoBananaPro.edit_image_param, "image_urls")
  // The dialog marks the user's last-used model in place (no reordering).
  // See the dedicated last-used test for KV write-on-change behavior.
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
      assert.match(String(body.prompt || ""), /calm_archivist, pearl_varnish, measured_posture/)
      assert.doesNotMatch(String(body.prompt || ""), /A1BG appears as a calm archivist/)
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
    assert.equal(created.job.prompt_body_mode, "taggerizer_prompt")
    assert.equal(created.job.sample_label, "A1BG-7")
    assert.equal(
      "prompt" in created.job,
      true,
      "candidate generation job should expose the stored prompt so the caller can verify what was sent to the provider",
    )
    assert.ok(
      typeof created.job.prompt === "string" && created.job.prompt.length > 0,
      "stored prompt should be a non-empty string",
    )
    assert.match(created.job.prompt, /Subject gene:\s*A1BG/)
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
              prompt_body_mode: "prose_prompt",
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

test("candidate generation rejects another user's selected emulsion", async () => {
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
    assert.equal(createResponse.status, 400)
    assert.match(created.error, /Selected user emulsion is not available/)
    assert.equal(db.candidateGenerationJobs.size, 0)
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
              prompt_body_mode: "prose_prompt",
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

test("candidate generation uses the complete Taggerizer prompt with appended essence facts", async () => {
  const originalFetch = globalThis.fetch
  const db = new FakeDb()
  const trailingTag = "tail_tag_after_4000_chars"
  const tagPrefix = "pearl_archivist, ".repeat(220)
  const taggerizerPrompt = `${tagPrefix}${"x".repeat(
    4001 - tagPrefix.length - trailingTag.length - 2,
  )}, ${trailingTag}`
  assert.equal(taggerizerPrompt.length, 4001)
  db.geneContext = {
    gene_symbol: "A1BG",
    full_name: "Alpha-1-B Glycoprotein",
    manifestation: "A prose body that should not be used for tags mode.",
    manifestation_tags: taggerizerPrompt,
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
      assert.match(String(body.prompt || ""), /Prompt body authority: complete Taggerizer prompt/)
      assert.match(String(body.prompt || ""), /tail_tag_after_4000_chars/)
      assert.match(String(body.prompt || ""), /39 years old/)
      assert.match(String(body.prompt || ""), /75 kg/)
      assert.match(String(body.prompt || ""), /Tropical Night Blue/)
      assert.match(
        String(body.prompt || ""),
        /light skin color, subdued skin color, cyan skin color/,
      )
      assert.doesNotMatch(String(body.prompt || ""), /#7cc7b2/i)
      assert.doesNotMatch(String(body.prompt || ""), /colored skin/i)
      assert.doesNotMatch(String(body.prompt || ""), /seafoam/)
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
              prompt_body_mode: "taggerizer_prompt",
            }),
          },
        ),
        env,
        { waitUntil() {} },
      )
    const body = await response.json()

    assert.equal(response.status, 200)
    assert.equal(body.job.prompt_body_mode, "taggerizer_prompt")
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
      assert.ok(body.source.data, "source.data should be base64-encoded image bytes")
      assert.equal(body.source.media_type, "image/webp")
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
              model: "uni-1",
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
    assert.equal(createResponse.status, 200, "create status: " + JSON.stringify(created))
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
    assert.equal(saved.provider.pricing_label, "$0.060/request")

    const createCtx = capturingContext()
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
        createCtx,
      )
    const created = await createResponse.json()
    assert.equal(createResponse.status, 200, "create status: " + JSON.stringify(created))
    assert.equal(created.job.status, "succeeded")
    assert.equal(created.job.request_mode, "novel")
    assert.ok(created.job.result_asset_sha256)
    assert.ok(fetchCalls.some((call) => call.url === "https://api.krea.ai/jobs/krea-job-1"))
    assert.equal(env.ICONOPLASM_PORTRAITS.deletes.length, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("Fal.ai Seedream 5 image edits use queue-based polling and visible pricing", async () => {
  const originalFetch = globalThis.fetch
  const db = new FakeDb()
  const env = buildEnv(db)
  const fetchCalls = []
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    fetchCalls.push({ url, init })
    if (url === "https://queue.fal.run/bytedance/seedream/v5/pro/edit") {
      assert.equal(init.headers.Authorization, "Key fal-test-secret")
      const body = JSON.parse(String(init.body || "{}"))
      assert.equal(body.prompt.includes("visible AI generation errors"), true)
      assert.ok(Array.isArray(body.image_urls), "image_urls should be an array")
      assert.equal(body.image_urls.length, 1, "should have one source image")
      assert.equal(body.image_size, "auto_2K")
      assert.equal(body.output_format, "png")
      assert.equal(body.num_images, 1)
      assert.equal(body.enable_safety_checker, true)
      // Live fal returns shortened status/response URLs under the app root,
      // not the full model path we submitted to. The poller must follow them.
      return new Response(
        JSON.stringify({
          request_id: "fal-job-1",
          status_url: "https://queue.fal.run/bytedance/seedream/requests/fal-job-1/status",
          response_url: "https://queue.fal.run/bytedance/seedream/requests/fal-job-1",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }
    if (url === "https://queue.fal.run/bytedance/seedream/requests/fal-job-1/status") {
      // Shortened fal status URLs accept GET (POST returns 405 Allow: GET,HEAD).
      assert.equal(String(init.method || "GET").toUpperCase(), "GET")
      return new Response(
        JSON.stringify({
          status: "COMPLETED",
          request_id: "fal-job-1",
          response_url: "https://queue.fal.run/bytedance/seedream/requests/fal-job-1",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }
    if (url === "https://queue.fal.run/bytedance/seedream/requests/fal-job-1") {
      assert.equal(String(init.method || "GET").toUpperCase(), "GET")
      return new Response(
        JSON.stringify({
          images: [{ url: "https://fal.example/output.png", content_type: "image/png" }],
          seed: 42,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }
    if (url === "https://fal.example/output.png") {
      return new Response("fal-png-bytes", {
        status: 200,
        headers: { "Content-Type": "image/png" },
      })
    }
    // Internal portrait CDN URL used as source image for providers that
    // accept image_urls (Fal.ai, Krea asset upload, etc.)
    if (url.includes("/portraits/") || url.includes("/portrait/")) {
      return new Response("source-portrait-bytes", {
        status: 200,
        headers: { "Content-Type": "image/webp" },
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
              provider_id: "fal",
              api_key: "fal-test-secret",
              model: "bytedance/seedream/v5/pro/edit",
            }),
          },
        ),
        env,
        { waitUntil() {} },
      )
    const saved = await saveResponse.json()
    assert.equal(saveResponse.status, 200)
    assert.equal(saved.provider.provider_id, "fal")
    assert.equal(saved.provider.model, "bytedance/seedream/v5/pro/edit")
    assert.equal(saved.provider.pricing_label, "~$0.08/image")

    const createResponse =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(
          "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/image-edit/jobs",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
            body: JSON.stringify({
              provider_id: "fal",
              model: "bytedance/seedream/v5/pro/edit",
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
    assert.equal(createResponse.status, 200, "create status: " + JSON.stringify(created))
    assert.equal(created.job.status, "succeeded")
    assert.ok(created.job.result_asset_sha256)
    assert.ok(
      fetchCalls.some(
        (call) => call.url === "https://queue.fal.run/bytedance/seedream/requests/fal-job-1/status",
      ),
      "poller must follow fal-returned shortened status_url",
    )
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
    assert.match(editPrompt, /#b17f62/i)
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
    // Publish is an endorsement: the publisher gets a real upvote row.
    assert.equal(db.voteImportPayload.items.filter((item) => item.user_id === "user-1").length, 1)
    assert.equal(
      db.voteImportPayload.items.filter((item) =>
        String(item.user_id || "").startsWith("__system_image_edit_inherit__:"),
      ).length,
      6,
    )
    assert.equal(published.vote_inheritance.projection_outbox_pending, 7)
    assert.equal(db.voteProjectionRows.length, 0)
    assert.notEqual(db.voteRefreshTouched, true)
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

test("image edit jobs with Krea Flux use image_url + strength in the request body", async () => {
  const originalFetch = globalThis.fetch
  const db = new FakeDb()
  const env = buildEnv(db)
  const fetchCalls = []
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    fetchCalls.push({ url, init })
    if (url === "https://api.krea.ai/assets") {
      // Krea now requires uploading the source image to /assets first to get
      // a Krea-hosted image_url that the inference server can definitely reach.
      assert.equal(init.method, "POST")
      assert.equal(init.headers.Authorization, "Bearer krea-test-secret")
      // The body must be multipart/form-data (a real FormData), and the `file`
      // field must carry the actual source image bytes.
      assert.ok(init.body instanceof FormData, "Krea asset upload must use FormData")
      const fileField = init.body.get("file")
      assert.ok(fileField, "Krea asset upload must include a file field")
      assert.ok(fileField.size > 0, "Krea asset upload file must be non-empty")
      return new Response(
        JSON.stringify({
          id: "krea-asset-flux-1",
          image_url: "https://krea.example/uploaded/flux-source.png",
          width: 1024,
          height: 1024,
          size_bytes: fileField.size,
          mime_type: "image/webp",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }
    if (url === "https://api.krea.ai/generate/image/bfl/flux-1-dev") {
      assert.equal(init.headers.Authorization, "Bearer krea-test-secret")
      const body = JSON.parse(String(init.body || "{}"))
      // Flux (bfl/flux-1-dev) uses singular image_url, not the image_urls[] array.
      assert.equal(typeof body.image_url, "string")
      // The image_url must be the Krea-hosted URL from the /assets upload,
      // not our own CDN URL. This is the key fix for the "edit returns a
      // new image" bug.
      assert.equal(body.image_url, "https://krea.example/uploaded/flux-source.png")
      assert.equal(Array.isArray(body.image_urls), false)
      // Krea Flux also takes a strength field for img2img. The worker
      // uses the per-model edit_strength_default (0.5 for the Flux
      // family). The previous fixed value of 0.85 was effectively
      // "regenerate almost completely using the source as a faint hint"
      // per Krea's own docs (1.0 = "fully replaces the source"); 0.5
      // produces a real edit.
      assert.equal(body.strength, 0.5)
      return new Response(JSON.stringify({ job_id: "flux-job-1", status: "queued" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }
    if (url === "https://api.krea.ai/jobs/flux-job-1") {
      return new Response(
        JSON.stringify({
          job_id: "flux-job-1",
          status: "completed",
          result: { urls: ["https://krea.example/flux.png"] },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }
    if (url === "https://krea.example/flux.png") {
      return new Response("flux-png-bytes", {
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
    const providerCtx = capturingContext()
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/image-edit/providers",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
          body: JSON.stringify({
            provider_id: "krea",
            api_key: "krea-test-secret",
            model: "bfl/flux-1-dev",
          }),
        },
      ),
      env,
      providerCtx,
    )

    const createCtx = capturingContext()
    const { create, created } = await createKreaImageEditJobAndAwait({
      env,
      ctx: createCtx,
      body: {
        provider_id: "krea",
        model: "bfl/flux-1-dev",
        source_gene_symbol: "A1BG",
        source_asset_sha256: SOURCE_SHA,
        adjustments: { remove_ai_generation_errors: true },
      },
    })
    assert.equal(create.status, 200, "create status: " + JSON.stringify(created))
    assert.equal(created.job.status, "succeeded")
    assert.ok(created.job.result_asset_sha256)
    // The Krea job creation call must have been made exactly once.
    const fluxCalls = fetchCalls.filter(
      (call) => call.url === "https://api.krea.ai/generate/image/bfl/flux-1-dev",
    )
    assert.equal(fluxCalls.length, 1)
    // The /assets upload must have been made exactly once.
    const assetCalls = fetchCalls.filter((call) => call.url === "https://api.krea.ai/assets")
    assert.equal(assetCalls.length, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("image edit jobs with Krea Nano Banana Pro use image_urls[] array and aspect_ratio", async () => {
  const originalFetch = globalThis.fetch
  const db = new FakeDb()
  const env = buildEnv(db)
  const fetchCalls = []
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    fetchCalls.push({ url, init })
    if (url === "https://api.krea.ai/assets") {
      // Nano Banana Pro on Krea needs a Krea-hosted source image, not our CDN
      // URL. The worker uploads the source bytes here.
      assert.ok(init.body instanceof FormData, "Krea asset upload must use FormData")
      const fileField = init.body.get("file")
      assert.ok(fileField, "Krea asset upload must include a file field")
      assert.ok(fileField.size > 0, "Krea asset upload file must be non-empty")
      return new Response(
        JSON.stringify({
          id: "krea-asset-nbp-1",
          image_url: "https://krea.example/uploaded/nbp-source.png",
          width: 1024,
          height: 1024,
          size_bytes: fileField.size,
          mime_type: "image/webp",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }
    if (url === "https://api.krea.ai/generate/image/google/nano-banana-pro") {
      const body = JSON.parse(String(init.body || "{}"))
      // Nano Banana Pro on Krea takes image_urls[] (plural array), not singular image_url.
      assert.equal(Array.isArray(body.image_urls), true)
      assert.equal(body.image_urls.length, 1)
      // The image_urls[] entry must be the Krea-hosted URL from the /assets
      // upload — NOT our CDN URL. This is the key fix for the bug where
      // Nano Banana Pro was silently dropping the source image and generating
      // a fresh portrait from the prompt alone.
      assert.equal(body.image_urls[0], "https://krea.example/uploaded/nbp-source.png")
      assert.equal("image_url" in body, false)
      // Nano Banana Pro accepts aspect_ratio (the blot default 3:4 is in
      // its enum) and does NOT require explicit width/height. Sending
      // width/height on top of aspect_ratio can squash the source on models
      // that interpret the literal pixel dimensions.
      assert.equal(body.aspect_ratio, "3:4")
      assert.equal("width" in body, false)
      assert.equal("height" in body, false)
      return new Response(JSON.stringify({ job_id: "nbp-job-1", status: "queued" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }
    if (url === "https://api.krea.ai/jobs/nbp-job-1") {
      return new Response(
        JSON.stringify({
          job_id: "nbp-job-1",
          status: "completed",
          result: { urls: ["https://krea.example/nbp.png"] },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }
    if (url === "https://krea.example/nbp.png") {
      return new Response("nbp-png-bytes", {
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
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/image-edit/providers",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
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

    const createCtx = capturingContext()
    const { create, created } = await createKreaImageEditJobAndAwait({
      env,
      ctx: createCtx,
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
    assert.ok(created.job.result_asset_sha256)
    // The /assets upload must have been made exactly once.
    const assetCalls = fetchCalls.filter((call) => call.url === "https://api.krea.ai/assets")
    assert.equal(assetCalls.length, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("image edit jobs with Krea Krea-2-Large are rejected because the model cannot do image-to-image", async () => {
  const originalFetch = globalThis.fetch
  const db = new FakeDb()
  const env = buildEnv(db)
  let providerCalled = false
  globalThis.fetch = async () => {
    providerCalled = true
    throw new Error("Krea 2 Large should not be called for an image edit job")
  }

  try {
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

    const createResponse =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(
          "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/image-edit/jobs",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
            body: JSON.stringify({
              provider_id: "krea",
              model: "krea/krea-2/large",
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
    assert.equal(createResponse.status, 502)
    assert.equal(created.job.status, "failed")
    assert.match(created.job.error, /does not support image-to-image editing/i)
    assert.match(created.job.error, /Flux/)
    assert.equal(providerCalled, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("image edit jobs with Krea Seedream 4 are rejected because the model has no image input field", async () => {
  const originalFetch = globalThis.fetch
  const db = new FakeDb()
  const env = buildEnv(db)
  let providerCalled = false
  globalThis.fetch = async () => {
    providerCalled = true
    throw new Error("Seedream 4 should not be called for an image edit job")
  }

  try {
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/image-edit/providers",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
          body: JSON.stringify({
            provider_id: "krea",
            api_key: "krea-test-secret",
            model: "bytedance/seedream-4",
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
              provider_id: "krea",
              model: "bytedance/seedream-4",
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
    assert.equal(createResponse.status, 502)
    assert.equal(created.job.status, "failed")
    assert.match(created.job.error, /does not support image-to-image editing/i)
    assert.equal(providerCalled, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("image edit jobs with Krea Flux Kontext use image_url + strength in the request body", async () => {
  const originalFetch = globalThis.fetch
  const db = new FakeDb()
  const env = buildEnv(db)
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    if (url === "https://api.krea.ai/assets") {
      assert.ok(init.body instanceof FormData, "Krea asset upload must use FormData")
      return new Response(
        JSON.stringify({
          id: "krea-asset-kontext-1",
          image_url: "https://krea.example/uploaded/kontext-source.png",
          width: 1024,
          height: 1024,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }
    if (url === "https://api.krea.ai/generate/image/bfl/flux-1-kontext-dev") {
      const body = JSON.parse(String(init.body || "{}"))
      assert.equal(typeof body.image_url, "string")
      // Source must be Krea-hosted, not our CDN URL.
      assert.equal(body.image_url, "https://krea.example/uploaded/kontext-source.png")
      assert.equal(Array.isArray(body.image_urls), false)
      assert.equal(body.strength, 0.5)
      return new Response(JSON.stringify({ job_id: "kontext-job-1", status: "queued" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }
    if (url === "https://api.krea.ai/jobs/kontext-job-1") {
      return new Response(
        JSON.stringify({
          job_id: "kontext-job-1",
          status: "completed",
          result: { urls: ["https://krea.example/kontext.png"] },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }
    if (url === "https://krea.example/kontext.png") {
      return new Response("kontext-png-bytes", {
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
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/image-edit/providers",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
          body: JSON.stringify({
            provider_id: "krea",
            api_key: "krea-test-secret",
            model: "bfl/flux-1-kontext-dev",
          }),
        },
      ),
      env,
      { waitUntil() {} },
    )

    const createCtx = capturingContext()
    const { create, created } = await createKreaImageEditJobAndAwait({
      env,
      ctx: createCtx,
      body: {
        provider_id: "krea",
        model: "bfl/flux-1-kontext-dev",
        source_gene_symbol: "A1BG",
        source_asset_sha256: SOURCE_SHA,
        adjustments: { remove_ai_generation_errors: true },
      },
    })
    assert.equal(create.status, 200, "create status: " + JSON.stringify(created))
    assert.equal(created.job.status, "succeeded")
    assert.ok(created.job.result_asset_sha256)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("image edit jobs with Krea SeedEdit omit width/height from the body", async () => {
  // SeedEdit's body schema is exactly {prompt, seed, image_url}. Any size
  // key (width/height/aspect_ratio/resolution) is rejected as
  // "Unrecognized key(s) in object". Verify we don't send them.
  const originalFetch = globalThis.fetch
  const db = new FakeDb()
  const env = buildEnv(db)
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    if (url === "https://api.krea.ai/assets") {
      return new Response(
        JSON.stringify({
          id: "krea-asset-seededit-1",
          image_url: "https://krea.example/uploaded/seededit-source.png",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }
    if (url === "https://api.krea.ai/generate/image/bytedance/seededit") {
      const body = JSON.parse(String(init.body || "{}"))
      // The source image goes in image_url (Krea-hosted, not our CDN).
      assert.equal(body.image_url, "https://krea.example/uploaded/seededit-source.png")
      // No size fields.
      assert.equal(body.width, undefined)
      assert.equal(body.height, undefined)
      assert.equal(body.aspect_ratio, undefined)
      assert.equal(body.resolution, undefined)
      return new Response(JSON.stringify({ job_id: "seededit-job-1", status: "queued" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }
    if (url === "https://api.krea.ai/jobs/seededit-job-1") {
      return new Response(
        JSON.stringify({
          job_id: "seededit-job-1",
          status: "completed",
          result: { urls: ["https://krea.example/seededit.png"] },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }
    if (url === "https://krea.example/seededit.png") {
      return new Response("seededit-png-bytes", {
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
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/image-edit/providers",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
          body: JSON.stringify({
            provider_id: "krea",
            api_key: "krea-test-secret",
            model: "bytedance/seededit",
          }),
        },
      ),
      env,
      { waitUntil() {} },
    )
    const createCtx = capturingContext()
    const { create, created } = await createKreaImageEditJobAndAwait({
      env,
      ctx: createCtx,
      body: {
        provider_id: "krea",
        model: "bytedance/seededit",
        source_gene_symbol: "A1BG",
        source_asset_sha256: SOURCE_SHA,
        adjustments: { remove_ai_generation_errors: true },
      },
    })
    assert.equal(create.status, 200, "create status: " + JSON.stringify(created))
    assert.equal(created.job.status, "succeeded")
    assert.ok(created.job.result_asset_sha256)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("image edit jobs with Krea ChatGPT 2 send width + height + aspect_ratio (B-574)", async () => {
  // Krea's openai/gpt-image-2 endpoint 422s with `Required: width, height`
  // if the body omits pixel dimensions, even when aspect_ratio is set. The
  // model definition opts in via requires_width_height: true, so the body
  // builder must send all three fields.
  const originalFetch = globalThis.fetch
  const db = new FakeDb()
  const env = buildEnv(db)
  const fetchCalls = []
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    fetchCalls.push({ url, init })
    if (url === "https://api.krea.ai/assets") {
      return new Response(
        JSON.stringify({
          id: "krea-asset-gpt2-1",
          image_url: "https://krea.example/uploaded/gpt2-source.png",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }
    if (url === "https://api.krea.ai/generate/image/openai/gpt-image-2") {
      const body = JSON.parse(String(init.body || "{}"))
      assert.equal(Array.isArray(body.image_urls), true)
      assert.equal(body.image_urls[0], "https://krea.example/uploaded/gpt2-source.png")
      // gpt-image-2 requires explicit width + height. Without them Krea
      // returns 422 'Required: width, height'.
      assert.equal(body.width, 1536)
      assert.equal(body.height, 2048)
      // aspect_ratio is also acceptable to gpt-image-2 and is in its
      // enum; we send it as a redundant hint.
      assert.equal(body.aspect_ratio, "3:4")
      return new Response(JSON.stringify({ job_id: "gpt2-job-1", status: "queued" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }
    if (url === "https://api.krea.ai/jobs/gpt2-job-1") {
      return new Response(
        JSON.stringify({
          job_id: "gpt2-job-1",
          status: "completed",
          result: { urls: ["https://krea.example/gpt2.png"] },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }
    if (url === "https://krea.example/gpt2.png") {
      return new Response("gpt2-png-bytes", {
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
    const providerCtx = capturingContext()
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/image-edit/providers",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
          body: JSON.stringify({
            provider_id: "krea",
            api_key: "krea-test-secret",
            model: "openai/gpt-image-2",
          }),
        },
      ),
      env,
      providerCtx,
    )

    const createCtx = capturingContext()
    const { create, created } = await createKreaImageEditJobAndAwait({
      env,
      ctx: createCtx,
      body: {
        provider_id: "krea",
        model: "openai/gpt-image-2",
        source_gene_symbol: "A1BG",
        source_asset_sha256: SOURCE_SHA,
        adjustments: { remove_ai_generation_errors: true },
      },
    })
    assert.equal(create.status, 200, "create status: " + JSON.stringify(created))
    assert.equal(created.job.status, "succeeded")
    assert.ok(created.job.result_asset_sha256)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("image edit jobs with Krea SeedEdit omit width/height from the body", async () => {
  // SeedEdit's body schema is exactly {prompt, seed, image_url}. Any size
  // key (width/height/aspect_ratio/resolution) is rejected as
  // "Unrecognized key(s) in object". Verify we don't send them.
  const originalFetch = globalThis.fetch
  const db = new FakeDb()
  const env = buildEnv(db)
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    if (url === "https://api.krea.ai/assets") {
      return new Response(
        JSON.stringify({
          id: "krea-asset-seededit-1",
          image_url: "https://krea.example/uploaded/seededit-source.png",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }
    if (url === "https://api.krea.ai/generate/image/bytedance/seededit") {
      const body = JSON.parse(String(init.body || "{}"))
      // The source image goes in image_url (Krea-hosted, not our CDN).
      assert.equal(body.image_url, "https://krea.example/uploaded/seededit-source.png")
      // No size fields.
      assert.equal(body.width, undefined)
      assert.equal(body.height, undefined)
      assert.equal(body.aspect_ratio, undefined)
      assert.equal(body.resolution, undefined)
      return new Response(JSON.stringify({ job_id: "seededit-job-1", status: "queued" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }
    if (url === "https://api.krea.ai/jobs/seededit-job-1") {
      return new Response(
        JSON.stringify({
          job_id: "seededit-job-1",
          status: "completed",
          result: { urls: ["https://krea.example/seededit.png"] },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }
    if (url === "https://krea.example/seededit.png") {
      return new Response("seededit-png-bytes", {
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
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/image-edit/providers",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
          body: JSON.stringify({
            provider_id: "krea",
            api_key: "krea-test-secret",
            model: "bytedance/seededit",
          }),
        },
      ),
      env,
      { waitUntil() {} },
    )
    const createCtx = capturingContext()
    const { create, created } = await createKreaImageEditJobAndAwait({
      env,
      ctx: createCtx,
      body: {
        provider_id: "krea",
        model: "bytedance/seededit",
        source_gene_symbol: "A1BG",
        source_asset_sha256: SOURCE_SHA,
        adjustments: { remove_ai_generation_errors: true },
      },
    })
    assert.equal(create.status, 200, "create status: " + JSON.stringify(created))
    assert.equal(created.job.status, "succeeded")
    assert.ok(created.job.result_asset_sha256)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("image edit jobs with Krea Ideogram 3.0 use character_reference_images body shape", async () => {
  const originalFetch = globalThis.fetch
  const db = new FakeDb()
  const env = buildEnv(db)
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    if (url === "https://api.krea.ai/assets") {
      assert.ok(init.body instanceof FormData, "Krea asset upload must use FormData")
      return new Response(
        JSON.stringify({
          id: "krea-asset-ideogram-1",
          image_url: "https://krea.example/uploaded/ideogram-source.png",
          width: 1024,
          height: 1024,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }
    if (url === "https://api.krea.ai/generate/image/ideogram/ideogram-3") {
      const body = JSON.parse(String(init.body || "{}"))
      assert.equal(Array.isArray(body.character_reference_images), true)
      assert.equal(body.character_reference_images.length, 1)
      assert.equal(typeof body.character_reference_images[0], "string")
      // Source must be Krea-hosted, not our CDN URL.
      assert.equal(
        body.character_reference_images[0],
        "https://krea.example/uploaded/ideogram-source.png",
      )
      // Ideogram V_3's resolution enum (per developer.ideogram.ai) does
      // not include a true 3:4 aspect. 1536x2048 (3:4) is rejected with
      // "Resolution 1536x2048 is not supported for Ideogram V_3". The
      // closest V_3 resolution is 896x1152 (≈ 0.778, near 3:4's 0.75).
      // The KREAbilling body schema accepts width/height directly.
      assert.equal(body.width, 896)
      assert.equal(body.height, 1152)
      return new Response(JSON.stringify({ job_id: "ideogram-job-1", status: "queued" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }
    if (url === "https://api.krea.ai/jobs/ideogram-job-1") {
      return new Response(
        JSON.stringify({
          job_id: "ideogram-job-1",
          status: "completed",
          result: { urls: ["https://krea.example/ideogram.png"] },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }
    if (url === "https://krea.example/ideogram.png") {
      return new Response("ideogram-png-bytes", {
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
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/image-edit/providers",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
          body: JSON.stringify({
            provider_id: "krea",
            api_key: "krea-test-secret",
            model: "ideogram/ideogram-3",
          }),
        },
      ),
      env,
      { waitUntil() {} },
    )

    const createCtx = capturingContext()
    const { create, created } = await createKreaImageEditJobAndAwait({
      env,
      ctx: createCtx,
      body: {
        provider_id: "krea",
        model: "ideogram/ideogram-3",
        source_gene_symbol: "A1BG",
        source_asset_sha256: SOURCE_SHA,
        adjustments: { remove_ai_generation_errors: true },
      },
    })
    assert.equal(create.status, 200, "create status: " + JSON.stringify(created))
    assert.equal(created.job.status, "succeeded")
    assert.ok(created.job.result_asset_sha256)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("image edit jobs with Krea SeedEdit omit width/height from the body", async () => {
  // SeedEdit's body schema is exactly {prompt, seed, image_url}. Any size
  // key (width/height/aspect_ratio/resolution) is rejected as
  // "Unrecognized key(s) in object". Verify we don't send them.
  const originalFetch = globalThis.fetch
  const db = new FakeDb()
  const env = buildEnv(db)
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    if (url === "https://api.krea.ai/assets") {
      return new Response(
        JSON.stringify({
          id: "krea-asset-seededit-1",
          image_url: "https://krea.example/uploaded/seededit-source.png",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }
    if (url === "https://api.krea.ai/generate/image/bytedance/seededit") {
      const body = JSON.parse(String(init.body || "{}"))
      // The source image goes in image_url (Krea-hosted, not our CDN).
      assert.equal(body.image_url, "https://krea.example/uploaded/seededit-source.png")
      // No size fields.
      assert.equal(body.width, undefined)
      assert.equal(body.height, undefined)
      assert.equal(body.aspect_ratio, undefined)
      assert.equal(body.resolution, undefined)
      return new Response(JSON.stringify({ job_id: "seededit-job-1", status: "queued" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }
    if (url === "https://api.krea.ai/jobs/seededit-job-1") {
      return new Response(
        JSON.stringify({
          job_id: "seededit-job-1",
          status: "completed",
          result: { urls: ["https://krea.example/seededit.png"] },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }
    if (url === "https://krea.example/seededit.png") {
      return new Response("seededit-png-bytes", {
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
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/image-edit/providers",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
          body: JSON.stringify({
            provider_id: "krea",
            api_key: "krea-test-secret",
            model: "bytedance/seededit",
          }),
        },
      ),
      env,
      { waitUntil() {} },
    )
    const createCtx = capturingContext()
    const { create, created } = await createKreaImageEditJobAndAwait({
      env,
      ctx: createCtx,
      body: {
        provider_id: "krea",
        model: "bytedance/seededit",
        source_gene_symbol: "A1BG",
        source_asset_sha256: SOURCE_SHA,
        adjustments: { remove_ai_generation_errors: true },
      },
    })
    assert.equal(create.status, 200, "create status: " + JSON.stringify(created))
    assert.equal(created.job.status, "succeeded")
    assert.ok(created.job.result_asset_sha256)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("candidate-generation provider list includes only generate-capable Krea models", async () => {
  const db = new FakeDb()
  const env = buildEnv(db)
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

  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/image-edit/providers?op=candidate_generation",
        { headers: { Cookie: "session=abc123" } },
      ),
      env,
      { waitUntil() {} },
    )
  const body = await response.json()
  assert.equal(body.operation, "candidate_generation")
  const krea = body.supported_providers.find((p) => p.provider_id === "krea")
  const kreaModelNames = krea.model_options.map((m) => m.model)
  for (const required of [
    "krea/krea-2/large",
    "bfl/flux-1-dev",
    "google/nano-banana-pro",
    "openai/gpt-image-2",
    "bytedance/seedream-4",
    "ideogram/ideogram-3",
  ]) {
    assert.ok(
      kreaModelNames.includes(required),
      "Krea candidate generation should expose " + required,
    )
  }
  // The user gets to pick a text-to-image model for the "new candidate" flow.
  // Edit-only models (SeedEdit, Runway) should not appear in this list.
  assert.ok(
    !kreaModelNames.includes("bytedance/seededit"),
    "SeedEdit is edit-only and should not appear in candidate generation",
  )
  assert.ok(
    !kreaModelNames.includes("runway/gen-4-image"),
    "Runway Gen-4 requires reference images and should not appear in candidate generation",
  )
  // Fal now exposes both edit and gen models. Gen models should appear;
  // edit-only models should not.
  const fal = body.supported_providers.find((p) => p.provider_id === "fal")
  assert.ok(fal, "Fal should appear in candidate generation")
  const falGenModels = (fal.model_options || []).map((m) => m.model)
  for (const required of [
    "fal-ai/nano-banana-pro",
    "fal-ai/nano-banana-2",
    "fal-ai/flux-2",
    "bytedance/seedream/v5/pro/text-to-image",
    "bytedance/seedream/v5/lite/text-to-image",
    "openai/gpt-image-2",
    "fal-ai/omnigen-v2",
  ]) {
    assert.ok(falGenModels.includes(required), "Fal gen should expose " + required)
  }
  for (const hidden of [
    "fal-ai/nano-banana-pro/edit",
    "fal-ai/nano-banana-2/edit",
    "fal-ai/flux-pro/kontext",
    "fal-ai/flux-2/edit",
    "openai/gpt-image-2/edit",
    "bytedance/seedream/v5/pro/edit",
    "bytedance/seedream/v5/lite/edit",
  ]) {
    assert.ok(!falGenModels.includes(hidden), "Fal gen should NOT expose edit-only " + hidden)
  }
})

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
    "krea:bfl/flux-1-kontext-dev",
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
      url === "https://api.krea.ai/generate/image/bfl/flux-1-kontext-dev" ||
      url === "https://api.krea.ai/generate/image/bfl/flux-1-dev"
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
          headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
          body: JSON.stringify({
            provider_id: "krea",
            api_key: "krea-test-secret",
            model: "bfl/flux-1-kontext-dev",
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
          { headers: { Cookie: "session=abc123" } },
        ),
        env,
        { waitUntil() {} },
      )
    const listed = await listResponse.json()
    const krea = listed.supported_providers.find((p) => p.provider_id === "krea")
    const lastUsedOption = krea.model_options.find((m) => m.last_used === true)
    assert.equal(lastUsedOption?.model, "bfl/flux-1-kontext-dev")
    assert.deepEqual(listed.last_used, {
      provider_id: "krea",
      model: "bfl/flux-1-kontext-dev",
    })
    // Order stays catalog order: Flux Kontext is first by definition, and
    // flux-1-dev remains after it. last_used is only a flag, not a reshuffle.
    const liveOrder = krea.model_options.map((m) => m.model)
    assert.equal(liveOrder[0], "bfl/flux-1-kontext-dev")
    assert.ok(liveOrder.indexOf("bfl/flux-1-dev") > 0)
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
            headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
            body: JSON.stringify({
              provider_id: "krea",
              model: "bfl/flux-1-kontext-dev",
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
    // Switch the saved provider's model to bfl/flux-1-dev by sending the new
    // model in the request body. The route at line 25671 already applies the
    // model override from the body to providerRow.model.
    const secondCtx = capturingContext()
    const secondResponse =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(
          "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/image-edit/jobs",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
            body: JSON.stringify({
              provider_id: "krea",
              model: "bfl/flux-1-dev",
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
    assert.equal(lastWrite?.v, "krea:bfl/flux-1-dev")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("Krea structured error responses surface a readable message, not [object Object]", async () => {
  // The previous behavior: when Krea returned {"error":{"code":"...","message":"..."}}
  // the worker would set status: "failed", error: "[object Object]" because it
  // tried to coerce a nested object to a string. This test pins the fix:
  // the surfaced error must contain the actual Krea message text.
  const originalFetch = globalThis.fetch
  const db = new FakeDb()
  const env = buildEnv(db)
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    if (url === "https://api.krea.ai/assets") {
      return new Response(
        JSON.stringify({
          id: "krea-asset-err-1",
          image_url: "https://krea.example/uploaded/source.png",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }
    if (url === "https://api.krea.ai/generate/image/google/nano-banana") {
      return new Response(
        JSON.stringify({
          job_id: "krea-err-job-1",
          status: "queued",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }
    if (url === "https://api.krea.ai/jobs/krea-err-job-1") {
      // Real Krea error shape: error is { code, message } where message is a string.
      return new Response(
        JSON.stringify({
          job_id: "krea-err-job-1",
          status: "failed",
          error: { code: "model_rejected_image_url", message: "Could not fetch the source image" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }
    if (init?.cf?.image?.format === "webp" && !init?.cf?.image?.width) {
      return new Response(EDITED_BYTES, { status: 200, headers: { "Content-Type": "image/webp" } })
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
            provider_id: "krea",
            api_key: "krea-test-secret",
            model: "google/nano-banana",
          }),
        },
      ),
      env,
      { waitUntil() {} },
    )
    const createCtx = capturingContext()
    const createResponse =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(
          "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/image-edit/jobs",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
            body: JSON.stringify({
              provider_id: "krea",
              model: "google/nano-banana",
              source_gene_symbol: "A1BG",
              source_asset_sha256: SOURCE_SHA,
              adjustments: { remove_ai_generation_errors: true },
            }),
          },
        ),
        env,
        createCtx,
      )
    const created = await createResponse.json()
    assert.equal(createResponse.status, 502, "create status: " + JSON.stringify(created))
    assert.notEqual(created.error, "[object Object]")
    assert.match(created.error, /Could not fetch the source image/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("Krea asset upload failure surfaces a readable error from the Krea error body", async () => {
  // If Krea returns a 4xx from /assets (e.g. bad auth, file too large), the
  // worker should propagate the readable Krea error to the user, not
  // "[object Object]".
  const originalFetch = globalThis.fetch
  const db = new FakeDb()
  const env = buildEnv(db)
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url === "https://api.krea.ai/assets") {
      return new Response(
        JSON.stringify({
          error: { code: "file_too_large", message: "Maximum file size: 75MB" },
        }),
        { status: 413, headers: { "Content-Type": "application/json" } },
      )
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
            provider_id: "krea",
            api_key: "krea-test-secret",
            model: "google/nano-banana",
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
              provider_id: "krea",
              model: "google/nano-banana",
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
    assert.equal(createResponse.status, 502)
    assert.equal(created.job.status, "failed")
    assert.notEqual(created.job.error, "[object Object]")
    assert.match(created.job.error, /Maximum file size: 75MB/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("Krea 4xx from the create-job POST surfaces 502 with the Krea error text", async () => {
  // Krea is now sync. A 4xx from the create-job POST is the route's error
  // path: the response is 502 with the Krea error text, the D1 row is
  // marked failed. There is no ctx.waitUntil, no 202, no ghost row.
  const originalFetch = globalThis.fetch
  const db = new FakeDb()
  const env = buildEnv(db)
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url === "https://api.krea.ai/assets") {
      return new Response(
        JSON.stringify({
          id: "krea-asset-billing-1",
          image_url: "https://krea.example/uploaded/billing-source.png",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }
    if (url === "https://api.krea.ai/generate/image/openai/gpt-image-2") {
      return new Response(JSON.stringify({ error: "This model requires a higher plan." }), {
        status: 402,
        headers: { "Content-Type": "application/json" },
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
            provider_id: "krea",
            api_key: "krea-test-secret",
            model: "openai/gpt-image-2",
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
              provider_id: "krea",
              model: "openai/gpt-image-2",
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
    // Sync failure: 502 with the Krea error text in the body, job marked failed.
    assert.equal(createResponse.status, 502)
    assert.equal(created.ok, false)
    assert.equal(created.job.status, "failed")
    assert.match(created.error, /requires a higher plan/)
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
          headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
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
    if (url === "https://api.krea.ai/generate/image/bfl/flux-1-dev") {
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
          headers: { "Content-Type": "application/json", Cookie: "session=abc123" },
          body: JSON.stringify({
            provider_id: "krea",
            api_key: "krea-test-secret",
            model: "bfl/flux-1-dev",
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
        model: "bfl/flux-1-dev",
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
        model: "bfl/flux-1-dev",
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
