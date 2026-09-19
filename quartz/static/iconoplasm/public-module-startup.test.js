import assert from "node:assert/strict"
import test from "node:test"

function memoryStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, String(value)),
  }
}

test("portrait delivery module startup performs no anonymous metadata request", async () => {
  const originalFetch = globalThis.fetch
  const originalSessionStorage = globalThis.sessionStorage
  let requests = 0
  globalThis.fetch = async () => {
    requests += 1
    throw new Error("anonymous startup entered the Worker")
  }
  globalThis.sessionStorage = memoryStorage()
  try {
    await import(`./portrait-delivery.js?zero-state-startup=${Date.now()}`)
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(requests, 0)
  } finally {
    globalThis.fetch = originalFetch
    globalThis.sessionStorage = originalSessionStorage
  }
})

test("diagram catalog search executes through the immutable publication reader", async () => {
  const originalWindow = globalThis.window
  const originalReader = globalThis.IconoplasmPublicationReader
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.window = {
    location: { hostname: "iconoplasm.brinedew.bio", origin: "https://iconoplasm.brinedew.bio" },
    localStorage: memoryStorage(),
  }
  globalThis.IconoplasmPublicationReader = {
    async search(query, options) {
      calls.push({ query, options })
      return { genes: [{ symbol: "TP53", full_name: "tumor protein p53" }] }
    },
  }
  globalThis.fetch = async () => {
    throw new Error("diagram search entered the Worker")
  }
  try {
    const studio = await import(`./diagram-studio.js?zero-state-search=${Date.now()}`)
    const result = await studio.searchPublishedGenes("tp", { limit: 8 })
    assert.deepEqual(
      result.genes.map((gene) => gene.symbol),
      ["TP53"],
    )
    assert.deepEqual(calls, [{ query: "tp", options: { limit: 8 } }])
  } finally {
    globalThis.window = originalWindow
    globalThis.IconoplasmPublicationReader = originalReader
    globalThis.fetch = originalFetch
  }
})

test("the application has no JavaScript semantic-blot route fallback", async () => {
  const app = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("./app.js", import.meta.url), "utf8"),
  )
  assert.doesNotMatch(app, /public-blot-route/)
  assert.doesNotMatch(app, /publicBlotRouteActive/)
})
