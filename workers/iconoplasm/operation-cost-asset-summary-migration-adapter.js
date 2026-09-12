import { OperationCostError } from "../lib/operation-cost-ledger.js"
import { executeOperationCostD1Batch } from "./operation-cost-d1-meter.js"
import {
  ASSET_SUMMARY_MIGRATION_NAME,
  ASSET_SUMMARY_MIGRATION_STATEMENTS,
} from "../generated/operation-cost-migrations.js"

// These are admission envelopes, not estimates of today's production data.
// Catalog lookups use its unique gene key and do not enumerate the catalog.
const maxima = {
  max_assets: 100000,
  max_audit_rows: 50000,
  max_publish_rows: 25000,
  max_audit_days: 2048,
  max_schema_rows: 512,
}

export function createAssetSummaryMigrationCostAdapter({ db, executable_sha256, schema_sha256 }) {
  return {
    resource: "iconoplasm",
    migration_protocol: "one-migration-per-release-v1",
    executable_sha256,
    schema_sha256,
    async prepare(args) {
      if (
        !args ||
        Object.keys(args).sort().join() !== Object.keys(maxima).sort().join() ||
        Object.entries(maxima).some(
          ([key, maximum]) =>
            !Number.isSafeInteger(args[key]) || args[key] < 1 || args[key] > maximum,
        )
      )
        throw new OperationCostError("COST_MIGRATION_ARGUMENTS_INVALID")
      const tables = [
        ["icono_portrait_assets", args.max_assets],
        ["icono_storage_audit_queue", args.max_audit_rows],
        ["icono_publish_state", args.max_publish_rows],
      ]
      const statements = [
        {
          sql: `SELECT CASE WHEN (SELECT COUNT(*) FROM (SELECT 1 FROM sqlite_schema LIMIT ?)) <= ?
          THEN 1 ELSE json('COST_MIGRATION_SCHEMA_BOUND_EXCEEDED') END AS admitted`,
          parameters: [args.max_schema_rows + 1, args.max_schema_rows],
        },
      ]
      for (const [table, maximum] of tables)
        statements.push({
          sql: `SELECT CASE WHEN (SELECT COUNT(*) FROM (SELECT 1 FROM ${table} LIMIT ?)) <= ?
          THEN 1 ELSE json('COST_MIGRATION_ROW_BOUND_EXCEEDED') END AS admitted`,
          parameters: [maximum + 1, maximum],
        })
      // This conservative guard includes orphan queue rows as well. It bounds
      // seed writes without depending on an asset-history join or wall clock.
      statements.push({
        sql: `SELECT CASE WHEN (SELECT COUNT(*) FROM (
          SELECT DISTINCT date(last_audited_at) FROM icono_storage_audit_queue
          WHERE audit_state<>'unknown' AND datetime(last_audited_at) IS NOT NULL LIMIT ?
        )) <= ? THEN 1 ELSE json('COST_MIGRATION_AUDIT_DAY_BOUND_EXCEEDED') END AS admitted`,
        parameters: [args.max_audit_days + 1, args.max_audit_days],
      })
      statements.push(
        ...ASSET_SUMMARY_MIGRATION_STATEMENTS.map((sql) => ({ sql, parameters: [] })),
        {
          sql: "INSERT INTO d1_migrations(name) VALUES (?)",
          parameters: [ASSET_SUMMARY_MIGRATION_NAME],
        },
      )
      const bound = {
        // Source guards + asset/catalog probes + queue/asset probes + age
        // grouping and bounded calendar rollups. Include schema/DDL visits.
        rows_read:
          4 * (args.max_assets + 1) +
          9 * (args.max_audit_rows + 1) +
          3 * (args.max_publish_rows + 1) +
          4 * (args.max_audit_days + 1) +
          64 * args.max_schema_rows +
          256,
        // Three indexed calendar tables, at most one row per source day in
        // each. Summary, schema and journal rows are included separately.
        rows_written: 6 * args.max_audit_days + 64,
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
      return { result: { migration: ASSET_SUMMARY_MIGRATION_NAME, applied: true }, actual }
    },
  }
}
