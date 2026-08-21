import assert from "node:assert/strict"
import test from "node:test"
import { DatabaseSync } from "node:sqlite"

import { createDiagnosticMatrixRunForTest } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

class SQLiteD1Statement {
  constructor(owner, sql) {
    this.owner = owner
    this.sql = String(sql || "")
    this.args = []
  }

  bind(...args) {
    this.args = args
    return this
  }

  async first() {
    return this.owner.db.prepare(this.sql).get(...this.args) || null
  }

  async all() {
    return { results: this.owner.db.prepare(this.sql).all(...this.args) }
  }

  async run() {
    const result = this.owner.db.prepare(this.sql).run(...this.args)
    return {
      success: true,
      meta: {
        changes: Number(result.changes || 0),
        last_row_id: Number(result.lastInsertRowid || 0),
      },
    }
  }
}

class SQLiteD1 {
  constructor(db, { failBatchAt = 0 } = {}) {
    this.db = db
    this.failBatchAt = failBatchAt
  }

  prepare(sql) {
    return new SQLiteD1Statement(this, sql)
  }

  async batch(statements) {
    this.db.exec("BEGIN IMMEDIATE")
    try {
      const results = []
      for (let index = 0; index < statements.length; index += 1) {
        if (this.failBatchAt && index + 1 === this.failBatchAt) {
          throw new Error("simulated atomic batch interruption")
        }
        results.push(await statements[index].run())
      }
      this.db.exec("COMMIT")
      return results
    } catch (error) {
      this.db.exec("ROLLBACK")
      throw error
    }
  }
}

