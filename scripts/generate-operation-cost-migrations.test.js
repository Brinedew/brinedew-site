import assert from "node:assert/strict"
import test from "node:test"
import { reviewedMigrationStatements } from "./generate-operation-cost-migrations.mjs"

// A cost adapter executes only statements taken from a reviewed migration file.
// Failure modes, written first:
// 1. A trigger body is split at its inner semicolons, so an adapter would run
//    half a trigger.
// 2. A migration whose statement or trigger count changed after review still
//    generates, so an adapter runs SQL nobody reviewed.
// 3. Comments or blank lines leak into the statements.
test("reviewed statements keep each trigger whole and drop comments", () => {
  const statements = reviewedMigrationStatements(
    "migrations-iconoplasm",
    "0101_finalization_publication_barrier.sql",
    3,
    5,
  )
  assert.equal(statements.length, 5)
  const triggers = statements.filter((sql) => sql.startsWith("CREATE TRIGGER"))
  assert.equal(triggers.length, 3)
  for (const trigger of triggers) assert.match(trigger, /\nEND;$/)
  for (const sql of statements) assert.doesNotMatch(sql, /^\s*--/m)
})

test("a changed statement or trigger count fails generation", () => {
  for (const [triggers, count] of [
    [3, 4],
    [3, 6],
    [2, 5],
    [4, 5],
  ])
    assert.throws(
      () =>
        reviewedMigrationStatements(
          "migrations-iconoplasm",
          "0101_finalization_publication_barrier.sql",
          triggers,
          count,
        ),
      /statement structure changed/,
    )
})
