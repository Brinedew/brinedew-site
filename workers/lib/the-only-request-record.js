// B-1147: THE ONLY per-request record. One line per request says who acted, on
// which route, and what it cost in D1 rows, so a load test (or a viral post)
// can be read as "these people did these things and it cost this much" with
// one query, while it happens. Stripe calls this a canonical log line; Honeycomb
// calls it a wide event.
//
// The line goes to Workers Logs (3 days, queryable within seconds) and, when
// the ICONOPLASM_REQUESTS binding exists, to Workers Analytics Engine (about
// three months, SQL). Cloudflare's own analytics stay the authority for the
// account-wide daily walls; this record is the authority for who and what.
//
// Cost: no extra request, no D1 or KV call. D1 rows come from the receipts
// every statement already returns (meta.rows_read / meta.rows_written).
//
// Privacy: the actor is a keyed hash that changes every UTC day (the
// Plausible pattern), so a person can be counted within a day and never
// followed across days. Signed-in people hash their account id, guests their
// IP and user agent. Neither is stored or logged in the clear.
import { AsyncLocalStorage } from "node:async_hooks"
import { parseCookies, SESSION_COOKIE, unseal } from "./sealed-session.js"

const records = new AsyncLocalStorage()
const D1_BINDINGS = ["DB", "ICONOPLASM_DB", "ICONOPLASM_AUDIT_DB"]
const meteredDatabases = new WeakMap()
const meteredEnvs = new WeakMap()
const RAW = Symbol("raw D1 statement")

function tally(result) {
  const record = records.getStore()
  if (!record) return
  for (const receipt of Array.isArray(result) ? result : [result]) {
    const meta = receipt?.meta
    if (!meta) continue
    record.d1_calls += 1
    if (Number.isFinite(meta.rows_read)) record.rows_read += meta.rows_read
    if (Number.isFinite(meta.rows_written)) record.rows_written += meta.rows_written
  }
}

function meterStatement(statement) {
  return {
    [RAW]: statement,
    bind: (...values) => meterStatement(statement.bind(...values)),
    async all() {
      const result = await statement.all()
      tally(result)
      return result
    },
    async run() {
      const result = await statement.run()
      tally(result)
      return result
    },
    // D1's first() fetches the whole result and keeps its first row, so all()
    // costs the same rows and also returns the receipt first() hides.
    async first(column) {
      if (typeof statement.all !== "function") return statement.first(column)
      const result = await statement.all()
      tally(result)
      const row = result?.results?.[0]
      if (!row) return null
      if (column === undefined) return row
      if (!(column in row)) throw new Error(`D1_COLUMN_NOTFOUND: Column not found (${column})`)
      return row[column]
    },
    raw: (...args) => statement.raw(...args),
  }
}

function meterDatabase(database) {
  if (!database?.prepare) return database
  let metered = meteredDatabases.get(database)
  if (metered) return metered
  metered = new Proxy(database, {
    get(target, property) {
      if (property === "prepare") return (sql) => meterStatement(target.prepare(sql))
      if (property === "batch")
        return async (statements) => {
          const result = await target.batch(statements.map((s) => s?.[RAW] ?? s))
          tally(result)
          return result
        }
      const value = Reflect.get(target, property, target)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
  meteredDatabases.set(database, metered)
  return metered
}

// One metered env per Worker env, so anything that caches by the env or by a
// D1 binding keeps hitting its cache across requests.
export function meteredEnv(env) {
  if (!env || typeof env !== "object") return env
  let metered = meteredEnvs.get(env)
  if (metered) return metered
  // Lazy, so a handler that never opens a database never reads its binding.
  const databases = new Map()
  metered = new Proxy(env, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver)
      if (!value || !D1_BINDINGS.includes(key)) return value
      if (!databases.has(key)) databases.set(key, meterDatabase(value))
      return databases.get(key)
    },
  })
  meteredEnvs.set(env, metered)
  return metered
}

