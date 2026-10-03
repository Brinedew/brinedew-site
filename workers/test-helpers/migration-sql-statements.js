import { readFileSync } from "node:fs"
import { splitMigrationSql } from "../../scripts/generate-operation-cost-migrations.mjs"

// A migration that a test applies to a Miniflare D1 has to be sent statement by
// statement: D1's exec() treats every line as a statement. The splitter is the
// one the cost-adapter generator uses.
export function migrationStatements(directory, name) {
  return splitMigrationSql(readFileSync(new URL(name, directory), "utf8"), name)
}

// Runs a migration file's own statements, in order, on a D1 binding. One batch
// keeps the file atomic, as `wrangler d1 migrations apply` does.
export async function applyMigrationFile(db, directory, name) {
  await db.batch(migrationStatements(directory, name).map((sql) => db.prepare(sql)))
}
