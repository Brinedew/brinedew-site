import { OperationCostError } from "../lib/operation-cost-ledger.js"
import { executeOperationCostD1Batch } from "./operation-cost-d1-meter.js"
import {
  GENE_BLOT_BACKLOG_WATERMARK_MIGRATION_NAME,
  GENE_BLOT_BACKLOG_WATERMARK_MIGRATION_STATEMENTS,
} from "../generated/operation-cost-migrations.js"

// 0112 creates the one-row watermark table the workstation blot backlog reads
// (B-898 Stage 1, step B). Schema only: one sqlite_schema row and the journal
// row; no data table is touched and no row is seeded (the backlog's first
// poll starts at the newest publish event by itself). The CREATE rescans
// sqlite_schema (about 360 rows on 2026-09-26), so the bound allows a few full
// passes over the admitted 512-row schema.
export function createGeneBlotBacklogWatermarkMigrationCostAdapter({
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
        Object.keys(args).join() !== "max_schema_rows" ||
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
        ...GENE_BLOT_BACKLOG_WATERMARK_MIGRATION_STATEMENTS.map((sql) => ({
          sql,
          parameters: [],
        })),
        {
          sql: "INSERT INTO d1_migrations(name) VALUES (?)",
          parameters: [GENE_BLOT_BACKLOG_WATERMARK_MIGRATION_NAME],
        },
      ]
      const bound = {
        rows_read: 4 * args.max_schema_rows + 256,
        rows_written: 16,
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
      return {
        result: { migration: GENE_BLOT_BACKLOG_WATERMARK_MIGRATION_NAME, applied: true },
        actual,
      }
    },
  }
}
