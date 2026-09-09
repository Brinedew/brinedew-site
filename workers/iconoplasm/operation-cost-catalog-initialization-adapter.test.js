import assert from "node:assert/strict"
import test from "node:test"
import { createHash, webcrypto } from "node:crypto"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { createCatalogInitializationCostAdapter } from "./operation-cost-catalog-initialization-adapter.js"
import {
  initializePublishedHydratedCatalog,
  mergePublishedPortraitRefsIntoArtifact,
} from "../iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

if (!globalThis.crypto) globalThis.crypto = webcrypto
const identities = { executable_sha256: "a".repeat(64), schema_sha256: "b".repeat(64) }

test("catalog inspection cannot send writes, and bad inputs expose only fixed stage codes", async () => {
  let writes = 0
  const malicious = createCatalogInitializationCostAdapter({
    ...identities,
    kv: {
      put: async () => {
        writes++
      },
    },
    initialize: async (kv) => kv.put("iconoplasm:hydrated-catalog-artifact:test", "{}"),
  })
  await assert.rejects(
    malicious.dispatch(await malicious.prepare({ inspect_only: true })),
    /COST_KV_WRITE_BOUND_EXCEEDED/,
  )
  assert.equal(writes, 0)
  for (const [raw, code] of [
    [null, "COST_CATALOG_MANIFEST_UNAVAILABLE_OR_OVERSIZED"],
    ["private invalid content", "COST_CATALOG_MANIFEST_JSON_INVALID"],
    ["null", "COST_CATALOG_MANIFEST_INVALID"],
  ]) {
    await assert.rejects(
      initializePublishedHydratedCatalog({ get: async () => raw }, { inspectOnly: true }),
      (error) => error.code === code && !error.message.includes("private invalid content"),
    )
  }
})

test("catalog initialization rejects provider amplification before the extra KV call", async () => {
  for (const action of ["get", "put"]) {
    let calls = 0
    const kv = {
      [action]: async () => {
        calls++
        return "{}"
      },
    }
    const adapter = createCatalogInitializationCostAdapter({
      ...identities,
      kv,
      initialize: async (scoped) => {
        for (let i = 0; i < (action === "get" ? 6 : 2); i++)
          await scoped[action]("iconoplasm:hydrated-catalog-artifact:test", "{}")
      },
    })
    await assert.rejects(adapter.prepare({ max_reads: 100 }), /INITIALIZATION_INVALID/)
    assert.equal(calls, 0)
    await assert.rejects(adapter.dispatch(await adapter.prepare({})), /BOUND_EXCEEDED/)
    assert.equal(calls, action === "get" ? 5 : 1)
  }
})

test("catalog initialization validates retained identities and never changes either publication pointer", async () => {
  const refs = [{ symbol: "TP53", asset_sha256: "c".repeat(64) }]
  const fingerprint = {
    published_count: 1,
    latest: createHash("sha256")
      .update(`TP53:${"c".repeat(64)}`)
      .digest("hex"),
  }
  const store = new Map([
    ["iconoplasm:catalog-manifest", JSON.stringify({ current_hash: "testcatalog" })],
    ["iconoplasm:published-portrait-fingerprint:v3", JSON.stringify({ fingerprint })],
    [`iconoplasm:published-portrait-refs:v3-1-${fingerprint.latest}`, JSON.stringify(refs)],
    [
      "iconoplasm:catalog:testcatalog",
      JSON.stringify({
        schema_version: 4,
        gene_count: 1,
        genes: [{ s: "TP53", n: "tumor protein p53" }],
      }),
    ],
  ])
  const original = new Map(store)
  const kv = {
    get: async (key) => store.get(key) ?? null,
    put: async (key, value) => store.set(key, value),
  }
  const adapter = createCatalogInitializationCostAdapter({
    ...identities,
    kv,
    initialize: initializePublishedHydratedCatalog,
  })
  const prepared = await adapter.prepare({})
  const inspection = await adapter.dispatch(await adapter.prepare({ inspect_only: true }))
  assert.equal(inspection.result.changed, true)
  assert.equal(inspection.actual.kv_writes, 0)
  assert.equal(inspection.actual.kv_reads, 5)
  assert.deepEqual(store, original)
  const first = await adapter.dispatch(prepared)
  assert.equal(first.result.changed, true)
  assert.deepEqual(first.actual, {
    rows_read: 0,
    rows_written: 0,
    requests: 1,
    kv_reads: 5,
    kv_writes: 1,
    kv_deletes: 0,
    kv_lists: 0,
  })
  for (const [key, value] of original) assert.equal(store.get(key), value)
  const second = await adapter.dispatch(prepared)
  assert.equal(second.result.changed, false)
  assert.equal(second.actual.kv_writes, 0)
  store.set(
    `iconoplasm:published-portrait-refs:v3-1-${fingerprint.latest}`,
    JSON.stringify([{ symbol: "TP53", asset_sha256: "d".repeat(64) }]),
  )
  await assert.rejects(adapter.dispatch(prepared), /REFERENCE_DIGEST_DIFFERS/)
  assert.equal(
    store.get("iconoplasm:catalog-manifest"),
    original.get("iconoplasm:catalog-manifest"),
  )
})

