import { OperationCostError } from "../lib/operation-cost-ledger.js"
import { createOperationCostD1Adapter } from "./operation-cost-d1-adapter.js"

// These probes share the exact source envelopes used by the pending migrations.
// Check them before reserving DDL; an oversized source must only spend a small,
// read-only observation, not strand an entire migration reservation.
export const MIGRATION_SIZE_PREREQUISITES = [
  {
    migration: "iconoplasm-migration-0102",
    resource: "iconoplasm",
    query: "finalization-status-migration-size",
    table: "icono_sync_finalization_summary WHERE singleton = 1",
    counter: "unfinished_count + completed_count",
    argument: "max_rows",
    maximum: 25000,
  },
  {
    migration: "iconoplasm-migration-0102",
    resource: "iconoplasm",
    query: "finalization-status-unfinished-migration-size",
    table: "icono_sync_finalization_summary WHERE singleton = 1",
    counter: "unfinished_count",
    argument: "max_unfinished",
    maximum: 5000,
  },
  {
    migration: "iconoplasm-migration-0101",
    resource: "iconoplasm",
    query: "finalization-terminal-migration-size",
    table:
      "icono_sync_finalization_jobs INDEXED BY idx_icono_finalization_unfinished WHERE status <> 'completed' AND phase = 'completed'",
    argument: "max_terminal",
    maximum: 5000,
  },
  {
    migration: "iconoplasm-migration-0099",
    resource: "iconoplasm",
    query: "finalization-migration-size",
    table: "icono_sync_finalization_jobs",
    argument: "max_rows",
    maximum: 25000,
  },
  {
    migration: "iconoplasm-migration-0099",
    resource: "iconoplasm",
    query: "finalization-unfinished-migration-size",
    table:
      "icono_sync_finalization_jobs INDEXED BY idx_icono_finalization_unfinished WHERE status <> 'completed'",
    argument: "max_unfinished",
    maximum: 5000,
  },
  {
    migration: "iconoplasm-migration-0096",
    resource: "iconoplasm",
    query: "notifications-migration-size",
    table: "icono_request_notifications",
    argument: "max_notifications",
    maximum: 3000,
  },
  {
    migration: "iconoplasm-authoring-migration-0016",
    resource: "iconoplasm-authoring",
    query: "assignments-migration-size",
    table: "icono_caretaker_assignments",
    argument: "max_assignments",
    maximum: 1000,
  },
]

// The built-in migration table is read through its integer primary key. No
// provider admin credential is required by deployment clients to inspect it.
export function createMigrationInventoryCostAdapter({ db, resource, ...identities }) {
  return createOperationCostD1Adapter({
    db,
    resource,
    ...identities,
    registry: new Map([
      ...MIGRATION_SIZE_PREREQUISITES.filter((item) => item.resource === resource).map((item) => [
        item.query,
        {
          sql: item.counter
            ? `SELECT ${item.counter} AS capped_count FROM ${item.table}`
            : `SELECT COUNT(*) AS capped_count FROM (SELECT 1 FROM ${item.table} LIMIT ${item.maximum + 1})`,
          prepare(args) {
            if (args && Object.keys(args).length)
              throw new OperationCostError("COST_QUERY_ARGUMENTS_INVALID")
            return {
              parameters: [],
              rows_read: item.counter ? 1 : 2 * (item.maximum + 1),
              rows_written: 0,
            }
          },
        },
      ]),
      ...(resource === "iconoplasm"
        ? [
            ["catalog", "icono_gene_catalog", 20001],
            ["rollup", "icono_admin_gene_rollup", 20001],
            ["assets", "icono_portrait_assets", 50001],
          ].map(([name, table, limit]) => [
            `${name}-migration-size`,
            {
              sql: `SELECT COUNT(*) AS capped_count FROM (SELECT 1 FROM ${table} LIMIT ${limit})`,
              prepare(args) {
                if (args && Object.keys(args).length)
                  throw new OperationCostError("COST_QUERY_ARGUMENTS_INVALID")
                return { parameters: [], rows_read: 2 * limit, rows_written: 0 }
              },
            },
          ])
        : []),
      [
        "schema-objects",
        {
          // Cap the source scan itself. ORDER BY/filtering before LIMIT could
          // scan an arbitrarily larger schema. The operator rejects truncation.
          // Release prerequisites need object identities, never complete DDL.
          // Counter trigger bodies can exceed the transport's response budget.
          sql: "SELECT name, type FROM sqlite_schema LIMIT 1025",
          prepare(args) {
            if (args && Object.keys(args).length)
              throw new OperationCostError("COST_QUERY_ARGUMENTS_INVALID")
            return { parameters: [], rows_read: 2050, rows_written: 0 }
          },
        },
      ],
      [
        "applied-migrations",
        {
          sql: "SELECT id, name FROM d1_migrations ORDER BY id LIMIT 513",
          prepare(args) {
            if (args && Object.keys(args).length)
              throw new OperationCostError("COST_QUERY_ARGUMENTS_INVALID")
            return { parameters: [], rows_read: 1026, rows_written: 0 }
          },
        },
      ],
    ]),
  })
}
