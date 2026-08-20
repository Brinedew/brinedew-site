import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { DatabaseSync } from "node:sqlite"

const factoryMigration = readFileSync(
  new URL("../migrations-iconoplasm/0070_factory_recipe_authority.sql", import.meta.url),
  "utf8",
)
const publicSlotMigration = readFileSync(
  new URL("../migrations/0026_iconoplasm_user_emulsion_public_slots.sql", import.meta.url),
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

test("factory migration adds immutable recipe snapshots and a future-only active pointer", () => {
  const db = new DatabaseSync(":memory:")
  try {
    db.exec("CREATE TABLE icono_generation_requests (id INTEGER PRIMARY KEY)")
    db.exec("CREATE TABLE icono_candidate_generation_jobs (id TEXT PRIMARY KEY)")
    db.exec("CREATE TABLE icono_portrait_assets (gene_symbol TEXT, asset_sha256 TEXT)")
    db.exec(factoryMigration)

    const active = { ...db.prepare(
      "SELECT pipeline_code, vision_revision FROM icono_factory_active_recipe WHERE singleton_id = 1",
    ).get() }
    assert.deepEqual(active, { pipeline_code: "A", vision_revision: 1 })
    assert.ok(
      db.prepare("PRAGMA table_info(icono_generation_requests)").all().some(
        (column) => column.name === "factory_pipeline_code",
      ),
    )
    assert.ok(
      db.prepare("PRAGMA table_info(icono_portrait_assets)").all().some(
        (column) => column.name === "public_emulsion_code",
      ),
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
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM iconoplasm_user_emulsion_public_slots").get().n, 2)
  } finally {
    db.close()
  }
})

test("public factory identity stays clean while private IDs remain internal", () => {
  assert.match(workerSource, /code: "B"[\s\S]*cfg: 3\.2/)
  assert.match(workerSource, /code: "C"[\s\S]*cfg: 4\.5/)
  assert.match(workerSource, /code: "D"[\s\S]*cfg: 4\.5/)
  assert.match(workerSource, /public_emulsion_code/)
  assert.match(cardSource, /publicCode \|\| emulsionId/)
  assert.doesNotMatch(cardSource, /candidate_image_id[^\n]*<strong>/)
})
