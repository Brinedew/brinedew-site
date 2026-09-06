import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import {
  drainManifestationAuthorityProjectionOutbox,
  ManifestationProjectionError,
  projectCanonicalManifestationAuthorityEvent,
  projectCanonicalManifestationCutoverEvent,
} from "./lib/iconoplasm-manifestation-authority-projection.js"

const PRIMARY_CUTOVER = [
  "../migrations-iconoplasm/0084_manifestation_authority_cutover.sql",
  "../migrations-iconoplasm/0089_manifestation_page_visibility.sql",
]
  .map((path) => readFileSync(new URL(path, import.meta.url), "utf8"))
  .join("\n")

class Statement {
  constructor(database, sql, bindings = []) {
    this.database = database
    this.sql = sql
    this.bindings = bindings
  }

  bind(...bindings) {
    return new Statement(this.database, this.sql, bindings)
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.bindings) || null
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.bindings)
    return { success: true, meta: { changes: Number(result.changes || 0) } }
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.bindings) }
  }
}

function primaryDatabase(
  mode = "authoritative",
  { sourceSnapshotSha256 = null, expectedGeneCount = null } = {},
) {
  const database = new DatabaseSync(":memory:")
  database.exec(`
    CREATE TABLE icono_gene_essence (
      gene_symbol TEXT PRIMARY KEY,
      manifestation TEXT,
      manifestation_tags TEXT,
      manifestation_fields_json TEXT
    );
  `)
  database.exec(PRIMARY_CUTOVER)
  database
    .prepare(
      `UPDATE icono_manifestation_projection_authority
          SET mode = ?, authority_epoch = 2,
              source_snapshot_sha256 = ?, expected_gene_count = ?
        WHERE singleton = 1`,
    )
    .run(mode, sourceSnapshotSha256, expectedGeneCount)
  return {
    database,
    prepare(sql) {
      return new Statement(database, sql)
    },
    async batch(statements) {
      database.exec("BEGIN IMMEDIATE")
      try {
        const results = []
        for (const statement of statements) results.push(await statement.run())
        database.exec("COMMIT")
        return results
      } catch (error) {
        database.exec("ROLLBACK")
        throw error
      }
    },
  }
}

function cutoverAuthoringDatabase({
  commandId = "command_seed_tags_select",
  runStatus = "importing",
} = {}) {
  const database = new DatabaseSync(":memory:")
  database.exec(`
    CREATE TABLE icono_manifestation_cutover_runs (
      cutover_run_id TEXT PRIMARY KEY,
      source_snapshot_sha256 TEXT,
      source_gene_count INTEGER,
      target_authority_epoch INTEGER,
      status TEXT
    );
    CREATE TABLE icono_manifestation_cutover_items (
      cutover_run_id TEXT,
      canonical_symbol TEXT,
      gene_id TEXT,
      source_kind TEXT,
      seed_manifestation_id TEXT,
      seed_revision_id TEXT,
      seed_selection_id TEXT,
      seed_command_id TEXT,
      seed_tags_derivative_id TEXT,
      seed_tags_command_id TEXT,
      seed_tags_selection_command_id TEXT,
      source_body_sha256 TEXT,
      source_body_bytes INTEGER,
      source_tags_sha256 TEXT,
      source_tags_bytes INTEGER,
      source_fields_sha256 TEXT,
      source_fields_bytes INTEGER,
      status TEXT
    );
    CREATE TABLE icono_manifestation_events (
      event_uuid TEXT,
      event_sequence INTEGER,
      command_id TEXT,
      gene_id TEXT
    );
    CREATE TABLE icono_manifestation_heads (
      gene_id TEXT PRIMARY KEY,
      last_event_sequence INTEGER
    );
  `)
  database
    .prepare(
      `INSERT INTO icono_manifestation_cutover_runs
         VALUES ('cutover_1', ?, 1, 2, ?)`,
    )
    .run(sha("f"), runStatus)
  database
    .prepare(
      `INSERT INTO icono_manifestation_cutover_items VALUES (
         'cutover_1', 'TP53', 'gene_tp53_stable', 'manifestation',
         'manifestation_seed', 'revision_seed', 'selection_seed',
         'command_seed', 'derivative_seed', 'command_seed_tags',
         'command_seed_tags_select', ?, 412, ?, 80, ?, 107, 'adopted'
       )`,
    )
    .run(sha("a"), sha("d"), sha("e"))
  database
    .prepare(
      `INSERT INTO icono_manifestation_events
         VALUES ('event_3', 3, ?, 'gene_tp53_stable')`,
    )
    .run(commandId)
  database.prepare("INSERT INTO icono_manifestation_heads VALUES ('gene_tp53_stable', 3)").run()
  return {
    database,
    prepare(sql) {
      return new Statement(database, sql)
    },
  }
}

