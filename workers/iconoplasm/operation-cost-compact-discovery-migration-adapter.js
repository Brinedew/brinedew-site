import { executeOperationCostD1Batch } from "./operation-cost-d1-meter.js"
import { OperationCostError } from "../lib/operation-cost-ledger.js"
import {
  COMPACT_DISCOVERY_MIGRATION_NAME,
  COMPACT_DISCOVERY_MIGRATION_STATEMENTS,
} from "../generated/operation-cost-migrations.js"

// The admitted compact-discovery migration is schema and singleton state only.
// Ordinals are appended on demand by the bounded dictionary resolver, so this
// adapter never seeds one row per catalog gene and its measured cost does not
// grow with catalog size.
//
// Guards: a bounded schema count and proof that the target table is not
// already present, so a partially applied or replayed migration fails closed
// before the first DDL instead of half-applying over live state.
export const COMPACT_DISCOVERY_SCHEMA_GUARD = `SELECT CASE WHEN
  (SELECT COUNT(*) FROM (SELECT 1 FROM sqlite_schema LIMIT 1025)) <= 1024 THEN 1
  ELSE json('COST_MIGRATION_SCHEMA_BOUND_EXCEEDED') END AS admitted`

export const COMPACT_DISCOVERY_INSTALLED_GUARD = `SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM sqlite_schema WHERE name = 'icono_discovery_user_state_v2'
) THEN 1 ELSE json('COST_MIGRATION_SCHEMA_CHANGED') END AS admitted`

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
        { sql: COMPACT_DISCOVERY_INSTALLED_GUARD, parameters: [] },
        ...COMPACT_DISCOVERY_MIGRATION_STATEMENTS.map((sql) => ({ sql, parameters: [] })),
        {
          sql: "INSERT INTO d1_migrations (name) VALUES (?)",
          parameters: [COMPACT_DISCOVERY_MIGRATION_NAME],
        },
      ]
      // DDL only: two bounded schema guards, twelve schema/singleton statements
      // and the migration receipt. Measured natively at 19,023 catalog rows:
      // 49 reads / 23 writes. The bound reserves a wider margin but is still
      // independent of catalog size because the replacement performs no
      // catalog work.
      const bound = { rows_read: 256, rows_written: 64, requests: 1 }
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
