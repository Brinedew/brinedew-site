// The admin's activity feed: what people did on the site, newest first, across
// votes, comments, portrait requests and edits, caretaker work, artist
// suggestions and publishing. It is a read for the owner's own page, so it is
// critical (never shed) and is priced in workers/iconoplasm/batch-route-prices.js.
//
// The feed is read in bounded pages from newest-first indexes (migration 0150),
// one query per kind, merged here. Filtering by actor happens in SQL so a page
// full of admin or automated events cannot starve the real people's events.
// The two admin accounts are the owner's: the usernames are the stable label,
// and the IDs are resolved from the users table plus the constants below.
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100
const SITE_ORIGIN = "https://iconoplasm.brinedew.bio"

export const ICONOPLASM_ACTIVITY_ADMIN_NAMES = Object.freeze(["brinedew", "loweren"])

// The owner's two accounts on 2026-11-04's production copy. The usernames above
// are what the owner named; these IDs keep the filter working if a label is
// changed. The configured admin ID joins them.
const ADMIN_IDS = Object.freeze(["1289482311557058641", "177906870516842497"])

const SOURCE_KINDS = Object.freeze([
  "vote",
  "comment",
  "request",
  "edit",
  "caretaker_text",
  "caretaker_supervote",
  "caretaker_request",
  "artist",
  "publish",
])
const KIND_GROUPS = Object.freeze({
  all: SOURCE_KINDS,
  vote: ["vote"],
  comment: ["comment"],
  request: ["request", "edit"],
  edit: ["edit"],
  caretaker: ["caretaker_text", "caretaker_supervote", "caretaker_request"],
  publish: ["publish"],
  artist: ["artist"],
})

const SYSTEM_ACTOR_LABELS = Object.freeze({
  "drain:local": "Drain",
  vote_authority: "Vote authority",
  iconoplasm_workstation: "Workstation",
  manifestation_authority: "Manifestation authority",
  gene_card_materializer: "Card materializer",
  b888_authority_projection: "Authority projection",
  b898_repair_after_bad_republish: "Repair job",
  "react:local": "Workstation",
  cron: "Scheduled job",
  admin_reconciliation: "Admin reconciliation",
  unknown: "Unknown actor",
  local: "Local test",
})

const DIGIT_ID = (column) => `(${column} GLOB '[0-9]*' AND ${column} NOT GLOB '*[^0-9]*')`

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

function booleanParam(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback
  const text = String(value).trim().toLowerCase()
  if (["1", "true", "yes", "on"].includes(text)) return true
  if (["0", "false", "no", "off"].includes(text)) return false
  return fallback
}

function parseBefore(value) {
  const text = String(value || "").trim()
  if (!text) return null
  const parsed = Date.parse(text)
  return Number.isFinite(parsed) ? new Date(parsed) : null
}

function parseKinds(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase()
  if (!raw || raw === "all") return new Set(SOURCE_KINDS)
  const wanted = new Set()
  for (const token of raw.split(",")) {
    const group = KIND_GROUPS[token.trim()]
    if (group) for (const kind of group) wanted.add(kind)
  }
  return wanted.size ? wanted : new Set(SOURCE_KINDS)
}

const PUBLISH_ACTION = /^[a-z0-9_]{1,48}$/

function parsePublishAction(value) {
  const text = String(value || "")
    .trim()
    .toLowerCase()
  return PUBLISH_ACTION.test(text) && text !== "all" ? text : ""
}

// D1 stores CURRENT_TIMESTAMP as "YYYY-MM-DD HH:MM:SS" in UTC, and the newer
// tables as ISO with milliseconds. Each source is compared in its own format so
// its newest-first index still answers the page.
function normalizeTimestamp(value) {
  const text = String(value || "").trim()
  if (!text) return ""
  const parsed = /^\d{4}-\d\d-\d\dT/.test(text)
    ? Date.parse(text)
    : Date.parse(text.replace(" ", "T").replace(/(Z|[+-]\d\d:\d\d)$/, "") + "Z")
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : ""
}

