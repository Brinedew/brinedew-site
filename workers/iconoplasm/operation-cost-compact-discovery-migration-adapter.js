import { executeOperationCostD1Batch } from "./operation-cost-d1-meter.js"
import { OperationCostError } from "../lib/operation-cost-ledger.js"
import {
  COMPACT_DISCOVERY_MIGRATION_NAME,
  COMPACT_DISCOVERY_MIGRATION_STATEMENTS,
} from "../generated/operation-cost-migrations.js"

// The admitted compact-discovery migration is schema and constant singleton
// state only. It neither counts legacy discoveries nor seeds catalog ordinals.
// The bounded executor establishes its denominator from admitted eight-row
// page receipts, so this adapter's measured cost cannot grow with either table.
//
// One bounded schema guard. It accepts at most 1024 existing schema objects
// and proves the v2 tables are not already present. The schema is scanned
// exactly once and capped at 1025 rows, so the guard fails closed on a
// pathological schema instead of reading past its declared bound. The old
// two-statement form declared 256 reads while its guards scanned the schema
// repeatedly; the bound below covers this guard's full accepted range.
export const COMPACT_DISCOVERY_SCHEMA_GUARD = `SELECT CASE
  WHEN COUNT(*) > 1024
  THEN json('COST_MIGRATION_SCHEMA_BOUND_EXCEEDED')
  WHEN SUM(CASE WHEN name IN (
    'icono_discovery_user_state_v2',
    'icono_discovery_shared_state_v2',
    'icono_discovery_ordinals_v2',
    'icono_discovery_compact_activation_v2'
  ) THEN 1 ELSE 0 END) > 0
  THEN json('COST_MIGRATION_SCHEMA_CHANGED')
  ELSE 1 END AS admitted
FROM (SELECT name FROM sqlite_schema LIMIT 1025)`

export function createCompactDiscoveryMigrationCostAdapter({
  db,
  executable_sha256,
  schema_sha256,
}) {
  return {
    resource: "iconoplasm",
    executable_sha256,
    schema_sha256,
    async prepare(args) {
      if (!args || Object.keys(args).length)
        throw new OperationCostError("COST_MIGRATION_ARGUMENTS_INVALID")
      const statements = [
        { sql: COMPACT_DISCOVERY_SCHEMA_GUARD, parameters: [] },
        ...COMPACT_DISCOVERY_MIGRATION_STATEMENTS.map((sql) => ({ sql, parameters: [] })),
        {
          sql: "INSERT INTO d1_migrations (name) VALUES (?)",
          parameters: [COMPACT_DISCOVERY_MIGRATION_NAME],
        },
      ]
      // DDL only: one bounded single-pass schema guard, fifteen
      // schema/singleton statements and the migration receipt. Activation
      // starts with a zero observed denominator; no legacy table is scanned.
      // The guard
      // accepts at most 1024 schema objects and reads at most 1025 schema rows
      // before its cap; the catalog is never read. Increasing an operation's
      // honest reservation inside the existing daily allowance does not change
      // that allowance. Measured: 336 reads at 315 schema objects and 1045
      // reads at the accepted 1024-object ceiling.
      const bound = { rows_read: 1152, rows_written: 64, requests: 1 }
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
      return {
        result: { migration: COMPACT_DISCOVERY_MIGRATION_NAME, applied: true },
        actual,
      }
    },
  }
}
