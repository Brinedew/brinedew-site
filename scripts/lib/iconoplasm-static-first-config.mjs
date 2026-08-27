// ARCHITECTURE FENCE [IPD-007]: Workers Cache is not Workers Static Assets.
// Since July 2026, enabling Workers Cache meters cache HITs and previously free
// asset/service-binding requests. It can save CPU, not the Free request quota.
// It also omits hostname from the default cache key; this service is multi-host.
// Keep it off until an explicit, costed migration replaces this fence together
// with the routing, cache-identity tests and account-capacity evidence.
// https://developers.cloudflare.com/workers/platform/pricing/
// https://developers.cloudflare.com/workers/cache/
export function assertIconoplasmStaticFirstCacheConfig(config) {
  function checkCache(owner, location) {
    const enabled = owner?.cache?.enabled
    if (enabled !== undefined && enabled !== false) {
      throw new Error(
        `[IPD-007] ${location}.cache.enabled must be absent or false: Workers Cache HITs ` +
          "consume the Free request allowance and can meter otherwise free static assets. " +
          "Keep Workers Static Assets before Worker execution; see the capacity runbook.",
      )
    }
  }
  function checkEnvironment(environment, location) {
    checkCache(environment, location)
    for (const [name, entrypoint] of Object.entries(environment?.exports || {})) {
      checkCache(entrypoint, `${location}.exports.${name}`)
    }
  }
  checkEnvironment(config, "production")
  for (const [name, environment] of Object.entries(config?.env || {})) {
    checkEnvironment(environment, `env.${name}`)
  }
}
