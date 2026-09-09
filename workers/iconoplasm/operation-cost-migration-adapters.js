import { createFinalizationMigrationCostAdapter } from "./operation-cost-migration-adapter.js"
import { createFinalizationJobVersionMigrationCostAdapter } from "./operation-cost-finalization-job-migration-adapter.js"
import { createFinalizationPublicationMigrationCostAdapter } from "./operation-cost-finalization-publication-migration-adapter.js"
import {
  createFinalizationQueueMigrationCostAdapter,
  createFinalizationStatusMigrationCostAdapter,
} from "./operation-cost-finalization-queue-migration-adapter.js"
import { createAuthoringStreamMigrationCostAdapter } from "./operation-cost-authoring-migration-adapter.js"
import { createMigrationInventoryCostAdapter } from "./operation-cost-migration-inventory.js"
import { createUploadReservationMigrationCostAdapter } from "./operation-cost-upload-migration-adapter.js"
import { createLineageAdmissionMigrationCostAdapter } from "./operation-cost-lineage-migration-adapter.js"
import { createSnapshotRetirementMigrationCostAdapter } from "./operation-cost-snapshot-retirement-adapter.js"
import { createVoteJobVersionMigrationCostAdapter } from "./operation-cost-vote-job-migration-adapter.js"
import { createResumableAdminCountsMigrationCostAdapter } from "./operation-cost-admin-seed-adapter.js"
import {
  createInboxCountersMigrationCostAdapter,
  createDeliveryCursorMigrationCostAdapter,
  createAssignmentLookupMigrationCostAdapter,
  createCanonicalLifecycleGuardsMigrationCostAdapter,
} from "./operation-cost-counter-migration-adapters.js"

export function createMigrationOperationCostAdapters(env, identities) {
  return new Map([
    [
      "iconoplasm-migration-0102",
      createFinalizationStatusMigrationCostAdapter({ db: env.ICONOPLASM_DB, ...identities }),
    ],
    [
      "iconoplasm-migration-0101",
      createFinalizationPublicationMigrationCostAdapter({ db: env.ICONOPLASM_DB, ...identities }),
    ],
    [
      "iconoplasm-migration-0100",
      createFinalizationJobVersionMigrationCostAdapter({ db: env.ICONOPLASM_DB, ...identities }),
    ],
    [
      "iconoplasm-migration-0099",
      createFinalizationQueueMigrationCostAdapter({ db: env.ICONOPLASM_DB, ...identities }),
    ],
    [
      "iconoplasm-authoring-migration-0017",
      createCanonicalLifecycleGuardsMigrationCostAdapter({
        db: env.ICONOPLASM_AUTHORING_DB,
        ...identities,
      }),
    ],
    [
      "iconoplasm-migration-0098",
      createVoteJobVersionMigrationCostAdapter({ db: env.ICONOPLASM_DB, ...identities }),
    ],
    [
      "iconoplasm-authoring-migration-0016",
      createAssignmentLookupMigrationCostAdapter({
        db: env.ICONOPLASM_AUTHORING_DB,
        ...identities,
      }),
    ],
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
      createResumableAdminCountsMigrationCostAdapter({
        db: env.ICONOPLASM_DB,
        transition: env.ICONOPLASM_SCHEMA_TRANSITION,
        ...identities,
      }),
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