function projectionOutboxDatabase() {
  const database = new DatabaseSync(":memory:")
  database.exec(`
    CREATE TABLE icono_manifestation_events (
      event_uuid TEXT PRIMARY KEY,
      event_sequence INTEGER NOT NULL UNIQUE,
      gene_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      projection_status TEXT NOT NULL DEFAULT 'pending',
      projection_attempts INTEGER NOT NULL DEFAULT 0,
      projection_next_attempt_at TEXT,
      gene_revision INTEGER GENERATED ALWAYS AS (event_sequence) STORED,
      UNIQUE(gene_id, gene_revision)
    );
    CREATE INDEX idx_icono_events_projection_due ON icono_manifestation_events
      (projection_status, projection_next_attempt_at, event_sequence);
  `)
  return {
    database,
    prepare(sql) {
      return new Statement(database, sql)
    },
  }
}

function sha(character) {
  return String(character).repeat(64)
}

function callback(
  sequence,
  revisionId = null,
  { headVersion = sequence, geneRevision = sequence } = {},
) {
  return {
    event_id: `event_${sequence}`,
    event_sequence: sequence,
    gene_id: "gene_tp53_stable",
    payload: {
      gene: { gene_id: "gene_tp53_stable" },
      canonical: {
        manifestation_revision_id: revisionId,
        head_version: headVersion,
        gene_revision: geneRevision,
      },
    },
  }
}

function exactRecord(
  sequence,
  canonical = null,
  acceptedTagsDerivative = null,
  { headVersion = sequence, geneRevision = sequence } = {},
) {
  return {
    schema_version: 1,
    gene_id: "gene_tp53_stable",
    canonical_symbol: "TP53",
    gene_status: "active",
    head_version: headVersion,
    gene_revision: geneRevision,
    last_event_id: `event_${sequence}`,
    last_event_sequence: sequence,
    canonical,
    accepted_tags_derivative: acceptedTagsDerivative,
  }
}

test("scheduled recovery drains bounded indexed windows without rewinding or ignoring retry delays", async (t) => {
  const primary = primaryDatabase()
  const authoring = projectionOutboxDatabase()
  t.after(() => {
    primary.database.close()
    authoring.database.close()
  })
  const insert = authoring.database.prepare(`INSERT INTO icono_manifestation_events
    (event_uuid,event_sequence,gene_id,payload_json,projection_status,projection_next_attempt_at)
    VALUES(?,?,?,?,?,?)`)
  for (let sequence = 1; sequence <= 5800; sequence++) {
    const event = callback(sequence)
    insert.run(
      event.event_id,
      sequence,
      event.gene_id,
      JSON.stringify(event.payload),
      sequence <= 5000 ? "published" : sequence <= 5600 ? "pending" : "failed",
      sequence > 5750
        ? "2099-01-01T00:00:00.000Z"
        : sequence > 5700
          ? "2026-01-01T00:00:00.000Z"
          : null,
    )
  }
  const ranges = []
  const prepare = authoring.prepare.bind(authoring)
  authoring.prepare = (sql) => {
    if (!sql.includes("INDEXED BY idx_icono_events_projection_due")) return prepare(sql)
    return {
      bind(...parameters) {
        return {
          async all() {
            const plan = authoring.database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...parameters)
            assert.ok(
              plan.every(({ detail }) => !/SCAN |TEMP B-TREE/.test(detail)),
              JSON.stringify(plan),
            )
            assert.ok(plan.some(({ detail }) => detail.includes("idx_icono_events_projection_due")))
            const result = await prepare(sql)
              .bind(...parameters)
              .all()
            ranges.push(result.results.length)
            assert.ok(result.results.length <= 50)
            return result
          },
        }
      },
    }
  }
  let finished = false
  for (let pass = 0; pass < 25; pass++) {
    const result = await drainManifestationAuthorityProjectionOutbox(
      {
        primaryDb: primary,
        authoringDb: authoring,
        limit: 50,
        now: new Date("2026-09-01T00:00:00.000Z"),
        projectPublicMaterialEvent: async () => {},
      },
      { readCanonical: async () => exactRecord(5800) },
    )
    assert.equal(result.ok, true)
    assert.ok(result.attempted <= 1, "coalesce the selected window for this one gene")
    if (result.attempted) assert.equal(result.results[0].canonical_projection_sequence, 5800)
    if (!result.has_more) {
      finished = true
      break
    }
  }
  assert.equal(finished, true)
  assert.ok(ranges.length >= 8)
  assert.equal(
    authoring.database
      .prepare(
        "SELECT COUNT(*) AS n FROM icono_manifestation_events WHERE event_sequence <= 5750 AND projection_status <> 'published'",
      )
      .get().n,
    0,
  )
  assert.equal(
    authoring.database
      .prepare(
        "SELECT COUNT(*) AS n FROM icono_manifestation_events WHERE event_sequence > 5750 AND projection_status='failed' AND projection_attempts=0",
      )
      .get().n,
    50,
  )
})

