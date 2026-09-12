import { pathToFileURL } from "node:url"
import { createOperationCostAccountUsageReader } from "../workers/iconoplasm/operation-cost-account-usage.js"
import {
  readIconoplasmReleaseState,
  requireReaderRecoveryHeadroom,
} from "./read-iconoplasm-release-state.mjs"

export function requireNormalWorkerRepairState(state) {
  if (!state || state.schema_transition || state.reader_recovery)
    throw new Error("COST_WORKER_REPAIR_INCOMPATIBLE_INSTALLED_STATE")
  return state
}

async function main() {
  const state = requireNormalWorkerRepairState(await readIconoplasmReleaseState())
  const reader = createOperationCostAccountUsageReader({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    token: process.env.CLOUDFLARE_BUDGET_ANALYTICS_TOKEN,
  })
  const maximum = requireReaderRecoveryHeadroom(await reader.refresh({ includeKv: true }))
  console.log(JSON.stringify({ ...state, maximum }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(String(error?.message || "COST_WORKER_REPAIR_STATE_UNAVAILABLE"))
    process.exitCode = 1
  })
}
