const POLICIES = Object.freeze({
  publicCatalog: "public, max-age=300, stale-while-revalidate=600",
  publicMutable: "public, max-age=120, s-maxage=300, stale-while-revalidate=600",
  publicSearch: "public, max-age=30",
  publicGallery: "public, max-age=60, s-maxage=60",
  publicGalleryVotes: "public, max-age=5, stale-while-revalidate=25",
  publicImmutable: "public, max-age=31536000, immutable",
  authenticated: "private, no-store",
  sensitive: "no-store",
})

export const ICONOPLASM_CACHE_POLICY = POLICIES

export function iconoplasmCacheControl(policyName) {
  const value = POLICIES[policyName]
  if (!value) throw new Error(`Unknown Iconoplasm cache policy: ${String(policyName)}`)
  return value
}