test("the primary projection preserves null -> canonical -> null history without rewinding", async (t) => {
  const primary = primaryDatabase()
  t.after(() => primary.database.close())
  const authoring = { prepare() {} }
  let exact = exactRecord(1)
  const readCanonical = async () => exact

  const empty = await projectCanonicalManifestationAuthorityEvent(
    { primaryDb: primary, authoringDb: authoring, event: callback(1) },
    { readCanonical },
  )
  assert.equal(empty.canonical_revision_id, null)
  assert.equal(empty.projection_version, 1)

  exact = exactRecord(
    2,
    {
      manifestation_id: "manifestation_tp53_caretaker",
      manifestation_revision_id: "revision_tp53_2",
      canonical_selection_id: "selection_tp53_2",
      body_sha256: sha("a"),
      body_bytes: 412,
      lifecycle: "active",
    },
    {
      manifestation_derivative_id: "derivative_tp53_tags_2",
      derivative_head_version: 1,
      status: "complete",
      source_body_sha256: sha("a"),
      body_sha256: sha("b"),
      body_bytes: 188,
      tags_sha256: sha("d"),
      tags_bytes: 80,
      fields_sha256: sha("e"),
      fields_bytes: 107,
      recipe_id: "taggerizer",
      recipe_version: "2",
      provider_id: "opencode",
      model_id: "deepseek-v4-flash-free",
      tagger_config_sha256: sha("c"),
      provenance_status: "generated",
    },
  )
  const selected = await projectCanonicalManifestationAuthorityEvent(
    {
      primaryDb: primary,
      authoringDb: authoring,
      event: callback(2, "revision_tp53_2"),
    },
    { readCanonical },
  )
  assert.equal(selected.canonical_revision_id, "revision_tp53_2")
  assert.equal(selected.projection_version, 2)
  assert.equal(selected.public_material_changed, true)

  const replay = await projectCanonicalManifestationAuthorityEvent(
    {
      primaryDb: primary,
      authoringDb: authoring,
      event: callback(2, "revision_tp53_2"),
    },
    { readCanonical },
  )
  assert.equal(replay.projection_version, 2)

  exact = exactRecord(
    3,
    {
      manifestation_id: "manifestation_tp53_caretaker",
      manifestation_revision_id: "revision_tp53_2",
      canonical_selection_id: "selection_tp53_2",
      body_sha256: sha("a"),
      body_bytes: 412,
      lifecycle: "active",
    },
    {
      manifestation_derivative_id: "derivative_tp53_tags_2",
      derivative_head_version: 1,
      status: "complete",
      source_body_sha256: sha("a"),
      body_sha256: sha("b"),
      body_bytes: 188,
      tags_sha256: sha("d"),
      tags_bytes: 80,
      fields_sha256: sha("e"),
      fields_bytes: 107,
      recipe_id: "taggerizer",
      recipe_version: "2",
      provider_id: "opencode",
      model_id: "deepseek-v4-flash-free",
      tagger_config_sha256: sha("c"),
      provenance_status: "generated",
    },
    { headVersion: 2, geneRevision: 3 },
  )
  const privateOnlySave = await projectCanonicalManifestationAuthorityEvent(
    {
      primaryDb: primary,
      authoringDb: authoring,
      event: callback(3, "revision_tp53_2", { headVersion: 2, geneRevision: 3 }),
    },
    { readCanonical },
  )
  assert.equal(privateOnlySave.public_material_changed, false)
  assert.equal(privateOnlySave.projection_version, 3)
  assert.deepEqual(
    primary.database
      .prepare(
        `SELECT authority_event_id FROM icono_manifestation_publication_wakes
          ORDER BY authority_event_sequence`,
      )
      .all()
      .map((row) => row.authority_event_id),
    ["event_1", "event_2"],
  )

  exact = exactRecord(4, null, null, { headVersion: 3, geneRevision: 4 })
  const cleared = await projectCanonicalManifestationAuthorityEvent(
    {
      primaryDb: primary,
      authoringDb: authoring,
      event: callback(4, null, { headVersion: 3, geneRevision: 4 }),
    },
    { readCanonical },
  )
  assert.equal(cleared.canonical_revision_id, null)
  assert.equal(cleared.public_material_changed, true)
  assert.equal(cleared.projection_version, 4)

  const row = primary.database
    .prepare(
      `SELECT canonical_revision_id, accepted_tags_derivative_id,
              authority_event_id, authority_event_sequence,
              head_version, gene_revision, projection_version
         FROM icono_manifestation_canonical_projection
        WHERE gene_id = 'gene_tp53_stable'`,
    )
    .get()
  assert.deepEqual(
    { ...row },
    {
      canonical_revision_id: null,
      accepted_tags_derivative_id: null,
      authority_event_id: "event_4",
      authority_event_sequence: 4,
      head_version: 3,
      gene_revision: 4,
      projection_version: 4,
    },
  )

  const staleWake = await projectCanonicalManifestationAuthorityEvent(
    {
      primaryDb: primary,
      authoringDb: authoring,
      event: callback(2, "revision_tp53_2"),
    },
    { readCanonical },
  )
  assert.equal(staleWake.stale_callback, true)
  assert.equal(staleWake.authority_event_sequence, 4)
  assert.equal(staleWake.projection_version, 4)
  assert.deepEqual(
    primary.database
      .prepare(
        `SELECT authority_event_id FROM icono_manifestation_publication_wakes
          ORDER BY authority_event_sequence`,
      )
      .all()
      .map((row) => row.authority_event_id),
    ["event_1", "event_2", "event_4"],
  )
})

