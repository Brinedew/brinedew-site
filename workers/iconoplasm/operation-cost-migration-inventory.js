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
