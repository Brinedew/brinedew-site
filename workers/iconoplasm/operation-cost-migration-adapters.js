import { createMigrationInventoryCostAdapter } from "./operation-cost-migration-inventory.js"
import { createSchemaTableMigrationCostAdapter } from "./operation-cost-schema-table-migration-adapter.js"
import {
  VISION_ROLLUP_DIRTY_MIGRATION_NAME,
  VISION_ROLLUP_DIRTY_MIGRATION_STATEMENTS,
} from "../generated/operation-cost-migrations.js"

// The three inventories read each database's migration journal and schema
// objects for every release. A migration that is pending in production adds its
// adapter here, next to its plan entry in cloudflare/operation-cost-migration-plan.json
// and its reviewed statements in scripts/generate-operation-cost-migrations.mjs.
// All three are deleted in the change after the deploy shows the migration
// applied; the `.sql` file stays.
export function createMigrationOperationCostAdapters(env, identities) {
  return new Map([
    [
      "iconoplasm-migration-0117",
      createSchemaTableMigrationCostAdapter({
        db: env.ICONOPLASM_DB,
        name: VISION_ROLLUP_DIRTY_MIGRATION_NAME,
        statements: VISION_ROLLUP_DIRTY_MIGRATION_STATEMENTS,
        ...identities,
      }),
    ],
    ...[
      ["geneguessr", env.DB],
      ["iconoplasm", env.ICONOPLASM_DB],
      ["iconoplasm-authoring", env.ICONOPLASM_AUTHORING_DB],
    ].map(([resource, db]) => [
      `${resource}-migration-inventory`,
      createMigrationInventoryCostAdapter({ db, resource, ...identities }),
    ]),
  ])
}
