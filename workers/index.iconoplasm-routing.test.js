import assert from "node:assert/strict"
import test, { afterEach } from "node:test"

import worker from "./the-only-allowed-public-edge-worker-that-must-not-touch-state.js"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function statefulSpy(response = Response.json({ ok: true })) {
  const calls = []
  return {
    calls,
    binding: {
      async fetch(request) {
        calls.push({ url: request.url, method: request.method })
        return response
      },
    },
  }
}

test("public edge serves the Brinedew root from Pages before Iconoplasm assets can intercept", async () => {
  const upstreamCalls = []
  globalThis.fetch = async (url, init) => {
    upstreamCalls.push(String(url))
    assert.equal(new Headers(init?.headers).get("Cookie"), null)
    assert.equal(new Headers(init?.headers).get("Authorization"), null)
    return new Response('<html><head></head><body data-slug="index">Brinedew</body></html>', {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    })
  }
  const stateful = statefulSpy()

  const response = await worker.fetch(
    new Request("https://brinedew.bio/?route-test=1", {
      headers: {
        Authorization: "Bearer private",
        Cookie: "session=private",
      },
    }),
    { THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE: stateful.binding },
    {},
  )
  const html = await response.text()

  assert.deepEqual(upstreamCalls, ["https://brinedew-bio.pages.dev/index.html?route-test=1"])
  assert.equal(stateful.calls.length, 0)
  assert.match(html, /data-slug="index"/)
  assert.equal(response.headers.get("X-Brinedew-Static-Route"), "public-edge")
  assert.match(response.headers.get("Content-Security-Policy"), /default-src 'self'/)
})

test("public edge fails closed when the canonical Pages deployment is unavailable", async () => {
  globalThis.fetch = async () => {
    throw new Error("upstream unavailable")
  }
  const stateful = statefulSpy()

  const response = await worker.fetch(
    new Request("https://brinedew.bio/"),
    { THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE: stateful.binding },
    {},
  )

  assert.equal(response.status, 503)
  assert.equal(response.headers.get("Cache-Control"), "no-store")
  assert.equal(stateful.calls.length, 0)
  assert.match(await response.text(), /temporarily unavailable/)
})

test("public edge maps GeneGuessr root and privacy documents to their own Pages artifacts", async () => {
  const upstreamCalls = []
  globalThis.fetch = async (url) => {
    upstreamCalls.push(String(url))
    return new Response(
      '<html><head></head><body data-slug="apps/geneguessr/index"></body></html>',
      {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      },
    )
  }
  const stateful = statefulSpy()
  const env = { THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE: stateful.binding }

  const root = await worker.fetch(new Request("https://geneguessr.brinedew.bio/"), env, {})
  const privacy = await worker.fetch(
    new Request("https://geneguessr.brinedew.bio/privacy"),
    env,
    {},
  )

  assert.deepEqual(upstreamCalls, [
    "https://brinedew-bio.pages.dev/apps/geneguessr/index.html",
    "https://brinedew-bio.pages.dev/apps/geneguessr/privacy.html",
  ])
  assert.equal(stateful.calls.length, 0)
  assert.match(root.headers.get("Content-Security-Policy"), /'unsafe-eval'/)
  assert.doesNotMatch(privacy.headers.get("Content-Security-Policy"), /'unsafe-eval'/)
})

test("public edge preserves the main site's missing privacy document instead of leaking Iconoplasm", async () => {
  globalThis.fetch = async (url) => {
    assert.equal(String(url), "https://brinedew-bio.pages.dev/privacy")
    return new Response("Not found", {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    })
  }
  const stateful = statefulSpy()

  const response = await worker.fetch(
    new Request("https://brinedew.bio/privacy"),
    { THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE: stateful.binding },
    {},
  )

  assert.equal(response.status, 404)
  assert.equal(stateful.calls.length, 0)
  assert.equal(await response.text(), "Not found")
})

test("public edge canonicalizes document aliases without invoking either upstream", async () => {
  globalThis.fetch = async () => {
    throw new Error("Pages must not be fetched for a canonical redirect")
  }
  const stateful = statefulSpy()
  const env = { THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE: stateful.binding }

  const www = await worker.fetch(
    new Request("https://www.brinedew.bio/index.html?source=alias"),
    env,
    {},
  )
  const geneguessr = await worker.fetch(
    new Request("https://geneguessr.brinedew.bio/apps/geneguessr/privacy/"),
    env,
    {},
  )

  assert.equal(www.status, 301)
  assert.equal(www.headers.get("Location"), "https://brinedew.bio/?source=alias")
  assert.equal(geneguessr.status, 301)
  assert.equal(geneguessr.headers.get("Location"), "https://geneguessr.brinedew.bio/privacy")
  assert.equal(stateful.calls.length, 0)
})

