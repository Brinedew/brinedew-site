import assert from "node:assert/strict"
import test from "node:test"
import { DatabaseSync } from "node:sqlite"
import { DISCOVERY_COMPACT_SCHEMA_SQL } from "./discovery-compact-store.js"
import {
  ensureDiscoveryDictionaryForNames,
  evolveAndPersistDiscoveryDictionary,
  loadDiscoveryDictionaryForNames,
  readCanonicalSymbolsForOrdinals,
  readDiscoveryDictionaryMeta,
} from "./discovery-ordinal-store.js"

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

test("cold evolution seeds sorted ordinals and a stable version", async () => {
  const db = new D1Like()
  const seeded = await evolveAndPersistDiscoveryDictionary(db, {
    symbols: ["TP53", "BRCA1", "EGFR"],
  })
  assert.deepEqual([seeded.version, seeded.changed, seeded.writes], [1, true, 3])
  assert.deepEqual(await readDiscoveryDictionaryMeta(db), { version: 1 })
  const lookup = await loadDiscoveryDictionaryForNames(db, ["TP53", "BRCA1", "EGFR", "NEW1"])
  assert.equal(lookup.version, 1)
  assert.equal(lookup.byName.get("BRCA1"), 0)
  assert.equal(lookup.byName.get("EGFR"), 1)
  assert.equal(lookup.byName.get("TP53"), 2)
  assert.equal(lookup.byName.has("NEW1"), false)
})

test("an unchanged catalog performs a write-free evolution", async () => {
  const db = new D1Like()
  await evolveAndPersistDiscoveryDictionary(db, { symbols: ["BRCA1", "TP53"] })
  const stable = await evolveAndPersistDiscoveryDictionary(db, { symbols: ["TP53", "BRCA1"] })
  assert.deepEqual([stable.version, stable.changed, stable.writes], [1, false, 0])
})

test("a rename keeps the ordinal and resolves the historical alias to one bit", async () => {
  const db = new D1Like()
  await evolveAndPersistDiscoveryDictionary(db, { symbols: ["OLD1", "TP53"] })
  const before = await loadDiscoveryDictionaryForNames(db, ["OLD1"])
  const renamed = await evolveAndPersistDiscoveryDictionary(db, {
    symbols: ["NEW1", "TP53"],
    aliases: { OLD1: "NEW1" },
  })
  assert.equal(renamed.changed, true)
  assert.equal(renamed.version, 2)
  const after = await loadDiscoveryDictionaryForNames(db, ["NEW1", "OLD1"])
  assert.equal(after.byName.get("NEW1"), before.byName.get("OLD1"))
  assert.equal(after.byName.get("OLD1"), before.byName.get("OLD1"))
  const canonical = await readCanonicalSymbolsForOrdinals(db, [before.byName.get("OLD1")])
  assert.equal(canonical.get(before.byName.get("OLD1")), "NEW1")
})

test("a partially applied seed without a meta row is never renumbered", async () => {
  const db = new D1Like()
  await evolveAndPersistDiscoveryDictionary(db, { symbols: ["TP53", "BRCA1"] })
  db.raw.exec("DELETE FROM icono_discovery_dictionary_meta_v2")
  const rebuilt = await evolveAndPersistDiscoveryDictionary(db, {
    symbols: ["TP53", "BRCA1", "A1BG"],
  })
  const lookup = await loadDiscoveryDictionaryForNames(db, ["A1BG", "TP53"])
  assert.equal(lookup.byName.get("TP53"), 1)
  assert.equal(lookup.byName.get("A1BG"), 2)
  assert.equal((await readDiscoveryDictionaryMeta(db)).version >= 1, true)
  assert.equal(rebuilt.entries, 3)
})

test("retired ordinals stay resolvable for historical aliases", async () => {
  const db = new D1Like()
  await evolveAndPersistDiscoveryDictionary(db, { symbols: ["BRCA1", "TP53"] })
  const first = await loadDiscoveryDictionaryForNames(db, ["BRCA1"])
  await evolveAndPersistDiscoveryDictionary(db, { symbols: ["TP53"] })
  const second = await loadDiscoveryDictionaryForNames(db, ["BRCA1", "TP53"])
  assert.equal(second.byName.get("BRCA1"), first.byName.get("BRCA1"))
  assert.ok(second.byName.has("TP53"))
})

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
