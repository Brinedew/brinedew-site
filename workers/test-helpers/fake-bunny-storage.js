// An in-memory Bunny Storage zone for tests that write through the real storage
// helpers (B-1156: factory prose). It answers PUT, GET and DELETE on the zone's
// URL like Bunny does (201, 200, 404) and passes every other request to the
// fetch that was there before. Spread `env` into the test's env; set `refuse` to a
// status (401, say) to make the zone answer every request with it.
const HOST = "storage.bunnycdn.com"
const ZONE = "test-zone"

export function fakeBunnyStorage(t) {
  const objects = new Map()
  const zone = { objects, refuse: 0 }
  const prefix = `https://${HOST}/${ZONE}/`
  const original = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    const value = String(url)
    if (!value.startsWith(prefix)) return original(url, init)
    const key = value.slice(prefix.length)
    if (zone.refuse) return new Response(null, { status: zone.refuse })
    const method = String(init.method || "GET").toUpperCase()
    if (method === "PUT") {
      objects.set(key, new Uint8Array(await new Response(init.body).arrayBuffer()))
      return new Response(JSON.stringify({ HttpCode: 201 }), { status: 201 })
    }
    if (method === "DELETE") {
      const had = objects.delete(key)
      return new Response(null, { status: had ? 200 : 404 })
    }
    const bytes = objects.get(key)
    return bytes ? new Response(bytes, { status: 200 }) : new Response(null, { status: 404 })
  }
  t.after(() => {
    globalThis.fetch = original
  })
  return Object.assign(zone, {
    env: {
      ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_HOST: HOST,
      ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_ZONE: ZONE,
      ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD: "test-only",
    },
  })
}
