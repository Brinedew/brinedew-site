import { OperationCostError } from "../lib/operation-cost-ledger.js"
import { executeOperationCostD1Batch } from "./operation-cost-d1-meter.js"
import {
  VOTE_WAKE_MIGRATION_NAME,
  VOTE_WAKE_MIGRATION_STATEMENTS,
} from "../generated/operation-cost-migrations.js"

export const VOTE_WAKE_SCHEMA_GUARD = `SELECT CASE
  WHEN (SELECT COUNT(*) FROM (SELECT 1 FROM sqlite_schema LIMIT 1025)) > 1024
    THEN json('COST_MIGRATION_SCHEMA_BOUND_EXCEEDED')
  WHEN (SELECT COUNT(*) FROM pragma_table_info('icono_vote_projection_refresh_jobs')
        WHERE name IN ('wake_outstanding', 'wake_version')) <> 0
    THEN json('COST_MIGRATION_VOTE_WAKE_SHAPE_CHANGED')
  WHEN (SELECT COUNT(*) FROM pragma_table_info('icono_vote_projection_refresh_jobs')
        WHERE name = 'job_version' AND upper(type) = 'INTEGER' AND "notnull" = 1) <> 1
    THEN json('COST_MIGRATION_VOTE_WAKE_PREREQUISITE_MISSING')
  ELSE 1 END AS admitted`

// SQLite's constant-default ADD COLUMN is a schema mutation, not a table-row
// rewrite. This adapter still measures the real D1 receipt against a bounded
// 20,000-row dirty-job fixture so a provider behavior change fails the test.
export function createVoteWakeMigrationCostAdapter({ db, executable_sha256, schema_sha256 }) {
  return {
    resource: "iconoplasm",
    executable_sha256,
    schema_sha256,
    async prepare(args) {
      if (!args || Object.keys(args).length)
        throw new OperationCostError("COST_MIGRATION_ARGUMENTS_INVALID")
      const statements = [
        { sql: VOTE_WAKE_SCHEMA_GUARD, parameters: [] },
        ...VOTE_WAKE_MIGRATION_STATEMENTS.map((sql) => ({ sql, parameters: [] })),
        {
          sql: "INSERT INTO d1_migrations (name) VALUES (?)",
          parameters: [VOTE_WAKE_MIGRATION_NAME],
        },
      ]
      const bound = { rows_read: 1152, rows_written: 64, requests: 1 }
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
      return { result: { migration: VOTE_WAKE_MIGRATION_NAME, applied: true }, actual }
    },
  }
}
