import assert from "node:assert/strict"
import test from "node:test"
import "./metadata-delivery.js"
import {
  publishedObjectHash,
  canonicalPublishedJson,
} from "../workers/lib/iconoplasm-published-card-objects.js"
const { createMetadataDelivery } = globalThis.IconoplasmMetadataDelivery
const origin = "https://iconoplasm.brinedew.bio"
const hash = "a".repeat(64)
const portraitSha = "b".repeat(64)
const url = (version = "snapshot1", lane = "genes") =>
  `${origin}/api/public/v1/card-snapshots/${version}/${lane}/TP53`
const init = { headers: { "X-Iconoplasm-Extension-Version": "0.5.2" }, credentials: "same-origin" }
const json = (data) => new Response(JSON.stringify(data))

test("scanner refresh uses one shared public CDN key and validates fallback", async () => {
  const calls = []
  let corrupt = false
  const delivery = createMetadataDelivery({
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      return json({ contract: corrupt && !url.startsWith(origin) ? "bad" : "valid" })
    },
  })
  const valid = (value) => value.contract === "valid"
  assert.equal((await delivery.scannerManifest(valid)).contract, "valid")
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, "https://iconoplasmportraits.b-cdn.net/api/public/v1/catalog/manifest")
  assert.equal(calls[0].options.credentials, "omit")
  assert.equal([...new Headers(calls[0].options.headers)].length, 0)
  corrupt = true
  assert.equal((await delivery.scannerManifest(valid)).contract, "valid")
  assert.equal(calls.length, 3)
  assert.equal(calls[2].url, origin + "/api/public/v1/catalog/manifest")
})

async function v2Fixture() {
  const bodies = new Map()
  async function object(kind, value) {
    const text = canonicalPublishedJson(value)
    const hash = await publishedObjectHash(new TextEncoder().encode(text))
    const key = `published-cards/v2/immutable/${kind}/${hash}.json`
    bodies.set(`/${key}`, text)
    return { hash, key }
  }
  const gene = await object("genes", { symbol: "TP53", full_name: "tumor protein p53" })
  const portrait = await object("portraits", {
    symbol: "TP53",
    portrait: { asset_sha256: portraitSha },
  })
  const index = await object("indexes", {
    schema_version: 2,
    entries: [["TP53", gene.hash, gene.hash, portrait.hash]],
  })
  const manifest = await object("manifests", {
    storage: "bunny_card_catalog_v2",
    shards: [
      {
        first_symbol: "TP53",
        last_symbol: "TP53",
        delivery_indexes: [{ key: index.key, first_symbol: "TP53", last_symbol: "TP53" }],
      },
    ],
  })
  return { bodies, version: `ccv2-${manifest.hash}`, gene, portrait, object }
}

test("v2 healthy lanes share only small hash directories and never call Cloudflare", async () => {
  const fixture = await v2Fixture()
  const calls = []
  const delivery = createMetadataDelivery({
    fetchImpl: async (rawUrl, options) => {
      calls.push({ url: rawUrl, options })
      return new Response(fixture.bodies.get(new URL(rawUrl).pathname), {
        status: fixture.bodies.has(new URL(rawUrl).pathname) ? 200 : 404,
      })
    },
  })
  const [gene, portrait] = await Promise.all([
    delivery.fetch(url(fixture.version), init, 1),
    delivery.fetch(url(fixture.version, "portraits"), init, 1),
  ])
  assert.equal((await gene.json()).gene.symbol, "TP53")
  assert.equal((await portrait.json()).portrait_locator.snapshot_version, fixture.version)
  assert.equal(calls.length, 4)
  assert.ok(calls.every((call) => new URL(call.url).hostname === "iconoplasmportraits.b-cdn.net"))
  assert.ok(
    calls.every((call) => !new Headers(call.options.headers).has("X-Iconoplasm-Extension-Version")),
    "no custom-header CORS preflight on static objects",
  )
  assert.ok(calls.every((call) => !call.url.includes("/shards/")))
})

test("v2 corrupt CDN bytes are rejected before rendering and recover from the exact first-party hash", async () => {
  const fixture = await v2Fixture()
  const calls = []
  const delivery = createMetadataDelivery({
    fetchImpl: async (rawUrl) => {
      calls.push(rawUrl)
      const parsed = new URL(rawUrl)
      if (parsed.hostname.endsWith("b-cdn.net") && parsed.pathname.includes("/genes/"))
        return json({ symbol: "TP53", full_name: "wrong bytes" })
      return new Response(fixture.bodies.get(parsed.pathname))
    },
  })
  const response = await delivery.fetch(url(fixture.version), init, 1)
  assert.equal((await response.json()).gene.full_name, "tumor protein p53")
  assert.equal(calls.filter((call) => call.startsWith(origin)).length, 1)
})

