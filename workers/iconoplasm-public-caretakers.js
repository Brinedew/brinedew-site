import { buildAvatarProxyPath, sanitizeDiscordAvatarUrl } from "./lib/avatar-proxy.js"

const CURRENT_CARETAKER_STATUSES = Object.freeze(["active", "suspended"])
const MAX_PUBLIC_CARETAKER_SYMBOLS = 500
const D1_BIND_CHUNK_SIZE = 100

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

function chunks(values) {
  const result = []
  for (let offset = 0; offset < values.length; offset += D1_BIND_CHUNK_SIZE) {
    result.push(values.slice(offset, offset + D1_BIND_CHUNK_SIZE))
  }
  return result
}

export async function readPublicCaretakers(iconoplasmDb, accountDb, requestedSymbols) {
  const symbols = uniqueSymbols(requestedSymbols)
  if (!symbols.length || !iconoplasmDb || !accountDb) return Object.freeze({})

  const assignmentResults = await Promise.all(
    chunks(symbols).map((symbolChunk) =>
      iconoplasmDb
        .prepare(
          // The open-role filter matches the partial unique index on gene_symbol.
          `SELECT gene_symbol AS canonical_symbol, account_id, status
             FROM icono_caretaker_assignments
            WHERE gene_symbol IN (${symbolChunk.map(() => "?").join(", ")})
              AND status IN ('pending_acceptance', 'active', 'suspended')`,
        )
        .bind(...symbolChunk)
        .all(),
    ),
  )

  const accountBySymbol = new Map()
  for (const assignmentResult of assignmentResults) {
    for (const row of rowsFrom(assignmentResult)) {
      const symbol = normalizedSymbol(row?.canonical_symbol)
      const accountId = String(row?.account_id || "").trim()
      if (!CURRENT_CARETAKER_STATUSES.includes(row?.status)) continue
      if (symbol && accountId && !accountBySymbol.has(symbol)) {
        accountBySymbol.set(symbol, accountId)
      }
    }
  }
  const accountIds = Array.from(new Set(accountBySymbol.values()))
  if (!accountIds.length) return Object.freeze({})

  const profileResults = await Promise.all(
    chunks(accountIds).map((accountChunk) =>
      accountDb
        .prepare(
          `SELECT identity.account_id, users.discord_id, users.username, users.avatar_url
             FROM brinedew_account_identities identity
             JOIN users ON users.discord_id = identity.provider_subject
            WHERE identity.provider = 'discord'
              AND identity.account_id IN (${accountChunk.map(() => "?").join(", ")})
            ORDER BY identity.last_seen_at DESC`,
        )
        .bind(...accountChunk)
        .all(),
    ),
  )
  const profileByAccount = new Map()
  for (const profileResult of profileResults) {
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
  }

  const result = {}
  for (const symbol of symbols) {
    const profile = profileByAccount.get(accountBySymbol.get(symbol))
    if (profile) result[symbol] = profile
  }
  return Object.freeze(result)
}

// B-1098: the /caretakers directory. One account holds at most one open gene
// (the unique open index on account_id), so this is one row per caretaker. The
// open-role filter is the partial indexes' own WHERE, so the read touches only
// open rows, never the ended history. Pictures are Discord's own URLs, so the
// directory costs no /api/avatar request per face.
export const CARETAKER_DIRECTORY_LIMIT = 2000

export async function readCaretakerDirectory(iconoplasmDb, accountDb) {
  if (!iconoplasmDb || !accountDb) return []
  const assignments = rowsFrom(
    await iconoplasmDb
      .prepare(
        `SELECT gene_symbol, account_id, status, started_at
           FROM icono_caretaker_assignments
          WHERE status IN ('pending_acceptance', 'active', 'suspended')
          LIMIT ?`,
      )
      .bind(CARETAKER_DIRECTORY_LIMIT)
      .all(),
  ).filter((row) => CURRENT_CARETAKER_STATUSES.includes(row?.status))
  const accountIds = Array.from(
    new Set(assignments.map((row) => String(row?.account_id || "").trim()).filter(Boolean)),
  )
  if (!accountIds.length) return []

  const profileByAccount = new Map()
  for (const accountChunk of chunks(accountIds)) {
    const result = await accountDb
      .prepare(
        `SELECT identity.account_id, users.discord_id, users.username, users.avatar_url
           FROM brinedew_account_identities identity
           JOIN users ON users.discord_id = identity.provider_subject
          WHERE identity.provider = 'discord'
            AND identity.account_id IN (${accountChunk.map(() => "?").join(", ")})
          ORDER BY identity.last_seen_at DESC`,
      )
      .bind(...accountChunk)
      .all()
    for (const row of rowsFrom(result)) {
      const accountId = String(row?.account_id || "").trim()
      const username = String(row?.username || "")
        .trim()
        .slice(0, 80)
      if (!accountId || !username || profileByAccount.has(accountId)) continue
      profileByAccount.set(accountId, {
        username,
        avatar_url:
          sanitizeDiscordAvatarUrl(String(row?.avatar_url || "").trim()) ||
          discordDefaultAvatarUrl(row?.discord_id),
      })
    }
  }

  const directory = []
  for (const row of assignments) {
    const symbol = normalizedSymbol(row?.gene_symbol)
    const profile = profileByAccount.get(String(row?.account_id || "").trim())
    if (!symbol || !profile) continue
    directory.push({
      username: profile.username,
      avatar_url: profile.avatar_url,
      symbol,
      since: String(row?.started_at || "").slice(0, 10) || null,
    })
  }
  directory.sort((a, b) => a.symbol.localeCompare(b.symbol))
  return directory
}
