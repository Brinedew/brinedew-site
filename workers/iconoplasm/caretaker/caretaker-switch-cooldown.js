// B-1021: how long a caretaker waits before taking another gene, whether by
// switching or by ending one role and claiming a new one. This module owns the
// setting: one KV key, edited from the admin panel's Caretakers tab, with a
// 15-minute default while the key is unset. The site admin account
// (ADMIN_DISCORD_USER_ID, the same rule as the admin panel) is exempt.
// The caretaker claim route reads it only for accounts that have held a gene.

export const CARETAKER_SWITCH_COOLDOWN_KV_KEY = "iconoplasm:caretaker-switch-cooldown:v1"
export const CARETAKER_SWITCH_COOLDOWN_DEFAULT_MINUTES = 15
export const CARETAKER_SWITCH_COOLDOWN_MAX_MINUTES = 7 * 24 * 60

function validMinutes(value) {
  const minutes = Number(value)
  return Number.isInteger(minutes) &&
    minutes >= 0 &&
    minutes <= CARETAKER_SWITCH_COOLDOWN_MAX_MINUTES
    ? minutes
    : null
}

export async function readCaretakerSwitchCooldown(env) {
  let stored = null
  try {
    stored = env?.KV ? await env.KV.get(CARETAKER_SWITCH_COOLDOWN_KV_KEY, { type: "json" }) : null
  } catch {
    stored = null
  }
  const minutes = validMinutes(stored?.minutes)
  return minutes == null
    ? { minutes: CARETAKER_SWITCH_COOLDOWN_DEFAULT_MINUTES, is_default: true }
    : {
        minutes,
        is_default: false,
        updated_at: stored.updated_at || null,
        updated_by: stored.updated_by || null,
      }
}

export async function writeCaretakerSwitchCooldown(env, { minutes, updatedBy, now = new Date() }) {
  const value = validMinutes(minutes)
  if (value == null) {
    return {
      ok: false,
      error: `minutes must be a whole number from 0 to ${CARETAKER_SWITCH_COOLDOWN_MAX_MINUTES}`,
    }
  }
  if (!env?.KV) return { ok: false, error: "KV binding missing" }
  const record = {
    minutes: value,
    updated_at: now.toISOString(),
    updated_by: String(updatedBy || "admin"),
  }
  await env.KV.put(CARETAKER_SWITCH_COOLDOWN_KV_KEY, JSON.stringify(record))
  return { ok: true, ...record, is_default: false }
}

export function isCaretakerSwitchCooldownExempt(env, session) {
  const adminId = String(env?.ADMIN_DISCORD_USER_ID || "").trim()
  return Boolean(adminId) && String(session?.user_id || "").trim() === adminId
}

export function createCaretakerSwitchPolicy(env) {
  return async function caretakerSwitchPolicy(session) {
    if (isCaretakerSwitchCooldownExempt(env, session)) return { seconds: 0, exempt: true }
    const { minutes } = await readCaretakerSwitchCooldown(env)
    return { seconds: minutes * 60, exempt: false }
  }
}
