import assert from "node:assert/strict"
import test from "node:test"
import { resolveGene } from "./manifestation-gene-resolver.js"
import { TestD1 } from "./manifestation-authority-test-support.js"

test("gene locators use indexed identity and alias probes at catalogue scale", async () => {
  const db = new TestD1()
  try {
    db.raw.exec(`WITH RECURSIVE ids(n) AS (
      VALUES(1) UNION ALL SELECT n + 1 FROM ids WHERE n < 20000
    ) INSERT INTO icono_gene_identities(gene_id, canonical_symbol)
      SELECT 'gene-' || n, 'SYMBOL' || n FROM ids`)
    db.raw.exec(`INSERT INTO icono_gene_aliases(alias_symbol, gene_id, alias_kind)
      SELECT 'ALIAS' || substr(gene_id, 6), gene_id, 'synonym' FROM icono_gene_identities`)
    const prepare = db.prepare.bind(db)
    const plans = []
    db.prepare = (sql) => {
      const statement = prepare(sql)
      const bind = statement.bind.bind(statement)
      statement.bind = (...parameters) => {
        plans.push(...db.raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...parameters))
        return bind(...parameters)
      }
      return statement
    }
    for (const locator of ["gene-20000", "symbol20000", "alias20000"]) {
      assert.equal((await resolveGene(db, locator)).gene_id, "gene-20000")
    }
    await assert.rejects(resolveGene(db, "missing"), { code: "GENE_NOT_FOUND" })
    for (const { detail } of plans) {
      assert.doesNotMatch(detail, /SCAN (?:gene|alias|merged|icono_gene_)/i)
    }
    assert.ok(plans.some(({ detail }) => /SEARCH icono_gene_aliases USING INDEX/.test(detail)))
  } finally {
    db.close()
  }
})
