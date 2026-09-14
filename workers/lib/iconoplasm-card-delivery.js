import {
  createPublishedCardObjectStore,
  publishedCardObjectKey,
} from "./iconoplasm-published-card-objects.js"

// ARCHITECTURE FENCE [IPD-008] + [IPD-011]: public delivery performs only
// immutable reads. No D1, publication, storage PUT, or per-reader accounting.
export function createPublishedCardDeliveryHandlers({ barrier, readerView = null }) {
  return {
    async current({ env }) {
      const head = await barrier(env)
      if (!head?.current || head.current === "0")
        return Response.json(
          { error: "Publication unavailable" },
          {
            status: 503,
            headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" },
          },
        )
      // The per-gene delta view is advertised alongside the unchanged base
      // epoch. It derives from the same publication owner and names its base,
      // and it is only advertised while that exact base is still current.
      let view = null
      if (readerView) {
        try {
          const advertised = await readerView(env)
          if (advertised?.base === head.current) view = advertised.view
        } catch {
          view = null
        }
      }
      return Response.json(
        {
          schema_version: 2,
          current: head.current,
          previous: head.previous || null,
          ...(view ? { reader_view: view } : {}),
        },
        {
          headers: {
            // Browser revalidates on the next article load. Bunny shares the
            // origin result for 30s. No query-per-reader cache busting or timers.
            "Cache-Control": "public, max-age=0, s-maxage=30, must-revalidate",
            "Access-Control-Allow-Origin": "*",
          },
        },
      )
    },
    async object({ request, env, ctx, match }) {
      const { kind, hash } = match.params
      if (!["cards", "genes", "portraits", "indexes", "manifests"].includes(kind))
        return new Response(null, { status: 404 })
      const url = new URL(request.url)
      url.search = ""
      const cacheKey = new Request(url)
      const cached = await globalThis.caches?.default?.match(cacheKey)
      if (cached) return cached
      const object = await createPublishedCardObjectStore(env).read(
        publishedCardObjectKey(kind, hash),
      )
      if (!object)
        return new Response(null, {
          status: 404,
          headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" },
        })
      const response = new Response(object.bytes, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "public, max-age=31536000, immutable",
          "Access-Control-Allow-Origin": "*",
          ETag: `"${hash}"`,
          "X-Content-Type-Options": "nosniff",
        },
      })
      if (globalThis.caches?.default)
        ctx?.waitUntil?.(globalThis.caches.default.put(cacheKey, response.clone()))
      return response
    },
  }
}
