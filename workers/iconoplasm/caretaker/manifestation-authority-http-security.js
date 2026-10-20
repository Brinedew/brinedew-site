import { ManifestationAuthorityError, authorityError } from "./manifestation-authority-contract.js"
import { IconoplasmSessionUnavailableError } from "../session-user.js"

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
  if (error instanceof IconoplasmSessionUnavailableError) {
    return jsonResponse({ error: { code: error.code } }, 503, {
      "Retry-After": String(error.retryAfter),
    })
  }
  if (error instanceof ManifestationAuthorityError) {
    const status =
      Number.isInteger(error.status) && error.status >= 400 && error.status < 600
        ? error.status
        : 400
    const retry = Number.isInteger(error.retryAfterSeconds) ? error.retryAfterSeconds : null
    // Every authority error's message is a sentence written for the person on the
    // page ("This gene's caretaker changed; refresh the gene page"), never an
    // internal; without it the page could only show the code in capitals.
    return jsonResponse(
      {
        error: { code: error.code, message: error.message },
        ...(retry ? { retry_after_seconds: retry } : {}),
      },
      status,
      retry ? { "Retry-After": String(retry) } : {},
    )
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

export {
  jsonResponse,
  readBoundedJson,
  requireBrowserSession,
  requireStrictSameOriginMutation,
  safeErrorResponse,
}
