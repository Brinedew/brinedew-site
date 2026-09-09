import assert from "node:assert/strict"
import test from "node:test"

import { createIconoplasmAdminPublicationHandlers } from "./iconoplasm-admin-publication-routes.js"

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  })
}

function publicationServices(overrides = {}) {
  return {
    actor: async () => "admin",
    coerceBoolean: (value, fallback = false) => (value == null ? fallback : Boolean(value)),
    fetchCatalogStateRows: async () => [],
    fetchEssenceStateRows: async () => [],
    fetchManifestationStateRows: async () => [],
    isAdmin: async () => true,
    json,
    mutationLimiterSnapshot: () => ({ active: true }),
    normalizeCatalogPayloadItem: (item) => item,
    normalizeEssencePayload: (item) => item,
    normalizeSymbol: (value) =>
      String(value || "")
        .trim()
        .toUpperCase(),
    prepareGeneEssenceUpsertStatement: (env, essence, actorId, source) =>
      env.ICONOPLASM_DB.prepare("UPSERT ESSENCE").bind(essence.gene_symbol, actorId, source),
    publishCatalogArtifact: async () => ({ ok: true }),
    rebuildSharedGeneDiscoveryRollup: async () => ({ ok: true, count: 0 }),
    sanitizeText: (value, limit) => String(value || "").slice(0, limit),
    syncAdminReadModels: async () => ({ ok: true }),
    ...overrides,
  }
}

