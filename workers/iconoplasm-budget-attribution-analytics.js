export const ICONOPLASM_BUDGET_ATTRIBUTION_ANALYTICS_BINDING = "ICONOPLASM_BUDGET_ATTRIBUTION_ANALYTICS"

function safeMetricNumber(value, fallback = 0) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function safeMetricInteger(value, fallback = 0) {
  return Math.trunc(safeMetricNumber(value, fallback))
}

function safeLabel(value, fallback = "") {
  const text = String(value || "").trim()
  return text ? text.slice(0, 255) : fallback
}

function analyticsIndexKey(payload) {
  return [
    safeLabel(payload?.routeFamily, "unknown_route"),
    safeLabel(payload?.sourceClass, "unknown_source"),
    safeLabel(payload?.actorClass, "unknown_actor"),
  ].join("|")
}

export function writeIconoplasmBudgetAttributionDataPoint(env, payload = {}) {
  const binding = env?.[ICONOPLASM_BUDGET_ATTRIBUTION_ANALYTICS_BINDING]
  if (!binding || typeof binding.writeDataPoint !== "function") return false

  try {
    // Analytics Engine accepts ordered arrays, not named columns, so the field
    // order here is part of the data contract. Keep this list in sync with the
    // snapshot SQL queries before changing it.
    binding.writeDataPoint({
      indexes: [analyticsIndexKey(payload)],
      blobs: [
        safeLabel(payload?.cycleKey),
        safeLabel(payload?.routeFamily, "unknown_route"),
        safeLabel(payload?.budgetClass, "unknown_budget_class"),
        safeLabel(payload?.actorClass, "unknown_actor"),
        safeLabel(payload?.sourceClass, "unknown_source"),
        safeLabel(payload?.outcomeClass, "unknown_outcome"),
        safeLabel(payload?.errorCode),
        safeLabel(payload?.requestMethod),
        safeLabel(payload?.limiterStage),
      ],
      doubles: [
        safeMetricInteger(payload?.rowsRead),
        safeMetricInteger(payload?.rowsWritten),
        safeMetricInteger(payload?.queryCount),
        safeMetricInteger(payload?.requestCount),
        safeMetricInteger(payload?.responseStatus),
        safeMetricNumber(payload?.targetDailyPercent, -1),
        safeMetricNumber(payload?.targetRowsWrittenCeiling, -1),
        safeMetricNumber(payload?.rowsWrittenTargetRemaining, -1),
        payload?.targetCapReached ? 1 : 0,
        payload?.telemetryLocked ? 1 : 0,
      ],
    })
    return true
  } catch {
    // Cost attribution is deliberately fire-and-forget. The Worker must never
    // fail a user-visible request because the observability side channel had a
    // bad day.
    return false
  }
}