const isoCursor = (date) => (date ? date.toISOString() : null)
const spaceCursor = (date) => (date ? date.toISOString().slice(0, 19).replace("T", " ") : null)

function portraitUrl(assetSha256) {
  const sha = String(assetSha256 || "").toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(sha)) return ""
  return `${SITE_ORIGIN}/portraits/v1/${sha.slice(0, 2)}/${sha}/small.webp`
}

function resolveActorNames(usersDb, discordIds, accountIds) {
  if (!usersDb?.prepare) return Promise.resolve([])
  return usersDb
    .prepare(
      `SELECT discord_id, account_id, username
         FROM users
        WHERE discord_id IN (SELECT value FROM json_each(?))
           OR account_id IN (SELECT value FROM json_each(?))
        LIMIT 200`,
    )
    .bind(JSON.stringify([...discordIds]), JSON.stringify([...accountIds]))
    .all()
    .then((result) => (Array.isArray(result?.results) ? result.results : []))
    .catch(() => [])
}

async function adminIdentity(env) {
  const names = new Set(ICONOPLASM_ACTIVITY_ADMIN_NAMES)
  const discordIds = new Set(ADMIN_IDS)
  const configured = String(env?.ADMIN_DISCORD_USER_ID || "").trim()
  if (configured) discordIds.add(configured)
  const rows = await resolveActorNames(env?.DB, discordIds, new Set())
  const accountIds = new Set()
  for (const row of rows) {
    const username = String(row?.username || "").toLowerCase()
    if (username) names.add(username)
    if (row?.discord_id) discordIds.add(String(row.discord_id))
    if (row?.account_id) accountIds.add(String(row.account_id).toLowerCase())
  }
  const actorValues = [
    ...new Set([...names, ...[...discordIds].map((id) => id.toLowerCase()), ...accountIds]),
  ]
  return { names, actorValues }
}

function adminFilter(column, admins, hideAdmins) {
  if (!hideAdmins || !admins.actorValues.length) return { sql: "", params: [] }
  return {
    sql: ` AND lower(${column}) NOT IN (${admins.actorValues.map(() => "?").join(",")})`,
    params: admins.actorValues,
  }
}

// Publish events carry usernames, opaque IDs and automation names in one column.
// When automated activity is hidden, keep numeric people and the two admin
// usernames; the admin filter above decides whether the admins stay.
function publishSystemFilter(hideSystem, admins) {
  if (!hideSystem) return { sql: "", params: [] }
  const names = [...admins.names]
  return {
    sql: ` AND (${DIGIT_ID("actor")} OR lower(actor) IN (${names.map(() => "?").join(",")}))`,
    params: names,
  }
}

function voteQuery({ cursor, admins, hideAdmins, hideSystem, fetch }) {
  const conditions = []
  const params = []
  if (cursor) {
    conditions.push("updated_at <= ?")
    params.push(cursor)
  }
  if (hideSystem) conditions.push(DIGIT_ID("user_id"))
  const admin = adminFilter("user_id", admins, hideAdmins)
  if (admin.sql) {
    conditions.push(admin.sql.replace(/^ AND /, ""))
    params.push(...admin.params)
  }
  params.push(fetch)
  return {
    sql: `SELECT 'vote' AS kind,
                 gene_symbol || ':' || asset_sha256 || ':' || user_id AS source_id,
                 gene_symbol,
                 user_id AS actor_id,
                 '' AS actor_name,
                 CASE vote_value WHEN 1 THEN 'upvote' ELSE 'downvote' END AS action,
                 '' AS detail,
                 '' AS status,
                 asset_sha256,
                 vision_id,
                 '' AS body,
                 updated_at AS created_at
            FROM icono_image_votes
           WHERE ${conditions.length ? conditions.join(" AND ") : "1 = 1"}
           ORDER BY updated_at DESC
           LIMIT ?`,
    params,
  }
}

