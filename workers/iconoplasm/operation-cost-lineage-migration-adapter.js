import { executeOperationCostD1Batch } from "./operation-cost-d1-meter.js"
import { OperationCostError } from "../lib/operation-cost-ledger.js"
import {
  LINEAGE_ADMISSION_MIGRATION_NAME,
  LINEAGE_ADMISSION_MIGRATION_STATEMENTS,
} from "../generated/operation-cost-migrations.js"

export function createLineageAdmissionMigrationCostAdapter({
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
        Object.keys(args).sort().join() !== "max_indexed_rows,max_rows,max_schema_rows" ||
        !Number.isSafeInteger(args.max_rows) ||
        args.max_rows < 1 ||
        args.max_rows > 1000000 ||
        !Number.isSafeInteger(args.max_indexed_rows) ||
        args.max_indexed_rows < 0 ||
        args.max_indexed_rows > 20000 ||
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
        ...["icono_manifestation_revisions", "icono_manifestation_upload_intents"].map((table) => ({
          sql: `SELECT CASE WHEN (SELECT COUNT(*) FROM (SELECT 1 FROM ${table} LIMIT ?)) <= ?
            THEN 1 ELSE json('COST_MIGRATION_ROW_BOUND_EXCEEDED') END AS admitted`,
          parameters: [args.max_rows + 1, args.max_rows],
        })),
        {
          sql: `SELECT CASE WHEN
            (SELECT COUNT(*) FROM (SELECT caretaker_assignment_id FROM icono_manifestation_revisions LIMIT ?)
              WHERE caretaker_assignment_id IS NOT NULL) +
            (SELECT COUNT(*) FROM (SELECT caretaker_assignment_id,status FROM icono_manifestation_upload_intents LIMIT ?)
              WHERE caretaker_assignment_id IS NOT NULL AND status IN ('uploading','deleting')) <= ?
            THEN 1 ELSE json('COST_MIGRATION_INDEX_BOUND_EXCEEDED') END AS admitted`,
          parameters: [args.max_rows + 1, args.max_rows + 1, args.max_indexed_rows],
        },
        ...LINEAGE_ADMISSION_MIGRATION_STATEMENTS.map((sql) => ({ sql, parameters: [] })),
        {
          sql: "INSERT INTO d1_migrations(name) VALUES (?)",
          parameters: [LINEAGE_ADMISSION_MIGRATION_NAME],
        },
      ]
      // Per table: capped size guard, indexed-entry count, then partial-index
      // build. Cover input/table cursor visits separately. Index writes include
      // only matching rows, plus constant DDL/receipt/sequence bookkeeping.
      const bound = {
        rows_read: 12 * args.max_rows + 8 * args.max_schema_rows + 256,
        rows_written: args.max_indexed_rows + 32,
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
      return { result: { migration: LINEAGE_ADMISSION_MIGRATION_NAME, applied: true }, actual }
    },
  }
}