test("private saves advance projection progress without a public wake; explicit selection wakes once", async (t) => {
  const primary = primaryDatabase()
  const authoring = projectionOutboxDatabase()
  t.after(() => primary.database.close())
  t.after(() => authoring.database.close())

  const canonical2 = {
    manifestation_id: "manifestation_tp53_caretaker",
    manifestation_revision_id: "revision_tp53_2",
    canonical_selection_id: "selection_tp53_2",
    body_sha256: sha("a"),
    body_bytes: 412,
    lifecycle: "active",
  }
  let exact = exactRecord(2, canonical2)
  await projectCanonicalManifestationAuthorityEvent(
    { primaryDb: primary, authoringDb: authoring, event: callback(2, "revision_tp53_2") },
    { readCanonical: async () => exact },
  )

  exact = exactRecord(3, canonical2, null, { headVersion: 2, geneRevision: 3 })
  const privateSave = callback(3, "revision_tp53_2", { headVersion: 2, geneRevision: 3 })
  authoring.database
    .prepare(
      `INSERT INTO icono_manifestation_events (
         event_uuid, event_sequence, gene_id, payload_json
       ) VALUES (?, ?, ?, ?)`,
    )
    .run(
      privateSave.event_id,
      privateSave.event_sequence,
      privateSave.gene_id,
      JSON.stringify(privateSave.payload),
    )

  const publicEvents = []
  const privateDrain = await drainManifestationAuthorityProjectionOutbox(
    {
      primaryDb: primary,
      authoringDb: authoring,
      projectPublicMaterialEvent: async (event) => publicEvents.push(event),
    },
    { readCanonical: async () => exact },
  )
  assert.equal(privateDrain.ok, true)
  assert.equal(privateDrain.results[0].public_material_projected, false)
  assert.deepEqual(publicEvents, [])

  const canonical4 = {
    ...canonical2,
    manifestation_revision_id: "revision_tp53_4",
    canonical_selection_id: "selection_tp53_4",
    body_sha256: sha("f"),
  }
  exact = exactRecord(4, canonical4, null, { headVersion: 3, geneRevision: 4 })
  const selected = callback(4, "revision_tp53_4", { headVersion: 3, geneRevision: 4 })
  authoring.database
    .prepare(
      `INSERT INTO icono_manifestation_events (
         event_uuid, event_sequence, gene_id, payload_json
       ) VALUES (?, ?, ?, ?)`,
    )
    .run(
      selected.event_id,
      selected.event_sequence,
      selected.gene_id,
      JSON.stringify(selected.payload),
    )

  const selectionDrain = await drainManifestationAuthorityProjectionOutbox(
    {
      primaryDb: primary,
      authoringDb: authoring,
      projectPublicMaterialEvent: async (event) => publicEvents.push(event),
    },
    { readCanonical: async () => exact },
  )
  assert.equal(selectionDrain.ok, true)
  assert.equal(selectionDrain.results[0].public_material_projected, true)
  assert.deepEqual(publicEvents, [
    {
      event_id: "event_4",
      event_sequence: 4,
      gene_id: "gene_tp53_stable",
    },
  ])
  assert.deepEqual(
    primary.database
      .prepare(
        `SELECT authority_event_id FROM icono_manifestation_publication_wakes
          ORDER BY authority_event_sequence`,
      )
      .all()
      .map((row) => row.authority_event_id),
    ["event_2", "event_4"],
  )
})

