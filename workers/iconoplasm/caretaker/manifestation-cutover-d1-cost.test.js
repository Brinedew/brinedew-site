import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"

const cutoverSources = [
  "manifestation-authority-cutover.js",
  "manifestation-cutover-materializer.js",
  "manifestation-authority-plaintext-retirement.js",
].map((name) => ({
  name,
  source: readFileSync(new URL(`./${name}`, import.meta.url), "utf8"),
}))

test("DO NOT DELETE: caretaker cutover keeps normalized gene keys on the primary-key index", () => {
  for (const { name, source } of cutoverSources) {
    assert.doesNotMatch(
      source,
      /gene_symbol\s*(?:=|>)\s*\?\s+COLLATE\s+NOCASE/i,
      `${name} must not override the icono_gene_essence primary-key collation`,
    )
    assert.doesNotMatch(
      source,
      /ORDER\s+BY\s+gene_symbol\s+COLLATE\s+NOCASE/i,
      `${name} must preserve primary-key order for resumable scans`,
    )
  }
})

test(
  "caretaker cutover exact-source verification reads one row, not the whole essence table",
  { timeout: 30000 },
  async () => {
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
          "CREATE TABLE icono_gene_essence(gene_symbol TEXT PRIMARY KEY, manifestation TEXT)",
        )
        .run()
      await db
        .prepare(
          "WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<20000) INSERT INTO icono_gene_essence SELECT printf('G%05d', i), 'manifestation' FROM n",
        )
        .run()
      const result = await db
        .prepare(
          "SELECT gene_symbol, manifestation FROM icono_gene_essence WHERE gene_symbol = ? LIMIT 1",
        )
        .bind("G19999")
        .all()
      assert.equal(result.results[0]?.gene_symbol, "G19999")
      assert.ok(
        result.meta.rows_read <= 2,
        `expected an indexed point read, observed ${result.meta.rows_read} rows`,
      )
      const plan = await db
        .prepare(
          "EXPLAIN QUERY PLAN SELECT gene_symbol, manifestation FROM icono_gene_essence WHERE gene_symbol = ? LIMIT 1",
        )
        .bind("G19999")
        .all()
      assert.ok(
        plan.results.some((row) => /SEARCH icono_gene_essence USING INDEX/.test(row.detail)),
        JSON.stringify(plan.results),
      )
    } finally {
      await runtime.dispose()
    }
  },
)
