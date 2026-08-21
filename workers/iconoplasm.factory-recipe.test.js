import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { DatabaseSync } from "node:sqlite"
import { ICONOPLASM_FACTORY_CATALOG } from "./generated/iconoplasm-factory-catalog.js"

const factoryMigration = readFileSync(
  new URL("../migrations-iconoplasm/0070_factory_recipe_authority.sql", import.meta.url),
  "utf8",
)
const publicSlotMigration = readFileSync(
  new URL("../migrations/0026_iconoplasm_user_emulsion_public_slots.sql", import.meta.url),
  "utf8",
)
const diagnosticMigration = readFileSync(
  new URL("../migrations-iconoplasm/0071_diagnostic_matrices.sql", import.meta.url),
  "utf8",
)
const atomicDiagnosticMigration = readFileSync(
  new URL("../migrations-iconoplasm/0072_atomic_diagnostic_matrices.sql", import.meta.url),
  "utf8",
)
const factoryVisionMigration = readFileSync(
  new URL("../migrations-iconoplasm/0073_factory_vision_definitions.sql", import.meta.url),
  "utf8",
)
const workerSource = readFileSync(
  new URL(
    "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
    import.meta.url,
  ),
  "utf8",
)
const cardSource = readFileSync(
  new URL("../shared/iconoplasm-card/shared-card-runtime.js", import.meta.url),
  "utf8",
)
const factoryCatalogSource = readFileSync(
  new URL("./generated/iconoplasm-factory-catalog.js", import.meta.url),
  "utf8",
)

test("factory migration adds immutable recipe snapshots and a future-only active pointer", () => {
  const db = new DatabaseSync(":memory:")
  try {
    db.exec("CREATE TABLE icono_generation_requests (id INTEGER PRIMARY KEY)")
    db.exec("CREATE TABLE icono_candidate_generation_jobs (id TEXT PRIMARY KEY)")
    db.exec("CREATE TABLE icono_portrait_assets (gene_symbol TEXT, asset_sha256 TEXT)")
    db.exec(factoryMigration)

    const active = {
      ...db
        .prepare(
          "SELECT pipeline_code, vision_revision FROM icono_factory_active_recipe WHERE singleton_id = 1",
        )
        .get(),
    }
    assert.deepEqual(active, { pipeline_code: "A", vision_revision: 1 })
    assert.ok(
      db
        .prepare("PRAGMA table_info(icono_generation_requests)")
        .all()
        .some((column) => column.name === "factory_pipeline_code"),
    )
    assert.ok(
      db
        .prepare("PRAGMA table_info(icono_portrait_assets)")
        .all()
        .some((column) => column.name === "public_emulsion_code"),
    )
  } finally {
    db.close()
  }
})

test("saved emulsion revisions receive stable plain numeric slots", () => {
  const db = new DatabaseSync(":memory:")
  try {
    db.exec(`CREATE TABLE iconoplasm_user_emulsion_versions (
      user_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      public_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`)
    db.exec(`INSERT INTO iconoplasm_user_emulsion_versions VALUES
      ('user-b', 2, 'PRIVATE-B-2', 20),
      ('user-a', 1, 'PRIVATE-A-1', 10)`)
    db.exec(publicSlotMigration)
    assert.deepEqual(
      db
        .prepare("SELECT slot, public_id FROM iconoplasm_user_emulsion_public_slots ORDER BY slot")
        .all()
        .map((row) => ({ ...row })),
      [
        { slot: 1, public_id: "PRIVATE-A-1" },
        { slot: 2, public_id: "PRIVATE-B-2" },
      ],
    )
    db.exec(publicSlotMigration)
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM iconoplasm_user_emulsion_public_slots").get().n,
      2,
    )
  } finally {
    db.close()
  }
})

test("factory Vision catalog starts with three immutable numbered prompt policies", () => {
  const db = new DatabaseSync(":memory:")
  try {
    db.exec(factoryVisionMigration)
    assert.deepEqual(
      db
        .prepare(
          `SELECT revision, source_id, prompt_content_mode, prompt_order_mode
             FROM icono_factory_vision_definitions ORDER BY revision`,
        )
        .all()
        .map((row) => ({ ...row })),
      [
        {
          revision: 1,
          source_id: "artist-random-anima",
          prompt_content_mode: "tags_only",
          prompt_order_mode: "manifestation_then_vision",
        },
        {
          revision: 2,
          source_id: "artist-random-anima-preview-base",
          prompt_content_mode: "tags_only",
          prompt_order_mode: "vision_then_manifestation",
        },
        {
          revision: 3,
          source_id: "artist-random-anima-turbo",
          prompt_content_mode: "full_manifestation",
          prompt_order_mode: "vision_then_manifestation",
        },
      ],
    )
  } finally {
    db.close()
  }
})

