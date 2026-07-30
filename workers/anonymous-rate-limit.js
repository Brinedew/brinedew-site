export const RATE_LIMIT_OUTCOME = Object.freeze({
  ALLOWED: "allowed",
  LIMITED: "limited",
  UNAVAILABLE: "unavailable",
})

function policyHeaders(policy) {
  return new Headers({
    // Cloudflare exposes allow/deny, not an authoritative remaining counter.
    // Advertise the policy without inventing remaining or reset values.
    "RateLimit-Policy": `"${policy.id}";q=${policy.limit};w=${policy.period}`,
    "X-RateLimit-Limit": String(policy.limit),
    "X-RateLimit-Period": String(policy.period),
  })
}

async function actorPartitionKey(request, scope) {
  const normalizedScope = String(scope || "").trim()
  if (!normalizedScope) throw new TypeError("Rate limit scope is required")

  // Anonymous routes have no verified account identity at this boundary. A
  // network-derived partition is therefore the least-bad abuse-control key,
  // but raw addresses never leave this invocation.
  const connectingIp = String(request.headers.get("CF-Connecting-IP") || "").trim()
  const fallbackFingerprint = [
    String(request.headers.get("User-Agent") || "").slice(0, 256),
    String(request.headers.get("Accept-Language") || "").slice(0, 128),
  ].join("\u0000")
  const actor = connectingIp ? `network:${connectingIp}` : `fallback:${fallbackFingerprint}`
  const material = new TextEncoder().encode(
    `brinedew-anonymous-rate-limit:v1:${normalizedScope}:${actor}`,
  )
  const digest = await crypto.subtle.digest("SHA-256", material)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function unavailable(headers, error) {
  return {
    outcome: RATE_LIMIT_OUTCOME.UNAVAILABLE,
    headers,
    error,
  }
}

export async function checkAnonymousRateLimit(request, limiter, policy, scope) {
  const headers = policyHeaders(policy)
  if (!limiter || typeof limiter.limit !== "function") {
    return unavailable(headers, new Error("Required rate limit binding is missing"))
  }

  try {
    const key = await actorPartitionKey(request, scope)
    const result = await limiter.limit({ key })
    if (typeof result?.success !== "boolean") {
      return unavailable(headers, new Error("Rate limit binding returned an invalid result"))
    }
    if (result.success) {
      return {
        outcome: RATE_LIMIT_OUTCOME.ALLOWED,
        headers,
        error: null,
      }
    }

    headers.set("RateLimit", `"${policy.id}";r=0;t=${policy.period}`)
    headers.set("Retry-After", String(policy.period))
    return {
      outcome: RATE_LIMIT_OUTCOME.LIMITED,
      headers,
      error: null,
    }
  } catch (error) {
    return unavailable(headers, error)
  }
}
