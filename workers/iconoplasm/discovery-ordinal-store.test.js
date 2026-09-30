import assert from "node:assert/strict"
import test from "node:test"
import { DatabaseSync } from "node:sqlite"
import { DISCOVERY_COMPACT_SCHEMA_SQL } from "./discovery-compact-store.js"
import { ensureDiscoveryDictionaryForNames } from "./discovery-ordinal-store.js"

class Result {
  constructor(rows) {
    this.results = rows
  }
  first() {
    return this.results[0] ?? null
  }
}

class Bound {
  constructor(raw, sql, args = []) {
    this.raw = raw
    this.sql = sql
    this.args = args
  }
  bind(...args) {
    return new Bound(this.raw, this.sql, args)
  }
  async all() {
    return new Result(this.raw.prepare(this.sql).all(...this.args))
  }
  async run() {
    this.raw.prepare(this.sql).run(...this.args)
    return { results: [] }
  }
  async first() {
    return this.raw.prepare(this.sql).get(...this.args) ?? null
  }
}

class D1Like {
  constructor() {
    this.raw = new DatabaseSync(":memory:")
    this.prepared = []
    this.raw.exec(DISCOVERY_COMPACT_SCHEMA_SQL)
  }
  prepare(sql) {
    this.prepared.push(sql)
    return new Bound(this.raw, sql)
  }
  async batch(statements) {
    this.raw.exec("BEGIN IMMEDIATE")
    try {
      const results = statements.map((statement) => {
        statement.raw.prepare(statement.sql).run(...statement.args)
        return { results: [] }
      })
      this.raw.exec("COMMIT")
      return results
    } catch (error) {
      this.raw.exec("ROLLBACK")
      throw error
    }
  }
}

const CATALOG_ALIAS_SCAN = /json_each\(\s*icono_gene_catalog\.aliases_json\s*\)/

function catalogDb(db) {
  db.raw.exec(
    "CREATE TABLE IF NOT EXISTS icono_gene_catalog (gene_symbol TEXT PRIMARY KEY, full_name TEXT, aliases_json TEXT)",
  )
  return db
}

test("unknown and alias-shaped names never scan the catalog aliases (B-774)", async () => {
  const db = catalogDb(new D1Like())
  db.raw
    .prepare("INSERT INTO icono_gene_catalog (gene_symbol, aliases_json) VALUES (?, ?)")
    .run("TP53", JSON.stringify(["P53", "BCC7"]))
  const lookup = await ensureDiscoveryDictionaryForNames(db, ["P53", "NOTAGENE"], {
    preserveHistorical: true,
  })
  assert.equal(lookup.byName.has("TP53"), false)
  assert.ok(lookup.byName.has("P53"))
  assert.ok(lookup.byName.has("NOTAGENE"))
  assert.equal(
    db.prepared.some((sql) => CATALOG_ALIAS_SCAN.test(sql)),
    false,
    "catalog alias scans must never be issued",
  )
  const stored = db.raw
    .prepare("SELECT canonical, active FROM icono_discovery_ordinals_v2 WHERE name = ?")
    .get("P53")
  assert.equal(stored.canonical, "P53")
  assert.equal(Number(stored.active), 0)
})

test("exact catalog symbols still resolve without any catalog alias scan (B-774)", async () => {
  const db = catalogDb(new D1Like())
  db.raw
    .prepare("INSERT INTO icono_gene_catalog (gene_symbol, aliases_json) VALUES (?, ?)")
    .run("TP53", JSON.stringify(["P53"]))
  const lookup = await ensureDiscoveryDictionaryForNames(db, ["TP53"])
  assert.ok(lookup.byName.has("TP53"))
  assert.equal(
    db.prepared.some((sql) => CATALOG_ALIAS_SCAN.test(sql)),
    false,
  )
})
