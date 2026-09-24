// The one owner of the public document security policy for brinedew.bio and
// geneguessr.brinedew.bio. Two consumers read it:
//   1. scripts/write-pages-edge-files.mjs bakes it into the Pages `_headers`
//      file, so documents and assets are served straight from Pages as free,
//      unlimited static requests (B-834: a Worker in front of every file made
//      each page view cost dozens of metered Worker requests).
//   2. The public edge Worker applies it to the few responses it still owns
//      (API-adjacent redirects and the rollout window).
// Change the policy here only; never re-type these strings elsewhere.

export const GENEGUESSR_HOST = "geneguessr.brinedew.bio"
export const ICONOPLASM_HOST = "iconoplasm.brinedew.bio"

export const PUBLIC_SECURITY_HEADERS = Object.freeze({
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy":
    "accelerometer=(), autoplay=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), browsing-topics=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-site",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
})

// The GeneGuessr game document needs `unsafe-eval` and blob/data connections
// for the Mol* 3D viewer; every other public document does not.
export function publicContentSecurityPolicy({ geneguessrGame = false } = {}) {
  const scriptSrc = [
    "script-src",
    "'self'",
    "'unsafe-inline'",
    ...(geneguessrGame ? ["'unsafe-eval'"] : []),
    "https://cdn.jsdelivr.net",
    "https://cdnjs.cloudflare.com",
    "https://challenges.cloudflare.com",
    "https://static.cloudflareinsights.com",
  ].join(" ")
  const connectSrc = [
    "connect-src",
    "'self'",
    ...(geneguessrGame ? ["data:", "blob:"] : []),
    "https://brinedew.bio",
    "https://geneguessr.brinedew.bio",
    "https://iconoplasm.brinedew.bio",
    "https://challenges.cloudflare.com",
    "https://cloudflareinsights.com",
    ...(geneguessrGame ? ["https://cdn.jsdelivr.net"] : []),
  ].join(" ")
  return `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; img-src 'self' data: blob: https://cdn.discordapp.com https://iconoplasmportraits.b-cdn.net; font-src 'self' data:; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; ${scriptSrc}; ${connectSrc}; frame-src 'self' https://brinedew.bio https://www.youtube.com https://www.youtube-nocookie.com https://challenges.cloudflare.com; worker-src 'self' blob:; form-action 'self'; upgrade-insecure-requests`
}
