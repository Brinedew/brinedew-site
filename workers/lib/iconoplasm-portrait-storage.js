import {
  BUNNY_READ_AFTER_WRITE_DELAYS_MS,
  putBunnyObjectUntilVerified,
} from "./bunny-storage-consistency.js"

// ARCHITECTURE FENCE [IPD-001]
// This module is the only authority for portrait object-store configuration,
// request retry, and server-side read-source selection. Keep browser source
// selection in the shared delivery core, but do not recreate Storage-vs-CDN
// fallback logic in routes, notification senders, or maintenance jobs.

function joinUrl(base, key) {
  const normalizedBase = String(base || "").replace(/\/+$/, "")
  const normalizedKey = String(key || "").replace(/^\/+/, "")
  return `${normalizedBase}/${normalizedKey}`
}

export function externalPortraitCdnBase(env) {
  const raw = String(
    env?.ICONOPLASM_EXTERNAL_PORTRAIT_CDN_BASE_URL || env?.ICONOPLASM_PORTRAIT_CDN_BASE_URL || "",
  ).trim()
  return raw ? raw.replace(/\/+$/, "") : ""
}

export function externalPortraitStorageZone(env) {
  return String(env?.ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_ZONE || "").trim()
}

export function externalPortraitStorageHost(env) {
  return (
    String(env?.ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_HOST || "").trim() || "storage.bunnycdn.com"
  )
}

export function externalPortraitStoragePassword(env) {
  return String(env?.ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD || "").trim()
}

export function canReadExternalPortraitStorage(env) {
  return Boolean(
    (externalPortraitStorageZone(env) &&
      externalPortraitStorageHost(env) &&
      externalPortraitStoragePassword(env)) ||
    externalPortraitCdnBase(env),
  )
}

export function canWriteExternalPortraitStorage(env) {
  return Boolean(
    externalPortraitStorageZone(env) &&
    externalPortraitStorageHost(env) &&
    externalPortraitStoragePassword(env),
  )
}

export function externalPortraitPublicUrl(env, key) {
  const base = externalPortraitCdnBase(env)
  return base ? joinUrl(base, key) : null
}

export function externalPortraitStorageUrl(env, key) {
  const zone = externalPortraitStorageZone(env)
  const host = externalPortraitStorageHost(env)
  return zone && host ? joinUrl(`https://${host}/${zone}`, key) : null
}

function portraitStorageRetryDelay(env, attempt) {
  const configured = Number(env?.ICONOPLASM_PORTRAIT_STORAGE_RETRY_BASE_MS)
  const base = Number.isFinite(configured) ? Math.max(0, configured) : 125
  const exponential = Math.min(2000, base * 2 ** Math.max(0, attempt - 1))
  const jitter = exponential ? Math.floor(Math.random() * Math.max(1, exponential * 0.25)) : 0
  return exponential + jitter
}

function portraitStorageRequestTimeout(env) {
  const configured = Number(env?.ICONOPLASM_PORTRAIT_STORAGE_TIMEOUT_MS)
  return Number.isFinite(configured) ? Math.max(250, Math.min(30_000, configured)) : 8000
}

function retryablePortraitStorageStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

function isWorkerSubrequestLimitError(value) {
  return /too many subrequests(?: by single worker invocation)?/i.test(
    String(value?.message || value || ""),
  )
}

export async function fetchPortraitStorage(
  env,
  url,
  init,
  { operation, key, maxAttempts = 4 } = {},
) {
  const attempts = Math.max(1, Math.min(6, Number(maxAttempts) || 1))
  let lastError = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = typeof AbortController === "function" ? new AbortController() : null
    const timer = setTimeout(() => controller?.abort(), portraitStorageRequestTimeout(env))
    try {
      const response = await fetch(url, {
        ...init,
        ...(controller ? { signal: controller.signal } : {}),
      })
      if (
        response.ok ||
        response.status === 404 ||
        !retryablePortraitStorageStatus(response.status)
      ) {
        return response
      }
      await response.body?.cancel().catch(() => null)
      lastError = new Error(`External portrait ${operation} failed (${response.status}) for ${key}`)
    } catch (error) {
      if (isWorkerSubrequestLimitError(error)) throw error
      lastError = error
    } finally {
      clearTimeout(timer)
    }
    if (attempt < attempts) {
      const delay = portraitStorageRetryDelay(env, attempt)
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
  throw lastError || new Error(`External portrait ${operation} failed for ${key}`)
}

export function externalPortraitReadCandidates(env, key, { accept = "" } = {}) {
  const candidates = []
  const storageUrl = externalPortraitStorageUrl(env, key)
  const storagePassword = externalPortraitStoragePassword(env)
  if (storageUrl && storagePassword) {
    candidates.push({
      source: "authenticated_storage",
      url: storageUrl,
      headers: { AccessKey: storagePassword, ...(accept ? { Accept: accept } : {}) },
    })
  }
  const publicUrl = externalPortraitPublicUrl(env, key)
  if (publicUrl && !candidates.some((candidate) => candidate.url === publicUrl)) {
    candidates.push({
      source: "public_cdn",
      url: publicUrl,
      headers: accept ? { Accept: accept } : {},
    })
  }
  return candidates
}

async function readExternalPortraitObject(
  env,
  key,
  { fallbackContentType, method, accept, maxAttempts },
) {
  const candidates = externalPortraitReadCandidates(env, key, { accept })
  let failedSource = null

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]
    let response
    try {
      response = await fetchPortraitStorage(
        env,
        candidate.url,
        { method, headers: candidate.headers },
        { operation: method, key, maxAttempts },
      )
    } catch (error) {
      if (isWorkerSubrequestLimitError(error)) throw error
      failedSource = {
        source: candidate.source,
        error: String(error?.message || error || "request failed").slice(0, 500),
      }
      if (index + 1 < candidates.length) continue
      throw error
    }

    if (response.ok) {
      if (failedSource) {
        console.warn("[Iconoplasm][portrait-storage-regional-divergence]", {
          key,
          failed_source: failedSource.source,
          failed_status: failedSource.status || null,
          failed_error: failedSource.error || "",
          readable_source: candidate.source,
        })
      }
      return {
        body: response.body,
        contentType: response.headers.get("content-type") || fallbackContentType,
        etag: response.headers.get("etag") || key,
        size: Number(response.headers.get("content-length") || 0) || null,
        source: candidate.source,
        regionalDivergence: Boolean(failedSource),
        failedSource,
      }
    }

    await response.body?.cancel().catch(() => null)
    failedSource = { source: candidate.source, status: response.status }
    if (index + 1 < candidates.length) continue
    if (response.status === 404) return null
    throw new Error(`External portrait ${method} failed (${response.status}) for ${key}`)
  }

  return null
}

