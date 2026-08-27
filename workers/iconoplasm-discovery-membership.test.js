import assert from "node:assert/strict"
import { createRequire } from "node:module"
import test from "node:test"
import {
  parseDiscoveryMembershipSymbols,
  readDiscoveryMembership,
} from "./iconoplasm-discovery-membership.js"

test("membership validates bounded symbols before querying private storage", async () => {
  assert.deepEqual(parseDiscoveryMembershipSymbols('[" ezh2 ","EZH2","TP53"]'), ["EZH2", "TP53"])
  for (const value of ["oops", "{}", "[1]", '[""]', JSON.stringify(Array(129).fill("TP53"))])
    assert.throws(() => parseDiscoveryMembershipSymbols(value))
  assert.deepEqual(await readDiscoveryMembership(null, "reader", []), [])
})

test(
  "membership reads scale with requested genes, not a 20k collection or other users",
  { timeout: 30000 },
  async (t) => {
    const require = createRequire(import.meta.url)
    const { Miniflare, convertV4MiniflareOptions } = createRequire(
      require.resolve("wrangler/package.json"),
    )("miniflare")
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: "export default {fetch(){return new Response('test')}}",
        compatibilityDate: "2026-08-01",
        d1Databases: ["DB"],
      }),
    )
    try {
      const db = await runtime.getD1Database("DB")
      await db
        .prepare(
          "CREATE TABLE icono_gene_discoveries(user_id TEXT,gene_symbol TEXT,PRIMARY KEY(user_id,gene_symbol))",
        )
        .run()
      await db
        .prepare(
          "WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<20000) INSERT INTO icono_gene_discoveries SELECT 'reader', 'G'||i FROM n",
        )
        .run()
      await db.prepare("INSERT INTO icono_gene_discoveries VALUES ('other','PRIVATE')").run()
      let meta
      let sql
      const measuredDb = {
        prepare(query) {
          sql = query
          return {
            bind(...args) {
              return {
                async all() {
                  const result = await db
                    .prepare(query)
                    .bind(...args)
                    .all()
                  meta = result.meta
                  return result
                },
              }
            },
          }
        },
      }
      assert.deepEqual(
        await readDiscoveryMembership(measuredDb, "reader", ["G1", "G19999", "PRIVATE"]),
        ["G1", "G19999"],
      )
      assert.equal(
        meta.rows_read,
        8,
        "three JSON membership keys and two index hits, not 20k shelf rows",
      )
      assert.equal(meta.rows_written, 0)
      const plan = await db
        .prepare("EXPLAIN QUERY PLAN " + sql)
        .bind("reader", JSON.stringify(["G1", "G19999", "PRIVATE"]))
        .all()
      assert.ok(
        plan.results.some((row) =>
          /SEARCH icono_gene_discoveries USING COVERING INDEX/.test(row.detail),
        ),
      )
      t.diagnostic(
        JSON.stringify({
          collectionSize: 20000,
          requested: 3,
          rowsRead: meta.rows_read,
          rowsWritten: meta.rows_written,
        }),
      )
    } finally {
      await runtime.dispose()
    }
  },
)
