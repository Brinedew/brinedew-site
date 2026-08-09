import {
  ICONOPLASM_EXTENSION_BLOCKLIST_LIMITS,
  ICONOPLASM_EXTENSION_BLOCKLIST_MAX_REQUEST_BYTES,
  ICONOPLASM_EXTENSION_BLOCKLIST_SCHEMA_VERSION,
  IconoplasmExtensionBlocklistPolicyError,
  iconoplasmExtensionBlocklistPublicationState,
  publishIconoplasmExtensionBlocklistPolicy,
  readAuthoritativePublishedIconoplasmExtensionBlocklist,
  readIconoplasmExtensionBlocklistPolicy,
  saveIconoplasmExtensionBlocklistPolicy,
  validateIconoplasmExtensionBlocklistAgainstPublishedScanner,
} from "./iconoplasm-extension-blocklist-policy.js"

const NO_STORE = Object.freeze({ "Cache-Control": "no-store" })
const JSON_MEDIA_TYPE = "application/json"

function assertServices(services) {
  for (const name of ["actor", "isAdmin", "json"]) {
    if (typeof services?.[name] !== "function") {
      throw new TypeError(`Iconoplasm admin extension-blocklist service is missing: ${name}`)
    }
  }
}

function publicPolicy(policy) {
  return {
    schema_version: ICONOPLASM_EXTENSION_BLOCKLIST_SCHEMA_VERSION,
    revision: policy.revision,
    version: policy.version,
    terms: [...policy.terms],
    updated_at: policy.updated_at,
    updated_by: policy.updated_by,
  }
}

function trustedMutationOrigin(rawOrigin) {
  const value = String(rawOrigin || "").trim()
  if (!value) return true
  let url
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.pathname !== "/" || url.search || url.hash) return false
  const hostname = url.hostname.toLowerCase()
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return url.protocol === "http:" || url.protocol === "https:"
  }
  return (
    url.protocol === "https:" && (hostname === "brinedew.bio" || hostname.endsWith(".brinedew.bio"))
  )
}

function mutationAdmissionError(request) {
  if (
    String(request.headers.get("Sec-Fetch-Site") || "")
      .trim()
      .toLowerCase() === "cross-site"
  ) {
    return {
      code: "cross_site_request_forbidden",
      error: "Cross-site extension blocklist mutations are forbidden",
      status: 403,
    }
  }
  if (!trustedMutationOrigin(request.headers.get("Origin"))) {
    return {
      code: "untrusted_origin",
      error: "Extension blocklist mutation origin is not trusted",
      status: 403,
    }
  }
  const mediaType = String(request.headers.get("Content-Type") || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase()
  if (mediaType !== JSON_MEDIA_TYPE) {
    return {
      code: "application_json_required",
      error: "Content-Type must be application/json",
      status: 415,
    }
  }
  return null
}

async function readBoundedJson(request) {
  const declaredLength = Number(request.headers.get("Content-Length"))
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > ICONOPLASM_EXTENSION_BLOCKLIST_MAX_REQUEST_BYTES
  ) {
    throw Object.assign(new Error("Request body is too large"), {
      code: "extension_blocklist_request_too_large",
      status: 413,
    })
  }
  const reader = request.body?.getReader()
  if (!reader) {
    throw Object.assign(new Error("Invalid JSON"), { code: "invalid_json", status: 400 })
  }
  const chunks = []
  let totalBytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    totalBytes += value.byteLength
    if (totalBytes > ICONOPLASM_EXTENSION_BLOCKLIST_MAX_REQUEST_BYTES) {
      await reader.cancel("request_too_large").catch(() => {})
      throw Object.assign(new Error("Request body is too large"), {
        code: "extension_blocklist_request_too_large",
        status: 413,
      })
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
  } catch {
    throw Object.assign(new Error("Invalid JSON"), { code: "invalid_json", status: 400 })
  }
}

function responsePayload(policy, projection, extra = {}) {
  return {
    ...extra,
    policy: publicPolicy(policy),
    publication: iconoplasmExtensionBlocklistPublicationState(policy, projection),
    limits: ICONOPLASM_EXTENSION_BLOCKLIST_LIMITS,
  }
}

async function currentPayload(env, extra = {}) {
  const policy = await readIconoplasmExtensionBlocklistPolicy(env.ICONOPLASM_DB)
  const projection = await readAuthoritativePublishedIconoplasmExtensionBlocklist(env.KV)
  return responsePayload(policy, projection, extra)
}

