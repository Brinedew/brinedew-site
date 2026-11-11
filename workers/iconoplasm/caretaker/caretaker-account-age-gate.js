// B-1190: the emergency account-age gate for claiming. Off by default: Discord
// sign-in is the normal barrier, and the owner does not want signup friction.
// When the admin turns it on, an account younger than `min_days` cannot claim a
// gene, and the gene page shows the date it becomes eligible. One KV key, edited
// from the admin panel's Caretakers tab. Every account faces the same rule; there
// are no per-user entitlements.

export const CARETAKER_ACCOUNT_AGE_GATE_KV_KEY = "iconoplasm:caretaker-account-age-gate:v1"
export const CARETAKER_ACCOUNT_AGE_GATE_DEFAULT_DAYS = 7
export const CARETAKER_ACCOUNT_AGE_GATE_MAX_DAYS = 3650
const GATE_CACHE_MS = 60_000

// The claim availability is read on every signed-in gene page view, so the KV
// answer is cached per isolate for a minute. The admin's own write clears the
// cache in the isolate that served it; other isolates catch up within a minute,
// which is the same window KV's own consistency already has.
const gateCache = new WeakMap()

function cacheKey(env) {
  return env && typeof env === "object" ? env : null
}

function validDays(value) {
  const days = Number(value)
  return Number.isInteger(days) && days >= 1 && days <= CARETAKER_ACCOUNT_AGE_GATE_MAX_DAYS
    ? days
    : null
}

export async function readCaretakerAccountAgeGate(env) {
  const key = cacheKey(env)
  if (key) {
    const hit = gateCache.get(key)
    if (hit && Date.now() - hit.at < GATE_CACHE_MS) return hit.value
  }
  let stored = null
  try {
    stored = env?.KV ? await env.KV.get(CARETAKER_ACCOUNT_AGE_GATE_KV_KEY, { type: "json" }) : null
  } catch {
    stored = null
  }
  const days = validDays(stored?.min_days)
  const value = {
    enabled: stored?.enabled === true,
    min_days: days == null ? CARETAKER_ACCOUNT_AGE_GATE_DEFAULT_DAYS : days,
    is_default: !stored,
    updated_at: stored?.updated_at || null,
    updated_by: stored?.updated_by || null,
  }
  if (key) gateCache.set(key, { value, at: Date.now() })
  return value
}

export async function writeCaretakerAccountAgeGate(
  env,
  { enabled, minDays, updatedBy, now = new Date() },
) {
  if (typeof enabled !== "boolean") return { ok: false, error: "enabled must be true or false" }
  const days = validDays(minDays)
  if (days == null) {
    return {
      ok: false,
      error: `min_days must be a whole number from 1 to ${CARETAKER_ACCOUNT_AGE_GATE_MAX_DAYS}`,
    }
  }
  if (!env?.KV) return { ok: false, error: "KV binding missing" }
  const record = {
    enabled,
    min_days: days,
    updated_at: now.toISOString(),
    updated_by: String(updatedBy || "admin"),
  }
  await env.KV.put(CARETAKER_ACCOUNT_AGE_GATE_KV_KEY, JSON.stringify(record))
  const key = cacheKey(env)
  if (key) gateCache.delete(key)
  return { ok: true, ...record, is_default: false }
}

// The claim route's dependency. Answers null while the gate is off; otherwise
// the moment this account becomes old enough to claim. An unreadable creation
// time does not block anyone: the claim route's own account check has already
// read the same row, so a missing date is a schema anomaly, not a verdict.
export function createCaretakerAccountAgePolicy(env) {
  return async function caretakerAccountAgePolicy({ accountId }) {
    const gate = await readCaretakerAccountAgeGate(env)
    if (!gate.enabled) return null
    let createdMs = null
    try {
      const row = env?.DB?.prepare
        ? await env.DB.prepare("SELECT created_at FROM brinedew_accounts WHERE account_id = ?")
            .bind(accountId)
            .first()
        : null
      const value = Number(row?.created_at)
      if (Number.isFinite(value) && value > 0) createdMs = value
    } catch {
      createdMs = null
    }
    if (createdMs == null) return { enabled: true, min_days: gate.min_days, eligible_at: null }
    return {
      enabled: true,
      min_days: gate.min_days,
      eligible_at: new Date(createdMs + gate.min_days * 24 * 60 * 60 * 1000).toISOString(),
    }
  }
}