function commentQuery({ cursor, admins, hideAdmins, hideSystem, fetch }) {
  const conditions = []
  const params = []
  if (cursor) {
    conditions.push("created_at <= ?")
    params.push(cursor)
  }
  if (hideSystem) conditions.push(DIGIT_ID("user_id"))
  const admin = adminFilter("user_id", admins, hideAdmins)
  if (admin.sql) {
    conditions.push(admin.sql.replace(/^ AND /, ""))
    params.push(...admin.params)
  }
  params.push(fetch)
  return {
    sql: `SELECT 'comment' AS kind,
                 CAST(id AS TEXT) AS source_id,
                 gene_symbol,
                 user_id AS actor_id,
                 COALESCE(username, '') AS actor_name,
                 'commented' AS action,
                 substr(body, 1, 240) AS detail,
                 status,
                 '' AS asset_sha256,
                 '' AS vision_id,
                 body,
                 created_at
            FROM icono_gene_comments
           WHERE ${conditions.length ? conditions.join(" AND ") : "1 = 1"}
           ORDER BY created_at DESC, id DESC
           LIMIT ?`,
    params,
  }
}

function requestQuery({ cursor, admins, hideAdmins, hideSystem, fetch }) {
  const conditions = []
  const params = []
  if (cursor) {
    conditions.push("created_at <= ?")
    params.push(cursor)
  }
  if (hideSystem) conditions.push("request_origin = 'user'")
  const admin = adminFilter("requester_user_id", admins, hideAdmins)
  if (admin.sql) {
    conditions.push(admin.sql.replace(/^ AND /, ""))
    params.push(...admin.params)
  }
  params.push(fetch)
  return {
    sql: `SELECT 'request' AS kind,
                 CAST(id AS TEXT) AS source_id,
                 gene_symbol,
                 requester_user_id AS actor_id,
                 requester_username AS actor_name,
                 CASE request_kind WHEN 'edit_image' THEN 'request_edit' ELSE 'request_new' END AS action,
                 request_mode AS detail,
                 status,
                 source_asset_sha256 AS asset_sha256,
                 requested_vision_id AS vision_id,
                 '' AS body,
                 created_at
            FROM icono_generation_requests
           WHERE ${conditions.length ? conditions.join(" AND ") : "1 = 1"}
           ORDER BY created_at DESC, id DESC
           LIMIT ?`,
    params,
  }
}

function editQuery({ cursor, admins, hideAdmins, hideSystem, fetch }) {
  const conditions = []
  const params = []
  if (cursor) {
    conditions.push("created_at <= ?")
    params.push(cursor)
  }
  if (hideSystem) conditions.push(DIGIT_ID("user_id"))
  const admin = adminFilter("user_id", admins, hideAdmins)
  if (admin.sql) {
    conditions.push(admin.sql.replace(/^ AND /, ""))
    params.push(...admin.params)
  }
  params.push(fetch)
  return {
    sql: `SELECT 'edit' AS kind,
                 id AS source_id,
                 source_gene_symbol AS gene_symbol,
                 user_id AS actor_id,
                 '' AS actor_name,
                 'edited' AS action,
                 status AS detail,
                 status,
                 source_asset_sha256 AS asset_sha256,
                 source_vision_id AS vision_id,
                 '' AS body,
                 created_at
            FROM icono_image_edit_jobs
           WHERE ${conditions.length ? conditions.join(" AND ") : "1 = 1"}
           ORDER BY created_at DESC, id DESC
           LIMIT ?`,
    params,
  }
}

