import { buildAvatarProxyPath } from "./lib/avatar-proxy.js"

const CURRENT_CARETAKER_STATUSES = Object.freeze(["active", "suspended"])
const MAX_PUBLIC_CARETAKER_SYMBOLS = 500

function normalizedSymbol(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
}

function uniqueSymbols(values) {
  const symbols = []
  const seen = new Set()
  for (const value of Array.isArray(values) ? values : []) {
    const symbol = normalizedSymbol(value)
    if (!symbol || seen.has(symbol)) continue
    seen.add(symbol)
    symbols.push(symbol)
    if (symbols.length >= MAX_PUBLIC_CARETAKER_SYMBOLS) break
  }
  return symbols
}

function discordDefaultAvatarUrl(discordId) {
  const subject = String(discordId || "").trim()
  if (!/^\d+$/.test(subject)) return null
  try {
    const index = Number((BigInt(subject) >> 22n) % 6n)
    return `https://cdn.discordapp.com/embed/avatars/${index}.png`
  } catch {
    return null
  }
}

function rowsFrom(result) {
  return Array.isArray(result?.results) ? result.results : []
}

export async function readPublicCaretakers(iconoplasmDb, accountDb, requestedSymbols) {
  const symbols = uniqueSymbols(requestedSymbols)
  if (!symbols.length || !iconoplasmDb || !accountDb) return Object.freeze({})

  const symbolPlaceholders = symbols.map(() => "?").join(", ")
  const assignmentResult = await iconoplasmDb
    .prepare(
      `SELECT canonical_symbol, account_id, authority_event_sequence
         FROM icono_caretaker_assignment_notifications
        WHERE canonical_symbol IN (${symbolPlaceholders})
          AND assignment_status IN (?, ?)
        ORDER BY authority_event_sequence DESC`,
    )
    .bind(...symbols, ...CURRENT_CARETAKER_STATUSES)
    .all()

  const accountBySymbol = new Map()
  for (const row of rowsFrom(assignmentResult)) {
    const symbol = normalizedSymbol(row?.canonical_symbol)
    const accountId = String(row?.account_id || "").trim()
    if (symbol && accountId && !accountBySymbol.has(symbol)) accountBySymbol.set(symbol, accountId)
  }
  const accountIds = Array.from(new Set(accountBySymbol.values()))
  if (!accountIds.length) return Object.freeze({})

  const accountPlaceholders = accountIds.map(() => "?").join(", ")
  const profileResult = await accountDb
    .prepare(
      `SELECT identity.account_id, users.discord_id, users.username, users.avatar_url
         FROM brinedew_account_identities identity
         JOIN users ON users.discord_id = identity.provider_subject
        WHERE identity.provider = 'discord'
          AND identity.account_id IN (${accountPlaceholders})
        ORDER BY identity.last_seen_at DESC`,
    )
    .bind(...accountIds)
    .all()
  const profileByAccount = new Map()
  for (const row of rowsFrom(profileResult)) {
    const accountId = String(row?.account_id || "").trim()
    const username = String(row?.username || "")
      .trim()
      .slice(0, 80)
    if (!accountId || !username || profileByAccount.has(accountId)) continue
    const avatarUrl = buildAvatarProxyPath(
      String(row?.avatar_url || "").trim() || discordDefaultAvatarUrl(row?.discord_id),
    )
    if (!avatarUrl) continue
    profileByAccount.set(
      accountId,
      Object.freeze({
        username,
        avatar_url: avatarUrl,
      }),
    )
  }

  const result = {}
  for (const symbol of symbols) {
    const profile = profileByAccount.get(accountBySymbol.get(symbol))
    if (profile) result[symbol] = profile
  }
  return Object.freeze(result)
}
