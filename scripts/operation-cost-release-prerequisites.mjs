import { MIGRATION_SIZE_PREREQUISITES } from "../workers/iconoplasm/operation-cost-migration-inventory.js"
import { acquireReleasePlan } from "./operation-cost-release-plan.mjs"

export function migrationSizePrerequisites(pending) {
  return MIGRATION_SIZE_PREREQUISITES.filter((probe) => {
    const migration = pending.find((item) => item.adapter_id === probe.migration)
    if (!migration) return false
    if (migration.arguments?.[probe.argument] !== probe.maximum)
      throw new Error("COST_MIGRATION_PREREQUISITE_ENVELOPE_CHANGED")
    return true
  }).map((probe) => ({
    ...probe,
    adapter_id: `${probe.resource}-migration-inventory`,
    prediction: { rows_read: probe.maximum + 1, rows_written: 0, requests: 1 },
    arguments: { statements: [{ query_id: probe.query, arguments: {} }] },
  }))
}

export async function inspectMigrationSizes({ pending, capabilities, send, releaseId, now }) {
  const evidence = []
  for (const probe of migrationSizePrerequisites(pending)) {
    const adapter = capabilities.adapters.find((item) => item.id === probe.adapter_id)
    if (!adapter?.query_ids?.includes(probe.query))
      throw new Error("COST_MIGRATION_PREREQUISITE_UNAVAILABLE")
    const { plan, stepId } = await acquireReleasePlan({
      releaseId: `${releaseId}-sizes`,
      adapter,
      prediction: probe.prediction,
      send,
      now,
      features: capabilities.features,
      identities: {
        executable_sha256: adapter.executable_sha256,
        schema_sha256: adapter.schema_sha256,
      },
    })
    const receipt = await send("/execute", "POST", {
      operation_id: plan.id,
      step_id: stepId,
      adapter_id: adapter.id,
      arguments: probe.arguments,
    })
    const rows = receipt.result?.[0]?.results
    const count = rows?.[0]?.capped_count
    if (!Array.isArray(rows) || rows.length !== 1 || !Number.isSafeInteger(count) || count < 0)
      throw new Error("COST_MIGRATION_PREREQUISITE_INVALID")
    if (count > probe.maximum)
      throw new Error(`COST_MIGRATION_SOURCE_TOO_LARGE: ${probe.migration}`)
    evidence.push({
      migration: probe.migration,
      count,
      maximum: probe.maximum,
      usage: receipt.usage,
    })
  }
  return evidence
}
