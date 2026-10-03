import assert from "node:assert/strict"
import test from "node:test"

import worker from "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"

test("an unimplemented AI well-known route is a real 404, not the app shell", async () => {
  const response = await worker.fetch(
    new Request("https://iconoplasm.brinedew.bio/.well-known/ai"),
    {},
    { waitUntil() {} },
  )

  assert.equal(response.status, 404)
  assert.equal(await response.text(), "")
  assert.match(response.headers.get("X-Robots-Tag") || "", /noindex/)
})

test("GeneGuessr admin route stays on its worker instead of the static-site proxy", async () => {
  const response = await worker.fetch(
    new Request("https://geneguessr.brinedew.bio/admin", { method: "GET" }),
    {},
    {},
  )

  assert.equal(response.status, 403)
  assert.match(await response.text(), /Unauthorized/)
})

test("worker-hosted Molstar assets survive an encoded version separator", async () => {
  const originalFetch = globalThis.fetch
  const upstreamCalls = []
  globalThis.fetch = async (url) => {
    upstreamCalls.push(String(url))
    return new Response(".msp-plugin{display:block}", {
      headers: { "Content-Type": "text/css; charset=utf-8" },
    })
  }

  try {
    const response = await worker.fetch(
      new Request(
        "https://geneguessr.brinedew.bio/static/vendor/pdbe-molstar%403.8.0/build/pdbe-molstar.css",
      ),
      {},
      { waitUntil() {} },
    )
    assert.deepEqual(upstreamCalls, [
      "https://cdn.jsdelivr.net/npm/pdbe-molstar@3.8.0/build/pdbe-molstar.css",
    ])
    assert.match(response.headers.get("Content-Type"), /^text\/css/)
    assert.equal(await response.text(), ".msp-plugin{display:block}")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("worker-hosted Molstar initializer comes from the staging Pages source", async () => {
  const originalFetch = globalThis.fetch
  const upstreamCalls = []
  globalThis.fetch = async (url) => {
    upstreamCalls.push(String(url))
    return new Response("window.GeneguessrMolstar = {}", {
      headers: { "Content-Type": "application/javascript" },
    })
  }

  try {
    const response = await worker.fetch(
      new Request(
        "https://geneguessr-api-staging.brinedew.workers.dev/static/geneguessr/molstar-shared.js",
      ),
      {},
      { waitUntil() {} },
    )
    assert.deepEqual(upstreamCalls, [
      "https://brinedew-bio-staging.pages.dev/static/geneguessr/molstar-shared.js",
    ])
    assert.match(response.headers.get("Content-Type"), /application\/javascript/)
    assert.equal(await response.text(), "window.GeneguessrMolstar = {}")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("posted recap repair is reachable only through the admin gate", async () => {
  const response = await worker.fetch(
    new Request("https://brinedew.bio/api/admin/repair-posted-recap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-08-03" }),
    }),
    {},
    { waitUntil() {} },
  )

  assert.equal(response.status, 403)
  assert.deepEqual(await response.json(), { error: "Unauthorized" })
})

test("portrait binaries stay wired even when they arrive through a non-iconoplasm host boundary", async () => {
  const response = await worker.fetch(
    new Request(
      "https://brinedew.bio/portraits/v1/aa/aa11bb22cc33dd44ee55ff6677889900aa11bb22cc33dd44ee55ff6677889900/medium.webp",
      { method: "GET" },
    ),
    {
      ICONOPLASM_PORTRAITS: {
        async get(key) {
          assert.equal(
            key,
            "portraits/v1/aa/aa11bb22cc33dd44ee55ff6677889900aa11bb22cc33dd44ee55ff6677889900/medium.webp",
          )
          return {
            body: "image-bytes",
            httpMetadata: { contentType: "image/webp" },
            httpEtag: "portrait-etag",
          }
        },
      },
    },
    { waitUntil() {} },
  )

  assert.equal(response.status, 200)
  assert.equal(response.headers.get("content-type"), "image/webp")
})

test("retired source portrait aliases return a cacheable 404 instead of the static shell", async () => {
  const response = await worker.fetch(
    new Request("https://iconoplasm.brinedew.bio/portrait/ABI1.webp", { method: "GET" }),
    {
      PUBLIC_RATE_LIMIT_120: {
        async limit() {
          throw new Error("retired portrait aliases must not consume a rate-limit call")
        },
      },
    },
    { waitUntil() {} },
  )

  assert.equal(response.status, 404)
  assert.match(response.headers.get("content-type") || "", /text\/plain/)
  assert.equal(response.headers.get("cache-control"), "public, max-age=86400")
  assert.equal(await response.text(), "Not Found")
})

test("labelled gene-card binaries have the same first-party storage fallback", async () => {
  const key = "gene-cards/v1/S/SOX12/fingerprint/SOX12-iconoplasm-gene-card.png"
  const response = await worker.fetch(
    new Request(`https://iconoplasm.brinedew.bio/${key}`, { method: "GET" }),
    {
      ICONOPLASM_PORTRAITS: {
        async get(requestedKey) {
          assert.equal(requestedKey, key)
          return {
            body: "png-bytes",
            httpMetadata: { contentType: "image/png" },
            httpEtag: "gene-card-etag",
          }
        },
      },
    },
    { waitUntil() {} },
  )

  assert.equal(response.status, 200)
  assert.equal(response.headers.get("content-type"), "image/png")
  assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable")
})

test("iconoplasm admin gallery mutation routes reach the admin gate instead of 404", async () => {
  const mutationPaths = [
    "/api/iconoplasm/admin/publish",
    "/api/iconoplasm/admin/clear-override",
    "/api/iconoplasm/admin/reject",
    "/api/iconoplasm/admin/rollback",
    "/api/iconoplasm/admin/unpublish",
    "/api/iconoplasm/admin/unstale",
    "/api/iconoplasm/admin/unstale-batch",
    "/api/iconoplasm/admin/purge-legacy",
    "/api/iconoplasm/admin/remove-candidate",
  ]

  for (const path of mutationPaths) {
    const response = await worker.fetch(
      new Request(`https://iconoplasm.brinedew.bio${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: "TP53" }),
      }),
      {},
      { waitUntil() {} },
    )

    assert.equal(response.status, 403, `${path} should be gated, not missing`)
    assert.match(await response.text(), /Unauthorized/)
  }
})

// B-972: the operator pages' own policy. Scripts and styles on /admin come only from the
// site itself, so an injected inline script or style cannot run with the admin's cookie.
test("the Iconoplasm admin page has no unsafe-inline or unsafe-eval in script-src and style-src", async () => {
  const policyFor = async (url) => {
    const response = await worker.fetch(new Request(url), {}, { waitUntil() {} })
    return response.headers.get("Content-Security-Policy") || ""
  }
  const admin = await policyFor("https://iconoplasm.brinedew.bio/admin")
  assert.match(admin, /script-src /)
  assert.match(admin, /style-src /)
  assert.doesNotMatch(admin, /(?:script|style)-src[^;]*'unsafe-(?:inline|eval)'/)
  // The control: the host's other responses keep inline scripts, so the check above can fail.
  const publicPolicy = await policyFor("https://iconoplasm.brinedew.bio/.well-known/ai")
  assert.match(publicPolicy, /script-src[^;]*'unsafe-inline'/)
  // Shoelace loads its checkbox, select and dialog icons from data: URLs; without this the
  // Iconoplasm dialogs lose their icons in production.
  assert.match(publicPolicy, /connect-src 'self' data: https:\/\/brinedew\.bio/)
})

// B-972: a logged-in admin's cookie must not let another site, or a form post, change the
// recognition policies. The check runs before the admin check and before any binding is read
// (the env is empty here, so a binding read would throw).
test("admin policy mutations refuse cross-site, foreign-origin and non-JSON requests first", async () => {
  const refused = [
    [
      "cross_site_request_forbidden",
      403,
      {
        "Content-Type": "text/plain",
        Origin: "https://evil.example",
        "Sec-Fetch-Site": "cross-site",
      },
    ],
    [
      "untrusted_origin",
      403,
      { "Content-Type": "application/json", Origin: "https://brinedew.bio.evil.example" },
    ],
    [
      "application_json_required",
      415,
      {
        "Content-Type": "text/plain;charset=UTF-8",
        Origin: "https://iconoplasm.brinedew.bio",
        "Sec-Fetch-Site": "same-origin",
      },
    ],
  ]
  const post = (path, headers) =>
    worker.fetch(
      new Request(`https://iconoplasm.brinedew.bio${path}`, {
        method: "POST",
        headers: { Cookie: "session=admin", ...headers },
        body: JSON.stringify({ terms: ["AMID"], expected_revision: 1 }),
      }),
      {},
      { waitUntil() {} },
    )
  for (const path of [
    "/api/iconoplasm/admin/extension-blocklist",
    "/api/iconoplasm/admin/publication-aliases",
  ]) {
    for (const [code, status, headers] of refused) {
      const response = await post(path, headers)
      assert.equal(response.status, status, `${path}: ${code}`)
      assert.equal((await response.json()).code, code, path)
    }
    // A well-formed request from the site itself gets past admission and stops at the admin check.
    const unauthorized = await post(path, {
      "Content-Type": "application/json",
      Origin: "https://iconoplasm.brinedew.bio",
    })
    assert.equal(unauthorized.status, 403, path)
    assert.equal((await unauthorized.json()).code, "unauthorized", path)
  }
})
