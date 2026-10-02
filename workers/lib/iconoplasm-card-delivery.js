import {
  createPublishedCardObjectStore,
  STABLE_CATALOG_OBJECT_KEY,
  STABLE_GENE_OBJECT_CACHE_CONTROL,
  stableGeneObjectKey,
} from "./iconoplasm-published-card-objects.js"

// ARCHITECTURE FENCE [IPD-008] + [IPD-011]: public delivery performs only
// reads of the two published objects. No D1, publication, storage PUT, or
// per-reader accounting.
export function createPublishedCardDeliveryHandlers() {
  return {
    // B-898: canonical-origin fallback for the one stable object per gene. The
    // reader tries Bunny first and reaches this only when the CDN is
    // unreachable, so this stays a rare metered request. The object is mutable:
    // no Workers Cache, short shared TTL, same bytes as storage.
    // B-898: the same canonical-origin fallback for the one catalog object.
    async stableCatalog({ env }) {
      const object = await createPublishedCardObjectStore(env).readStable(STABLE_CATALOG_OBJECT_KEY)
      if (!object)
        return new Response(null, {
          status: 404,
          headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" },
        })
      return new Response(object.bytes, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": STABLE_GENE_OBJECT_CACHE_CONTROL,
          "Access-Control-Allow-Origin": "*",
          "X-Content-Type-Options": "nosniff",
        },
      })
    },
    async stableGene({ env, match }) {
      let key
      try {
        key = stableGeneObjectKey(match.params.symbol)
      } catch {
        return new Response(null, { status: 404 })
      }
      const object = await createPublishedCardObjectStore(env).readStable(key)
      if (!object)
        return new Response(null, {
          status: 404,
          headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" },
        })
      return new Response(object.bytes, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": STABLE_GENE_OBJECT_CACHE_CONTROL,
          "Access-Control-Allow-Origin": "*",
          "X-Content-Type-Options": "nosniff",
        },
      })
    },
  }
}