function caretakerTextQuery({ cursor, admins, hideAdmins, fetch }) {
  const conditions = []
  const params = []
  if (cursor) {
    conditions.push("created_at <= ?")
    params.push(cursor)
  }
  const admin = adminFilter("account_id", admins, hideAdmins)
  if (admin.sql) {
    conditions.push(admin.sql.replace(/^ AND /, ""))
    params.push(...admin.params)
  }
  params.push(fetch)
  return {
    sql: `SELECT 'caretaker_text' AS kind,
                 version_id AS source_id,
                 gene_symbol,
                 account_id AS actor_id,
                 '' AS actor_name,
                 'saved' AS action,
                 'version ' || version AS detail,
                 CASE readers_see WHEN 1 THEN 'readers see it' ELSE 'draft' END AS status,
                 '' AS asset_sha256,
                 '' AS vision_id,
                 '' AS body,
                 created_at
            FROM icono_caretaker_text_versions
           WHERE ${conditions.length ? conditions.join(" AND ") : "1 = 1"}
           ORDER BY created_at DESC, version_id DESC
           LIMIT ?`,
    params,
  }
}

function supervoteQuery({ cursor, admins, hideAdmins, fetch }) {
  const conditions = []
  const params = []
  if (cursor) {
    conditions.push("created_at <= ?")
    params.push(cursor)
  }
  const admin = adminFilter("caretaker_account_id", admins, hideAdmins)
  if (admin.sql) {
    conditions.push(admin.sql.replace(/^ AND /, ""))
    params.push(...admin.params)
  }
  params.push(fetch)
  return {
    sql: `SELECT 'caretaker_supervote' AS kind,
                 CAST(id AS TEXT) AS source_id,
                 gene_symbol,
                 caretaker_account_id AS actor_id,
                 '' AS actor_name,
                 event_type AS action,
                 assignment_status AS detail,
                 assignment_status AS status,
                 COALESCE(to_asset_sha256, from_asset_sha256, '') AS asset_sha256,
                 '' AS vision_id,
                 '' AS body,
                 created_at
            FROM icono_caretaker_supervote_events
           WHERE ${conditions.length ? conditions.join(" AND ") : "1 = 1"}
           ORDER BY created_at DESC, id DESC
           LIMIT ?`,
    params,
  }
}

function caretakerRequestQuery({ cursor, admins, hideAdmins, fetch }) {
  const conditions = []
  const params = []
  if (cursor) {
    conditions.push("created_at <= ?")
    params.push(cursor)
  }
  const admin = adminFilter("requester_account_id", admins, hideAdmins)
  if (admin.sql) {
    conditions.push(admin.sql.replace(/^ AND /, ""))
    params.push(...admin.params)
  }
  params.push(fetch)
  return {
    sql: `SELECT 'caretaker_request' AS kind,
                 request_id AS source_id,
                 gene_symbol,
                 requester_account_id AS actor_id,
                 '' AS actor_name,
                 'asked' AS action,
                 status AS detail,
                 status,
                 '' AS asset_sha256,
                 '' AS vision_id,
                 COALESCE(note, '') AS body,
                 created_at
            FROM icono_caretaker_gene_requests
           WHERE ${conditions.length ? conditions.join(" AND ") : "1 = 1"}
           ORDER BY created_at DESC, request_id DESC
           LIMIT ?`,
    params,
  }
}

function artistQuery({ cursor, admins, hideAdmins, hideSystem, fetch }) {
  const conditions = []
  const params = []
  if (cursor) {
    conditions.push("requested_at <= ?")
    params.push(cursor)
  }
  if (hideSystem) conditions.push("requested_by <> ''")
  const admin = adminFilter("requested_by", admins, hideAdmins)
  if (admin.sql) {
    conditions.push(admin.sql.replace(/^ AND /, ""))
    params.push(...admin.params)
  }
  params.push(fetch)
  return {
    sql: `SELECT 'artist' AS kind,
                 CAST(id AS TEXT) AS source_id,
                 '' AS gene_symbol,
                 requested_by AS actor_id,
                 requested_by AS actor_name,
                 'suggested' AS action,
                 artist_name_input AS detail,
                 resolved_status AS status,
                 '' AS asset_sha256,
                 '' AS vision_id,
                 '' AS body,
                 requested_at AS created_at
            FROM icono_artist_blacklist_submissions
           WHERE ${conditions.length ? conditions.join(" AND ") : "1 = 1"}
           ORDER BY requested_at DESC, id DESC
           LIMIT ?`,
    params,
  }
}