test(
  "real workerd initializes a 20,000-gene hydrated catalog within five reads and one write",
  { timeout: 90000 },
  async (t) => {
    const req = createRequire(import.meta.url)
    const wrangler = createRequire(req.resolve("wrangler/package.json"))
    const { Miniflare, convertV4MiniflareOptions } = wrangler("miniflare")
    const { build } = wrangler("esbuild")
    const bundled = await build({
      stdin: {
        contents: `import {initializePublishedHydratedCatalog} from './workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js';
    import {createCatalogInitializationCostAdapter} from './workers/iconoplasm/operation-cost-catalog-initialization-adapter.js';
    export default {async fetch(_request,env){const adapter=createCatalogInitializationCostAdapter({kv:env.KV,initialize:initializePublishedHydratedCatalog,executable_sha256:'${identities.executable_sha256}',schema_sha256:'${identities.schema_sha256}'});return Response.json(await adapter.dispatch(await adapter.prepare({})));}}`,
        resolveDir: fileURLToPath(new URL("../../", import.meta.url)),
        loader: "js",
      },
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      conditions: ["workerd", "worker", "browser"],
      external: ["cloudflare:workers", "node:*"],
      logLevel: "silent",
    })
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: bundled.outputFiles[0].text,
        compatibilityDate: "2026-08-01",
        compatibilityFlags: ["nodejs_compat"],
        kvNamespaces: ["KV"],
      }),
    )
    try {
      const kv = await runtime.getKVNamespace("KV")
      const refs = Array.from({ length: 20000 }, (_, i) => ({
        symbol: `G${String(i).padStart(5, "0")}`,
        asset_sha256: createHash("sha256").update(String(i)).digest("hex"),
      }))
      const fingerprint = {
        published_count: refs.length,
        latest: createHash("sha256")
          .update(refs.map((r) => `${r.symbol}:${r.asset_sha256}`).join("|"))
          .digest("hex"),
      }
      const source = mergePublishedPortraitRefsIntoArtifact(
        {
          schema_version: 4,
          gene_count: refs.length,
          genes: refs.map((r) => ({ s: r.symbol, n: `Published gene ${r.symbol}` })),
        },
        refs,
      )
      const raw = JSON.stringify(source)
      await kv.put(
        "iconoplasm:catalog-manifest",
        JSON.stringify({ current_hash: "capacitycatalog" }),
      )
      await kv.put("iconoplasm:published-portrait-fingerprint:v3", JSON.stringify({ fingerprint }))
      await kv.put(
        `iconoplasm:published-portrait-refs:v3-20000-${fingerprint.latest}`,
        JSON.stringify(refs),
      )
      await kv.put("iconoplasm:catalog:capacitycatalog", raw)
      const response = await runtime.dispatchFetch("http://local/initialize")
      assert.equal(response.status, 200, await response.clone().text())
      const first = await response.json()
      assert.equal(first.result.gene_count, 20000)
      assert.equal(first.actual.kv_reads, 5)
      assert.equal(first.actual.kv_writes, 1)
      const repeated = await (await runtime.dispatchFetch("http://local/initialize")).json()
      assert.equal(repeated.actual.kv_reads, 5)
      assert.equal(repeated.actual.kv_writes, 0)
      t.diagnostic(
        JSON.stringify({
          genes: refs.length,
          artifact_bytes: Buffer.byteLength(raw),
          first: first.actual,
          repeated: repeated.actual,
        }),
      )
    } finally {
      await runtime.dispose()
    }
  },
)
