import { createFinalizationMigrationCostAdapter } from "./operation-cost-migration-adapter.js"
import { createAuthoringStreamMigrationCostAdapter } from "./operation-cost-authoring-migration-adapter.js"
import { createMigrationInventoryCostAdapter } from "./operation-cost-migration-inventory.js"
import { createUploadReservationMigrationCostAdapter } from "./operation-cost-upload-migration-adapter.js"
import { createLineageAdmissionMigrationCostAdapter } from "./operation-cost-lineage-migration-adapter.js"
import { createSnapshotRetirementMigrationCostAdapter } from "./operation-cost-snapshot-retirement-adapter.js"
import {
  createAdminCountsMigrationCostAdapter,
  createInboxCountersMigrationCostAdapter,
  createDeliveryCursorMigrationCostAdapter,
} from "./operation-cost-counter-migration-adapters.js"

export function createMigrationOperationCostAdapters(env, identities) {
  return new Map([
    [
      "iconoplasm-migration-0097",
      createDeliveryCursorMigrationCostAdapter({ db: env.ICONOPLASM_DB, ...identities }),
    ],
    [
      "iconoplasm-authoring-migration-0015",
      createSnapshotRetirementMigrationCostAdapter({
        db: env.ICONOPLASM_AUTHORING_DB,
        ...identities,
      }),
    ],
    [
      "iconoplasm-migration-0095",
      createAdminCountsMigrationCostAdapter({ db: env.ICONOPLASM_DB, ...identities }),
    ],
    [
      "iconoplasm-migration-0096",
      createInboxCountersMigrationCostAdapter({ db: env.ICONOPLASM_DB, ...identities }),
    ],
    [
      "iconoplasm-authoring-migration-0014",
      createLineageAdmissionMigrationCostAdapter({
        db: env.ICONOPLASM_AUTHORING_DB,
        ...identities,
      }),
    ],
    [
      "iconoplasm-authoring-migration-0013",
      createUploadReservationMigrationCostAdapter({
        db: env.ICONOPLASM_AUTHORING_DB,
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
