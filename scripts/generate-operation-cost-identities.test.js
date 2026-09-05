import assert from "node:assert/strict"
import test from "node:test"
import { operationCostIdentities } from "./generate-operation-cost-identities.mjs"
import { OPERATION_COST_IDENTITIES } from "../workers/generated/operation-cost-identities.js"
import { assertOperationCostMigrationsCurrent } from "./generate-operation-cost-migrations.mjs"

test("deployed cost identities match the enforcement code and migration set", () => {
  assert.deepEqual(OPERATION_COST_IDENTITIES, operationCostIdentities())
  assert.doesNotThrow(assertOperationCostMigrationsCurrent)
})
