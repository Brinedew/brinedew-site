import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { iconoplasmGeneDiscoveryStateForPath } from "./iconoplasm-gene-discovery-worker.js"
import { iconoplasmPublishedGeneRecordIsDiscoveryCandidate } from "./iconoplasm-gene-discovery.js"
import { iconoplasmGeneHtmlCacheKeyForTest } from "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"
import {
  resetIconoplasmRuntimeCachesForTest,
  syncPublishedGeneRouteMembershipAfterPublicationForTest,
} from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

const PROTECTED_ICONOPLASM_ENTRYPOINTS = Object.freeze([
  "the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js",
  "iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
])

function publishedCanonicalRouteFixture() {
  const kvReads = []
  return {
    env: {
      ICONOPLASM_DB: {
        prepare(sql) {
          assert.match(String(sql), /FROM icono_published_gene_routes/)
          assert.doesNotMatch(String(sql), /icono_publish_state|current_asset_sha256/)
          return {
            bind(symbol) {
              assert.equal(symbol, "TP53")
              return {
                async first() {
                  return {
                    gene_symbol: "TP53",
                    full_name: "tumor protein p53",
                  }
                },
              }
            },
          }
        },
      },
      KV: {
        async get(key) {
          kvReads.push(String(key))
          throw new Error(`canonical route must not read KV: ${String(key)}`)
        },
      },
    },
    kvReads,
  }
}

test("canonical gene discovery uses the indexed publication route without KV reads", async () => {
  resetIconoplasmRuntimeCachesForTest()
  try {
    const fixture = publishedCanonicalRouteFixture()
    const state = await iconoplasmGeneDiscoveryStateForPath(fixture.env, "/gene/TP53")

    assert.equal(state.kind, "canonical")
    assert.equal(state.canonicalSymbol, "TP53")
    assert.equal(state.discoveryCandidate, true)
    assert.equal(iconoplasmPublishedGeneRecordIsDiscoveryCandidate(state.record), true)
    assert.equal(state.record.p, undefined)
    assert.deepEqual(fixture.kvReads, [])
  } finally {
    resetIconoplasmRuntimeCachesForTest()
  }
})

test("publication route membership advances only through the bounded event window", async () => {
  const statements = []
  const env = {
    ICONOPLASM_DB: {
      prepare(sql) {
        const statement = { sql: String(sql), binds: [] }
        statements.push(statement)
        return {
          bind(...binds) {
            statement.binds = binds
            return {
              async run() {
                return { meta: { changes: statements.length } }
              },
            }
          },
        }
      },
    },
  }

  const result = await syncPublishedGeneRouteMembershipAfterPublicationForTest(env, {
    afterEventAt: "2026-08-01 10:00:00",
    throughEventAt: "2026-08-01 10:15:00",
    afterEventId: 410,
    throughEventId: 417,
  })

  assert.deepEqual(result, { inserted: 1, deleted: 2 })
  assert.equal(statements.length, 2)
  assert.match(statements[0].sql, /INSERT OR IGNORE INTO icono_published_gene_routes/)
  assert.match(statements[1].sql, /DELETE FROM icono_published_gene_routes/)
  for (const statement of statements) {
    assert.match(statement.sql, /FROM icono_publish_events/)
    assert.match(statement.sql, /id > \? AND id <= \?/)
    assert.deepEqual(statement.binds.slice(-2), [410, 417])
  }
})

test("published route migration stores identity only and seeds established membership", () => {
  const migration = readFileSync(
    new URL("../migrations-iconoplasm/0059_published_gene_routes.sql", import.meta.url),
    "utf8",
  )
  assert.match(migration, /CREATE TABLE IF NOT EXISTS icono_published_gene_routes/)
  assert.match(migration, /gene_symbol TEXT PRIMARY KEY NOT NULL/)
  assert.match(migration, /SELECT gene_symbol\s+FROM icono_gene_catalog/)
  const tableDefinition = migration.match(
    /CREATE TABLE IF NOT EXISTS icono_published_gene_routes[\s\S]*?WITHOUT ROWID;/,
  )?.[0]
  assert.ok(tableDefinition)
  assert.doesNotMatch(tableDefinition, /asset_sha256|vote|portrait/i)
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

test("gene HTML cache follows the exact card-detail ETag, not route portrait metadata", () => {
  const url = new URL("https://iconoplasm.brinedew.bio/gene/TP53")
  const firstSnapshotVersion = 'W/"site-gene-detail:TP53:17"'
  const nextSnapshotVersion = 'W/"site-gene-detail:TP53:18"'
  const firstKey = iconoplasmGeneHtmlCacheKeyForTest(url, url.pathname, firstSnapshotVersion, {})
  const nextKey = iconoplasmGeneHtmlCacheKeyForTest(url, url.pathname, nextSnapshotVersion, {})

  assert.ok(firstKey)
  assert.ok(nextKey)
  assert.notEqual(firstKey.url, nextKey.url)
  assert.equal(new URL(firstKey.url).searchParams.get("snapshot"), firstSnapshotVersion)
  assert.equal(new URL(nextKey.url).searchParams.get("snapshot"), nextSnapshotVersion)
  assert.equal(new URL(firstKey.url).searchParams.has("portrait"), false)

  const edgeCache = new Map([[firstKey.url, new Response("portrait A")]])
  assert.equal(edgeCache.get(nextKey.url), undefined)
  assert.equal(iconoplasmGeneHtmlCacheKeyForTest(url, url.pathname, "", {}), null)
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
  assert.match(workerSource, /FROM icono_published_gene_routes/)
  assert.doesNotMatch(workerSource, /iconoplasm-web/)
})
