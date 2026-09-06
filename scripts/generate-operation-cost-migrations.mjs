import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const root = fileURLToPath(new URL("../", import.meta.url))
const filename = "0094_finalization_summary.sql"
const authoringFilename = "0012_streamed_replica_snapshots.sql"
const uploadFilename = "0013_strict_upload_reservations.sql"
const lineageFilename = "0014_bounded_lineage_upload_admission.sql"
const target = path.join(root, "workers/generated/operation-cost-migrations.js")

// Deliberately handles this one reviewed migration's line-oriented SQL. This
// is not a general SQL parser. A changed statement shape must fail generation.
function reviewedMigrationStatements(directory, name, expectedTriggers, expectedStatements = 7) {
  const source = readFileSync(path.join(root, directory, name), "utf8")
  const statements = []
  let current = []
  let trigger = false
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("--")) continue
    if (!current.length) trigger = /^CREATE TRIGGER\b/.test(line)
    current.push(line)
    if ((trigger && /^END;\s*$/.test(line)) || (!trigger && /;\s*$/.test(line))) {
      statements.push(current.join("\n"))
      current = []
    }
  }
  if (
    current.length ||
    statements.length !== expectedStatements ||
    statements.filter((sql) => sql.startsWith("CREATE TRIGGER")).length !== expectedTriggers
  ) {
    throw new Error(`Migration ${name} statement structure changed; review its cost adapter`)
  }
  return statements
}

export function finalizationMigrationStatements() {
  return reviewedMigrationStatements("migrations-iconoplasm", filename, 3)
}

export function authoringStreamMigrationStatements() {
  return reviewedMigrationStatements("migrations-iconoplasm-authoring", authoringFilename, 4)
}

export function uploadReservationMigrationStatements() {
  return reviewedMigrationStatements("migrations-iconoplasm-authoring", uploadFilename, 2, 4)
}

export function lineageAdmissionMigrationStatements() {
  return reviewedMigrationStatements("migrations-iconoplasm-authoring", lineageFilename, 1, 4)
}

function output() {
  const migrations = [
    ["FINALIZATION", filename, finalizationMigrationStatements()],
    ["AUTHORING_STREAM", authoringFilename, authoringStreamMigrationStatements()],
    ["UPLOAD_RESERVATION", uploadFilename, uploadReservationMigrationStatements()],
    ["LINEAGE_ADMISSION", lineageFilename, lineageAdmissionMigrationStatements()],
  ]
  return (
    "// Generated from reviewed migrations; never accept caller SQL.\n" +
    migrations
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