async function responseFrom(handler, { body = {}, env = {}, method = "POST" } = {}) {
  return handler({
    request: new Request("https://iconoplasm.brinedew.bio/internal-test", {
      method,
      ...(method === "GET" || method === "HEAD"
        ? {}
        : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    }),
    env,
    done: async (_route, response) => response,
  })
}

test("publication handler factory rejects incomplete composition roots", () => {
  const services = publicationServices()
  delete services.syncAdminReadModels
  assert.throws(
    () => createIconoplasmAdminPublicationHandlers(services),
    /service is missing: syncAdminReadModels/,
  )
})

test("publication handler registry is immutable and domain-complete", () => {
  const handlers = createIconoplasmAdminPublicationHandlers(publicationServices())
  assert.equal(Object.isFrozen(handlers), true)
  assert.deepEqual(Object.keys(handlers).sort(), [
    "admin_publication.catalog_publish",
    "admin_publication.catalog_reconcile",
    "admin_publication.catalog_state",
    "admin_publication.catalog_upsert",
    "admin_publication.essence_state",
    "admin_publication.essence_upsert",
    "admin_publication.manifestation_state",
    "admin_publication.manifestation_upsert",
    "admin_publication.shared_discoveries",
  ])
})

test("catalog and essence state require explicit valid scopes without touching D1 otherwise", async () => {
  const calls = []
  const handlers = createIconoplasmAdminPublicationHandlers(
    publicationServices({
      fetchCatalogStateRows: async (_env, symbols) => {
        calls.push({ route: "catalog", symbols })
        return []
      },
      fetchEssenceStateRows: async (_env, symbols) => {
        calls.push({ route: "essence", symbols })
        return []
      },
    }),
  )
  const forbiddenDb = new Proxy({}, { get: () => assert.fail("invalid state scope touched D1") })
  for (const handler of [
    handlers["admin_publication.catalog_state"],
    handlers["admin_publication.essence_state"],
  ]) {
    for (const body of [{}, { symbols: null }, { symbols: [] }, { symbols: ["", null] }]) {
      const response = await responseFrom(handler, { body, env: { ICONOPLASM_DB: forbiddenDb } })
      assert.equal(response.status, 400)
    }
  }
  assert.deepEqual(calls, [])

  const getResponse = await responseFrom(handlers["admin_publication.catalog_state"], {
    method: "GET",
    env: { ICONOPLASM_DB: forbiddenDb },
  })
  assert.equal(getResponse.status, 400)
  assert.deepEqual(calls, [])

  const symbols = Array.from({ length: 1001 }, (_, index) => `GENE${index}`)
  for (const [route, handler] of [
    ["catalog", handlers["admin_publication.catalog_state"]],
    ["essence", handlers["admin_publication.essence_state"]],
  ]) {
    const response = await responseFrom(handler, {
      body: { symbols: [" tp53 ", "TP53", ...symbols] },
      env: { ICONOPLASM_DB: {} },
    })
    assert.equal(response.status, 200)
    assert.equal(calls.at(-1).route, route)
    assert.equal(calls.at(-1).symbols[0], "TP53")
    assert.deepEqual(calls.at(-1).symbols.slice(0, 2), ["TP53", "GENE0"])
    assert.equal(calls.at(-1).symbols.length, 1002)
  }
})

test("catalog upsert owns its write boundary and can defer read models", async () => {
  const writes = []
  let readModelCalls = 0
  const handlers = createIconoplasmAdminPublicationHandlers(
    publicationServices({
      syncAdminReadModels: async () => {
        readModelCalls += 1
      },
    }),
  )
  const response = await responseFrom(handlers["admin_publication.catalog_upsert"], {
    body: {
      defer_read_models: true,
      items: [
        {
          gene_symbol: "TP53",
          full_name: "tumor protein p53",
          uniprot: "P04637",
          color_hex: "#35353C",
          tmh: false,
          aliases_json: "[]",
        },
      ],
    },
    env: {
      ICONOPLASM_DB: {
        prepare(sql) {
          return {
            bind(...args) {
              return { sql, args }
            },
          }
        },
        async batch(statements, options) {
          assert.deepEqual(options, { maxRowsWritten: 4 })
          writes.push(...statements)
        },
      },
    },
  })
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(response.headers.get("Cache-Control"), "no-store")
  assert.equal(payload.processed, 1)
  assert.equal(writes.length, 1)
  assert.equal(readModelCalls, 0)
})

test("catalog upsert rejects request shapes that are too heavy for one Worker request", async () => {
  let writes = 0
  const handlers = createIconoplasmAdminPublicationHandlers(publicationServices())
  const items = Array.from({ length: 101 }, (_, index) => ({
    gene_symbol: `GENE${index}`,
    full_name: `Gene ${index}`,
    aliases_json: "[]",
  }))

  const response = await responseFrom(handlers["admin_publication.catalog_upsert"], {
    body: { defer_read_models: true, items },
    env: {
      ICONOPLASM_DB: {
        prepare(sql) {
          return {
            bind(...args) {
              return {
                async run() {
                  writes += 1
                  return { sql, args }
                },
              }
            },
          }
        },
        async batch() {
          writes += 1
        },
      },
    },
  })

  assert.equal(response.status, 400)
  assert.match((await response.json()).error, /max 100/)
  assert.equal(writes, 0)
})

test("essence upsert uses quota-reserved bounded transactions and can defer read models", async () => {
  const transactions = []
  let readModelCalls = 0
  const handlers = createIconoplasmAdminPublicationHandlers(
    publicationServices({
      syncAdminReadModels: async () => {
        readModelCalls += 1
      },
    }),
  )
  const items = Array.from({ length: 25 }, (_, index) => ({
    gene_symbol: `GENE${index}`,
    full_name: `Gene ${index}`,
  }))

  const response = await responseFrom(handlers["admin_publication.essence_upsert"], {
    body: { defer_read_models: true, items },
    env: {
      ICONOPLASM_DB: {
        prepare(sql) {
          return {
            bind(...args) {
              return { sql, args }
            },
          }
        },
        async batch(statements, options) {
          transactions.push({ statements, options })
        },
      },
    },
  })
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.processed, 25)
  assert.deepEqual(
    transactions.map(({ statements, options }) => ({
      size: statements.length,
      maxRowsWritten: options.maxRowsWritten,
    })),
    [
      { size: 10, maxRowsWritten: 40 },
      { size: 10, maxRowsWritten: 40 },
      { size: 5, maxRowsWritten: 20 },
    ],
  )
  assert.equal(readModelCalls, 0)
})

