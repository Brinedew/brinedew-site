import { OperationCostError } from "../lib/operation-cost-ledger.js"
import { executeOperationCostD1Batch } from "./operation-cost-d1-meter.js"

// One adapter for a migration that only adds one index to an existing table.
// Building the index reads every row of that table once and writes one entry per
// indexed row (fewer for a partial index), so the cost grows with the table, not
// the schema. The admission statement counts the table up to the admitted bound
// and refuses the whole batch beyond it; the bound then allows the count pass,
// the build pass and one more, plus a few passes over a 512-row schema.
const STATEMENT =
  /^CREATE INDEX IF NOT EXISTS [A-Za-z_][A-Za-z0-9_]* ON ([A-Za-z_][A-Za-z0-9_]*) \([^;()]*\)(?: WHERE [^;()]*)?;$/

export function createSchemaIndexMigrationCostAdapter({
  db,
  name,
  statements: migrationStatements,
  executable_sha256,
  schema_sha256,
}) {
  if (
    !name ||
    !Array.isArray(migrationStatements) ||
    migrationStatements.length !== 1 ||
    !STATEMENT.test(migrationStatements[0])
  )
    throw new TypeError("A schema-index migration is one reviewed CREATE INDEX IF NOT EXISTS")
  const table = migrationStatements[0].match(STATEMENT)[1]
  return {
    resource: "iconoplasm",
    migration_protocol: "one-migration-per-release-v1",
    executable_sha256,
    schema_sha256,
    async prepare(args) {
      if (
        !args ||
        Object.keys(args).join() !== "max_table_rows" ||
        !Number.isSafeInteger(args.max_table_rows) ||
        args.max_table_rows < 1 ||
        args.max_table_rows > 100_000
      )
        throw new OperationCostError("COST_MIGRATION_ARGUMENTS_INVALID")
      const statements = [
        {
          sql: `SELECT CASE WHEN (SELECT COUNT(*) FROM (SELECT 1 FROM ${table} LIMIT ?)) <= ? THEN 1 ELSE json('COST_MIGRATION_TABLE_BOUND_EXCEEDED') END AS admitted`,
          parameters: [args.max_table_rows + 1, args.max_table_rows],
        },
        { sql: migrationStatements[0], parameters: [] },
        {
          sql: "INSERT INTO d1_migrations(name) VALUES (?)",
          parameters: [name],
        },
      ]
      const bound = {
        rows_read: 3 * args.max_table_rows + 4 * 512 + 256,
        rows_written: args.max_table_rows + 16,
        requests: 1,
      }
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify({ statements, executable_sha256, schema_sha256 })),
      )
      return {
        statements,
        bound,
        sha256: Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join(""),
      }
    },
    async dispatch(prepared) {
      const { actual } = await executeOperationCostD1Batch(db, prepared)
      return { result: { migration: name, applied: true }, actual }
    },
  }
}
