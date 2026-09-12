import { OperationCostError } from "../lib/operation-cost-ledger.js"
import { executeOperationCostD1Batch } from "./operation-cost-d1-meter.js"
import {
  BLACKLIST_LOOKUP_MIGRATION_NAME,
  BLACKLIST_LOOKUP_MIGRATION_STATEMENTS,
} from "../generated/operation-cost-migrations.js"

// At most 5,000 new index entries fit alongside 0104's 12,352-write
// reservation inside the existing 18,000-write operator target. This is a
// release admission envelope, not an estimate of the live blacklist size.
export function createBlacklistLookupMigrationCostAdapter({
  db,
  executable_sha256,
  schema_sha256,
}) {
  return {
    resource: "iconoplasm",
    migration_protocol: "one-migration-per-release-v1",
    executable_sha256,
    schema_sha256,
    async prepare(args) {
      if (
        !args ||
        Object.keys(args).sort().join() !== "max_rows,max_schema_rows" ||
        !Number.isSafeInteger(args.max_rows) ||
        args.max_rows < 1 ||
        args.max_rows > 5000 ||
        !Number.isSafeInteger(args.max_schema_rows) ||
        args.max_schema_rows < 1 ||
        args.max_schema_rows > 512
      )
        throw new OperationCostError("COST_MIGRATION_ARGUMENTS_INVALID")
      const statements = [
        {
          sql: "SELECT CASE WHEN (SELECT COUNT(*) FROM (SELECT 1 FROM sqlite_schema LIMIT ?)) <= ? THEN 1 ELSE json('COST_MIGRATION_SCHEMA_BOUND_EXCEEDED') END AS admitted",
          parameters: [args.max_schema_rows + 1, args.max_schema_rows],
        },
        {
          sql: "SELECT CASE WHEN (SELECT COUNT(*) FROM (SELECT 1 FROM icono_artist_style_blacklist LIMIT ?)) <= ? THEN 1 ELSE json('COST_MIGRATION_ROW_BOUND_EXCEEDED') END AS admitted",
          parameters: [args.max_rows + 1, args.max_rows],
        },
        ...BLACKLIST_LOOKUP_MIGRATION_STATEMENTS.map((sql) => ({ sql, parameters: [] })),
        {
          sql: "INSERT INTO d1_migrations(name) VALUES (?)",
          parameters: [BLACKLIST_LOOKUP_MIGRATION_NAME],
        },
      ]
      const bound = {
        rows_read: 2 * (args.max_rows + 1) + 16 * args.max_schema_rows + 256,
        rows_written: args.max_rows + 32,
        requests: 1,
      }
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify({ statements, executable_sha256, schema_sha256 })),
      )
      return {
        statements,
        bound,
        sha256: Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join(""),
      }
    },
    async dispatch(prepared) {
      const { actual } = await executeOperationCostD1Batch(db, prepared)
      return { result: { migration: BLACKLIST_LOOKUP_MIGRATION_NAME, applied: true }, actual }
    },
  }
}
