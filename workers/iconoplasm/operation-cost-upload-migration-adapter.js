import { executeOperationCostD1Batch } from "./operation-cost-d1-meter.js"
import { OperationCostError } from "../lib/operation-cost-ledger.js"
import {
  UPLOAD_RESERVATION_MIGRATION_NAME,
  UPLOAD_RESERVATION_MIGRATION_STATEMENTS,
} from "../generated/operation-cost-migrations.js"

export function createUploadReservationMigrationCostAdapter({
  db,
  executable_sha256,
  schema_sha256,
}) {
  return {
    resource: "iconoplasm-authoring",
    executable_sha256,
    schema_sha256,
    async prepare(args) {
      if (args && Object.keys(args).length)
        throw new OperationCostError("COST_MIGRATION_ARGUMENTS_INVALID")
      const statements = [
        {
          sql: `SELECT CASE WHEN (SELECT COUNT(*) FROM (SELECT 1 FROM sqlite_schema LIMIT 257)) <= 256
            THEN 1 ELSE json('COST_MIGRATION_SCHEMA_BOUND_EXCEEDED') END AS admitted`,
          parameters: [],
        },
        ...UPLOAD_RESERVATION_MIGRATION_STATEMENTS.map((sql) => ({ sql, parameters: [] })),
        {
          sql: "INSERT INTO d1_migrations (name) VALUES (?)",
          parameters: [UPLOAD_RESERVATION_MIGRATION_NAME],
        },
      ]
      // Four schema-only DDL statements: no body/history rewrite or new index.
      // Bound repeated schema visits and migration/schema/sequence bookkeeping.
      const bound = { rows_read: 4352, rows_written: 32, requests: 1 }
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify({ statements, executable_sha256, schema_sha256 })),
      )
      const sha256 = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("")
      return { statements, bound, sha256 }
    },
    async dispatch(prepared) {
      const { actual } = await executeOperationCostD1Batch(db, prepared)
      return { result: { migration: UPLOAD_RESERVATION_MIGRATION_NAME, applied: true }, actual }
    },
  }
}