test("public factory identity stays clean while private IDs remain internal", () => {
  assert.match(factoryCatalogSource, /code: "B"[\s\S]*cfg: 3\.2/)
  assert.match(factoryCatalogSource, /code: "C"[\s\S]*cfg: 4/)
  assert.match(factoryCatalogSource, /code: "D"[\s\S]*cfg: 4\.5/)
  assert.match(workerSource, /public_emulsion_code/)
  assert.match(cardSource, /publicCode \|\| emulsionId/)
  assert.doesNotMatch(cardSource, /candidate_image_id[^\n]*<strong>/)
})

test("factory catalog keeps corrected recommendations and the recovered RAX2-era Vision", () => {
  assert.deepEqual(
    ICONOPLASM_FACTORY_CATALOG.pipelines.map(({ code, recommended_vision }) => [
      code,
      recommended_vision,
    ]),
    [
      ["A", 4],
      ["B", 4],
      ["C", 7],
      ["D", 7],
      ["E", 8],
      ["F", 7],
      ["G", 7],
    ],
  )
  assert.deepEqual(
    ICONOPLASM_FACTORY_CATALOG.pipelines
      .filter(({ code }) => code === "F" || code === "G")
      .map(({ code, model, sampler, steps, cfg }) => ({ code, model, sampler, steps, cfg })),
    [
      {
        code: "F",
        model: "anima-preview3-base.safetensors",
        sampler: "dpmpp_2m_sde_gpu",
        steps: 30,
        cfg: 4,
      },
      {
        code: "G",
        model: "anima-preview3-base.safetensors",
        sampler: "euler_ancestral",
        steps: 30,
        cfg: 4,
      },
    ],
  )
  assert.deepEqual(
    ICONOPLASM_FACTORY_CATALOG.visions
      .filter((vision) => vision.revision >= 7)
      .map((vision) => ({
        revision: vision.revision,
        content: vision.prompt_content_mode,
        order: vision.prompt_order_mode,
      })),
    [
      { revision: 7, content: "tags_only", order: "vision_then_manifestation" },
      { revision: 8, content: "full_manifestation", order: "vision_then_manifestation" },
      { revision: 9, content: "tags_only", order: "vision_then_manifestation" },
    ],
  )
})

test("diagnostic matrix schema owns explicit recipes and removes reference-gene snapshots", () => {
  const db = new DatabaseSync(":memory:")
  try {
    db.exec(`CREATE TABLE icono_generation_requests (
      id INTEGER PRIMARY KEY,
      requested_reference_asset_sha256 TEXT,
      requested_reference_gene_symbol TEXT
    )`)
    db.exec(diagnosticMigration)
    const requestColumns = db
      .prepare("PRAGMA table_info(icono_generation_requests)")
      .all()
      .map((column) => column.name)
    assert.ok(requestColumns.includes("requested_emulsion_slot"))
    assert.ok(requestColumns.includes("request_origin"))
    assert.ok(requestColumns.includes("diagnostic_run_id"))
    assert.ok(!requestColumns.includes("requested_reference_asset_sha256"))
    assert.ok(!requestColumns.includes("requested_reference_gene_symbol"))
    assert.ok(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get("icono_diagnostic_matrix_runs"),
    )
    assert.ok(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get("icono_diagnostic_matrix_cells"),
    )
  } finally {
    db.close()
  }
})

test("atomic diagnostic migration removes every interrupted legacy builder", () => {
  const db = new DatabaseSync(":memory:")
  try {
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE icono_generation_requests (
        id INTEGER PRIMARY KEY,
        request_origin TEXT NOT NULL,
        diagnostic_run_id TEXT NOT NULL
      );
      CREATE TABLE icono_diagnostic_matrix_runs (
        id TEXT PRIMARY KEY,
        queue_state TEXT NOT NULL
      );
      CREATE TABLE icono_diagnostic_matrix_cells (
        run_id TEXT NOT NULL,
        generation_request_id INTEGER NOT NULL,
        FOREIGN KEY (run_id) REFERENCES icono_diagnostic_matrix_runs(id) ON DELETE CASCADE,
        FOREIGN KEY (generation_request_id) REFERENCES icono_generation_requests(id) ON DELETE CASCADE
      );
      INSERT INTO icono_diagnostic_matrix_runs VALUES ('partial', 'building');
      INSERT INTO icono_generation_requests VALUES (1, 'diagnostic_matrix', 'partial');
      INSERT INTO icono_diagnostic_matrix_cells VALUES ('partial', 1);
    `)
    db.exec(atomicDiagnosticMigration)
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM icono_diagnostic_matrix_runs").get().n, 0)
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM icono_generation_requests").get().n, 0)
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM icono_diagnostic_matrix_cells").get().n, 0)
  } finally {
    db.close()
  }
})
