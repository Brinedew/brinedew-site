import { OperationCostError } from "../lib/operation-cost-ledger.js"
import { executeOperationCostD1Batch } from "./operation-cost-d1-meter.js"
import {
  VOTE_JOB_VERSION_MIGRATION_NAME,
  VOTE_JOB_VERSION_MIGRATION_STATEMENTS,
} from "../generated/operation-cost-migrations.js"

// Both supported starting shapes are explicit and checked inside the atomic
// migration. Never reset versions or run a best-effort ALTER on a request.
export function createVoteJobVersionMigrationCostAdapter({ db, executable_sha256, schema_sha256 }) {
  return {
    resource: "iconoplasm",
    executable_sha256,
    schema_sha256,
    async prepare(args) {
      if (
        !args ||
        Object.keys(args).sort().join() !== "job_version_exists,max_schema_rows" ||
        typeof args.job_version_exists !== "boolean" ||
        !Number.isSafeInteger(args.max_schema_rows) ||
        args.max_schema_rows < 1 ||
        args.max_schema_rows > 1024
      )
        throw new OperationCostError("COST_MIGRATION_ARGUMENTS_INVALID")
      const present = args.job_version_exists ? 1 : 0
      const statements = [
        {
          sql: `SELECT CASE WHEN (SELECT COUNT(*) FROM (SELECT 1 FROM sqlite_schema LIMIT ?)) <= ?
          THEN 1 ELSE json('COST_MIGRATION_SCHEMA_BOUND_EXCEEDED') END AS admitted`,
          parameters: [args.max_schema_rows + 1, args.max_schema_rows],
        },
        {
          sql: `SELECT CASE WHEN COUNT(*) = 8 + ? AND
            SUM(CASE WHEN name='job_version' AND upper(type)='INTEGER' AND "notnull"=1 AND dflt_value='1'
              THEN 1 ELSE 0 END) = ?
          THEN 1 ELSE json('COST_MIGRATION_JOB_VERSION_SHAPE_CHANGED') END AS admitted
          FROM (SELECT name,type,"notnull",dflt_value FROM pragma_table_info('icono_vote_projection_refresh_jobs') LIMIT 17)`,
          parameters: [present, present],
        },
        ...(present
          ? []
          : VOTE_JOB_VERSION_MIGRATION_STATEMENTS.map((sql) => ({ sql, parameters: [] }))),
        {
          sql: "INSERT INTO d1_migrations(name) VALUES (?)",
          parameters: [VOTE_JOB_VERSION_MIGRATION_NAME],
        },
      ]
      const bound = { rows_read: 64 * args.max_schema_rows + 256, rows_written: 16, requests: 1 }
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
      return { result: { migration: VOTE_JOB_VERSION_MIGRATION_NAME, applied: true }, actual }
    },
  }
}