function publishQuery({ cursor, admins, hideAdmins, hideSystem, action, fetch }) {
  const conditions = []
  const params = []
  if (cursor) {
    conditions.push("created_at <= ?")
    params.push(cursor)
  }
  const system = publishSystemFilter(hideSystem, admins)
  if (system.sql) {
    conditions.push(system.sql.replace(/^ AND /, ""))
    params.push(...system.params)
  }
  if (action) {
    conditions.push("action = ?")
    params.push(action)
  }
  const admin = adminFilter("actor", admins, hideAdmins)
  if (admin.sql) {
    conditions.push(admin.sql.replace(/^ AND /, ""))
    params.push(...admin.params)
  }
  params.push(fetch)
  return {
    sql: `SELECT 'publish' AS kind,
                 CAST(id AS TEXT) AS source_id,
                 gene_symbol,
                 actor AS actor_id,
                 actor AS actor_name,
                 action,
                 COALESCE(reason, '') AS detail,
                 '' AS status,
                 COALESCE(to_asset_sha256, from_asset_sha256, '') AS asset_sha256,
                 '' AS vision_id,
                 '' AS body,
                 created_at
            FROM icono_publish_events
           WHERE ${conditions.length ? conditions.join(" AND ") : "1 = 1"}
           ORDER BY created_at DESC, id DESC
           LIMIT ?`,
    params,
  }
}

function actorKindFor(row, admins) {
  const id = String(row?.actor_id || "").toLowerCase()
  const name = String(row?.actor_name || "").toLowerCase()
  if (admins.actorValues.includes(id) || admins.names.has(name)) return "admin"
  if (row?.kind === "vote" || row?.kind === "comment" || row?.kind === "edit")
    return /^\d+$/.test(id) ? "person" : "system"
  if (row?.kind === "request") return /^\d+$/.test(id) ? "person" : "system"
  if (row?.kind === "publish") return /^\d+$/.test(id) ? "person" : "system"
  return "person"
}

function actorLabelFor(row, actorKind, users) {
  const raw = String(row?.actor_id || "").trim()
  const lower = raw.toLowerCase()
  const denormalized = String(row?.actor_name || "").trim()
  const person = users.byDiscord.get(lower) || users.byAccount.get(lower) || null
  if (actorKind === "admin")
    return (
      person?.username ||
      (denormalized && !/^\d+$/.test(denormalized) ? denormalized : "") ||
      raw ||
      "Admin"
    )
  if (actorKind === "system")
    return (
      SYSTEM_ACTOR_LABELS[lower] ||
      (/^acct_/.test(lower) ? "Caretaker" : denormalized) ||
      raw ||
      "System"
    )
  if (person?.username) return person.username
  if (denormalized && !/^\d+$/.test(denormalized)) return denormalized
  if (/^\d+$/.test(raw)) return "Removed account"
  if (/^acct_/i.test(raw)) return "Caretaker"
  return raw || "Unknown actor"
}

function normalizeRow(row, admins, users) {
  const actorKind = actorKindFor(row, admins)
  const assetSha = String(row?.asset_sha256 || "").toLowerCase()
  return {
    id: `${String(row?.kind || "event")}:${String(row?.source_id || "")}`,
    kind: String(row?.kind || "event"),
    action: String(row?.action || "event"),
    actor_id: String(row?.actor_id || ""),
    actor: actorLabelFor(row, actorKind, users),
    actor_kind: actorKind,
    gene: String(row?.gene_symbol || "").toUpperCase(),
    status: String(row?.status || ""),
    detail: String(row?.detail || ""),
    body: String(row?.body || ""),
    vision_id: String(row?.vision_id || ""),
    asset_sha256: assetSha,
    small_url: portraitUrl(assetSha),
    created_at: normalizeTimestamp(row?.created_at),
  }
}

