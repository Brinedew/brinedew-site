import { pathToFileURL } from "node:url"

const METERS = ["rows_read", "rows_written", "requests"]
const CAPACITY_URL = "https://iconoplasm.brinedew.bio/api/iconoplasm/admin/cost/operations/capacity"

function requireFresh(sample, time, code) {
  if (
    sample?.day !== new Date(time).toISOString().slice(0, 10) ||
    !Number.isSafeInteger(sample.measured_at) ||
    sample.measured_at > time ||
    time - sample.measured_at > 60_000
  )
    throw new Error(code)
}

// Negative-only sentinel: a pass grants no execution permit. The canonical
// preflight must still inventory pending work, price the complete release,
// and reserve every operation through the existing shared authority.
export async function earlyReleaseCapacitySentinel({
  readState,
  readUsage,
  readCapacity,
  ceilings,
  now = Date.now,
}) {
  const state = await readState()
  if (typeof state?.schema_transition !== "boolean") throw new Error("COST_RELEASE_STATE_INVALID")
  // An already-paused application's zero-D1 readers must remain recoverable
  // when D1 is exhausted. The existing later reader gate owns Worker/KV
  // headroom and re-reads installed state before any reader upload.
  if (state.schema_transition)
    return { mode: "defer-to-existing-reader-recovery", schema_transition: true }

  const usage = await readUsage()
  requireFresh(usage, now(), "COST_ACCOUNT_USAGE_UNAVAILABLE")
  for (const meter of METERS) {
    if (
      !Number.isSafeInteger(ceilings?.[meter]) ||
      ceilings[meter] <= 0 ||
      !Number.isSafeInteger(usage[meter]) ||
      usage[meter] < 0
    )
      throw new Error("COST_ACCOUNT_USAGE_UNAVAILABLE")
    // Leave room for the single capacity GET before spending a Worker request.
    if (usage[meter] >= ceilings[meter] - (meter === "requests" ? 1 : 0))
      throw new Error(`COST_RELEASE_ACCOUNT_HEADROOM: ${meter}`)
  }

  const capacity = await readCapacity()
  const checkedAt = now()
  // A request crossing midnight, or delayed behind the first sample, cannot
  // combine observations from different budget days.
  requireFresh(usage, checkedAt, "COST_ACCOUNT_USAGE_UNAVAILABLE")
  requireFresh(capacity, checkedAt, "COST_SHARED_USAGE_UNAVAILABLE")
  for (const meter of METERS) {
    if (
      !Number.isSafeInteger(capacity.remaining?.[meter]) ||
      capacity.remaining[meter] < 0 ||
      !Number.isSafeInteger(capacity.used?.[meter]) ||
      capacity.used[meter] < 0
    )
      throw new Error("COST_SHARED_USAGE_UNAVAILABLE")
    if (capacity.remaining[meter] === 0) throw new Error(`COST_RELEASE_SHARED_HEADROOM: ${meter}`)
    // Preserve the full uncertain reservation just as the later preflight
    // does. Subtraction avoids overflowing an otherwise valid integer input.
    if (usage[meter] >= ceilings[meter] - capacity.used[meter])
      throw new Error(`COST_RELEASE_ACCOUNT_HEADROOM: ${meter}`)
  }
  return {
    mode: "continue-to-authoritative-preflight",
    schema_transition: false,
    day: capacity.day,
    checked_at: checkedAt,
    account_measured_at: usage.measured_at,
    capacity_measured_at: capacity.measured_at,
    remaining: Object.fromEntries(METERS.map((meter) => [meter, capacity.remaining[meter]])),
  }
}

// This endpoint reads the existing capacity ledger without application D1,
// registration, reservations or refunds. One request, no redirects or retries.
export async function readEarlyReleaseCapacity({ token, fetcher = fetch }) {
  if (!token) throw new Error("COST_OPERATOR_TOKEN_REQUIRED")
  let response
  try {
    response = await fetcher(CAPACITY_URL, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: { "x-iconoplasm-admin-token": token, Accept: "application/json" },
    })
  } catch {
    throw new Error("COST_SHARED_USAGE_UNAVAILABLE")
  }
  if (!response.ok) throw new Error(`COST_SHARED_USAGE_HTTP_${response.status}`)
  try {
    const text = await response.text()
    if (text.length > 65_536) throw new Error("COST_RESPONSE_LIMIT")
    return JSON.parse(text)
  } catch {
    throw new Error("COST_SHARED_USAGE_UNAVAILABLE")
  }
}

async function main() {
  // Lazy imports keep the policy independently testable without production
  // bindings. These existing helpers use Node built-ins and repository JS;
  // the sentinel runs before package installation and never executes DDL.
  const { readIconoplasmReleaseState } = await import("./read-iconoplasm-release-state.mjs")
  const { createOperationCostAccountUsageReader } =
    await import("../workers/iconoplasm/operation-cost-account-usage.js")
  const { ACCOUNT_CEILINGS } = await import("../workers/lib/operation-cost-ledger.js")
  const reader = createOperationCostAccountUsageReader({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    token: process.env.CLOUDFLARE_BUDGET_ANALYTICS_TOKEN,
  })
  const result = await earlyReleaseCapacitySentinel({
    readState: () => readIconoplasmReleaseState(),
    readUsage: () => reader.refresh(),
    readCapacity: () => readEarlyReleaseCapacity({ token: process.env.ICONOPLASM_ADMIN_TOKEN }),
    ceilings: ACCOUNT_CEILINGS,
  })
  console.log(JSON.stringify(result))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message = String(error?.message || "")
    console.error(
      /^COST_[A-Z0-9_]+(?:: (?:rows_read|rows_written|requests))?$/.test(message)
        ? message
        : "COST_EARLY_RELEASE_CHECK_FAILED",
    )
    process.exitCode = 1
  })
}
