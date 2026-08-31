import { sha256Hex } from "../../lib/iconoplasm-manifestation-body-crypto.js"
import { ManifestationAuthorityError, authorityError } from "./manifestation-authority-contract.js"
import { first, requireDatabase } from "./manifestation-authority-repository.js"

const DEFAULT_JSON_LIMIT = 24 * 1024

function jsonResponse(value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      ...extraHeaders,
    },
  })
}

function safeErrorResponse(error) {
  if (error instanceof ManifestationAuthorityError) {
    const status =
      Number.isInteger(error.status) && error.status >= 400 && error.status < 600
        ? error.status
        : 400
    return jsonResponse({ error: { code: error.code } }, status)
  }
  return jsonResponse({ error: { code: "MANIFESTATION_AUTHORITY_INTERNAL_ERROR" } }, 500)
}

function requireStrictSameOriginMutation(request) {
  const originHeader = request.headers.get("origin")
  const fetchSite = request.headers.get("sec-fetch-site")
  if (!originHeader || fetchSite !== "same-origin") {
    throw authorityError("STRICT_SAME_ORIGIN_REQUIRED", "Same-origin browser request required", 403)
  }
  let supplied
  let target
  try {
    supplied = new URL(originHeader)
    target = new URL(request.url)
  } catch {
    throw authorityError("STRICT_SAME_ORIGIN_REQUIRED", "Same-origin browser request required", 403)
  }
  if (supplied.origin !== target.origin || originHeader !== supplied.origin) {
    throw authorityError("STRICT_SAME_ORIGIN_REQUIRED", "Same-origin browser request required", 403)
  }
  const mediaType = String(request.headers.get("content-type") || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase()
  if (mediaType !== "application/json") {
    throw authorityError("JSON_CONTENT_TYPE_REQUIRED", "JSON request body required", 415)
  }
}

async function readBoundedJson(request, maxBytes = DEFAULT_JSON_LIMIT) {
  const declared = Number(request.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw authorityError("REQUEST_BODY_TOO_LARGE", "Request body is too large", 413)
  }
  if (!request.body) throw authorityError("INVALID_JSON_BODY", "JSON request body required")
  const reader = request.body.getReader()
  const chunks = []
  let total = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel("request body limit exceeded")
      throw authorityError("REQUEST_BODY_TOO_LARGE", "Request body is too large", 413)
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  let raw
  let value
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    value = JSON.parse(raw)
  } catch {
    throw authorityError("INVALID_JSON_BODY", "Request body is not valid JSON")
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw authorityError("INVALID_JSON_BODY", "JSON request body must be an object")
  }
  return { raw, value }
}

async function requireBrowserSession(request, env, resolveSession) {
  if (typeof resolveSession !== "function") {
    throw new TypeError("resolveSession dependency is required")
  }
  const session = await resolveSession(request, env)
  const accountId = String(session?.account_id || "").trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(accountId)) {
    throw authorityError("AUTHENTICATION_REQUIRED", "Active session required", 401)
  }
  return { accountId, session }
}

async function requireAuthorityBearer(request, env, authorizeBearer) {
  if (typeof authorizeBearer !== "function") {
    throw new TypeError("Authority bearer authorizer dependency is required")
  }
  const authority = await authorizeBearer(request, env)
  const actorKind = String(authority?.actor_kind || "").trim()
  const actorAccountId = authority?.account_id == null ? null : String(authority.account_id).trim()
  if (
    authority?.authorized !== true ||
    !["administrator", "service", "migration"].includes(actorKind)
  ) {
    throw authorityError("AUTHORITY_BEARER_REQUIRED", "Authority bearer required", 401)
  }
  if (actorAccountId != null && !/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(actorAccountId)) {
    throw authorityError("AUTHORITY_BEARER_REQUIRED", "Authority bearer required", 401)
  }
  return { actorKind, actorAccountId }
}

async function authorityMode(db) {
  requireDatabase(db)
  const row = await first(
    db,
    "SELECT authority_mode FROM icono_authority_state WHERE singleton = 1",
  )
  return String(row?.authority_mode || "shadow")
}

async function requireAuthoritativeMode(db) {
  if ((await authorityMode(db)) !== "authoritative") {
    throw authorityError("AUTHORITY_NOT_ACTIVE", "Manifestation authority is not active", 503)
  }
}

async function commandEnvelope(request, rawBody, body, actorKind, actorAccountId) {
  const commandId = String(body.command_id || "").trim()
  const requestSha256 = await sha256Hex(
    [
      request.method.toUpperCase(),
      new URL(request.url).pathname,
      actorKind,
      actorAccountId || "",
      rawBody,
    ].join("\n"),
  )
  return { commandId, requestSha256, actorKind, actorAccountId }
}

export {
  authorityMode,
  commandEnvelope,
  jsonResponse,
  readBoundedJson,
  requireAuthorityBearer,
  requireAuthoritativeMode,
  requireBrowserSession,
  requireStrictSameOriginMutation,
  safeErrorResponse,
}
