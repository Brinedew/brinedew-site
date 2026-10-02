import { OperationCostError } from "../lib/operation-cost-ledger.js"
import { executeOperationCostD1Batch } from "./operation-cost-d1-meter.js"

// One adapter for the migrations that only create small empty tables: 0112
// (the blot backlog watermark) and 0113 (the per-gene vote version and the
// daily vote budget). Schema only: one sqlite_schema row per table and the
// journal row; no data table is touched and no row is seeded. The CREATE rescans sqlite_schema (about 360 rows on
// 2026-09-26), so the bound allows a few full passes over the admitted
// 512-row schema.
export function createSchemaTableMigrationCostAdapter({
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
    !migrationStatements.every((sql) => /^CREATE TABLE IF NOT EXISTS /.test(sql))
  )
    throw new TypeError("A schema-table migration is one to four reviewed CREATE TABLE statements")
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
        rows_read: 4 * args.max_schema_rows + 256,
        rows_written: 16,
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
