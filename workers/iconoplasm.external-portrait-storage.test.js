import assert from "node:assert/strict"
import test from "node:test"

import { handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate } from "./iconoplasm-public-edge-proxy-to-the-only-allowed-stateful-worker-do-not-duplicate.js"
import { handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

const SHA = "4713c9ed62d593a88fc73239fc9409d1486d149a456c78a1e6b5cbdcd9cff212"
const PORTRAIT_KEY = `portraits/v1/47/${SHA}/medium.webp`
const DUMP_KEY = "public-dumps/catalog.abc123.jsonl"
const CDN_BASE = "https://iconoplasmportraits.b-cdn.net"

function bindOnlyAllowedGateway(env, gatewayEnv = env, ctx = { waitUntil() {} }) {
  return {
    ...env,
    THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE: {
      fetch(request) {
        return handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
          request,
          gatewayEnv,
          ctx,
        )
      },
    },
  }
}

test("stateful worker can serve Bunny-backed portraits without a direct bucket binding", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input?.url || ""
    assert.equal(url, `${CDN_BASE}/${PORTRAIT_KEY}`)
    return new Response("external-image-bytes", {
      status: 200,
      headers: {
        "Content-Type": "image/webp",
        ETag: '"bunny-portrait-etag"',
      },
    })
  }

  try {
    const response =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(`https://iconoplasm.brinedew.bio/${PORTRAIT_KEY}`),
        {
          ICONOPLASM_EXTERNAL_PORTRAIT_CDN_BASE_URL: CDN_BASE,
        },
        {},
      )

    assert.equal(response.status, 200)
    assert.equal(response.headers.get("content-type"), "image/webp")
    assert.equal(await response.text(), "external-image-bytes")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("stateful worker favors authenticated Bunny storage over a fragile public CDN", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input?.url || ""
    assert.equal(url, `https://storage.bunnycdn.com/iconoplasm-portraits/${PORTRAIT_KEY}`)
    assert.equal(init?.headers?.AccessKey, "storage-access-key")
    return new Response("storage-image-bytes", {
      status: 200,
      headers: {
        "Content-Type": "image/webp",
        ETag: '"bunny-storage-etag"',
      },
    })
  }

  try {
    const response =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(`https://iconoplasm.brinedew.bio/${PORTRAIT_KEY}`),
        {
          ICONOPLASM_EXTERNAL_PORTRAIT_CDN_BASE_URL: CDN_BASE,
          ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_HOST: "storage.bunnycdn.com",
          ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_ZONE: "iconoplasm-portraits",
          ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD: "storage-access-key",
        },
        {},
      )

    assert.equal(response.status, 200)
    assert.equal(response.headers.get("content-type"), "image/webp")
    assert.equal(await response.text(), "storage-image-bytes")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("public edge serves first-party portrait URLs from authenticated Bunny storage", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input?.url || ""
    assert.equal(url, `https://storage.bunnycdn.com/iconoplasm-portraits/${PORTRAIT_KEY}`)
    assert.equal(init?.headers?.AccessKey, "storage-access-key")
    return new Response("public-edge-storage-image-bytes", {
      status: 200,
      headers: { "Content-Type": "image/webp" },
    })
  }
  const env = {
    ICONOPLASM_EXTERNAL_PORTRAIT_CDN_BASE_URL: CDN_BASE,
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_HOST: "storage.bunnycdn.com",
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_ZONE: "iconoplasm-portraits",
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD: "storage-access-key",
  }

  try {
    const response =
      await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
        new Request(`https://iconoplasm.brinedew.bio/${PORTRAIT_KEY}`),
        bindOnlyAllowedGateway(env),
        {},
      )

    assert.equal(response.status, 200)
    assert.equal(await response.text(), "public-edge-storage-image-bytes")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("portrait cache ignores a cache-busting query and avoids a second storage read", async () => {
  const originalFetch = globalThis.fetch
  const originalCaches = globalThis.caches
  const entries = new Map()
  let fetches = 0
  globalThis.fetch = async () => {
    fetches += 1
    return new Response("cached-storage-image-bytes", {
      status: 200,
      headers: { "Content-Type": "image/webp" },
    })
  }
  Object.defineProperty(globalThis, "caches", {
    configurable: true,
    value: {
      default: {
        async match(request) {
          const cached = entries.get(request.url)
          return cached ? cached.clone() : undefined
        },
        async put(request, response) {
          entries.set(request.url, response.clone())
        },
      },
    },
  })
  const env = {
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_HOST: "storage.bunnycdn.com",
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_ZONE: "iconoplasm-portraits",
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD: "storage-access-key",
  }
  const ctx = {
    waitUntil(promise) {
      return promise
    },
  }

  try {
    const first =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(`https://iconoplasm.brinedew.bio/${PORTRAIT_KEY}?fresh=1`),
        env,
        ctx,
      )
    assert.equal(first.status, 200)
    await new Promise((resolve) => setTimeout(resolve, 0))
    const second =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(`https://iconoplasm.brinedew.bio/${PORTRAIT_KEY}?fresh=2`),
        env,
        ctx,
      )
    assert.equal(second.status, 200)
    assert.equal(await second.text(), "cached-storage-image-bytes")
    assert.equal(fetches, 1)
  } finally {
    globalThis.fetch = originalFetch
    Object.defineProperty(globalThis, "caches", { configurable: true, value: originalCaches })
  }
})

test("public catalog dump proxies to the stateful worker when portraits live in external storage", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input?.url || ""
    assert.equal(url, `${CDN_BASE}/${DUMP_KEY}`)
    return new Response('{"s":"A1BG"}\n', {
      status: 200,
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        ETag: '"bunny-dump-etag"',
      },
    })
  }

  try {
    const response =
      await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
        new Request("https://iconoplasm.brinedew.bio/api/public/v1/dumps/catalog.abc123.jsonl"),
        bindOnlyAllowedGateway({
          ICONOPLASM_EXTERNAL_PORTRAIT_CDN_BASE_URL: CDN_BASE,
        }),
        {},
      )

    assert.equal(response.status, 200)
    assert.equal(response.headers.get("content-type"), "application/x-ndjson; charset=utf-8")
    assert.equal(await response.text(), '{"s":"A1BG"}\n')
  } finally {
    globalThis.fetch = originalFetch
  }
})
