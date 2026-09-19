import { OperationCostError } from "../lib/operation-cost-ledger.js"
import { executeOperationCostD1Batch } from "./operation-cost-d1-meter.js"
import {
  COMPACT_DISCOVERY_ACTIVATION_MIGRATION_NAME,
  COMPACT_DISCOVERY_ACTIVATION_MIGRATION_STATEMENTS,
} from "../generated/operation-cost-migrations.js"

export const COMPACT_DISCOVERY_ACTIVATION_SCHEMA_GUARD = `SELECT CASE
  WHEN (SELECT COUNT(*) FROM (SELECT 1 FROM sqlite_schema LIMIT 1025)) > 1024
    THEN json('COST_MIGRATION_SCHEMA_BOUND_EXCEEDED')
  WHEN EXISTS (SELECT 1 FROM sqlite_schema WHERE type='table' AND name='icono_discovery_compact_activation_v2')
   AND (
     SELECT COUNT(*) <> 11 OR
       SUM(CASE WHEN name='singleton' AND upper(type)='INTEGER' AND pk=1 THEN 1 ELSE 0 END) <> 1 OR
       SUM(CASE WHEN name='status' AND upper(type)='TEXT' AND \"notnull\"=1 THEN 1 ELSE 0 END) <> 1 OR
       SUM(CASE WHEN name IN ('cursor_user_id','cursor_gene_symbol','lease_token','lease_until','updated_at') AND upper(type)='TEXT' AND \"notnull\"=1 THEN 1 ELSE 0 END) <> 5 OR
       SUM(CASE WHEN name IN ('total_legacy_rows','migrated_rows','migrated_users') AND upper(type)='INTEGER' AND \"notnull\"=1 THEN 1 ELSE 0 END) <> 3 OR
       SUM(CASE WHEN name='completed_at' AND upper(type)='TEXT' AND \"notnull\"=0 THEN 1 ELSE 0 END) <> 1
     FROM pragma_table_info('icono_discovery_compact_activation_v2')
   ) THEN json('COST_MIGRATION_COMPACT_DISCOVERY_ACTIVATION_SHAPE_CHANGED')
  ELSE 1 END AS admitted`

export function createCompactDiscoveryActivationMigrationCostAdapter({
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
        { sql: COMPACT_DISCOVERY_ACTIVATION_SCHEMA_GUARD, parameters: [] },
        ...COMPACT_DISCOVERY_ACTIVATION_MIGRATION_STATEMENTS.map((sql) => ({
          sql,
          parameters: [],
        })),
        {
          sql: "INSERT INTO d1_migrations (name) VALUES (?)",
          parameters: [COMPACT_DISCOVERY_ACTIVATION_MIGRATION_NAME],
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
      return {
        result: { migration: COMPACT_DISCOVERY_ACTIVATION_MIGRATION_NAME, applied: true },
        actual,
      }
    },
  }
}
