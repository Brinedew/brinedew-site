/**
 * Iconoplasm API - Visual mnemonics for molecular cell biology
 *
 * Minimal implementation - just health check for now.
 * Phase 2 will add: visions, portraits, stories, voting
 */

const ICONOPLASM_HOST = "iconoplasm.brinedew.bio"

/**
 * Check if this request is for the Iconoplasm subdomain
 */
export function isIconoplasmRequest(host) {
  return host === ICONOPLASM_HOST || host.startsWith("iconoplasm.")
}

/**
 * Handle Iconoplasm API requests
 */
export async function handleIconoplasmRequest(request, env, ctx) {
  const url = new URL(request.url)
  const path = url.pathname

  // Health check
  if (path === "/api/health") {
    return Response.json({ status: "ok", service: "iconoplasm" })
  }

  // 404 for everything else (for now)
  return Response.json({ error: "Not found" }, { status: 404 })
}
