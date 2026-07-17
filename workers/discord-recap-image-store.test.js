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

const BUNNY_ENV = {
  ICONOPLASM_EXTERNAL_PORTRAIT_CDN_BASE_URL: "https://iconoplasmportraits.b-cdn.net",
  ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_HOST: "storage.bunnycdn.com",
  ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_ZONE: "iconoplasm-portraits",
  ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD: "secret-access-key",
}

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

test("recap image is keyed under a stable prefix", () => {
  assert.equal(buildDiscordRecapImageKey("2026-06-03"), "discord-recap-images/2026-06-03.png")
})

test("Bunny config enables read and write without R2", () => {
  assert.equal(canReadDiscordRecapImage(BUNNY_ENV), true)
  assert.equal(canWriteDiscordRecapImage(BUNNY_ENV), true)
  // No CDN base and no R2 -> cannot read.
  assert.equal(canReadDiscordRecapImage({}), false)
  assert.equal(canWriteDiscordRecapImage({}), false)
})

test("put writes to the Bunny storage API with the AccessKey header", async () => {
  await withMockedFetch(
    () => new Response(null, { status: 201 }),
    async (calls) => {
      const { key } = await putDiscordRecapImage(BUNNY_ENV, "2026-06-03", new Uint8Array([1, 2, 3]))
      assert.equal(key, "discord-recap-images/2026-06-03.png")
      assert.equal(calls.length, 1)
      assert.equal(
        calls[0].url,
        "https://storage.bunnycdn.com/iconoplasm-portraits/discord-recap-images/2026-06-03.png",
      )
      assert.equal(calls[0].init.method, "PUT")
      assert.equal(calls[0].init.headers.AccessKey, "secret-access-key")
    },
  )
})

test("load reads from Bunny storage with its AccessKey and returns bytes", async () => {
  await withMockedFetch(
    (url, init) => {
      assert.equal(
        url,
        "https://storage.bunnycdn.com/iconoplasm-portraits/discord-recap-images/2026-06-03.png",
      )
      assert.equal(init.headers.AccessKey, "secret-access-key")
      return new Response(new Uint8Array([9, 8, 7]), { status: 200 })
    },
    async () => {
      const bytes = await loadDiscordRecapImageBytes(BUNNY_ENV, "2026-06-03")
      assert.ok(bytes instanceof Uint8Array)
      assert.equal(bytes.byteLength, 3)
    },
  )
})

test("load falls back to the public CDN only without storage credentials", async () => {
  await withMockedFetch(
    (url, init) => {
      assert.equal(url, "https://iconoplasmportraits.b-cdn.net/discord-recap-images/2026-06-03.png")
      assert.deepEqual(init, {})
      return new Response(new Uint8Array([9, 8, 7]), { status: 200 })
    },
    async () => {
      const bytes = await loadDiscordRecapImageBytes(
        { ICONOPLASM_EXTERNAL_PORTRAIT_CDN_BASE_URL: "https://iconoplasmportraits.b-cdn.net" },
        "2026-06-03",
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
      const bytes = await loadDiscordRecapImageBytes(BUNNY_ENV, "2026-06-03")
      assert.equal(bytes, null)
    },
  )
})

test("head reports existence and size via the storage API", async () => {
  await withMockedFetch(
    () => new Response(null, { status: 200, headers: { "content-length": "4242" } }),
    async () => {
      const head = await headDiscordRecapImage(BUNNY_ENV, "2026-06-03")
      assert.equal(head.size, 4242)
      assert.equal(head.key, "discord-recap-images/2026-06-03.png")
    },
  )
})

test("delete issues a DELETE against the storage API", async () => {
  await withMockedFetch(
    () => new Response(null, { status: 200 }),
    async (calls) => {
      const acted = await deleteDiscordRecapImage(BUNNY_ENV, "2026-06-03")
      assert.equal(acted, true)
      assert.equal(calls[0].init.method, "DELETE")
    },
  )
})

test("R2 binding takes precedence when present", async () => {
  const puts = []
  const r2Env = {
    STRUCTURES_BUCKET: {
      async put(key, bytes) {
        puts.push({ key, bytes })
      },
    },
  }
  // fetch must not be called when R2 is bound.
  await withMockedFetch(
    () => {
      throw new Error("fetch should not be called when STRUCTURES_BUCKET is bound")
    },
    async () => {
      await putDiscordRecapImage(r2Env, "2026-06-03", new Uint8Array([1]))
      assert.equal(puts.length, 1)
      assert.equal(puts[0].key, "discord-recap-images/2026-06-03.png")
    },
  )
})
