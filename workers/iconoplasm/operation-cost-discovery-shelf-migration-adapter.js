import { OperationCostError } from "../lib/operation-cost-ledger.js"
import { executeOperationCostD1Batch } from "./operation-cost-d1-meter.js"
import {
  DISCOVERY_USER_SHELF_MIGRATION_NAME,
  DISCOVERY_USER_SHELF_MIGRATION_STATEMENTS,
} from "../generated/operation-cost-migrations.js"

// Each sealed chronology chunk holds at most 64 events (DISCOVERY_CHUNK_EVENTS)
// and each user's unsealed tail fewer than 64 more.
const EVENTS_PER_CHUNK = 64
// Measured on production D1 on 2026-09-28 with the backfill's own SELECT:
// 15,276 events (224 chunks, 38 users) cost 69,362 rows read, 4.54 per event
// (json_each, the grouped fold and its sort all count). 6 keeps a third of
// headroom over the measurement.
const ROWS_READ_PER_EVENT = 6

export function discoveryShelfSchemaGuard() {
  return `SELECT CASE
  WHEN (SELECT COUNT(*) FROM (SELECT 1 FROM sqlite_schema LIMIT 1025)) > 1024
    THEN json('COST_MIGRATION_SCHEMA_BOUND_EXCEEDED')
  WHEN (SELECT COUNT(*) FROM pragma_table_info('icono_discovery_user_state_v2')
        WHERE name IN ('shelf_json', 'shelf_state_version')) <> 0
    THEN json('COST_MIGRATION_DISCOVERY_SHELF_SHAPE_CHANGED')
  WHEN (SELECT COUNT(*) FROM pragma_table_info('icono_discovery_chronology_v2')
        WHERE name = 'events_json') <> 1
    THEN json('COST_MIGRATION_DISCOVERY_SHELF_PREREQUISITE_MISSING')
  ELSE 1 END AS admitted`
}

// B-887 migration 0111: two constant-default ADD COLUMNs (schema only, no row
// rewrite) and one UPDATE that folds every user's chronology into their shelf.
// The guards refuse a database past max_users / max_chunks, so the bound below
// holds: ROWS_READ_PER_EVENT per event plus the chunk, user, guard and schema
// rows; one written row per user plus the migration record.
export function createDiscoveryShelfMigrationCostAdapter({ db, executable_sha256, schema_sha256 }) {
  return {
    resource: "iconoplasm",
    migration_protocol: "one-migration-per-release-v1",
    executable_sha256,
    schema_sha256,
    async prepare(args) {
      if (
        !args ||
        Object.keys(args).sort().join() !== "max_chunks,max_users" ||
        !Number.isSafeInteger(args.max_users) ||
        args.max_users < 1 ||
        args.max_users > 500 ||
        !Number.isSafeInteger(args.max_chunks) ||
        args.max_chunks < 1 ||
        args.max_chunks > 1000
      )
        throw new OperationCostError("COST_MIGRATION_ARGUMENTS_INVALID")
      const statements = [
        { sql: discoveryShelfSchemaGuard(), parameters: [] },
        {
          sql: `SELECT CASE
  WHEN (SELECT COUNT(*) FROM (SELECT 1 FROM icono_discovery_user_state_v2 LIMIT ?)) > ?
    THEN json('COST_MIGRATION_ROW_BOUND_EXCEEDED')
  WHEN (SELECT COUNT(*) FROM (SELECT 1 FROM icono_discovery_chronology_v2 LIMIT ?)) > ?
    THEN json('COST_MIGRATION_ROW_BOUND_EXCEEDED')
  ELSE 1 END AS admitted`,
          parameters: [args.max_users + 1, args.max_users, args.max_chunks + 1, args.max_chunks],
        },
        ...DISCOVERY_USER_SHELF_MIGRATION_STATEMENTS.map((sql) => ({ sql, parameters: [] })),
        {
          sql: "INSERT INTO d1_migrations (name) VALUES (?)",
          parameters: [DISCOVERY_USER_SHELF_MIGRATION_NAME],
        },
      ]
      const events = (args.max_chunks + args.max_users) * EVENTS_PER_CHUNK
      const bound = {
        rows_read:
          ROWS_READ_PER_EVENT * events + 2 * (args.max_chunks + args.max_users) + 1024 + 256,
        rows_written: args.max_users + 64,
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
      return { result: { migration: DISCOVERY_USER_SHELF_MIGRATION_NAME, applied: true }, actual }
    },
  }
}
