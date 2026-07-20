export const ICONOPLASM_OBSERVABILITY_FRESHNESS_POLICY = Object.freeze({
  expectedCadenceMinutes: 60,
  staleAfterMinutes: 90,
  unavailableAfterMinutes: 240,
})

export const ICONOPLASM_RETIRED_OBSERVABILITY_METRICS = Object.freeze([
  Object.freeze({
    id: "application_owned_usage_ledger",
    label: "Application-owned usage ledger",
    state: "retired",
    reason:
      "Retired intentionally: Cloudflare GraphQL and product dashboards are the operational source of truth.",
  }),
])

function validTimestampMs(value) {
  const parsed = Date.parse(String(value || ""))
  return Number.isFinite(parsed) ? parsed : null
}

export function iconoplasmObservabilitySnapshotForAdmin(snapshot, nowMs = Date.now()) {
  const source = snapshot && typeof snapshot === "object" ? snapshot : {}
  const generatedAtMs = validTimestampMs(source.generatedAt)
  const policy = ICONOPLASM_OBSERVABILITY_FRESHNESS_POLICY
  let state = "unavailable"
  let level = "danger"
  let headline = "Snapshot unavailable"
  let ageMinutes = null

  if (generatedAtMs !== null) {
    ageMinutes = Math.max(0, Math.floor((Number(nowMs) - generatedAtMs) / 60000))
    if (ageMinutes <= policy.staleAfterMinutes) {
      state = "fresh"
      level = "ok"
      headline = "Snapshot fresh"
    } else if (ageMinutes <= policy.unavailableAfterMinutes) {
      state = "stale"
      level = "warning"
      headline = "Snapshot stale"
    }
  }

  const detail =
    state === "fresh"
      ? `Baked ${ageMinutes} minute(s) ago; expected hourly.`
      : state === "stale"
        ? `Baked ${ageMinutes} minute(s) ago; older than the ${policy.staleAfterMinutes}-minute freshness SLA.`
        : generatedAtMs === null
          ? "The published snapshot has no valid generated-at timestamp."
          : `Baked ${ageMinutes} minute(s) ago; the scheduled publication path is not healthy.`

  return {
    ...source,
    freshness: {
      state,
      level,
      headline,
      detail,
      ageMinutes,
      generatedAt: generatedAtMs === null ? null : new Date(generatedAtMs).toISOString(),
      policy,
    },
    retiredMetrics: ICONOPLASM_RETIRED_OBSERVABILITY_METRICS,
  }
}
