import assert from "node:assert/strict"
import test from "node:test"

const storageState = new Map()

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
    local: {
      async get(keys) {
        if (Array.isArray(keys)) {
          return Object.fromEntries(keys.map((key) => [key, storageState.get(key)]))
        }
        if (keys && typeof keys === "object") {
          return Object.fromEntries(
            Object.keys(keys).map((key) => [key, storageState.has(key) ? storageState.get(key) : keys[key]]),
          )
        }
        return {}
      },
      async set(values) {
        for (const [key, value] of Object.entries(values || {})) {
          storageState.set(key, value)
        }
      },
      async remove(keys) {
        for (const key of Array.isArray(keys) ? keys : [keys]) {
          storageState.delete(key)
        }
      },
    },
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

    assert.equal(first, "")
    assert.equal(second, "")
    assert.equal(fetchCalls, 1)
    assert.equal(hooks.hasFreshPortraitDataUrlError(url), true)

    now += hooks.portraitErrorTtlMs + 1
    shouldFail = false

    const third = await hooks.fetchPortraitDataUrl(url)
    const fourth = await hooks.fetchPortraitDataUrl(url)

    assert.match(third, /^data:image\/png;base64,/) 
    assert.equal(fourth, third)
    assert.equal(fetchCalls, 2)
    assert.equal(hooks.hasFreshPortraitDataUrlError(url), false)
  } finally {
    Date.now = originalDateNow
    globalThis.fetch = originalFetch
    hooks.clearPortraitDataUrlCaches()
  }
})
