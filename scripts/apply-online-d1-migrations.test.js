import assert from "node:assert/strict"
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

// The ceilings are the one operator allowance (1M reads, 70k writes; B-1035).
test("the reviewed prediction must fit twice over inside today's live headroom", () => {
  const total = { rows_read: 100000, rows_written: 300 }
  assert.doesNotThrow(() =>
    admitOnlineMigrations({ total, usage: { rows_read: 700_000, rows_written: 13_000 } }),
  )
  assert.throws(
    () => admitOnlineMigrations({ total, usage: { rows_read: 900_000, rows_written: 13_000 } }),
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
