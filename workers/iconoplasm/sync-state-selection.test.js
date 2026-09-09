import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { createRequire } from "node:module"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import {
  CATALOG_STATE_SCOPED_SQL,
  ESSENCE_STATE_SCOPED_SQL,
  readCatalogStateRows,
  readEssenceStateRows,
} from "./sync-state-selection.js"
import { createOperationCostD1Meter } from "./operation-cost-d1-meter.js"
import { createIconoplasmAdminPublicationHandlers } from "../iconoplasm-admin-publication-routes.js"

const require = createRequire(import.meta.url)
const { Miniflare, convertV4MiniflareOptions } = createRequire(
  require.resolve("wrangler/package.json"),
)("miniflare")

test(
  "scoped state reads retain exact membership above 1000 keys beside unrelated growth",
  { timeout: 120000 },
  async (t) => {
    const schema = new DatabaseSync(":memory:")
    const migrations = new URL("../../migrations-iconoplasm/", import.meta.url)
    for (const file of readdirSync(migrations)
      .filter((name) => name.endsWith(".sql"))
      .sort())
      schema.exec(readFileSync(new URL(file, migrations), "utf8"))
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: "export default {fetch(){return new Response('state selection cost')}}",
        compatibilityDate: "2026-08-01",
        d1Databases: ["DB"],
      }),
    )
    try {
      const db = await runtime.getD1Database("DB")
      for (const [table, query, read] of [
        ["icono_gene_catalog", CATALOG_STATE_SCOPED_SQL, readCatalogStateRows],
        ["icono_gene_essence", ESSENCE_STATE_SCOPED_SQL, readEssenceStateRows],
      ]) {
        const definition = schema
          .prepare("SELECT sql FROM sqlite_schema WHERE name=?")
          .get(table).sql
        await db.prepare(definition).run()
        const plan = schema.prepare("EXPLAIN QUERY PLAN " + query).all('["G00001","G00002"]')
        assert.ok(
          plan.some(
            (row) =>
              row.detail.includes("SEARCH") && row.detail.includes(`sqlite_autoindex_${table}_1`),
          ),
        )
        assert.ok(!plan.some((row) => row.detail.includes(`SCAN ${table}`)))
        await db
          .prepare(
            `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<25000)
        INSERT INTO ${table}(gene_symbol,full_name) SELECT printf('G%05d',n),'Selected' FROM ids`,
          )
          .run()
        const receipt = async (count) => {
          const wanted = Array.from(
            { length: count },
            (_, n) => `G${String(n + 1).padStart(5, "0")}`,
          )
          const meter = createOperationCostD1Meter(db)
          const rows = await read(meter.db, wanted.slice().reverse())
          assert.deepEqual(
            rows.map((row) => row.gene_symbol),
            wanted,
          )
          const cost = meter.finish()
          assert.equal(cost.rows_written, 0)
          assert.ok(cost.rows_read <= 2 * count, JSON.stringify({ table, count, cost }))
          return cost.rows_read
        }
        const before = await receipt(1001)
        await db
          .prepare(
            `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<60000)
        INSERT INTO ${table}(gene_symbol,full_name) SELECT printf('UNRELATED%05d',n),'Unrequested' FROM ids`,
          )
          .run()
        assert.equal(await receipt(1001), before)
        const maximum = await receipt(25000)
        const small = await receipt(1)
        const meter = createOperationCostD1Meter(db)
        assert.deepEqual(await read(meter.db, []), [])
        assert.equal(meter.finish().rows_read, 0)
        const deduped = await read(db, ["G00001", "MISSING", "G00001"])
        assert.deepEqual(
          deduped.map((row) => row.gene_symbol),
          ["G00001"],
        )
        await assert.rejects(read(db, Array(25001).fill("G00001")), /25000/)
        t.diagnostic(
          JSON.stringify({
            table,
            one: small,
            keys1001: before,
            keys25000: maximum,
            unrelated: 60000,
          }),
        )
      }
    } finally {
      schema.close()
      await runtime.dispose()
    }
  },
)

test(
  "catalog-state handler completes scoped repeat checks at the same D1 cost after unrelated growth",
  { timeout: 120000 },
  async () => {
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: "export default {fetch(){return new Response('catalog state cost')}}",
        compatibilityDate: "2026-08-01",
        d1Databases: ["DB"],
      }),
    )
    try {
      const db = await runtime.getD1Database("DB")
      await db
        .prepare(
          `CREATE TABLE icono_gene_catalog (
            gene_symbol TEXT PRIMARY KEY, full_name TEXT, uniprot TEXT,
            color_hex TEXT, tmh INTEGER, aliases_json TEXT
          )`,
        )
        .run()
      await db
        .prepare(
          `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<19023)
           INSERT INTO icono_gene_catalog(gene_symbol,full_name,aliases_json)
           SELECT printf('G%05d',n),'Selected','[]' FROM ids`,
        )
        .run()
      const handlers = createIconoplasmAdminPublicationHandlers({
        actor: async () => "admin",
        coerceBoolean: (value, fallback = false) => (value == null ? fallback : Boolean(value)),
        fetchCatalogStateRows: async (env, symbols) =>
          (await readCatalogStateRows(env.ICONOPLASM_DB, symbols)).map((row) => ({
            symbol: row.gene_symbol,
            content_hash: "test-hash",
          })),
        fetchEssenceStateRows: async () => [],
        fetchManifestationStateRows: async () => [],
        isAdmin: async () => true,
        json: (data, status = 200, headers = {}) =>
          new Response(JSON.stringify(data), {
            status,
            headers: { "Content-Type": "application/json", ...headers },
          }),
        mutationLimiterSnapshot: () => ({}),
        normalizeCatalogPayloadItem: (item) => item,
        normalizeEssencePayload: (item) => item,
        normalizeSymbol: (value) =>
          String(value || "")
            .trim()
            .toUpperCase(),
        prepareGeneEssenceUpsertStatement: () => {
          throw new Error("unused")
        },
        publishCatalogArtifact: async () => ({}),
        rebuildSharedGeneDiscoveryRollup: async () => ({}),
        sanitizeText: (value) => String(value || ""),
        syncAdminReadModels: async () => ({}),
      })
      const request = () =>
        new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/catalog/state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbols: ["G00001"] }),
        })
      const run = async () => {
        const meter = createOperationCostD1Meter(db)
        const response = await handlers["admin_publication.catalog_state"]({
          request: request(),
          env: { ICONOPLASM_DB: meter.db },
          done: async (_route, result) => result,
        })
        assert.equal(response.status, 200)
        assert.deepEqual(
          (await response.json()).rows.map((row) => row.symbol),
          ["G00001"],
        )
        return meter.finish()
      }
      const before = await run()
      await db
        .prepare(
          `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<60000)
           INSERT INTO icono_gene_catalog(gene_symbol,full_name,aliases_json)
           SELECT printf('UNRELATED%05d',n),'Unrelated','[]' FROM ids`,
        )
        .run()
      const repeat = await run()
      assert.equal(before.rows_written, 0)
      assert.equal(repeat.rows_written, 0)
      assert.equal(before.rows_read, 2)
      assert.equal(repeat.rows_read, before.rows_read)
      assert.ok(repeat.rows_read <= 2, JSON.stringify({ before, repeat }))
    } finally {
      await runtime.dispose()
    }
  },
)
