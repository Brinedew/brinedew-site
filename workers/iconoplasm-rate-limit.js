import { matchIconoplasmRouteContract } from "./iconoplasm-route-contract.js"
import { checkAnonymousRateLimit, RATE_LIMIT_OUTCOME } from "./anonymous-rate-limit.js"

const ICONOPLASM_HOST = "iconoplasm.brinedew.bio"

export function resolveIconoplasmRateLimitPolicy(request) {
  const url = new URL(request.url)
  if (url.hostname.toLowerCase() !== ICONOPLASM_HOST) return null
  const method = String(request.method || "GET").toUpperCase()
  if (method === "OPTIONS") return null
  const match = matchIconoplasmRouteContract(url.pathname, method)
  if (!match?.methodAllowed) return null
  return match.route.rateLimit || null
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

export async function enforceIconoplasmRateLimit(request, env) {
  const policy = resolveIconoplasmRateLimitPolicy(request)
  if (!policy) return { policy: null, response: null, headers: new Headers() }

  const limiter = env?.[policy.binding]
  const rateLimit = await checkAnonymousRateLimit(
    request,
    limiter,
    policy,
    `iconoplasm:${policy.id}`,
  )
  const { headers } = rateLimit

  if (rateLimit.outcome === RATE_LIMIT_OUTCOME.UNAVAILABLE) {
    console.error("[iconoplasm-rate-limit] protection unavailable", {
      policy: policy.id,
      binding: policy.binding,
      error:
        rateLimit.error instanceof Error ? rateLimit.error.message : String(rateLimit.error || ""),
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

  if (rateLimit.outcome === RATE_LIMIT_OUTCOME.ALLOWED) {
    return { policy, response: null, headers }
  }

  console.warn("[iconoplasm-rate-limit] request rejected", { policy: policy.id })
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
