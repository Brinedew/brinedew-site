export const WITHDRAWN_MANIFESTATION_RETENTION_DAYS = 30
export const WITHDRAWN_MANIFESTATION_RETENTION_MS =
  WITHDRAWN_MANIFESTATION_RETENTION_DAYS * 24 * 60 * 60 * 1000

export function withdrawnManifestationPurgeEligibleAt(withdrawnAt) {
  const timestamp = new Date(withdrawnAt)
  if (Number.isNaN(timestamp.getTime())) throw new TypeError("withdrawn_at is invalid")
  return new Date(timestamp.getTime() + WITHDRAWN_MANIFESTATION_RETENTION_MS).toISOString()
}

// ARCHITECTURE FENCE [IPD-012]
