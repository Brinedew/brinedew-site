import assert from "node:assert/strict"
import test from "node:test"
import { DatabaseSync } from "node:sqlite"
import {
  applyDiscoveryBatch,
  applySharedDiscoveryDeltas,
  createDiscoveryOrdinalDictionary,
} from "./discovery-compact-state.js"
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

function fixture() {
  const db = new D1Like()
  db.raw.exec(DISCOVERY_COMPACT_SCHEMA_SQL)
  const dictionary = createDiscoveryOrdinalDictionary([
    { symbol: "TP53", ordinal: 0 },
    { symbol: "BRCA1", ordinal: 1 },
    { symbol: "EGFR", ordinal: 19022 },
  ])
  return { db, dictionary }
}

async function prepared(db, dictionary, userId, batchId, symbols, at = 100) {
  const current = await readCompactDiscoveryState(db, userId)
  const applied = applyDiscoveryBatch(current.user, {
    batchId,
    dictionary,
    encounters: symbols.map((symbol, i) => ({
      symbol,
      at: at + i,
      source: "extension",
      trigger: "hover",
    })),
  })
  const shared = applySharedDiscoveryDeltas(current.shared, {
    dictionaryVersion: dictionary.version,
    deltas: applied.shared_deltas,
  })
  return { current, applied, shared }
}

test("atomic commit writes one user state and one shared compact state", async () => {
  const { db, dictionary } = fixture()
  const next = await prepared(db, dictionary, "u1", "device:1", ["TP53", "BRCA1"])
  const receipt = await commitCompactDiscoveryBatch(db, {
    userId: "u1",
    expectedUserVersion: 0,
    expectedSharedVersion: 0,
    nextUserState: next.applied.state,
    nextSharedState: next.shared,
    sealedChunks: next.applied.sealed_chunks,
    batchId: "device:1",
  })
  assert.equal(receipt.committed, true)
  const stored = await readCompactDiscoveryState(db, "u1")
  assert.equal(stored.user.member_count, 2)
  assert.equal(stored.user.state_version, 1)
  assert.equal(stored.shared.state_version, 1)
  assert.equal(
    db.raw.prepare("SELECT COUNT(*) AS n FROM icono_discovery_user_state_v2").get().n,
    1,
  )
  assert.equal(
    db.raw.prepare("SELECT COUNT(*) AS n FROM icono_discovery_shared_state_v2").get().n,
    1,
  )
})

test("stale user or shared versions abort the whole D1 batch before either state can move", async () => {
  const { db, dictionary } = fixture()
  const a = await prepared(db, dictionary, "u1", "a", ["TP53"])
  assert.equal(
    (
      await commitCompactDiscoveryBatch(db, {
        userId: "u1",
        expectedUserVersion: 0,
        expectedSharedVersion: 0,
        nextUserState: a.applied.state,
        nextSharedState: a.shared,
        batchId: "a",
      })
    ).committed,
    true,
  )

  const before = await readCompactDiscoveryState(db, "u1")
  const stale = applyDiscoveryBatch(null, {
    batchId: "stale",
    dictionary,
    encounters: [{ symbol: "EGFR", at: 500 }],
  })
  const staleShared = applySharedDiscoveryDeltas(
    { ...before.shared, state_version: 0 },
    { dictionaryVersion: dictionary.version, deltas: stale.shared_deltas },
  )
  const conflict = await commitCompactDiscoveryBatch(db, {
    userId: "u1",
    expectedUserVersion: 0,
    expectedSharedVersion: 0,
    nextUserState: stale.state,
    nextSharedState: staleShared,
    batchId: "stale",
  })
  assert.deepEqual(conflict, { committed: false, conflict: true })
  const after = await readCompactDiscoveryState(db, "u1")
  assert.deepEqual(after, before)
})

test("different users contending on the shared aggregate force a clean retry instead of losing counts", async () => {
  const { db, dictionary } = fixture()
  const u1 = await prepared(db, dictionary, "u1", "u1:1", ["TP53"])
  const u2 = await prepared(db, dictionary, "u2", "u2:1", ["TP53"])
  assert.equal(
    (
      await commitCompactDiscoveryBatch(db, {
        userId: "u1",
        expectedUserVersion: 0,
        expectedSharedVersion: 0,
        nextUserState: u1.applied.state,
        nextSharedState: u1.shared,
        batchId: "u1:1",
      })
    ).committed,
    true,
  )
  assert.deepEqual(
    await commitCompactDiscoveryBatch(db, {
      userId: "u2",
      expectedUserVersion: 0,
      expectedSharedVersion: 0,
      nextUserState: u2.applied.state,
      nextSharedState: u2.shared,
      batchId: "u2:1",
    }),
    { committed: false, conflict: true },
  )
  assert.equal((await readCompactDiscoveryState(db, "u2")).user, null)

  const retry = await prepared(db, dictionary, "u2", "u2:1", ["TP53"])
  assert.equal(
    (
      await commitCompactDiscoveryBatch(db, {
        userId: "u2",
        expectedUserVersion: 0,
        expectedSharedVersion: 1,
        nextUserState: retry.applied.state,
        nextSharedState: retry.shared,
        batchId: "u2:1",
      })
    ).committed,
    true,
  )
  assert.equal((await readCompactDiscoveryState(db, "u2")).shared.state_version, 2)
})

test("sealed chronology chunks commit in the same transaction and replay is harmless", async () => {
  const { db, dictionary } = fixture()
  const current = await readCompactDiscoveryState(db, "u1")
  const applied = applyDiscoveryBatch(current.user, {
    batchId: "chunk:1",
    dictionary,
    encounters: Array.from({ length: 64 }, (_, i) => ({
      symbol: i % 2 ? "TP53" : "BRCA1",
      at: 1000 + i,
    })),
  })
  const shared = applySharedDiscoveryDeltas(current.shared, {
    dictionaryVersion: dictionary.version,
    deltas: applied.shared_deltas,
  })
  assert.equal(applied.sealed_chunks.length, 1)
  assert.equal(
    (
      await commitCompactDiscoveryBatch(db, {
        userId: "u1",
        expectedUserVersion: 0,
        expectedSharedVersion: 0,
        nextUserState: applied.state,
        nextSharedState: shared,
        sealedChunks: applied.sealed_chunks,
        batchId: "chunk:1",
      })
    ).committed,
    true,
  )
  assert.equal(
    db.raw.prepare("SELECT COUNT(*) AS n FROM icono_discovery_chronology_v2").get().n,
    1,
  )
  const storedChunk = db.raw.prepare("SELECT * FROM icono_discovery_chronology_v2").get()
  assert.equal(JSON.parse(storedChunk.events_json).length, 64)

  const read = await readCompactDiscoveryState(db, "u1")
  const replay = applyDiscoveryBatch(read.user, {
    batchId: "chunk:1",
    dictionary,
    encounters: [{ symbol: "EGFR", at: 9999 }],
  })
  assert.equal(replay.replay, true)
  assert.equal(replay.sealed_chunks.length, 0)
})
