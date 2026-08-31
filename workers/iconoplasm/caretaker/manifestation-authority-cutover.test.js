import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { DatabaseSync } from "node:sqlite"

import {
  beginManifestationAuthorityCutover,
  normalizeLegacyManifestationSource,
  planNextManifestationCutoverPage,
  stableCutoverIdentities,
  verifyPlannedLegacySource,
} from "./manifestation-authority-cutover.js"
import { advanceManifestationAuthorityCutover } from "./manifestation-cutover-processor.js"
import {
  advanceManifestationCutoverBackupArtifact,
  beginManifestationCutoverBackupArtifact,
} from "./manifestation-cutover-backup-artifact.js"
import { projectCanonicalManifestationCutoverEvent } from "../../lib/iconoplasm-manifestation-authority-projection.js"
import {
  beginLegacyManifestationPlaintextRetirement,
  retireNextLegacyManifestationPlaintextPage,
} from "./manifestation-authority-plaintext-retirement.js"

const AUTHORING_BASE = readFileSync(
  new URL(
    "../../../migrations-iconoplasm-authoring/0001_caretaker_manifestation_authority.sql",
    import.meta.url,
  ),
  "utf8",
)
const AUTHORING_CUTOVER = readFileSync(
  new URL(
    "../../../migrations-iconoplasm-authoring/0003_manifestation_authority_cutover.sql",
    import.meta.url,
  ),
  "utf8",
)
const AUTHORING_BOUNDARY = readFileSync(
  new URL(
    "../../../migrations-iconoplasm-authoring/0002_caretaker_server_boundary.sql",
    import.meta.url,
  ),
  "utf8",
)
const AUTHORING_RESUMABLE_UPLOADS = readFileSync(
  new URL(
    "../../../migrations-iconoplasm-authoring/0006_resumable_cutover_upload_envelopes.sql",
    import.meta.url,
  ),
  "utf8",
)
const PRIMARY_CUTOVER = readFileSync(
  new URL(
    "../../../migrations-iconoplasm/0084_manifestation_authority_cutover.sql",
    import.meta.url,
  ),
  "utf8",
)

function sha(character) {
  return character.repeat(64)
}

function cutoverEnv() {
  return {
    ICONOPLASM_AUTHORING_BODY_KEY_VERSION: "1",
    ICONOPLASM_AUTHORING_BODY_KEK_V1: Buffer.from(new Uint8Array(32).fill(13)).toString("base64"),
    ICONOPLASM_AUTHORING_STORAGE_ZONE: "cutover-test-zone",
    ICONOPLASM_AUTHORING_STORAGE_PASSWORD: "cutover-test-password",
    ICONOPLASM_AUTHORING_BACKUP_STORAGE_HOST: "storage.bunnycdn.com",
    ICONOPLASM_AUTHORING_BACKUP_STORAGE_ZONE: "cutover-backup-test-zone",
    ICONOPLASM_AUTHORING_BACKUP_STORAGE_PASSWORD: "cutover-backup-test-password",
  }
}

function installCutoverStorage(t, { missOnSecondRead = false } = {}) {
  const original = globalThis.fetch
  const objects = new Map()
  const reads = new Map()
  t.after(() => {
    globalThis.fetch = original
  })
  globalThis.fetch = async (url, init = {}) => {
    const key = String(url)
    const method = String(init.method || "GET").toUpperCase()
    if (method === "PUT") {
      objects.set(key, Uint8Array.from(init.body))
      return new Response(null, { status: 201, headers: { etag: '"cutover-etag"' } })
    }
    if (method === "DELETE") {
      objects.delete(key)
      return new Response(null, { status: 200 })
    }
    const bytes = objects.get(key)
    const readNumber = (reads.get(key) || 0) + 1
    reads.set(key, readNumber)
    if (bytes && missOnSecondRead && key.includes("/cutover-test-zone/") && readNumber === 2) {
      return new Response(null, { status: 404 })
    }
    return bytes
      ? new Response(bytes, { status: 200, headers: { etag: '"cutover-etag"' } })
      : new Response(null, { status: 404 })
  }
  return objects
}

class TestStatement {
  constructor(database, sql, parameters = []) {
    this.database = database
    this.sql = sql
    this.parameters = parameters
  }

