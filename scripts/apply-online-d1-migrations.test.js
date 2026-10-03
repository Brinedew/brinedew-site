import assert from "node:assert/strict"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import {
  admitOnlineMigrations,
  checkMigrationGuards,
  planOnlineMigrations,
} from "./apply-online-d1-migrations.mjs"

// B-847 (25 Sep 2026): every migration, even a one-line CREATE INDEX, ran
// through the paused maintenance protocol, which cost a 43-minute public-API
// outage. Reviewed migrations that both the old and the new code tolerate now
// apply on the ordinary push, before the Worker deploy, with the app live.
//
// Failure modes, written before the code:
// 1. An unreviewed pending migration applies.
// 2. A reviewed migration that is not declared online applies without the
//    maintenance protocol.
// 3. One database is migrated before another database's refusal is known.
// 4. A pending file sorts before an already-applied one (history diverged or
//    out of order) and wrangler applies it anyway.
// 5. The reviewed prediction does not fit today's live headroom, yet applies.
// 6. The data outgrew the size the prediction was reviewed at.
// 7. Missing live usage is treated as headroom.

const manifest = {
  schema: "iconoplasm.migrationCostPlan.v1",
  migrations: {
    "iconoplasm/0110_drop.sql": {
      online: true,
      prediction: { rows_read: 3000, rows_written: 16, requests: 1 },
    },
    "iconoplasm/0111_shelf.sql": {
      online: true,
      prediction: { rows_read: 100000, rows_written: 300, requests: 1 },
      guards: [{ sql: "SELECT COUNT(*) AS n FROM users", max: 100 }],
    },
    "iconoplasm/0112_rebuild.sql": {
      prediction: { rows_read: 1000, rows_written: 1000, requests: 1 },
    },
  },
}

const files = {
  iconoplasm: ["0109_old.sql", "0110_drop.sql", "0111_shelf.sql"],
  "iconoplasm-authoring": ["0001_a.sql"],
}

test("reviewed online migrations are planned in file order across databases", () => {
  const plan = planOnlineMigrations({
    manifest,
    files,
    applied: {
      iconoplasm: new Set(["0109_old.sql"]),
      "iconoplasm-authoring": new Set(["0001_a.sql"]),
    },
  })
  assert.deepEqual(
    plan.pending.map((item) => item.key),
    ["iconoplasm/0110_drop.sql", "iconoplasm/0111_shelf.sql"],
  )
  assert.deepEqual(plan.total, { rows_read: 103000, rows_written: 316 })
  assert.deepEqual(plan.resources, ["iconoplasm"])
})

test("an unreviewed or maintenance-only pending migration refuses before anything applies", () => {
  assert.throws(
    () =>
      planOnlineMigrations({
        manifest,
        files: { iconoplasm: ["0110_drop.sql", "0113_unreviewed.sql"] },
        applied: { iconoplasm: new Set() },
      }),
    /COST_MIGRATION_NOT_REVIEWED: iconoplasm\/0113_unreviewed.sql/,
  )
  assert.throws(
    () =>
      planOnlineMigrations({
        manifest,
        files: {
          iconoplasm: ["0110_drop.sql"],
          "iconoplasm-authoring": ["0112_rebuild.sql"],
        },
        applied: { iconoplasm: new Set(), "iconoplasm-authoring": new Set() },
      }),
    /COST_MIGRATION_NOT_REVIEWED/,
  )
  assert.throws(
    () =>
      planOnlineMigrations({
        manifest,
        files: { iconoplasm: ["0112_rebuild.sql"] },
        applied: { iconoplasm: new Set() },
      }),
    /CODE_RELEASE_REQUIRES_MAINTENANCE: iconoplasm\/0112_rebuild.sql/,
  )
})

test("a pending file older than an applied one, or an unknown applied name, refuses", () => {
  assert.throws(
    () =>
      planOnlineMigrations({
        manifest,
        files: { iconoplasm: ["0110_drop.sql", "0111_shelf.sql"] },
        applied: { iconoplasm: new Set(["0111_shelf.sql"]) },
      }),
    /MIGRATION_OUT_OF_ORDER/,
  )
  assert.throws(
    () =>
      planOnlineMigrations({
        manifest,
        files: { iconoplasm: ["0110_drop.sql"] },
        applied: { iconoplasm: new Set(["0099_elsewhere.sql"]) },
      }),
    /COST_MIGRATION_HISTORY_DIVERGED: iconoplasm/,
  )
})