test("each article head check revalidates without reader cache-busting or background polling", async () => {
  let current = "snapshot1"
  const calls = []
  const delivery = createMetadataDelivery({
    fetchImpl: async (rawUrl, options) => {
      calls.push({ url: rawUrl, options })
      return json({ schema_version: 2, current })
    },
  })
  assert.equal((await delivery.current(1)).current, "snapshot1")
  current = "snapshot2"
  assert.equal((await delivery.current(1)).current, "snapshot2")
  assert.equal(calls.length, 2)
  assert.ok(
    calls.every(
      (call) =>
        !new URL(call.url).search && !call.options.cache && call.options.credentials === "omit",
    ),
  )
})
function payload(rawUrl) {
  const path = new URL(rawUrl).pathname
  if (path.endsWith("delivery-index"))
    return {
      schema_version: 1,
      snapshot_version: path.split("/")[5],
      ranges: [["A1BG", "ZZZ", hash]],
    }
  const lane = path.split("/").at(-2)
  return {
    schema_version: 1,
    content_hash: hash,
    symbol: "TP53",
    lane,
    record: { symbol: "TP53", portrait: { asset_sha256: portraitSha } },
  }
}

test("100 tabs in one installation reuse one index and use Bunny for both independent projections", async () => {
  const requests = []
  const delivery = createMetadataDelivery({
    fetchImpl: async (u) => {
      requests.push(u)
      return json(payload(u))
    },
  })
  for (let tab = 0; tab < 100; tab++) {
    const [detail, locator] = await Promise.all([
      delivery.fetch(url(), init, tab),
      delivery.fetch(url("snapshot1", "portraits"), init, tab),
    ])
    assert.equal((await detail.json()).gene.symbol, "TP53")
    assert.equal((await locator.json()).portrait_locator.snapshot_version, "snapshot1")
  }
  assert.equal(requests.filter((u) => u.includes("delivery-index")).length, 1)
  assert.equal(requests.filter((u) => u.startsWith(origin)).length, 1)
  assert.equal(requests.length, 201)
})

test("publication changes bind the new snapshot but reuse unchanged content URLs", async () => {
  const requests = []
  const delivery = createMetadataDelivery({
    fetchImpl: async (u) => {
      requests.push(u)
      return json(payload(u))
    },
  })
  for (const version of ["snapshot1", "snapshot2"]) {
    assert.equal(
      (await (await delivery.fetch(url(version), init, 1)).json()).snapshot_version,
      version,
    )
  }
  assert.equal(requests[1], requests[3])
})

test("Bunny stall hedges; blocked tab does not disable a healthy tab", async () => {
  const requests = []
  let blocked = true
  const delivery = createMetadataDelivery({
    hedgeMs: 5,
    sourceTimeoutMs: 20,
    fetchImpl: async (u) => {
      requests.push(u)
      if (u.includes("b-cdn.net") && blocked) return new Promise(() => {})
      return json(payload(u))
    },
  })
  assert.ok(await delivery.fetch(url(), init, 1))
  blocked = false
  const before = requests.length
  await delivery.fetch(url(), init, 1)
  await delivery.fetch(url(), init, 2)
  assert.ok(requests[before].startsWith(origin))
  assert.ok(requests[before + 1].includes("b-cdn.net"))
})

test("locator succeeds while rich detail stalls, without dependency or uncancelled retries", async () => {
  const delivery = createMetadataDelivery({
    hedgeMs: 5,
    sourceTimeoutMs: 15,
    fetchImpl: async (u) => {
      if (u.includes("/genes/")) return new Promise(() => {})
      return json(payload(u))
    },
  })
  const detail = delivery.fetch(url(), init, 1)
  const locator = await delivery.fetch(url("snapshot1", "portraits"), init, 1)
  assert.equal((await locator.json()).portrait_locator.portrait.asset_sha256, portraitSha)
  assert.equal(await detail, null)
})

test("index timeout and malformed index retain existing snapshot path; failure is briefly coalesced", async () => {
  let requests = 0
  const delivery = createMetadataDelivery({
    indexTimeoutMs: 5,
    fetchImpl: async () => {
      requests++
      return new Promise(() => {})
    },
  })
  assert.equal(await delivery.fetch(url(), init, 1), null)
  assert.equal(await delivery.fetch(url(), init, 2), null)
  assert.equal(requests, 1)
})

test("wrong CDN hash is rejected; exact first-party content recovers", async () => {
  const delivery = createMetadataDelivery({
    fetchImpl: async (u) =>
      json({ ...payload(u), ...(u.includes("b-cdn.net") ? { content_hash: "c".repeat(64) } : {}) }),
  })
  assert.equal((await (await delivery.fetch(url(), init, 1)).json()).gene.symbol, "TP53")
})

