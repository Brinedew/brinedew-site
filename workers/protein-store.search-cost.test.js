import assert from "node:assert/strict"
import test from "node:test"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { searchProteins } from "./lib/protein-store.js"

test(
  "cold autocomplete cost stays bounded as broad matches grow, retaining identifiers and aliases",
  { timeout: 60000 },
  async () => {
    const require = createRequire(import.meta.url)
    const { Miniflare, convertV4MiniflareOptions } = createRequire(
      require.resolve("wrangler/package.json"),
    )("miniflare")
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: "export default {fetch(){return new Response('local')}}",
        compatibilityDate: "2026-08-01",
        d1Databases: ["DB"],
      }),
    )
    try {
      const db = await runtime.getD1Database("DB")
      const schema = readFileSync(
        new URL("../migrations/0006_proper_schema.sql", import.meta.url),
        "utf8",
      )
        .split(";")
        .filter((sql) => sql.trim())
      await db.batch(schema.map((sql) => db.prepare(sql)))
      await db
        .prepare("CREATE TABLE structure_failures(uniprot TEXT PRIMARY KEY,failed_at TEXT)")
        .run()
      const receipts = []
      const metered = {
        prepare(sql) {
          return {
            run: () => db.prepare(sql).run(),
            bind(...parameters) {
              return {
                all: async () => {
                  const result = await db
                    .prepare(sql)
                    .bind(...parameters)
                    .all()
                  receipts.push(result.meta)
                  return result
                },
              }
            },
          }
        },
      }
      const costs = []
      for (const size of [2500, 25000]) {
        await db.prepare("DELETE FROM protein_synonyms").run()
        await db.prepare("DELETE FROM proteins").run()
        await db
          .prepare(
            "WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<?) INSERT INTO proteins(id,uniprot,gene,full_name,length,structure_source) SELECT x,printf('Q%05d',x),printf('A%05d',x),'A protein kinase '||x,393,'pdb' FROM n",
          )
          .bind(size)
          .run()
        await db
          .prepare(
            "INSERT INTO proteins(id,uniprot,gene,full_name,length,structure_source,synonyms) VALUES (100001,'P04637','TP53','Cellular tumor antigen p53',393,'pdb','[\"P53\"]'),(100002,'P01903','HLA-DRA','HLA class II alpha chain',254,'pdb','[]')",
          )
          .run()
        await db
          .prepare(
            "INSERT INTO protein_synonyms(protein_id,synonym,normalized) VALUES (100001,'P53','P53')",
          )
          .run()
        await db.prepare("DROP TABLE IF EXISTS protein_search").run()
        await db
          .prepare(
            "CREATE VIRTUAL TABLE protein_search USING fts5(protein_id UNINDEXED,uniprot,gene,full_name,synonyms,tokenize='unicode61 remove_diacritics 2')",
          )
          .run()
        await db
          .prepare(
            "INSERT INTO protein_search(rowid,protein_id,uniprot,gene,full_name,synonyms) SELECT id,id,uniprot,gene,full_name,COALESCE(synonyms,'') FROM proteins",
          )
          .run()
        const observed = {}
        for (const query of ["a", "protein", "TP53", "P04637", "P53", "HLA-DRA"]) {
          const result = await searchProteins(metered, query, 20)
          const receipt = receipts.at(-1)
          assert.equal(receipt.rows_written, 0)
          assert.ok(receipt.rows_read < 1500, `${query}: ${receipt.rows_read}`)
          if (["TP53", "P04637", "P53"].includes(query)) assert.equal(result[0].hgnc, "TP53")
          if (query === "HLA-DRA") assert.equal(result[0].hgnc, "HLA-DRA")
          if (query === "protein" || query === "a") assert.equal(result.length, 20)
          observed[query] = receipt.rows_read
        }
        costs.push(observed)
        assert.deepEqual(await searchProteins(metered, "P53", 20, ["P04637"]), [])
        await db
          .prepare("INSERT OR IGNORE INTO structure_failures(uniprot) VALUES ('P04637')")
          .run()
        assert.deepEqual(await searchProteins(metered, "TP53", 20), [])
        await db.prepare("DELETE FROM structure_failures").run()
      }
      console.log("bounded autocomplete D1 receipts", JSON.stringify(costs))
      assert.deepEqual(costs[0], costs[1])
    } finally {
      await runtime.dispose()
    }
  },
)
