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

test("the stable blot route resolves the exact immutable Bunny blot without state", async () => {
  const fingerprint = "b".repeat(32)
  const objectKey = `blots/v1/T/TP53/${fingerprint}/TP53-iconoplasm-gene-blot.webp`
  const replacements = []
  const { resolvePublicBlotRoute } = await import(
    `./public-blot-route.js?immutable-blot=${Date.now()}`
  )
  const result = await resolvePublicBlotRoute({
    location: {
      pathname: "/blot/TP53.webp",
      replace: (value) => replacements.push(value),
    },
    reader: {
      async gene(symbol) {
        assert.equal(symbol, "TP53")
        return {
          symbol,
          blot: {
            blot_fingerprint: fingerprint,
            object_key: objectKey,
            accelerator_url: `https://iconoplasmportraits.b-cdn.net/${objectKey}`,
          },
        }
      },
    },
  })

  assert.equal(result, `https://iconoplasmportraits.b-cdn.net/${objectKey}`)
  assert.deepEqual(replacements, [result])
})

test("a genuinely missing blot route resolves only to the bundled static placeholder", async () => {
  const replacements = []
  const { resolvePublicBlotRoute } = await import(
    `./public-blot-route.js?missing-blot=${Date.now()}`
  )
  const result = await resolvePublicBlotRoute({
    location: {
      pathname: "/blot/RB1.webp",
      replace: (value) => replacements.push(value),
    },
    reader: { gene: async () => null },
  })

  assert.equal(result, "/static/iconoplasm/blot-placeholder.svg")
  assert.deepEqual(replacements, [result])
})