test("projection mode and exact replay fences fail closed", async (t) => {
  const legacy = primaryDatabase("legacy_write")
  t.after(() => legacy.database.close())
  const authoring = { prepare() {} }
  const current = exactRecord(1)
  await assert.rejects(
    () =>
      projectCanonicalManifestationAuthorityEvent(
        { primaryDb: legacy, authoringDb: authoring, event: callback(1) },
        { readCanonical: async () => current },
      ),
    (error) =>
      error instanceof ManifestationProjectionError &&
      error.code === "MANIFESTATION_AUTHORITY_NOT_WRITABLE",
  )

  const primary = primaryDatabase()
  t.after(() => primary.database.close())
  await projectCanonicalManifestationAuthorityEvent(
    { primaryDb: primary, authoringDb: authoring, event: callback(1) },
    { readCanonical: async () => current },
  )
  await assert.rejects(
    () =>
      projectCanonicalManifestationAuthorityEvent(
        { primaryDb: primary, authoringDb: authoring, event: callback(1) },
        {
          readCanonical: async () => ({
            ...current,
            canonical_symbol: "BRCA1",
          }),
        },
      ),
    /manifestation_projection_event_replay_changed_payload/,
  )
  assert.throws(
    () =>
      primary.database
        .prepare(
          `UPDATE icono_manifestation_canonical_projection
              SET authority_event_sequence = 0,
                  head_version = 0,
                  gene_revision = 0
            WHERE gene_id = 'gene_tp53_stable'`,
        )
        .run(),
    /manifestation_projection_cannot_rewind/,
  )
})

