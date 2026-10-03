import { OperationCostError } from "../lib/operation-cost-ledger.js"
import { executeOperationCostD1Batch } from "./operation-cost-d1-meter.js"

// One adapter for the migrations that only drop schema objects nothing reads:
// 0110 (the finalization handoff table and its three triggers) and 0114 (the
// vote projection job table). Schema only: each DROP removes one sqlite_schema
// row (a table's own indexes go with it) and rescans sqlite_schema (362 rows
// on 2026-09-26), then the journal row. No statement scans a data table, so
// the bound allows eight full passes over the admitted 512-row schema.
export function createSchemaDropMigrationCostAdapter({
  db,
  name,
  statements: migrationStatements,
  executable_sha256,
  schema_sha256,
}) {
  if (
    !name ||
    !Array.isArray(migrationStatements) ||
    !migrationStatements.length ||
    migrationStatements.length > 4 ||
    !migrationStatements.every((sql) =>
      /^DROP (?:TABLE|TRIGGER|INDEX) IF EXISTS [A-Za-z_][A-Za-z0-9_]*;$/.test(sql),
    )
  )
    throw new TypeError(
      "A schema-drop migration is one to four reviewed DROP ... IF EXISTS statements",
    )
  return {
    resource: "iconoplasm",
    migration_protocol: "one-migration-per-release-v1",
    executable_sha256,
    schema_sha256,
    async prepare(args) {
      if (
        !args ||
        Object.keys(args).join() !== "max_schema_rows" ||
        !Number.isSafeInteger(args.max_schema_rows) ||
        args.max_schema_rows < 1 ||
        args.max_schema_rows > 512
      )
        throw new OperationCostError("COST_MIGRATION_ARGUMENTS_INVALID")
      const statements = [
        {
          sql: "SELECT CASE WHEN (SELECT COUNT(*) FROM (SELECT 1 FROM sqlite_schema LIMIT ?)) <= ? THEN 1 ELSE json('COST_MIGRATION_SCHEMA_BOUND_EXCEEDED') END AS admitted",
          parameters: [args.max_schema_rows + 1, args.max_schema_rows],
        },
        ...migrationStatements.map((sql) => ({ sql, parameters: [] })),
        {
          sql: "INSERT INTO d1_migrations(name) VALUES (?)",
          parameters: [name],
        },
      ]
      const bound = {
        rows_read: 8 * args.max_schema_rows + 256,
        rows_written: 32,
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
