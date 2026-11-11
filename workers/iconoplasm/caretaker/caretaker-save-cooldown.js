// B-1190: how long a caretaker waits between saves of caretaker text. One KV
// key, edited from the admin panel's Caretakers tab, with a 10-second default
// while the key is unset. A save inside the window is refused with 429 and the
// panel keeps the draft and retries; the server reserves the slot atomically in
// icono_caretaker_save_throttle, so two racing saves cannot both pass.
//
// The cooldown bounds one identity's share of the D1 write wall. It is not a
// daily quota and it never grows per user: every account waits the same time,
// and the admin changes it for everyone at once.

export const CARETAKER_SAVE_COOLDOWN_KV_KEY = "iconoplasm:caretaker-save-cooldown:v1"
export const CARETAKER_SAVE_COOLDOWN_DEFAULT_SECONDS = 10
export const CARETAKER_SAVE_COOLDOWN_MAX_SECONDS = 3600

function validSeconds(value) {
  const seconds = Number(value)
  return Number.isInteger(seconds) && seconds >= 0 && seconds <= CARETAKER_SAVE_COOLDOWN_MAX_SECONDS
    ? seconds
    : null
}

export async function readCaretakerSaveCooldown(env) {
  let stored = null
  try {
    stored = env?.KV ? await env.KV.get(CARETAKER_SAVE_COOLDOWN_KV_KEY, { type: "json" }) : null
  } catch {
    stored = null
  }
  const seconds = validSeconds(stored?.seconds)
  return seconds == null
    ? { seconds: CARETAKER_SAVE_COOLDOWN_DEFAULT_SECONDS, is_default: true }
    : {
        seconds,
        is_default: false,
        updated_at: stored.updated_at || null,
        updated_by: stored.updated_by || null,
      }
}

export async function writeCaretakerSaveCooldown(env, { seconds, updatedBy, now = new Date() }) {
  const value = validSeconds(seconds)
  if (value == null) {
    return {
      ok: false,
      error: `seconds must be a whole number from 0 to ${CARETAKER_SAVE_COOLDOWN_MAX_SECONDS}`,
    }
  }
  if (!env?.KV) return { ok: false, error: "KV binding missing" }
  const record = {
    seconds: value,
    updated_at: now.toISOString(),
    updated_by: String(updatedBy || "admin"),
  }
  await env.KV.put(CARETAKER_SAVE_COOLDOWN_KV_KEY, JSON.stringify(record))
  return { ok: true, ...record, is_default: false }
}

// Reserves the account's next save slot in one statement. Answers null when the
// save may run; otherwise the moment the account may save again. The conditional
// UPDATE is the check: an existing row newer than the cutoff changes nothing, and
// two racing saves end with one winner.
export async function reserveCaretakerSaveSlot(db, { accountId, at, seconds }) {
  if (!(seconds > 0)) return null
  const nowMs = Date.parse(at)
  if (!Number.isFinite(nowMs)) return null
  const cutoff = new Date(nowMs - seconds * 1000).toISOString()
  const result = await db
    .prepare(
      `INSERT INTO icono_caretaker_save_throttle (account_id, last_save_at)
       VALUES (?1, ?2)
       ON CONFLICT(account_id) DO UPDATE SET last_save_at = excluded.last_save_at
       WHERE icono_caretaker_save_throttle.last_save_at <= ?3`,
    )
    .bind(accountId, at, cutoff)
    .run()
  if (Number(result?.meta?.changes || 0) === 1) return null
  const row = await db
    .prepare("SELECT last_save_at FROM icono_caretaker_save_throttle WHERE account_id = ?")
    .bind(accountId)
    .first()
  const availableMs = Date.parse(row?.last_save_at || "") + seconds * 1000
  if (!Number.isFinite(availableMs)) return { available_at: null, retry_after_seconds: seconds }
  return {
    available_at: new Date(availableMs).toISOString(),
    retry_after_seconds: Math.max(1, Math.ceil((availableMs - nowMs) / 1000)),
  }
}
