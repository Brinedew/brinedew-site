import { createFinalizationMigrationCostAdapter } from "./operation-cost-migration-adapter.js"
import { createAuthoringStreamMigrationCostAdapter } from "./operation-cost-authoring-migration-adapter.js"
import { createMigrationInventoryCostAdapter } from "./operation-cost-migration-inventory.js"

export function createMigrationOperationCostAdapters(env, identities) {
  return new Map([
    ...[
      ["geneguessr", env.DB],
      ["iconoplasm", env.ICONOPLASM_DB],
      ["iconoplasm-authoring", env.ICONOPLASM_AUTHORING_DB],
    ].map(([resource, db]) => [
      `${resource}-migration-inventory`,
      createMigrationInventoryCostAdapter({ db, resource, ...identities }),
    ]),
    [
      "iconoplasm-migration-0094",
      createFinalizationMigrationCostAdapter({ db: env.ICONOPLASM_DB, ...identities }),
    ],
    [
      "iconoplasm-authoring-migration-0012",
      createAuthoringStreamMigrationCostAdapter({ db: env.ICONOPLASM_AUTHORING_DB, ...identities }),
    ],
  ])
}