test("projection recovery prioritizes the accepted latest event and acknowledges superseded events", async (t) => {
  const primary = primaryDatabase()
  const authoring = projectionOutboxDatabase()
  t.after(() => {
    primary.database.close()
    authoring.database.close()
  })
  const older = callback(1)
  const latest = callback(2)
  const insert = authoring.database.prepare(
    `INSERT INTO icono_manifestation_events (
       event_uuid, event_sequence, gene_id, payload_json,
       projection_status, projection_attempts, projection_next_attempt_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  insert.run(
    older.event_id,
    older.event_sequence,
    older.gene_id,
    JSON.stringify(older.payload),
    "pending",
    0,
    null,
  )
  insert.run(
    latest.event_id,
    latest.event_sequence,
    latest.gene_id,
    JSON.stringify(latest.payload),
    "failed",
    3,
    "2099-01-01T00:00:00.000Z",
  )

  const drained = await drainManifestationAuthorityProjectionOutbox(
    {
      primaryDb: primary,
      authoringDb: authoring,
      limit: 1,
      priorityEventId: latest.event_id,
      projectPublicMaterialEvent: async () => {},
      now: new Date("2026-09-01T00:00:00.000Z"),
    },
    { readCanonical: async () => exactRecord(2) },
  )

  assert.equal(drained.ok, true)
  assert.deepEqual(
    drained.results.map((item) => [item.event_id, item.status]),
    [[latest.event_id, "published"]],
  )
  assert.deepEqual(
    authoring.database
      .prepare(
        `SELECT event_uuid, projection_status, projection_attempts, projection_next_attempt_at
           FROM icono_manifestation_events
          ORDER BY event_sequence`,
      )
      .all()
      .map((row) => ({ ...row })),
    [
      {
        event_uuid: older.event_id,
        projection_status: "published",
        projection_attempts: 0,
        projection_next_attempt_at: null,
      },
      {
        event_uuid: latest.event_id,
        projection_status: "published",
        projection_attempts: 4,
        projection_next_attempt_at: null,
      },
    ],
  )
})

test("one accepted projection ignores unrelated backlog and acknowledges at most 250 revisions", async (t) => {
  const primary = primaryDatabase()
  const authoring = projectionOutboxDatabase()
  t.after(() => {
    primary.database.close()
    authoring.database.close()
  })
  const insert = authoring.database.prepare(
    "INSERT INTO icono_manifestation_events(event_uuid,event_sequence,gene_id,payload_json) VALUES (?,?,?,?)",
  )
  authoring.database.exec("BEGIN")
  for (let sequence = 1; sequence <= 1000; sequence++) {
    const event = callback(sequence)
    insert.run(event.event_id, sequence, event.gene_id, JSON.stringify(event.payload))
  }
  for (let sequence = 1001; sequence <= 4000; sequence++) {
    insert.run(`other_${sequence}`, sequence, `other_gene_${sequence}`, "{}")
  }
  authoring.database.exec("COMMIT")
  const latest = callback(1000)
  const drained = await drainManifestationAuthorityProjectionOutbox(
    {
      primaryDb: primary,
      authoringDb: authoring,
      priorityEventId: latest.event_id,
      limit: 50,
      projectPublicMaterialEvent: async () => {},
    },
    { readCanonical: async () => exactRecord(1000) },
  )
  assert.deepEqual(
    drained.results.map((item) => item.event_id),
    [latest.event_id],
  )
  assert.equal(drained.ok, true)
  assert.equal(
    authoring.database
      .prepare(
        "SELECT COUNT(*) AS n FROM icono_manifestation_events WHERE projection_status='published'",
      )
      .get().n,
    250,
  )
  assert.equal(
    authoring.database
      .prepare(
        "SELECT COUNT(*) AS n FROM icono_manifestation_events WHERE projection_status='pending'",
      )
      .get().n,
    3750,
    "older and unrelated work must remain durable",
  )
})

test("shadow-frozen cutover projection accepts only its exact deterministic seed event and plan", async (t) => {
  const primary = primaryDatabase("shadow_frozen", {
    sourceSnapshotSha256: sha("f"),
    expectedGeneCount: 1,
  })
  const authoring = cutoverAuthoringDatabase()
  t.after(() => {
    authoring.database.close()
    primary.database.close()
  })
  const exact = exactRecord(
    3,
    {
      manifestation_id: "manifestation_seed",
      manifestation_revision_id: "revision_seed",
      canonical_selection_id: "selection_seed",
      body_sha256: sha("a"),
      body_bytes: 412,
      lifecycle: "active",
    },
    {
      manifestation_derivative_id: "derivative_seed",
      derivative_head_version: 1,
      status: "complete",
      source_body_sha256: sha("a"),
      body_sha256: sha("b"),
      body_bytes: 188,
      tags_sha256: sha("d"),
      tags_bytes: 80,
      fields_sha256: sha("e"),
      fields_bytes: 107,
      recipe_id: "taggerizer",
      recipe_version: "2",
      provider_id: "opencode",
      model_id: "deepseek-v4-flash-free",
      tagger_config_sha256: sha("c"),
      provenance_status: "generated",
    },
  )

  await assert.rejects(
    () =>
      projectCanonicalManifestationAuthorityEvent(
        { primaryDb: primary, authoringDb: authoring, event: callback(3, "revision_seed") },
        { readCanonical: async () => exact },
      ),
    (error) =>
      error instanceof ManifestationProjectionError &&
      error.code === "MANIFESTATION_AUTHORITY_NOT_WRITABLE",
  )

  const projected = await projectCanonicalManifestationCutoverEvent(
    {
      primaryDb: primary,
      authoringDb: authoring,
      cutoverRunId: "cutover_1",
      event: callback(3, "revision_seed"),
    },
    { readCanonical: async () => exact },
  )
  assert.equal(projected.cutover_run_id, "cutover_1")
  assert.equal(projected.authority_event_sequence, 3)
  assert.deepEqual(
    {
      body: {
        ...primary.database
          .prepare(
            `SELECT accepted_tags_body_sha256, accepted_tags_body_bytes,
                    accepted_tags_text_sha256, accepted_tags_text_bytes,
                    accepted_tags_fields_sha256, accepted_tags_fields_bytes
               FROM icono_manifestation_canonical_projection`,
          )
          .get(),
      },
    },
    {
      body: {
        accepted_tags_body_sha256: sha("b"),
        accepted_tags_body_bytes: 188,
        accepted_tags_text_sha256: sha("d"),
        accepted_tags_text_bytes: 80,
        accepted_tags_fields_sha256: sha("e"),
        accepted_tags_fields_bytes: 107,
      },
    },
  )
})

test("shadow-frozen cutover projection rejects unrelated commands and snapshot identity drift", async (t) => {
  const exact = exactRecord(3, {
    manifestation_id: "manifestation_seed",
    manifestation_revision_id: "revision_seed",
    canonical_selection_id: "selection_seed",
    body_sha256: sha("a"),
    body_bytes: 412,
    lifecycle: "active",
  })
  const wrongCommandPrimary = primaryDatabase("shadow_frozen", {
    sourceSnapshotSha256: sha("f"),
    expectedGeneCount: 1,
  })
  const wrongCommandAuthoring = cutoverAuthoringDatabase({ commandId: "caretaker_command" })
  const wrongSnapshotPrimary = primaryDatabase("shadow_frozen", {
    sourceSnapshotSha256: sha("0"),
    expectedGeneCount: 1,
  })
  const wrongSnapshotAuthoring = cutoverAuthoringDatabase()
  t.after(() => {
    wrongCommandPrimary.database.close()
    wrongCommandAuthoring.database.close()
    wrongSnapshotPrimary.database.close()
    wrongSnapshotAuthoring.database.close()
  })

  await assert.rejects(
    () =>
      projectCanonicalManifestationCutoverEvent(
        {
          primaryDb: wrongCommandPrimary,
          authoringDb: wrongCommandAuthoring,
          cutoverRunId: "cutover_1",
          event: callback(3, "revision_seed"),
        },
        { readCanonical: async () => exact },
      ),
    (error) =>
      error instanceof ManifestationProjectionError &&
      error.code === "CUTOVER_EVENT_COMMAND_MISMATCH",
  )
  await assert.rejects(
    () =>
      projectCanonicalManifestationCutoverEvent(
        {
          primaryDb: wrongSnapshotPrimary,
          authoringDb: wrongSnapshotAuthoring,
          cutoverRunId: "cutover_1",
          event: callback(3, "revision_seed"),
        },
        { readCanonical: async () => exact },
      ),
    (error) =>
      error instanceof ManifestationProjectionError &&
      error.code === "CUTOVER_RUN_IDENTITY_MISMATCH",
  )
})
