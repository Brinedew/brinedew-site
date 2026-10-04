import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const root = fileURLToPath(new URL("../", import.meta.url))
const target = path.join(root, "workers/generated/operation-cost-migrations.js")

// Splits a migration file into the statements D1 runs one by one. Deliberately
// handles the repository's line-oriented SQL: a statement ends at a line ending
// in ";", except a CREATE TRIGGER block, which ends at the "END;" line that
// closes it. This is not a general SQL parser.
export function splitMigrationSql(source, name) {
  const statements = []
  let current = []
  let trigger = false
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("--")) continue
    if (!current.length) trigger = /^CREATE TRIGGER\b/i.test(line)
    current.push(line)
    if (trigger ? /^END;\s*$/.test(line) : /;\s*$/.test(line)) {
      statements.push(current.join("\n"))
      current = []
    }
  }
  if (current.length) throw new Error(`Migration ${name} ends inside an unterminated statement`)
  return statements
}

// A reviewed migration's statement shape is pinned: a changed shape must fail
// generation.
export function reviewedMigrationStatements(directory, name, expectedTriggers, expectedStatements) {
  const statements = splitMigrationSql(readFileSync(path.join(root, directory, name), "utf8"), name)
  if (
    statements.length !== expectedStatements ||
    statements.filter((sql) => sql.startsWith("CREATE TRIGGER")).length !== expectedTriggers
  ) {
    throw new Error(`Migration ${name} statement structure changed; review its cost adapter`)
  }
  return statements
}

// A migration that is pending in production adds one entry here:
// [export prefix, migration file name, reviewedMigrationStatements(...)]. Its
// adapter in workers/iconoplasm/operation-cost-migration-adapters.js imports
// the generated `<PREFIX>_MIGRATION_NAME` and `<PREFIX>_MIGRATION_STATEMENTS`.
// The entry is deleted once the deploy shows the migration applied.
function pendingMigrations() {
  return [
    [
      "TAGGERIZER_DAILY_CALLS",
      "0115_taggerizer_daily_calls.sql",
      reviewedMigrationStatements("migrations-iconoplasm", "0115_taggerizer_daily_calls.sql", 0, 1),
    ],
  ]
}

function output() {
  return (
    "// Generated from reviewed migrations; never accept caller SQL.\n" +
    pendingMigrations()
      .map(
        ([prefix, name, statements]) =>
          `export const ${prefix}_MIGRATION_NAME = ${JSON.stringify(name)}\nexport const ${prefix}_MIGRATION_STATEMENTS = Object.freeze(${JSON.stringify(statements, null, 2)})\n`,
      )
      .join("")
  )
}

export function assertOperationCostMigrationsCurrent() {
  if (readFileSync(target, "utf8").replace(/\r\n/g, "\n") !== output()) {
    throw new Error("Operation cost migration SQL is stale; regenerate before release")
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) assertOperationCostMigrationsCurrent()
  else writeFileSync(target, output(), "utf8")
}