function diagnosticDatabase(options) {
  const db = new DatabaseSync(":memory:")
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE icono_gene_catalog (
      gene_symbol TEXT PRIMARY KEY,
      full_name TEXT NOT NULL DEFAULT ''
    );
    INSERT INTO icono_gene_catalog VALUES ('AFF2', 'ALF transcription elongation factor 2');
    CREATE TABLE icono_factory_active_recipe (
      singleton_id INTEGER PRIMARY KEY,
      pipeline_code TEXT NOT NULL,
      vision_revision INTEGER NOT NULL,
      updated_by TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO icono_factory_active_recipe VALUES (1, 'A', 1, 'test', CURRENT_TIMESTAMP);
    CREATE TABLE icono_factory_pipeline_vision_recommendations (
      pipeline_code TEXT PRIMARY KEY,
      vision_revision INTEGER NOT NULL,
      updated_by TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE icono_factory_vision_definitions (
      revision INTEGER PRIMARY KEY,
      source_id TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      source_sha256 TEXT NOT NULL,
      positive_prefix TEXT NOT NULL,
      negative_prompt TEXT NOT NULL,
      prompt_content_mode TEXT NOT NULL,
      prompt_order_mode TEXT NOT NULL,
      prompt_replace_underscores INTEGER NOT NULL,
      emulsion_base_id TEXT NOT NULL,
      status TEXT NOT NULL,
      accepted_by TEXT NOT NULL,
      accepted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO icono_factory_vision_definitions VALUES (
      1, 'artist-random-anima', 'Vision 1', '${"0".repeat(64)}', '', '',
      'tags_only', 'manifestation_then_vision', 0, 'artist-random-anima',
      'accepted', 'test', CURRENT_TIMESTAMP
    );
    CREATE TABLE icono_generation_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gene_symbol TEXT NOT NULL,
      requester_user_id TEXT NOT NULL,
      requester_username TEXT NOT NULL DEFAULT '',
      request_kind TEXT NOT NULL,
      request_prompt TEXT NOT NULL,
      source_gene_symbol TEXT NOT NULL,
      source_asset_sha256 TEXT NOT NULL,
      request_mode TEXT NOT NULL,
      requested_vision_id TEXT NOT NULL,
      requested_emulsion_slot INTEGER NOT NULL,
      client_request_id TEXT NOT NULL,
      request_batch_id TEXT NOT NULL,
      request_batch_size INTEGER NOT NULL,
      prompt_body_mode TEXT NOT NULL,
      seed_mode TEXT NOT NULL,
      factory_pipeline_code TEXT NOT NULL,
      factory_vision_revision INTEGER NOT NULL,
      request_origin TEXT NOT NULL,
      diagnostic_run_id TEXT NOT NULL,
      status TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      fulfilled_asset_sha256 TEXT NOT NULL DEFAULT '',
      fulfilled_vision_id TEXT NOT NULL DEFAULT '',
      fulfillment_note TEXT NOT NULL DEFAULT ''
    );
    CREATE UNIQUE INDEX idx_test_generation_client
      ON icono_generation_requests (requester_user_id, client_request_id);
    CREATE TABLE icono_diagnostic_matrix_runs (
      id TEXT PRIMARY KEY,
      gene_symbol TEXT NOT NULL,
      vision_revision INTEGER NOT NULL,
      pipeline_codes_json TEXT NOT NULL,
      emulsion_slots_json TEXT NOT NULL,
      cell_count INTEGER NOT NULL,
      prompt_body_mode TEXT NOT NULL,
      queue_state TEXT NOT NULL DEFAULT 'building',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE icono_diagnostic_matrix_cells (
      run_id TEXT NOT NULL,
      pipeline_code TEXT NOT NULL,
      vision_revision INTEGER NOT NULL,
      emulsion_slot INTEGER NOT NULL,
      generation_request_id INTEGER NOT NULL UNIQUE,
      PRIMARY KEY (run_id, pipeline_code, vision_revision, emulsion_slot),
      FOREIGN KEY (run_id) REFERENCES icono_diagnostic_matrix_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (generation_request_id) REFERENCES icono_generation_requests(id) ON DELETE CASCADE
    );
  `)
  return { db, d1: new SQLiteD1(db, options) }
}

const runId = "diag-11111111-2222-4333-8444-555555555555"
const runOptions = {
  geneSymbol: "AFF2",
  pipelineCodes: ["A", "B", "C", "D", "E"],
  emulsionSlots: [30593, 255, 343, 21329, 24210],
  visionRevision: 1,
  promptBodyMode: "taggerizer_prompt",
  createdBy: "admin-1",
  createdUsername: "tester",
  clientRunId: runId,
}

test("diagnostic matrix commits all 25 cells atomically and retrying is idempotent", async () => {
  const { db, d1 } = diagnosticDatabase()
  try {
    const env = { ICONOPLASM_DB: d1 }
    const url = new URL("https://iconoplasm.brinedew.bio/admin")
    const created = await createDiagnosticMatrixRunForTest(env, url, runOptions)
    assert.equal(created.ok, true)
    assert.equal(created.run.id, runId)
    assert.equal(created.run.cell_count, 25)
    assert.equal(created.run.counts.total, 25)
    assert.equal(
      db.prepare("SELECT queue_state FROM icono_diagnostic_matrix_runs WHERE id = ?").get(runId)
        .queue_state,
      "queued",
    )
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM icono_generation_requests").get().n, 25)

    const retried = await createDiagnosticMatrixRunForTest(env, url, runOptions)
    assert.equal(retried.ok, true)
    assert.equal(retried.run.counts.total, 25)
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM icono_generation_requests").get().n, 25)
  } finally {
    db.close()
  }
})

test("diagnostic matrix leaves no partial run or requests when the batch is interrupted", async () => {
  const { db, d1 } = diagnosticDatabase({ failBatchAt: 12 })
  try {
    const result = await createDiagnosticMatrixRunForTest(
      { ICONOPLASM_DB: d1 },
      new URL("https://iconoplasm.brinedew.bio/admin"),
      runOptions,
    )
    assert.equal(result.ok, false)
    assert.match(result.error, /simulated atomic batch interruption/)
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM icono_diagnostic_matrix_runs").get().n, 0)
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM icono_generation_requests").get().n, 0)
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM icono_diagnostic_matrix_cells").get().n, 0)
  } finally {
    db.close()
  }
})