test("private, mutation, credentialed and unrelated requests never reach Bunny", async () => {
  const delivery = createMetadataDelivery({
    fetchImpl: async () => {
      throw new Error("must not fetch")
    },
  })
  for (const [u, options] of [
    [`${origin}/api/auth/me`, init],
    [url(), { ...init, method: "POST" }],
    [url(), { ...init, credentials: "include" }],
    [url(), { ...init, headers: { Authorization: "private" } }],
    [url() + "?extra=1", init],
  ])
    assert.equal(await delivery.fetch(u, options, 1), null)
})

test("caller abort during shared index wait is immediate and does not abort another caller", async () => {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const delivery = createMetadataDelivery({
    fetchImpl: async (u) => {
      if (u.includes("delivery-index")) await gate
      return json(payload(u))
    },
  })
  const controller = new AbortController()
  const cancelled = delivery.fetch(url(), { ...init, signal: controller.signal }, 1)
  const survivor = delivery.fetch(url(), init, 2)
  controller.abort()
  await assert.rejects(cancelled, { name: "AbortError" })
  release()
  assert.ok(await survivor)
})

test("100 separate installations share CDN objects, not an in-memory index", async () => {
  const objects = new Set()
  let indexes = 0
  let fills = 0
  for (let user = 0; user < 100; user++) {
    const delivery = createMetadataDelivery({
      fetchImpl: async (u) => {
        if (u.includes("delivery-index")) indexes++
        else if (!objects.has(u)) {
          objects.add(u)
          fills++
        }
        return json(payload(u))
      },
    })
    await Promise.all([
      delivery.fetch(url(), init, user),
      delivery.fetch(url("snapshot1", "portraits"), init, user),
    ])
  }
  assert.equal(indexes, 100)
  assert.equal(fills, 2)
})

test("changed shard hash cannot reuse old vote winner content", async () => {
  const calls = []
  const changed = "d".repeat(64)
  const delivery = createMetadataDelivery({
    fetchImpl: async (u) => {
      calls.push(u)
      const data = payload(u)
      if (u.includes("snapshot2/delivery-index")) data.ranges[0][2] = changed
      if (u.includes(changed)) {
        data.content_hash = changed
        data.record.portrait.asset_sha256 = changed
      }
      return json(data)
    },
  })
  await delivery.fetch(url(), init, 1)
  const response = await delivery.fetch(url("snapshot2", "portraits"), init, 1)
  assert.equal((await response.json()).portrait_locator.portrait.asset_sha256, changed)
  assert.ok(calls.at(-1).includes(changed))
})

test("malformed and oversized indexes fail closed without CDN traffic", async () => {
  for (const bad of [
    {},
    { schema_version: 1, snapshot_version: "snapshot1", ranges: [["ZZZ", "AAA", hash]] },
    { padding: "x".repeat(17000) },
  ]) {
    let calls = 0
    const delivery = createMetadataDelivery({
      fetchImpl: async () => {
        calls++
        return json(bad)
      },
    })
    assert.equal(await delivery.fetch(url(), init, 1), null)
    assert.equal(await delivery.fetch(url(), init, 1), null)
    assert.equal(calls, 1)
  }
})

test("oversized content and stalled response body have bounded recovery", async () => {
  for (const mode of ["oversize", "stall"]) {
    const delivery = createMetadataDelivery({
      hedgeMs: 5,
      sourceTimeoutMs: 15,
      fetchImpl: async (u) => {
        if (!u.includes("b-cdn.net")) return json(payload(u))
        if (mode === "oversize") return json({ ...payload(u), padding: "x".repeat(66000) })
        return new Response(new ReadableStream({ start() {} }))
      },
    })
    assert.ok(await delivery.fetch(url(), init, 1))
  }
})

test("a concurrent lane's source choice cannot end another lane's race early", async () => {
  let releaseDetail
  const detailGate = new Promise((resolve) => {
    releaseDetail = resolve
  })
  const delivery = createMetadataDelivery({
    hedgeMs: 1,
    sourceTimeoutMs: 100,
    fetchImpl: async (u) => {
      if (u.includes("b-cdn.net") && u.includes("/genes/")) {
        await detailGate
        throw new Error("CDN failure")
      }
      if (u.startsWith(origin) && u.includes("/genes/")) {
        await detailGate
        await new Promise((r) => setTimeout(r, 5))
      }
      if (u.includes("b-cdn.net") && u.includes("/portraits/")) throw new Error("CDN failure")
      return json(payload(u))
    },
  })
  const detail = delivery.fetch(url(), init, 1)
  assert.ok(await delivery.fetch(url("snapshot1", "portraits"), init, 1))
  releaseDetail()
  assert.ok(await detail)
})