test("manifestation upsert changes only manifestation columns in bounded transactions", async () => {
  const transactions = []
  let readModelCalls = 0
  const handlers = createIconoplasmAdminPublicationHandlers(
    publicationServices({
      normalizeEssencePayload: (item, fallbackSymbol) => ({
        gene_symbol: fallbackSymbol,
        manifestation: String(item.manifestation || ""),
        manifestation_tags: String(item.manifestation_tags || ""),
        manifestation_fields_json: String(item.manifestation_fields_json || ""),
        sample_label: String(item.sample_label || ""),
        sample_number: item.sample_number ?? null,
        sample_text_hash: String(item.sample_text_hash || ""),
      }),
      syncAdminReadModels: async () => {
        readModelCalls += 1
      },
    }),
  )
  const items = Array.from({ length: 25 }, (_, index) => ({
    symbol: `gene${index}`,
    manifestation: `Manifestation ${index}`,
  }))

  const response = await responseFrom(handlers["admin_publication.manifestation_upsert"], {
    body: { defer_read_models: true, items },
    env: {
      ICONOPLASM_DB: {
        prepare(sql) {
          assert.match(sql, /^UPDATE icono_gene_essence SET/)
          assert.doesNotMatch(sql, /full_name|skin_hex|aesthetics_json/)
          return {
            bind(...args) {
              return { sql, args }
            },
          }
        },
        async batch(statements, options) {
          transactions.push({ statements, options })
        },
      },
    },
  })
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.processed, 25)
  assert.deepEqual(
    transactions.map(({ statements, options }) => ({
      size: statements.length,
      maxRowsWritten: options.maxRowsWritten,
    })),
    [
      { size: 10, maxRowsWritten: 40 },
      { size: 10, maxRowsWritten: 40 },
      { size: 5, maxRowsWritten: 20 },
    ],
  )
  assert.equal(readModelCalls, 0)
})

test("manifestation state is authenticated, bounded, and no-store", async () => {
  const requested = []
  const handlers = createIconoplasmAdminPublicationHandlers(
    publicationServices({
      fetchManifestationStateRows: async (_env, symbols) => {
        requested.push(...symbols)
        return [{ symbol: "TP53", hash: "abc" }]
      },
    }),
  )
  const response = await responseFrom(handlers["admin_publication.manifestation_state"], {
    body: { symbols: ["TP53"] },
    env: { ICONOPLASM_DB: {} },
  })

  assert.equal(response.status, 200)
  assert.equal(response.headers.get("Cache-Control"), "no-store")
  assert.deepEqual(requested, ["TP53"])
  assert.deepEqual((await response.json()).rows, [{ symbol: "TP53", hash: "abc" }])
})

test("catalog reconcile deletes only explicit normalized symbols", async () => {
  const deleted = []
  const handlers = createIconoplasmAdminPublicationHandlers(publicationServices())
  const response = await responseFrom(handlers["admin_publication.catalog_reconcile"], {
    body: { delete_symbols: [" tp53 ", "TP53"], defer_read_models: true },
    env: {
      ICONOPLASM_DB: {
        prepare(sql) {
          return {
            bind(symbol) {
              return {
                async run() {
                  deleted.push({ sql, symbol })
                },
              }
            },
          }
        },
      },
    },
  })

  assert.equal(response.status, 200)
  assert.equal((await response.json()).deleted, 1)
  assert.deepEqual(
    deleted.map((entry) => entry.symbol),
    ["TP53"],
  )
})

test("catalog reconcile rejects the unadmitted keep-symbols whole-state mode", async () => {
  const handlers = createIconoplasmAdminPublicationHandlers(publicationServices())
  const response = await responseFrom(handlers["admin_publication.catalog_reconcile"], {
    body: { keep_symbols: ["TP53"] },
    env: {
      ICONOPLASM_DB: new Proxy({}, { get: () => assert.fail("keep scope touched D1") }),
    },
  })
  assert.equal(response.status, 400)
  assert.match((await response.json()).error, /not admitted/)
})
