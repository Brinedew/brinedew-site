import { OperationCostError } from "../lib/operation-cost-ledger.js"
import { executeOperationCostD1Batch } from "./operation-cost-d1-meter.js"
import {
  SNAPSHOT_RETIREMENT_MIGRATION_NAME,
  SNAPSHOT_RETIREMENT_MIGRATION_STATEMENTS,
} from "../generated/operation-cost-migrations.js"

export function createSnapshotRetirementMigrationCostAdapter({
  db,
  executable_sha256,
  schema_sha256,
}) {
  return {
    resource: "iconoplasm-authoring",
    executable_sha256,
    schema_sha256,
    async prepare(args) {
      if (
        !args ||
        Object.keys(args).sort().join() !== "max_leases,max_schema_rows" ||
        !Number.isSafeInteger(args.max_leases) ||
        args.max_leases < 0 ||
        args.max_leases > 1024 ||
        !Number.isSafeInteger(args.max_schema_rows) ||
        args.max_schema_rows < 1 ||
        args.max_schema_rows > 1024
      )
        throw new OperationCostError("COST_MIGRATION_ARGUMENTS_INVALID")
      const statements = [
        {
          sql: `SELECT CASE WHEN (SELECT COUNT(*) FROM (SELECT 1 FROM sqlite_schema LIMIT ?)) <= ?
          THEN 1 ELSE json('COST_MIGRATION_SCHEMA_BOUND_EXCEEDED') END AS admitted`,
          parameters: [args.max_schema_rows + 1, args.max_schema_rows],
        },
        {
          sql: `SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_schema WHERE name IN
          ('icono_manifestation_snapshot_parts','icono_manifestation_snapshot_leases')
          AND type='table' AND sql NOT LIKE 'CREATE VIRTUAL TABLE%') = 2
          THEN 1 ELSE json('COST_MIGRATION_SCHEMA_CHANGED') END AS admitted`,
          parameters: [],
        },
        {
          sql: `SELECT CASE WHEN (SELECT COUNT(*) FROM (SELECT 1 FROM icono_manifestation_snapshot_leases LIMIT ?)) <= ?
          THEN 1 ELSE json('COST_MIGRATION_ROW_BOUND_EXCEEDED') END AS admitted`,
          parameters: [args.max_leases + 1, args.max_leases],
        },
        ...SNAPSHOT_RETIREMENT_MIGRATION_STATEMENTS.map((sql) => ({ sql, parameters: [] })),
        {
          sql: "INSERT INTO d1_migrations(name) VALUES (?)",
          parameters: [SNAPSHOT_RETIREMENT_MIGRATION_NAME],
        },
      ]
      // DROP clears the obsolete b-trees, not application rows through DELETE
      // triggers. Full-schema workerd verifies its metadata-only row receipts
      // and page reclamation; no VACUUM or source-table rebuild is performed.
      const bound = {
        rows_read: 4 * (args.max_leases + 1) + 16 * args.max_schema_rows + 256,
        rows_written: 16,
        requests: 1,
      }
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
      return { result: { migration: SNAPSHOT_RETIREMENT_MIGRATION_NAME, applied: true }, actual }
    },
  }
}
