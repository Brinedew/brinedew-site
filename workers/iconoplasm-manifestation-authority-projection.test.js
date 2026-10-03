import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import { projectCanonicalManifestationAuthorityEvent } from "./lib/iconoplasm-manifestation-authority-projection.js"

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
