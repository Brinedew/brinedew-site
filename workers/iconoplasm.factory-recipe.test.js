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
const factoryRecommendationMigration = readFileSync(
  new URL(
    "../migrations-iconoplasm/0074_factory_pipeline_vision_recommendations.sql",
    import.meta.url,
  ),
  "utf8",
)
const portraitIdentityNormalization = readFileSync(
  new URL(
    "../migrations-iconoplasm/0076_normalize_portrait_emulsion_identity.sql",
    import.meta.url,
  ),
  "utf8",
)
const duplicatePortraitIdentityRemoval = readFileSync(
  new URL(
    "../migrations-iconoplasm/0077_remove_duplicate_portrait_emulsion_code.sql",
    import.meta.url,
  ),
  "utf8",
)
const unqualifiedProjectionRebuild = readFileSync(
  new URL(
    "../migrations-iconoplasm/0078_rebuild_unqualified_emulsion_projections.sql",
    import.meta.url,
  ),
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

test("portrait identity normalization keeps proven lineage and marks legacy IDs unqualified", () => {
  const db = new DatabaseSync(":memory:")
  try {
    db.exec(`
      CREATE TABLE icono_portrait_assets (
        gene_symbol TEXT, asset_sha256 TEXT, emulsion_id TEXT, vision_id TEXT, created_at TEXT
      );
      CREATE TABLE icono_generation_requests (
        id INTEGER PRIMARY KEY, gene_symbol TEXT, fulfilled_asset_sha256 TEXT,
        factory_pipeline_code TEXT, factory_vision_revision INTEGER, requested_emulsion_slot INTEGER
      );
      CREATE TABLE icono_diagnostic_matrix_cells (generation_request_id INTEGER);
      CREATE TABLE icono_publish_state (gene_symbol TEXT, current_asset_sha256 TEXT);
      CREATE TABLE icono_vote_asset_summary (
        gene_symbol TEXT, asset_sha256 TEXT, upvotes INTEGER, score INTEGER
      );
      CREATE TABLE icono_generation_request_factory_option_sources (
        public_emulsion_code TEXT, vision_id TEXT
      );
      CREATE TABLE icono_generation_request_factory_option_rollup (
        public_emulsion_code TEXT PRIMARY KEY, emulsion_slot INTEGER, image_count INTEGER,
        live_count INTEGER, score INTEGER, vote_h_index INTEGER, preview_assets_json TEXT,
        updated_at TEXT
      );
      INSERT INTO icono_portrait_assets VALUES
        ('KIN', 'matrix-sha', 'A1-21103', 'anima-v1-21103', CURRENT_TIMESTAMP),
        ('VAPA', 'legacy-sha', 'A1-1003', 'anima-v1-1003', CURRENT_TIMESTAMP);
      INSERT INTO icono_generation_requests VALUES
        (2076, 'KIN', 'matrix-sha', 'C', 9, 21103);
      INSERT INTO icono_diagnostic_matrix_cells VALUES (2076);
    `)
    db.exec(portraitIdentityNormalization)
    assert.equal(
      db.prepare("SELECT emulsion_id FROM icono_portrait_assets WHERE gene_symbol='KIN'").get()
        .emulsion_id,
      "C9-21103",
    )
    assert.equal(
      db.prepare("SELECT emulsion_id FROM icono_portrait_assets WHERE gene_symbol='VAPA'").get()
        .emulsion_id,
      "0-1003",
    )
    assert.deepEqual(
      {
        ...db
          .prepare(
            "SELECT public_emulsion_code, image_count FROM icono_generation_request_factory_option_rollup",
          )
          .get(),
      },
      { public_emulsion_code: "C9-21103", image_count: 1 },
    )
  } finally {
    db.close()
  }
})

test("portrait assets retain only one emulsion identity field", () => {
  const db = new DatabaseSync(":memory:")
  try {
    db.exec("CREATE TABLE icono_generation_requests (id INTEGER PRIMARY KEY)")
    db.exec("CREATE TABLE icono_candidate_generation_jobs (id TEXT PRIMARY KEY)")
    db.exec(
      "CREATE TABLE icono_portrait_assets (gene_symbol TEXT, asset_sha256 TEXT, emulsion_id TEXT)",
    )
    db.exec(factoryMigration)
    db.exec(
      "CREATE INDEX idx_icono_portrait_assets_public_emulsion_code ON icono_portrait_assets (public_emulsion_code)",
    )
    db.exec(duplicatePortraitIdentityRemoval)

    const columns = db.prepare("PRAGMA table_info(icono_portrait_assets)").all()
    assert.ok(columns.some((column) => column.name === "emulsion_id"))
    assert.ok(!columns.some((column) => column.name === "public_emulsion_code"))
  } finally {
    db.close()
  }
})

test("legacy projections derive unqualified identity from canonical portraits", () => {
  const db = new DatabaseSync(":memory:")
  try {
    db.exec(`
      CREATE TABLE icono_portrait_assets (gene_symbol TEXT, asset_sha256 TEXT, emulsion_id TEXT);
      CREATE TABLE icono_generation_request_vision_option_rollup (
        vision_id TEXT PRIMARY KEY, emulsion_id TEXT, emulsion_family_id TEXT
      );
      CREATE TABLE icono_admin_vision_rollup (vision_id TEXT PRIMARY KEY, emulsion_id TEXT);
      CREATE TABLE icono_admin_gene_rollup (
        gene_symbol TEXT PRIMARY KEY, current_asset_sha256 TEXT, leader_asset_sha256 TEXT,
        live_emulsion_id TEXT, leader_emulsion_id TEXT
      );
      CREATE TABLE icono_user_emulsion_favorites (
        user_id TEXT, emulsion_family_id TEXT, created_at TEXT,
        PRIMARY KEY (user_id, emulsion_family_id)
      );
      INSERT INTO icono_portrait_assets VALUES ('KIN', 'sha', 'C9-21103');
      INSERT INTO icono_generation_request_vision_option_rollup VALUES ('anima-v1-21103', 'A1-21103', 'A1-21103');
      INSERT INTO icono_admin_vision_rollup VALUES ('anima-v1-21103', 'A1-21103');
      INSERT INTO icono_admin_gene_rollup VALUES ('KIN', 'sha', 'sha', 'A1-21103', 'A1-21103');
      INSERT INTO icono_user_emulsion_favorites VALUES ('brinedew', 'A1-21103', CURRENT_TIMESTAMP);
    `)
    db.exec(unqualifiedProjectionRebuild)

    assert.equal(
      db.prepare("SELECT emulsion_id FROM icono_generation_request_vision_option_rollup").get()
        .emulsion_id,
      "0-21103",
    )
    assert.equal(
      db.prepare("SELECT live_emulsion_id FROM icono_admin_gene_rollup").get().live_emulsion_id,
      "C9-21103",
    )
    assert.equal(
      db.prepare("SELECT emulsion_family_id FROM icono_user_emulsion_favorites").get()
        .emulsion_family_id,
      "0-21103",
    )
  } finally {
    db.close()
  }
})

test("factory Vision recommendations are mutable without changing Pipeline definitions", () => {
  const db = new DatabaseSync(":memory:")
  try {
    db.exec(factoryRecommendationMigration)
    db.prepare(
      `INSERT INTO icono_factory_pipeline_vision_recommendations (
         pipeline_code, vision_revision, updated_by
       ) VALUES (?, ?, ?)`,
    ).run("F", 7, "admin")
    db.prepare(
      `INSERT INTO icono_factory_pipeline_vision_recommendations (
         pipeline_code, vision_revision, updated_by
       ) VALUES (?, ?, ?)
       ON CONFLICT(pipeline_code) DO UPDATE SET
         vision_revision = excluded.vision_revision,
         updated_by = excluded.updated_by`,
    ).run("F", 9, "admin")
    assert.deepEqual(
      {
        ...db
          .prepare(
            "SELECT pipeline_code, vision_revision FROM icono_factory_pipeline_vision_recommendations",
          )
          .get(),
      },
      { pipeline_code: "F", vision_revision: 9 },
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
  assert.match(workerSource, /upper\(trim\(pa\.emulsion_id\)\) AS public_emulsion_code/)
  assert.match(cardSource, /displayEmulsionCode\(emulsionId\)/)
  assert.doesNotMatch(cardSource, /item\.public_emulsion_code/)
  assert.doesNotMatch(cardSource, /candidate_image_id[^\n]*<strong>/)
})

test("factory catalog exposes the Preview 3 sampler lines and recovered RAX2-era Vision", () => {
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

test("every factory label exposes its output resolution", () => {
  for (const pipeline of ICONOPLASM_FACTORY_CATALOG.pipelines) {
    assert.match(pipeline.label, new RegExp(`${pipeline.width}×${pipeline.height}$`))
  }
})

test("resolution-corrected factory lines preserve recipes at 1536x2048", () => {
  const replacements = new Map([
    ["H", "A"],
    ["I", "B"],
    ["J", "C"],
    ["K", "D"],
    ["L", "E"],
    ["M", "F"],
    ["N", "G"],
  ])
  for (const [correctedCode, originalCode] of replacements) {
    const corrected = ICONOPLASM_FACTORY_CATALOG.pipelines.find(
      ({ code }) => code === correctedCode,
    )
    const original = ICONOPLASM_FACTORY_CATALOG.pipelines.find(({ code }) => code === originalCode)
    assert.ok(corrected)
    assert.ok(original)
    assert.equal(corrected.width, 1536)
    assert.equal(corrected.height, 2048)
    assert.equal(corrected.model, original.model)
    assert.equal(corrected.steps, original.steps)
    assert.equal(corrected.cfg, original.cfg)
    assert.equal(corrected.sampler, original.sampler)
  }
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