  bind(...parameters) {
    return new TestStatement(this.database, this.sql, parameters)
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

class TestD1 {
  constructor(schema = "") {
    this.raw = new DatabaseSync(":memory:")
    if (schema) this.raw.exec(schema)
  }

  prepare(sql) {
    return new TestStatement(this.raw, sql)
  }

  async batch(statements) {
    this.raw.exec("BEGIN IMMEDIATE")
    try {
      const results = []
      for (const statement of statements) results.push(await statement.run())
      this.raw.exec("COMMIT")
      return results
    } catch (error) {
      this.raw.exec("ROLLBACK")
      throw error
    }
  }

  close() {
    this.raw.close()
  }
}

test("a frozen primary database rejects every legacy manifestation change", () => {
  const db = new DatabaseSync(":memory:")
  db.exec(`CREATE TABLE icono_gene_essence (
    gene_symbol TEXT PRIMARY KEY,
    manifestation TEXT,
    manifestation_tags TEXT,
    manifestation_fields_json TEXT
  )`)
  db.exec(PRIMARY_CUTOVER)
  db.prepare(
    `INSERT INTO icono_gene_essence (
       gene_symbol, manifestation, manifestation_tags, manifestation_fields_json
     ) VALUES (?, ?, ?, ?)`,
  ).run("TP53", "seed prose", "guardian, measured", "{}")
  db.prepare(
    `UPDATE icono_manifestation_projection_authority
        SET mode = 'shadow_frozen', authority_epoch = 2
      WHERE singleton = 1`,
  ).run()

  assert.throws(
    () =>
      db
        .prepare("UPDATE icono_gene_essence SET manifestation = ? WHERE gene_symbol = ?")
        .run("silent overwrite", "TP53"),
    /legacy_manifestation_writer_is_retired/,
  )
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO icono_gene_essence (
             gene_symbol, manifestation, manifestation_tags, manifestation_fields_json
           ) VALUES (?, ?, '', '')`,
        )
        .run("BRCA1", "new legacy prose"),
    /legacy_manifestation_writer_is_retired/,
  )
  assert.equal(
    db.prepare("SELECT manifestation FROM icono_gene_essence WHERE gene_symbol = 'TP53'").get()
      .manifestation,
    "seed prose",
  )
  db.prepare(
    `UPDATE icono_manifestation_projection_authority
        SET mode = 'authoritative'
      WHERE singleton = 1`,
  ).run()
  assert.throws(
    () =>
      db
        .prepare(
          `UPDATE icono_manifestation_projection_authority
              SET mode = 'legacy_write'
            WHERE singleton = 1`,
        )
        .run(),
    /legacy_manifestation_writer_is_retired/,
  )
  assert.throws(
    () =>
      db
        .prepare(
          `UPDATE icono_manifestation_projection_authority
              SET authority_epoch = 1
            WHERE singleton = 1`,
        )
        .run(),
    /manifestation_authority_epoch_cannot_rewind/,
  )
  db.prepare(
    `UPDATE icono_gene_essence
        SET manifestation = NULL, manifestation_tags = NULL,
            manifestation_fields_json = NULL
      WHERE gene_symbol = 'TP53'`,
  ).run()
  assert.deepEqual(
    {
      ...db
        .prepare(
          `SELECT manifestation, manifestation_tags, manifestation_fields_json
             FROM icono_gene_essence WHERE gene_symbol = 'TP53'`,
        )
        .get(),
    },
    { manifestation: null, manifestation_tags: null, manifestation_fields_json: null },
  )
  db.close()
})

test("the compact projection rejects epoch mismatch, sequence reuse, and replay mutation", () => {
  const db = new DatabaseSync(":memory:")
  db.exec(`CREATE TABLE icono_gene_essence (
    gene_symbol TEXT PRIMARY KEY,
    manifestation TEXT,
    manifestation_tags TEXT,
    manifestation_fields_json TEXT
  )`)
  db.exec(PRIMARY_CUTOVER)
  db.prepare(
    "UPDATE icono_manifestation_projection_authority SET authority_epoch = 2 WHERE singleton = 1",
  ).run()
  const insert = db.prepare(`INSERT INTO icono_manifestation_canonical_projection (
    gene_id, canonical_symbol, canonical_manifestation_id, canonical_revision_id,
    canonical_selection_id, canonical_body_sha256, canonical_body_bytes,
    canonical_revision_lifecycle, head_version, gene_revision, authority_event_id,
    authority_event_sequence, authority_epoch, public_material_event_id,
    public_material_version
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  insert.run(
    "gene_tp53_stable",
    "TP53",
    "manifestation_seed_tp53",
    "revision_seed_tp53",
    "selection_seed_tp53",
    sha("a"),
    100,
    "active",
    1,
    1,
    "event_tp53_7",
    7,
    2,
    "event_tp53_7",
    1,
  )
  assert.throws(
    () =>
      db
        .prepare(
          `UPDATE icono_manifestation_canonical_projection
              SET authority_event_sequence = 6, gene_revision = 0
            WHERE gene_id = 'gene_tp53_stable'`,
        )
        .run(),
    /manifestation_projection_cannot_rewind/,
  )
  assert.throws(
    () =>
      db
        .prepare(
          `UPDATE icono_manifestation_canonical_projection
              SET canonical_body_sha256 = ?
            WHERE gene_id = 'gene_tp53_stable'`,
        )
        .run(sha("c")),
    /manifestation_projection_event_replay_changed_payload/,
  )
  assert.throws(
    () =>
      insert.run(
        "gene_brca1_stable",
        "BRCA1",
        "manifestation_seed_brca1",
        "revision_seed_brca1",
        "selection_seed_brca1",
        sha("b"),
        120,
        "active",
        1,
        1,
        "event_brca1_7",
        7,
        2,
        "event_brca1_7",
        1,
      ),
    /UNIQUE constraint failed/,
  )
  assert.throws(
    () =>
      insert.run(
        "gene_brca1_stable",
        "BRCA1",
        "manifestation_seed_brca1",
        "revision_seed_brca1",
        "selection_seed_brca1",
        sha("b"),
        120,
        "active",
        1,
        1,
        "event_brca1_8",
        8,
        1,
        "event_brca1_8",
        1,
      ),
    /manifestation_projection_epoch_mismatch/,
  )
  db.close()
})

test("cutover plans keep hashes and IDs but no plaintext and cannot be rewritten", () => {
  const db = new DatabaseSync(":memory:")
  db.exec(AUTHORING_BASE)
  db.exec(AUTHORING_CUTOVER)
  db.prepare(
    `INSERT INTO icono_authority_accounts
       (account_id, public_credit_label, status)
     VALUES (?, 'Cutover administrator', 'active')`,
  ).run("account_admin_cutover")
  db.prepare(
    `INSERT INTO icono_manifestation_cutover_runs (
       cutover_run_id, source_snapshot_id, target_authority_epoch,
       plan_chain_sha256, created_by_account_id
     ) VALUES (?, ?, ?, ?, ?)`,
  ).run("cutover_run_0001", "source_snapshot_0001", 2, sha("0"), "account_admin_cutover")
  db.prepare(
    `INSERT INTO icono_manifestation_cutover_items (
       cutover_run_id, canonical_symbol, gene_id, source_kind,
       seed_manifestation_id, seed_revision_id, seed_selection_id, seed_command_id,
       seed_tags_derivative_id, seed_tags_command_id, seed_tags_selection_command_id,
       source_body_sha256, source_body_bytes, source_tags_sha256, source_tags_bytes,
       source_fields_sha256, source_fields_bytes,
       source_sample_label, source_sample_number, source_sample_text_sha256
     ) VALUES (?, ?, ?, 'manifestation', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "cutover_run_0001",
    "TP53",
    "gene_tp53_stable",
    "manifestation_seed_tp53",
    "revision_seed_tp53",
    "selection_seed_tp53",
    "command_seed_tp53",
    "derivative_seed_tp53",
    "command_derivative_tp53",
    "command_derivative_select_tp53",
    sha("a"),
    100,
    sha("b"),
    20,
    sha("d"),
    2,
    "B-646",
    646,
    sha("c"),
  )
  db.prepare(
    `INSERT INTO icono_manifestation_cutover_items (
       cutover_run_id, canonical_symbol, gene_id, source_kind, seed_command_id
     ) VALUES (?, ?, ?, 'no_manifestation', ?)`,
  ).run("cutover_run_0001", "BRCA1", "gene_brca1_stable", "command_seed_empty_brca1")

  const columns = db.prepare("PRAGMA table_info(icono_manifestation_cutover_items)").all()
  assert.equal(
    columns.some((column) => /prose|plaintext|body_text|tags_text/i.test(column.name)),
    false,
  )
  assert.throws(
    () =>
      db
        .prepare(
          `UPDATE icono_manifestation_cutover_items
              SET source_body_sha256 = ?
            WHERE cutover_run_id = ? AND canonical_symbol = ?`,
        )
        .run(sha("d"), "cutover_run_0001", "TP53"),
    /cutover_source_plan_is_immutable/,
  )
  db.prepare(
    `UPDATE icono_manifestation_cutover_items
        SET status = 'registered_unseeded'
      WHERE cutover_run_id = ? AND canonical_symbol = ?`,
  ).run("cutover_run_0001", "BRCA1")
  assert.throws(
    () =>
      db
        .prepare(
          `UPDATE icono_manifestation_cutover_items
              SET status = 'planned'
            WHERE cutover_run_id = ? AND canonical_symbol = ?`,
        )
        .run("cutover_run_0001", "BRCA1"),
    /cutover_item_status_cannot_rewind/,
  )
  db.close()
})

test("stable cutover IDs do not depend on prose and no-source genes get no invented seed", async () => {
  const first = await stableCutoverIdentities("tp53", { hasBody: true, hasTags: true })
  const second = await stableCutoverIdentities("TP53", { hasBody: true, hasTags: true })
  assert.deepEqual(first, second)
  assert.match(first.gene_id, /^gene_[a-f0-9]{48}$/)
  assert.match(first.seed_revision_id, /^revision_[a-f0-9]{48}$/)
  assert.match(first.seed_tags_derivative_id, /^derivative_[a-f0-9]{48}$/)

  const noSource = await normalizeLegacyManifestationSource({
    gene_symbol: "BRCA1",
    manifestation: "",
    manifestation_tags: "",
    sample_label: "B-2",
    sample_number: 2,
    sample_text_hash: sha("a"),
  })
  assert.equal(noSource.source_kind, "no_manifestation")
  assert.equal("seed_revision_id" in noSource, false)
  assert.equal(noSource.source_body_sha256, null)
})

test("bounded planning is resumable, hash-only, and detects a changed frozen source", async (t) => {
  const authority = new TestD1(`${AUTHORING_BASE}\n${AUTHORING_CUTOVER}`)
  const primary = new TestD1(`CREATE TABLE icono_gene_essence (
    gene_symbol TEXT PRIMARY KEY,
    manifestation TEXT,
    manifestation_tags TEXT,
    manifestation_fields_json TEXT,
    sample_label TEXT,
    sample_number INTEGER,
    sample_text_hash TEXT,
    updated_at TEXT
  );`)
  t.after(() => {
    authority.close()
    primary.close()
  })
  authority.raw
    .prepare(
      `INSERT INTO icono_authority_accounts
         (account_id, public_credit_label, status)
       VALUES (?, 'Cutover administrator', 'active')`,
    )
    .run("account_admin_cutover")
  const insertSource = primary.raw.prepare(`INSERT INTO icono_gene_essence (
    gene_symbol, manifestation, manifestation_tags, sample_label,
    sample_number, sample_text_hash, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?)`)
  insertSource.run(
    "BRCA1",
    "repairing archivist",
    "repair, archivist",
    "B-1",
    1,
    sha("1"),
    "2026-08-29",
  )
  insertSource.run("EGFR", "signal cartographer", "signal, map", "B-2", 2, sha("2"), "2026-08-29")
  insertSource.run(
    "TP53",
    "measured guardian",
    "guardian, measured",
    "B-3",
    3,
    sha("3"),
    "2026-08-29",
  )

  await beginManifestationAuthorityCutover(authority, {
    cutoverRunId: "cutover_run_planner",
    sourceSnapshotId: "source_snapshot_planner",
    targetAuthorityEpoch: 2,
    createdByAccountId: "account_admin_cutover",
    now: "2026-08-30T00:00:00.000Z",
  })
  const pageOne = await planNextManifestationCutoverPage(primary, authority, {
    cutoverRunId: "cutover_run_planner",
    limit: 2,
    now: "2026-08-30T00:01:00.000Z",
  })
  assert.equal(pageOne.status, "planning")
  assert.equal(pageOne.planned_items, 2)
  const pageTwo = await planNextManifestationCutoverPage(primary, authority, {
    cutoverRunId: "cutover_run_planner",
    limit: 2,
    now: "2026-08-30T00:02:00.000Z",
  })
  assert.equal(pageTwo.status, "ready")
  assert.equal(pageTwo.planned_items, 3)
  assert.equal(pageTwo.source_manifestation_count, 3)
  assert.match(pageTwo.source_snapshot_sha256, /^[a-f0-9]{64}$/)

  const stored = authority.raw
    .prepare(
      `SELECT * FROM icono_manifestation_cutover_items
        WHERE cutover_run_id = ? AND canonical_symbol = ?`,
    )
    .get("cutover_run_planner", "TP53")
  assert.equal(Object.values(stored).includes("measured guardian"), false)
  await verifyPlannedLegacySource(primary, stored)
  primary.raw
    .prepare("UPDATE icono_gene_essence SET manifestation = ? WHERE gene_symbol = ?")
    .run("changed after plan", "TP53")
  await assert.rejects(
    verifyPlannedLegacySource(primary, stored),
    (error) => error?.code === "CUTOVER_SOURCE_CHANGED",
  )
})

test("legacy plaintext retirement requires an authoritative snapshot and verified backup identity", async (t) => {
  const authority = new TestD1(`${AUTHORING_BASE}\n${AUTHORING_CUTOVER}`)
  const primary = new TestD1(`CREATE TABLE icono_gene_essence (
    gene_symbol TEXT PRIMARY KEY,
    manifestation TEXT,
    manifestation_tags TEXT,
    manifestation_fields_json TEXT
  );\n${PRIMARY_CUTOVER}`)
  t.after(() => {
    authority.close()
    primary.close()
  })
  authority.raw
    .prepare(
      `INSERT INTO icono_authority_accounts
         (account_id, public_credit_label, status)
       VALUES (?, 'Cutover administrator', 'active')`,
    )
    .run("account_admin_retirement")
  authority.raw
    .prepare(
      `INSERT INTO icono_manifestation_cutover_runs (
         cutover_run_id, source_snapshot_id, source_snapshot_sha256,
         target_authority_epoch, plan_chain_sha256, status,
         created_by_account_id
       ) VALUES (?, ?, ?, 2, ?, 'authoritative', ?)`,
    )
    .run(
      "cutover_run_retirement",
      "source_snapshot_retirement",
      sha("a"),
      sha("a"),
      "account_admin_retirement",
    )
  const insert = primary.raw.prepare(
    `INSERT INTO icono_gene_essence
       (gene_symbol, manifestation, manifestation_tags, manifestation_fields_json)
     VALUES (?, ?, ?, ?)`,
  )
  insert.run("BRCA1", "repairing archivist", "repair, archivist", "{}")
  insert.run("TP53", "measured guardian", "guardian, measured", "{}")
  installCutoverStorage(t)
  const env = cutoverEnv()
  await beginManifestationCutoverBackupArtifact(authority, env, {
    cutoverRunId: "cutover_run_retirement",
    backupArtifactId: "backup_artifact_retirement",
    now: "2026-08-30T00:30:00.000Z",
  })
  const backup = await advanceManifestationCutoverBackupArtifact(authority, env, {
    cutoverRunId: "cutover_run_retirement",
    now: "2026-08-30T00:31:00.000Z",
  })
  assert.equal(backup.status, "verified")
  assert.match(backup.root_sha256, /^[a-f0-9]{64}$/)

  await assert.rejects(
    beginLegacyManifestationPlaintextRetirement(authority, primary, env, {
      cutoverRunId: "cutover_run_retirement",
      sourceSnapshotSha256: sha("a"),
      backupArtifactId: "backup_artifact_retirement",
    }),
    (error) => error?.code === "PLAINTEXT_RETIREMENT_PROJECTION_NOT_VERIFIED",
  )
  primary.raw
    .prepare(
      `UPDATE icono_manifestation_projection_authority
          SET authority_epoch = 2, mode = 'shadow_frozen',
              source_snapshot_sha256 = ?, expected_gene_count = 2
        WHERE singleton = 1`,
    )
    .run(sha("a"))
  primary.raw
    .prepare(
      `UPDATE icono_manifestation_projection_authority
          SET mode = 'authoritative' WHERE singleton = 1`,
    )
    .run()
  const started = await beginLegacyManifestationPlaintextRetirement(authority, primary, env, {
    cutoverRunId: "cutover_run_retirement",
    sourceSnapshotSha256: sha("a"),
    backupArtifactId: "backup_artifact_retirement",
    now: "2026-08-30T01:00:00.000Z",
  })
  assert.equal(started.status, "running")
  await assert.rejects(
    beginLegacyManifestationPlaintextRetirement(authority, primary, env, {
      cutoverRunId: "cutover_run_retirement",
      sourceSnapshotSha256: sha("a"),
      backupArtifactId: "unknown_backup_artifact",
    }),
    (error) => error?.code === "CUTOVER_BACKUP_NOT_VERIFIED",
  )

  const firstPage = await retireNextLegacyManifestationPlaintextPage(primary, {
    limit: 1,
    now: "2026-08-30T01:01:00.000Z",
  })
  assert.equal(firstPage.status, "running")
  assert.equal(firstPage.retired_rows, 1)
  assert.equal(
    primary.raw
      .prepare("SELECT manifestation FROM icono_gene_essence WHERE gene_symbol = 'BRCA1'")
      .get().manifestation,
    null,
  )
  await retireNextLegacyManifestationPlaintextPage(primary, {
    limit: 1,
    now: "2026-08-30T01:02:00.000Z",
  })
  const completed = await retireNextLegacyManifestationPlaintextPage(primary, {
    limit: 1,
    now: "2026-08-30T01:03:00.000Z",
  })
  assert.equal(completed.status, "verified")
  assert.equal(completed.retired_rows, 2)
  assert.ok(Number(completed.retired_bytes) > 0)
  assert.equal(
    primary.raw
      .prepare(
        `SELECT COUNT(*) AS count FROM icono_gene_essence
          WHERE manifestation IS NOT NULL OR manifestation_tags IS NOT NULL
             OR manifestation_fields_json IS NOT NULL`,
      )
      .get().count,
    0,
  )
  assert.equal(
    primary.raw
      .prepare(
        "SELECT plaintext_retired_at FROM icono_manifestation_projection_authority WHERE singleton = 1",
      )
      .get().plaintext_retired_at,
    "2026-08-30T01:03:00.000Z",
  )
})

test("bounded operator resumes through encrypted materialization, shadow projection, activation, and backup-gated retirement", async (t) => {
  const authority = new TestD1(
    `${AUTHORING_BASE}\n${AUTHORING_BOUNDARY}\n${AUTHORING_CUTOVER}\n${AUTHORING_RESUMABLE_UPLOADS}`,
  )
  const primary = new TestD1(`CREATE TABLE icono_gene_essence (
    gene_symbol TEXT PRIMARY KEY,
    manifestation TEXT,
    manifestation_tags TEXT,
    manifestation_fields_json TEXT,
    sample_label TEXT,
    sample_number INTEGER,
    sample_text_hash TEXT,
    updated_at TEXT
  );\n${PRIMARY_CUTOVER}`)
  t.after(() => {
    authority.close()
    primary.close()
  })
  const objects = installCutoverStorage(t, { missOnSecondRead: true })
  const env = cutoverEnv()
  const now = new Date(Date.now() + 60_000).toISOString()
  authority.raw
    .prepare(
      `INSERT INTO icono_authority_accounts
       (account_id, public_credit_label, status)
     VALUES ('account_cutover_operator', 'Cutover operator', 'active')`,
    )
    .run()
  const insert = primary.raw.prepare(
    `INSERT INTO icono_gene_essence (
       gene_symbol, manifestation, manifestation_tags, manifestation_fields_json,
       sample_label, sample_number, sample_text_hash, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  insert.run("BRCA1", null, null, null, "B-1", 1, sha("1"), "2026-08-30")
  insert.run(
    "TP53",
    "measured guardian",
    "guardian, measured",
    '{"zeta":["legacy"],"alpha":true}',
    "B-2",
    2,
    sha("2"),
    "2026-08-30",
  )
  const base = {
    primaryDb: primary,
    authoringDb: authority,
    env: { ...env, ICONOPLASM_CUTOVER_EXECUTION_PLANE: "durable_object" },
    projectShadowEvent: projectCanonicalManifestationCutoverEvent,
    actor: { actorKind: "administrator", actorAccountId: "account_cutover_operator" },
  }
  let status = await advanceManifestationAuthorityCutover({
    ...base,
    input: {
      action: "create",
      cutoverRunId: "cutover_run_operator",
      sourceSnapshotId: "source_snapshot_operator",
      targetAuthorityEpoch: 2,
      now,
    },
  })
  assert.equal(status.status, "planning")
  for (let page = 0; page < 3; page += 1) {
    status = await advanceManifestationAuthorityCutover({
      ...base,
      input: { action: "plan", cutoverRunId: "cutover_run_operator", limit: 1, now },
    })
  }
  assert.equal(status.status, "ready")
  assert.equal(status.source_gene_count, 2)
  assert.equal(status.source_manifestation_count, 1)
  status = await advanceManifestationAuthorityCutover({
    ...base,
    input: { action: "freeze", cutoverRunId: "cutover_run_operator", now },
  })
  assert.equal(status.status, "importing")
  assert.equal(status.authority.epoch, 2)
  assert.equal(status.primary.mode, "shadow_frozen")

  const brcaShard =
    Number.parseInt(
      authority.raw
        .prepare(
          "SELECT gene_id FROM icono_manifestation_cutover_items WHERE canonical_symbol = 'BRCA1'",
        )
        .get()
        .gene_id.slice(-2),
      16,
    ) % 32
  status = await advanceManifestationAuthorityCutover({
    ...base,
    input: {
      action: "materialize",
      cutoverRunId: "cutover_run_operator",
      limit: 1,
      shardCount: 32,
      shardIndex: (brcaShard + 1) % 32,
      now,
    },
  })
  assert.equal(status.counts.verified, 0)
  const brcaPhases = []
  for (let phase = 0; phase < 12 && status.counts.verified === 0; phase += 1) {
    const phaseNow = new Date(Date.parse(now) + phase * 6_000).toISOString()
    status = await advanceManifestationAuthorityCutover({
      ...base,
      input: {
        action: "materialize",
        cutoverRunId: "cutover_run_operator",
        limit: 1,
        shardCount: 32,
        shardIndex: brcaShard,
        now: phaseNow,
      },
    })
    brcaPhases.push(
      authority.raw
        .prepare(
          "SELECT status FROM icono_manifestation_cutover_items WHERE canonical_symbol = 'BRCA1'",
        )
        .get().status,
    )
  }
  assert.equal(
    status.counts.verified,
    1,
    JSON.stringify({
      status,
      items: authority.raw
        .prepare(
          "SELECT canonical_symbol, status, failure_code, failure_message FROM icono_manifestation_cutover_items ORDER BY canonical_symbol",
        )
        .all(),
    }),
  )
  assert.deepEqual(brcaPhases, ["verified"])
  assert.equal(status.status, "importing")
  for (let phase = 0; phase < 20 && status.status !== "seeded"; phase += 1) {
    const phaseNow = new Date(Date.parse(now) + (phase + 20) * 6_000).toISOString()
    status = await advanceManifestationAuthorityCutover({
      ...base,
      input: {
        action: "materialize",
        cutoverRunId: "cutover_run_operator",
        limit: 1,
        now: phaseNow,
      },
    })
  }
  assert.equal(
    status.status,
    "seeded",
    JSON.stringify({
      status,
      items: authority.raw
        .prepare(
          "SELECT canonical_symbol, status, failure_code, failure_message FROM icono_manifestation_cutover_items ORDER BY canonical_symbol",
        )
        .all(),
    }),
  )
  assert.equal(status.counts.verified, 2)
  assert.ok(objects.size >= 2)
  const derivative = authority.raw
    .prepare(
      `SELECT tags_sha256, tags_bytes, fields_sha256, fields_bytes,
            body_sha256, body_bytes, provenance_status
       FROM icono_manifestation_derivatives`,
    )
    .get()
  assert.match(derivative.tags_sha256, /^[a-f0-9]{64}$/)
  assert.match(derivative.fields_sha256, /^[a-f0-9]{64}$/)
  assert.equal(derivative.body_bytes, derivative.tags_bytes + 1 + derivative.fields_bytes)
  assert.equal(derivative.provenance_status, "legacy_unknown")

  status = await advanceManifestationAuthorityCutover({
    ...base,
    input: { action: "verify", cutoverRunId: "cutover_run_operator", now },
  })
  assert.equal(status.status, "shadow_verified")
  status = await advanceManifestationAuthorityCutover({
    ...base,
    input: {
      action: "activate",
      cutoverRunId: "cutover_run_operator",
      confirm: "activate_verified_authority",
      now,
    },
  })
  assert.equal(status.status, "authoritative")
  assert.equal(status.authority.mode, "authoritative")
  assert.equal(status.primary.mode, "authoritative")

  authority.raw
    .prepare(
      `INSERT INTO icono_caretaker_terms_versions (
       terms_version_id, terms_sha256, document_url, display_label, effective_at,
       created_by_actor_kind, created_by_account_id, created_at
     ) VALUES (
       'terms_cutover_later', ?, 'https://iconoplasm.test/terms', 'Later terms', ?,
       'administrator', 'account_cutover_operator', ?
     )`,
    )
    .run(sha("e"), now, now)
  authority.raw
    .prepare(
      `INSERT INTO icono_caretaker_assignments (
       caretaker_assignment_id, gene_id, account_id, status, assignment_version,
       terms_version_id, terms_accepted_at, entitlement_policy_version,
       relinquish_policy, invited_by_account_id, started_at, created_at, updated_at
     ) SELECT
       'assignment_post_cutover', gene_id, 'account_cutover_operator', 'active', 2,
       'terms_cutover_later', ?, 'post-cutover-v1', 'retain',
       'account_cutover_operator', ?, ?, ?
     FROM icono_gene_identities WHERE canonical_symbol = 'TP53'`,
    )
    .run(now, now, now, now)
  authority.raw
    .prepare(
      `INSERT INTO icono_manifestations (
       manifestation_id, gene_id, author_account_id, caretaker_assignment_id,
       origin, status, row_version, non_withdrawable, created_at, updated_at
     ) SELECT
       'manifestation_post_cutover', gene_id, 'account_cutover_operator',
       'assignment_post_cutover', 'caretaker', 'active', 1, 0, ?, ?
     FROM icono_gene_identities WHERE canonical_symbol = 'TP53'`,
    )
    .run(now, now)
  authority.raw
    .prepare(
      `INSERT INTO icono_manifestation_revisions (
       manifestation_revision_id, manifestation_id, revision_number,
       body_sha256, body_bytes, author_account_id, caretaker_assignment_id, created_at
     ) VALUES (
       'revision_post_cutover', 'manifestation_post_cutover', 1,
       ?, 12, 'account_cutover_operator', 'assignment_post_cutover', ?
     )`,
    )
    .run(sha("f"), now)
  authority.raw
    .prepare(
      `INSERT INTO icono_manifestation_revision_lifecycle (
       manifestation_revision_id, status, lifecycle_version, changed_at
     ) VALUES ('revision_post_cutover', 'active', 1, ?)`,
    )
    .run(now)
  authority.raw
    .prepare(
      `INSERT INTO icono_manifestation_revision_storage_secrets (
       manifestation_revision_id, object_key, ciphertext_sha256, ciphertext_bytes,
       body_iv_base64, wrapped_dek_base64, wrap_iv_base64, key_version,
       aad_version, object_etag, verified_at, created_at
     ) VALUES (
       'revision_post_cutover',
       'private/manifestations/v1/ff/opaque_post_cutover_locator_00000000000000000001.bin',
       ?, 28, 'AAAAAAAAAAAAAAAA', 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
       'CCCCCCCCCCCCCCCC', 1, 1, 'post-cutover-etag', ?, ?
     )`,
    )
    .run(sha("0"), now, now)
  authority.raw
    .prepare(
      `UPDATE icono_manifestations SET manifestation_head_revision_id = 'revision_post_cutover'
      WHERE manifestation_id = 'manifestation_post_cutover'`,
    )
    .run()
  status = await advanceManifestationAuthorityCutover({
    ...base,
    input: {
      action: "begin_backup",
      cutoverRunId: "cutover_run_operator",
      backupArtifactId: "backup_artifact_operator",
      now,
    },
  })
  assert.equal(status.backup.status, "building")
  status = await advanceManifestationAuthorityCutover({
    ...base,
    input: { action: "backup", cutoverRunId: "cutover_run_operator", limit: 5, now },
  })
  assert.equal(status.backup.status, "verified")
  assert.equal(status.backup.expected_entries, 2)
  assert.equal(status.backup.verified_entries, 2)
  assert.match(status.backup.root_sha256, /^[a-f0-9]{64}$/)
  assert.equal(
    authority.raw
      .prepare(
        `SELECT count(*) AS total FROM icono_manifestation_cutover_backup_entries
        WHERE entity_id = 'revision_post_cutover'`,
      )
      .get().total,
    0,
  )
  await assert.rejects(
    advanceManifestationAuthorityCutover({
      ...base,
      input: { action: "begin_retirement", cutoverRunId: "cutover_run_operator", now },
    }),
    (error) => error?.code === "CUTOVER_CONFIRMATION_REQUIRED",
  )
  status = await advanceManifestationAuthorityCutover({
    ...base,
    input: {
      action: "begin_retirement",
      cutoverRunId: "cutover_run_operator",
      confirm: "retire_verified_legacy_plaintext",
      backupArtifactId: "backup_artifact_operator",
      now,
    },
  })
  assert.equal(status.retirement.status, "running")
  for (let page = 0; page < 3 && status.retirement.status !== "verified"; page += 1) {
    status = await advanceManifestationAuthorityCutover({
      ...base,
      input: { action: "retire_plaintext", cutoverRunId: "cutover_run_operator", limit: 1, now },
    })
  }
  assert.equal(status.retirement.status, "verified")
  const retentionExpiresAt = new Date(new Date(now).getTime() + 30 * 86_400_000).toISOString()
  assert.equal(status.backup.retention_expires_at, retentionExpiresAt)
  assert.equal(
    primary.raw
      .prepare(
        `SELECT count(*) AS total FROM icono_gene_essence
        WHERE manifestation IS NOT NULL OR manifestation_tags IS NOT NULL
           OR manifestation_fields_json IS NOT NULL`,
      )
      .get().total,
    0,
  )

  const beforeExpiry = new Date(new Date(retentionExpiresAt).getTime() - 1).toISOString()
  status = await advanceManifestationAuthorityCutover({
    ...base,
    input: {
      action: "sweep_backup_retention",
      cutoverRunId: "cutover_run_operator",
      limit: 12,
      now: beforeExpiry,
    },
  })
  assert.equal(status.backup.deletion_status, "retention_pending")

  const heldManifestation = authority.raw
    .prepare(
      "SELECT seed_manifestation_id FROM icono_manifestation_cutover_items WHERE canonical_symbol = 'TP53'",
    )
    .get().seed_manifestation_id
  authority.raw
    .prepare(
      `INSERT INTO icono_manifestation_legal_holds (
       legal_hold_id, manifestation_id, reason, placed_by_account_id, placed_at
     ) VALUES ('hold_cutover_backup', ?, 'Preservation order', 'account_cutover_operator', ?)`,
    )
    .run(heldManifestation, retentionExpiresAt)
  status = await advanceManifestationAuthorityCutover({
    ...base,
    input: {
      action: "sweep_backup_retention",
      cutoverRunId: "cutover_run_operator",
      limit: 12,
      now: retentionExpiresAt,
    },
  })
  assert.equal(status.backup.deletion_status, "held")

  authority.raw
    .prepare(
      `UPDATE icono_manifestation_legal_holds
        SET released_by_account_id = 'account_cutover_operator', released_at = ?
      WHERE legal_hold_id = 'hold_cutover_backup'`,
    )
    .run(new Date(new Date(retentionExpiresAt).getTime() + 1_000).toISOString())
  const storageFetch = globalThis.fetch
  let deleteFailuresRemaining = 4
  globalThis.fetch = async (url, init = {}) => {
    if (
      String(init.method || "GET").toUpperCase() === "DELETE" &&
      String(url).includes("cutover-backup-test-zone") &&
      deleteFailuresRemaining > 0
    ) {
      deleteFailuresRemaining -= 1
      return new Response(null, { status: 503 })
    }
    return storageFetch(url, init)
  }
  const firstDeleteAt = new Date(new Date(retentionExpiresAt).getTime() + 2_000).toISOString()
  status = await advanceManifestationAuthorityCutover({
    ...base,
    input: {
      action: "sweep_backup_retention",
      cutoverRunId: "cutover_run_operator",
      limit: 12,
      now: firstDeleteAt,
    },
  })
  assert.equal(status.backup.deletion_status, "delete_failed")
  const retryAt = new Date(new Date(retentionExpiresAt).getTime() + 5 * 60_000).toISOString()
  for (let page = 0; page < 5 && status.backup.deletion_status !== "deleted"; page += 1) {
    status = await advanceManifestationAuthorityCutover({
      ...base,
      input: {
        action: "sweep_backup_retention",
        cutoverRunId: "cutover_run_operator",
        limit: 12,
        now: retryAt,
      },
    })
  }
  assert.equal(
    status.backup.deletion_status,
    "deleted",
    JSON.stringify({
      backup: status.backup,
      deletions: authority.raw
        .prepare(
          `SELECT object_kind, object_identity, status, attempts, next_attempt_at, last_error_code
           FROM icono_manifestation_cutover_backup_deletions
          ORDER BY object_kind, object_identity`,
        )
        .all(),
    }),
  )
  assert.equal(status.backup.deleted_object_count, 4)
  assert.match(status.backup.deletion_receipt_sha256, /^[a-f0-9]{64}$/)
  assert.equal(
    authority.raw
      .prepare("SELECT count(*) AS total FROM icono_manifestation_cutover_backup_entries")
      .get().total,
    0,
  )
  assert.equal(
    [...objects.keys()].some((key) => key.includes("cutover-backup-test-zone")),
    false,
  )

  status = await advanceManifestationAuthorityCutover({
    ...base,
    input: {
      action: "sweep_backup_retention",
      cutoverRunId: "cutover_run_operator",
      limit: 12,
      now: retryAt,
    },
  })
  assert.equal(status.backup.deletion_status, "deleted")
  const auditAt = new Date(new Date(retryAt).getTime() + 8 * 86_400_000).toISOString()
  await advanceManifestationAuthorityCutover({
    ...base,
    input: {
      action: "sweep_backup_audit",
      cutoverRunId: "cutover_run_operator",
      limit: 100,
      now: auditAt,
    },
  })
  assert.equal(
    authority.raw
      .prepare("SELECT count(*) AS total FROM icono_manifestation_cutover_backup_deletions")
      .get().total,
    0,
  )
})
