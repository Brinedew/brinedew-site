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
