import { executeOperationCostD1Batch } from "./operation-cost-d1-meter.js"
import { OperationCostError } from "../lib/operation-cost-ledger.js"
import {
  FINALIZATION_MIGRATION_NAME,
  FINALIZATION_MIGRATION_STATEMENTS,
} from "../generated/operation-cost-migrations.js"

// This scan is deliberately capped and included in the reservation. There is
// no filter/join/sort: reading at most cap+1 rows establishes a table-size bound
// without assumptions about rowid gaps, sign, or numeric range.
export const FINALIZATION_ROW_COUNT_GUARD = `SELECT CASE WHEN
  (SELECT COUNT(*) FROM (SELECT 1 FROM icono_sync_finalization_jobs LIMIT ?)) <= ?
  THEN 1 ELSE json('COST_MIGRATION_ROW_BOUND_EXCEEDED') END AS admitted`

// Each side of the completed status uses its own indexed range and stops
// after cap+1 entries. A plain status<>completed count can scan all history.
export const FINALIZATION_UNFINISHED_GUARD = `SELECT CASE WHEN
  (SELECT COUNT(*) FROM (SELECT 1 FROM icono_sync_finalization_jobs
    INDEXED BY idx_icono_sync_finalization_jobs_status_next_attempt
    WHERE status < 'completed' LIMIT ?)) +
  (SELECT COUNT(*) FROM (SELECT 1 FROM icono_sync_finalization_jobs
    INDEXED BY idx_icono_sync_finalization_jobs_status_next_attempt
    WHERE status > 'completed' LIMIT ?)) <= ?
  THEN 1 ELSE json('COST_MIGRATION_UNFINISHED_BOUND_EXCEEDED') END AS admitted`

const SCHEMA_SIZE_GUARD = `SELECT CASE WHEN
  (SELECT COUNT(*) FROM (SELECT 1 FROM sqlite_schema LIMIT 1025)) <= 1024 THEN
  CASE WHEN EXISTS (SELECT 1 FROM sqlite_schema WHERE name = 'icono_sync_finalization_jobs'
    AND type = 'table' AND sql NOT LIKE 'CREATE VIRTUAL TABLE%')
  THEN 1 ELSE json('COST_MIGRATION_SCHEMA_CHANGED') END
  ELSE json('COST_MIGRATION_SCHEMA_BOUND_EXCEEDED') END AS admitted`

export function createFinalizationMigrationCostAdapter({ db, executable_sha256, schema_sha256 }) {
  return {
    resource: "iconoplasm",
    executable_sha256,
    schema_sha256,
    async prepare(args) {
      if (
        !args ||
        Object.keys(args).some((key) => !["max_rows", "max_unfinished"].includes(key)) ||
        !Number.isSafeInteger(args.max_rows) ||
        args.max_rows < 1 ||
        args.max_rows > 1_000_000 ||
        !Number.isSafeInteger(args.max_unfinished) ||
        args.max_unfinished < 0 ||
        args.max_unfinished > 20_000
      ) {
        throw new OperationCostError("COST_MIGRATION_ARGUMENTS_INVALID")
      }
      const statements = [
        { sql: SCHEMA_SIZE_GUARD, parameters: [] },
        { sql: FINALIZATION_ROW_COUNT_GUARD, parameters: [args.max_rows + 1, args.max_rows] },
        {
          sql: FINALIZATION_UNFINISHED_GUARD,
          parameters: [args.max_unfinished + 1, args.max_unfinished + 1, args.max_unfinished],
        },
        ...FINALIZATION_MIGRATION_STATEMENTS.map((sql) => ({ sql, parameters: [] })),
        {
          sql: "INSERT INTO d1_migrations (name) VALUES (?)",
          parameters: [FINALIZATION_MIGRATION_NAME],
        },
      ]
      // Four linear passes (capped count, counter seed, two indexes), plus
      // bounded guards and schema bookkeeping. Reserve extra row visits for
      // the input/index cursors. Writes cover both new indexes, one summary
      // row, migration receipt and schema/sequence bookkeeping. The fixed DDL
      // creates six schema objects and one summary row; 64 covers that metadata
      // and receipt indexes independently of the number of stored job rows.
      const bound = {
        rows_read: 8 * args.max_rows + 4 * (args.max_unfinished + 1) + 8704,
        rows_written: args.max_rows + args.max_unfinished + 64,
        requests: 1,
      }
      const bytes = new TextEncoder().encode(
        JSON.stringify({ statements, executable_sha256, schema_sha256 }),
      )
      const digest = await crypto.subtle.digest("SHA-256", bytes)
      const sha256 = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("")
      return { statements, bound, sha256 }
    },
    async dispatch(prepared) {
      const { actual } = await executeOperationCostD1Batch(db, prepared)
      return { result: { migration: FINALIZATION_MIGRATION_NAME, applied: true }, actual }
    },
  }
}