test("public document responses inject analytics consent only when the visitor requires it", async () => {
  globalThis.fetch = async () =>
    new Response("<html><head></head><body></body></html>", {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    })
  const stateful = statefulSpy()
  const env = { THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE: stateful.binding }

  const requiresConsent = await worker.fetch(
    new Request("https://brinedew.bio/", {
      headers: { "CF-IPCountry": "DE" },
    }),
    env,
    {},
  )
  const alreadyConsented = await worker.fetch(
    new Request("https://brinedew.bio/", {
      headers: {
        "CF-IPCountry": "DE",
        Cookie: "brinedew_analytics_consent=accepted",
      },
    }),
    env,
    {},
  )

  assert.match(await requiresConsent.text(), /__brinedewAnalyticsConsentRequired=true/)
  assert.match(requiresConsent.headers.get("Cache-Control"), /no-transform/)
  assert.doesNotMatch(await alreadyConsented.text(), /__brinedewAnalyticsConsentRequired=true/)
  assert.doesNotMatch(alreadyConsented.headers.get("Cache-Control") || "", /no-transform/)
})

test("public edge proxies apex iconoplasm admin me to the only allowed stateful worker", async () => {
  const calls = []
  const response = await worker.fetch(
    new Request("https://brinedew.bio/api/iconoplasm/admin/me", { method: "GET" }),
    {
      THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE: {
        async fetch(request) {
          calls.push({ url: request.url, method: request.method })
          return Response.json({ ok: true, authenticated: false, is_admin: false })
        },
      },
    },
    {},
  )

  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.ok, true)
  assert.equal(payload?.authenticated, false)
  assert.equal(payload?.is_admin, false)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.url, "https://brinedew.bio/api/iconoplasm/admin/me")
  assert.equal(calls[0]?.method, "GET")
})

test("public edge is a pure proxy when a shared-host request targets Iconoplasm", async () => {
  const calls = []
  const env = {
    THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE: {
      async fetch(request) {
        calls.push({
          url: request.url,
          method: request.method,
        })
        return Response.json({ ok: true, items: [] })
      },
    },
  }

  const response = await worker.fetch(
    new Request("https://iconoplasm.brinedew.bio/api/public/v1/gallery?order=votes"),
    env,
    {},
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.ok, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.url, "https://iconoplasm.brinedew.bio/api/public/v1/gallery?order=votes")
  assert.equal(calls[0]?.method, "GET")
})

test("public edge does not symbol-cache Iconoplasm card artifacts", async (t) => {
  const hadCaches = Object.prototype.hasOwnProperty.call(globalThis, "caches")
  const previousCaches = globalThis.caches
  let cacheMatchCalls = 0
  globalThis.caches = {
    default: {
      async match() {
        cacheMatchCalls += 1
        return Response.json({
          ok: true,
          card: { payload: { symbol: "PRL", portrait: { asset_sha256: "stale-edge-cache" } } },
        })
      },
      async put() {
        throw new Error("public edge must not write symbol-only card cache entries")
      },
    },
  }
  t.after(() => {
    if (hadCaches) globalThis.caches = previousCaches
    else delete globalThis.caches
  })

  let calls = 0
  const env = {
    THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE: {
      async fetch() {
        calls += 1
        return Response.json({
          ok: true,
          snapshot_version: `version-${calls}`,
          card: {
            payload: {
              symbol: "PRL",
              portrait: { asset_sha256: calls === 1 ? "first-stateful" : "second-stateful" },
            },
          },
        })
      },
    },
  }

  const first = await worker.fetch(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/cards/PRL"),
    env,
    {},
  )
  const second = await worker.fetch(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/cards/PRL"),
    env,
    {},
  )
  const firstPayload = await first.json()
  const secondPayload = await second.json()

  assert.equal(cacheMatchCalls, 0)
  assert.equal(calls, 2)
  assert.equal(firstPayload?.card?.payload?.portrait?.asset_sha256, "first-stateful")
  assert.equal(secondPayload?.card?.payload?.portrait?.asset_sha256, "second-stateful")
})