export async function readPortraitStorageObject(
  env,
  key,
  { fallbackContentType = "image/webp", maxAttempts = 4 } = {},
) {
  if (env?.ICONOPLASM_PORTRAITS && typeof env.ICONOPLASM_PORTRAITS.get === "function") {
    try {
      const object = await env.ICONOPLASM_PORTRAITS.get(key)
      if (object) {
        return {
          body: object.body,
          contentType: object.httpMetadata?.contentType || fallbackContentType,
          etag: object.httpEtag || key,
          size: Number(object.size || 0) || null,
          source: "r2",
          regionalDivergence: false,
          failedSource: null,
        }
      }
    } catch (error) {
      if (!canReadExternalPortraitStorage(env)) throw error
      console.warn("[Iconoplasm][portrait-storage-r2-read-fallback]", {
        key,
        error: String(error?.message || error || "R2 read failed").slice(0, 500),
      })
    }
  }
  return readExternalPortraitObject(env, key, {
    fallbackContentType,
    method: "GET",
    accept: fallbackContentType,
    maxAttempts,
  })
}

export async function headPortraitStorageObject(env, key, { maxAttempts = 4 } = {}) {
  if (env?.ICONOPLASM_PORTRAITS && typeof env.ICONOPLASM_PORTRAITS.head === "function") {
    try {
      const object = await env.ICONOPLASM_PORTRAITS.head(key)
      if (object) return { ...object, source: "r2", regionalDivergence: false }
    } catch (error) {
      if (!canReadExternalPortraitStorage(env)) throw error
    }
  }
  const object = await readExternalPortraitObject(env, key, {
    fallbackContentType: "application/octet-stream",
    method: "HEAD",
    accept: "*/*",
    maxAttempts,
  })
  return object ? { ok: true, ...object, body: null } : null
}

async function verifyPortraitStorageObjectAfterPut(env, key) {
  for (const delayMs of BUNNY_READ_AFTER_WRITE_DELAYS_MS) {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
    const object = await headPortraitStorageObject(env, key)
    if (object) return object
  }
  return null
}

export async function putPortraitStorageObject(
  env,
  key,
  bytes,
  {
    contentType = "application/octet-stream",
    cacheControl = "",
    customMetadata = null,
    verifyAfterPut = false,
  } = {},
) {
  if (env?.ICONOPLASM_PORTRAITS && typeof env.ICONOPLASM_PORTRAITS.put === "function") {
    return env.ICONOPLASM_PORTRAITS.put(key, bytes, {
      httpMetadata: { contentType, ...(cacheControl ? { cacheControl } : {}) },
      ...(customMetadata ? { customMetadata } : {}),
    })
  }
  const writeUrl = externalPortraitStorageUrl(env, key)
  const password = externalPortraitStoragePassword(env)
  if (!writeUrl || !password)
    throw new Error("External portrait storage is not configured for writes")

  const putOnce = async () => {
    const response = await fetchPortraitStorage(
      env,
      writeUrl,
      {
        method: "PUT",
        headers: {
          AccessKey: password,
          "Content-Type": contentType,
          ...(cacheControl ? { "Cache-Control": cacheControl } : {}),
        },
        body: bytes,
      },
      { operation: "PUT", key },
    )
    if (!response.ok)
      throw new Error(`External portrait PUT failed (${response.status}) for ${key}`)
  }

  if (verifyAfterPut) {
    const verified = await putBunnyObjectUntilVerified({
      put: putOnce,
      verify: () => verifyPortraitStorageObjectAfterPut(env, key),
    })
    if (!verified) {
      throw new Error(`External portrait PUT was not readable after idempotent retries for ${key}`)
    }
    return { ok: true, verified: true, source: verified.source || "unknown" }
  }
  await putOnce()
  return { ok: true }
}

export async function deletePortraitStorageObject(env, key) {
  if (env?.ICONOPLASM_PORTRAITS && typeof env.ICONOPLASM_PORTRAITS.delete === "function") {
    return env.ICONOPLASM_PORTRAITS.delete(key)
  }
  const writeUrl = externalPortraitStorageUrl(env, key)
  const password = externalPortraitStoragePassword(env)
  if (!writeUrl || !password) return null
  const response = await fetchPortraitStorage(
    env,
    writeUrl,
    { method: "DELETE", headers: { AccessKey: password } },
    { operation: "DELETE", key },
  )
  if (response.status === 404) return null
  if (!response.ok)
    throw new Error(`External portrait DELETE failed (${response.status}) for ${key}`)
  return { ok: true }
}
