import { test } from "node:test"
import assert from "node:assert/strict"

import {
  buildDiscordRecapImageKey,
  canReadDiscordRecapImage,
  canWriteDiscordRecapImage,
  putDiscordRecapImage,
  headDiscordRecapImage,
  loadDiscordRecapImageBytes,
  deleteDiscordRecapImage,
} from "./lib/discord-recap-images.js"

// ARCHITECTURE FENCE [GG-002]: these tests deliberately distinguish an HTTP
// acknowledgement from exact retrievability of the uploaded image bytes.

const BUNNY_ENV = {
  ICONOPLASM_EXTERNAL_PORTRAIT_CDN_BASE_URL: "https://iconoplasmportraits.b-cdn.net",
  ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_HOST: "storage.bunnycdn.com",
  ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_ZONE: "iconoplasm-portraits",
  ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD: "secret-access-key",
}

const IMAGE_IDENTITY = { day: "2026-06-03", uniprotId: "P08134" }
const IMAGE_KEY = "discord-recap-images/v2/2026-06-03/P08134/molstar-recap-v2.png"

function withMockedFetch(handler, fn) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    return handler(String(url), init)
  }
  return Promise.resolve(fn(calls)).finally(() => {
    globalThis.fetch = original
  })
}

test("recap image identity includes day, exact protein, and renderer contract", () => {
  assert.equal(buildDiscordRecapImageKey(IMAGE_IDENTITY), IMAGE_KEY)
  assert.notEqual(
    buildDiscordRecapImageKey({ day: IMAGE_IDENTITY.day, uniprotId: "P01112" }),
    IMAGE_KEY,
  )
})

test("Bunny config enables read and write without R2", () => {
  assert.equal(canReadDiscordRecapImage(BUNNY_ENV), true)
  assert.equal(canWriteDiscordRecapImage(BUNNY_ENV), true)
  // No CDN base and no R2 -> cannot read.
  assert.equal(canReadDiscordRecapImage({}), false)
  assert.equal(canWriteDiscordRecapImage({}), false)
})

test("put writes to the Bunny storage API with the AccessKey header", async () => {
  let reads = 0
  await withMockedFetch(
    (url, init) => {
      if (init.method === "PUT") return new Response(null, { status: 201 })
      reads += 1
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
    },
    async (calls) => {
      const { key } = await putDiscordRecapImage(
        BUNNY_ENV,
        IMAGE_IDENTITY,
        new Uint8Array([1, 2, 3]),
      )
      assert.equal(key, IMAGE_KEY)
      assert.equal(calls.length, 2)
      assert.equal(calls[0].url, "https://storage.bunnycdn.com/iconoplasm-portraits/" + IMAGE_KEY)
      assert.equal(calls[0].init.method, "PUT")
      assert.equal(calls[0].init.headers.AccessKey, "secret-access-key")
      assert.equal(reads, 1)
    },
  )
})

test("put rejects a false-positive 200 because Bunny upload success is 201", async () => {
  await withMockedFetch(
    () => new Response('{"Message":"Not Found"}', { status: 200 }),
    async () => {
      await assert.rejects(
        putDiscordRecapImage(BUNNY_ENV, IMAGE_IDENTITY, new Uint8Array([1, 2, 3])),
        /returned 200, expected 201/,
      )
    },
  )
})

test("put rejects acknowledged uploads whose exact bytes cannot be read back", async () => {
  const originalSetTimeout = globalThis.setTimeout
  globalThis.setTimeout = (callback) => {
    callback()
    return 0
  }
  try {
    await withMockedFetch(
      (_url, init) =>
        init.method === "PUT"
          ? new Response(null, { status: 201 })
          : new Response(new Uint8Array([9, 9, 9]), { status: 200 }),
      async () => {
        await assert.rejects(
          putDiscordRecapImage(BUNNY_ENV, IMAGE_IDENTITY, new Uint8Array([1, 2, 3])),
          /exact-byte read-back failed/,
        )
      },
    )
  } finally {
    globalThis.setTimeout = originalSetTimeout
  }
})

test("put absorbs the measured Bunny propagation window before declaring failure", async () => {
  const originalSetTimeout = globalThis.setTimeout
  const observedDelays = []
  let reads = 0
  globalThis.setTimeout = (callback, delayMs) => {
    observedDelays.push(delayMs)
    callback()
    return 0
  }
  try {
    await withMockedFetch(
      (_url, init) => {
        if (init.method === "PUT") return new Response(null, { status: 201 })
        reads += 1
        return reads < 5
          ? new Response(null, { status: 404 })
          : new Response(new Uint8Array([1, 2, 3]), { status: 200 })
      },
      async () => {
        const result = await putDiscordRecapImage(
          BUNNY_ENV,
          IMAGE_IDENTITY,
          new Uint8Array([1, 2, 3]),
        )
        assert.equal(result.verifiedBytes, 3)
        assert.equal(reads, 5)
        assert.deepEqual(observedDelays, [1000, 2000, 4000, 8000])
      },
    )
  } finally {
    globalThis.setTimeout = originalSetTimeout
  }
})

