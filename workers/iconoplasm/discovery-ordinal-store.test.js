import assert from "node:assert/strict"
import test from "node:test"
import { DatabaseSync } from "node:sqlite"
import { DISCOVERY_COMPACT_SCHEMA_SQL } from "./discovery-compact-store.js"
import {
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
    this.raw.exec(DISCOVERY_COMPACT_SCHEMA_SQL)
  }
  prepare(sql) {
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
