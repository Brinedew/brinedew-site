import { OperationCostError } from "../lib/operation-cost-ledger.js"
import { createOperationCostD1Adapter } from "./operation-cost-d1-adapter.js"

// The built-in migration table is read through its integer primary key. No
// provider admin credential is required by deployment clients to inspect it.
export function createMigrationInventoryCostAdapter({ db, resource, ...identities }) {
  return createOperationCostD1Adapter({
    db,
    resource,
    ...identities,
    registry: new Map([
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
          sql: "SELECT name, type, sql FROM sqlite_schema LIMIT 1025",
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
