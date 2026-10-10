import assert from "node:assert/strict"
import test from "node:test"

import { createIconoplasmAdminPublicationHandlers } from "./iconoplasm-admin-publication-routes.js"
import { PUBLICATION_AFFECTING_ACTIONS } from "./iconoplasm-catalog-dispatch.js"
import { prepareGeneEssenceUpsertStatement } from "./lib/iconoplasm-essence-write.js"
import { iconoplasmDatabase } from "./test-helpers/account-erasure-fixture.js"

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
    "admin_publication.essence_upsert",
    "admin_publication.shared_discoveries",
  ])
})

test("catalog state requires explicit valid scopes without touching D1 otherwise", async () => {
  const calls = []
  const handlers = createIconoplasmAdminPublicationHandlers(
    publicationServices({
      fetchCatalogStateRows: async (_env, symbols) => {
        calls.push({ route: "catalog", symbols })
        return []
      },
    }),
  )
  const forbiddenDb = new Proxy({}, { get: () => assert.fail("invalid state scope touched D1") })
  for (const handler of [handlers["admin_publication.catalog_state"]]) {
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
  for (const [route, handler] of [["catalog", handlers["admin_publication.catalog_state"]]]) {
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

// B-1055: real production schema and triggers, because the event decision is SQL.
// Before this, neither catalogue route wrote a publication event: 600 genes added
// on 10-07 never got a page and 613 removed on 10-08 kept theirs.
function catalogItem(overrides = {}) {
  return {
    gene_symbol: "TP53",
    full_name: "tumor protein p53",
    uniprot: "P04637",
    color_hex: "#35353C",
    tmh: false,
    aliases_json: "[]",
    ...overrides,
  }
}

function catalogEvents(db) {
  return db.database
    .prepare(
      "SELECT gene_symbol, action FROM icono_publish_events WHERE action LIKE 'catalog_%' ORDER BY id",
    )
    .all()
    .map((row) => [row.gene_symbol, row.action])
}

test("catalog upsert records a publication event for a new or changed row, or a gene with no page yet", async () => {
  const db = iconoplasmDatabase()
  let readModelCalls = 0
  const handlers = createIconoplasmAdminPublicationHandlers(
    publicationServices({
      syncAdminReadModels: async () => {
        readModelCalls += 1
      },
    }),
  )
  const upsert = async (items) => {
    const response = await responseFrom(handlers["admin_publication.catalog_upsert"], {
      body: { defer_read_models: true, items },
      env: { ICONOPLASM_DB: db },
    })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("Cache-Control"), "no-store")
    return response.json()
  }

  const first = await upsert([catalogItem()])
  assert.equal(first.processed, 1)
  assert.equal(first.results[0].changed, true, "a new row changed")
  assert.deepEqual(catalogEvents(db), [["TP53", "catalog_upserted"]])
  // Until the publisher gives the gene its page, a resend asks again: the 600 rows
  // of 10-07 sat in D1 with no page, and resending them must make them visible.
  await upsert([catalogItem()])
  assert.deepEqual(catalogEvents(db), [
    ["TP53", "catalog_upserted"],
    ["TP53", "catalog_upserted"],
  ])
  db.database.prepare("INSERT INTO icono_published_gene_routes (gene_symbol) VALUES ('TP53')").run()
  // A resent unchanged row of a gene that has its page schedules nothing, and
  // writes nothing (B-1064: a whole-catalogue resend costs reads, not writes).
  const changesBefore = db.changes
  const resent = await upsert([catalogItem()])
  assert.equal(resent.results[0].changed, false)
  assert.equal(db.changes, changesBefore, "an unchanged row writes nothing")
  assert.equal(catalogEvents(db).length, 2)
  // A changed row does; so does a new gene in the same request, one D1 call for both.
  const calls = db.calls
  const both = await upsert([
    catalogItem({ color_hex: "#28302D" }),
    catalogItem({ gene_symbol: "ADISSP" }),
  ])
  assert.deepEqual(
    both.results.map((row) => [row.symbol, row.changed]),
    [
      ["TP53", true],
      ["ADISSP", true],
    ],
  )
  assert.equal(db.calls - calls, 1)
  assert.deepEqual(catalogEvents(db).slice(2), [
    ["TP53", "catalog_upserted"],
    ["ADISSP", "catalog_upserted"],
  ])
  assert.equal(
    db.database.prepare("SELECT color_hex FROM icono_gene_catalog WHERE gene_symbol = 'TP53'").get()
      .color_hex,
    "#28302D",
  )
  for (const [, action] of catalogEvents(db))
    assert.equal(PUBLICATION_AFFECTING_ACTIONS.includes(action), true)
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

// B-1064: "Sync website now" re-sends Essence for every gene it has no receipt
// for (17,689 of 19,381 on 2026-10-10). Failure modes: an unchanged row still
// rewrites itself and its updated_at index, so the resend spends days of the
// write wall; or a real change is reported unchanged, so its card is never
// rebuilt.
test("an Essence row the site already holds writes nothing and says so", async () => {
  const db = iconoplasmDatabase()
  const handlers = createIconoplasmAdminPublicationHandlers(
    publicationServices({ prepareGeneEssenceUpsertStatement }),
  )
  const send = async (items) => {
    const response = await responseFrom(handlers["admin_publication.essence_upsert"], {
      body: { defer_read_models: true, items },
      env: { ICONOPLASM_DB: db },
    })
    assert.equal(response.status, 200)
    return (await response.json()).results.map((row) => [row.symbol, row.changed])
  }
  const tp53 = {
    gene_symbol: "TP53",
    full_name: "tumor protein p53",
    weight_kg: 43.7,
    age_years: 44,
  }
  const wee1 = { gene_symbol: "WEE1", full_name: "WEE1 G2 checkpoint kinase", weight_kg: 71.6 }

  assert.deepEqual(await send([tp53, wee1]), [
    ["TP53", true],
    ["WEE1", true],
  ])
  const before = db.changes
  assert.deepEqual(await send([tp53, wee1]), [
    ["TP53", false],
    ["WEE1", false],
  ])
  assert.equal(db.changes, before, "a resend of unchanged rows writes nothing")
  assert.deepEqual(await send([{ ...tp53, weight_kg: 43.6 }, wee1]), [
    ["TP53", true],
    ["WEE1", false],
  ])
  assert.equal(
    db.database.prepare("SELECT weight_kg FROM icono_gene_essence WHERE gene_symbol = 'TP53'").get()
      .weight_kg,
    43.6,
  )
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
      { size: 10, maxRowsWritten: 50 },
      { size: 10, maxRowsWritten: 50 },
      { size: 5, maxRowsWritten: 25 },
    ],
  )
  assert.equal(readModelCalls, 0)
})

test("catalog reconcile removes explicit symbols and records each removal, even of a row already gone", async () => {
  const db = iconoplasmDatabase()
  db.database
    .prepare(
      "INSERT INTO icono_gene_catalog (gene_symbol, full_name) VALUES ('TP53', 'tumor protein p53')",
    )
    .run()
  const handlers = createIconoplasmAdminPublicationHandlers(publicationServices())
  const calls = db.calls
  const response = await responseFrom(handlers["admin_publication.catalog_reconcile"], {
    body: { delete_symbols: [" tp53 ", "TP53", "ADGRE4P"], defer_read_models: true },
    env: { ICONOPLASM_DB: db },
  })

  assert.equal(response.status, 200)
  assert.equal((await response.json()).deleted, 2)
  assert.equal(db.database.prepare("SELECT COUNT(*) AS n FROM icono_gene_catalog").get().n, 0)
  // ADGRE4P's row went on 10-08 while its page stayed: the resend still takes the page down.
  assert.deepEqual(catalogEvents(db), [
    ["TP53", "catalog_removed"],
    ["ADGRE4P", "catalog_removed"],
  ])
  // One D1 call per symbol: 1,000 calls per invocation bounds a request at about 1,000 symbols.
  assert.equal(db.calls - calls, 2)
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