test("the reviewed prediction must fit twice over inside today's live headroom", () => {
  const total = { rows_read: 100000, rows_written: 300 }
  assert.doesNotThrow(() =>
    admitOnlineMigrations({ total, usage: { rows_read: 1_300_000, rows_written: 13_000 } }),
  )
  assert.throws(
    () => admitOnlineMigrations({ total, usage: { rows_read: 4_400_000, rows_written: 13_000 } }),
    /MIGRATION_HEADROOM: rows_read/,
  )
  assert.throws(
    () => admitOnlineMigrations({ total, usage: { rows_read: 0, rows_written: 69_500 } }),
    /MIGRATION_HEADROOM: rows_written/,
  )
  assert.throws(() => admitOnlineMigrations({ total, usage: null }), /MIGRATION_USAGE_UNAVAILABLE/)
  assert.throws(
    () => admitOnlineMigrations({ total, usage: { rows_read: 10, rows_written: "x" } }),
    /MIGRATION_USAGE_UNAVAILABLE/,
  )
})

test("a guard whose live count exceeds its reviewed bound refuses", async () => {
  const guards = [
    { key: "iconoplasm/0111_shelf.sql", sql: "SELECT COUNT(*) AS n FROM users", max: 100 },
  ]
  await checkMigrationGuards({ guards, query: async () => 38 })
  await assert.rejects(
    checkMigrationGuards({ guards, query: async () => 101 }),
    /MIGRATION_GUARD_EXCEEDED: iconoplasm\/0111_shelf.sql/,
  )
  await assert.rejects(
    checkMigrationGuards({ guards, query: async () => Number.NaN }),
    /MIGRATION_GUARD_UNAVAILABLE/,
  )
})

// B-921: the vote projection job table has no reader or writer left. Its drop
// ships on the ordinary push, so the real plan must carry it as an online
// migration with a prediction and guards that stop it before anything applies.
//
// Failure modes, written before the migration:
// 8. The drop is not reviewed online, so the push fails with
//    CODE_RELEASE_REQUIRES_MAINTENANCE and pauses the app for a no-op.
// 9. The table gained rows since it was measured empty, and the drop destroys
//    work somebody still expects.
// 10. A trigger or view elsewhere writes to the table; once it is gone every
//     write to that other table fails with "no such table".
// 11. The migration runs without a prediction, so the headroom check cannot
//     refuse it.
const DROP = "0114_retire_vote_projection_jobs.sql"
const TABLE = "icono_vote_projection_refresh_jobs"
const realManifest = JSON.parse(
  readFileSync(
    new URL("../cloudflare/operation-cost-migration-plan.json", import.meta.url),
    "utf8",
  ),
)
const iconoplasmDirectory = new URL("../migrations-iconoplasm/", import.meta.url)
const iconoplasmFiles = () =>
  readdirSync(iconoplasmDirectory)
    .filter((name) => name.endsWith(".sql"))
    .sort()

function schemaBeforeTheDrop() {
  const sqlite = new DatabaseSync(":memory:")
  for (const name of iconoplasmFiles().filter((file) => file < DROP))
    sqlite.exec(readFileSync(new URL(name, iconoplasmDirectory), "utf8"))
  return sqlite
}

test("the vote job table drop is a reviewed online migration whose guards refuse a surprise", async () => {
  assert.ok(existsSync(new URL(DROP, iconoplasmDirectory)), "the migration file exists")
  const files = iconoplasmFiles()
  const plan = planOnlineMigrations({
    manifest: realManifest,
    files: { iconoplasm: files },
    applied: { iconoplasm: new Set(files.filter((name) => name !== DROP)) },
  })
  assert.deepEqual(
    plan.pending.map((item) => item.key),
    [`iconoplasm/${DROP}`],
  )
  assert.ok(plan.total.rows_read > 0 && plan.total.rows_read <= 5000, JSON.stringify(plan.total))
  assert.ok(
    plan.total.rows_written > 0 && plan.total.rows_written <= 50,
    JSON.stringify(plan.total),
  )
  assert.doesNotThrow(() =>
    admitOnlineMigrations({ total: plan.total, usage: { rows_read: 0, rows_written: 0 } }),
  )
  assert.doesNotThrow(() =>
    admitOnlineMigrations({
      total: plan.total,
      usage: { rows_read: 4_000_000, rows_written: 60_000 },
    }),
  )

  const guards = plan.pending[0].guards.map((guard) => ({ ...guard, key: plan.pending[0].key }))
  assert.equal(guards.length, 2, "one guard for the rows, one for the other schema objects")
  const sqlite = schemaBeforeTheDrop()
  const query = async (guard) => Number(Object.values(sqlite.prepare(guard.sql).get())[0])
  await checkMigrationGuards({ guards, query })

  sqlite.exec(`INSERT INTO ${TABLE} (gene_symbol) VALUES ('TP53')`)
  await assert.rejects(checkMigrationGuards({ guards, query }), /MIGRATION_GUARD_EXCEEDED/)
  sqlite.exec(`DELETE FROM ${TABLE}`)
  await checkMigrationGuards({ guards, query })

  sqlite.exec(`CREATE TRIGGER trg_surprise AFTER INSERT ON icono_image_votes
    BEGIN INSERT INTO ${TABLE} (gene_symbol) VALUES (NEW.gene_symbol); END`)
  await assert.rejects(checkMigrationGuards({ guards, query }), /MIGRATION_GUARD_EXCEEDED/)
})
