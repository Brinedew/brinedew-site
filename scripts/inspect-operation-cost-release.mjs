import { createReleaseSender } from "./run-admitted-d1-migrations.mjs"
import { readReleaseOrigin, acquireReleasePlan } from "./operation-cost-release-plan.mjs"
import { pathToFileURL } from "node:url"

// Read-only diagnosis through the same authority: no raw D1/SQL or caller bounds.
// The small schema receipt is independent of a large DDL reservation, so a
// missing/changed prerequisite cannot strand the entire migration allowance.
export async function inspectReleaseSchema({ send, releaseId, now = Date.now() }) {
  const capabilities = await send("", "GET")
  const capacity = await send("/capacity", "GET")
  const schemas = []
  for (const resource of ["geneguessr", "iconoplasm", "iconoplasm-authoring"]) {
    const adapter = capabilities.adapters.find(
      (item) => item.id === `${resource}-migration-inventory`,
    )
    if (!adapter?.query_ids.includes("schema-objects"))
      throw new Error("COST_SCHEMA_INSPECTION_UNAVAILABLE")
    const { plan, stepId } = await acquireReleasePlan({
      releaseId: `${releaseId}-schema`,
      adapter,
      send,
      now,
      features: capabilities.features,
      prediction: { rows_read: 2050, rows_written: 0, requests: 1 },
      identities: {
        executable_sha256: adapter.executable_sha256,
        schema_sha256: adapter.schema_sha256,
      },
    })
    const result = await send("/execute", "POST", {
      operation_id: plan.id,
      step_id: stepId,
      adapter_id: adapter.id,
      arguments: { statements: [{ query_id: "schema-objects", arguments: {} }] },
    })
    const rows = result.result?.[0]?.results
    if (!Array.isArray(rows) || rows.length >= 1025)
      throw new Error("COST_SCHEMA_INSPECTION_TRUNCATED")
    schemas.push({
      resource,
      usage: result.usage,
      object_count: rows.length,
      objects: rows.filter((row) =>
        [
          "icono_gene_catalog",
          "icono_admin_gene_rollup",
          "icono_portrait_assets",
          "icono_admin_dashboard_summary",
          "icono_admin_gallery_count_cache",
          "icono_request_notifications",
          "icono_vote_projection_refresh_jobs",
          "icono_manifestation_snapshot_parts",
          "icono_manifestation_snapshot_leases",
        ].includes(row.name),
      ),
    })
  }
  return { capacity, schemas }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const origin = await readReleaseOrigin({
    repository: process.env.GITHUB_REPOSITORY,
    runId: process.env.GITHUB_RUN_ID,
    token: process.env.GITHUB_TOKEN,
  })
  const result = await inspectReleaseSchema({
    send: createReleaseSender(process.env.ICONOPLASM_ADMIN_TOKEN),
    releaseId: origin.releaseId,
  })
  console.log(JSON.stringify(result))
}
