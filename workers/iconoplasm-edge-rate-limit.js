import { matchIconoplasmRouteContract } from "./iconoplasm-route-contract.js"

const ICONOPLASM_HOST = "iconoplasm.brinedew.bio"

export function resolveIconoplasmEdgeRateLimitPolicy(request) {
  const url = new URL(request.url)
  if (url.hostname.toLowerCase() !== ICONOPLASM_HOST) return null
  const method = String(request.method || "GET").toUpperCase()
  if (method === "OPTIONS") return null
  const match = matchIconoplasmRouteContract(url.pathname, method)
  if (!match?.methodAllowed) return null
  return match.route.rateLimit || null
}

async function actorPartitionKey(request, policy) {
  // Anonymous routes have no verified account identity at this boundary. A
  // network-derived partition is therefore the least-bad abuse-control key,
  // but raw addresses never leave this invocation. The generous per-route
  // quotas reduce collateral throttling for carrier NATs and privacy relays.
  const connectingIp = String(request.headers.get("CF-Connecting-IP") || "").trim()
  const fallbackFingerprint = [
    String(request.headers.get("User-Agent") || "").slice(0, 256),
    String(request.headers.get("Accept-Language") || "").slice(0, 128),
  ].join("\u0000")
  const actor = connectingIp ? `network:${connectingIp}` : `fallback:${fallbackFingerprint}`
  const material = new TextEncoder().encode(`iconoplasm:v1:${policy.id}:${actor}`)
  const digest = await crypto.subtle.digest("SHA-256", material)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function policyHeaders(policy) {
  return new Headers({
    // draft-ietf-httpapi-ratelimit-headers-11. Cloudflare exposes allow/deny,
    // not a remaining counter, so successful responses intentionally advertise
    // policy only instead of inventing RateLimit remaining/reset values.
    "RateLimit-Policy": `"${policy.id}";q=${policy.limit};w=${policy.period}`,
    // Retain the two truthful legacy discovery fields for existing clients.
    "X-RateLimit-Limit": String(policy.limit),
    "X-RateLimit-Period": String(policy.period),
  })
}

function problemResponse(status, payload, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
      "Content-Type": "application/problem+json; charset=utf-8",
      ...headers,
    },
  })
}

export async function enforceIconoplasmRateLimitAtPublicEdge(request, env) {
  const policy = resolveIconoplasmEdgeRateLimitPolicy(request)
  if (!policy) return { policy: null, response: null, headers: new Headers() }

  const headers = policyHeaders(policy)
  const limiter = env?.[policy.binding]
  if (!limiter || typeof limiter.limit !== "function") {
    console.error("[iconoplasm-rate-limit] required binding missing", {
      policy: policy.id,
      binding: policy.binding,
    })
    return {
      policy,
      headers,
      response: problemResponse(
        503,
        {
          type: "https://iconoplasm.brinedew.bio/problems/rate-limit-unavailable",
          title: "Rate limit protection unavailable",
          status: 503,
          code: "ICONOPLASM_RATE_LIMIT_UNAVAILABLE",
        },
        Object.fromEntries(headers),
      ),
    }
  }

  let success = false
  try {
    const key = await actorPartitionKey(request, policy)
    ;({ success } = await limiter.limit({ key }))
  } catch (error) {
    console.error("[iconoplasm-rate-limit] binding call failed", {
      policy: policy.id,
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      policy,
      headers,
      response: problemResponse(
        503,
        {
          type: "https://iconoplasm.brinedew.bio/problems/rate-limit-unavailable",
          title: "Rate limit protection unavailable",
          status: 503,
          code: "ICONOPLASM_RATE_LIMIT_UNAVAILABLE",
        },
        Object.fromEntries(headers),
      ),
    }
  }

  if (success) return { policy, response: null, headers }

  console.warn("[iconoplasm-rate-limit] request rejected", { policy: policy.id })
  const retryAfter = String(policy.period)
  headers.set("RateLimit", `"${policy.id}";r=0;t=${policy.period}`)
  headers.set("Retry-After", retryAfter)
  return {
    policy,
    headers,
    response: problemResponse(
      429,
      {
        type: "https://iconoplasm.brinedew.bio/problems/quota-exceeded",
        title: "Rate limit exceeded",
        status: 429,
        code: "ICONOPLASM_RATE_LIMIT_EXCEEDED",
        retry_after_seconds: policy.period,
      },
      Object.fromEntries(headers),
    ),
  }
}

export function withIconoplasmRateLimitHeaders(response, headers) {
  if (!headers || [...headers].length === 0) return response
  const merged = new Headers(response.headers)
  for (const [name, value] of headers) merged.set(name, value)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged,
  })
}
