import { pathToFileURL } from "node:url"
import { readAccountBudget, accountBudgetChecks } from "./lib/cloudflare-account-budget.mjs"

export async function checkCloudflareBudget({ usageReader = readAccountBudget } = {}) {
  const usage = await usageReader({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    token: process.env.CLOUDFLARE_API_TOKEN,
    ...(process.env.ICONOPLASM_BUDGET_WATCH_DAY
      ? { day: process.env.ICONOPLASM_BUDGET_WATCH_DAY }
      : {}),
  })
  const checks = accountBudgetChecks(usage)
  const failures = checks.filter((check) => !check.ok)
  const result = { day: usage.day, usage, checks, ok: failures.length === 0 }
  console.log(JSON.stringify(result, null, 2))
  if (failures.length)
    throw new Error(
      `Cloudflare account headroom: ${failures.map((f) => `${f.meter} ${f.used}/${f.limit}`).join(", ")}`,
    )
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkCloudflareBudget().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
