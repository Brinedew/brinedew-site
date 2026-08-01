import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { iconoplasmGeneDiscoveryStateForPath } from "./iconoplasm-gene-discovery-worker.js"
import { iconoplasmPublishedGeneRecordIsIndexable } from "./iconoplasm-gene-discovery.js"
import { resetIconoplasmRuntimeCachesForTest } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

const PORTRAIT_SHA = "a".repeat(64)
const PROTECTED_ICONOPLASM_ENTRYPOINTS = Object.freeze([
  "the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js",
  "iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
])

function publishedCardCatalogFixture() {
  const kvReads = []
  const card = {
    __complete: true,
    schema_version: "iconoplasm.mobileCard.v1",
    snapshot_version: "cold-v1",
    data_source: "published_card_catalog",
    symbol: "TP53",
    full_name: "tumor protein p53",
    portrait: { status: "published", asset_sha256: PORTRAIT_SHA },
    field_status: {},
    payload: {
      symbol: "TP53",
      full_name: "tumor protein p53",
      portrait: { status: "published", asset_sha256: PORTRAIT_SHA },
    },
  }
  return {
    env: {
      KV: {
        async get(key) {
          kvReads.push(String(key))
          if (key === "iconoplasm:gallery-version") return JSON.stringify({ current: "cold-v1" })
          if (key === "iconoplasm:card-catalog:cold-v1") {
            return JSON.stringify({
              schema: "iconoplasm.cardCatalog.v1",
              artifact_version: "cold-v1",
              storage: "kv_sharded",
              catalog_gene_count: 1,
              card_count: 1,
              shard_count: 1,
              shards: [
                {
                  index: 0,
                  key: "iconoplasm:card-catalog-shard:cold-v1:0",
                  artifact_version: "cold-v1",
                  shard_index: 0,
                  first_symbol: "TP53",
                  last_symbol: "TP53",
                  card_count: 1,
                },
              ],
            })
          }
          if (key === "iconoplasm:card-catalog-shard:cold-v1:0") {
            return JSON.stringify({
              schema: "iconoplasm.cardCatalog.v1",
              artifact_version: "cold-v1",
              shard_index: 0,
              cards: [card],
            })
          }
          throw new Error(`canonical route must not read unexpected KV key: ${String(key)}`)
        },
      },
    },
    kvReads,
  }
}

test("canonical gene discovery uses the published card catalog on a cold route", async () => {
  resetIconoplasmRuntimeCachesForTest()
  try {
    const fixture = publishedCardCatalogFixture()
    const state = await iconoplasmGeneDiscoveryStateForPath(fixture.env, "/gene/TP53")

    assert.equal(state.kind, "canonical")
    assert.equal(state.canonicalSymbol, "TP53")
    assert.equal(state.indexable, true)
    assert.equal(iconoplasmPublishedGeneRecordIsIndexable(state.record), true)
    assert.deepEqual(fixture.kvReads, [
      "iconoplasm:gallery-version",
      "iconoplasm:card-catalog:cold-v1",
      "iconoplasm:card-catalog-shard:cold-v1:0",
    ])
  } finally {
    resetIconoplasmRuntimeCachesForTest()
  }
})

test("gene HTML cache lookup is structurally before payload parsing and shell rendering", () => {
  const source = readFileSync(
    new URL(
      "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js",
      import.meta.url,
    ),
    "utf8",
  )
  const routeStart = source.indexOf("const geneDetailResponseForHtmlCache =")
  const routeEnd = source.indexOf("const response = await fetch(targetUrl.toString()", routeStart)
  assert.ok(routeStart >= 0)
  assert.ok(routeEnd > routeStart)

  const route = source.slice(routeStart, routeEnd)
  const cacheMatch = route.indexOf("caches.default.match")
  const detailProbe = route.indexOf("iconoplasmGeneDetailResponseForHtmlCache(")

  assert.ok(detailProbe >= 0)
  assert.ok(cacheMatch > detailProbe)
  assert.equal(route.slice(0, cacheMatch).includes("iconoplasmGeneCardBootstrapInjection("), false)
})

test("the cold-path refactor preserves the loud single-owner filenames", () => {
  for (const filename of PROTECTED_ICONOPLASM_ENTRYPOINTS) {
    const source = readFileSync(new URL(`./${filename}`, import.meta.url), "utf8")
    assert.match(source, /ARCHITECTURE FENCE \[IPD-007\]/)
  }

  const workerSource = readFileSync(
    new URL(
      "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
      import.meta.url,
    ),
    "utf8",
  )
  assert.match(
    workerSource,
    /resolveIconoplasmCanonicalGeneRouteRecordInsideTheOnlyAllowedStatefulWorkerDoNotDuplicate/,
  )
  assert.match(workerSource, /allowWholeArtifact: false/)
  assert.doesNotMatch(workerSource, /iconoplasm-web/)
})