// The route name a handler gives its response (logReq) wins; the rest are
// named by their first path segments, with IDs folded.
export function noteRequestRoute(request, route, { schema = null, extVersion = null } = {}) {
  const record = records.getStore()
  if (!record || record.request !== request) return false
  record.route = route
  record.schema_version = schema
  record.ext_version = extVersion
  return true
}

function fallbackRoute(path) {
  return (
    path
      .split("/")
      .filter(Boolean)
      .slice(0, 5)
      .map((part) => (/[0-9A-Z]|^.{25,}$/.test(part) ? ":id" : part))
      .join("/") || "root"
  )
}

const hmacKeys = new Map()
async function hmacKey(secret) {
  let key = hmacKeys.get(secret)
  if (!key) {
    key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(`iconoplasm.request-actor\n${secret}`),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    )
    hmacKeys.set(secret, key)
  }
  return key
}

async function actorOf(request, env, now) {
  let kind = "guest"
  let identity = `${request.headers.get("CF-Connecting-IP") || ""}\n${request.headers.get("User-Agent") || ""}`
  const cookie = parseCookies(request.headers.get("Cookie"))[SESSION_COOKIE]
  if (cookie) {
    try {
      const session = await unseal(env, cookie, { purpose: "session", now })
      if (session?.user_id) {
        kind = "account"
        identity = `account\n${session.user_id}`
      }
    } catch {}
  }
  const secret = String(env?.SESSION_SECRET || "")
  if (!secret) return { kind, hash: null }
  const day = new Date(now).toISOString().slice(0, 10)
  const mac = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    new TextEncoder().encode(`${day}\n${identity}`),
  )
  const hash = [...new Uint8Array(mac).slice(0, 8)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
  return { kind, hash }
}

// The channel a person came from, when the page they acted on carries one
// (?ref=reddit, ?utm_source=x). Web Analytics counts page views per referrer;
// this ties actions to the same channel.
function channelOf(request) {
  try {
    const referer = new URL(request.headers.get("Referer") || "")
    return (referer.searchParams.get("ref") || referer.searchParams.get("utm_source") || "").slice(
      0,
      40,
    )
  } catch {
    return ""
  }
}

export async function withRequestRecord(request, env, ctx, run) {
  const started = Date.now()
  const record = {
    request,
    route: null,
    schema_version: null,
    ext_version: null,
    d1_calls: 0,
    rows_read: 0,
    rows_written: 0,
  }
  let response
  try {
    response = await records.run(record, () => run(meteredEnv(env)))
    return response
  } finally {
    const write = emit(record, request, env, response?.status ?? 500, started)
    ctx?.waitUntil?.(write)
  }
}

async function emit(record, request, env, status, started) {
  try {
    const url = new URL(request.url)
    const actor = await actorOf(request, env, started)
    const line = {
      service: "iconoplasm",
      route: record.route || fallbackRoute(url.pathname),
      method: request.method,
      status,
      latency_ms: Date.now() - started,
      rows_read: record.rows_read,
      rows_written: record.rows_written,
      d1_calls: record.d1_calls,
      actor: actor.hash,
      actor_kind: actor.kind,
      channel: channelOf(request),
      country: request.cf?.country || "",
      schema_version: record.schema_version,
      ext_version: record.ext_version,
    }
    console.log(JSON.stringify(line))
    env?.ICONOPLASM_REQUESTS?.writeDataPoint({
      indexes: [line.actor || "none"],
      blobs: [
        line.route,
        line.method,
        line.actor_kind,
        line.channel,
        line.country,
        String(line.ext_version || ""),
      ],
      doubles: [line.status, line.latency_ms, line.rows_read, line.rows_written, line.d1_calls],
    })
  } catch (error) {
    console.error(JSON.stringify({ service: "iconoplasm", request_record_error: String(error) }))
  }
}
