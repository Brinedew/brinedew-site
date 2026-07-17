import assert from "node:assert/strict"
import test from "node:test"

const storageState = new Map()
const sessionState = new Map()

function storageArea(state) {
  return {
    async get(keys) {
      if (Array.isArray(keys)) {
        return Object.fromEntries(keys.map((key) => [key, state.get(key)]))
      }
      if (keys && typeof keys === "object") {
        return Object.fromEntries(
          Object.keys(keys).map((key) => [key, state.has(key) ? state.get(key) : keys[key]]),
        )
      }
      return {}
    },
    async set(values) {
      for (const [key, value] of Object.entries(values || {})) state.set(key, value)
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) state.delete(key)
    },
  }
}

globalThis.chrome = {
  runtime: {
    getManifest() {
      return { version: "1.2.3" }
    },
    onInstalled: {
      addListener() {},
    },
    onStartup: {
      addListener() {},
    },
    onMessage: {
      addListener() {},
    },
  },
  storage: {
    local: storageArea(storageState),
    session: storageArea(sessionState),
  },
}

globalThis.btoa = (value) => Buffer.from(String(value || ""), "binary").toString("base64")
globalThis.__ICONOPLASM_EXTENSION_TEST_HOOKS__ = {}

await import("./service-worker.js")

const hooks = globalThis.__ICONOPLASM_EXTENSION_TEST_HOOKS__

test("portrait fetch failures back off briefly but recover after the error TTL", async () => {
  const originalDateNow = Date.now
  const originalFetch = globalThis.fetch
  let now = 1_710_000_000_000
  let fetchCalls = 0
  let shouldFail = true

  Date.now = () => now
  hooks.clearPortraitDataUrlCaches()
  globalThis.fetch = async () => {
    fetchCalls += 1
    if (shouldFail) {
      return new Response("missing", { status: 503 })
    }
    return new Response(Uint8Array.from([1, 2, 3, 4]), {
      status: 200,
      headers: { "Content-Type": "image/png" },
    })
  }

  try {
    const url = "https://iconoplasm.brinedew.bio/media/tp53-thumb.webp"

    const first = await hooks.fetchPortraitDataUrl(url)
    const second = await hooks.fetchPortraitDataUrl(url)

    assert.equal(first.dataUrl, "")
    assert.equal(second.dataUrl, "")
    assert.equal(fetchCalls, 1)
    assert.equal(hooks.hasFreshPortraitDataUrlError(url), true)

    now += hooks.portraitErrorTtlMs + 1
    shouldFail = false

    const third = await hooks.fetchPortraitDataUrl(url)
    const fourth = await hooks.fetchPortraitDataUrl(url)

    assert.match(third.dataUrl, /^data:image\/png;base64,/)
    assert.equal(fourth.dataUrl, third.dataUrl)
    assert.equal(fetchCalls, 2)
    assert.equal(hooks.hasFreshPortraitDataUrlError(url), false)
  } finally {
    Date.now = originalDateNow
    globalThis.fetch = originalFetch
    hooks.clearPortraitDataUrlCaches()
  }
})

test("100 extension portraits share one failed primary decision per tab", async () => {
  const originalFetch = globalThis.fetch
  let primaryFetches = 0
  let fallbackFetches = 0
  let releasePrimary
  const primaryGate = new Promise((resolve) => {
    releasePrimary = resolve
  })

  await hooks.clearPortraitSourceStates()
  hooks.clearPortraitDataUrlCaches()
  globalThis.fetch = async (input) => {
    const url = String(input || "")
    if (url.startsWith("https://iconoplasmportraits.b-cdn.net/")) {
      primaryFetches += 1
      await primaryGate
      return new Response("unavailable", { status: 503 })
    }
    if (url.startsWith("https://iconoplasm.brinedew.bio/portraits/")) {
      fallbackFetches += 1
      return new Response(Uint8Array.from([1, 2, 3]), {
        status: 200,
        headers: { "Content-Type": "image/webp" },
      })
    }
    throw new Error(`Unexpected URL: ${url}`)
  }

  try {
    const requests = Array.from({ length: 100 }, (_, index) =>
      hooks.fetchPortraitDataUrl(
        `https://iconoplasmportraits.b-cdn.net/portraits/v1/${index}.webp`,
        42,
      ),
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(primaryFetches, 1)
    releasePrimary()
    const results = await Promise.all(requests)

    assert.equal(primaryFetches, 1)
    assert.equal(fallbackFetches, 100)
    assert.ok(
      results.every(
        (result) =>
          result.dataUrl.startsWith("data:image/webp;base64,") &&
          result.sourceUrl.startsWith("https://iconoplasm.brinedew.bio/portraits/"),
      ),
    )
    assert.deepEqual(await hooks.portraitSourceState(42), {
      source: "fallback",
      failed: ["primary"],
    })
  } finally {
    globalThis.fetch = originalFetch
    hooks.clearPortraitDataUrlCaches()
    await hooks.clearPortraitSourceStates()
  }
})