export function createIconoplasmAdminExtensionBlocklistHandlers(services) {
  assertServices(services)
  const { actor, isAdmin, json } = services

  async function handle({ request, env, done }) {
    if (request.method === "POST") {
      const admissionError = mutationAdmissionError(request)
      if (admissionError) {
        return done(
          `admin_extension_blocklist_${admissionError.status}`,
          json(
            {
              error: admissionError.error,
              code: admissionError.code,
              limits: ICONOPLASM_EXTENSION_BLOCKLIST_LIMITS,
            },
            admissionError.status,
            NO_STORE,
          ),
        )
      }
    }
    if (!(await isAdmin(request, env))) {
      return done(
        "admin_extension_blocklist_403",
        json(
          {
            error: "Unauthorized",
            code: "unauthorized",
            limits: ICONOPLASM_EXTENSION_BLOCKLIST_LIMITS,
          },
          403,
          NO_STORE,
        ),
      )
    }
    if (!env.ICONOPLASM_DB) {
      return done(
        "admin_extension_blocklist_500",
        json(
          {
            error: "ICONOPLASM_DB binding missing",
            code: "iconoplasm_db_binding_missing",
            limits: ICONOPLASM_EXTENSION_BLOCKLIST_LIMITS,
          },
          500,
          NO_STORE,
        ),
      )
    }
    if (!env.KV) {
      return done(
        "admin_extension_blocklist_500",
        json(
          {
            error: "KV binding missing",
            code: "kv_binding_missing",
            limits: ICONOPLASM_EXTENSION_BLOCKLIST_LIMITS,
          },
          500,
          NO_STORE,
        ),
      )
    }

    if (request.method === "GET" || request.method === "HEAD") {
      try {
        return done(
          "admin_extension_blocklist",
          json(await currentPayload(env, { ok: true }), 200, NO_STORE),
        )
      } catch (error) {
        const status = Number(error?.status) || 500
        return done(
          `admin_extension_blocklist_${status}`,
          json(
            {
              error: String(error?.message || error),
              code: String(error?.code || "extension_blocklist_read_failed"),
              limits: ICONOPLASM_EXTENSION_BLOCKLIST_LIMITS,
            },
            status,
            NO_STORE,
          ),
        )
      }
    }

    let body
    let policySaved = false
    try {
      body = await readBoundedJson(request)
    } catch (error) {
      const status = Number(error?.status) || 400
      return done(
        `admin_extension_blocklist_${status}`,
        json(
          {
            error: String(error?.message || "Invalid JSON"),
            code: String(error?.code || "invalid_json"),
            limits: ICONOPLASM_EXTENSION_BLOCKLIST_LIMITS,
          },
          status,
          NO_STORE,
        ),
      )
    }
    if (!Number.isSafeInteger(body?.expected_revision) || body.expected_revision < 1) {
      return done(
        "admin_extension_blocklist_428",
        json(
          {
            error: "expected_revision must be a positive integer",
            code: "expected_revision_required",
            limits: ICONOPLASM_EXTENSION_BLOCKLIST_LIMITS,
          },
          428,
          NO_STORE,
        ),
      )
    }

    try {
      const loadedPolicy = await readIconoplasmExtensionBlocklistPolicy(env.ICONOPLASM_DB)
      if (loadedPolicy.revision !== body.expected_revision) {
        throw new IconoplasmExtensionBlocklistPolicyError(
          "extension_blocklist_revision_conflict",
          "Extension blocklist changed since it was loaded",
          409,
          { current: loadedPolicy },
        )
      }
      const terms = await validateIconoplasmExtensionBlocklistAgainstPublishedScanner(
        env.KV,
        body?.terms,
      )
      const saved = await saveIconoplasmExtensionBlocklistPolicy(env.ICONOPLASM_DB, {
        terms,
        expectedRevision: body.expected_revision,
        actor: await actor(request, env),
      })
      policySaved = true
      const published = await publishIconoplasmExtensionBlocklistPolicy(env.ICONOPLASM_DB, env.KV)
      if (published.busy) {
        return done(
          "admin_extension_blocklist_503",
          json(
            responsePayload(published.policy, published.projection, {
              ok: false,
              changed: saved.changed,
              saved: true,
              policy_saved: true,
              error: "Policy was saved; another publication is already in progress",
              code: "extension_blocklist_projection_busy",
            }),
            503,
            NO_STORE,
          ),
        )
      }
      return done(
        "admin_extension_blocklist",
        json(
          responsePayload(published.policy, published.projection, {
            ok: true,
            changed: saved.changed,
            republished: !saved.changed && published.changed,
          }),
          200,
          NO_STORE,
        ),
      )
    } catch (error) {
      const status =
        error instanceof IconoplasmExtensionBlocklistPolicyError
          ? error.status
          : Number(error?.status) || 500
      const invalidTerms = Array.isArray(error?.details?.invalid_terms)
        ? { invalid_terms: error.details.invalid_terms }
        : {}
      const base = {
        ok: false,
        error: String(error?.message || error),
        code: String(error?.code || "extension_blocklist_update_failed"),
        ...(policySaved ? { saved: true, policy_saved: true } : {}),
        ...invalidTerms,
      }
      try {
        const payload = await currentPayload(env, base)
        return done(`admin_extension_blocklist_${status}`, json(payload, status, NO_STORE))
      } catch {
        return done(
          `admin_extension_blocklist_${status}`,
          json({ ...base, limits: ICONOPLASM_EXTENSION_BLOCKLIST_LIMITS }, status, NO_STORE),
        )
      }
    }
  }

  return Object.freeze({
    "admin_extension_blocklist.policy": handle,
  })
}