export async function listIconoplasmAdminActivity(env, params = {}) {
  if (!env?.ICONOPLASM_DB) throw new TypeError("ICONOPLASM_DB binding is required")
  const limit = Math.min(MAX_LIMIT, positiveInteger(params.limit, DEFAULT_LIMIT))
  const fetch = limit + 1
  const before = parseBefore(params.before)
  const kinds = parseKinds(params.kinds)
  const hideAdmins = booleanParam(params.hideAdmins ?? params.hide_admins, true)
  const hideSystem = booleanParam(params.hideSystem ?? params.hide_system, true)
  const action = parsePublishAction(params.action)
  const admins = await adminIdentity(env)

  const iso = isoCursor(before)
  const space = spaceCursor(before)
  const loaders = []
  const load = ({ sql, params: values }) => {
    loaders.push(
      env.ICONOPLASM_DB.prepare(sql)
        .bind(...values)
        .all()
        .then((result) => (Array.isArray(result?.results) ? result.results : [])),
    )
  }

  if (kinds.has("vote")) load(voteQuery({ cursor: space, admins, hideAdmins, hideSystem, fetch }))
  if (kinds.has("comment"))
    load(commentQuery({ cursor: iso, admins, hideAdmins, hideSystem, fetch }))
  if (kinds.has("request"))
    load(requestQuery({ cursor: space, admins, hideAdmins, hideSystem, fetch }))
  if (kinds.has("edit")) load(editQuery({ cursor: space, admins, hideAdmins, hideSystem, fetch }))
  if (kinds.has("caretaker_text"))
    load(caretakerTextQuery({ cursor: iso, admins, hideAdmins, fetch }))
  if (kinds.has("caretaker_supervote"))
    load(supervoteQuery({ cursor: space, admins, hideAdmins, fetch }))
  if (kinds.has("caretaker_request"))
    load(caretakerRequestQuery({ cursor: iso, admins, hideAdmins, fetch }))
  if (kinds.has("artist"))
    load(artistQuery({ cursor: space, admins, hideAdmins, hideSystem, fetch }))
  if (kinds.has("publish"))
    load(publishQuery({ cursor: space, admins, hideAdmins, hideSystem, action, fetch }))

  const pages = await Promise.all(loaders)
  const raw = pages
    .flat()
    .filter((row) => normalizeTimestamp(row?.created_at))
    .sort((a, b) => {
      const left = normalizeTimestamp(a?.created_at)
      const right = normalizeTimestamp(b?.created_at)
      if (left !== right) return left < right ? 1 : -1
      const idOrder = String(b?.source_id || "").localeCompare(String(a?.source_id || ""))
      if (idOrder !== 0) return idOrder
      return String(b?.kind || "").localeCompare(String(a?.kind || ""))
    })

  const discordIds = new Set()
  const accountIds = new Set()
  for (const row of raw) {
    const id = String(row?.actor_id || "").trim()
    if (!id) continue
    if (/^\d+$/.test(id)) discordIds.add(id)
    else if (/^acct_/i.test(id)) accountIds.add(id.toLowerCase())
  }
  const userRows = await resolveActorNames(env.DB, discordIds, accountIds)
  const users = { byDiscord: new Map(), byAccount: new Map() }
  for (const row of userRows) {
    if (row?.discord_id) users.byDiscord.set(String(row.discord_id).toLowerCase(), row)
    if (row?.account_id) users.byAccount.set(String(row.account_id).toLowerCase(), row)
  }

  const events = raw.slice(0, limit).map((row) => normalizeRow(row, admins, users))
  const people = new Set(
    events.filter((event) => event.actor_kind === "person").map((event) => event.actor_id),
  )
  const last = events[events.length - 1]
  return {
    events,
    next_before: last ? last.created_at : "",
    has_more: raw.length > limit,
    people: people.size,
    hidden: { admins: hideAdmins, system: hideSystem },
    admin_names: [...admins.names],
  }
}
