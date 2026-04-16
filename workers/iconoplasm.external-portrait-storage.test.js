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
    const response = await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
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
    const response = await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
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
