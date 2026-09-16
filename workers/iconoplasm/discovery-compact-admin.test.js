import assert from "node:assert/strict"
import test from "node:test"
import { DatabaseSync } from "node:sqlite"
import { applyDiscoveryBatch, createDiscoveryOrdinalDictionary } from "./discovery-compact-state.js"
import {
  commitCompactDiscoveryBatch,
  DISCOVERY_COMPACT_SCHEMA_SQL,
  readCompactDiscoveryState,
} from "./discovery-compact-store.js"

class Bound {
  constructor(raw, sql, args = []) {
    this.raw = raw
    this.sql = sql
    this.args = args
  }
  bind(...args) {
    return new Bound(this.raw, this.sql, args)
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
      const results = statements.map((statement) => ({
        results: this.raw.prepare(statement.sql).all(...statement.args),
      }))
      this.raw.exec("COMMIT")
      return results
    } catch (error) {
      this.raw.exec("ROLLBACK")
      throw error
    }
  }
}

const dictionary = createDiscoveryOrdinalDictionary([{ symbol: "TP53", ordinal: 0 }])

test("admin discovery saves do not contend on or mutate the shared non-admin aggregate", async () => {
  const db = new D1Like()
  db.raw.exec("UPDATE icono_discovery_shared_state_v2 SET state_version=17")
  const before = await readCompactDiscoveryState(db, "admin")
  const applied = applyDiscoveryBatch(before.user, {
    batchId: "admin-device:1",
    dictionary,
    encounters: [{ symbol: "TP53", at: 100, source: "extension", trigger: "hover" }],
  })
  const result = await commitCompactDiscoveryBatch(db, {
    userId: "admin",
    expectedUserVersion: 0,
    expectedSharedVersion: 0,
    nextUserState: applied.state,
    batchId: "admin-device:1",
    includeShared: false,
  })
  assert.equal(result.committed, true)
  const after = await readCompactDiscoveryState(db, "admin")
  assert.equal(after.user.member_count, 1)
  assert.equal(after.shared.state_version, 17)
})
