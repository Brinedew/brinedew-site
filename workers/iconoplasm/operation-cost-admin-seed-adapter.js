import { OperationCostError } from "../lib/operation-cost-ledger.js"
import { executeOperationCostD1Batch } from "./operation-cost-d1-meter.js"
import {
  ADMIN_COUNTS_SEED_PHASES as seed,
  ADMIN_COUNTS_MIGRATION_NAME,
  ADMIN_COUNTS_MIGRATION_STATEMENTS,
} from "../generated/operation-cost-migrations.js"

// Chesterton's fence: source-size guards protected the daily budget, but a
// whole-table seed stranded recovery when real assets exceeded 50,000. Each
// replacement step scans at most 1,024 source rows by rowid, atomically commits
// aggregate totals plus its cursor, and reserves through the same authority.
// Application writes must stay paused until the final counters/triggers/journal
// commit together. No source rows or application payloads are duplicated.
export function createResumableAdminCountsMigrationCostAdapter({
  db,
  transition,
  executable_sha256,
  schema_sha256,
}) {
  return {
    migration_protocol: "admin-count-seed-v1",
    resource: "iconoplasm",
    executable_sha256,
    schema_sha256,
    async prepare(args) {
      if (transition !== "1") throw new OperationCostError("COST_MIGRATION_REQUIRES_QUIESCENCE")
      if (
        !args ||
        Object.keys(args).join() !== "phase" ||
        !["initialize", "catalog", "rollup", "assets", "finish"].includes(args.phase)
      )
        throw new OperationCostError("COST_MIGRATION_ARGUMENTS_INVALID")
      const phase = args.phase
      // A completed migration must be discovered through its journal, never
      // reinitialized with new freeze triggers after a lost final response.
      const sql =
        phase === "initialize"
          ? [...seed.initialize]
          : [
              `SELECT CASE WHEN (SELECT phase FROM icono_admin_counts_seed_progress WHERE id=1)='${phase}' AND (SELECT seed_identity FROM icono_admin_counts_seed_progress WHERE id=1)='${seed.identity}' THEN 1 ELSE json('COST_MIGRATION_PHASE_CHANGED') END`,
              ...(phase === "finish"
                ? [
                    ...seed.finish,
                    ...ADMIN_COUNTS_MIGRATION_STATEMENTS.filter((value) =>
                      value.startsWith("CREATE TRIGGER"),
                    ),
                    `INSERT INTO d1_migrations(name) VALUES ('${ADMIN_COUNTS_MIGRATION_NAME}')`,
                    seed.complete,
                  ]
                : [seed.pages[phase]]),
            ]
      if (phase === "initialize" || phase === "finish")
        sql.unshift(
          "SELECT CASE WHEN (SELECT COUNT(*) FROM (SELECT 1 FROM sqlite_schema LIMIT 513)) <= 512 THEN 1 ELSE json('COST_MIGRATION_SCHEMA_BOUND_EXCEEDED') END",
        )
      if (phase === "initialize")
        sql.unshift(
          `SELECT CASE WHEN EXISTS(SELECT 1 FROM d1_migrations WHERE name='${ADMIN_COUNTS_MIGRATION_NAME}') THEN json('COST_MIGRATION_ALREADY_APPLIED') ELSE 1 END`,
        )
      if (phase === "initialize")
        sql.push(
          `SELECT CASE WHEN (SELECT seed_identity FROM icono_admin_counts_seed_progress WHERE id=1)='${seed.identity}' THEN 1 ELSE json('COST_MIGRATION_SEED_IDENTITY_CHANGED') END`,
        )
      sql.push(phase === "finish" ? "SELECT 'complete' AS phase" : seed.status)
      const statements = sql.map((value) => ({ sql: value, parameters: [] }))
      // Page source + indexed join cursor visits + aggregate/progress reads.
      // DDL phases retain the existing schema envelope; pages perform no DDL.
      const bound = {
        rows_read: phase === "initialize" || phase === "finish" ? 33024 : 4 * seed.size + 128,
        rows_written: phase === "finish" ? 128 : phase === "initialize" ? 16 : 2,
        requests: 1,
      }
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify({ statements, executable_sha256, schema_sha256 })),
      )
      return {
        statements,
        bound,
        sha256: Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join(""),
      }
    },
    async dispatch(prepared) {
      const { result, actual } = await executeOperationCostD1Batch(db, prepared)
      const phase = result.at(-1)?.results?.[0]?.phase
      if (!["catalog", "rollup", "assets", "finish", "complete"].includes(phase))
        throw new OperationCostError("COST_MIGRATION_PROGRESS_INVALID")
      return {
        result: {
          migration: ADMIN_COUNTS_MIGRATION_NAME,
          applied: phase === "complete",
          next_phase: phase,
        },
        actual,
      }
    },
  }
}
