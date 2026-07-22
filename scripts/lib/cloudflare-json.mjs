const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_TIMEOUT_MS = 20_000
const MAX_RETRY_DELAY_MS = 30_000
const MAX_DIAGNOSTIC_LENGTH = 500

function isRetryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

function responseDiagnostic(body) {
  const normalized = String(body || "")
    .replace(/\s+/g, " ")
    .trim()
  if (!normalized) return "empty response body"
  return normalized.length > MAX_DIAGNOSTIC_LENGTH
    ? `${normalized.slice(0, MAX_DIAGNOSTIC_LENGTH)}…`
    : normalized
}

function retryAfterMilliseconds(response, now) {
  const value = response.headers.get("Retry-After")?.trim()
  if (!value) return 0

  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(MAX_RETRY_DELAY_MS, Math.ceil(seconds * 1000))
  }

  const retryAt = Date.parse(value)
  if (!Number.isFinite(retryAt)) return 0
  return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, retryAt - now()))
}

function retryDelayMilliseconds({ attempt, response, now, random }) {
  const baseDelay = Math.min(5_000, 750 * 2 ** (attempt - 1))
  const jitter = Math.floor(baseDelay * 0.25 * random())
  return Math.max(baseDelay + jitter, response ? retryAfterMilliseconds(response, now) : 0)
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Cloudflare sometimes returns an empty or non-JSON body at its API edge even
 * for JSON endpoints. This boundary deliberately reads text first, retries only
 * idempotent transient failures, and emits bounded diagnostics without headers.
 */
export async function fetchCloudflareJson(
  url,
  init,
  {
    operation = "Cloudflare API request",
    fetchImpl = fetch,
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    now = Date.now,
    random = Math.random,
  } = {},
) {
  const attempts = Math.max(1, Math.trunc(Number(maxAttempts) || 0))
  const attemptTimeoutMs = Math.max(1_000, Math.trunc(Number(timeoutMs) || 0))

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let response
    let body = ""
    try {
      response = await fetchImpl(url, {
        ...init,
        signal: AbortSignal.timeout(attemptTimeoutMs),
      })
      body = await response.text()
    } catch (error) {
      if (attempt === attempts) {
        throw new Error(`${operation} failed after ${attempts} attempts: ${errorMessage(error)}`, {
          cause: error,
        })
      }
      await sleep(retryDelayMilliseconds({ attempt, now, random }))
      continue
    }

    let payload
    if (body.trim()) {
      try {
        payload = JSON.parse(body)
      } catch (error) {
        const retryable = response.ok || isRetryableStatus(response.status)
        if (!retryable || attempt === attempts) {
          throw new Error(
            `${operation} returned invalid JSON (HTTP ${response.status}, attempt ${attempt}/${attempts}): ${responseDiagnostic(body)}`,
            { cause: error },
          )
        }
        await sleep(retryDelayMilliseconds({ attempt, response, now, random }))
        continue
      }
    } else {
      if (attempt === attempts) {
        throw new Error(
          `${operation} returned an empty response body (HTTP ${response.status}) after ${attempts} attempts`,
        )
      }
      await sleep(retryDelayMilliseconds({ attempt, response, now, random }))
      continue
    }

    if (!response.ok) {
      if (isRetryableStatus(response.status) && attempt < attempts) {
        await sleep(retryDelayMilliseconds({ attempt, response, now, random }))
        continue
      }
      throw new Error(`${operation} failed (HTTP ${response.status}): ${responseDiagnostic(body)}`)
    }

    return payload
  }

  throw new Error(`${operation} failed without a response`)
}