test("put retries the same immutable bytes after an acknowledged write is lost", async () => {
  const originalSetTimeout = globalThis.setTimeout
  let puts = 0
  let reads = 0
  const bodies = []
  globalThis.setTimeout = (callback) => {
    callback()
    return 0
  }
  try {
    await withMockedFetch(
      (_url, init) => {
        if (init.method === "PUT") {
          puts += 1
          bodies.push(Array.from(init.body))
          return new Response(null, { status: 201 })
        }
        reads += 1
        return puts === 1
          ? new Response(null, { status: 404 })
          : new Response(new Uint8Array([1, 2, 3]), { status: 200 })
      },
      async () => {
        const result = await putDiscordRecapImage(
          BUNNY_ENV,
          IMAGE_IDENTITY,
          new Uint8Array([1, 2, 3]),
        )
        assert.equal(result.verifiedBytes, 3)
        assert.equal(puts, 2)
        assert.equal(reads, 6)
        assert.deepEqual(bodies, [
          [1, 2, 3],
          [1, 2, 3],
        ])
      },
    )
  } finally {
    globalThis.setTimeout = originalSetTimeout
  }
})

test("load reads from Bunny storage with its AccessKey and returns bytes", async () => {
  await withMockedFetch(
    (url, init) => {
      assert.equal(url, "https://storage.bunnycdn.com/iconoplasm-portraits/" + IMAGE_KEY)
      assert.equal(init.headers.AccessKey, "secret-access-key")
      return new Response(new Uint8Array([9, 8, 7]), { status: 200 })
    },
    async () => {
      const bytes = await loadDiscordRecapImageBytes(BUNNY_ENV, IMAGE_IDENTITY)
      assert.ok(bytes instanceof Uint8Array)
      assert.equal(bytes.byteLength, 3)
    },
  )
})

test("load falls back to the public CDN only without storage credentials", async () => {
  await withMockedFetch(
    (url, init) => {
      assert.equal(url, "https://iconoplasmportraits.b-cdn.net/" + IMAGE_KEY)
      assert.deepEqual(init, {})
      return new Response(new Uint8Array([9, 8, 7]), { status: 200 })
    },
    async () => {
      const bytes = await loadDiscordRecapImageBytes(
        { ICONOPLASM_EXTERNAL_PORTRAIT_CDN_BASE_URL: "https://iconoplasmportraits.b-cdn.net" },
        IMAGE_IDENTITY,
      )
      assert.ok(bytes instanceof Uint8Array)
      assert.equal(bytes.byteLength, 3)
    },
  )
})

test("load returns null on 404 instead of throwing", async () => {
  await withMockedFetch(
    () => new Response(null, { status: 404 }),
    async () => {
      const bytes = await loadDiscordRecapImageBytes(BUNNY_ENV, IMAGE_IDENTITY)
      assert.equal(bytes, null)
    },
  )
})

test("head reports existence and size via the storage API", async () => {
  await withMockedFetch(
    () => new Response(null, { status: 200, headers: { "content-length": "4242" } }),
    async () => {
      const head = await headDiscordRecapImage(BUNNY_ENV, IMAGE_IDENTITY)
      assert.equal(head.size, 4242)
      assert.equal(head.key, IMAGE_KEY)
    },
  )
})

test("delete issues a DELETE against the storage API", async () => {
  await withMockedFetch(
    () => new Response(null, { status: 200 }),
    async (calls) => {
      const acted = await deleteDiscordRecapImage(BUNNY_ENV, IMAGE_IDENTITY)
      assert.equal(acted, true)
      assert.equal(calls[0].init.method, "DELETE")
    },
  )
})

test("R2 binding takes precedence when present", async () => {
  const puts = []
  let storedBytes = null
  const r2Env = {
    STRUCTURES_BUCKET: {
      async put(key, bytes) {
        puts.push({ key, bytes })
        storedBytes = new Uint8Array(bytes)
      },
      async get() {
        return storedBytes ? { arrayBuffer: async () => storedBytes.buffer.slice(0) } : null
      },
    },
  }
  // fetch must not be called when R2 is bound.
  await withMockedFetch(
    () => {
      throw new Error("fetch should not be called when STRUCTURES_BUCKET is bound")
    },
    async () => {
      await putDiscordRecapImage(r2Env, IMAGE_IDENTITY, new Uint8Array([1]))
      assert.equal(puts.length, 1)
      assert.equal(puts[0].key, IMAGE_KEY)
    },
  )
})
